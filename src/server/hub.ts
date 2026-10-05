import type { ThreadEvent } from '../shared/types.js';

type Listener = (ev: ThreadEvent) => void;

export class EventHub {
  private listeners = new Map<string, Set<Listener>>();

  subscribe(threadId: string, fn: Listener): () => void {
    let set = this.listeners.get(threadId);
    if (!set) this.listeners.set(threadId, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit(threadId: string, ev: ThreadEvent): void {
    for (const fn of this.listeners.get(threadId) ?? []) fn(ev);
  }
}
