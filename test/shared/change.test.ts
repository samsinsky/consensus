import { describe, expect, it } from 'vitest';
import { indexString, locate } from '../../src/shared/anchor.js';
import { coreOf, settle, type Located } from '../../src/shared/change.js';
import type { Proposal } from '../../src/shared/types.js';

const prop = (id: string, quote: string, replacement: string): Proposal => ({
  id, round: 1, authors: ['a'], quote, prefix: '', suffix: '', replacement, reason: '', status: 'open', replies: [],
});

describe('coreOf', () => {
  it('trims the words a quote and its replacement share at each end', () => {
    expect(coreOf('I think that', 'We think that')).toEqual({ start: 0, end: 1, insert: 'We' });
    expect(coreOf('think that birds', 'think that penguins')).toEqual({ start: 11, end: 16, insert: 'penguins' });
  });

  it('keeps whole words: a one-letter difference changes the word', () => {
    expect(coreOf('the birds fly', 'the bird flies')).toEqual({ start: 4, end: 13, insert: 'bird flies' });
  });

  it('reads an insertion as an empty span with the new words', () => {
    expect(coreOf('that birds', 'that small birds')).toEqual({ start: 5, end: 5, insert: 'small ' });
  });

  it('reads a deletion as the removed words with nothing to insert', () => {
    expect(coreOf('is very good', 'is good')).toEqual({ start: 3, end: 8, insert: '' });
  });

  it('keeps Markdown in the inserted words, and ignores curly quotes and spacing when comparing', () => {
    expect(coreOf('I think that birds', 'I think **that** birds')).toEqual({ start: 8, end: 12, insert: '**that**' });
    expect(coreOf('it’s  here now', "it's here today")).toEqual({ start: 10, end: 13, insert: 'today' });
  });

  it('changes everything when nothing is shared', () => {
    expect(coreOf('Hello', 'Goodbye')).toEqual({ start: 0, end: 5, insert: 'Goodbye' });
  });
});

describe('settle', () => {
  const text = 'I think that birds can fly';
  const at = (p: Proposal, doc = text): Located => {
    const r = locate(indexString(doc), p)!;
    return { proposal: p, ...r };
  };
  /** Applies a change to plain text, the way accepting edits the editor. */
  const apply = (doc: string, start: number, end: number, insert: string) => doc.slice(0, start) + insert + doc.slice(end);

  it('supersedes a rewrite of the whole sentence once a small edit inside it is accepted, and leaves a separate edit alone', () => {
    const small = at(prop('P1', 'I think', 'We think'));
    const whole = at(prop('P2', text, 'Birds can fly, I think'));
    const tail = at(prop('P3', 'can fly', 'fly'));
    const after = apply(text, 0, 1, 'We');
    const r = settle([whole, tail], { start: 0, end: 1 }, indexString(text), indexString(after));
    expect(r.superseded).toEqual(['P2']);
    expect(r.rebased).toEqual([]);
  });

  it('keeps an overlapping suggestion live when the words it changes are untouched, with its quote and replacement moved to the new text', () => {
    const b = at(prop('P2', 'I think that birds', 'I think that penguins'));
    const after = apply(text, 0, 1, 'We');
    const r = settle([b], { start: 0, end: 1 }, indexString(text), indexString(after));
    expect(r.superseded).toEqual([]);
    expect(r.rebased).toEqual([
      { id: 'P2', quote: 'We think that birds', replacement: 'We think that penguins', prefix: '', suffix: ' can fly' },
    ]);
  });

  it('moves a quote that starts where the accepted change starts onto the new words', () => {
    const b = at(prop('P2', 'think that birds', 'think that penguins'));
    const after = apply(text, 2, 7, 'believe');
    const r = settle([b], { start: 2, end: 7 }, indexString(text), indexString(after));
    expect(r.rebased).toEqual([
      { id: 'P2', quote: 'believe that birds', replacement: 'believe that penguins', prefix: 'I ', suffix: ' can fly' },
    ]);
  });

  it('supersedes suggestions whose changed words were rewritten, including a second insertion at the same spot', () => {
    const same = at(prop('P2', 'that birds', 'that tiny birds'));
    const after = apply(text, 13, 13, 'small ');
    const r = settle([same], { start: 13, end: 13 }, indexString(text), indexString(after));
    expect(r).toEqual({ rebased: [], superseded: ['P2'] });
    const clash = at(prop('P3', 'birds can', 'bats can'));
    const after2 = apply(text, 13, 18, 'penguins');
    expect(settle([clash], { start: 13, end: 18 }, indexString(text), indexString(after2)).superseded).toEqual(['P3']);
  });

  it('keeps a suggestion live when words are inserted right before the words it changes', () => {
    const b = at(prop('P2', 'that birds', 'that bats'));
    const after = apply(text, 13, 13, 'small ');
    expect(settle([b], { start: 13, end: 13 }, indexString(text), indexString(after)).rebased).toEqual([
      { id: 'P2', quote: 'that small birds', replacement: 'that small bats', prefix: 'I think ', suffix: ' can fly' },
    ]);
  });

  it('shifts nothing for a suggestion that does not overlap', () => {
    const tail = at(prop('P3', 'can fly', 'fly'));
    const after = apply(text, 0, 1, 'We');
    expect(settle([tail], { start: 0, end: 1 }, indexString(text), indexString(after))).toEqual({ rebased: [], superseded: [] });
  });
});
