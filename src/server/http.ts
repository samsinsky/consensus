import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { PROVIDER_IDS, type ProviderId, type Settings, type ThreadEvent } from '../shared/types.js';
import type { ProviderAdapter } from './adapters/types.js';
import { ATTACHMENT_LIMITS, AttachmentError, type AttachmentStore } from './attachments.js';
import type { Rebased } from '../shared/change.js';
import { DocService } from './docs.js';
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
  attachments?: AttachmentStore;
  docs?: DocService;
  webDir?: string;
};

type Handler = (req: IncomingMessage, res: ServerResponse, params: string[]) => Promise<void>;

const ID = '([\\w-]+)';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const MAX_BODY = 5 * 1024 * 1024;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};

export function createConsensusServer(deps: Deps): Server {
  const { router, store, hub, paths, adapters } = deps;
  const attachments = deps.attachments ?? router.attachments;
  const docs = deps.docs ?? new DocService(router);

  const routes: [string, RegExp, Handler][] = [
    ['GET', /^\/api\/threads$/, async (_q, res) => json(res, 200, await store.list())],
    ['POST', /^\/api\/threads$/, async (req, res) => {
      const body = await readJson(req);
      if (body.kind === 'doc') {
        return json(res, 200, await docs.create({ brief: optText(body.brief), markdown: optText(body.markdown) }));
      }
      json(res, 200, await router.createThread());
    }],
    ['GET', re(`/api/threads/${ID}`), async (_q, res, [id]) => {
      const thread = await router.getThread(id);
      if (!thread) throw new RouterError('not_found', 'That thread does not exist.');
      json(res, 200, thread);
    }],
    ['PATCH', re(`/api/threads/${ID}`), async (req, res, [id]) => {
      const body = await readJson(req);
      if (typeof body.title !== 'string') throw new RouterError('invalid', 'Missing title.');
      await router.renameThread(id, body.title);
      res.writeHead(204).end();
    }],
    ['DELETE', re(`/api/threads/${ID}`), async (_q, res, [id]) => {
      await router.deleteThread(id);
      res.writeHead(204).end();
    }],
    ['POST', re(`/api/threads/${ID}/attachments`), async (req, res, [id]) => {
      if (!(await router.getThread(id))) throw new RouterError('not_found', 'That thread does not exist.');
      const name = decodeURIComponent(String(req.headers['x-filename'] ?? 'file'));
      json(res, 200, await attachments.save(id, name, await readRaw(req, ATTACHMENT_LIMITS.fileBytes)));
    }],
    ['GET', re(`/api/threads/${ID}/attachments/${ID}`), async (_q, res, [id, aid]) => {
      const att = await attachments.get(id, aid);
      // Only images come back; serving an attached HTML file would run it on this origin.
      if (!att || att.kind !== 'image') throw new RouterError('not_found', 'Not found.');
      const body = await readFile(attachments.filePath(id, att));
      res.writeHead(200, {
        'content-type': att.mime,
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, max-age=86400',
      }).end(body);
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
      if (typeof body.included === 'boolean') {
        await docs.setIncluded(id, pid, body.included);
        return void res.writeHead(204).end();
      }
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
      const attachmentIds = Array.isArray(body.attachmentIds) ? body.attachmentIds.filter((x: unknown) => typeof x === 'string') : [];
      const { userMessageId, replyMessageId, done } = await router.send(id, { to: body.to, text: body.text, quotes, attachmentIds });
      done.catch((e) => console.error('consensus: reply failed', e));
      json(res, 202, { userMessageId, replyMessageId });
    }],
    ['POST', re(`/api/threads/${ID}/replies/${ID}/stop`), async (_q, res, [id, rid]) => {
      if (!router.stop(id, rid)) throw new RouterError('not_found', 'That reply is not running.');
      res.writeHead(204).end();
    }],
    ['POST', re(`/api/threads/${ID}/replies/${ID}/retry`), async (_q, res, [id, rid]) => {
      const { userMessageId, replyMessageId, done } = await router.retry(id, rid);
      done.catch((e) => console.error('consensus: reply failed', e));
      json(res, 202, { userMessageId, replyMessageId });
    }],
    ['DELETE', re(`/api/threads/${ID}/participants/${ID}`), async (_q, res, [id, pid]) => {
      await router.removeParticipant(id, pid);
      res.writeHead(204).end();
    }],
    ['POST', re(`/api/threads/${ID}/open-as-doc`), async (req, res, [id]) => {
      const body = await readJson(req);
      if (typeof body.replyId !== 'string') throw new RouterError('invalid', 'Missing reply.');
      json(res, 200, await docs.openAsDoc(id, body.replyId));
    }],
    ['PUT', re(`/api/threads/${ID}/doc`), async (req, res, [id]) => {
      const body = await readJson(req);
      if (typeof body.revision !== 'number') throw new RouterError('invalid', 'Missing revision.');
      const ids = Array.isArray(body.briefAttachmentIds) ? body.briefAttachmentIds.filter((x: unknown) => typeof x === 'string') : undefined;
      await docs.saveDoc(id, { revision: body.revision, markdown: optText(body.markdown), brief: optText(body.brief), briefAttachmentIds: ids });
      res.writeHead(204).end();
    }],
    ['POST', re(`/api/threads/${ID}/rounds`), async (_q, res, [id]) => {
      const { round, done } = await docs.startRound(id);
      done.catch((e) => console.error('consensus: review round failed', e));
      json(res, 202, { round });
    }],
    ['POST', re(`/api/threads/${ID}/rounds/stop`), async (_q, res, [id]) => {
      if (!docs.stopRound(id)) throw new RouterError('not_found', 'No review round is running.');
      res.writeHead(204).end();
    }],
    ['POST', re(`/api/threads/${ID}/participants/${ID}/retry-review`), async (_q, res, [id, pid]) => {
      const { done } = await docs.retryReview(id, pid);
      done.catch((e) => console.error('consensus: review retry failed', e));
      res.writeHead(202).end();
    }],
    ['PATCH', re(`/api/threads/${ID}/proposals/${ID}`), async (req, res, [id, pid]) => {
      const body = await readJson(req);
      if (body.status !== undefined && !['accepted', 'rejected', 'dismissed'].includes(body.status)) throw new RouterError('invalid', 'Unknown status.');
      const ids = (v: unknown) => {
        if (v === undefined) return undefined;
        if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) throw new RouterError('invalid', 'Expected a list of proposal ids.');
        return v as string[];
      };
      const rebased = body.rebased === undefined ? undefined : body.rebased;
      if (rebased !== undefined && (!Array.isArray(rebased) || !rebased.every((r: unknown) => isRebased(r)))) {
        throw new RouterError('invalid', 'Each moved proposal needs an id, quote, replacement, prefix and suffix.');
      }
      await docs.updateProposal(id, pid, { status: body.status, replacement: optText(body.replacement), notChosen: ids(body.notChosen), superseded: ids(body.superseded), rebased });
      res.writeHead(204).end();
    }],
    ['POST', re(`/api/threads/${ID}/proposals/${ID}/replies`), async (req, res, [id, pid]) => {
      const body = await readJson(req);
      if (typeof body.text !== 'string') throw new RouterError('invalid', 'Missing text.');
      await docs.reply(id, pid, body.text);
      res.writeHead(204).end();
    }],
    ['POST', re(`/api/threads/${ID}/restore`), async (req, res, [id]) => {
      const body = await readJson(req);
      if (typeof body.round !== 'number') throw new RouterError('invalid', 'Missing round.');
      await docs.restore(id, body.round);
      res.writeHead(204).end();
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
      // Block DNS rebinding and cross-site requests: only local pages may drive the CLIs.
      const refusal = refuseForeign(req);
      if (refusal) return json(res, refusal.status, { error: refusal.error });
      for (const [method, pattern, handler] of routes) {
        const m = pattern.exec(url.pathname);
        if (m && req.method === method) return await handler(req, res, m.slice(1));
      }
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found.' });
      await serveStatic(deps.webDir, req, res);
    } catch (e) {
      if (res.headersSent) return void res.end();
      if (e instanceof AttachmentError) return json(res, e.status, { error: e.message });
      if (e instanceof RouterError) {
        const status = { not_found: 404, busy: 409, invalid: 400 }[e.code];
        return json(res, status, { error: e.message });
      }
      console.error('consensus:', e);
      json(res, 500, { error: e instanceof Error ? e.message : 'Server error.' });
    }
  });
}

function hostnameOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value.includes('://') ? value : `http://${value}`).hostname;
  } catch {
    return undefined;
  }
}

function refuseForeign(req: IncomingMessage): { status: number; error: string } | undefined {
  const host = hostnameOf(req.headers.host);
  if (!host || !LOCAL_HOSTS.has(host)) return { status: 403, error: 'Consensus only answers requests addressed to localhost.' };
  const origin = req.headers.origin;
  if (origin && !LOCAL_HOSTS.has(hostnameOf(origin) ?? '')) return { status: 403, error: 'Cross-origin requests are not allowed.' };
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && (Number(req.headers['content-length'] ?? 0) > 0 || !!req.headers['transfer-encoding']);
  const isUpload = req.headers['x-consensus-upload'] === '1';
  if (hasBody && !isUpload && !String(req.headers['content-type'] ?? '').startsWith('application/json')) {
    return { status: 415, error: 'Send JSON.' };
  }
  return undefined;
}

function re(path: string): RegExp {
  return new RegExp(`^${path}$`);
}

function optString(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

function optText(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
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

async function readRaw(req: IncomingMessage, limit: number): Promise<Buffer> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new AttachmentError(413, `Files can be at most ${limit / 1024 / 1024}MB.`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
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

function isRebased(r: unknown): r is Rebased {
  if (typeof r !== 'object' || r === null) return false;
  const o = r as Record<string, unknown>;
  return ['id', 'quote', 'replacement', 'prefix', 'suffix'].every((k) => typeof o[k] === 'string');
}
