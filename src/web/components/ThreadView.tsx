import { useEffect, useState } from 'react';
import { participantLabel } from '../../shared/labels.js';
import type { ModelOption, ProviderDefaults, ProviderId, Quote, Thread } from '../../shared/types.js';
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
        <h1>{thread.title}</h1>
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
