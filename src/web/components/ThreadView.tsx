import { useEffect, useState } from 'react';
import type { ModelOption, ProviderDefaults, ProviderId, Quote, Thread } from '../../shared/types.js';
import { nextActive } from '../threadState.js';
import { Composer } from './Composer.js';
import { MessageList } from './MessageList.js';

type Props = {
  thread: Thread;
  models: Record<ProviderId, ModelOption[]>;
  defaults: Record<ProviderId, ProviderDefaults>;
};

export function ThreadView({ thread, models, defaults }: Props) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [active, setActive] = useState<string | undefined>(() => nextActive(thread));
  useEffect(() => setActive((a) => nextActive(thread, a)), [thread]);
  const forward = (q: Quote) => setQuotes((qs) => [...qs, q]);

  return (
    <section className="thread-view">
      <header className="thread-head"><h1>{thread.title}</h1></header>
      <MessageList thread={thread} messages={thread.messages} onForward={forward} />
      <Composer
        thread={thread} models={models} defaults={defaults}
        target={active} lockTarget={false} onTargetChange={setActive}
        quotes={quotes} setQuotes={setQuotes}
      />
    </section>
  );
}
