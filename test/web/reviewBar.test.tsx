// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Participant, Thread } from '../../src/shared/types.js';

vi.mock('../../src/web/api.js', () => ({
  api: { setIncluded: vi.fn().mockResolvedValue(undefined), removeParticipant: vi.fn().mockResolvedValue(undefined), addParticipant: vi.fn().mockResolvedValue({}) },
}));
const { api } = await import('../../src/web/api.js');
const { ReviewBar } = await import('../../src/web/doc/ReviewBar.js');

const person = (id: string, provider: Participant['provider'], model: string, ordinal = 1): Participant => ({ id, provider, model, effort: 'high', promptHash: 'h', ordinal, createdAt: '' });
const thread = (included: string[], running = false): Thread => ({
  id: 't', title: 'Bio', createdAt: '', updatedAt: '', kind: 'doc', messages: [],
  participants: [person('a', 'claude', 'opus'), person('b', 'codex', 'terra'), person('c', 'claude', 'sonnet', 2), person('d', 'gemini', 'pro'), person('e', 'codex', 'luna', 2)],
  doc: {
    brief: '', markdown: 'x', savedAt: '', revision: 0, included, proposals: [], nextProposal: 1,
    rounds: running ? [{ n: 1, sentAt: '', snapshot: 'x', participants: ['a'], notes: { a: { status: 'running' } } }] : [],
  },
});
const models = { claude: [], codex: [], gemini: [] };
const defaults = { claude: { model: 'opus' }, codex: { model: 'terra' }, gemini: { model: 'pro' } };

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(api.setIncluded).mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const render = (t: Thread, props: Partial<{ activity: Record<string, string> }> = {}) =>
  act(() => root.render(<ReviewBar thread={t} models={models} defaults={defaults} activity={props.activity ?? {}} running={t.doc!.rounds.some((r) => Object.values(r.notes).some((n) => n.status === 'running'))} />));

describe('review summary', () => {
  const summary = () => host.querySelector('.review-summary')!;
  it('lists up to three included participants, each with its model as a subtitle, then + N more', () => {
    render(thread(['a', 'b']));
    expect(summary().textContent).toBe('Claude #1 opus high • ChatGPT #1 terra high ▾');
    expect([...summary().querySelectorAll('.note-model')].map((m) => m.textContent)).toEqual(['opus high', 'terra high']);
    render(thread(['a', 'b', 'c', 'd', 'e']));
    expect(summary().textContent).toBe('Claude #1 opus high • ChatGPT #1 terra high • Claude #2 sonnet high + 2 more ▾');
    render(thread([]));
    expect(summary().textContent).toBe('Nobody included ▾');
  });
});

describe('ReviewBar', () => {
  it('toggles a participant by clicking its name, and removes with ×', async () => {
    render(thread(['a']));
    click(host.querySelector('.review-summary')!);
    const rows = [...host.querySelectorAll('.review-row')];
    expect(rows.map((r) => r.className)).toEqual(['review-row included', 'review-row', 'review-row', 'review-row', 'review-row']);
    click(rows[0].querySelector('.review-name')!);
    expect(api.setIncluded).toHaveBeenCalledWith('t', 'a', false);
    click(rows[1].querySelector('.review-name')!);
    expect(api.setIncluded).toHaveBeenCalledWith('t', 'b', true);
    click(rows[1].querySelector('.review-remove')!);
    expect(api.removeParticipant).toHaveBeenCalledWith('t', 'b');
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === '+ Add participant')).toBe(true);
  });

  it('shows each running reviewer\'s activity', () => {
    render(thread(['a'], true), { activity: { 'doc:a': 'Reading x.com' } });
    expect(host.textContent).toContain('Reading x.com');
  });
});
