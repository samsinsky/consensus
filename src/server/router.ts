import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { modelLabel } from '../shared/labels.js';
import type { AdapterError, Attachment, Origin, Participant, ProviderId, Quote, ReplyMessage, Thread, ThreadEvent, UserMessage } from '../shared/types.js';
import type { ImageInput, ProviderAdapter } from './adapters/types.js';
import { ATTACHMENT_LIMITS, AttachmentStore, truncationNote } from './attachments.js';
import type { EventHub } from './hub.js';
import type { Paths } from './paths.js';
import { participantPrompt, snapshotPath, snapshotPrompt } from './prompt.js';
import type { ThreadStore } from './store.js';

export class RouterError extends Error {
  constructor(public code: 'not_found' | 'busy' | 'invalid', message: string) {
    super(message);
  }
}

export type SendInput = { to: string; text: string; quotes?: Quote[]; attachmentIds?: string[]; origin?: Origin };
export type SendResult = { userMessageId: string; replyMessageId: string; done: Promise<void> };
export type TurnHooks = { onDelta?: (text: string) => void; onActivity?: (text: string) => void; onSource?: (url: string) => void };
export type TurnResult = { status: 'done' | 'stopped' | 'error'; text: string; error?: AdapterError; sources: string[] };

type Deps = {
  store: ThreadStore;
  hub: EventHub;
  paths: Paths;
  adapters: Record<ProviderId, ProviderAdapter>;
  attachments?: AttachmentStore;
};

export const UNTITLED = 'Untitled thread';

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

/** Sent with every forward: weigh the feedback, keep the draft unless something is wrong, and hand taste calls to Sam. */
export const FORWARD_TASK =
  'What to do with this:\n' +
  "1. Treat the other reviewer's draft as the current version. Change it only to fix a real problem: an error, something unclear, or something that misses my requests. If a change comes down to taste, keep the current wording.\n" +
  "2. Respond briefly to the other reviewer's points. Skip points you both already agree on. You can agree with a point without changing anything.\n" +
  '3. If the copy is ready, say so and give it unchanged. Otherwise, write the full revised copy.\n' +
  '4. If you disagree with the other reviewer on a matter of taste, don\'t change it back. List it under "Your call" with each option on one line, and I\'ll decide.\n\n' +
  'If my note below asks for something different, follow the note.';

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
    blocks.push(FORWARD_TASK, ...attachmentBlocks);
    if (text.trim()) blocks.push(`My note:\n${text}`);
    return blocks.join('\n\n');
  }
  if (!attachmentBlocks.length) return text;
  return [...attachmentBlocks, text].filter(Boolean).join('\n\n');
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
 * participant, back to his last message to someone else. The receiver never gets its own replies
 * back: they are already in its conversation.
 */
