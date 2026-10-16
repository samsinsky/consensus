import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AdapterEvent, ProviderAdapter, SendRequest } from '../../src/server/adapters/types.js';
import { createConsensusServer } from '../../src/server/http.js';
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
  const home = await mkdtemp(join(tmpdir(), 'consensus-'));
  const paths = makePaths(home);
  webDir = join(home, 'web');
  await mkdir(webDir);
  await writeFile(join(webDir, 'index.html'), '<!doctype html><title>Consensus</title>');
  queues = [];
  const store = new ThreadStore(paths.threads);
  const hub = new EventHub();
  const adapters = { claude: fakeAdapter('claude'), codex: fakeAdapter('codex'), gemini: fakeAdapter('gemini') };
  const router = new Router({ store, hub, paths, adapters });
  server = createConsensusServer({ router, store, hub, paths, adapters, webDir });
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
    expect(await index.text()).toContain('<title>Consensus</title>');
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
  it('renames a thread over PATCH', async () => {
    const thread = (await api('POST', '/api/threads', {})).body as Thread;
    expect((await api('PATCH', `/api/threads/${thread.id}`, { title: 'Launch email' })).status).toBe(204);
    expect((await api('GET', `/api/threads/${thread.id}`)).body.title).toBe('Launch email');
    expect((await api('PATCH', `/api/threads/${thread.id}`, { title: '' })).status).toBe(400);
  });
  const upload = (threadId: string, name: string, body: Buffer, headers: Record<string, string> = { 'x-consensus-upload': '1' }) =>
    fetch(`${base}/api/threads/${threadId}/attachments`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent(name), ...headers },
      body: new Uint8Array(body),
    });

  it('uploads a file and serves images back', async () => {
    const thread = (await api('POST', '/api/threads', {})).body as Thread;
    const res = await upload(thread.id, 'shot.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(res.status).toBe(200);
    const att = await res.json();
    expect(att).toMatchObject({ name: 'shot.png', kind: 'image' });
    const img = await fetch(`${base}/api/threads/${thread.id}/attachments/${att.id}`);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(img.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await img.arrayBuffer())).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it('rejects uploads without the upload header', async () => {
    const thread = (await api('POST', '/api/threads', {})).body as Thread;
    expect((await upload(thread.id, 'a.txt', Buffer.from('a'), {})).status).toBe(415);
    expect((await upload(thread.id, 'a.txt', Buffer.from('a'), { 'x-consensus-upload': '0' })).status).toBe(415);
  });

  it('reports unsupported and empty files with their reason', async () => {
    const thread = (await api('POST', '/api/threads', {})).body as Thread;
    const bad = await upload(thread.id, 'run.exe', Buffer.from('x'));
    expect(bad.status).toBe(415);
    expect((await bad.json()).error).toContain("Consensus can't read .exe");
  });

  it('serves images only', async () => {
    const thread = (await api('POST', '/api/threads', {})).body as Thread;
    const att = await (await upload(thread.id, 'page.html', Buffer.from('<script>alert(1)</script>'))).json();
    expect((await fetch(`${base}/api/threads/${thread.id}/attachments/${att.id}`)).status).toBe(404);
  });

  it('deletes a thread with its files', async () => {
    const thread = (await api('POST', '/api/threads', {})).body as Thread;
    const att = await (await upload(thread.id, 'shot.png', Buffer.from([1, 2]))).json();
    expect((await api('DELETE', `/api/threads/${thread.id}`)).status).toBe(204);
    expect((await api('GET', `/api/threads/${thread.id}`)).status).toBe(404);
    expect((await fetch(`${base}/api/threads/${thread.id}/attachments/${att.id}`)).status).toBe(404);
    expect((await api('GET', '/api/threads')).body).toEqual([]);
  });
});


