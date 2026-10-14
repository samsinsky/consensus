import { useState } from 'react';
import Markdown from 'react-markdown';
import { modelLabel, participantName } from '../../shared/labels.js';
import type { Participant, Round } from '../../shared/types.js';

type Props = { participant: Participant; all: Participant[]; rounds: Round[]; activity?: string; roundRunning: boolean; latestRound: number; onRetry: () => void };

const PREVIEW = 80;

function summary(note: { status: string; note?: string }, activity?: string): string {
  if (note.status === 'running') return activity ? `${activity}…` : 'Reviewing…';
  if (note.status === 'stopped') return 'Stopped';
  if (note.status === 'error') return 'Error';
  const text = (note.note ?? '').trim();
  return text.length > PREVIEW ? `${text.slice(0, PREVIEW)}…` : text;
}

/** One participant's overall note, latest round first, with earlier rounds a pick away. */
export function NoteCard({ participant, all, rounds, activity, roundRunning, latestRound, onRetry }: Props) {
  const [picked, setPicked] = useState<number>();
  const [showAnswer, setShowAnswer] = useState(false);
  const [open, setOpen] = useState(false);
  const round = rounds.find((r) => r.n === picked) ?? rounds.at(-1);
  const note = round?.notes[participant.id];
  if (!round || !note) return null;
  const canRetry = round.n === latestRound;
  const retry = <button disabled={roundRunning} title={roundRunning ? 'Wait for the other reviews to finish' : undefined} onClick={onRetry}>Retry</button>;

  if (!open) {
    return (
      <button className="card note note-line" onClick={() => setOpen(true)}>
        <span className="author"><span className={`dot ${participant.provider}`} /> {participantName(participant, all)}</span>
        <span className="note-summary">{summary(note, activity)}</span>
        <span className="note-model">{modelLabel(participant.model, participant.effort)}</span>
      </button>
    );
  }

  return (
    <div className="card note">
      <div className="card-head">
        <span className="author" onClick={() => setOpen(false)} title="Collapse">
          <span className={`dot ${participant.provider}`} /> {participantName(participant, all)}
          <span className="note-model">{modelLabel(participant.model, participant.effort)}</span>
        </span>
        {rounds.length > 1 && (
          <select value={round.n} onChange={(e) => setPicked(Number(e.target.value))}>
            {rounds.map((r) => <option key={r.n} value={r.n}>Round {r.n}</option>)}
          </select>
        )}
      </div>
      {note.status === 'running' && <p className="activity">{activity ? `${activity}…` : 'Reviewing…'}</p>}
      {note.status === 'stopped' && <p className="muted">Stopped.</p>}
      {note.note && <p>{note.note}</p>}
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
          {showAnswer && <div className="full-answer"><Markdown>{note.answer}</Markdown></div>}
        </>
      )}
    </div>
  );
}
