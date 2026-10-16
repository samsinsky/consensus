import { describe, expect, it } from 'vitest';
import { groupOverlaps, isYourCall, stanceCounts, stanceVoters } from '../../src/shared/proposals.js';
import type { Proposal } from '../../src/shared/types.js';

const prop = (over: Partial<Proposal>): Proposal => ({
  id: 'P1', round: 1, authors: ['a'], quote: 'q', prefix: '', suffix: '', replacement: 'r', reason: 'why',
  status: 'open', replies: [], ...over,
});

describe('groupOverlaps', () => {
  it('groups ranges that mostly cover the same text as versions, and leaves touching ranges apart', () => {
    expect(groupOverlaps([
      { id: 'P1', start: 0, end: 10 },
      { id: 'P2', start: 2, end: 10 },
      { id: 'P3', start: 10, end: 12 },
      { id: 'P5', start: 30, end: 31 },
    ])).toEqual([['P1', 'P2'], ['P3'], ['P5']]);
  });

  it('keeps a small edit inside a larger rewrite as its own suggestion', () => {
    expect(groupOverlaps([
      { id: 'P1', start: 0, end: 200 },
      { id: 'P2', start: 40, end: 41 },
      { id: 'P3', start: 0, end: 190 },
    ])).toEqual([['P1', 'P3'], ['P2']]);
  });

  it('groups two insertions at the same spot', () => {
    expect(groupOverlaps([
      { id: 'P1', start: 5, end: 5 },
      { id: 'P2', start: 5, end: 5 },
      { id: 'P3', start: 9, end: 9 },
    ])).toEqual([['P1', 'P2'], ['P3']]);
  });

  it('keeps ranges that only clip each other apart', () => {
    expect(groupOverlaps([
      { id: 'P1', start: 0, end: 10 },
      { id: 'P2', start: 8, end: 20 },
    ])).toEqual([['P1'], ['P2']]);
  });
});

describe('stanceCounts', () => {
  it('counts authors as agreeing and uses each participant\'s latest stance', () => {
    const p = prop({
      authors: ['a', 'b'],
      replies: [
        { from: 'c', stance: 'agree', text: '', at: '' },
        { from: 'c', stance: 'disagree', text: '', at: '' },
        { from: 'user', text: 'hm', at: '' },
        { from: 'd', stance: 'your_call', text: '', at: '' },
      ],
    });
    expect(stanceCounts(p)).toEqual({ agree: 2, disagree: 1 });
  });
});

describe('stanceVoters', () => {
  it('lists authors first among the agrees, then each participant by latest stance', () => {
    const p = prop({
      authors: ['a'],
      replies: [
        { from: 'b', stance: 'agree', text: '', at: '' },
        { from: 'c', stance: 'agree', text: '', at: '' },
        { from: 'c', stance: 'disagree', text: '', at: '' },
        { from: 'a', stance: 'disagree', text: '', at: '' },
        { from: 'd', stance: 'your_call', text: '', at: '' },
      ],
    });
    expect(stanceVoters(p)).toEqual({ agree: ['a', 'b'], disagree: ['c'] });
  });
});

describe('isYourCall', () => {
  it('is true when any participant\'s latest stance on any option is your call', () => {
    const a = prop({ id: 'P1' });
    const b = prop({ id: 'P2', replies: [{ from: 'c', stance: 'your_call', text: '', at: '' }] });
    expect(isYourCall([a])).toBe(false);
    expect(isYourCall([a, b])).toBe(true);
    const changed = prop({ replies: [{ from: 'c', stance: 'your_call', text: '', at: '' }, { from: 'c', stance: 'agree', text: '', at: '' }] });
    expect(isYourCall([changed])).toBe(false);
  });
});
