import { useContext, useState } from 'react';
import Markdown from 'react-markdown';
import { modelLabel, participantName } from '../../shared/labels.js';
import type { Participant, Proposal, Round, Verdict } from '../../shared/types.js';
import { linkRefs, ProposalRefs, RefLink, refsAsText, RefText } from './proposalRefs.js';
import { Dot } from '../components/Dot.js';

type Props = { participant: Participant; all: Participant[]; rounds: Round[]; activity?: string; roundRunning: boolean; latestRound: number; onRetry: () => void };

const PREVIEW = 80;

const VERDICT_LABEL: Record<Verdict, string> = { send: 'Send', revise: 'Revise', rethink: 'Rethink', dont_send: "Don't send" };

function summary(note: { status: string; note?: string }, proposals: Proposal[], activity?: string): string {
  if (note.status === 'running') return activity ? `${activity}…` : 'Reviewing…';
  if (note.status === 'stopped') return 'Stopped';
  if (note.status === 'error') return 'Error';
  const text = refsAsText((note.note ?? '').trim(), proposals);
  return text.length > PREVIEW ? `${text.slice(0, PREVIEW)}…` : text;
}

/** One participant's overall note, latest round first, with earlier rounds a pick away. */
export function NoteCard({ participant, all, rounds, activity, roundRunning, latestRound, onRetry }: Props) {
  const [picked, setPicked] = useState<number>();
  const [showAnswer, setShowAnswer] = useState(false);
  const [open, setOpen] = useState(false);
  const proposals = useContext(ProposalRefs)?.proposals ?? [];
  const round = rounds.find((r) => r.n === picked) ?? rounds.at(-1);
  const note = round?.notes[participant.id];
  if (!round || !note) return null;
  const canRetry = round.n === latestRound;
  const verdict = note.verdict && <span className={`tag verdict ${note.verdict}`}>{VERDICT_LABEL[note.verdict]}</span>;
  const retry = <button disabled={roundRunning} title={roundRunning ? 'Wait for the other reviews to finish' : undefined} onClick={onRetry}>Retry</button>;

  if (!open) {
    return (
      <button className="card note note-line" onClick={() => setOpen(true)}>
        <span className="author">
          <Dot p={participant} all={all} /> {participantName(participant, all)}
          <span className="note-model">{modelLabel(participant.model, participant.effort)}</span>
          {verdict}
        </span>
        <span className="note-summary">{summary(note, proposals, activity)}</span>
      </button>
    );
  }

  return (
    <div className="card note">
      <div className="card-head">
        <span className="author" onClick={() => setOpen(false)} title="Collapse">
          <Dot p={participant} all={all} /> {participantName(participant, all)}
          <span className="note-model">{modelLabel(participant.model, participant.effort)}</span>
          {verdict}
        </span>
        {rounds.length > 1 && (
          <select value={round.n} onChange={(e) => setPicked(Number(e.target.value))}>
            {rounds.map((r) => <option key={r.n} value={r.n}>Round {r.n}</option>)}
          </select>
        )}
      </div>
      {note.status === 'running' && <p className="activity">{activity ? `${activity}…` : 'Reviewing…'}</p>}
      {note.status === 'stopped' && <p className="muted">Stopped.</p>}
      {note.note && <p><RefText text={note.note} /></p>}
      {note.rejected?.length ? (
        <ul className="couldnt-place">
          {note.rejected.map((r, i) => <li key={i}>Couldn't place "{r.quote}" ({r.reason})</li>)}
        </ul>
      ) : null}
      {note.status === 'error' && note.error && (
        <div className="error">
          <p>{note.error.message}</p>
          {note.error.fix && <p>Fix: <code>{note.error.fix}</code></p>}
          {canRetry && retry}
        </div>
      )}
      {note.status === 'stopped' && canRetry && retry}
      {note.answer && (
        <>
          <button className="ghost" onClick={() => setShowAnswer((s) => !s)}>{showAnswer ? 'Hide answer' : 'Full answer'}</button>
          {showAnswer && <div className="full-answer"><Markdown components={{ a: RefLink }}>{linkRefs(note.answer, proposals)}</Markdown></div>}
        </>
      )}
    </div>
  );
}
