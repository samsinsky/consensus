import type { AdapterEvent, ProviderAdapter, SendRequest } from '../../src/server/adapters/types.js';
import type { ProviderId } from '../../src/shared/types.js';
import { AsyncQueue } from './queue.js';

/** A fake CLI the test answers by hand: push events to last(), then end() it. */
export function controllable(id: ProviderId) {
  const requests: SendRequest[] = [];
  const queues: AsyncQueue<AdapterEvent>[] = [];
  const adapter: ProviderAdapter = {
    id,
    listModels: async () => [],
    send(req) {
      requests.push(req);
      const q = new AsyncQueue<AdapterEvent>();
      req.signal.addEventListener('abort', () => q.end());
      queues.push(q);
      return q;
    },
  };
  return { adapter, requests, last: () => queues.at(-1)! };
}
