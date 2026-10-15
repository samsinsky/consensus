import { describe, expect, it } from 'vitest';
import { parseAnswer, parseDraft, parseStrategy } from '../../src/server/docAnswer.js';

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

describe('parseStrategy', () => {
  const take = { goal: 'Win a PM interview', verdict: 'rethink', assessment: 'Reads like a résumé.', approach: 'Lead with one story.' };

  it('reads the four fields', () => {
    expect(parseStrategy(`Thinking it over.\n\n${block(take)}`)).toEqual({ ok: true, value: take });
  });

  it('accepts every verdict', () => {
    for (const verdict of ['send', 'revise', 'rethink', 'dont_send']) {
      expect(parseStrategy(block({ ...take, verdict })).ok).toBe(true);
    }
  });

  it('rejects an unknown verdict', () => {
    expect(parseStrategy(block({ ...take, verdict: 'maybe' }))).toEqual({
      ok: false,
      reason: 'had a "verdict" other than "send", "revise", "rethink" or "dont_send"',
    });
  });

  it('rejects a missing field', () => {
    const { approach: _, ...rest } = take;
    expect(parseStrategy(block(rest))).toEqual({ ok: false, reason: 'had no "approach" text' });
  });
});

describe('parseDraft', () => {
  it('splits the explanation from the document', () => {
    expect(parseDraft('I led with the story.\n\n<document>\n# Hi\n\nNew text.\n</document>\n')).toEqual({
      ok: true,
      value: { markdown: '# Hi\n\nNew text.', note: 'I led with the story.' },
    });
  });

  it('takes the last document when the model repeats itself', () => {
    const r = parseDraft('Plan: <document>draft</document>\nFinal:\n<document>final</document>\nDone.');
    expect(r).toEqual({ ok: true, value: { markdown: 'final', note: 'Plan: <document>draft</document>\nFinal:\n\nDone.' } });
  });

  it('fails without document tags or with an empty document', () => {
    expect(parseDraft('Here it is.')).toEqual({ ok: false, reason: 'was missing the <document> tags' });
    expect(parseDraft('<document>\n \n</document>')).toEqual({ ok: false, reason: 'had an empty document' });
  });
});
