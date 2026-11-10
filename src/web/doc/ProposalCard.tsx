import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { participantLabel } from '../../shared/labels.js';
import { stanceVoters } from '../../shared/proposals.js';
import type { Participant, Proposal, ProposalReply } from '../../shared/types.js';
import { useAutoGrow } from '../useAutoGrow.js';
import type { Group } from './anchoring.js';
import { RefText } from './proposalRefs.js';
import { Dot } from '../components/Dot.js';

const LETTERS = 'ABCDEFGHIJ';
const STANCE = { agree: 'agree', disagree: 'disagree', your_call: 'your call' } as const;

export function authorLabel(ids: string[], all: Participant[]): string {
  return ids
    .map((id) => {
      const p = all.find((x) => x.id === id);
      return p ? participantLabel(p, all) : 'Removed participant';
    })
    .join(' and ');
}

type Props = {
  group: Group;
  shown: string;
  participants: Participant[];
  focused: boolean;
  onFocus: () => void;
  onPickOption: (id: string) => void;
  onAccept: (id: string, replacement: string) => void;
  onReject: (ids: string[]) => void;
  onReply: (id: string, text: string) => Promise<void>;
  onEditReplacement: (id: string, text: string) => void;
};

export function ProposalCard({ group, shown, participants, focused, onFocus, onPickOption, onAccept, onReject, onReply, onEditReplacement }: Props) {
  const options = group.options.map((o) => o.proposal);
  const current = options.find((p) => p.id === shown) ?? options[0];
  const index = options.indexOf(current);
  const [draft, setDraft] = useState(current.replacement);
  const draftBox = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(draftBox, draft);
  useEffect(() => setDraft(current.replacement), [current.id, current.replacement]);
  const many = options.length > 1;

  return (
    <div className={`card${focused ? ' focused' : ''}`} onClick={onFocus}>
      <div className="card-head">
        {many ? <strong>{options.length} versions</strong> : <Author p={current} all={participants} />}
        {group.yourCall && <span className="tag your-call">Your call</span>}
      </div>
      {many ? (
        options.map((p, i) => (
          <label key={p.id} className="option">
            <input type="radio" name={`opt-${group.key}`} checked={p.id === current.id} onChange={() => onPickOption(p.id)} />
            <span>
              {LETTERS[i]} · <Author p={p} all={participants} /> <Counts p={p} all={participants} />
              <span className="option-text">"{p.replacement}"</span>
              <span className="reason">{p.reason}</span>
            </span>
          </label>
        ))
      ) : (
        <>
          <p className="reason">{current.reason} <Counts p={current} all={participants} /></p>
        </>
      )}
      <textarea
        ref={draftBox}
        className="replacement"
        rows={1}
        value={draft}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== current.replacement && onEditReplacement(current.id, draft)}
      />
      <Replies replies={current.replies} participants={participants} />
      <div className="card-actions">
        <button onClick={(e) => { e.stopPropagation(); onAccept(current.id, draft); }}>{many ? `Accept ${LETTERS[index]}` : 'Accept'}</button>
        <button onClick={(e) => { e.stopPropagation(); onReject(options.map((p) => p.id)); }}>{many ? 'Reject all' : 'Reject'}</button>
      </div>
      <ReplyBox onSend={(text) => onReply(current.id, text)} />
    </div>
  );
}

export function StaleCard({ proposal, participants, onDismiss }: { proposal: Proposal; participants: Participant[]; onDismiss: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button className="card stale stale-line" onClick={() => setOpen(true)}>
        <Author p={proposal} all={participants} /> <span className="tag">Text changed</span>
      </button>
    );
  }
  return (
    <div className="card stale">
      <div className="card-head"><span onClick={() => setOpen(false)} title="Collapse"><Author p={proposal} all={participants} /> <span className="tag">Text changed</span></span></div>
      <p className="option-text">"{proposal.quote}" → "{proposal.replacement}"</p>
      <div className="card-actions"><button onClick={() => onDismiss(proposal.id)}>Dismiss</button></div>
    </div>
  );
}

function Author({ p, all }: { p: Proposal; all: Participant[] }) {
  return <span className="author"><Dot p={all.find((x) => x.id === p.authors[0])} all={all} /> {authorLabel(p.authors, all)}</span>;
}

function Counts({ p, all }: { p: Proposal; all: Participant[] }) {
  const { agree, disagree } = stanceVoters(p);
  const name = (id: string) => `${authorLabel([id], all)}${p.authors.includes(id) ? ' (proposed)' : ''}`;
  const tip = (title: string, ids: string[]) => [title, ...(ids.length ? ids.map(name) : ['No one'])].join('\n');
  return (
    <span className="counts">
      <Vote tip={tip('Agree', agree)}>✓{agree.length}</Vote>{' '}
      <Vote tip={tip('Disagree', disagree)}>✗{disagree.length}</Vote>
    </span>
  );
}

/** A count that lists its voters on hover, in a popup fixed to the window so the margin's scroll box can't clip it. */
function Vote({ tip, children }: { tip: string; children: ReactNode }) {
  const [at, setAt] = useState<{ top: number; left: number }>();
  const show = (e: MouseEvent<HTMLSpanElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setAt({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 288)) });
  };
  return (
    <span className="vote" data-tip={tip} onMouseEnter={show} onMouseLeave={() => setAt(undefined)}>
      {children}
      {at && <span className="vote-tip" style={at}>{tip}</span>}
    </span>
  );
}

function Replies({ replies, participants }: { replies: ProposalReply[]; participants: Participant[] }) {
  if (!replies.length) return null;
  return (
    <ul className="replies">
      {replies.map((r, i) => (
        <li key={i}>
          {r.from === 'user' ? 'You' : authorLabel([r.from], participants)}
          {r.stance ? ` (${STANCE[r.stance]})` : ''}: <RefText text={r.text} />
        </li>
      ))}
    </ul>
  );
}

function ReplyBox({ onSend }: { onSend: (text: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const replyBox = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(replyBox, text);
  const [error, setError] = useState<string>();
  const send = async () => {
    if (!text.trim()) return;
    try {
      await onSend(text);
      setText('');
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="reply-box" onClick={(e) => e.stopPropagation()}>
      <textarea
        ref={replyBox}
        rows={1}
        placeholder="Reply…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      {error && <span className="error-inline">{error}</span>}
    </div>
  );
}
