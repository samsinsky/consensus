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
  vi.mocked(api.saveDoc).mockReset().mockResolvedValue(undefined);
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
      await act(async () => click(host.querySelector('.send-btn')!));
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

  it('closes the history picker on a click outside it or Escape', async () => {
    await act(async () => root.render(<DocView thread={thread()} activity={{}} models={models} defaults={defaults} />));
    const toggle = host.querySelector('button[title="History"]')!;
    click(toggle);
    expect(host.querySelector('.history-menu')).not.toBeNull();
    act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(host.querySelector('.history-menu')).toBeNull();
    click(toggle);
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(host.querySelector('.history-menu')).toBeNull();
  });
  const typeBrief = (text: string) => {
    const brief = host.querySelector('textarea.brief-input') as HTMLTextAreaElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(brief, text);
      brief.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  it('Send waits for a save already in flight', async () => {
    vi.useFakeTimers();
    try {
      let resolveSave!: () => void;
      vi.mocked(api.saveDoc).mockImplementationOnce(() => new Promise<void>((r) => { resolveSave = r; }) as any);
      await act(async () => root.render(<DocView thread={thread()} activity={{}} models={models} defaults={defaults} />));
      typeBrief('edited');
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(api.saveDoc).toHaveBeenCalledTimes(1);
      await act(async () => click(host.querySelector('.send-btn')!));
      expect(api.startRound).not.toHaveBeenCalled();
      await act(async () => { resolveSave(); await Promise.resolve(); });
      expect(api.startRound).toHaveBeenCalledWith('t');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Send does not start a round when the save in flight fails', async () => {
    vi.useFakeTimers();
    try {
      let rejectSave!: (e: Error) => void;
      vi.mocked(api.saveDoc).mockImplementationOnce(() => new Promise<void>((_, r) => { rejectSave = r; }) as any);
      vi.mocked(api.saveDoc).mockRejectedValueOnce(new Error('still busy'));
      await act(async () => root.render(<DocView thread={thread()} activity={{}} models={models} defaults={defaults} />));
      typeBrief('edited');
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      await act(async () => click(host.querySelector('.send-btn')!));
      await act(async () => { rejectSave(new Error('busy')); await Promise.resolve(); });
      expect(api.startRound).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a save that fails after a restore does not bring the old text back', async () => {
    vi.useFakeTimers();
    try {
      let rejectSave!: (e: Error) => void;
      vi.mocked(api.saveDoc).mockImplementationOnce(() => new Promise<void>((_, r) => { rejectSave = r; }) as any);
      await act(async () => root.render(<DocView thread={thread()} activity={{}} models={models} defaults={defaults} />));
      typeBrief('old edit');
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      click(host.querySelector('button[title="History"]')!);
      click(button('Round 1 · ' + new Date('2026-10-13T12:00:00Z').toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })));
      await act(async () => click(button('Restore')));
      const restored = thread();
      restored.doc!.revision = 1;
      await act(async () => root.render(<DocView thread={restored} activity={{}} models={models} defaults={defaults} />));
      await act(async () => { rejectSave(new Error('busy')); await Promise.resolve(); });
      await act(async () => click(host.querySelector('.send-btn')!));
      expect(api.saveDoc).toHaveBeenCalledTimes(1);
      expect(api.startRound).toHaveBeenCalledWith('t');
    } finally {
      vi.useRealTimers();
    }
  });
  it('a failed save is retried: Send saves again and starts the round once it succeeds', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(api.saveDoc).mockRejectedValueOnce(new Error('busy'));
      await act(async () => root.render(<DocView thread={thread()} activity={{}} models={models} defaults={defaults} />));
      typeBrief('edited');
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(host.textContent).toContain('Not saved');
      expect(host.querySelector('.error-inline')?.textContent).toBe('busy');
      await act(async () => click(host.querySelector('.send-btn')!));
      expect(api.saveDoc).toHaveBeenCalledTimes(2);
      expect(host.querySelector('.error-inline')).toBeNull();
      expect(api.saveDoc).toHaveBeenLastCalledWith('t', { revision: 0, brief: 'edited' });
      expect(api.startRound).toHaveBeenCalledWith('t');
      expect(host.textContent).not.toContain('Not saved');
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the inline error when a later autosave succeeds', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(api.saveDoc).mockRejectedValueOnce(new Error('busy'));
      await act(async () => root.render(<DocView thread={thread()} activity={{}} models={models} defaults={defaults} />));
      typeBrief('edited');
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(host.querySelector('.error-inline')?.textContent).toBe('busy');
      typeBrief('edited again');
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(host.textContent).not.toContain('Not saved');
      expect(host.querySelector('.error-inline')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends from an arrow inside the brief box, disabled with nobody included, and stops a running round', async () => {
    const t = thread();
    t.doc!.included = [];
    act(() => root.render(<DocView thread={t} activity={{}} models={models} defaults={defaults} />));
    const arrow = () => host.querySelector('.input-wrap .send-btn') as HTMLButtonElement;
    expect(arrow().disabled).toBe(true);
    expect(host.querySelector('.review-send')).toBeNull();
    const running = thread();
    running.doc!.rounds[0].notes.a = { status: 'running' };
    act(() => root.render(<DocView thread={running} activity={{}} models={models} defaults={defaults} />));
    expect(arrow().getAttribute('aria-label')).toBe('Stop');
    await act(async () => click(arrow()));
    expect(api.stopRound).toHaveBeenCalledWith('t');
  });
});
