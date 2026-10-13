import { describe, expect, it } from 'vitest';
import { groupOverlaps, isYourCall, stanceCounts } from '../../src/shared/proposals.js';
import type { Proposal } from '../../src/shared/types.js';

const prop = (over: Partial<Proposal>): Proposal => ({
  id: 'P1', round: 1, authors: ['a'], quote: 'q', prefix: '', suffix: '', replacement: 'r', reason: 'why',
  status: 'open', replies: [], ...over,
});

describe('groupOverlaps', () => {
  it('groups ranges that overlap and leaves touching ranges apart', () => {
    expect(groupOverlaps([
      { id: 'P1', start: 0, end: 10 },
      { id: 'P2', start: 5, end: 8 },
      { id: 'P3', start: 10, end: 12 },
      { id: 'P4', start: 11, end: 20 },
      { id: 'P5', start: 30, end: 31 },
    ])).toEqual([['P1', 'P2'], ['P3', 'P4'], ['P5']]);
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
