import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { modelLabel } from '../shared/labels.js';
import type { Attachment, Origin, Participant, ProviderId, Quote, ReplyMessage, Thread, UserMessage } from '../shared/types.js';
import type { ImageInput, ProviderAdapter } from './adapters/types.js';
import { ATTACHMENT_LIMITS, AttachmentStore, truncationNote } from './attachments.js';
import type { EventHub } from './hub.js';
import type { Paths } from './paths.js';
import { snapshotPath, snapshotPrompt } from './prompt.js';
import type { ThreadStore } from './store.js';

export class RouterError extends Error {
  constructor(public code: 'not_found' | 'busy' | 'invalid', message: string) {
    super(message);
  }
}

export type SendInput = { to: string; text: string; quotes?: Quote[]; attachmentIds?: string[]; origin?: Origin };
export type SendResult = { userMessageId: string; replyMessageId: string; done: Promise<void> };

type Deps = {
  store: ThreadStore;
  hub: EventHub;
  paths: Paths;
  adapters: Record<ProviderId, ProviderAdapter>;
  attachments?: AttachmentStore;
};

const UNTITLED = 'Untitled thread';

/** What a forwarded reply needs: the task, where the round started, what was asked, and the reply itself. */
export type ForwardContext = {
  /** True when the quoted reply was traced back through the thread. */
  resolved?: boolean;
  originalRequest?: string;
  originalAttachments?: Attachment[];
  /** Rendered text blocks for originalAttachments. */
  originalBlocks?: string[];
  /** The draft the round began from, when the round had one. */
  start?: string;
  /** Sam's messages during the round, with any critiques he forwarded into them. */
  requests?: { text: string; quotes: string[] }[];
};

export const HANDOFF_NOTE = "Drafts below may include the previous writer's commentary. Judge the text on its merits.";

export function attachmentBlock(att: Attachment, text: string): string {
  const note = att.truncated ? `\n${truncationNote()}` : '';
  return `<attachment name="${att.name.replace(/"/g, "'")}">\n${text}${note}\n</attachment>`;
}

export function composeOutgoing(text: string, quotes: Quote[], ctx: ForwardContext = {}, attachmentBlocks: string[] = []): string {
  const blocks: string[] = [];
  if (quotes.length) {
    if (ctx.resolved) blocks.push(HANDOFF_NOTE);
    if (ctx.originalRequest) blocks.push(`Original request:\n<request>\n${ctx.originalRequest}\n</request>`);
    blocks.push(...(ctx.originalBlocks ?? []));
    if (ctx.start) blocks.push(`Starting point:\n<start>\n${ctx.start}\n</start>`);
    if (ctx.requests?.length) {
      const items = ctx.requests.map((r) => [`- ${r.text}`, ...r.quotes.map((q) => `  <quoted>${q}</quoted>`)].join('\n'));
      blocks.push(`Requests during the round:\n<requests>\n${items.join('\n')}\n</requests>`);
    }
    for (const q of quotes) blocks.push(`Feedback from another reviewer:\n<quoted>\n${q.text}\n</quoted>`);
  }
  blocks.push(...attachmentBlocks);
  if (!blocks.length) return text;
  return [...blocks, text].filter(Boolean).join('\n\n');
}

/** Sam's message that produced a reply: his last message to that participant before it. */
function promptOf(thread: Thread, replyId: string): UserMessage | undefined {
  const idx = thread.messages.findIndex((m) => m.id === replyId && m.kind === 'reply');
  if (idx < 0) return undefined;
  const reply = thread.messages[idx] as ReplyMessage;
  return thread.messages
    .slice(0, idx)
    .reverse()
    .find((m): m is UserMessage => m.kind === 'user' && m.to === reply.from);
}

/**
 * Builds the handoff for the first quote's reply. The round is Sam's run of messages to that
 * participant, back to his last message to someone else.
 */
