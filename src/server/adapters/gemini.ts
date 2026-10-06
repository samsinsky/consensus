import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { ModelOption } from '../../shared/types.js';
import { classifyError } from './errors.js';
import { runJsonl } from './process.js';
import { DEFAULT_TIMEOUT_MS, type AdapterEvent, type CliOptions, type ImageInput, type ProviderAdapter, type SendRequest } from './types.js';

const FALLBACK_MODELS: ModelOption[] = [
  { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)', efforts: [] },
  { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)', efforts: [] },
];
const MODELS_TTL_MS = 10 * 60 * 1000;

export function agentName(promptHash: string): string {
  return `consensus-${promptHash}`;
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
async function ensureAgent(workdir: string, req: SendRequest, viewer: boolean): Promise<string> {
  const name = viewer ? `${agentName(req.promptHash)}-viewer` : agentName(req.promptHash);
  const dir = join(workdir, '.agents', 'agents');
  const file = join(dir, `${name}.md`);
  try {
    await access(file);
  } catch {
    await mkdir(dir, { recursive: true });
    const body = await readFile(req.promptPath, 'utf8');
    // The viewer variant exists only for image turns: Antigravity's input accepts text alone.
    const tools = viewer ? 'tools:\n  - view_file' : 'tools: []';
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
  const name = await ensureAgent(opts.workdir, req, images.length > 0);
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
    '--print-timeout', `${Math.ceil(timeoutMs / 1000)}s`,
  ];
  // Antigravity drops a cancelled turn itself, so resuming in place is safe.
  if (req.sessionId) args.push('--conversation', req.sessionId);
  args.push(`-p=${message}`);

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
