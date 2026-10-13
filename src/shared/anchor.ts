/** Plain text with, for each character, its position in the source it came from. */
export type TextIndex = { text: string; map: number[] };

export type Anchor = { quote: string; prefix: string; suffix: string };

/** Characters of context stored on each side of a quote. */
export const CONTEXT = 32;

const STRAIGHT: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'",
  '“': '"', '”': '"', '„': '"', ' ': ' ',
};

/** Straightens quotes and collapses whitespace runs to one space, keeping each character's source position. */
export function buildIndex(chars: Iterable<{ ch: string; pos: number }>): TextIndex {
  let text = '';
  const map: number[] = [];
  let lastWasSpace = true;
  for (const { ch, pos } of chars) {
    const c = STRAIGHT[ch] ?? ch;
    if (/\s/.test(c)) {
      if (!lastWasSpace) {
        text += ' ';
        map.push(pos);
        lastWasSpace = true;
      }
      continue;
    }
    text += c;
    map.push(pos);
    lastWasSpace = false;
  }
  if (text.endsWith(' ')) {
    text = text.slice(0, -1);
    map.pop();
  }
  return { text, map };
}

export function indexString(s: string): TextIndex {
  const chars: { ch: string; pos: number }[] = [];
  for (let i = 0; i < s.length; i++) chars.push({ ch: s[i], pos: i });
  return buildIndex(chars);
}

export function normalize(s: string): string {
  return indexString(s).text;
}

/** A model's quote as plain words: Markdown marks, link targets, and line markers removed. */
export function cleanQuote(s: string): string {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/gm, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/(^|[^\w*\\])\*(?=\S)|(?<=[^\s\\])\*(?=[^\w*]|$)/g, '$1')
    .replace(/\\([!-/:-@[-`{-~])/g, '$1');
}

export function findAll(index: TextIndex, quote: string): number[] {
  const q = normalize(cleanQuote(quote));
  if (!q) return [];
  const out: number[] = [];
  for (let i = index.text.indexOf(q); i >= 0; i = index.text.indexOf(q, i + 1)) out.push(i);
  return out;
}

export function contextAt(index: TextIndex, start: number, length: number): { prefix: string; suffix: string } {
  return {
    prefix: index.text.slice(Math.max(0, start - CONTEXT), start),
    suffix: index.text.slice(start + length, start + length + CONTEXT),
  };
}

/** Where an anchor sits now: its only match, else the match whose surroundings fit best, else undefined. */
export function locate(index: TextIndex, anchor: Anchor): { start: number; end: number } | undefined {
  const hits = findAll(index, anchor.quote);
  if (!hits.length) return undefined;
  const length = normalize(cleanQuote(anchor.quote)).length;
  let best = hits[0];
  let bestScore = -1;
  if (hits.length > 1) {
    for (const h of hits) {
      const ctx = contextAt(index, h, length);
      const score = sharedEnd(ctx.prefix, anchor.prefix) + sharedStart(ctx.suffix, anchor.suffix);
      if (score > bestScore) {
        best = h;
        bestScore = score;
      }
    }
  }
  return { start: best, end: best + length };
}

export function toSource(index: TextIndex, range: { start: number; end: number }): { from: number; to: number } {
  return { from: index.map[range.start], to: index.map[range.end - 1] + 1 };
}

function sharedStart(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function sharedEnd(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}
