import { useRef } from 'react';
import { participantName } from '../../shared/labels.js';
import type { Participant } from '../../shared/types.js';
import { useAutoGrow } from '../useAutoGrow.js';

/** The direction being chosen, and who drafts it. */
export type Choice = { direction: string; drafter: string };

type Props = {
  participants: Participant[];
  /** Whether any strategy round has finished takes to choose from. */
  hasTakes: boolean;
  running: boolean;
  choice?: Choice;
  /** Who drafts a direction you write yourself. */
  defaultDrafter?: string;
  onChange: (choice: Choice | undefined) => void;
  onDraft: () => void;
  onSkip: () => void;
};

/** Heads the margin during strategy: what to do next, and the direction to draft once one is picked. */
export function StrategyPanel({ participants, hasTakes, running, choice, defaultDrafter, onChange, onDraft, onSkip }: Props) {
  const box = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(box, choice?.direction ?? '');

  return (
    <div className="card strategy-panel">
      <div className="card-head">
        <strong>Strategy</strong>
        <button className="ghost" disabled={running} onClick={onSkip}>Skip to edits</button>
      </div>
      {choice ? (
        <>
          <textarea
            ref={box}
            className="direction-input"
            rows={2}
            aria-label="Direction"
            placeholder="What should the new draft do?"
            value={choice.direction}
            onChange={(e) => onChange({ ...choice, direction: e.target.value })}
          />
          <div className="card-actions direction-actions">
            <label>
              Draft with{' '}
              <select value={choice.drafter} onChange={(e) => onChange({ ...choice, drafter: e.target.value })}>
                {participants.map((p) => <option key={p.id} value={p.id}>{participantName(p, participants)}</option>)}
              </select>
            </label>
            <button className="primary" disabled={running || !choice.direction.trim() || !choice.drafter} onClick={onDraft}>Draft it</button>
            <button className="ghost" onClick={() => onChange(undefined)}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <p className="muted strategy-hint">
            {hasTakes
              ? 'Pick an approach with "Go with this", or write your own. Send again to let reviewers respond to each other.'
              : "Send for review to hear each reviewer's take on the whole draft: the goal, whether it works, and what they'd do instead."}
          </p>
          {defaultDrafter && (
            <button className="ghost own-direction" onClick={() => onChange({ direction: '', drafter: defaultDrafter })}>Write my own direction</button>
          )}
        </>
      )}
    </div>
  );
}

/** Heads the margin while editing: the chosen direction, and the way back to strategy. */
export function DirectionBar({ direction, running, onBack }: { direction?: string; running: boolean; onBack: () => void }) {
  return (
    <div className="direction-bar">
      {direction ? <p className="direction-text" title={direction}><span className="muted">Direction:</span> {direction}</p> : <span />}
      <button className="ghost" disabled={running} onClick={onBack}>Back to strategy</button>
    </div>
  );
}
