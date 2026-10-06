import { mkdir, readFile } from 'node:fs/promises';
import type { ModelOption } from '../../shared/types.js';
import { classifyError } from './errors.js';
import { runJsonl } from './process.js';
import { DEFAULT_TIMEOUT_MS, type AdapterEvent, type CliOptions, type ImageInput, type ProviderAdapter, type SendRequest } from './types.js';

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

const MODELS: ModelOption[] = [
  { id: 'opus', label: 'Opus', efforts: EFFORTS },
  { id: 'sonnet', label: 'Sonnet', efforts: EFFORTS },
  { id: 'haiku', label: 'Haiku', efforts: [] },
];

export function createClaudeAdapter(opts: CliOptions): ProviderAdapter {
  return {
    id: 'claude',
    listModels: async () => MODELS,
    send: (req) => send(opts, req),
  };
}

async function* send(opts: CliOptions, req: SendRequest): AsyncGenerator<AdapterEvent> {
  await mkdir(opts.workdir, { recursive: true });
  const args = [
    ...(opts.binArgs ?? []),
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--system-prompt-file', req.promptPath,
    '--tools', '',
    '--setting-sources', '',
    '--strict-mcp-config',
    '--no-chrome',
    '--model', req.model,
  ];
  if (req.effort) args.push('--effort', req.effort);
  // Fork every turn: a stopped turn lands in a fork we never record.
  if (req.sessionId) args.push('--resume', req.sessionId, '--fork-session');
  const images = req.images ?? [];
  if (images.length) args.push('--input-format', 'stream-json');

  let sessionSent = false;
  let noise = '';
  for await (const item of runJsonl({
    bin: opts.bin ?? 'claude',
    args,
    cwd: opts.workdir,
    env: opts.env,
    stdin: images.length ? await imageMessage(req.message, images) : req.message,
    signal: req.signal,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  })) {
    if (item.type === 'line') {
      noise += item.text + '\n';
    } else if (item.type === 'json') {
      const ev = item.value;
      if (!sessionSent && typeof ev.session_id === 'string') {
        sessionSent = true;
        yield { type: 'session', sessionId: ev.session_id };
      }
      if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta' && ev.event.delta?.type === 'text_delta') {
        yield { type: 'delta', text: ev.event.delta.text };
      } else if (ev.type === 'result') {
        if (ev.is_error || ev.subtype !== 'success') {
          yield { type: 'error', error: classifyError('claude', { detail: String(ev.result ?? ev.subtype ?? '') }) };
        } else {
          yield { type: 'done', text: String(ev.result ?? '') };
        }
        return;
      }
    } else {
      if (item.info.aborted) return;
      yield { type: 'error', error: classifyError('claude', { ...item.info, detail: noise }) };
      return;
    }
  }
}

/** One stream-json user message: image blocks first, then the text. */
async function imageMessage(text: string, images: ImageInput[]): Promise<string> {
  const content: object[] = [];
  for (const img of images) {
    content.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: (await readFile(img.path)).toString('base64') } });
  }
  content.push({ type: 'text', text });
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`;
}
