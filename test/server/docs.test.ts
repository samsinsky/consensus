import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { DocService } from '../../src/server/docs.js';
import { EventHub } from '../../src/server/hub.js';
import { makePaths } from '../../src/server/paths.js';
import { Router } from '../../src/server/router.js';
import { ThreadStore } from '../../src/server/store.js';
import { controllable } from '../helpers/controllable.js';

let claude: ReturnType<typeof controllable>;
let codex: ReturnType<typeof controllable>;
let router: Router;
let docs: DocService;
let store: ThreadStore;

beforeEach(async () => {
  const paths = makePaths(await mkdtemp(join(tmpdir(), 'consensus-')));
  claude = controllable('claude');
  codex = controllable('codex');
  store = new ThreadStore(paths.threads);
  router = new Router({ store, hub: new EventHub(), paths, adapters: { claude: claude.adapter, codex: codex.adapter, gemini: controllable('gemini').adapter } });
  docs = new DocService(router);
});

async function docWithTwo(markdown = 'I have gone deep on LLMs.') {
  const t = await docs.create({ brief: 'LinkedIn bio\nfor PM roles', markdown });
  const a = await router.addParticipant(t.id, { provider: 'claude', model: 'opus', effort: 'high' });
  const b = await router.addParticipant(t.id, { provider: 'codex', model: 'terra', effort: 'high' });
  return { t: (await router.getThread(t.id))!, a, b };
}

