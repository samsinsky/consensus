import { useEffect, useRef } from 'react';
import type { Message, Quote, Thread } from '../../shared/types.js';
import { MessageView } from './MessageView.js';

type Props = { thread: Thread; messages: Message[]; onForward: (q: Quote) => void };

export function MessageList({ thread, messages, onForward }: Props) {
  const end = useRef<HTMLDivElement>(null);
  const lastText = messages.at(-1)?.kind === 'reply' ? (messages.at(-1) as { text: string }).text.length : 0;
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [messages.length, lastText]);
  return (
    <div className="messages">
      {messages.map((m) => (
        <MessageView key={m.id} thread={thread} message={m} onForward={onForward} />
      ))}
      <div ref={end} />
    </div>
  );
}
