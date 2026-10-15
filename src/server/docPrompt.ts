import type { DocState, Proposal, ProposalReply, Round } from '../shared/types.js';

export const ROUND_TASK =
  'What to do:\n' +
  '1. Propose changes only to fix real problems: errors, unclear writing, or anything that misses the brief. If a change comes down to taste, leave it.\n' +
  '2. Reply to each open proposal you didn\'t write: agree, disagree with a reason, or "your call" when it comes down to taste.\n' +
  '3. Leave one short note on the whole draft: structure, direction, and anything line edits would miss.\n' +
  "4. Don't rewrite the whole document.\n\n" +
  'End your answer with one JSON block in exactly this shape:\n' +
  '```json\n' +
  '{\n' +
  '  "proposals": [{ "quote": "exact words from the document", "replacement": "new words", "reason": "one or two sentences" }],\n' +
  '  "replies": [{ "proposal": "P4", "stance": "agree" | "disagree" | "your_call", "text": "one or two sentences" }],\n' +
  '  "note": "your note on the whole draft"\n' +
  '}\n' +
  '```\n' +
  'For "quote", copy the exact words from the document without formatting marks, long enough to appear only once. ' +
  'To delete text, use an empty replacement. To add text, quote the words it follows and include them in the replacement.';

export const STRATEGY_TASK =
  'This is a strategy review. Step back from the wording and judge the draft as a whole. Make no line edits.\n' +
  'Think it through:\n' +
  '1. Goal: what am I trying to achieve, and who reads this? If the brief leaves it unclear, say what you assume. If you think the goal itself is wrong, say so.\n' +
  "2. Does this draft get me there? Weigh whether to send anything at all, the format, what to say and what to leave out, the order, and the tone. Don't stop at the wording.\n" +
  '3. What would you do instead? Be concrete: a different structure, different content, a different format, or not sending it. Starting over is fine.\n' +
  '4. If other reviewers\' takes are shown, weigh them: agree, push back, or change your mind, and say which.\n' +
  "Give your honest verdict. If you wouldn't send this, say so plainly. Don't soften a rethink into a revise.\n\n" +
  'End your answer with one JSON block in exactly this shape:\n' +
  '```json\n' +
  '{\n' +
  '  "goal": "the goal and audience, in a sentence",\n' +
  '  "verdict": "send" | "revise" | "rethink" | "dont_send",\n' +
  '  "assessment": "a short paragraph on whether the draft gets there, and why",\n' +
  '  "approach": "what you would do, concrete enough to draft from"\n' +
  '}\n' +
  '```\n' +
  'Verdicts: "send" means it works, with small fixes at most. "revise" means keep the approach and fix real problems. ' +
  '"rethink" means the structure, content or approach has to change. "dont_send" means I shouldn\'t send this at all; "approach" then says what to do instead.';

export const DRAFT_TASK =
  'Write a new version of the document that follows the direction. You may restructure, cut, add or start over: the direction matters more than the current wording. ' +
  "Keep the facts from the brief and the current document, and don't invent new ones; use placeholders such as [date] for anything you don't know.\n" +
  'First explain in a few sentences what you changed and why. Then put the complete new document, in Markdown, between <document> and </document> tags.';

export type RoundInput = {
  doc: DocState;
  round: number;
  receiver: string;
  /** Brief attachments, already rendered. */
  briefBlocks: string[];
  /** When the receiver's previous round was sent; absent on its first review. */
  since?: string;
};

const STANCE_LABEL = { agree: 'agree', disagree: 'disagree', your_call: 'your call' } as const;

function briefBlock(doc: DocState, briefBlocks: string[], withDirection: boolean): string[] {
  const blocks = [`Brief:\n<brief>\n${doc.brief.trim()}\n</brief>`, ...briefBlocks];
  if (withDirection && doc.direction?.trim()) blocks.push(`Direction I chose:\n<direction>\n${doc.direction.trim()}\n</direction>`);
  return blocks;
}

export function composeRound({ doc, round, receiver, briefBlocks, since }: RoundInput): string {
  const blocks = [
    ...briefBlock(doc, briefBlocks, true),
    `Document (round ${round}):\n<document>\n${doc.markdown}\n</document>`,
  ];
  const open = doc.proposals.filter((p) => p.status === 'open');
  if (open.length) blocks.push(`Open proposals:\n${open.map((p) => proposalBlock(p, receiver)).join('\n')}`);
  const rejected = doc.proposals.filter(
    (p) => (p.status === 'rejected' || p.status === 'not_chosen') && !!p.resolvedAt && (!since || p.resolvedAt > since),
  );
  if (rejected.length) blocks.push(`Rejected since your last review:\n${rejected.map(rejectedLine).join('\n')}`);
  blocks.push(ROUND_TASK);
  return blocks.join('\n\n');
}

/** A strategy round; previous is the last strategy round, whose takes every reviewer now sees. */
export function composeStrategy({ doc, round, receiver, briefBlocks, previous }: Omit<RoundInput, 'since'> & { previous?: Round }): string {
  const blocks = [...briefBlock(doc, briefBlocks, false), `Document (round ${round}):\n<document>\n${doc.markdown}\n</document>`];
  const takes = (previous?.participants ?? []).flatMap((id) => {
    const t = previous!.notes[id]?.strategy;
    if (!t) return [];
    const by = id === receiver ? 'you' : 'another reviewer';
    return [`<take by="${by}" verdict="${t.verdict}">\nGoal: ${t.goal}\nAssessment: ${t.assessment}\nApproach: ${t.approach}\n</take>`];
  });
  if (takes.length) blocks.push(`Takes from the last strategy round:\n${takes.join('\n')}`);
  blocks.push(STRATEGY_TASK);
  return blocks.join('\n\n');
}

export function composeDraft({ doc, briefBlocks }: { doc: DocState; briefBlocks: string[] }): string {
  return [...briefBlock(doc, briefBlocks, true), `Current document:\n<document>\n${doc.markdown}\n</document>`, DRAFT_TASK].join('\n\n');
}

export function repairMessage(reason: string): string {
  return `Your answer ${reason}. Reply with only the JSON block.`;
}

function proposalBlock(p: Proposal, receiver: string): string {
  const by = p.authors.includes(receiver) ? 'you' : 'another reviewer';
  const lines = [`<proposal id="${p.id}" by="${by}">`, `Replace: "${p.quote}"`, `With: "${p.replacement}"`, `Reason: ${p.reason}`];
  if (p.replies.length) {
    lines.push('Replies:');
    for (const r of p.replies) lines.push(`- ${speaker(r, receiver)}${r.stance ? ` (${STANCE_LABEL[r.stance]})` : ''}: ${r.text}`);
  }
  lines.push('</proposal>');
  return lines.join('\n');
}

function speaker(r: ProposalReply, receiver: string): string {
  if (r.from === 'user') return 'Me';
  return r.from === receiver ? 'You' : 'Another reviewer';
}

function rejectedLine(p: Proposal): string {
  const mine = [...p.replies].reverse().find((r) => r.from === 'user');
  return `- ${p.id}: "${p.quote}" → "${p.replacement}"${mine ? ` (my reply: ${mine.text})` : ''}`;
}
