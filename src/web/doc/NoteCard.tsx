import { useState } from 'react';
import Markdown from 'react-markdown';
import { participantLabel } from '../../shared/labels.js';
import type { Participant, Round } from '../../shared/types.js';

type Props = { participant: Participant; all: Participant[]; rounds: Round[]; activity?: string; onRetry: () => void };

/** One participant's overall note, latest round first, with earlier rounds a pick away. */
export function NoteCard({ participant, all, rounds, activity, onRetry }: Props) {
  const [picked, setPicked] = useState<number>();
  const [showAnswer, setShowAnswer] = useState(false);
  const round = rounds.find((r) => r.n === picked) ?? rounds.at(-1);
  const note = round?.notes[participant.id];
  if (!round || !note) return null;
  const latest = round === rounds.at(-1);

  return (
    <div className="card note">
      <div className="card-head">
        <span className="author"><span className={`dot ${participant.provider}`} /> {participantLabel(participant, all)}</span>
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
          {latest && <button onClick={onRetry}>Retry</button>}
        </div>
      )}
      {note.status === 'stopped' && latest && <button onClick={onRetry}>Retry</button>}
      {note.answer && (
        <>
          <button className="ghost" onClick={() => setShowAnswer((s) => !s)}>{showAnswer ? 'Hide answer' : 'Full answer'}</button>
          {showAnswer && <div className="full-answer"><Markdown>{note.answer}</Markdown></div>}
        </>
      )}
    </div>
  );
}
