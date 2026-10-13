import { describe, expect, it } from 'vitest';
import { parseAnswer } from '../../src/server/docAnswer.js';

const known = new Set(['P1', 'P2']);
const block = (o: unknown) => '```json\n' + JSON.stringify(o, null, 2) + '\n```';

describe('parseAnswer', () => {
  it('reads the last fenced JSON block after the prose', () => {
    const text = `Overall this works.\n\n${block({ proposals: [], note: 'old' })}\n\nOn reflection:\n\n${block({
      proposals: [{ quote: 'gone deep on', replacement: 'gained', reason: 'Plainer.' }],
      replies: [{ proposal: 'P1', stance: 'your_call', text: 'Taste.' }],
      note: 'Strong opening.',
    })}`;
    expect(parseAnswer(text, known)).toEqual({
      ok: true,
      value: {
        proposals: [{ quote: 'gone deep on', replacement: 'gained', reason: 'Plainer.' }],
        replies: [{ proposal: 'P1', stance: 'your_call', text: 'Taste.' }],
        note: 'Strong opening.',
      },
    });
  });

  it('falls back to a bare JSON object', () => {
    const r = parseAnswer('Here: {"proposals": [], "replies": [], "note": "Fine."} Done.', known);
    expect(r).toEqual({ ok: true, value: { proposals: [], replies: [], note: 'Fine.' } });
  });

  it('treats missing lists and note as empty', () => {
    expect(parseAnswer(block({}), known)).toEqual({ ok: true, value: { proposals: [], replies: [], note: '' } });
  });

  it('drops replies to unknown proposals', () => {
    const r = parseAnswer(block({ replies: [{ proposal: 'P9', stance: 'agree', text: 'x' }] }), known);
    expect(r).toEqual({ ok: true, value: { proposals: [], replies: [], note: '' } });
  });

  it('explains what is wrong', () => {
    expect(parseAnswer('No JSON here.', known)).toEqual({ ok: false, reason: 'was missing the JSON block' });
    expect(parseAnswer('```json\n{ "proposals": [ }\n```', known)).toMatchObject({ ok: false, reason: expect.stringMatching(/^had a JSON block that failed: /) });
    expect(parseAnswer(block({ proposals: [{ quote: 'x' }] }), known)).toEqual({ ok: false, reason: 'had a proposal without "quote", "replacement" and "reason" text' });
    expect(parseAnswer(block({ proposals: [{ quote: ' ', replacement: '', reason: 'r' }] }), known)).toEqual({ ok: false, reason: 'had a proposal with an empty "quote"' });
    expect(parseAnswer(block({ replies: [{ proposal: 'P1', stance: 'maybe', text: 'x' }] }), known)).toEqual({ ok: false, reason: 'had a reply with a stance other than "agree", "disagree" or "your_call"' });
    expect(parseAnswer(block([1, 2]), known)).toEqual({ ok: false, reason: 'had a JSON block that is not an object' });
  });
});
