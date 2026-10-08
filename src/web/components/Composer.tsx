import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { participantLabel } from '../../shared/labels.js';
import type { ModelOption, ProviderDefaults, ProviderId, Quote, Thread } from '../../shared/types.js';
import { api } from '../api.js';
import { autoQuote, streamingReply } from '../threadState.js';
import { useAttachments } from '../useAttachments.js';
import { AttachmentChip } from './AttachmentChip.js';
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
  /** The message list; it sits inside the drop area. */
  children?: ReactNode;
};

export function Composer({ thread, models, defaults, target, lockTarget, onTargetChange, quotes, setQuotes, children }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const box = useRef<HTMLTextAreaElement>(null);
  const { files, add, remove: removeFile, removeKeys } = useAttachments(thread.id);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const uploading = files.some((f) => f.status === 'uploading');
  const readyFiles = files.filter((f) => f.status === 'ready' && f.attachment);
  const ready = readyFiles.map((f) => f.attachment!);
  const running = target ? streamingReply(thread, target) : undefined;
  const lockedParticipant = thread.participants.find((p) => p.id === target);
  const auto = quotes.length ? undefined : autoQuote(thread, target, dismissed);
  const outgoing = quotes.length ? quotes : auto ? [auto] : [];
  const canSend = !!target && !running && !sending && !uploading && (text.trim().length > 0 || outgoing.length > 0 || ready.length > 0);

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
    const sentKeys = readyFiles.map((f) => f.key);
    try {
      await api.send(thread.id, { to: target, text, quotes: outgoing, attachmentIds: ready.map((a) => a.id) });
      setText('');
      setQuotes([]);
      removeKeys(sentKeys);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className={dragging ? 'drop-area dragging' : 'drop-area'}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        add(Array.from(e.dataTransfer.files));
      }}
    >
      {children}
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
      {files.length > 0 && (
        <div className="att-row">
          {files.map((f) => (
            <AttachmentChip key={f.key} threadId={thread.id} name={f.name} size={f.size} attachment={f.attachment}
              status={f.status} error={f.error} onRemove={() => removeFile(f.key)} />
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
        <div className="input-wrap">
          <button className="ghost attach" onClick={() => picker.current?.click()} title="Attach files" aria-label="Attach files">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            accept=".txt,.md,.csv,.json,.html,.htm,.docx,.pdf,.png,.jpg,.jpeg,.gif,.webp"
            onChange={(e) => {
              add(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          <textarea
            ref={box}
            rows={1}
            value={text}
            placeholder={running ? 'Waiting for the reply…' : 'Write your message. Cmd+Enter to send.'}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const pasted = Array.from(e.clipboardData.files);
              if (pasted.length) {
                e.preventDefault();
                add(pasted);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send();
              }
            }}
          />
          {running ? (
            <button className="send-btn stop" onClick={() => api.stop(thread.id, running.id).catch((e: Error) => setError(e.message))} title="Stop" aria-label="Stop">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
            </button>
          ) : (
            <button className="send-btn" disabled={!canSend} onClick={send} title="Send (Cmd+Enter)" aria-label="Send">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 19V5" />
                <path d="m5 12 7-7 7 7" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {error && <p className="error-inline">{error}</p>}
    </div>
    </div>
  );
}
