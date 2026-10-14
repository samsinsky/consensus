// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Participant, Proposal, Round } from '../../src/shared/types.js';
import type { Group } from '../../src/web/doc/anchoring.js';
import { NoteCard } from '../../src/web/doc/NoteCard.js';
import { ProposalCard, StaleCard } from '../../src/web/doc/ProposalCard.js';
import { ResolvedList } from '../../src/web/doc/ResolvedList.js';

const people: Participant[] = [
  { id: 'a', provider: 'claude', model: 'opus', effort: 'high', promptHash: 'h', createdAt: '' },
  { id: 'b', provider: 'codex', model: 'terra', effort: 'high', promptHash: 'h', createdAt: '' },
];
const prop = (over: Partial<Proposal>): Proposal => ({
  id: 'P1', round: 1, authors: ['a'], quote: 'gone deep on', prefix: '', suffix: '', replacement: 'gained', reason: 'Fits "Through".', status: 'open', replies: [], ...over,
});
const group = (...ps: Proposal[]): Group => ({ key: ps[0].id, options: ps.map((p) => ({ proposal: p, from: 1, to: 5 })), yourCall: ps.some((p) => p.replies.some((r) => r.stance === 'your_call')) });

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const expand = () => { const line = host.querySelector('.note-line, .stale-line'); if (line) click(line); };
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label)!;

describe('ProposalCard', () => {
  it('shows one proposal with its author, reason, counts and thread, and accepts an edited replacement', () => {
    const onAccept = vi.fn();
    const p = prop({ replies: [{ from: 'b', stance: 'disagree', text: 'Weaker verb.', at: '' }, { from: 'user', text: 'Hm.', at: '' }] });
    act(() => root.render(<ProposalCard group={group(p)} shown="P1" participants={people} focused={false} onFocus={() => {}} onPickOption={() => {}} onAccept={onAccept} onReject={() => {}} onReply={async () => {}} onEditReplacement={() => {}} />));
    expect(host.textContent).toContain('Claude · opus high');
    expect(host.textContent).toContain('Fits "Through".');
    expect(host.textContent).toContain('✓1');
    expect(host.textContent).toContain('✗1');
    expect(host.textContent).toContain('ChatGPT · terra high (disagree): Weaker verb.');
    expect(host.textContent).toContain('You: Hm.');
    expect(host.textContent).not.toContain('Your call');
    const box = host.querySelector('textarea.replacement') as HTMLTextAreaElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, 'gained hands-on');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(button('Accept'));
    expect(onAccept).toHaveBeenCalledWith('P1', 'gained hands-on');
    expect(button('Reject')).toBeTruthy();
  });

  it('shows competing options with the Your call tag, picks one, and rejects all', () => {
    const onPick = vi.fn();
    const onReject = vi.fn();
    const g = group(prop({}), prop({ id: 'P2', authors: ['b'], replacement: 'built', replies: [{ from: 'a', stance: 'your_call', text: 'Taste.', at: '' }] }));
    act(() => root.render(<ProposalCard group={g} shown="P1" participants={people} focused onFocus={() => {}} onPickOption={onPick} onAccept={() => {}} onReject={onReject} onReply={async () => {}} onEditReplacement={() => {}} />));
    expect(host.textContent).toContain('2 versions');
    expect(host.textContent).toContain('Your call');
    const radios = host.querySelectorAll('input[type="radio"]');
    click(radios[1]);
    expect(onPick).toHaveBeenCalledWith('P2');
    click(button('Reject all'));
    expect(onReject).toHaveBeenCalledWith(['P1', 'P2']);
    expect(button('Accept A')).toBeTruthy();
  });

  it('marks proposals whose text changed and offers only Dismiss', () => {
    const onDismiss = vi.fn();
    act(() => root.render(<StaleCard proposal={prop({})} participants={people} onDismiss={onDismiss} />));
    expect(host.textContent).toContain('Text changed');
    expect(host.textContent).not.toContain('gone deep on');
    expect(button('Dismiss')).toBeUndefined();
    expand();
    expect(host.textContent).toContain('gone deep on');
    expect(host.querySelectorAll('button')).toHaveLength(1);
    click(button('Dismiss'));
    expect(onDismiss).toHaveBeenCalledWith('P1');
  });
});

