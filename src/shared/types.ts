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
  /** 1-based position among this thread's participants from the same provider; fixed at creation. */
  ordinal?: number;
  createdAt: string;
};

export type Quote = { messageId: string; text: string };

export type AttachmentKind = 'text' | 'image';

export type Attachment = {
  id: string;
  name: string;
  kind: AttachmentKind;
  mime: string;
  size: number;
  /** Extracted characters, for text and documents. */
  chars?: number;
  /** True when extracted text was cut to the character limit. */
  truncated?: boolean;
  createdAt: string;
};

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
  attachments?: Attachment[];
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
  /** Pages the participant opened while replying, in order, without repeats. */
  sources?: string[];
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

export type ThreadKind = 'chat' | 'doc';

export type Stance = 'agree' | 'disagree' | 'your_call';

export type ProposalStatus = 'open' | 'accepted' | 'rejected' | 'not_chosen' | 'dismissed';

export type ProposalReply = {
  /** 'user' for Sam, else a participant id. */
  from: string;
  stance?: Stance;
  text: string;
  round?: number;
  at: string;
};

export type Proposal = {
  /** "P1", "P2", … per document. */
  id: string;
  round: number;
  /** Participant ids; several when identical proposals merged. */
  authors: string[];
  quote: string;
  /** Up to 32 normalized characters before and after the quote in the round snapshot. */
  prefix: string;
  suffix: string;
  replacement: string;
  reason: string;
  status: ProposalStatus;
  resolvedAt?: string;
  replies: ProposalReply[];
};

export type RoundNote = {
  status: 'running' | 'done' | 'stopped' | 'error';
  note?: string;
  /** The participant's full prose answer. */
  answer?: string;
  /** Proposals that failed the quote check. */
  rejected?: { quote: string; reason: string }[];
  error?: { code: ErrorCode | 'parse'; message: string; fix?: string };
};

export type Round = {
  /** 1-based. */
  n: number;
  sentAt: string;
  /** Markdown as sent. */
  snapshot: string;
  participants: string[];
  notes: Record<string, RoundNote>;
};

export type DocState = {
  brief: string;
  briefAttachments?: Attachment[];
  markdown: string;
  savedAt: string;
  /** Bumped when the server replaces the text (restore), so the editor reloads and stale saves are refused. */
  revision: number;
  /** Participant ids in the next round. */
  included: string[];
  rounds: Round[];
  proposals: Proposal[];
  nextProposal: number;
};

export type Thread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Absent means chat. */
  kind?: ThreadKind;
  doc?: DocState;
  participants: Participant[];
  messages: Message[];
};

export type ThreadSummary = { id: string; title: string; updatedAt: string; kind?: ThreadKind };

export type ProviderDefaults = { model: string; effort?: string };

export type Settings = { defaults: Record<ProviderId, ProviderDefaults> };

export type ThreadEvent =
  | { type: 'thread'; thread: Thread }
  | { type: 'delta'; messageId: string; text: string }
  /** What a streaming reply's participant is doing; not saved. */
  | { type: 'activity'; messageId: string; text: string };
