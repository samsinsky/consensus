import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { DocService } from '../../src/server/docs.js';
import { EventHub } from '../../src/server/hub.js';
import { makePaths } from '../../src/server/paths.js';
import { Router } from '../../src/server/router.js';
import { ThreadStore } from '../../src/server/store.js';
import type { ThreadEvent } from '../../src/shared/types.js';
import { controllable } from '../helpers/controllable.js';

let claude: ReturnType<typeof controllable>;
let codex: ReturnType<typeof controllable>;
let router: Router;
let docs: DocService;
let hub: EventHub;

beforeEach(async () => {
  const paths = makePaths(await mkdtemp(join(tmpdir(), 'consensus-')));
  claude = controllable('claude');
  codex = controllable('codex');
  hub = new EventHub();
  router = new Router({ store: new ThreadStore(paths.threads), hub, paths, adapters: { claude: claude.adapter, codex: codex.adapter, gemini: controllable('gemini').adapter } });
  docs = new DocService(router);
});

const flush = () => new Promise((r) => setTimeout(r, 0));
const json = (o: unknown) => 'Looks solid overall.\n\n```json\n' + JSON.stringify(o) + '\n```';
function answer(c: ReturnType<typeof controllable>, text: string, session = 's') {
  c.last().push({ type: 'session', sessionId: session });
  c.last().push({ type: 'done', text });
  c.last().end();
}

async function docWithTwo(markdown = 'I make systems simple. I have gone deep on LLMs. We ship fast. Later we ship fast again.') {
  const t = await docs.create({ brief: 'LinkedIn bio', markdown });
  const a = await router.addParticipant(t.id, { provider: 'claude', model: 'opus', effort: 'high' });
  const b = await router.addParticipant(t.id, { provider: 'codex', model: 'terra', effort: 'high' });
  return { t: (await router.getThread(t.id))!, a, b };
}

