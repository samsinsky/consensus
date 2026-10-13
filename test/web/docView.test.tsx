// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Thread } from '../../src/shared/types.js';

vi.mock('../../src/web/api.js', () => ({
  api: {
    saveDoc: vi.fn().mockResolvedValue(undefined),
    startRound: vi.fn().mockResolvedValue({ round: 1 }),
    stopRound: vi.fn().mockResolvedValue(undefined),
    updateProposal: vi.fn().mockResolvedValue(undefined),
    replyToProposal: vi.fn().mockResolvedValue(undefined),
    retryReview: vi.fn().mockResolvedValue(undefined),
    restore: vi.fn().mockResolvedValue(undefined),
    renameThread: vi.fn(), setIncluded: vi.fn(), removeParticipant: vi.fn(), addParticipant: vi.fn(), uploadAttachment: vi.fn(),
    attachmentUrl: () => '',
  },
}));
const { api } = await import('../../src/web/api.js');
const { DocView } = await import('../../src/web/doc/DocView.js');

const thread = (): Thread => ({
  id: 't', title: 'Bio', createdAt: '', updatedAt: '', kind: 'doc', messages: [],
  participants: [
    { id: 'a', provider: 'claude', model: 'opus', effort: 'high', promptHash: 'h', createdAt: '' },
    { id: 'b', provider: 'codex', model: 'terra', effort: 'high', promptHash: 'h', createdAt: '' },
  ],
  doc: {
    brief: 'LinkedIn bio', markdown: 'I have gone deep on LLMs.', savedAt: '', revision: 0, included: ['a', 'b'], nextProposal: 3,
    rounds: [{ n: 1, sentAt: '2026-10-13T12:00:00Z', snapshot: 'I have gone deep on LLMs.', participants: ['a', 'b'], notes: { a: { status: 'done', note: 'Tight.' }, b: { status: 'done', note: 'Close.' } } }],
    proposals: [
      { id: 'P1', round: 1, authors: ['a'], quote: 'gone deep on', prefix: 'I have ', suffix: ' LLMs.', replacement: 'gained', reason: 'Fits.', status: 'open', replies: [] },
      { id: 'P2', round: 1, authors: ['b'], quote: 'deep on', prefix: 'I have gone ', suffix: ' LLMs.', replacement: 'focused on', reason: 'Plainer.', status: 'open', replies: [] },
    ],
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
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label)!;

describe('DocView', () => {
  it('shows the brief, the document with the selected option inline, notes and a grouped card', async () => {
    await act(async () => root.render(<DocView thread={thread()} activity={{}} models={models} defaults={defaults} />));
    expect((host.querySelector('textarea.brief-input') as HTMLTextAreaElement).value).toBe('LinkedIn bio');
    expect(host.querySelector('.ProseMirror')!.textContent).toContain('gone deep on');
    expect(host.querySelector('.prop-old[data-proposal="P1"]')!.textContent).toBe('gone deep on');
    expect(host.textContent).toContain('Tight.');
    expect(host.textContent).toContain('2 versions');
  });

  it('accepts an option: edits the text and settles the group', async () => {
    await act(async () => root.render(<DocView thread={thread()} activity={{}} models={models} defaults={defaults} />));
    await act(async () => click(button('Accept A')));
    expect(host.querySelector('.ProseMirror')!.textContent).toBe('I have gained LLMs.');
    expect(api.updateProposal).toHaveBeenCalledWith('t', 'P1', { status: 'accepted', replacement: undefined, notChosen: ['P2'] });
  });

  it('saves pending edits before sending a round', async () => {
    vi.useFakeTimers();
    try {
      await act(async () => root.render(<DocView thread={thread()} activity={{}} models={models} defaults={defaults} />));
      const brief = host.querySelector('textarea.brief-input') as HTMLTextAreaElement;
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(brief, 'LinkedIn bio, 150 words');
        brief.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(api.saveDoc).not.toHaveBeenCalled();
      await act(async () => click(host.querySelector('.review-send')!));
      expect(api.saveDoc).toHaveBeenCalledWith('t', { revision: 0, brief: 'LinkedIn bio, 150 words' });
      expect(api.startRound).toHaveBeenCalledWith('t');
    } finally {
      vi.useRealTimers();
    }
  });

  it('lists round snapshots and restores one', async () => {
    await act(async () => root.render(<DocView thread={thread()} activity={{}} models={models} defaults={defaults} />));
    click(host.querySelector('button[title="History"]')!);
    click(button('Round 1 · ' + new Date('2026-10-13T12:00:00Z').toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })));
    await act(async () => click(button('Restore')));
    expect(api.restore).toHaveBeenCalledWith('t', 1);
  });
});
