import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AdapterEvent, ProviderAdapter, SendRequest } from '../../src/server/adapters/types.js';
import { EventHub } from '../../src/server/hub.js';
import { makePaths } from '../../src/server/paths.js';
import { composeOutgoing, Router, RouterError } from '../../src/server/router.js';
import { ThreadStore } from '../../src/server/store.js';
import type { ProviderId, ThreadEvent } from '../../src/shared/types.js';
import { AsyncQueue } from '../helpers/queue.js';

function controllable(id: ProviderId) {
  const requests: SendRequest[] = [];
  const queues: AsyncQueue<AdapterEvent>[] = [];
  const adapter: ProviderAdapter = {
    id,
    listModels: async () => [],
    send(req) {
      requests.push(req);
      const q = new AsyncQueue<AdapterEvent>();
      req.signal.addEventListener('abort', () => q.end());
      queues.push(q);
      return q;
    },
  };
  return { adapter, requests, last: () => queues.at(-1)! };
}

let claude: ReturnType<typeof controllable>;
let codex: ReturnType<typeof controllable>;
let router: Router;
let store: ThreadStore;
let hub: EventHub;

beforeEach(async () => {
  const paths = makePaths(await mkdtemp(join(tmpdir(), 'relay-')));
  claude = controllable('claude');
  codex = controllable('codex');
  store = new ThreadStore(paths.threads);
  hub = new EventHub();
  router = new Router({
    store, hub, paths,
    adapters: { claude: claude.adapter, codex: codex.adapter, gemini: controllable('gemini').adapter },
  });
});

