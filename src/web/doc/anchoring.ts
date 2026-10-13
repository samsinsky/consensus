import { locate, toSource, type TextIndex } from '../../shared/anchor.js';
import { groupOverlaps, isYourCall } from '../../shared/proposals.js';
import type { Proposal } from '../../shared/types.js';

export type Placed = { proposal: Proposal; from: number; to: number };
export type Group = { key: string; options: Placed[]; yourCall: boolean };

/** Anchors open proposals against the live text. Overlapping ones form groups; ones whose text is gone are out of date. */
export function placeProposals(proposals: Proposal[], index: TextIndex): { groups: Group[]; stale: Proposal[] } {
  const placed = new Map<string, Placed>();
  const ranges: { id: string; start: number; end: number }[] = [];
  const stale: Proposal[] = [];
  for (const p of proposals) {
    if (p.status !== 'open') continue;
    const at = locate(index, p);
    if (!at) {
      stale.push(p);
      continue;
    }
    placed.set(p.id, { proposal: p, ...toSource(index, at) });
    ranges.push({ id: p.id, ...at });
  }
  const groups = groupOverlaps(ranges).map((ids) => {
    const options = ids.map((id) => placed.get(id)!);
    return { key: ids[0], options, yourCall: isYourCall(options.map((o) => o.proposal)) };
  });
  return { groups, stale };
}

/** The option a group shows inline: the one Sam picked, else the first. */
export function shownOption(group: Group, picked: Set<string>): Placed {
  return group.options.find((o) => picked.has(o.proposal.id)) ?? group.options[0];
}
