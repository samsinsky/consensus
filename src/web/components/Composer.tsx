import { useLayoutEffect, useRef, useState } from 'react';
import { participantLabel } from '../../shared/labels.js';
import type { ModelOption, ProviderDefaults, ProviderId, Quote, Thread } from '../../shared/types.js';
import { api } from '../api.js';
import { autoQuote, streamingReply } from '../threadState.js';
import { CollapsibleQuote } from './CollapsibleQuote.js';
import { ParticipantChip } from './ParticipantChip.js';

type Props = {
  thread: Thread;
  models: Record<ProviderId, ModelOption[]>;
  defaults: Record<ProviderId, ProviderDefaults>;
  target?: string;
  lockTarget: boolean;
  onTargetChange: (participantId: string) => void;
  /** Highlighted excerpts the user forwarded by hand; they replace the automatic forward. */
  quotes: Quote[];
  setQuotes: (q: Quote[]) => void;
};

export function Composer({ thread, models, defaults, target, lockTarget, onTargetChange, quotes, setQuotes }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const box = useRef<HTMLTextAreaElement>(null);
  const running = target ? streamingReply(thread, target) : undefined;
  const lockedParticipant = thread.participants.find((p) => p.id === target);
  const auto = quotes.length ? undefined : autoQuote(thread, target, dismissed);
  const outgoing = quotes.length ? quotes : auto ? [auto] : [];
  const canSend = !!target && !running && !sending && (text.trim().length > 0 || outgoing.length > 0);

  // Grow with the text; CSS caps the height at ten lines and scrolls beyond that.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [text]);

  const remove = (q: Quote) => {
    if (q === auto) setDismissed((d) => new Set(d).add(q.messageId));
    else setQuotes(quotes.filter((x) => x !== q));
  };

  const send = async () => {
    if (!canSend || !target) return;
    setSending(true);
    setError(undefined);
    try {
      await api.send(thread.id, { to: target, text, quotes: outgoing });
      setText('');
      setQuotes([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="composer">
      {outgoing.length > 0 && (
        <div className="quote-tray">
          {outgoing.map((q, i) => (
            <div key={`${q.messageId}-${i}`} className="tray-item">
              <div className="tray-body">
                <span className="tray-label">{q === auto ? 'Forwarding the latest reply' : 'Forwarding your selection'}</span>
                <CollapsibleQuote text={q.text} />
              </div>
              <button className="ghost" onClick={() => remove(q)} title="Don't forward this">×</button>
            </div>
          ))}
        </div>
      )}
      <div className="composer-row">
        <span className="to">To:</span>
        {lockTarget && lockedParticipant ? (
          <span className="chip static"><span className={`dot ${lockedParticipant.provider}`} /> {participantLabel(lockedParticipant, thread.participants)}</span>
        ) : (
          <ParticipantChip thread={thread} models={models} defaults={defaults} target={target} onSelect={onTargetChange} />
        )}
      </div>
      <div className="composer-row">
        <textarea
          ref={box}
          rows={1}
          value={text}
          placeholder={running ? 'Waiting for the reply…' : 'Write your message. Cmd+Enter to send.'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        {running ? (
          <button onClick={() => api.stop(thread.id, running.id).catch((e: Error) => setError(e.message))}>Stop</button>
        ) : (
          <button className="primary" disabled={!canSend} onClick={send}>Send</button>
        )}
      </div>
      {error && <p className="error-inline">{error}</p>}
    </div>
  );
}
