import type { Proposal, ProposalStatus, Stance } from './types.js';

export const RESOLVED: ProposalStatus[] = ['accepted', 'rejected', 'not_chosen', 'dismissed'];

/** Ids of ranges that overlap, grouped in text order. Ranges that only touch stay apart. */
export function groupOverlaps(ranges: { id: string; start: number; end: number }[]): string[][] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id, undefined, { numeric: true }));
  const groups: string[][] = [];
  let end = -Infinity;
  for (const r of sorted) {
    if (groups.length && r.start < end) {
      groups.at(-1)!.push(r.id);
      end = Math.max(end, r.end);
    } else {
      groups.push([r.id]);
      end = r.end;
    }
  }
  return groups;
}

/** Each participant's latest stance on a proposal. */
export function stances(p: Proposal): Map<string, Stance> {
  const out = new Map<string, Stance>();
  for (const r of p.replies) if (r.from !== 'user' && r.stance) out.set(r.from, r.stance);
  return out;
}

/** Who agrees and who disagrees: authors always agree, others by their latest stance. */
export function stanceVoters(p: Proposal): { agree: string[]; disagree: string[] } {
  const agree = [...p.authors];
  const disagree: string[] = [];
  for (const [from, s] of stances(p)) {
    if (p.authors.includes(from)) continue;
    if (s === 'agree') agree.push(from);
    if (s === 'disagree') disagree.push(from);
  }
  return { agree, disagree };
}

export function stanceCounts(p: Proposal): { agree: number; disagree: number } {
  const { agree, disagree } = stanceVoters(p);
  return { agree: agree.length, disagree: disagree.length };
}

export function isYourCall(group: Proposal[]): boolean {
  return group.some((p) => [...stances(p).values()].includes('your_call'));
}
