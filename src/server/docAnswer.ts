import type { Stance, Strategy, Verdict } from '../shared/types.js';

export type ParsedAnswer = {
  proposals: { quote: string; replacement: string; reason: string }[];
  replies: { proposal: string; stance: Stance; text: string }[];
  note: string;
};

/** On failure, reason completes "Your answer …". */
export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };
export type ParseResult = Parsed<ParsedAnswer>;

const STANCES: Stance[] = ['agree', 'disagree', 'your_call'];

export function parseAnswer(text: string, knownIds: Set<string>): ParseResult {
  const data = readJson(text);
  return data.ok ? validate(data.value, knownIds) : data;
}

const VERDICTS: Verdict[] = ['send', 'revise', 'rethink', 'dont_send'];
const STRATEGY_FIELDS = ['goal', 'assessment', 'approach'] as const;

export function parseStrategy(text: string): Parsed<Strategy> {
  const data = readJson(text);
  if (!data.ok) return data;
  const o = data.value;
  if (!isObject(o)) return { ok: false, reason: 'had a JSON block that is not an object' };
  for (const field of STRATEGY_FIELDS) {
    if (typeof o[field] !== 'string' || !o[field].trim()) return { ok: false, reason: `had no "${field}" text` };
  }
  if (!VERDICTS.includes(o.verdict as Verdict)) {
    return { ok: false, reason: 'had a "verdict" other than "send", "revise", "rethink" or "dont_send"' };
  }
  return { ok: true, value: { goal: o.goal as string, verdict: o.verdict as Verdict, assessment: o.assessment as string, approach: o.approach as string } };
}

const OPEN = '<document>';
const CLOSE = '</document>';

/** A redraft: the last <document> block is the new text, and everything around it is the explanation. */
export function parseDraft(text: string): Parsed<{ markdown: string; note: string }> {
  const end = text.lastIndexOf(CLOSE);
  const start = end < 0 ? -1 : text.lastIndexOf(OPEN, end);
  if (start < 0) return { ok: false, reason: 'was missing the <document> tags' };
  const markdown = text.slice(start + OPEN.length, end).trim();
  if (!markdown) return { ok: false, reason: 'had an empty document' };
  return { ok: true, value: { markdown, note: (text.slice(0, start) + text.slice(end + CLOSE.length)).trim() } };
}

function readJson(text: string): Parsed<unknown> {
  const raw = lastJson(text);
  if (raw === undefined) return { ok: false, reason: 'was missing the JSON block' };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, reason: `had a JSON block that failed: ${(e as Error).message}` };
  }
}

function lastJson(text: string): string | undefined {
  const fenced = [...text.matchAll(/```json[^\n]*\n([\s\S]*?)```/g)];
  if (fenced.length) return fenced.at(-1)![1];
  // No fence: take the last balanced {...} that parses.
  for (let end = text.lastIndexOf('}'); end >= 0; end = text.lastIndexOf('}', end - 1)) {
    let depth = 0;
    for (let i = end; i >= 0; i--) {
      if (text[i] === '}') depth++;
      else if (text[i] === '{' && --depth === 0) {
        const candidate = text.slice(i, end + 1);
        try {
          JSON.parse(candidate);
          return candidate;
        } catch {
          break;
        }
      }
    }
  }
  return undefined;
}

function validate(data: unknown, knownIds: Set<string>): ParseResult {
  const fail = (reason: string): ParseResult => ({ ok: false, reason });
  if (!isObject(data)) return fail('had a JSON block that is not an object');
  const value: ParsedAnswer = { proposals: [], replies: [], note: '' };

  const proposals = data.proposals ?? [];
  if (!Array.isArray(proposals)) return fail('had "proposals" that is not a list');
  for (const p of proposals) {
    if (!isObject(p) || typeof p.quote !== 'string' || typeof p.replacement !== 'string' || typeof p.reason !== 'string') {
      return fail('had a proposal without "quote", "replacement" and "reason" text');
    }
    if (!p.quote.trim()) return fail('had a proposal with an empty "quote"');
    value.proposals.push({ quote: p.quote, replacement: p.replacement, reason: p.reason });
  }

  const replies = data.replies ?? [];
  if (!Array.isArray(replies)) return fail('had "replies" that is not a list');
  for (const r of replies) {
    if (!isObject(r) || typeof r.proposal !== 'string' || typeof r.text !== 'string') return fail('had a reply without "proposal" and "text"');
    if (!STANCES.includes(r.stance as Stance)) return fail('had a reply with a stance other than "agree", "disagree" or "your_call"');
    // A reply to a proposal the model invented or misremembered is dropped, not fatal.
    if (knownIds.has(r.proposal)) value.replies.push({ proposal: r.proposal, stance: r.stance as Stance, text: r.text });
  }

  if (data.note !== undefined && typeof data.note !== 'string') return fail('had a "note" that is not text');
  value.note = (data.note as string | undefined) ?? '';
  return { ok: true, value };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