export function forwardContext(thread: Thread, quotes: Quote[]): ForwardContext {
  for (const q of quotes) {
    const replyIdx = thread.messages.findIndex((m) => m.id === q.messageId && m.kind === 'reply');
    const last = promptOf(thread, q.messageId);
    if (replyIdx < 0 || !last) continue;
    const from = (thread.messages[replyIdx] as ReplyMessage).from;
    const users = thread.messages.slice(0, thread.messages.indexOf(last) + 1).filter((m): m is UserMessage => m.kind === 'user');
    const round: UserMessage[] = [];
    for (let i = users.length - 1; i >= 0 && users[i].to === from; i--) round.unshift(users[i]);
    const first = round[0];
    const firstIdx = thread.messages.indexOf(first);
    const root = rootPrompt(thread, first);

    // Starting point: the participant's own previous version, else the draft forwarded in, else its first reply in the round.
    const previous = lastReplyFrom(thread.messages.slice(0, firstIdx), from);
    const forwardedIn = first.quotes.map((x) => x.text).join('\n\n');
    const firstReply = round.length > 1 ? lastReplyFrom(thread.messages.slice(firstIdx, thread.messages.indexOf(round[1])), from) : undefined;
    const start = previous ?? (forwardedIn || firstReply);
    const startFromQuotes = !previous && !!forwardedIn;

    const requests = round
      .filter((m) => m !== root)
      .map((m) => ({ text: m.text.trim(), quotes: m === first && startFromQuotes ? [] : m.quotes.map((x) => x.text) }))
      .filter((r) => r.text || r.quotes.length);
    return {
      resolved: true,
      originalRequest: root?.text.trim() || undefined,
      originalAttachments: root?.attachments ?? [],
      start: start || undefined,
      requests,
    };
  }
  return {};
}

function lastReplyFrom(messages: Thread['messages'], participantId: string): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.kind === 'reply' && m.from === participantId && m.status === 'done' && m.text) return m.text;
  }
  return undefined;
}

function rootPrompt(thread: Thread, prompt: UserMessage): UserMessage | undefined {
  const seen = new Set<string>();
  let current: UserMessage | undefined = prompt;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    const parent: UserMessage | undefined = current.quotes.length ? promptOf(thread, current.quotes[0].messageId) : undefined;
    if (!parent) return current;
    current = parent;
  }
  return undefined;
}

export class Router {
  private threads = new Map<string, Thread>();
  private saves = new Map<string, Promise<void>>();
  private inflight = new Map<string, AbortController>();
  private busy = new Set<string>();

  private deleted = new Set<string>();
  readonly attachments: AttachmentStore;

  constructor(private deps: Deps) {
    this.attachments = deps.attachments ?? new AttachmentStore(deps.paths.threads);
  }

  async getThread(id: string): Promise<Thread | undefined> {
    if (this.deleted.has(id)) return undefined;
    const cached = this.threads.get(id);
    if (cached) return cached;
    const loaded = await this.deps.store.get(id);
    if (loaded) this.threads.set(id, loaded);
    return loaded;
  }

  async createThread(): Promise<Thread> {
    const thread = await this.deps.store.create(UNTITLED);
    this.threads.set(thread.id, thread);
    return thread;
  }

  async renameThread(threadId: string, title: string): Promise<void> {
    const thread = await this.mustThread(threadId);
    const name = title.trim();
    if (!name || name.length > 120) throw new RouterError('invalid', 'Thread names need 1 to 120 characters.');
    thread.title = name;
    await this.commit(thread);
  }

  async deleteThread(threadId: string): Promise<void> {
    const thread = await this.mustThread(threadId);
    for (const m of thread.messages) if (m.kind === 'reply') this.inflight.get(m.id)?.abort();
    // A reply that finishes after this point must not write the thread back.
    this.deleted.add(threadId);
    this.threads.delete(threadId);
    await this.saves.get(threadId);
    await this.deps.store.delete(threadId);
    await this.attachments.removeThread(threadId);
    await rm(join(this.deps.paths.workdir('gemini'), 'attachments', threadId), { recursive: true, force: true });
  }

  async sweepAttachments(maxAgeMs = 24 * 3600 * 1000): Promise<number> {
    let removed = 0;
    for (const summary of await this.deps.store.list()) {
      const thread = await this.getThread(summary.id);
      if (!thread) continue;
      const referenced = new Set(thread.messages.flatMap((m) => (m.kind === 'user' ? (m.attachments ?? []).map((a) => a.id) : [])));
      removed += await this.attachments.sweep(thread.id, referenced, maxAgeMs);
    }
    return removed;
  }

  async addParticipant(threadId: string, input: { provider: ProviderId; model: string; effort?: string }): Promise<Participant> {
    const thread = await this.mustThread(threadId);
    const participant: Participant = {
      id: randomUUID(),
      provider: input.provider,
      model: input.model,
      effort: input.effort || undefined,
      promptHash: await snapshotPrompt(this.deps.paths),
      ordinal: thread.participants.filter((x) => x.provider === input.provider).length + 1,
      createdAt: new Date().toISOString(),
    };
    thread.participants.push(participant);
    await this.commit(thread);
    return participant;
  }

