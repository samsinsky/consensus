import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelOption } from '../../shared/types.js';
import { classifyError } from './errors.js';
import { runJsonl } from './process.js';
import { DEFAULT_TIMEOUT_MS, type AdapterEvent, type CliOptions, type ProviderAdapter, type SendRequest } from './types.js';

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
async function ensureAgent(workdir: string, req: SendRequest): Promise<string> {
  const name = agentName(req.promptHash);
  const dir = join(workdir, '.agents', 'agents');
  const file = join(dir, `${name}.md`);
  try {
    await access(file);
  } catch {
    await mkdir(dir, { recursive: true });
    const body = await readFile(req.promptPath, 'utf8');
    await writeFile(file, `---\nname: ${name}\ndescription: Consensus prose participant.\ntools: []\n---\n${body}`);
  }
  return name;
}

async function* send(opts: CliOptions, req: SendRequest): AsyncGenerator<AdapterEvent> {
  await mkdir(opts.workdir, { recursive: true });
  const name = await ensureAgent(opts.workdir, req);
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
  args.push(`-p=${req.message}`);

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