describe('DocService basics', () => {
  it('creates a doc thread titled from the brief, and new participants start included', async () => {
    const { t, a, b } = await docWithTwo();
    expect(t.kind).toBe('doc');
    expect(t.title).toBe('LinkedIn bio');
    expect(t.doc).toMatchObject({ brief: 'LinkedIn bio\nfor PM roles', markdown: 'I have gone deep on LLMs.', revision: 0, included: [a.id, b.id], rounds: [], proposals: [], nextProposal: 1 });
    expect((await store.get(t.id))!.kind).toBe('doc');
  });

  it('saves text and brief, and titles an untitled doc from the brief', async () => {
    const t = await docs.create();
    expect(t.title).toBe('Untitled thread');
    await docs.saveDoc(t.id, { revision: 0, markdown: 'New text', brief: 'Pricing page hero' });
    const saved = (await router.getThread(t.id))!;
    expect(saved.doc!.markdown).toBe('New text');
    expect(saved.title).toBe('Pricing page hero');
  });

  it('refuses a save from an older revision', async () => {
    const { t } = await docWithTwo();
    t.doc!.rounds.push({ n: 1, sentAt: '', snapshot: 'Round one text', participants: [], notes: {} });
    await docs.saveDoc(t.id, { revision: 0, markdown: 'Edited' });
    await docs.restore(t.id, 1);
    await expect(docs.saveDoc(t.id, { revision: 0, markdown: 'Late autosave' })).rejects.toMatchObject({ code: 'busy' });
    const after = (await router.getThread(t.id))!.doc!;
    expect(after.markdown).toBe('Round one text');
    expect(after.revision).toBe(1);
    await expect(docs.restore(t.id, 7)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('toggles who is included', async () => {
    const { t, a } = await docWithTwo();
    await docs.setIncluded(t.id, a.id, false);
    expect((await router.getThread(t.id))!.doc!.included).not.toContain(a.id);
    await docs.setIncluded(t.id, a.id, true);
    await docs.setIncluded(t.id, a.id, true);
    expect((await router.getThread(t.id))!.doc!.included.filter((id) => id === a.id)).toHaveLength(1);
    await expect(docs.setIncluded(t.id, 'nope', true)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('accepts a proposal, marks the rest of its group not chosen, and records when', async () => {
    const { t, a, b } = await docWithTwo();
    const base = { round: 1, quote: 'gone deep on', prefix: '', suffix: '', reason: 'r', status: 'open' as const, replies: [] };
    t.doc!.proposals.push({ ...base, id: 'P1', authors: [a.id], replacement: 'gained' }, { ...base, id: 'P2', authors: [b.id], replacement: 'built' });
    await docs.updateProposal(t.id, 'P1', { status: 'accepted', replacement: 'gained hands-on', notChosen: ['P2'] });
    const [p1, p2] = (await router.getThread(t.id))!.doc!.proposals;
    expect(p1).toMatchObject({ status: 'accepted', replacement: 'gained hands-on' });
    expect(p1.resolvedAt).toBeTruthy();
    expect(p2).toMatchObject({ status: 'not_chosen' });
    await expect(docs.updateProposal(t.id, 'P1', { status: 'rejected' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(docs.updateProposal(t.id, 'P9', { status: 'rejected' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('on accept, supersedes suggestions the change replaced and moves the rest onto the new text', async () => {
    const { t, a, b } = await docWithTwo();
    const base = { round: 1, prefix: '', suffix: '', reason: 'r', status: 'open' as const, replies: [] };
    t.doc!.proposals.push(
      { ...base, id: 'P1', authors: [a.id], quote: 'I think', replacement: 'We think' },
      { ...base, id: 'P2', authors: [b.id], quote: 'I think that birds can fly', replacement: 'Birds fly' },
      { ...base, id: 'P3', authors: [b.id], quote: 'I think that birds', replacement: 'I think that penguins' },
    );
    await docs.updateProposal(t.id, 'P1', {
      status: 'accepted',
      superseded: ['P2'],
      rebased: [{ id: 'P3', quote: 'We think that birds', replacement: 'We think that penguins', prefix: '', suffix: ' can fly' }],
    });
    const [, p2, p3] = (await router.getThread(t.id))!.doc!.proposals;
    expect(p2).toMatchObject({ status: 'superseded' });
    expect(p2.resolvedAt).toBeTruthy();
    expect(p3).toMatchObject({ status: 'open', quote: 'We think that birds', replacement: 'We think that penguins', suffix: ' can fly' });
  });

  it('keeps an edited replacement on an open proposal', async () => {
    const { t, a } = await docWithTwo();
    t.doc!.proposals.push({ id: 'P1', round: 1, authors: [a.id], quote: 'q', prefix: '', suffix: '', replacement: 'r', reason: 'x', status: 'open', replies: [] });
    await docs.updateProposal(t.id, 'P1', { replacement: 'mine' });
    expect((await router.getThread(t.id))!.doc!.proposals[0]).toMatchObject({ status: 'open', replacement: 'mine' });
  });

  it('records my replies', async () => {
    const { t, a } = await docWithTwo();
    t.doc!.proposals.push({ id: 'P1', round: 1, authors: [a.id], quote: 'q', prefix: '', suffix: '', replacement: 'r', reason: 'x', status: 'open', replies: [] });
    await docs.reply(t.id, 'P1', '  Leaning B.  ');
    expect((await router.getThread(t.id))!.doc!.proposals[0].replies).toEqual([{ from: 'user', text: 'Leaning B.', at: expect.any(String) }]);
    await expect(docs.reply(t.id, 'P1', '   ')).rejects.toMatchObject({ code: 'invalid' });
  });

  it('opens a chat reply as a new doc with the first message as brief and fresh participants', async () => {
    const chat = await router.createThread();
    const p = await router.addParticipant(chat.id, { provider: 'claude', model: 'opus', effort: 'high' });
    const s = await router.send(chat.id, { to: p.id, text: 'Help with my bio' });
    claude.last().push({ type: 'session', sessionId: 'chat-session' });
    claude.last().push({ type: 'done', text: 'Here is a draft.' });
    claude.last().end();
    await s.done;
    const d = await docs.openAsDoc(chat.id, s.replyMessageId);
    expect(d.kind).toBe('doc');
    expect(d.doc).toMatchObject({ brief: 'Help with my bio', markdown: 'Here is a draft.' });
    expect(d.participants).toHaveLength(1);
    expect(d.participants[0]).toMatchObject({ provider: 'claude', model: 'opus', effort: 'high' });
    expect(d.participants[0].sessionId).toBeUndefined();
    expect(d.doc!.included).toEqual([d.participants[0].id]);
    await expect(docs.openAsDoc(chat.id, 'missing')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses doc operations on a chat thread', async () => {
    const chat = await router.createThread();
    await expect(docs.saveDoc(chat.id, { revision: 0, markdown: 'x' })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('keeps brief attachments when sweeping old uploads', async () => {
    const t = await docs.create({ brief: 'b' });
    const att = await router.attachments.save(t.id, 'brief.md', Buffer.from('Audience: CFOs'));
    await docs.saveDoc(t.id, { revision: 0, briefAttachmentIds: [att.id] });
    expect(await router.sweepAttachments(-1)).toBe(0);
    expect((await router.getThread(t.id))!.doc!.briefAttachments?.map((x) => x.name)).toEqual(['brief.md']);
  });
});
