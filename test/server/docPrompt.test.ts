import { describe, expect, it } from 'vitest';
import { composeDraft, composeRound, composeStrategy, DRAFT_TASK, repairMessage, ROUND_TASK, STRATEGY_TASK } from '../../src/server/docPrompt.js';
import type { DocState, Proposal, Round, Strategy } from '../../src/shared/types.js';

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

describe('composeRound with a direction', () => {
  it('puts the chosen direction after the brief', () => {
    const sent = composeRound({ doc: doc({ direction: 'Lead with one story.' }), round: 3, receiver: 'a', briefBlocks: [] });
    expect(sent).toContain('</brief>\n\nDirection I chose:\n<direction>\nLead with one story.\n</direction>\n\nDocument (round 3)');
  });
});

describe('composeStrategy', () => {
  const take = (over: Partial<Strategy> = {}): Strategy => ({
    goal: 'Get a PM interview', verdict: 'rethink', assessment: 'Too long.', approach: 'One story.', ...over,
  });

  it('sends the brief, document and strategy task on a first take', () => {
    expect(composeStrategy({ doc: doc(), round: 1, receiver: 'a', briefBlocks: [] })).toBe(
      'Brief:\n<brief>\nLinkedIn bio for PM roles\n</brief>\n\n' +
        'Document (round 1):\n<document>\nI have gone deep on LLMs.\n</document>\n\n' +
        STRATEGY_TASK,
    );
  });

  it('shares the previous strategy round, the receiver\'s own take marked as theirs', () => {
    const previous: Round = {
      n: 1, kind: 'strategy', sentAt: '', snapshot: '', participants: ['a', 'b', 'c'],
      notes: {
        a: { status: 'done', strategy: take() },
        b: { status: 'done', strategy: take({ verdict: 'send', assessment: 'Fine as is.', approach: 'Send it.' }) },
        c: { status: 'error' },
      },
    };
    const sent = composeStrategy({ doc: doc(), round: 2, receiver: 'a', briefBlocks: [], previous });
    expect(sent).toContain(
      'Takes from the last strategy round:\n' +
        '<take by="you" verdict="rethink">\nGoal: Get a PM interview\nAssessment: Too long.\nApproach: One story.\n</take>\n' +
        '<take by="another reviewer" verdict="send">\nGoal: Get a PM interview\nAssessment: Fine as is.\nApproach: Send it.\n</take>',
    );
    expect(sent.endsWith(STRATEGY_TASK)).toBe(true);
  });
});

describe('STRATEGY_TASK', () => {
  it('asks for the big picture, allows not sending, forbids edits, and names the JSON shape', () => {
    expect(STRATEGY_TASK).toMatch(/goal/i);
    expect(STRATEGY_TASK).toContain('"dont_send"');
    expect(STRATEGY_TASK).toMatch(/no line edits/i);
    expect(STRATEGY_TASK).toContain('"approach"');
  });
});

describe('composeDraft', () => {
  it('sends the brief, the direction, the document and the draft task', () => {
    expect(composeDraft({ doc: doc({ direction: 'One story.' }), briefBlocks: [] })).toBe(
      'Brief:\n<brief>\nLinkedIn bio for PM roles\n</brief>\n\n' +
        'Direction I chose:\n<direction>\nOne story.\n</direction>\n\n' +
        'Current document:\n<document>\nI have gone deep on LLMs.\n</document>\n\n' +
        DRAFT_TASK,
    );
  });

  it('asks for the whole new document between tags', () => {
    expect(DRAFT_TASK).toContain('<document>');
    expect(DRAFT_TASK).toMatch(/placeholder/i);
  });
});