  async changeModel(threadId: string, participantId: string, input: { model: string; effort?: string }): Promise<void> {
    const thread = await this.mustThread(threadId);
    const p = this.mustParticipant(thread, participantId);
    if (this.busy.has(p.id)) throw new RouterError('busy', 'That participant is still replying.');
    const from = modelLabel(p.model, p.effort);
    p.model = input.model;
    p.effort = input.effort || undefined;
    thread.messages.push({
      id: randomUUID(), kind: 'model_change', participant: p.id,
      from, to: modelLabel(p.model, p.effort), sentAt: new Date().toISOString(),
    });
    await this.commit(thread);
  }

  async send(threadId: string, input: SendInput): Promise<SendResult> {
    const thread = await this.mustThread(threadId);
    const p = this.mustParticipant(thread, input.to);
    const quotes = input.quotes ?? [];
    if (this.busy.has(p.id)) throw new RouterError('busy', 'That participant is still replying.');
    // Reserve the participant before any await, so two quick sends cannot both get through.
    this.busy.add(p.id);
    let attachments: Attachment[];
    let outgoing: string;
    let images: ImageInput[];
    try {
      attachments = await this.resolveAttachments(thread.id, input.attachmentIds ?? []);
      if (!input.text.trim() && !quotes.length && !attachments.length) {
        throw new RouterError('invalid', 'Write a message, forward a quote or attach a file.');
      }
      // Built before anything is recorded, so a missing file leaves the thread untouched.
      ({ message: outgoing, images } = await this.buildOutgoing(thread, input.text, quotes, attachments));
      if (this.deleted.has(thread.id)) throw new RouterError('not_found', 'That thread was deleted.');
    } catch (e) {
      this.busy.delete(p.id);
      throw e;
    }

    const now = new Date().toISOString();
    const user: UserMessage = {
      id: randomUUID(), kind: 'user', to: p.id, text: input.text, quotes,
      attachments: attachments.length ? attachments : undefined, sentAt: now, origin: input.origin,
    };
    const reply: ReplyMessage = {
      id: randomUUID(), kind: 'reply', from: p.id, text: '', model: p.model, effort: p.effort,
      status: 'streaming', sentAt: now, origin: input.origin,
    };
    thread.messages.push(user, reply);
    if (thread.title === UNTITLED) thread.title = deriveTitle(input.text, quotes);

    const controller = new AbortController();
    this.inflight.set(reply.id, controller);
    try {
      await this.commit(thread);
    } catch (e) {
      // Nothing reached the CLI yet; undo so the participant is not stuck busy.
      thread.messages.splice(thread.messages.indexOf(user), 2);
      this.busy.delete(p.id);
      this.inflight.delete(reply.id);
      this.deps.hub.emit(thread.id, { type: 'thread', thread });
      throw e;
    }
    const done = this.run(thread, p, reply, outgoing, images, controller);
    return { userMessageId: user.id, replyMessageId: reply.id, done };
  }

  stop(threadId: string, replyId: string): boolean {
    const controller = this.inflight.get(replyId);
    if (!controller || !this.threads.get(threadId)) return false;
    controller.abort();
    return true;
  }

  async retry(threadId: string, replyId: string): Promise<SendResult> {
    const thread = await this.mustThread(threadId);
    const idx = thread.messages.findIndex((m) => m.id === replyId && m.kind === 'reply');
    if (idx < 0) throw new RouterError('not_found', 'That reply no longer exists.');
    const reply = thread.messages[idx] as ReplyMessage;
    const user = thread.messages
      .slice(0, idx)
      .reverse()
      .find((m): m is UserMessage => m.kind === 'user' && m.to === reply.from);
    if (!user) throw new RouterError('not_found', 'Could not find the message to retry.');
    return this.send(threadId, { to: user.to, text: user.text, quotes: user.quotes, attachmentIds: user.attachments?.map((x) => x.id) });
  }

