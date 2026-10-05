import { useState } from 'react';
import { participantLabel } from '../../shared/labels.js';
import type { ModelOption, ProviderDefaults, ProviderId, Quote, Thread } from '../../shared/types.js';
import { api } from '../api.js';
import { streamingReply } from '../threadState.js';
import { ParticipantChip } from './ParticipantChip.js';

type Props = {
  thread: Thread;
  models: Record<ProviderId, ModelOption[]>;
  defaults: Record<ProviderId, ProviderDefaults>;
  target?: string;
  lockTarget: boolean;
  onTargetChange: (participantId: string) => void;
  quotes: Quote[];
  setQuotes: (q: Quote[]) => void;
};

export function Composer({ thread, models, defaults, target, lockTarget, onTargetChange, quotes, setQuotes }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const running = target ? streamingReply(thread, target) : undefined;
  const lockedParticipant = thread.participants.find((p) => p.id === target);
  const canSend = !!target && !running && !sending && (text.trim().length > 0 || quotes.length > 0);

  const send = async () => {
    if (!canSend || !target) return;
    setSending(true);
    setError(undefined);
    try {
      await api.send(thread.id, { to: target, text, quotes });
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
      {quotes.length > 0 && (
        <div className="quote-tray">
          {quotes.map((q, i) => (
            <div key={i} className="tray-item">
              <span>{q.text.length > 140 ? `${q.text.slice(0, 140)}…` : q.text}</span>
              <button className="ghost" onClick={() => setQuotes(quotes.filter((_, j) => j !== i))} title="Remove quote">×</button>
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
          rows={3}
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
