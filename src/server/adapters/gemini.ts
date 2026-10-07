import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { ModelOption } from '../../shared/types.js';
import { classifyError } from './errors.js';
import { runJsonl } from './process.js';
import { DEFAULT_TIMEOUT_MS, hostOf, type AdapterEvent, type CliOptions, type ImageInput, type ProviderAdapter, type SendRequest } from './types.js';

const FALLBACK_MODELS: ModelOption[] = [
  { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)', efforts: [] },
  { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)', efforts: [] },
];
const MODELS_TTL_MS = 10 * 60 * 1000;
const MAX_PROMPT_BYTES = 900_000;

export function agentName(promptHash: string): string {
  // The -web suffix keeps older tool-less agent files for the same prompt from being reused.
  return `consensus-${promptHash}-web`;
}

export function createGeminiAdapter(opts: CliOptions): ProviderAdapter {
  let cache: { at: number; models: ModelOption[] } | undefined;
  return {
    id: 'gemini',
    async listModels() {
      if (cache && Date.now() - cache.at < MODELS_TTL_MS) return cache.models;
      const models = await listModels(opts);
      cache = { at: Date.now(), models };
      return models;
    },
    send: (req) => send(opts, req),
  };
}

async function listModels(opts: CliOptions): Promise<ModelOption[]> {
  await mkdir(opts.workdir, { recursive: true });
  const models: ModelOption[] = [];
  for await (const item of runJsonl({
    bin: opts.bin ?? 'agy',
    args: [...(opts.binArgs ?? []), 'models'],
    cwd: opts.workdir,
    env: opts.env,
    signal: new AbortController().signal,
    timeoutMs: 30_000,
  })) {
    if (item.type !== 'line') continue;
    const m = /^(gemini-\S+)\t(.+)$/.exec(item.text);
    if (m) models.push({ id: m[1], label: m[2].trim(), efforts: [] });
  }
  return models.length ? models : FALLBACK_MODELS;
}

/** Antigravity has no system-prompt flag; a custom agent's body becomes its system prompt. */
async function ensureAgent(workdir: string, req: SendRequest): Promise<string> {
  const name = agentName(req.promptHash);
  const dir = join(workdir, '.agents', 'agents');
  const file = join(dir, `${name}.md`);
  try {
    await access(file);
  } catch {
    await mkdir(dir, { recursive: true });
    const body = await readFile(req.promptPath, 'utf8');
    // read_url_content saves each page to a local file, so view_file is needed to read it (and images).
    const tools = 'tools:\n  - read_url_content\n  - search_web\n  - view_file';
    await writeFile(file, `---\nname: ${name}\ndescription: Consensus prose participant.\n${tools}\n---\n${body}`);
  }
  return name;
}

async function copyImages(workdir: string, images: ImageInput[]): Promise<string[]> {
  const rels: string[] = [];
  for (const img of images) {
    const rel = `attachments/${img.threadId}/${img.id}${extname(img.path).toLowerCase()}`;
    await mkdir(join(workdir, 'attachments', img.threadId), { recursive: true });
    await copyFile(img.path, join(workdir, rel));
    rels.push(rel);
  }
  return rels;
}

async function* send(opts: CliOptions, req: SendRequest): AsyncGenerator<AdapterEvent> {
  await mkdir(opts.workdir, { recursive: true });
  const images = req.images ?? [];
  const name = await ensureAgent(opts.workdir, req);
  let message = req.message;
  if (images.length) {
    const rels = await copyImages(opts.workdir, images);
    const list = rels.map((rel, i) => `- ${rel} (${images[i].name})`).join('\n');
    message = `Attached images. Use view_file to look at each one before replying:\n${list}\n\n${req.message}`;
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const args = [
    ...(opts.binArgs ?? []),
    '--agent', name,
    '--model', req.model,
    '--output-format', 'stream-json',
    // Headless mode cannot ask; the agent's tool list bounds what this approves.
    '--dangerously-skip-permissions',
    '--print-timeout', `${Math.ceil(timeoutMs / 1000)}s`,
  ];
  // Antigravity drops a cancelled turn itself, so resuming in place is safe.
  if (req.sessionId) args.push('--conversation', req.sessionId);
  const prompt = `-p=${message}`;
  // The prompt travels as one argument; past macOS's argument limit spawn fails with E2BIG.
  if (Buffer.byteLength(prompt) > MAX_PROMPT_BYTES) {
    yield {
      type: 'error',
      error: { code: 'unknown', message: 'Too much text for Gemini in one message (about 900KB at most). Attach fewer or shorter files.' },
    };
    return;
  }
  args.push(prompt);

  let sessionSent = false;
  let noise = '';
  for await (const item of runJsonl({
    bin: opts.bin ?? 'agy',
    args,
    cwd: opts.workdir,
    env: opts.env,
    signal: req.signal,
    timeoutMs: timeoutMs + 30_000,
  })) {
    if (item.type === 'line') {
      noise += item.text + '\n';
    } else if (item.type === 'json') {
      const ev = item.value;
      if (!sessionSent && ev.event === 'init' && typeof ev.conversation_id === 'string') {
        sessionSent = true;
        yield { type: 'session', sessionId: ev.conversation_id };
      } else if (ev.event === 'step_update' && ev.step_update?.step_type === 'tool' && ev.step_update.state === 'ACTIVE') {
        const tool = ev.step_update.tool_info ?? {};
        if (tool.name === 'search_web') yield { type: 'activity', text: `Searching the web for "${tool.parameters?.query ?? ''}"` };
        const url = tool.parameters?.Url;
        if (tool.name === 'read_url_content' && typeof url === 'string') {
          yield { type: 'activity', text: `Reading ${hostOf(url)}` };
          yield { type: 'source', url };
        }
      } else if (ev.event === 'step_update' && ev.step_update?.step_type === 'agent_response' && ev.step_update.text_delta) {
        yield { type: 'delta', text: String(ev.step_update.text_delta) };
      } else if (ev.event === 'result') {
        const r = ev.result ?? {};
        if (r.status === 'SUCCESS') {
          yield { type: 'done', text: String(r.response ?? '').trimEnd() };
        } else {
          const detail = [r.error, r.status, noise].filter(Boolean).join('\n');
          yield { type: 'error', error: classifyError('gemini', { detail }) };
        }
        return;
      }
    } else {
      if (item.info.aborted) return;
      yield { type: 'error', error: classifyError('gemini', { ...item.info, detail: noise }) };
      return;
    }
  }
}
