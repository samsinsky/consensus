import { useEffect, useState } from 'react';
import type { Thread, ThreadEvent } from '../shared/types.js';
import { applyEvent } from './threadState.js';

export function useThread(id?: string): Thread | undefined {
  const [thread, setThread] = useState<Thread>();
  useEffect(() => {
    setThread(undefined);
    if (!id) return;
    const source = new EventSource(`/api/threads/${id}/events`);
    source.onmessage = (e) => setThread((t) => applyEvent(t, JSON.parse(e.data) as ThreadEvent));
    return () => source.close();
  }, [id]);
  return thread;
}
