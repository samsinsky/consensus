import { createContext, useContext, type MouseEvent, type ReactNode } from 'react';
import type { Proposal } from '../../shared/types.js';

// Reviewers name proposals by id ("I disagree with P4"). The UI never shows ids, so show the words each one changes instead.

const REF = /\bP\d+\b/g;
const WORDS = 4;
const STATUS = { open: 'Open', accepted: 'Accepted', rejected: 'Rejected', not_chosen: 'Not chosen', dismissed: 'Dismissed', superseded: 'Superseded' } as const;
const HASH = '#proposal-';

export type Ref = { proposal: Proposal };
type RefsContext = { proposals: Proposal[]; onJump: (id: string) => void };

export const ProposalRefs = createContext<RefsContext | undefined>(undefined);

/** Text split around the ids of proposals that exist; ids that match nothing stay as text. */
export function splitRefs(text: string, proposals: Proposal[]): (string | Ref)[] {
  const out: (string | Ref)[] = [];
  let last = 0;
  for (const m of text.matchAll(REF)) {
    const proposal = proposals.find((p) => p.id === m[0]);
    if (!proposal) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ proposal });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** The first few words a proposal changes, or adds when it quotes nothing. */
export function excerpt(quote: string, replacement = ''): string {
  const words = (quote.trim() || replacement.trim()).split(/\s+/);
  const cut = words.length > WORDS;
  const head = words.slice(0, WORDS).join(' ');
  return `“${cut ? `${head.replace(/[,.;:!?—–-]+$/, '')}…` : head}”`;
}

/** Plain text with each proposal id swapped for its excerpt, for one-line previews. */
export function refsAsText(text: string, proposals: Proposal[]): string {
  return splitRefs(text, proposals).map((part) => (typeof part === 'string' ? part : excerpt(part.proposal.quote, part.proposal.replacement))).join('');
}

/** Markdown with proposal ids as in-page links, for renderers that take Markdown. */
export function linkRefs(md: string, proposals: Proposal[]): string {
  return md.replace(REF, (id) => (proposals.some((p) => p.id === id) ? `[${id}](${HASH}${id})` : id));
}

export function RefText({ text }: { text: string }) {
  const ctx = useContext(ProposalRefs);
  if (!ctx) return <>{text}</>;
  return <>{splitRefs(text, ctx.proposals).map((part, i) => (typeof part === 'string' ? part : <RefChip key={i} proposal={part.proposal} />))}</>;
}

/** react-markdown's link renderer: proposal links become chips, other links stay links. */
export function RefLink({ href, children }: { href?: string; children?: ReactNode }) {
  const ctx = useContext(ProposalRefs);
  const proposal = href?.startsWith(HASH) ? ctx?.proposals.find((p) => p.id === href.slice(HASH.length)) : undefined;
  if (proposal) return <RefChip proposal={proposal} />;
  return <a href={href}>{children}</a>;
}

function RefChip({ proposal: p }: { proposal: Proposal }) {
  const ctx = useContext(ProposalRefs);
  const open = p.status === 'open';
  const title = `${p.id} · ${STATUS[p.status]}\n"${p.quote}" → "${p.replacement}"`;
  const jump = (e: MouseEvent) => {
    e.stopPropagation();
    if (open) ctx?.onJump(p.id);
  };
  return <span className={`prop-ref${open ? '' : ' resolved'}`} title={title} role={open ? 'button' : undefined} onClick={jump}>{excerpt(p.quote, p.replacement)}</span>;
}
