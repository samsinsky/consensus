import { useState } from 'react';
import Markdown from 'react-markdown';
import { modelLabel, participantName } from '../../shared/labels.js';
import type { Participant, Round, RoundKind, RoundNote, Verdict } from '../../shared/types.js';

type Props = {
  participant: Participant;
  all: Participant[];
  rounds: Round[];
  activity?: string;
  roundRunning: boolean;
  latestRound: number;
  onRetry: () => void;
  /** Offered on the latest strategy round's takes while the doc is in strategy. */
  onChoose?: (approach: string) => void;
};

const PREVIEW = 80;

export const VERDICT_LABEL: Record<Verdict, string> = { send: 'Send', revise: 'Revise', rethink: 'Rethink', dont_send: "Don't send" };
const KIND_LABEL: Record<RoundKind, string> = { strategy: 'Strategy', draft: 'Draft', edit: 'Edits' };
const WORKING: Record<RoundKind, string> = { strategy: 'Thinking it over', draft: 'Drafting', edit: 'Reviewing' };

function summary(note: RoundNote, kind: RoundKind, activity?: string): string {
  if (note.status === 'running') return `${activity ?? WORKING[kind]}…`;
  if (note.status === 'stopped') return 'Stopped';
  if (note.status === 'error') return 'Error';
  const text = (note.note ?? '').trim();
  return text.length > PREVIEW ? `${text.slice(0, PREVIEW)}…` : text;
}

/** One participant's overall note, latest round first, with earlier rounds a pick away. */
export function NoteCard({ participant, all, rounds, activity, roundRunning, latestRound, onRetry, onChoose }: Props) {
  const [picked, setPicked] = useState<number>();
  const [showAnswer, setShowAnswer] = useState(false);
  const [open, setOpen] = useState(false);
  const round = rounds.find((r) => r.n === picked) ?? rounds.at(-1);
  const note = round?.notes[participant.id];
  if (!round || !note) return null;
  const kind = round.kind ?? 'edit';
  const canRetry = round.n === latestRound;
  const take = note.strategy;
  const verdict = take && <span className={`tag verdict ${take.verdict}`}>{VERDICT_LABEL[take.verdict]}</span>;
  const retry = <button disabled={roundRunning} title={roundRunning ? 'Wait for the other reviews to finish' : undefined} onClick={onRetry}>Retry</button>;

  if (!open) {
    return (
      <button className="card note note-line" onClick={() => setOpen(true)}>
        <span className="author">
          <span className={`dot ${participant.provider}`} /> {participantName(participant, all)}
          <span className="note-model">{modelLabel(participant.model, participant.effort)}</span>
          {verdict}
        </span>
        <span className="note-summary">{summary(note, kind, activity)}</span>
      </button>
    );
  }

  return (
    <div className="card note">
      <div className="card-head">
        <span className="author" onClick={() => setOpen(false)} title="Collapse">
          <span className={`dot ${participant.provider}`} /> {participantName(participant, all)}
          <span className="note-model">{modelLabel(participant.model, participant.effort)}</span>
          {verdict}
        </span>
        {rounds.length > 1 && (
          <select value={round.n} onChange={(e) => setPicked(Number(e.target.value))}>
            {rounds.map((r) => <option key={r.n} value={r.n}>Round {r.n} · {KIND_LABEL[r.kind ?? 'edit']}</option>)}
          </select>
        )}
      </div>
      {note.status === 'running' && <p className="activity">{summary(note, kind, activity)}</p>}
      {note.status === 'stopped' && <p className="muted">Stopped.</p>}
      {take ? (
        <dl className="take">
          <dt>Goal</dt><dd>{take.goal}</dd>
          <dt>Assessment</dt><dd>{take.assessment}</dd>
          <dt>Approach</dt><dd>{take.approach}</dd>
        </dl>
      ) : note.note && (kind === 'draft' ? <div className="draft-note"><Markdown>{note.note}</Markdown></div> : <p>{note.note}</p>)}
      {take && onChoose && round.n === latestRound && (
        <div className="card-actions"><button className="primary" onClick={() => onChoose(take.approach)}>Go with this</button></div>
      )}
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