describe('DocService rounds', () => {
  it('sends the same snapshot to every included participant at once', async () => {
    const { t } = await docWithTwo();
    const { round } = await docs.startRound(t.id);
    expect(round).toBe(1);
    expect(claude.requests).toHaveLength(1);
    expect(codex.requests).toHaveLength(1);
    expect(claude.requests[0].message).toContain('Document (round 1):\n<document>\nI make systems simple.');
    expect(codex.requests[0].message).toBe(claude.requests[0].message);
    const r = t.doc!.rounds[0];
    expect(r.snapshot).toBe(t.doc!.markdown);
    expect(Object.values(r.notes).map((n) => n.status)).toEqual(['running', 'running']);
  });

  it('turns answers into proposals, replies and notes', async () => {
    const { t, a, b } = await docWithTwo();
    t.doc!.proposals.push({ id: 'P1', round: 0, authors: [a.id], quote: 'make', prefix: '', suffix: '', replacement: 'build', reason: 'r', status: 'open', replies: [] });
    t.doc!.nextProposal = 2;
    const { done } = await docs.startRound(t.id);
    answer(claude, json({ proposals: [{ quote: 'I have gone deep on', replacement: "I've gained hands-on experience with", reason: 'Plainer claim.' }], replies: [{ proposal: 'P1', stance: 'agree', text: 'mine anyway' }], note: 'Tight.' }));
    answer(codex, json({ replies: [{ proposal: 'P1', stance: 'your_call', text: 'Taste.' }], note: 'Strong close.' }));
    await done;
    const doc = (await router.getThread(t.id))!.doc!;
    expect(doc.proposals[1]).toMatchObject({
      id: 'P2', round: 1, authors: [a.id], quote: 'I have gone deep on', replacement: "I've gained hands-on experience with",
      reason: 'Plainer claim.', status: 'open', prefix: 'I make systems simple. ', suffix: ' LLMs. We ship fast. Later we sh',
    });
    expect(doc.proposals[0].replies).toEqual([{ from: b.id, stance: 'your_call', text: 'Taste.', round: 1, at: expect.any(String) }]);
    expect(doc.rounds[0].notes[a.id]).toMatchObject({ status: 'done', note: 'Tight.', answer: expect.stringContaining('Looks solid'), rejected: [] });
    expect(doc.rounds[0].notes[b.id]).toMatchObject({ status: 'done', note: 'Strong close.' });
    expect(doc.nextProposal).toBe(3);
  });

  it('drops quotes that match nowhere or in several places and lists them on the note', async () => {
    const { t, a } = await docWithTwo();
    await docs.setIncluded(t.id, (t.participants[1]).id, false);
    const { done } = await docs.startRound(t.id);
    answer(claude, json({ proposals: [
      { quote: 'ship fast', replacement: 'deliver', reason: 'r' },
      { quote: 'not in the doc', replacement: 'x', reason: 'r' },
      { quote: '**gone deep on**', replacement: 'studied', reason: 'Marks are ignored.' },
    ] }));
    await done;
    const doc = (await router.getThread(t.id))!.doc!;
    expect(doc.proposals.map((p) => p.quote)).toEqual(['**gone deep on**']);
    expect(doc.rounds[0].notes[a.id].rejected).toEqual([
      { quote: 'ship fast', reason: 'matched 2 places' },
      { quote: 'not in the doc', reason: 'not found' },
    ]);
  });

  it('merges identical proposals in a round, and records a later copy as agreement', async () => {
    const { t, a, b } = await docWithTwo();
    const same = { quote: 'gone deep on', replacement: 'studied', reason: 'r' };
    const first = await docs.startRound(t.id);
    answer(claude, json({ proposals: [same] }));
    answer(codex, json({ proposals: [{ ...same, quote: 'gone  deep on' }] }));
    await first.done;
    let doc = (await router.getThread(t.id))!.doc!;
    expect(doc.proposals).toHaveLength(1);
    expect([...doc.proposals[0].authors].sort()).toEqual([a.id, b.id].sort());

    // In a later round, a participant that did not write it repeats it: that counts as agreement.
    doc.proposals[0].authors = [b.id];
    await docs.setIncluded(t.id, b.id, false);
    const second = await docs.startRound(t.id);
    answer(claude, json({ proposals: [same] }));
    await second.done;
    doc = (await router.getThread(t.id))!.doc!;
    expect(doc.proposals).toHaveLength(1);
    expect(doc.proposals[0].replies).toEqual([{ from: a.id, stance: 'agree', text: 'r', round: 2, at: expect.any(String) }]);
  });

  it('asks once for the JSON block, then reports a parse error with the raw answer', async () => {
    const { t, a, b } = await docWithTwo();
    await docs.setIncluded(t.id, b.id, false);
    const { done } = await docs.startRound(t.id);
    answer(claude, 'Great draft, no notes.');
    await flush();
    expect(claude.requests[1].message).toBe('Your answer was missing the JSON block. Reply with only the JSON block.');
    answer(claude, 'Still no JSON.');
    await done;
    const note = (await router.getThread(t.id))!.doc!.rounds[0].notes[a.id];
    expect(note).toMatchObject({ status: 'error', answer: 'Great draft, no notes.', error: { code: 'parse', message: 'The answer was missing the JSON block.' } });
  });

  it('accepts a repaired answer', async () => {
    const { t, a, b } = await docWithTwo();
    await docs.setIncluded(t.id, b.id, false);
    const { done } = await docs.startRound(t.id);
    answer(claude, 'Great draft.');
    await flush();
    answer(claude, json({ note: 'Ready.' }));
    await done;
    expect((await router.getThread(t.id))!.doc!.rounds[0].notes[a.id]).toMatchObject({ status: 'done', note: 'Ready.', answer: 'Great draft.' });
  });

  it('stops the round; participants that finished keep their proposals', async () => {
    const { t, a, b } = await docWithTwo();
    const { done } = await docs.startRound(t.id);
    answer(claude, json({ proposals: [{ quote: 'gone deep on', replacement: 'studied', reason: 'r' }] }));
    await flush();
    expect(docs.stopRound(t.id)).toBe(true);
    await done;
    const doc = (await router.getThread(t.id))!.doc!;
    expect(doc.rounds[0].notes[a.id].status).toBe('done');
    expect(doc.rounds[0].notes[b.id].status).toBe('stopped');
    expect(doc.proposals).toHaveLength(1);
    expect(docs.stopRound(t.id)).toBe(false);
    expect(router.tryReserve(b.id)).toBe(true);
  });

  it('refuses a second round while one runs, a round with nobody included, and an empty document', async () => {
    const { t, a, b } = await docWithTwo();
    const first = await docs.startRound(t.id);
    await expect(docs.startRound(t.id)).rejects.toMatchObject({ code: 'busy' });
    docs.stopRound(t.id);
    await first.done;
    await docs.setIncluded(t.id, a.id, false);
    await docs.setIncluded(t.id, b.id, false);
    await expect(docs.startRound(t.id)).rejects.toMatchObject({ code: 'invalid' });
    const empty = await docs.create({ brief: 'x' });
    await router.addParticipant(empty.id, { provider: 'claude', model: 'opus' });
    await expect(docs.startRound(empty.id)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('streams each participant\'s activity under a doc key', async () => {
    const { t, a, b } = await docWithTwo();
    await docs.setIncluded(t.id, b.id, false);
    const events: ThreadEvent[] = [];
    hub.subscribe(t.id, (ev) => events.push(ev));
    const { done } = await docs.startRound(t.id);
    claude.last().push({ type: 'activity', text: 'Reading x.com' });
    answer(claude, json({}));
    await done;
    expect(events).toContainEqual({ type: 'activity', messageId: `doc:${a.id}`, text: 'Reading x.com' });
  });

  it('retries one failed participant on the same round', async () => {
    const { t, a, b } = await docWithTwo();
    const { done } = await docs.startRound(t.id);
    claude.last().push({ type: 'error', error: { code: 'rate_limited', message: 'Slow down.' } });
    claude.last().end();
    answer(codex, json({ note: 'Fine.' }));
    await done;
    expect((await router.getThread(t.id))!.doc!.rounds[0].notes[a.id]).toMatchObject({ status: 'error', error: { code: 'rate_limited' } });
    await expect(docs.retryReview(t.id, b.id)).rejects.toMatchObject({ code: 'invalid' });
    const retry = await docs.retryReview(t.id, a.id);
    expect(claude.requests[1].message).toContain('Document (round 1)');
    answer(claude, json({ note: 'Second try.' }));
    await retry.done;
    expect((await router.getThread(t.id))!.doc!.rounds[0].notes[a.id]).toMatchObject({ status: 'done', note: 'Second try.' });
  });

  it('deleting the thread stops the round and nothing writes it back', async () => {
    const { t } = await docWithTwo();
    const { done } = await docs.startRound(t.id);
    await router.deleteThread(t.id);
    await done;
    expect(await router.getThread(t.id)).toBeUndefined();
  });
});
