import { useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { participantLabel, participantName, replyLabel } from '../../shared/labels.js';
import type { Message, Quote, Thread } from '../../shared/types.js';
import { api } from '../api.js';

type Props = { thread: Thread; message: Message; onForward: (q: Quote) => void };

export function MessageView({ thread, message, onForward }: Props) {
  const body = useRef<HTMLDivElement>(null);
  const [actionError, setActionError] = useState<string>();
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
          <blockquote key={i} className="quote">{q.text}</blockquote>
        ))}
        {message.text && <div className="msg-body plain">{message.text}</div>}
      </div>
    );
  }

  const forward = () => {
    // Forward only the highlighted part when the selection sits inside this reply.
    const sel = window.getSelection();
    const inside = sel && !sel.isCollapsed && body.current?.contains(sel.anchorNode) && body.current.contains(sel.focusNode);
    onForward({ messageId: message.id, text: inside ? sel!.toString() : message.text });
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
        {message.text && (
          <button onMouseDown={(e) => e.preventDefault()} onClick={forward} title="Highlight text first to forward only part">
            Forward ▸
          </button>
        )}
      </div>
      {actionError && <p className="error-inline">{actionError}</p>}
    </div>
  );
}
