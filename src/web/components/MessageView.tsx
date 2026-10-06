import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { participantLabel, participantName, replyLabel } from '../../shared/labels.js';
import type { Message, Quote, Thread } from '../../shared/types.js';
import { api } from '../api.js';
import { AttachmentChip } from './AttachmentChip.js';
import { CollapsibleQuote } from './CollapsibleQuote.js';

type Props = { thread: Thread; message: Message; onForward: (q: Quote) => void };

export function MessageView({ thread, message, onForward }: Props) {
  const body = useRef<HTMLDivElement>(null);
  const [actionError, setActionError] = useState<string>();
  const [hasSelection, setHasSelection] = useState(false);

  // Offer "Forward selection" only while text inside this reply is highlighted.
  useEffect(() => {
    if (message.kind !== 'reply') return;
    const onChange = () => {
      const sel = window.getSelection();
      const el = body.current;
      setHasSelection(!!sel && !sel.isCollapsed && !!el && el.contains(sel.anchorNode) && el.contains(sel.focusNode));
    };
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, [message.kind]);
  const label = (id: string) => {
    const p = thread.participants.find((x) => x.id === id);
    return p ? participantLabel(p, thread.participants) : 'Removed participant';
  };
  const provider = (id: string) => thread.participants.find((x) => x.id === id)?.provider ?? 'claude';
  const act = (fn: () => Promise<unknown>) => fn().catch((e: Error) => setActionError(e.message));

  if (message.kind === 'model_change') {
    const p = thread.participants.find((x) => x.id === message.participant);
    return <div className="marker">{p ? participantName(p, thread.participants) : 'Removed participant'} switched from {message.from} to {message.to}</div>;
  }

  if (message.kind === 'user') {
    return (
      <div className="msg user">
        <div className="msg-head">You → <span className={`dot ${provider(message.to)}`} /> {label(message.to)}</div>
        {message.quotes.map((q, i) => (
          <CollapsibleQuote key={i} text={q.text} />
        ))}
        {message.attachments?.length ? (
          <div className="att-row">
            {message.attachments.map((a) => (
              <AttachmentChip key={a.id} threadId={thread.id} name={a.name} size={a.size} attachment={a} />
            ))}
          </div>
        ) : null}
        {message.text && <div className="msg-body plain">{message.text}</div>}
      </div>
    );
  }

  const forwardSelection = () => {
    const text = window.getSelection()?.toString().trim();
    if (text) onForward({ messageId: message.id, text });
    window.getSelection()?.removeAllRanges();
  };

  const author = thread.participants.find((x) => x.id === message.from);
  return (
    <div className={`msg reply ${message.status}`}>
      <div className="msg-head">
        <span className={`dot ${provider(message.from)}`} /> {author ? replyLabel(message, author, thread.participants) : 'Removed participant'}
        {message.status === 'stopped' && <span className="badge">stopped</span>}
      </div>
      <div className="msg-body" ref={body}>
        {message.text ? <Markdown>{message.text}</Markdown> : message.status === 'streaming' ? <span className="typing">Thinking…</span> : null}
      </div>
      {message.status === 'error' && message.error && (
        <div className="error">
          <p>{message.error.message}</p>
          {message.error.fix && <p>Fix: <code>{message.error.fix}</code></p>}
          <button onClick={() => act(() => api.retry(thread.id, message.id))}>Retry</button>
        </div>
      )}
      <div className="msg-actions">
        {message.status === 'streaming' && <button onClick={() => act(() => api.stop(thread.id, message.id))}>Stop</button>}
        {hasSelection && (
          <button onMouseDown={(e) => e.preventDefault()} onClick={forwardSelection} title="Forward only the highlighted text">
            Forward selection
          </button>
        )}
      </div>
      {actionError && <p className="error-inline">{actionError}</p>}
    </div>
  );
}