describe('doc routes', () => {
  const block = (o: unknown) => '```json\n' + JSON.stringify(o) + '\n```';

  it('creates a doc, saves it, runs a round, and settles a proposal', async () => {
    const created = await api('POST', '/api/threads', { kind: 'doc', brief: 'Bio', markdown: 'I have gone deep on LLMs.' });
    expect(created.status).toBe(200);
    const id = created.body.id as string;
    expect(created.body.kind).toBe('doc');
    const p = (await api('POST', `/api/threads/${id}/participants`, { provider: 'claude', model: 'claude-model' })).body;

    expect((await api('PUT', `/api/threads/${id}/doc`, { revision: 0, markdown: 'I have gone deep on LLMs. Really.' })).status).toBe(204);
    expect((await api('PUT', `/api/threads/${id}/doc`, { revision: 5, markdown: 'stale' })).status).toBe(409);

    const started = await api('POST', `/api/threads/${id}/rounds`);
    expect(started).toEqual({ status: 202, body: { round: 1 } });
    expect((await api('POST', `/api/threads/${id}/rounds`)).status).toBe(409);
    queues.at(-1)!.push({ type: 'done', text: block({ proposals: [{ quote: 'gone deep on', replacement: 'studied', reason: 'Plainer.' }], note: 'Good.' }) });
    queues.at(-1)!.end();
    let thread: Thread;
    for (let i = 0; i < 50; i++) {
      thread = (await api('GET', `/api/threads/${id}`)).body;
      if (thread.doc!.rounds[0].notes[p.id].status !== 'running') break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(thread!.doc!.proposals[0]).toMatchObject({ id: 'P1', quote: 'gone deep on' });

    expect((await api('POST', `/api/threads/${id}/proposals/P1/replies`, { text: 'Hm.' })).status).toBe(204);
    expect((await api('PATCH', `/api/threads/${id}/proposals/P1`, { rebased: [{ id: 'P2', quote: 7 }] })).status).toBe(400);
    expect((await api('PATCH', `/api/threads/${id}/proposals/P1`, { superseded: 'P2' })).status).toBe(400);
    expect((await api('PATCH', `/api/threads/${id}/proposals/P1`, { status: 'accepted', replacement: 'studied hard' })).status).toBe(204);
    expect((await api('PATCH', `/api/threads/${id}/proposals/P1`, { status: 'maybe' })).status).toBe(400);
    expect((await api('POST', `/api/threads/${id}/restore`, { round: 1 })).status).toBe(204);
    const after = (await api('GET', `/api/threads/${id}`)).body as Thread;
    expect(after.doc!.proposals[0]).toMatchObject({ status: 'accepted', replacement: 'studied hard', replies: [{ from: 'user', text: 'Hm.' }] });
    expect(after.doc!.revision).toBe(1);
  });

  it('toggles inclusion, removes participants, and stops a round', async () => {
    const id = (await api('POST', '/api/threads', { kind: 'doc', markdown: 'Text.' })).body.id as string;
    const a = (await api('POST', `/api/threads/${id}/participants`, { provider: 'claude', model: 'claude-model' })).body;
    const b = (await api('POST', `/api/threads/${id}/participants`, { provider: 'codex', model: 'codex-model' })).body;
    expect((await api('PATCH', `/api/threads/${id}/participants/${b.id}`, { included: false })).status).toBe(204);
    expect((await api('DELETE', `/api/threads/${id}/participants/${b.id}`)).status).toBe(204);
    expect((await api('POST', `/api/threads/${id}/rounds/stop`)).status).toBe(404);
    await api('POST', `/api/threads/${id}/rounds`);
    expect((await api('POST', `/api/threads/${id}/rounds/stop`)).status).toBe(204);
    let thread: Thread;
    for (let i = 0; i < 50; i++) {
      thread = (await api('GET', `/api/threads/${id}`)).body;
      if (thread.doc!.rounds[0].notes[a.id].status !== 'running') break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(thread!.participants.map((x) => x.id)).toEqual([a.id]);
    expect(thread!.doc!.rounds[0].notes[a.id].status).toBe('stopped');
    // The note is saved as 'stopped' just before the round is released, so wait out that brief 409.
    let retry = 409;
    for (let i = 0; i < 50 && retry === 409; i++) {
      retry = (await api('POST', `/api/threads/${id}/participants/${a.id}/retry-review`)).status;
      if (retry === 409) await new Promise((r) => setTimeout(r, 10));
    }
    expect(retry).toBe(202);
  });

  it('opens a chat reply as a doc and refuses chat sends to a doc', async () => {
    const chat = (await api('POST', '/api/threads')).body.id as string;
    const p = (await api('POST', `/api/threads/${chat}/participants`, { provider: 'claude', model: 'claude-model' })).body;
    const sent = (await api('POST', `/api/threads/${chat}/messages`, { to: p.id, text: 'Draft a bio' })).body;
    queues.at(-1)!.push({ type: 'done', text: 'A draft.' });
    queues.at(-1)!.end();
    for (let i = 0; i < 50; i++) {
      const t = (await api('GET', `/api/threads/${chat}`)).body as Thread;
      if (t.messages.some((m) => m.kind === 'reply' && m.status === 'done')) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const doc = await api('POST', `/api/threads/${chat}/open-as-doc`, { replyId: sent.replyMessageId });
    expect(doc.status).toBe(200);
    expect(doc.body.doc).toMatchObject({ brief: 'Draft a bio', markdown: 'A draft.' });
    const dp = doc.body.participants[0].id;
    expect((await api('POST', `/api/threads/${doc.body.id}/messages`, { to: dp, text: 'Hi' })).status).toBe(400);
  });
});
