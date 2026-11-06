import { useState } from 'react';
import type { Participant, Proposal } from '../../shared/types.js';
import { authorLabel } from './ProposalCard.js';
import { RefText } from './proposalRefs.js';

const STATUS = { accepted: 'Accepted', rejected: 'Rejected', not_chosen: 'Not chosen', dismissed: 'Dismissed', superseded: 'Superseded', open: 'Open' } as const;

export function ResolvedList({ proposals, participants }: { proposals: Proposal[]; participants: Participant[] }) {
  const [open, setOpen] = useState(false);
  if (!proposals.length) return null;
  return (
    <div className="resolved">
      <button className="ghost" onClick={() => setOpen((o) => !o)}>{proposals.length} resolved</button>
      {open && (
        <ul>
          {proposals.map((p) => (
            <li key={p.id}>
              {STATUS[p.status]} · {authorLabel(p.authors, participants)}: "{p.quote}" → "{p.replacement}"
              {p.replies.length ? <ul className="replies">{p.replies.map((r, i) => <li key={i}>{r.from === 'user' ? 'You' : authorLabel([r.from], participants)}: <RefText text={r.text} /></li>)}</ul> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