export function forwardContext(thread: Thread, quotes: Quote[], receiver?: string): ForwardContext {
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
    const root = thread.messages.find((m): m is UserMessage => m.kind === 'user' && !!m.text.trim());
    const notOwn = (x: Quote) => !receiver || authorOf(thread, x.messageId) !== receiver;

    // Starting point: the participant's own previous version, else the draft forwarded in, else its first reply in the round.
    const previous = lastReplyFrom(thread.messages.slice(0, firstIdx), from);
    const forwardedIn = first.quotes.filter(notOwn).map((x) => x.text).join('\n\n');
    const firstReply = round.length > 1 ? lastReplyFrom(thread.messages.slice(firstIdx, thread.messages.indexOf(round[1])), from) : undefined;
    const start = previous ?? (forwardedIn || firstReply);
    const startFromQuotes = !previous && !!forwardedIn;

    const requests = round
      .filter((m) => m !== root)
      .map((m) => ({ text: m.text.trim(), quotes: m === first && startFromQuotes ? [] : m.quotes.filter(notOwn).map((x) => x.text) }))
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

function authorOf(thread: Thread, replyId: string): string | undefined {
  const m = thread.messages.find((x) => x.id === replyId);
  return m?.kind === 'reply' ? m.from : undefined;
}

export class Router {
  private threads = new Map<string, Thread>();
  private saves = new Map<string, Promise<void>>();
  private inflight = new Map<string, AbortController>();
  private busy = new Set<string>();
  private rounds = new Map<string, AbortController>();

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
    this.rounds.get(threadId)?.abort();
    this.rounds.delete(threadId);
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
      const referenced = new Set([
        ...thread.messages.flatMap((m) => (m.kind === 'user' ? (m.attachments ?? []).map((a) => a.id) : [])),
        ...(thread.doc?.briefAttachments ?? []).map((a) => a.id),
      ]);
      removed += await this.attachments.sweep(thread.id, referenced, maxAgeMs);
    }
    return removed;
  }

  async addParticipant(
    threadId: string,
    input: { provider: ProviderId; model: string; effort?: string; name?: string; instructions?: string },
  ): Promise<Participant> {
    const thread = await this.mustThread(threadId);
    const participant: Participant = {
      id: randomUUID(),
      provider: input.provider,
      model: input.model,
      effort: input.effort || undefined,
      promptHash: await snapshotPrompt(this.deps.paths),
      ...cleanFocus(input),
      ordinal: thread.participants.filter((x) => x.provider === input.provider).length + 1,
      createdAt: new Date().toISOString(),
    };
    thread.participants.push(participant);
    if (thread.doc) thread.doc.included.push(participant.id);
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

  /** Renames a participant or changes its instructions; the instructions apply from its next turn. */
  async updateParticipant(threadId: string, participantId: string, input: { name?: string; instructions?: string }): Promise<void> {
    const thread = await this.mustThread(threadId);
    const p = this.mustParticipant(thread, participantId);
    if (this.busy.has(p.id)) throw new RouterError('busy', 'That participant is still replying.');
    const next = cleanFocus(input);
    if ('name' in input) p.name = next.name;
    if ('instructions' in input) p.instructions = next.instructions;
    await this.commit(thread);
  }

  async send(threadId: string, input: SendInput): Promise<SendResult> {
    const thread = await this.mustThread(threadId);
    if (thread.kind === 'doc') throw new RouterError('invalid', 'This thread is a doc. Ask for a review round instead.');
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
      ({ message: outgoing, images } = await this.buildOutgoing(thread, input.to, input.text, quotes, attachments));
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

  async removeParticipant(threadId: string, participantId: string): Promise<void> {
    const thread = await this.mustThread(threadId);
    const p = this.mustParticipant(thread, participantId);
    if (this.busy.has(p.id)) throw new RouterError('busy', 'That participant is still replying.');
    thread.participants = thread.participants.filter((x) => x.id !== p.id);
    if (thread.doc) thread.doc.included = thread.doc.included.filter((id) => id !== p.id);
    await this.commit(thread);
  }

  save(thread: Thread): Promise<void> {
    return this.commit(thread);
  }

  tryReserve(participantId: string): boolean {
    if (this.busy.has(participantId)) return false;
    this.busy.add(participantId);
    return true;
  }

  release(participantId: string): void {
    this.busy.delete(participantId);
  }

  isDeleted(threadId: string): boolean {
    return this.deleted.has(threadId);
  }

  emit(threadId: string, ev: ThreadEvent): void {
    this.deps.hub.emit(threadId, ev);
  }

  registerRound(threadId: string, c: AbortController): void {
    this.rounds.set(threadId, c);
  }

  unregisterRound(threadId: string): void {
    this.rounds.delete(threadId);
  }

  roundRunning(threadId: string): boolean {
    return this.rounds.has(threadId);
  }

  /** Text attachments as blocks to inline, images as CLI image inputs. */
  async renderAttachments(threadId: string, list: Attachment[]): Promise<{ blocks: string[]; images: ImageInput[] }> {
    let blocks: string[];
    try {
      blocks = await Promise.all(list.filter((a) => a.kind === 'text').map(async (a) => attachmentBlock(a, await this.attachments.text(threadId, a))));
    } catch {
      throw new RouterError('invalid', 'An attached file is missing from disk. Attach it again.');
    }
    const images = list
      .filter((a) => a.kind === 'image')
      .map((a) => ({ id: a.id, name: a.name, mime: a.mime, path: this.attachments.filePath(threadId, a), threadId }));
    return { blocks, images };
  }

  /** Runs one CLI turn. Memory advances only when the turn finishes. */
  async runTurn(p: Participant, message: string, images: ImageInput[], signal: AbortSignal, hooks: TurnHooks = {}): Promise<TurnResult> {
    const adapter = this.deps.adapters[p.provider];
    let pendingSession: string | undefined;
    let text = '';
    const sources: string[] = [];
    let result: TurnResult | undefined;
    try {
      const hash = p.instructions ? await participantPrompt(this.deps.paths, p) : p.promptHash;
      // A resumed session keeps the system prompt it started with, so a change mid-conversation travels in the message.
      const started = p.sessionPromptHash ?? p.promptHash;
      if (p.sessionId && started !== hash) message = `${instructionsNote(p.instructions)}\n\n${message}`;
      for await (const ev of adapter.send({
        sessionId: p.sessionId, message, model: p.model, effort: p.effort,
        promptHash: hash, promptPath: snapshotPath(this.deps.paths, hash),
        images: images.length ? images : undefined,
        signal,
      })) {
        if (ev.type === 'session') {
          pendingSession = ev.sessionId;
        } else if (ev.type === 'delta') {
          text += ev.text;
          hooks.onDelta?.(ev.text);
        } else if (ev.type === 'activity') {
          hooks.onActivity?.(ev.text);
        } else if (ev.type === 'source') {
          if (!sources.includes(ev.url)) {
            sources.push(ev.url);
            hooks.onSource?.(ev.url);
          }
        } else if (ev.type === 'warning') {
          console.warn(`consensus: ${p.provider}: ${ev.message}`);
        } else if (ev.type === 'done') {
          // Only a finished turn advances memory; stopped or failed forks are dropped.
          if (pendingSession) {
            p.sessionId = pendingSession;
            // The session has now heard this prompt, from its start or from the note above.
            p.sessionPromptHash = hash === p.promptHash ? undefined : hash;
          }
          result = { status: 'done', text: ev.text, sources };
        } else if (ev.type === 'error') {
          result = { status: 'error', text, error: ev.error, sources };
        }
      }
    } catch (e) {
      result = { status: 'error', text, error: { code: 'unknown', message: e instanceof Error ? e.message : String(e) }, sources };
    }
    if (result) return result;
    if (signal.aborted) return { status: 'stopped', text, sources };
    return { status: 'error', text, error: { code: 'unknown', message: 'The CLI ended without a reply.' }, sources };
  }

  private async run(thread: Thread, p: Participant, reply: ReplyMessage, message: string, images: ImageInput[], controller: AbortController): Promise<void> {
    const result = await this.runTurn(p, message, images, controller.signal, {
      onDelta: (text) => {
        reply.text += text;
        this.deps.hub.emit(thread.id, { type: 'delta', messageId: reply.id, text });
      },
      onActivity: (text) => this.deps.hub.emit(thread.id, { type: 'activity', messageId: reply.id, text }),
      onSource: (url) => {
        reply.sources = [...(reply.sources ?? []), url];
        this.deps.hub.emit(thread.id, { type: 'thread', thread });
      },
    });
    reply.status = result.status;
    if (result.status === 'done') reply.text = result.text;
    if (result.error) reply.error = result.error;
    this.busy.delete(p.id);
    this.inflight.delete(reply.id);
    try {
      await this.commit(thread);
    } catch (e) {
      console.error('consensus: could not save the finished reply', e);
    }
  }

  async resolveAttachments(threadId: string, ids: string[]): Promise<Attachment[]> {
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

  private async buildOutgoing(thread: Thread, to: string, text: string, quotes: Quote[], attachments: Attachment[]): Promise<{ message: string; images: ImageInput[] }> {
    const ctx = forwardContext(thread, quotes, to);
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

export function deriveTitle(text: string, quotes: Quote[]): string {
  const source = text.trim() || quotes[0]?.text.trim() || UNTITLED;
  const line = source.split('\n')[0].trim();
  return line.length > 60 ? `${line.slice(0, 57)}...` : line;
}

/** Blank names and instructions are dropped rather than stored. */
function cleanFocus(input: { name?: string; instructions?: string }): { name?: string; instructions?: string } {
  return { name: input.name?.trim() || undefined, instructions: input.instructions?.trim() || undefined };
}

function instructionsNote(instructions?: string): string {
  return instructions
    ? `[The user changed your instructions. From now on, follow these in place of any earlier ones:\n\n${instructions}]`
    : '[The user removed the extra instructions they gave you earlier. Go back to your original instructions.]';
}
