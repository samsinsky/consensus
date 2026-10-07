import { useEffect, useRef, useState } from 'react';
import { participantLabel } from '../../shared/labels.js';
import type { ModelOption, ProviderDefaults, ProviderId, Thread } from '../../shared/types.js';
import { api } from '../api.js';
import { ModelPicker } from './ModelPicker.js';

type Props = {
  thread: Thread;
  models: Record<ProviderId, ModelOption[]>;
  defaults: Record<ProviderId, ProviderDefaults>;
  target?: string;
  onSelect: (participantId: string) => void;
};

type Mode = { kind: 'list' } | { kind: 'new' } | { kind: 'change'; participantId: string };

export function ParticipantChip({ thread, models, defaults, target, onSelect }: Props) {
  const [open, setOpen] = useState(thread.participants.length === 0);
  const [mode, setMode] = useState<Mode>({ kind: thread.participants.length ? 'list' : 'new' });
  const [error, setError] = useState<string>();
  const current = thread.participants.find((p) => p.id === target);
  const wrap = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setMode({ kind: 'list' });
    setError(undefined);
  };

  // Close on a click outside the chip and its menu, or on Escape.
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

  const create = async (provider: ProviderId, model: string, effort?: string) => {
    try {
      const p = await api.addParticipant(thread.id, { provider, model, effort });
      onSelect(p.id);
      close();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const change = async (participantId: string, model: string, effort?: string) => {
    try {
      await api.changeModel(thread.id, participantId, { model, effort });
      close();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="chip-wrap" ref={wrap}>
      <button className={`chip ${current?.provider ?? ''}`} onClick={() => (open ? close() : setOpen(true))}>
        {current ? <><span className={`dot ${current.provider}`} /> {participantLabel(current, thread.participants)}</> : 'Choose a participant'} ▾
      </button>
      {open && (
        <div className="chip-menu">
          {mode.kind === 'list' && (
            <>
              <div className="menu-label">Participants in this thread</div>
              {thread.participants.map((p) => (
                <div key={p.id} className="menu-row">
                  <button className="menu-item" onClick={() => { onSelect(p.id); close(); }}>
                    <span className={`dot ${p.provider}`} /> {participantLabel(p, thread.participants)} {p.id === target && '✓'}
                  </button>
                  <button className="ghost" onClick={() => setMode({ kind: 'change', participantId: p.id })}>Change model</button>
                </div>
              ))}
              <button className="menu-item new" onClick={() => setMode({ kind: 'new' })}>+ New participant</button>
            </>
          )}
          {mode.kind === 'new' && (
            <>
              <div className="menu-label">New participant</div>
              <ModelPicker models={models} defaults={defaults} submitLabel="Add" onPick={create} />
            </>
          )}
          {mode.kind === 'change' && (() => {
            const p = thread.participants.find((x) => x.id === mode.participantId)!;
            return (
              <>
                <div className="menu-label">Change model for {participantLabel(p, thread.participants)}</div>
                <ModelPicker
                  models={models}
                  defaults={defaults}
                  fixedProvider={p.provider}
                  initial={{ provider: p.provider, model: p.model, effort: p.effort }}
                  submitLabel="Switch"
                  onPick={(_prov, model, effort) => change(p.id, model, effort)}
                />
              </>
            );
          })()}
          {error && <p className="error-inline">{error}</p>}
        </div>
      )}
    </div>
  );
}
