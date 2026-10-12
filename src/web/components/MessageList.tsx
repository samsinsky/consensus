import { useLayoutEffect, useRef } from 'react';
import type { Message, Quote, Thread } from '../../shared/types.js';
import { MessageView } from './MessageView.js';

type Props = { thread: Thread; messages: Message[]; activity: Record<string, string>; onForward: (q: Quote) => void };

/** How close to the bottom still counts as "at the bottom". */
const PIN_SLACK = 24;

export function MessageList({ thread, messages, activity, onForward }: Props) {
  const box = useRef<HTMLDivElement>(null);
  // Follow new text only while the reader sits at the bottom; scrolling up lets them read in peace.
  const pinned = useRef(true);
  const last = messages.at(-1);
  const lastText = last?.kind === 'reply' ? last.text.length : 0;
  const lastSent = last?.kind === 'user' ? last.id : undefined;

  useLayoutEffect(() => {
    if (lastSent) pinned.current = true;
  }, [lastSent]);

  useLayoutEffect(() => {
    const el = box.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, lastText, lastSent]);

  const onScroll = () => {
    const el = box.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight <= PIN_SLACK;
  };

  return (
    <div className="messages" ref={box} onScroll={onScroll}>
      {messages.map((m) => (
        <MessageView key={m.id} thread={thread} message={m} activity={activity[m.id]} onForward={onForward} />
      ))}
    </div>
  );
}
