import { Fragment, useEffect, useRef, useState } from 'react';
import { modelLabel, participantLabel, participantName } from '../../shared/labels.js';
import type { ModelOption, ProviderDefaults, ProviderId, Thread } from '../../shared/types.js';
import { api } from '../api.js';
import { ParticipantForm } from '../components/ParticipantForm.js';
import { Dot } from '../components/Dot.js';

type Props = {
  thread: Thread;
  models: Record<ProviderId, ModelOption[]>;
  defaults: Record<ProviderId, ProviderDefaults>;
  activity: Record<string, string>;
  running: boolean;
};

/** Up to three included reviewers, each with its model as a subtitle, then "+ N more". */
function Summary({ thread }: { thread: Thread }) {
  const included = thread.participants.filter((p) => thread.doc?.included.includes(p.id));
  if (!included.length) return <>Nobody included</>;
  return (
    <>
      {included.slice(0, 3).map((p, i) => (
        <Fragment key={p.id}>
          {i > 0 && ' • '}
          {participantName(p, thread.participants)} <span className="note-model">{modelLabel(p.model, p.effort)}</span>
        </Fragment>
      ))}
      {included.length > 3 && ` + ${included.length - 3} more`}
    </>
  );
}

export function ReviewBar({ thread, models, defaults, activity, running }: Props) {
  const [open, setOpen] = useState(false);
  // Which form is open in the menu: 'new' to add, or the id of the participant being edited.
  const [form, setForm] = useState<string>();
  const [error, setError] = useState<string>();
  const wrap = useRef<HTMLDivElement>(null);
  const included = new Set(thread.doc?.included ?? []);
  const latest = thread.doc?.rounds.at(-1);
  const busy = (id: string) => latest?.notes[id]?.status === 'running';

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setForm(undefined);
    setError(undefined);
  };
  const act = (fn: () => Promise<unknown>) => fn().catch((e: Error) => setError(e.message));

  return (
    <div className="review-bar" ref={wrap}>
      <span className="review-label">Ask for review:</span>
      <button className="review-summary" onClick={() => (open ? close() : setOpen(true))}>
        <Summary thread={thread} /> ▾
      </button>
      {running && (
        <span className="review-activity">
          {thread.participants.filter((p) => busy(p.id)).map((p) => (
            <span key={p.id} className="spinner-line"><span className="spinner" /> {activity[`doc:${p.id}`] ?? participantLabel(p, thread.participants)}</span>
          ))}
        </span>
      )}
      {open && (
        <div className="chip-menu review-menu">
          {thread.participants.map((p) => (
            <div key={p.id} className={included.has(p.id) ? 'review-row included' : 'review-row'}>
              <button className="review-name" title={p.instructions} onClick={() => act(() => api.setIncluded(thread.id, p.id, !included.has(p.id)))}>
                <span className="check">{included.has(p.id) ? '✓' : ''}</span>
                <Dot p={p} all={thread.participants} /> {participantLabel(p, thread.participants)}
                {busy(p.id) && <span className="spinner" />}
              </button>
              <button className="ghost review-edit" title="Name and instructions" onClick={() => setForm(form === p.id ? undefined : p.id)}>✎</button>
              <button className="ghost review-remove" title="Remove from this thread" onClick={() => act(() => api.removeParticipant(thread.id, p.id))}>×</button>
              {form === p.id && (
                <ParticipantForm key={p.id} threadId={thread.id} models={models} defaults={defaults} editing={p} onDone={() => setForm(undefined)} />
              )}
            </div>
          ))}
          {form === 'new' ? (
            <ParticipantForm threadId={thread.id} models={models} defaults={defaults} onDone={() => setForm(undefined)} />
          ) : (
            <button className="menu-item new" onClick={() => setForm('new')}>+ Add participant</button>
          )}
          {error && <p className="error-inline">{error}</p>}
        </div>
      )}
    </div>
  );
}
