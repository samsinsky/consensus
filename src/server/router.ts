import { randomUUID } from 'node:crypto';
import { modelLabel } from '../shared/labels.js';
import type { Origin, Participant, ProviderId, Quote, ReplyMessage, Thread, UserMessage } from '../shared/types.js';
import type { ProviderAdapter } from './adapters/types.js';
import type { EventHub } from './hub.js';
import type { Paths } from './paths.js';
import { snapshotPath, snapshotPrompt } from './prompt.js';
import type { ThreadStore } from './store.js';

export class RouterError extends Error {
  constructor(public code: 'not_found' | 'busy' | 'invalid', message: string) {
    super(message);
  }
}

export type SendInput = { to: string; text: string; quotes?: Quote[]; origin?: Origin };
export type SendResult = { userMessageId: string; replyMessageId: string; done: Promise<void> };

type Deps = {
  store: ThreadStore;
  hub: EventHub;
  paths: Paths;
  adapters: Record<ProviderId, ProviderAdapter>;
};

const UNTITLED = 'Untitled thread';

export function composeOutgoing(text: string, quotes: Quote[]): string {
  if (!quotes.length) return text;
  const blocks = quotes.map((q) => `Feedback from another reviewer:\n<quoted>\n${q.text}\n</quoted>`);
  return [...blocks, text].join('\n\n');
}

export class Router {
  private threads = new Map<string, Thread>();
  private saves = new Map<string, Promise<void>>();
  private inflight = new Map<string, AbortController>();
  private busy = new Set<string>();

  constructor(private deps: Deps) {}

  async getThread(id: string): Promise<Thread | undefined> {
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

  async addParticipant(threadId: string, input: { provider: ProviderId; model: string; effort?: string }): Promise<Participant> {
    const thread = await this.mustThread(threadId);
    const participant: Participant = {
      id: randomUUID(),
      provider: input.provider,
      model: input.model,
      effort: input.effort || undefined,
      promptHash: await snapshotPrompt(this.deps.paths),
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
    if (!input.text.trim() && !quotes.length) throw new RouterError('invalid', 'Write a message or forward a quote.');
    if (this.busy.has(p.id)) throw new RouterError('busy', 'That participant is still replying.');

    const now = new Date().toISOString();
    const user: UserMessage = { id: randomUUID(), kind: 'user', to: p.id, text: input.text, quotes, sentAt: now, origin: input.origin };
    const reply: ReplyMessage = {
      id: randomUUID(), kind: 'reply', from: p.id, text: '', model: p.model, effort: p.effort,
      status: 'streaming', sentAt: now, origin: input.origin,
    };
    thread.messages.push(user, reply);
    if (thread.title === UNTITLED) thread.title = deriveTitle(input.text, quotes);

    const controller = new AbortController();
    this.busy.add(p.id);
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
    const done = this.run(thread, p, reply, composeOutgoing(input.text, quotes), controller);
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
    return this.send(threadId, { to: user.to, text: user.text, quotes: user.quotes });
  }

  private async run(thread: Thread, p: Participant, reply: ReplyMessage, message: string, controller: AbortController): Promise<void> {
    const adapter = this.deps.adapters[p.provider];
    let pendingSession: string | undefined;
    let finished = false;
    try {
      for await (const ev of adapter.send({
        sessionId: p.sessionId, message, model: p.model, effort: p.effort,
        promptHash: p.promptHash, promptPath: snapshotPath(this.deps.paths, p.promptHash),
        signal: controller.signal,
      })) {
        if (ev.type === 'session') {
          pendingSession = ev.sessionId;
        } else if (ev.type === 'delta') {
          reply.text += ev.text;
          this.deps.hub.emit(thread.id, { type: 'delta', messageId: reply.id, text: ev.text });
        } else if (ev.type === 'warning') {
          console.warn(`relay: ${p.provider}: ${ev.message}`);
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
      console.error('relay: could not save the finished reply', e);
    }
  }

  private async commit(thread: Thread): Promise<void> {
    const prev = this.saves.get(thread.id) ?? Promise.resolve();
    thread.updatedAt = new Date().toISOString();
    const next = prev.then(() => this.deps.store.save(thread));
    this.saves.set(thread.id, next.catch((e) => console.error('relay: save failed', e)));
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
