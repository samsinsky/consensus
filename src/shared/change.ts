import { cleanQuote, contextAt, indexString, locate, normalize, type TextIndex } from './anchor.js';
import type { Proposal } from './types.js';

/** What a suggestion actually changes: its quote and replacement minus the words they share at each end. */
export type Core = {
  /** The changed span, in the quote's plain words. Empty for an insertion. */
  start: number;
  end: number;
  /** The replacement's words for that span, Markdown kept. */
  insert: string;
};

const WORD = /[\p{L}\p{N}'_-]/u;

/** Whether position i falls between two letters of one word. */
const midWord = (t: string, i: number) => i > 0 && i < t.length && WORD.test(t[i - 1]) && WORD.test(t[i]);

export function coreOf(quote: string, replacement: string): Core {
  const q = normalize(cleanQuote(quote));
  const r = indexString(replacement);
  const t = r.text;
  let p = 0;
  while (p < q.length && p < t.length && q[p] === t[p]) p++;
  // Whole words only: a changed letter changes its word.
  while (p > 0 && (midWord(q, p) || midWord(t, p))) p--;
  const room = Math.min(q.length, t.length) - p;
  let s = 0;
  while (s < room && q[q.length - 1 - s] === t[t.length - 1 - s]) s++;
  while (s > 0 && (midWord(q, q.length - s) || midWord(t, t.length - s))) s--;
  const from = p === 0 ? 0 : r.map[p - 1] + 1;
  const to = s === 0 ? replacement.length : r.map[t.length - s];
  return { start: p, end: q.length - s, insert: replacement.slice(from, to) };
}

/** An open suggestion found in the text, by its quote's plain-word range. */
export type Located = { proposal: Proposal; start: number; end: number };

/** A suggestion's changed span within the whole text. */
export function changedSpan(l: Located, replacement = l.proposal.replacement): { start: number; end: number; insert: string } {
  const c = coreOf(l.proposal.quote, replacement);
  return { start: l.start + c.start, end: l.start + c.end, insert: c.insert };
}

type Span = { start: number; end: number };

/** Two changes collide when they rewrite shared words, insert at the same spot, or one inserts inside the other's words. */
export function collide(a: Span, b: Span): boolean {
  if (a.start === a.end && b.start === b.end) return a.start === b.start;
  if (a.start === a.end) return b.start < a.start && a.start < b.end;
  if (b.start === b.end) return a.start < b.start && b.start < a.end;
  return Math.min(a.end, b.end) > Math.max(a.start, b.start);
}

export type Rebased = { id: string; quote: string; replacement: string; prefix: string; suffix: string };

/**
 * After a change is accepted: suggestions whose quote overlapped it but whose own change is untouched get a quote
 * and replacement rewritten to the new text, and suggestions that can no longer be found are superseded.
 */
export function settle(others: Located[], accepted: Span, before: TextIndex, after: TextIndex): { rebased: Rebased[]; superseded: string[] } {
  const delta = after.text.length - before.text.length;
  const inserted = accepted.start === accepted.end;
  // Positions before the change stay, positions after it shift, and positions inside it snap to its new words.
  // A span starting exactly where words were inserted starts after them.
  const map = (x: number, side: 'start' | 'end') => {
    if (x < accepted.start || (x === accepted.start && (side === 'end' || !inserted))) return x;
    if (x >= accepted.end) return x + delta;
    return side === 'start' ? accepted.start : accepted.end + delta;
  };
  const rebased: Rebased[] = [];
  const superseded: string[] = [];
  for (const o of others) {
    let anchor: Pick<Proposal, 'quote' | 'prefix' | 'suffix'> = o.proposal;
    const overlaps = o.end > accepted.start && o.start < accepted.end;
    const own = changedSpan(o);
    if (overlaps && !collide(own, accepted)) {
      const start = map(o.start, 'start');
      const end = map(o.end, 'end');
      const coreStart = map(own.start, 'start');
      const coreEnd = map(own.end, 'end');
      if (after.text.slice(coreStart, coreEnd) === before.text.slice(own.start, own.end)) {
        const quote = after.text.slice(start, end);
        const next = {
          id: o.proposal.id,
          quote,
          replacement: quote.slice(0, coreStart - start) + own.insert + quote.slice(coreEnd - start),
          ...contextAt(after, start, end - start),
        };
        rebased.push(next);
        anchor = next;
      }
    }
    if (!locate(after, anchor)) {
      superseded.push(o.proposal.id);
      const i = rebased.findIndex((x) => x.id === o.proposal.id);
      if (i >= 0) rebased.splice(i, 1);
    }
  }
  return { rebased, superseded };
}
