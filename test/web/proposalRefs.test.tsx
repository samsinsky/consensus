// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Proposal } from '../../src/shared/types.js';
import { excerpt, linkRefs, ProposalRefs, refsAsText, RefText, splitRefs } from '../../src/web/doc/proposalRefs.js';

const prop = (over: Partial<Proposal>): Proposal => ({
  id: 'P1', round: 1, authors: ['a'], quote: 'gone deep on', prefix: '', suffix: '', replacement: 'gained', reason: '', status: 'open', replies: [], ...over,
});
const props = [prop({ id: 'P4', quote: 'We think the market for this is enormous' }), prop({ id: 'P12', quote: 'ship fast', status: 'accepted' })];

describe('splitRefs', () => {
  it('splits out known proposal ids and leaves unknown ones as text', () => {
    expect(splitRefs('Agree with P4, not P12. P9 and SP4 and P40 are not refs.', props)).toEqual([
      'Agree with ', { proposal: props[0] }, ', not ', { proposal: props[1] }, '. P9 and SP4 and P40 are not refs.',
    ]);
  });
  it('returns the text alone when nothing matches', () => {
    expect(splitRefs('No refs here.', props)).toEqual(['No refs here.']);
  });
});

describe('excerpt', () => {
  it('keeps short quotes whole and cuts long ones at a word', () => {
    expect(excerpt('ship fast')).toBe('“ship fast”');
    expect(excerpt('We think the market for this is enormous')).toBe('“We think the market…”');
    expect(excerpt('I enjoyed your webinar, especially how')).toBe('“I enjoyed your webinar…”');
  });
  it('labels a pure insertion by its replacement', () => {
    expect(excerpt('', 'A new opening line')).toBe('“A new opening line”');
  });
});

describe('refsAsText', () => {
  it('swaps ids for excerpts in plain text', () => {
    expect(refsAsText('Accept P12, skip P9.', props)).toBe('Accept “ship fast”, skip P9.');
  });
});

describe('linkRefs', () => {
  it('turns known ids in Markdown into in-page links', () => {
    expect(linkRefs('See P4 and P9.', props)).toBe('See [P4](#proposal-P4) and P9.');
  });
});

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

describe('RefText', () => {
  it('shows each reference as its excerpt, explains it on hover, and jumps to open ones', () => {
    const onJump = vi.fn();
    act(() => root.render(<ProposalRefs.Provider value={{ proposals: props, onJump }}><RefText text="I back P4 over P12." /></ProposalRefs.Provider>));
    const refs = [...host.querySelectorAll('.prop-ref')];
    expect(host.textContent).toBe('I back “We think the market…” over “ship fast”.');
    expect(refs[0].getAttribute('title')).toBe('P4 · Open\n"We think the market for this is enormous" → "gained"');
    expect(refs[1].getAttribute('title')).toContain('P12 · Accepted');
    act(() => refs[0].dispatchEvent(new MouseEvent('click', { bubbles: true })));
    act(() => refs[1].dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith('P4');
  });
  it('renders plain text when there is no context', () => {
    act(() => root.render(<RefText text="I back P4." />));
    expect(host.textContent).toBe('I back P4.');
  });
});
