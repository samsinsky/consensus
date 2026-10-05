import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AdapterEvent, ProviderAdapter, SendRequest } from '../../src/server/adapters/types.js';
import { createRelayServer } from '../../src/server/http.js';
import { EventHub } from '../../src/server/hub.js';
import { makePaths } from '../../src/server/paths.js';
import { Router } from '../../src/server/router.js';
import { ThreadStore } from '../../src/server/store.js';
import type { ProviderId, Thread, ThreadEvent } from '../../src/shared/types.js';
import { AsyncQueue } from '../helpers/queue.js';

let server: Server;
let base: string;
let queues: AsyncQueue<AdapterEvent>[];
let webDir: string;

const fakeAdapter = (id: ProviderId): ProviderAdapter => ({
  id,
  listModels: async () => [{ id: `${id}-model`, label: 'M', efforts: [] }],
  send(req: SendRequest) {
    const q = new AsyncQueue<AdapterEvent>();
    req.signal.addEventListener('abort', () => q.end());
    queues.push(q);
    return q;
  },
});

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'relay-'));
  const paths = makePaths(home);
  webDir = join(home, 'web');
  await mkdir(webDir);
  await writeFile(join(webDir, 'index.html'), '<!doctype html><title>Relay</title>');
  queues = [];
  const store = new ThreadStore(paths.threads);
  const hub = new EventHub();
  const adapters = { claude: fakeAdapter('claude'), codex: fakeAdapter('codex'), gemini: fakeAdapter('gemini') };
  const router = new Router({ store, hub, paths, adapters });
  server = createRelayServer({ router, store, hub, paths, adapters, webDir });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }));

const api = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
};

async function readEvents(path: string, until: (ev: ThreadEvent) => boolean): Promise<ThreadEvent[]> {
  const res = await fetch(base + path);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: ThreadEvent[] = [];
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (!chunk.startsWith('data: ')) continue;
      const ev = JSON.parse(chunk.slice(6)) as ThreadEvent;
      events.push(ev);
      if (until(ev)) {
        await reader.cancel();
        return events;
      }
    }
  }
  return events;
}

describe('HTTP API', () => {
  it('creates a thread, adds a participant, sends and streams', async () => {
    const thread = (await api('POST', '/api/threads', {})).body as Thread;
    const p = (await api('POST', `/api/threads/${thread.id}/participants`, { provider: 'claude', model: 'opus', effort: 'high' })).body;
    const listening = readEvents(`/api/threads/${thread.id}/events`, (ev) => ev.type === 'delta');
    await new Promise((r) => setTimeout(r, 50));
    const sent = await api('POST', `/api/threads/${thread.id}/messages`, { to: p.id, text: 'Draft', quotes: [] });
    expect(sent.status).toBe(202);
    queues[0].push({ type: 'delta', text: 'Kitchens' });
    const events = await listening;
    expect(events[0].type).toBe('thread');
    expect(events.at(-1)).toEqual({ type: 'delta', messageId: sent.body.replyMessageId, text: 'Kitchens' });
  });

  it('returns 409 when the participant is busy and 204 on stop', async () => {
    const thread = (await api('POST', '/api/threads', {})).body as Thread;
    const p = (await api('POST', `/api/threads/${thread.id}/participants`, { provider: 'codex', model: 'gpt-6-luna' })).body;
    const first = await api('POST', `/api/threads/${thread.id}/messages`, { to: p.id, text: 'One' });
    const second = await api('POST', `/api/threads/${thread.id}/messages`, { to: p.id, text: 'Two' });
    expect(second).toEqual({ status: 409, body: { error: 'That participant is still replying.' } });
    const stop = await api('POST', `/api/threads/${thread.id}/replies/${first.body.replyMessageId}/stop`);
    expect(stop.status).toBe(204);
  });

  it('returns 404 for an unknown thread and 400 for a bad provider', async () => {
    expect((await api('GET', '/api/threads/does-not-exist')).status).toBe(404);
    const thread = (await api('POST', '/api/threads', {})).body as Thread;
    expect((await api('POST', `/api/threads/${thread.id}/participants`, { provider: 'grok', model: 'x' })).status).toBe(400);
  });

  it('lists threads, models and settings, and saves the prompt', async () => {
    await api('POST', '/api/threads', {});
    expect((await api('GET', '/api/threads')).body).toHaveLength(1);
    expect((await api('GET', '/api/models')).body.codex).toEqual([{ id: 'codex-model', label: 'M', efforts: [] }]);
    const saved = await api('PUT', '/api/settings', { prompt: 'Be brief.' });
    expect(saved.body.prompt).toBe('Be brief.');
    expect((await api('GET', '/api/settings')).body.settings.defaults.claude.model).toBe('opus');
  });

  it('serves the web app and refuses paths outside it', async () => {
    const index = await fetch(base + '/some/client/route');
    expect(await index.text()).toContain('<title>Relay</title>');
    const status = await new Promise<number>((resolve) => {
      const port = new URL(base).port;
      request({ host: '127.0.0.1', port, path: '/..%2f..%2fpackage.json' }, (res) => resolve(res.statusCode!)).end();
    });
    expect(status).toBe(403);
  });
  it('rejects requests from non-local hosts, foreign origins and non-JSON bodies', async () => {
    const port = Number(new URL(base).port);
    const raw = (method: string, path: string, headers: Record<string, string>, body?: string) =>
      new Promise<number>((resolve) => {
        const r = request({ host: '127.0.0.1', port, method, path, headers }, (res) => { res.resume(); resolve(res.statusCode!); });
        if (body) r.write(body);
        r.end();
      });
    expect(await raw('GET', '/api/threads', { host: 'evil.example:4747' })).toBe(403);
    expect(await raw('POST', '/api/threads', { host: `localhost:${port}`, origin: 'http://evil.example', 'content-type': 'application/json' }, '{}')).toBe(403);
    expect(await raw('POST', '/api/threads', { host: `localhost:${port}`, 'content-type': 'text/plain' }, '{}')).toBe(415);
    expect(await raw('POST', '/api/threads', { host: `localhost:${port}`, origin: `http://localhost:5173`, 'content-type': 'application/json' }, '{}')).toBe(200);
    expect(await raw('GET', '/api/threads', { host: 'localhost:5173' })).toBe(200);
  });
});

