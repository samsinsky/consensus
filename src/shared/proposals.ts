import type { Proposal, ProposalStatus, Stance } from './types.js';

export const RESOLVED: ProposalStatus[] = ['accepted', 'rejected', 'not_chosen', 'dismissed'];

/** Ids of ranges that rewrite mostly the same text, grouped as versions in text order. Ranges that only clip or touch stay apart. */
export function groupOverlaps(ranges: { id: string; start: number; end: number }[]): string[][] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id, undefined, { numeric: true }));
  // Versions rewrite mostly the same text. A comma fix inside a paragraph rewrite is its own suggestion.
  const versions = (a: (typeof sorted)[number], b: (typeof sorted)[number]) => {
    const shared = Math.min(a.end, b.end) - Math.max(a.start, b.start);
    return shared > 0 && shared * 2 >= Math.max(a.end - a.start, b.end - b.start);
  };
  const groupOf = new Map<string, string[]>();
  const groups: string[][] = [];
  for (const r of sorted) {
    let mine = groupOf.get(r.id);
    if (!mine) {
      mine = [r.id];
      groups.push(mine);
      groupOf.set(r.id, mine);
    }
    for (const other of sorted) {
      if (other === r || !versions(r, other)) continue;
      const theirs = groupOf.get(other.id);
      if (theirs === mine) continue;
      if (!theirs) {
        mine.push(other.id);
        groupOf.set(other.id, mine);
        continue;
      }
      // Two groups meet: fold the later one into this one.
      for (const id of theirs) {
        mine.push(id);
        groupOf.set(id, mine);
      }
      groups.splice(groups.indexOf(theirs), 1);
    }
  }
  const order = new Map(sorted.map((r, i) => [r.id, i]));
  return groups.map((g) => g.sort((a, b) => order.get(a)! - order.get(b)!));
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
