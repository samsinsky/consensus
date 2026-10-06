import { useEffect, useState } from 'react';
import { participantLabel } from '../../shared/labels.js';
import type { ModelOption, ProviderDefaults, ProviderId, Quote, Thread } from '../../shared/types.js';
import { api } from '../api.js';
import { nextActive, paneMessages } from '../threadState.js';
import { Composer } from './Composer.js';
import { MessageList } from './MessageList.js';

type Props = {
  thread: Thread;
  models: Record<ProviderId, ModelOption[]>;
  defaults: Record<ProviderId, ProviderDefaults>;
};

export function ThreadView({ thread, models, defaults }: Props) {
  const [view, setView] = useState<'timeline' | 'panes'>('timeline');
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [active, setActive] = useState<string | undefined>(() => nextActive(thread));
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useEffect(() => setActive((a) => nextActive(thread, a)), [thread]);

  const forward = (q: Quote) => setQuotes((qs) => [...qs, q]);
  const toggle = (id: string) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const composer = (target: string | undefined, lock: boolean) => (
    <Composer
      thread={thread} models={models} defaults={defaults}
      target={target} lockTarget={lock} onTargetChange={setActive}
      quotes={quotes} setQuotes={setQuotes}
    />
  );
  const shown = thread.participants.filter((p) => !hidden.has(p.id));

  return (
    <section className="thread-view">
      <header className="thread-head">
        <ThreadTitle thread={thread} />
        <div className="view-toggle">
          <button className={view === 'timeline' ? 'on' : ''} onClick={() => setView('timeline')}>Timeline</button>
          <button className={view === 'panes' ? 'on' : ''} onClick={() => setView('panes')} disabled={!thread.participants.length}>Panes</button>
        </div>
      </header>
      {view === 'panes' && (
        <div className="pane-picker">
          {thread.participants.map((p) => (
            <label key={p.id}>
              <input type="checkbox" checked={!hidden.has(p.id)} onChange={() => toggle(p.id)} />
              <span className={`dot ${p.provider}`} /> {participantLabel(p, thread.participants)}
            </label>
          ))}
        </div>
      )}
      {view === 'timeline' ? (
        <>
          <MessageList thread={thread} messages={thread.messages} onForward={forward} />
          {composer(active, false)}
        </>
      ) : (
        <div className="panes">
          {shown.map((p) => (
            <section key={p.id} className="pane">
              <h2><span className={`dot ${p.provider}`} /> {participantLabel(p, thread.participants)}</h2>
              <MessageList thread={thread} messages={paneMessages(thread, p.id)} onForward={forward} />
              {composer(p.id, true)}
            </section>
          ))}
          {!shown.length && <p className="empty">Tick a participant to show its pane.</p>}
        </div>
      )}
    </section>
  );
}

function ThreadTitle({ thread }: { thread: Thread }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(thread.title);
  const [error, setError] = useState<string>();

  const start = () => {
    setDraft(thread.title);
    setError(undefined);
    setEditing(true);
  };
  const save = async () => {
    if (draft.trim() === thread.title) return setEditing(false);
    try {
      await api.renameThread(thread.id, draft);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!editing) {
    return (
      <h1 className="title" onClick={start} title="Rename thread">
        {thread.title} <span className="edit-icon">✎</span>
      </h1>
    );
  }
  return (
    <div className="title-edit">
      <input
        autoFocus
        value={draft}
        maxLength={120}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
      {error && <span className="error-inline">{error}</span>}
    </div>
  );
}