  private async run(thread: Thread, p: Participant, reply: ReplyMessage, message: string, images: ImageInput[], controller: AbortController): Promise<void> {
    const adapter = this.deps.adapters[p.provider];
    let pendingSession: string | undefined;
    let finished = false;
    try {
      for await (const ev of adapter.send({
        sessionId: p.sessionId, message, model: p.model, effort: p.effort,
        promptHash: p.promptHash, promptPath: snapshotPath(this.deps.paths, p.promptHash),
        images: images.length ? images : undefined,
        signal: controller.signal,
      })) {
        if (ev.type === 'session') {
          pendingSession = ev.sessionId;
        } else if (ev.type === 'delta') {
          reply.text += ev.text;
          this.deps.hub.emit(thread.id, { type: 'delta', messageId: reply.id, text: ev.text });
        } else if (ev.type === 'activity') {
          this.deps.hub.emit(thread.id, { type: 'activity', messageId: reply.id, text: ev.text });
        } else if (ev.type === 'source') {
          reply.sources ??= [];
          if (!reply.sources.includes(ev.url)) {
            reply.sources.push(ev.url);
            this.deps.hub.emit(thread.id, { type: 'thread', thread });
          }
        } else if (ev.type === 'warning') {
          console.warn(`consensus: ${p.provider}: ${ev.message}`);
        } else if (ev.type === 'done') {
          reply.text = ev.text;
          reply.status = 'done';
          // Only a finished turn advances memory; stopped or failed forks are dropped.
          if (pendingSession) p.sessionId = pendingSession;
          finished = true;
        } else if (ev.type === 'error') {
          reply.status = 'error';
          reply.error = ev.error;
          finished = true;
        }
      }
    } catch (e) {
      reply.status = 'error';
      reply.error = { code: 'unknown', message: e instanceof Error ? e.message : String(e) };
      finished = true;
    }
    if (!finished) {
      if (controller.signal.aborted) {
        reply.status = 'stopped';
      } else {
        reply.status = 'error';
        reply.error = { code: 'unknown', message: 'The CLI ended without a reply.' };
      }
    }
    this.busy.delete(p.id);
    this.inflight.delete(reply.id);
    try {
      await this.commit(thread);
    } catch (e) {
      console.error('consensus: could not save the finished reply', e);
    }
  }

  private async resolveAttachments(threadId: string, ids: string[]): Promise<Attachment[]> {
    if (ids.length > ATTACHMENT_LIMITS.perMessage) {
      throw new RouterError('invalid', `Attach at most ${ATTACHMENT_LIMITS.perMessage} files per message.`);
    }
    const out: Attachment[] = [];
    for (const id of ids) {
      const att = await this.attachments.get(threadId, id);
      if (!att) throw new RouterError('invalid', 'An attachment is missing. Attach the file again.');
      out.push(att);
    }
    return out;
  }

  private async buildOutgoing(thread: Thread, text: string, quotes: Quote[], attachments: Attachment[]): Promise<{ message: string; images: ImageInput[] }> {
    const ctx = forwardContext(thread, quotes);
    const original = quotes.length ? ctx.originalAttachments ?? [] : [];
    const render = async (list: Attachment[]) => {
      try {
        return await Promise.all(list.filter((a) => a.kind === 'text').map(async (a) => attachmentBlock(a, await this.attachments.text(thread.id, a))));
      } catch {
        throw new RouterError('invalid', 'An attached file is missing from disk. Attach it again.');
      }
    };
    const message = composeOutgoing(text, quotes, { ...ctx, originalBlocks: await render(original) }, await render(attachments));
    const seen = new Set<string>();
    const images = [...original, ...attachments]
      .filter((a) => a.kind === 'image' && !seen.has(a.id) && !!seen.add(a.id))
      .map((a) => ({ id: a.id, name: a.name, mime: a.mime, path: this.attachments.filePath(thread.id, a), threadId: thread.id }));
    return { message, images };
  }

  private async commit(thread: Thread): Promise<void> {
    if (this.deleted.has(thread.id)) return;
    const prev = this.saves.get(thread.id) ?? Promise.resolve();
    thread.updatedAt = new Date().toISOString();
    const next = prev.then(() => this.deps.store.save(thread));
    this.saves.set(thread.id, next.catch((e) => console.error('consensus: save failed', e)));
    this.deps.hub.emit(thread.id, { type: 'thread', thread });
    await next;
  }

  private async mustThread(id: string): Promise<Thread> {
    const thread = await this.getThread(id);
    if (!thread) throw new RouterError('not_found', 'That thread does not exist.');
    return thread;
  }

  private mustParticipant(thread: Thread, id: string): Participant {
    const p = thread.participants.find((x) => x.id === id);
    if (!p) throw new RouterError('not_found', 'That participant does not exist.');
    return p;
  }
}

function deriveTitle(text: string, quotes: Quote[]): string {
  const source = text.trim() || quotes[0]?.text.trim() || UNTITLED;
  const line = source.split('\n')[0].trim();
  return line.length > 60 ? `${line.slice(0, 57)}...` : line;
}
