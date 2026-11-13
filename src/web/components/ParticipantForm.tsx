import { useRef, useState } from 'react';
import type { ModelOption, Participant, ProviderDefaults, ProviderId } from '../../shared/types.js';
import { api } from '../api.js';
import { useAutoGrow } from '../useAutoGrow.js';
import { ModelPicker } from './ModelPicker.js';

type Props = {
  threadId: string;
  models: Record<ProviderId, ModelOption[]>;
  defaults: Record<ProviderId, ProviderDefaults>;
  /** The participant to edit; none to add a new one. */
  editing?: Participant;
  onAdded?: (p: Participant) => void;
  onDone: () => void;
};

/** Inside a participant menu: adds a participant, or edits one's name and instructions. */
export function ParticipantForm({ threadId, models, defaults, editing, onAdded, onDone }: Props) {
  const [name, setName] = useState(editing?.name ?? '');
  const [instructions, setInstructions] = useState(editing?.instructions ?? '');
  const [error, setError] = useState<string>();
  const box = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(box, instructions);

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const add = (provider: ProviderId, model: string, effort?: string) =>
    run(async () => {
      const p = await api.addParticipant(threadId, { provider, model, effort, name, instructions });
      onAdded?.(p);
    });
  const save = () => run(() => api.updateParticipant(threadId, editing!.id, { name, instructions }));

  return (
    <div className="participant-form">
      {!editing && <div className="menu-label">New participant</div>}
      <label className="field-col">
        <span className="field-head">Name</span>
        <input value={name} placeholder="Optional, e.g. Fact checker" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field-col">
        <span className="field-head">Instructions</span>
        <textarea
          ref={box}
          className="instructions"
          rows={4}
          value={instructions}
          placeholder="What this participant should focus on, e.g. Check every claim against the brief. Flag numbers without a source. Ignore style and tone."
          onChange={(e) => setInstructions(e.target.value)}
        />
      </label>
      {editing && <p className="form-hint">Changes apply from its next reply.</p>}
      {editing ? (
        <div className="form-actions">
          <button onClick={onDone}>Cancel</button>
          <button className="primary" onClick={save}>Save</button>
        </div>
      ) : (
        <ModelPicker models={models} defaults={defaults} submitLabel="Add" onPick={add} />
      )}
      {error && <p className="error-inline">{error}</p>}
    </div>
  );
}
