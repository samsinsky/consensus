import type { AdapterError, ModelOption, ProviderId } from '../../shared/types.js';

export type ImageInput = { id: string; name: string; mime: string; path: string; threadId: string };

export type SendRequest = {
  /** Last completed session; absent on a participant's first message. */
  sessionId?: string;
  /** Final text, quotes already inlined. */
  message: string;
  model: string;
  effort?: string;
  promptHash: string;
  promptPath: string;
  /** Images for this turn; text attachments are already inlined in message. */
  images?: ImageInput[];
  signal: AbortSignal;
};

export type AdapterEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'delta'; text: string }
  | { type: 'warning'; message: string }
  | { type: 'done'; text: string }
  | { type: 'error'; error: AdapterError };

export interface ProviderAdapter {
  id: ProviderId;
  listModels(): Promise<ModelOption[]>;
  /** Ends without done or error when the request's signal aborts. */
  send(req: SendRequest): AsyncIterable<AdapterEvent>;
}

export type CliOptions = {
  workdir: string;
  bin?: string;
  /** Arguments placed before the adapter's own, used by tests to run the fake CLI. */
  binArgs?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
};

export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
