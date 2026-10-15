import type { DocState, Proposal, ProposalReply } from '../shared/types.js';

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