describe('NoteCard', () => {
  const round = (over: Partial<Round>): Round => ({ n: 1, sentAt: '2026-10-13T12:00:00Z', snapshot: '', participants: ['a'], notes: {}, ...over });

  it('shows the latest note, the full answer on request, and quotes that failed', () => {
    const r = round({ notes: { a: { status: 'done', note: 'Tight draft.', answer: 'Full **answer**.', rejected: [{ quote: 'ship fast', reason: 'matched 2 places' }] } } });
    act(() => root.render(<NoteCard participant={people[0]} all={people} roundRunning={false} latestRound={1} rounds={[r]} onRetry={() => {}} />));
    expand();
    expect(host.textContent).toContain('Tight draft.');
    expect(host.textContent).toContain('"ship fast" (matched 2 places)');
    click(button('Full answer'));
    expect(host.querySelector('strong')?.textContent).toBe('answer');
  });

  it('shows activity while running, and errors with Retry', () => {
    const onRetry = vi.fn();
    act(() => root.render(<NoteCard participant={people[0]} all={people} roundRunning={false} latestRound={1} rounds={[round({ notes: { a: { status: 'running' } } })]} activity="Reading x.com" onRetry={onRetry} />));
    expect(host.textContent).toContain('Reading x.com…');
    act(() => root.render(<NoteCard participant={people[0]} all={people} roundRunning={false} latestRound={1} rounds={[round({ notes: { a: { status: 'error', error: { code: 'parse', message: 'The answer was missing the JSON block.' }, answer: 'No JSON.' } } })]} onRetry={onRetry} />));
    expect(host.querySelector('.note-line')?.textContent).toContain('Error');
    expand();
    expect(host.textContent).toContain('The answer was missing the JSON block.');
    click(button('Retry'));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('NoteCard collapsed line', () => {
  const round = (over: Partial<Round>): Round => ({ n: 1, sentAt: '2026-10-13T12:00:00Z', snapshot: '', participants: ['a'], notes: {}, ...over });
  const line = (r: Round, activity?: string) => {
    act(() => root.render(<NoteCard participant={people[0]} all={people} roundRunning={false} latestRound={1} rounds={[r]} activity={activity} onRetry={() => {}} />));
    return host.querySelector('.note-line')!;
  };

  it('is collapsed by default: name, the start of the note, and the model beneath, expanding on click', () => {
    const long = 'x'.repeat(100);
    const el = line(round({ notes: { a: { status: 'done', note: long } } }));
    expect(el.querySelector('.author')!.textContent).toBe(' Claude');
    expect(el.querySelector('.note-model')!.textContent).toBe('opus high');
    expect(el.textContent).toContain('x'.repeat(80) + '…');
    expect(el.textContent).not.toContain('x'.repeat(81));
    expect(host.querySelector('.card-head')).toBeNull();
    click(el);
    expect(host.textContent).toContain(long);
    expect(host.querySelector('.card-head')).not.toBeNull();
  });

  it('keeps a short note whole and shows status words while running, stopped or failed', () => {
    expect(line(round({ notes: { a: { status: 'done', note: 'Tight.' } } })).textContent).toContain('Tight.');
    expect(line(round({ notes: { a: { status: 'done', note: 'Tight.' } } })).textContent).not.toContain('…');
    expect(line(round({ notes: { a: { status: 'running' } } })).textContent).toContain('Reviewing…');
    expect(line(round({ notes: { a: { status: 'running' } } }), 'Reading x.com').textContent).toContain('Reading x.com…');
    expect(line(round({ notes: { a: { status: 'stopped' } } })).textContent).toContain('Stopped');
  });
});

describe('NoteCard Retry', () => {
  const failed = (n: number): Round => ({ n, sentAt: '', snapshot: '', participants: ['a'], notes: { a: { status: 'error', error: { code: 'parse', message: 'Broke.' } } } });
  const render = (rounds: Round[], roundRunning: boolean, latestRound: number) => {
    act(() => root.render(<NoteCard participant={people[0]} all={people} rounds={rounds} roundRunning={roundRunning} latestRound={latestRound} onRetry={() => {}} />));
    expand();
  };

  it('is offered only for the thread\'s latest round', () => {
    render([failed(1)], false, 2);
    expect(button('Retry')).toBeUndefined();
    render([failed(2)], false, 2);
    expect(button('Retry')).toBeTruthy();
  });

  it('is disabled with a reason while a review round is running', () => {
    render([failed(1)], true, 1);
    expect(button('Retry').disabled).toBe(true);
    expect(button('Retry').title).toBe('Wait for the other reviews to finish');
    render([failed(1)], false, 1);
    expect(button('Retry').disabled).toBe(false);
  });
});

describe('ResolvedList', () => {
  it('collapses settled proposals into one line that expands', () => {
    const list = [prop({ status: 'accepted' }), prop({ id: 'P2', status: 'rejected', authors: ['b'], quote: 'LLMs', replacement: 'models' })];
    act(() => root.render(<ResolvedList proposals={list} participants={people} />));
    expect(host.textContent).toBe('2 resolved');
    click(button('2 resolved'));
    expect(host.textContent).toContain('Accepted');
    expect(host.textContent).toContain('Rejected · ChatGPT · terra high: "LLMs" → "models"');
  });
});
