import { useState } from 'react';
import type { ModelOption, ProviderDefaults, ProviderId, Quote, Thread } from '../../shared/types.js';
import { MessageList } from './MessageList.js';

type Props = {
  thread: Thread;
  models: Record<ProviderId, ModelOption[]>;
  defaults: Record<ProviderId, ProviderDefaults>;
};

export function ThreadView({ thread }: Props) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const forward = (q: Quote) => setQuotes((qs) => [...qs, q]);
  return (
    <section className="thread-view">
      <header className="thread-head"><h1>{thread.title}</h1></header>
      <MessageList thread={thread} messages={thread.messages} onForward={forward} />
      <p className="hint">{quotes.length} quote(s) ready to forward</p>
    </section>
  );
}