async function threadWithTwo() {
  const t = await router.createThread();
  const a = await router.addParticipant(t.id, { provider: 'claude', model: 'opus', effort: 'high' });
  const b = await router.addParticipant(t.id, { provider: 'codex', model: 'gpt-6-luna', effort: 'high' });
  return { t, a, b };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('composeOutgoing', () => {
  it('returns the text alone when nothing is quoted', () => {
    expect(composeOutgoing('Tighten it', [])).toBe('Tighten it');
  });

  it('wraps each quote without naming its source', () => {
    expect(composeOutgoing('Critique these', [{ messageId: 'm1', text: 'Option A' }, { messageId: 'm2', text: 'Option B' }])).toBe(
      'Feedback from another reviewer:\n<quoted>\nOption A\n</quoted>\n\n' +
        'Feedback from another reviewer:\n<quoted>\nOption B\n</quoted>\n\n' +
        'Critique these',
    );
  });
});

describe('Router', () => {
  it('sends only to the chosen participant with its model and effort', async () => {
    const { t, b } = await threadWithTwo();
    await router.send(t.id, { to: b.id, text: 'Critique', quotes: [{ messageId: 'x', text: 'Draft' }] });
    expect(claude.requests).toHaveLength(0);
    expect(codex.requests).toHaveLength(1);
    expect(codex.requests[0]).toMatchObject({
      model: 'gpt-6-luna', effort: 'high', sessionId: undefined,
      message: composeOutgoing('Critique', [{ messageId: 'x', text: 'Draft' }]),
    });
    expect(codex.requests[0].promptPath).toContain(b.promptHash);
  });

  it('streams deltas through the hub and records the finished reply', async () => {
    const { t, a } = await threadWithTwo();
    const events: ThreadEvent[] = [];
    hub.subscribe(t.id, (e) => events.push(e));
    const { replyMessageId, done } = await router.send(t.id, { to: a.id, text: 'Draft a headline' });
    const q = claude.last();
    q.push({ type: 'session', sessionId: 's1' });
    q.push({ type: 'delta', text: 'Kitchens ' });
    q.push({ type: 'delta', text: 'that run themselves' });
    q.push({ type: 'done', text: 'Kitchens that run themselves' });
    q.end();
    await done;
    expect(events.filter((e) => e.type === 'delta').map((e) => e.type === 'delta' && e.text)).toEqual(['Kitchens ', 'that run themselves']);
    const thread = (await router.getThread(t.id))!;
    const reply = thread.messages.find((m) => m.id === replyMessageId)!;
    expect(reply).toMatchObject({ kind: 'reply', status: 'done', text: 'Kitchens that run themselves', model: 'opus' });
    expect(thread.participants.find((p) => p.id === a.id)!.sessionId).toBe('s1');
    expect((await store.get(t.id))!.messages.find((m) => m.id === replyMessageId)).toMatchObject({ status: 'done' });
  });

  it('resumes from the last completed session', async () => {
    const { t, a } = await threadWithTwo();
    const first = await router.send(t.id, { to: a.id, text: 'One' });
    claude.last().push({ type: 'session', sessionId: 's1' });
    claude.last().push({ type: 'done', text: 'ok' });
    claude.last().end();
    await first.done;
    await router.send(t.id, { to: a.id, text: 'Two' });
    expect(claude.requests[1].sessionId).toBe('s1');
  });

  it('rejects a second send to a busy participant', async () => {
    const { t, a, b } = await threadWithTwo();
    await router.send(t.id, { to: a.id, text: 'One' });
    await expect(router.send(t.id, { to: a.id, text: 'Two' })).rejects.toMatchObject({ code: 'busy', message: 'That participant is still replying.' });
    await expect(router.send(t.id, { to: b.id, text: 'Other' })).resolves.toBeDefined();
  });

  it('stops a reply, keeps its text and leaves the session unchanged', async () => {
    const { t, a } = await threadWithTwo();
    const { replyMessageId, done } = await router.send(t.id, { to: a.id, text: 'Long essay' });
    claude.last().push({ type: 'session', sessionId: 'fork-discarded' });
    claude.last().push({ type: 'delta', text: 'Partial' });
    await flush();
    expect(router.stop(t.id, replyMessageId)).toBe(true);
    await done;
    const thread = (await router.getThread(t.id))!;
    expect(thread.messages.find((m) => m.id === replyMessageId)).toMatchObject({ status: 'stopped', text: 'Partial' });
    expect(thread.participants.find((p) => p.id === a.id)!.sessionId).toBeUndefined();
    await expect(router.send(t.id, { to: a.id, text: 'Again' })).resolves.toBeDefined();
  });

  it('ignores stop after a reply finished', async () => {
    const { t, a } = await threadWithTwo();
    const { replyMessageId, done } = await router.send(t.id, { to: a.id, text: 'Hi' });
    claude.last().push({ type: 'done', text: 'Hello' });
    claude.last().end();
    await done;
    expect(router.stop(t.id, replyMessageId)).toBe(false);
    expect((await router.getThread(t.id))!.messages.find((m) => m.id === replyMessageId)).toMatchObject({ status: 'done' });
  });

  it('records adapter errors without advancing the session', async () => {
    const { t, a } = await threadWithTwo();
    const { replyMessageId, done } = await router.send(t.id, { to: a.id, text: 'Hi' });
    claude.last().push({ type: 'session', sessionId: 'never-kept' });
    claude.last().push({ type: 'error', error: { code: 'not_logged_in', message: 'Claude Code is not signed in.', fix: 'claude, then run /login' } });
    claude.last().end();
    await done;
    const thread = (await router.getThread(t.id))!;
    expect(thread.messages.find((m) => m.id === replyMessageId)).toMatchObject({ status: 'error', error: { code: 'not_logged_in' } });
    expect(thread.participants[0].sessionId).toBeUndefined();
  });

  it('retries a failed reply with the same message', async () => {
    const { t, a } = await threadWithTwo();
    const first = await router.send(t.id, { to: a.id, text: 'Hi', quotes: [{ messageId: 'q', text: 'Quoted' }] });
    claude.last().push({ type: 'error', error: { code: 'unknown', message: 'x' } });
    claude.last().end();
    await first.done;
    await router.retry(t.id, first.replyMessageId);
    expect(claude.requests[1].message).toBe(claude.requests[0].message);
  });

  it('changes a participant model and marks the switch in the timeline', async () => {
    const { t, a } = await threadWithTwo();
    await router.changeModel(t.id, a.id, { model: 'sonnet', effort: 'medium' });
    const thread = (await router.getThread(t.id))!;
    expect(thread.messages.at(-1)).toMatchObject({ kind: 'model_change', participant: a.id, from: 'opus high', to: 'sonnet medium' });
    await router.send(t.id, { to: a.id, text: 'Go' });
    expect(claude.requests[0]).toMatchObject({ model: 'sonnet', effort: 'medium' });
  });

  it('refuses a model change while the participant is replying', async () => {
    const { t, a } = await threadWithTwo();
    await router.send(t.id, { to: a.id, text: 'Go' });
    await expect(router.changeModel(t.id, a.id, { model: 'sonnet' })).rejects.toMatchObject({ code: 'busy' });
  });

  it('titles the thread from the first message', async () => {
    const { t, a } = await threadWithTwo();
    await router.send(t.id, { to: a.id, text: 'Homepage hero for ops leaders\nMore detail here' });
    expect((await router.getThread(t.id))!.title).toBe('Homepage hero for ops leaders');
  });

  it('rejects empty messages and unknown participants', async () => {
    const { t, a } = await threadWithTwo();
    await expect(router.send(t.id, { to: a.id, text: '   ' })).rejects.toBeInstanceOf(RouterError);
    await expect(router.send(t.id, { to: 'nobody', text: 'Hi' })).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('Router when saving fails', () => {
  class FlakyStore extends ThreadStore {
    failNext = 0;
    override async save(thread: Parameters<ThreadStore['save']>[0]) {
      if (this.failNext > 0) { this.failNext--; throw new Error('disk full'); }
      return super.save(thread);
    }
  }

  async function setup() {
    const paths = makePaths(await mkdtemp(join(tmpdir(), 'relay-')));
    const flaky = new FlakyStore(paths.threads);
    const c = controllable('claude');
    const r = new Router({ store: flaky, hub: new EventHub(), paths, adapters: { claude: c.adapter, codex: controllable('codex').adapter, gemini: controllable('gemini').adapter } });
    const t = await r.createThread();
    const p = await r.addParticipant(t.id, { provider: 'claude', model: 'opus' });
    return { flaky, c, r, t, p };
  }

  it('does not reject done when the final save fails, and frees the participant', async () => {
    const { flaky, c, r, t, p } = await setup();
    const { done } = await r.send(t.id, { to: p.id, text: 'Hi' });
    flaky.failNext = 1;
    c.last().push({ type: 'done', text: 'Hello' });
    c.last().end();
    await expect(done).resolves.toBeUndefined();
    await expect(r.send(t.id, { to: p.id, text: 'Again' })).resolves.toBeDefined();
  });

  it('rolls back a send whose first save fails', async () => {
    const { flaky, c, r, t, p } = await setup();
    flaky.failNext = 1;
    await expect(r.send(t.id, { to: p.id, text: 'Hi' })).rejects.toThrow('disk full');
    expect(c.requests).toHaveLength(0);
    expect((await r.getThread(t.id))!.messages).toHaveLength(0);
    await expect(r.send(t.id, { to: p.id, text: 'Again' })).resolves.toBeDefined();
  });
});
