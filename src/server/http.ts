import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { PROVIDER_IDS, type ProviderId, type Settings, type ThreadEvent } from '../shared/types.js';
import type { ProviderAdapter } from './adapters/types.js';
import type { EventHub } from './hub.js';
import type { Paths } from './paths.js';
import { readPrompt, writePrompt } from './prompt.js';
import { RouterError, type Router } from './router.js';
import { loadSettings, saveSettings } from './settings.js';
import type { ThreadStore } from './store.js';

type Deps = {
  router: Router;
  store: ThreadStore;
  hub: EventHub;
  paths: Paths;
  adapters: Record<ProviderId, ProviderAdapter>;
  webDir?: string;
};

type Handler = (req: IncomingMessage, res: ServerResponse, params: string[]) => Promise<void>;

const ID = '([\\w-]+)';
const MAX_BODY = 5 * 1024 * 1024;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};

export function createRelayServer(deps: Deps): Server {
  const { router, store, hub, paths, adapters } = deps;

  const routes: [string, RegExp, Handler][] = [
    ['GET', /^\/api\/threads$/, async (_q, res) => json(res, 200, await store.list())],
    ['POST', /^\/api\/threads$/, async (_q, res) => json(res, 200, await router.createThread())],
    ['GET', re(`/api/threads/${ID}`), async (_q, res, [id]) => {
      const thread = await router.getThread(id);
      if (!thread) throw new RouterError('not_found', 'That thread does not exist.');
      json(res, 200, thread);
    }],
    ['GET', re(`/api/threads/${ID}/events`), async (req, res, [id]) => {
      const thread = await router.getThread(id);
      if (!thread) throw new RouterError('not_found', 'That thread does not exist.');
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const write = (ev: ThreadEvent) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
      write({ type: 'thread', thread });
      const unsubscribe = hub.subscribe(id, write);
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
      req.on('close', () => {
        unsubscribe();
        clearInterval(heartbeat);
      });
    }],
    ['POST', re(`/api/threads/${ID}/participants`), async (req, res, [id]) => {
      const body = await readJson(req);
      if (!PROVIDER_IDS.includes(body.provider)) throw new RouterError('invalid', 'Unknown provider.');
      if (typeof body.model !== 'string' || !body.model) throw new RouterError('invalid', 'Pick a model.');
      json(res, 200, await router.addParticipant(id, { provider: body.provider, model: body.model, effort: optString(body.effort) }));
    }],
    ['PATCH', re(`/api/threads/${ID}/participants/${ID}`), async (req, res, [id, pid]) => {
      const body = await readJson(req);
      if (typeof body.model !== 'string' || !body.model) throw new RouterError('invalid', 'Pick a model.');
      await router.changeModel(id, pid, { model: body.model, effort: optString(body.effort) });
      res.writeHead(204).end();
    }],
    ['POST', re(`/api/threads/${ID}/messages`), async (req, res, [id]) => {
      const body = await readJson(req);
      if (typeof body.to !== 'string' || typeof body.text !== 'string') throw new RouterError('invalid', 'Missing recipient or text.');
      const quotes = Array.isArray(body.quotes)
        ? body.quotes.filter((q: any) => typeof q?.text === 'string').map((q: any) => ({ messageId: String(q.messageId ?? ''), text: q.text }))
        : [];
      const { userMessageId, replyMessageId } = await router.send(id, { to: body.to, text: body.text, quotes });
      json(res, 202, { userMessageId, replyMessageId });
    }],
    ['POST', re(`/api/threads/${ID}/replies/${ID}/stop`), async (_q, res, [id, rid]) => {
      if (!router.stop(id, rid)) throw new RouterError('not_found', 'That reply is not running.');
      res.writeHead(204).end();
    }],
    ['POST', re(`/api/threads/${ID}/replies/${ID}/retry`), async (_q, res, [id, rid]) => {
      const { userMessageId, replyMessageId } = await router.retry(id, rid);
      json(res, 202, { userMessageId, replyMessageId });
    }],
    ['GET', /^\/api\/models$/, async (_q, res) => {
      const entries = await Promise.all(
        PROVIDER_IDS.map(async (id) => [id, await adapters[id].listModels().catch(() => [])] as const),
      );
      json(res, 200, Object.fromEntries(entries));
    }],
    ['GET', /^\/api\/settings$/, async (_q, res) => {
      json(res, 200, { prompt: await readPrompt(paths), settings: await loadSettings(paths) });
    }],
    ['PUT', /^\/api\/settings$/, async (req, res) => {
      const body = await readJson(req);
      if (typeof body.prompt === 'string') await writePrompt(paths, body.prompt);
      if (body.settings?.defaults) await saveSettings(paths, body.settings as Settings);
      json(res, 200, { prompt: await readPrompt(paths), settings: await loadSettings(paths) });
    }],
  ];

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      for (const [method, pattern, handler] of routes) {
        const m = pattern.exec(url.pathname);
        if (m && req.method === method) return await handler(req, res, m.slice(1));
      }
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found.' });
      await serveStatic(deps.webDir, req, res);
    } catch (e) {
      if (res.headersSent) return void res.end();
      if (e instanceof RouterError) {
        const status = { not_found: 404, busy: 409, invalid: 400 }[e.code];
        return json(res, status, { error: e.message });
      }
      console.error('relay:', e);
      json(res, 500, { error: e instanceof Error ? e.message : 'Server error.' });
    }
  });
}

function re(path: string): RegExp {
  return new RegExp(`^${path}$`);
}

function optString(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<any> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new RouterError('invalid', 'Request too large.');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new RouterError('invalid', 'Request body is not valid JSON.');
  }
}

async function serveStatic(webDir: string | undefined, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!webDir) return json(res, 404, { error: 'Not found.' });
  const rawPath = (req.url ?? '/').split('?')[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return json(res, 400, { error: 'Bad path.' });
  }
  const root = normalize(webDir + sep);
  const file = normalize(join(webDir, decoded));
  if (!file.startsWith(root) && file !== normalize(webDir)) return json(res, 403, { error: 'Forbidden.' });
  for (const candidate of [file, join(webDir, 'index.html')]) {
    try {
      const body = await readFile(candidate);
      res.writeHead(200, { 'content-type': TYPES[extname(candidate)] ?? 'application/octet-stream' }).end(body);
      return;
    } catch {
      // Unknown paths fall through to index.html for client-side routes.
    }
  }
  json(res, 404, { error: 'Not found.' });
}
