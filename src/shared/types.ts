export type ProviderId = 'claude' | 'codex' | 'gemini';

export const PROVIDER_IDS: ProviderId[] = ['claude', 'codex', 'gemini'];

export const PROVIDERS: Record<ProviderId, { name: string }> = {
  claude: { name: 'Claude' },
  codex: { name: 'ChatGPT' },
  gemini: { name: 'Gemini' },
};

/** efforts is empty when the provider bakes effort into the model id. */
export type ModelOption = { id: string; label: string; efforts: string[] };

export type Participant = {
  id: string;
  provider: ProviderId;
  model: string;
  effort?: string;
  /** Last completed session. Only advances when a reply finishes. */
  sessionId?: string;
  /** Hash of the system prompt snapshot this participant started with. */
  promptHash: string;
  createdAt: string;
};

export type Quote = { messageId: string; text: string };

export type ErrorCode =
  | 'not_installed'
  | 'not_logged_in'
  | 'rate_limited'
  | 'timeout'
  | 'interrupted'
  | 'unknown';

export type AdapterError = { code: ErrorCode; message: string; fix?: string };

export type Origin = 'manual' | 'loop';

export type UserMessage = {
  id: string;
  kind: 'user';
  to: string;
  text: string;
  quotes: Quote[];
  sentAt: string;
  origin?: Origin;
};

export type ReplyStatus = 'streaming' | 'done' | 'stopped' | 'error';

export type ReplyMessage = {
  id: string;
  kind: 'reply';
  from: string;
  text: string;
  model: string;
  effort?: string;
  status: ReplyStatus;
  error?: AdapterError;
  sentAt: string;
  origin?: Origin;
};

export type ModelChangeMessage = {
  id: string;
  kind: 'model_change';
  participant: string;
  from: string;
  to: string;
  sentAt: string;
};

export type Message = UserMessage | ReplyMessage | ModelChangeMessage;

export type Thread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  participants: Participant[];
  messages: Message[];
};

export type ThreadSummary = { id: string; title: string; updatedAt: string };

export type ProviderDefaults = { model: string; effort?: string };

export type Settings = { defaults: Record<ProviderId, ProviderDefaults> };

export type ThreadEvent =
  | { type: 'thread'; thread: Thread }
  | { type: 'delta'; messageId: string; text: string };
