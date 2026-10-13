import { describe, expect, it } from 'vitest';
import { composeRound, repairMessage, ROUND_TASK } from '../../src/server/docPrompt.js';
import type { DocState, Proposal } from '../../src/shared/types.js';

const prop = (over: Partial<Proposal>): Proposal => ({
  id: 'P1', round: 1, authors: ['a'], quote: 'gone deep on', prefix: '', suffix: '', replacement: 'gained experience with',
  reason: 'Plainer.', status: 'open', replies: [], ...over,
});

const doc = (over: Partial<DocState> = {}): DocState => ({
  brief: 'LinkedIn bio for PM roles', markdown: 'I have gone deep on LLMs.', savedAt: '', revision: 0,
  included: ['a', 'b'], rounds: [], proposals: [], nextProposal: 1, ...over,
});

describe('composeRound', () => {
  it('sends the brief, attachments, document and task on a first round', () => {
    expect(composeRound({ doc: doc(), round: 1, receiver: 'a', briefBlocks: ['<attachment name="x.md">\nX\n</attachment>'] })).toBe(
      'Brief:\n<brief>\nLinkedIn bio for PM roles\n</brief>\n\n' +
        '<attachment name="x.md">\nX\n</attachment>\n\n' +
        'Document (round 1):\n<document>\nI have gone deep on LLMs.\n</document>\n\n' +
        ROUND_TASK,
    );
  });

  it('labels open proposals and replies without naming providers', () => {
    const open = prop({
      authors: ['b'],
      replies: [
        { from: 'a', stance: 'disagree', text: 'Weaker verb.', at: '' },
        { from: 'user', text: 'Leaning B.', at: '' },
        { from: 'c', stance: 'your_call', text: 'Taste.', at: '' },
      ],
    });
    const mine = prop({ id: 'P2', authors: ['a'], quote: 'LLMs', replacement: 'language models', reason: 'Spell it out.' });
    const sent = composeRound({ doc: doc({ proposals: [open, mine] }), round: 2, receiver: 'a', briefBlocks: [] });
    expect(sent).toContain(
      'Open proposals:\n' +
        '<proposal id="P1" by="another reviewer">\nReplace: "gone deep on"\nWith: "gained experience with"\nReason: Plainer.\nReplies:\n' +
        '- You (disagree): Weaker verb.\n- Me: Leaning B.\n- Another reviewer (your call): Taste.\n</proposal>\n' +
        '<proposal id="P2" by="you">\nReplace: "LLMs"\nWith: "language models"\nReason: Spell it out.\n</proposal>',
    );
    expect(sent).not.toMatch(/Claude|ChatGPT|Gemini|codex/);
  });

  it('lists proposals rejected since the receiver last reviewed, with my latest reply', () => {
    const old = prop({ id: 'P1', status: 'rejected', resolvedAt: '2026-10-13T10:00:00Z' });
    const recent = prop({ id: 'P2', status: 'rejected', resolvedAt: '2026-10-13T12:00:00Z', replies: [{ from: 'user', text: 'Keep mine.', at: '' }] });
    const lost = prop({ id: 'P3', status: 'not_chosen', resolvedAt: '2026-10-13T12:30:00Z', quote: 'LLMs', replacement: 'models' });
    const accepted = prop({ id: 'P4', status: 'accepted', resolvedAt: '2026-10-13T12:30:00Z' });
    const sent = composeRound({ doc: doc({ proposals: [old, recent, lost, accepted] }), round: 3, receiver: 'a', briefBlocks: [], since: '2026-10-13T11:00:00Z' });
    expect(sent).toContain(
      'Rejected since your last review:\n' +
        '- P2: "gone deep on" → "gained experience with" (my reply: Keep mine.)\n' +
        '- P3: "LLMs" → "models"',
    );
    expect(sent).not.toContain('- P1:');
    expect(sent).not.toContain('- P4:');
  });

  it('lists every rejected proposal on a participant\'s first review', () => {
    const old = prop({ status: 'rejected', resolvedAt: '2026-10-13T10:00:00Z' });
    expect(composeRound({ doc: doc({ proposals: [old] }), round: 2, receiver: 'c', briefBlocks: [] })).toContain('- P1: "gone deep on"');
  });
});

describe('ROUND_TASK', () => {
  it('asks for fixes only, replies, one note, no full rewrite, and the JSON block', () => {
    expect(ROUND_TASK).toContain('Propose changes only to fix real problems');
    expect(ROUND_TASK).toContain('"your call" when it comes down to taste');
    expect(ROUND_TASK).toContain("Don't rewrite the whole document.");
    expect(ROUND_TASK).toContain('```json');
  });
});

describe('repairMessage', () => {
  it('names the problem and asks for only the JSON block', () => {
    expect(repairMessage('was missing the JSON block')).toBe('Your answer was missing the JSON block. Reply with only the JSON block.');
  });
});
