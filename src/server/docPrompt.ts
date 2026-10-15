import type { DocState, Proposal, ProposalReply } from '../shared/types.js';

export const ROUND_TASK =
  'What to do, in this order:\n' +
  '1. Think about strategy first, fresh every round, even if you liked an earlier draft. What is this for, and who reads it? ' +
  'Come up with two or three materially different ways to do it, such as a different example, angle or structure, or not sending it at all, and weigh them against the draft.\n' +
  '2. Give a verdict. "send": it works, with small fixes at most. "revise": keep the approach and fix real problems. ' +
  '"rethink": the structure, content or approach has to change. "dont_send": I shouldn\'t send this at all.\n' +
  '3. Leave a note on the whole draft that explains your verdict. Big calls go here: change the flow, start over, don\'t send. ' +
  'If the piece should start over, explain the new direction in your note instead of rewriting it.\n' +
  '4. Propose changes of any size, biggest first. A suggestion can fix a comma or rewrite a whole paragraph around a better example. ' +
  "Don't polish wording in a section you're proposing to replace. If a change comes down to taste, leave it.\n" +
  '5. Reply to each open proposal you didn\'t write: agree, disagree with a reason, or "your call" when it comes down to taste.\n\n' +
  'End your answer with one JSON block in exactly this shape:\n' +
  '```json\n' +
  '{\n' +
  '  "verdict": "send" | "revise" | "rethink" | "dont_send",\n' +
  '  "note": "your note on the whole draft",\n' +
  '  "proposals": [{ "quote": "exact words from the document", "replacement": "new words", "reason": "one or two sentences" }],\n' +
  '  "replies": [{ "proposal": "P4", "stance": "agree" | "disagree" | "your_call", "text": "one or two sentences" }]\n' +
  '}\n' +
  '```\n' +
  'For "quote", copy the exact words from the document without formatting marks, long enough to appear only once. ' +
  'To delete text, use an empty replacement. To add text, quote the words it follows and include them in the replacement.';

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

export function composeRound({ doc, round, receiver, briefBlocks, since }: RoundInput): string {
  const blocks = [
    `Brief:\n<brief>\n${doc.brief.trim()}\n</brief>`,
    ...briefBlocks,
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
