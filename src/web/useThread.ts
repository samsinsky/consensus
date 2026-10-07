import { useEffect, useState } from 'react';
import type { Thread, ThreadEvent } from '../shared/types.js';
import { applyActivity, applyEvent } from './threadState.js';

/** The live thread plus each streaming reply's current activity, such as "Reading nodejs.org". */
export function useThread(id?: string): { thread?: Thread; activity: Record<string, string> } {
  const [thread, setThread] = useState<Thread>();
  const [activity, setActivity] = useState<Record<string, string>>({});
  useEffect(() => {
    setThread(undefined);
    setActivity({});
    if (!id) return;
    const source = new EventSource(`/api/threads/${id}/events`);
    source.onmessage = (e) => {
      const ev = JSON.parse(e.data) as ThreadEvent;
      setThread((t) => applyEvent(t, ev));
      setActivity((a) => applyActivity(a, ev));
    };
    return () => source.close();
  }, [id]);
  return { thread, activity };
}
