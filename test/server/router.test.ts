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
  const paths = makePaths(await mkdtemp(join(tmpdir(), 'consensus-')));
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

  it('adds the original request and the text the reply was responding to', () => {
    expect(composeOutgoing('Rewrite it', [{ messageId: 'r2', text: 'Too vague' }], {
      originalRequest: 'Write a headline',
      contexts: ['Kitchens that run themselves'],
    })).toBe(
      'Original request:\n<request>\nWrite a headline\n</request>\n\n' +
        'Text another reviewer was responding to:\n<context>\nKitchens that run themselves\n</context>\n\n' +
        'Feedback from another reviewer:\n<quoted>\nToo vague\n</quoted>\n\n' +
        'Rewrite it',
    );
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
    const paths = makePaths(await mkdtemp(join(tmpdir(), 'consensus-')));
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

describe('Router participant numbering', () => {
  it('numbers participants per provider in creation order', async () => {
    const t = await router.createThread();
    const a = await router.addParticipant(t.id, { provider: 'claude', model: 'opus' });
    const b = await router.addParticipant(t.id, { provider: 'codex', model: 'gpt-6-luna' });
    const c = await router.addParticipant(t.id, { provider: 'claude', model: 'opus' });
    expect([a.ordinal, b.ordinal, c.ordinal]).toEqual([1, 1, 2]);
  });
});

describe('Router forwarding context', () => {
  async function reply(c: ReturnType<typeof controllable>, done: Promise<void>, text: string) {
    c.last().push({ type: 'done', text });
    c.last().end();
    await done;
  }

  async function chain() {
    const gemini = controllable('gemini');
    router = new Router({
      store, hub, paths: makePaths(await mkdtemp(join(tmpdir(), 'consensus-'))),
      adapters: { claude: claude.adapter, codex: codex.adapter, gemini: gemini.adapter },
    });
    const t = await router.createThread();
    const a = await router.addParticipant(t.id, { provider: 'claude', model: 'opus' });
    const b = await router.addParticipant(t.id, { provider: 'codex', model: 'gpt-6-luna' });
    const c = await router.addParticipant(t.id, { provider: 'gemini', model: 'gemini-3.1-pro-high' });
    const s1 = await router.send(t.id, { to: a.id, text: 'Write a headline' });
    await reply(claude, s1.done, 'Kitchens that run themselves');
    const s2 = await router.send(t.id, { to: b.id, text: 'What do you think?', quotes: [{ messageId: s1.replyMessageId, text: 'Kitchens that run themselves' }] });
    await reply(codex, s2.done, 'Too vague');
    return { t, a, b, c, gemini, s1, s2 };
  }

  it('forwards a direct reply with its original request and no context block', async () => {
    const { t, b, s1 } = await chain();
    await router.send(t.id, { to: b.id, text: 'Again', quotes: [{ messageId: s1.replyMessageId, text: 'Kitchens' }] }).catch(() => {});
    expect(codex.requests[0].message).toBe(
      'Original request:\n<request>\nWrite a headline\n</request>\n\n' +
        'Feedback from another reviewer:\n<quoted>\nKitchens that run themselves\n</quoted>\n\n' +
        'What do you think?',
    );
  });

  it('forwards a reply to a forward with the root request and what it responded to', async () => {
    const { t, c, gemini, s2 } = await chain();
    await router.send(t.id, { to: c.id, text: 'Rewrite with that in mind', quotes: [{ messageId: s2.replyMessageId, text: 'Too vague' }] });
    expect(gemini.requests[0].message).toBe(
      'Original request:\n<request>\nWrite a headline\n</request>\n\n' +
        'Text another reviewer was responding to:\n<context>\nKitchens that run themselves\n</context>\n\n' +
        'Feedback from another reviewer:\n<quoted>\nToo vague\n</quoted>\n\n' +
        'Rewrite with that in mind',
    );
  });

  it('follows a long chain back to the first request without including middle opinions', async () => {
    const { t, a, c, gemini, s2 } = await chain();
    const s3 = await router.send(t.id, { to: c.id, text: 'Rewrite', quotes: [{ messageId: s2.replyMessageId, text: 'Too vague' }] });
    await reply(gemini, s3.done, 'Run every kitchen from one recipe');
    await router.send(t.id, { to: a.id, text: 'Thoughts?', quotes: [{ messageId: s3.replyMessageId, text: 'Run every kitchen from one recipe' }] });
    const sent = claude.requests.at(-1)!.message;
    expect(sent).toContain('<request>\nWrite a headline\n</request>');
    expect(sent).toContain('<context>\nToo vague\n</context>');
    expect(sent).toContain('<quoted>\nRun every kitchen from one recipe\n</quoted>');
    expect(sent).not.toContain('Kitchens that run themselves');
  });

  it('falls back to the bare quote when its source is unknown', async () => {
    const { t, b } = await threadWithTwo();
    await router.send(t.id, { to: b.id, text: 'Hm', quotes: [{ messageId: 'gone', text: 'Old text' }] });
    expect(codex.requests[0].message).toBe('Feedback from another reviewer:\n<quoted>\nOld text\n</quoted>\n\nHm');
  });
});

describe('Router rename', () => {
  it('renames a thread, trimming whitespace', async () => {
    const t = await router.createThread();
    await router.renameThread(t.id, '  Homepage hero  ');
    expect((await router.getThread(t.id))!.title).toBe('Homepage hero');
    expect((await store.get(t.id))!.title).toBe('Homepage hero');
  });

  it('keeps a chosen name when the first message is sent', async () => {
    const { t, a } = await threadWithTwo();
    await router.renameThread(t.id, 'Pricing page');
    await router.send(t.id, { to: a.id, text: 'Draft something' });
    expect((await router.getThread(t.id))!.title).toBe('Pricing page');
  });

  it('rejects empty or overlong names', async () => {
    const t = await router.createThread();
    await expect(router.renameThread(t.id, '   ')).rejects.toMatchObject({ code: 'invalid' });
    await expect(router.renameThread(t.id, 'x'.repeat(121))).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('Router attachments', () => {
  it('inlines document text before the message and passes images', async () => {
    const { t, a } = await threadWithTwo();
    const doc = await router.attachments.save(t.id, 'brief.md', Buffer.from('Audience: CFOs'));
    const img = await router.attachments.save(t.id, 'shot.png', Buffer.from([1, 2, 3]));
    await router.send(t.id, { to: a.id, text: 'Draft a headline', attachmentIds: [doc.id, img.id] });
    expect(claude.requests[0].message).toBe('<attachment name="brief.md">\nAudience: CFOs\n</attachment>\n\nDraft a headline');
    expect(claude.requests[0].images).toEqual([
      { id: img.id, name: 'shot.png', mime: 'image/png', path: router.attachments.filePath(t.id, img), threadId: t.id },
    ]);
    const sent = (await router.getThread(t.id))!.messages[0];
    expect(sent.kind === 'user' && sent.attachments?.map((x) => x.name)).toEqual(['brief.md', 'shot.png']);
  });

  it('notes when a document was cut', async () => {
    const { t, a } = await threadWithTwo();
    const doc = await router.attachments.save(t.id, 'long.txt', Buffer.from('a'.repeat(100_010)));
    await router.send(t.id, { to: a.id, text: 'Summarize', attachmentIds: [doc.id] });
    expect(claude.requests[0].message).toContain('\n[Truncated: only the first 100,000 characters are included.]\n</attachment>');
  });

  it('sends attachments with no text and refuses unknown or too many', async () => {
    const { t, a, b } = await threadWithTwo();
    const doc = await router.attachments.save(t.id, 'brief.md', Buffer.from('Brief'));
    await expect(router.send(t.id, { to: a.id, text: '', attachmentIds: [doc.id] })).resolves.toBeDefined();
    expect(claude.requests[0].message).toBe('<attachment name="brief.md">\nBrief\n</attachment>');
    await expect(router.send(t.id, { to: b.id, text: 'x', attachmentIds: ['missing'] })).rejects.toMatchObject({ code: 'invalid' });
    await expect(router.send(t.id, { to: b.id, text: 'x', attachmentIds: Array(11).fill(doc.id) })).rejects.toMatchObject({ code: 'invalid' });
  });

  it("forwards the original request's attachments, not later ones", async () => {
    const { t, a, b } = await threadWithTwo();
    const brief = await router.attachments.save(t.id, 'brief.md', Buffer.from('Audience: CFOs'));
    const logo = await router.attachments.save(t.id, 'logo.png', Buffer.from([1]));
    const s1 = await router.send(t.id, { to: a.id, text: 'Write a headline', attachmentIds: [brief.id, logo.id] });
    claude.last().push({ type: 'done', text: 'Kitchens that run themselves' });
    claude.last().end();
    await s1.done;
    await router.send(t.id, { to: b.id, text: 'Critique', quotes: [{ messageId: s1.replyMessageId, text: 'Kitchens that run themselves' }] });
    expect(codex.requests[0].message).toBe(
      'Original request:\n<request>\nWrite a headline\n</request>\n\n' +
        '<attachment name="brief.md">\nAudience: CFOs\n</attachment>\n\n' +
        'Feedback from another reviewer:\n<quoted>\nKitchens that run themselves\n</quoted>\n\n' +
        'Critique',
    );
    expect(codex.requests[0].images?.map((i) => i.id)).toEqual([logo.id]);
  });

  it('resends attachments on retry from a fresh router', async () => {
    const { t, a } = await threadWithTwo();
    const doc = await router.attachments.save(t.id, 'brief.md', Buffer.from('Brief'));
    const s1 = await router.send(t.id, { to: a.id, text: 'Go', attachmentIds: [doc.id] });
    claude.last().push({ type: 'error', error: { code: 'unknown', message: 'x' } });
    claude.last().end();
    await s1.done;
    const fresh = new Router({ store, hub, paths: (router as any).deps.paths, adapters: { claude: claude.adapter, codex: codex.adapter, gemini: controllable('gemini').adapter } });
    await fresh.retry(t.id, s1.replyMessageId);
    expect(claude.requests.at(-1)!.message).toBe(claude.requests[0].message);
  });

  it('deletes a thread mid-reply without it coming back', async () => {
    const { t, a } = await threadWithTwo();
    await router.attachments.save(t.id, 'brief.md', Buffer.from('Brief'));
    const s1 = await router.send(t.id, { to: a.id, text: 'Long one' });
    claude.last().push({ type: 'delta', text: 'Partial' });
    await flush();
    await router.deleteThread(t.id);
    await s1.done;
    expect(await store.get(t.id)).toBeUndefined();
    expect(await router.getThread(t.id)).toBeUndefined();
    expect((await store.list()).map((s) => s.id)).not.toContain(t.id);
  });
});

describe('Router send races', () => {
  it('lets only one of two simultaneous sends to a participant through', async () => {
    const { t, a } = await threadWithTwo();
    const results = await Promise.allSettled([
      router.send(t.id, { to: a.id, text: 'One' }),
      router.send(t.id, { to: a.id, text: 'Two' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'busy' } });
    expect(claude.requests).toHaveLength(1);
  });

  it('abandons a send whose thread is deleted while it is being prepared', async () => {
    const { t, a } = await threadWithTwo();
    const doc = await router.attachments.save(t.id, 'brief.md', Buffer.from('Brief'));
    const pending = router.send(t.id, { to: a.id, text: 'Go', attachmentIds: [doc.id] });
    await router.deleteThread(t.id);
    await expect(pending).rejects.toMatchObject({ code: 'not_found' });
    expect(claude.requests).toHaveLength(0);
  });

  it('frees the participant when preparing a send fails', async () => {
    const { t, a } = await threadWithTwo();
    await expect(router.send(t.id, { to: a.id, text: 'x', attachmentIds: ['missing'] })).rejects.toMatchObject({ code: 'invalid' });
    await expect(router.send(t.id, { to: a.id, text: 'Now works' })).resolves.toBeDefined();
  });
});

describe('Router web activity', () => {
  it('saves opened pages once each and streams activity without saving it', async () => {
    const { t, a } = await threadWithTwo();
    const events: ThreadEvent[] = [];
    hub.subscribe(t.id, (e) => events.push(e));
    const { replyMessageId, done } = await router.send(t.id, { to: a.id, text: 'Check nodejs.org' });
    const q = claude.last();
    q.push({ type: 'activity', text: 'Reading nodejs.org' });
    q.push({ type: 'source', url: 'https://nodejs.org/en' });
    q.push({ type: 'source', url: 'https://nodejs.org/en' });
    q.push({ type: 'source', url: 'https://github.com/nodejs/Release' });
    q.push({ type: 'done', text: 'v24' });
    q.end();
    await done;
    expect(events).toContainEqual({ type: 'activity', messageId: replyMessageId, text: 'Reading nodejs.org' });
    const saved = (await store.get(t.id))!.messages.find((m) => m.id === replyMessageId);
    expect(saved).toMatchObject({ status: 'done', sources: ['https://nodejs.org/en', 'https://github.com/nodejs/Release'] });
    expect(JSON.stringify(saved)).not.toContain('Reading nodejs.org');
  });
});
