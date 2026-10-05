import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ModelOption } from '../../shared/types.js';
import { classifyError } from './errors.js';
import { runJsonl } from './process.js';
import { DEFAULT_TIMEOUT_MS, type AdapterEvent, type CliOptions, type ProviderAdapter, type SendRequest } from './types.js';

const FALLBACK_MODELS: ModelOption[] = [
  { id: 'gpt-6-luna', label: 'GPT-6-Luna', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
];

type CodexOptions = CliOptions & { codexHome?: string };

export function createCodexAdapter(opts: CodexOptions): ProviderAdapter {
  return {
    id: 'codex',
    listModels: () => listModels(opts.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex')),
    send: (req) => send(opts, req),
  };
}

async function listModels(codexHome: string): Promise<ModelOption[]> {
  try {
    const cache = JSON.parse(await readFile(join(codexHome, 'models_cache.json'), 'utf8'));
    const models: any[] = Array.isArray(cache) ? cache : cache.models ?? [];
    const options = models
      .filter((m) => typeof m.slug === 'string' && !m.slug.includes('auto-review'))
      .map((m) => ({
        id: m.slug as string,
        label: (m.display_name as string) ?? m.slug,
        efforts: ((m.supported_reasoning_levels ?? []) as { effort: string }[]).map((l) => l.effort),
      }));
    return options.length ? options : FALLBACK_MODELS;
  } catch {
    return FALLBACK_MODELS;
  }
}

async function* send(opts: CodexOptions, req: SendRequest): AsyncGenerator<AdapterEvent> {
  await mkdir(opts.workdir, { recursive: true });
  const common = [
    '--json',
    '--skip-git-repo-check',
    '--ignore-user-config',
    '-m', req.model,
    '-c', `model_instructions_file=${JSON.stringify(req.promptPath)}`,
    '-c', 'sandbox_mode="read-only"',
  ];
  if (req.effort) common.push('-c', `model_reasoning_effort=${JSON.stringify(req.effort)}`);
  // Fork every turn: a stopped turn lands in a fork we never record.
  const head = req.sessionId ? ['exec', 'fork', req.sessionId] : ['exec'];
  const args = [...(opts.binArgs ?? []), ...head, ...common, '-'];

  const texts: string[] = [];
  let lastError = '';
  let noise = '';
  for await (const item of runJsonl({
    bin: opts.bin ?? 'codex',
    args,
    cwd: opts.workdir,
    env: opts.env,
    stdin: req.message,
    signal: req.signal,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  })) {
    if (item.type === 'line') {
      noise += item.text + '\n';
    } else if (item.type === 'json') {
      const ev = item.value;
      if (ev.type === 'thread.started' && typeof ev.thread_id === 'string') {
        yield { type: 'session', sessionId: ev.thread_id };
      } else if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') {
        const text = String(ev.item.text ?? '');
        yield { type: 'delta', text: texts.length ? `\n\n${text}` : text };
        texts.push(text);
      } else if (ev.type === 'item.completed' && ev.item?.type === 'error') {
        yield { type: 'warning', message: String(ev.item.message ?? '') };
      } else if (ev.type === 'error') {
        lastError = String(ev.message ?? '');
      } else if (ev.type === 'turn.completed') {
        yield { type: 'done', text: texts.join('\n\n') };
        return;
      } else if (ev.type === 'turn.failed') {
        const detail = [lastError, ev.error?.message].filter(Boolean).join('\n');
        yield { type: 'error', error: classifyError('codex', { detail }) };
        return;
      }
    } else {
      if (item.info.aborted) return;
      yield { type: 'error', error: classifyError('codex', { ...item.info, detail: [lastError, noise].join('\n') }) };
      return;
    }
  }
}
