import { cleanQuote, contextAt, findAll, indexString, normalize } from '../shared/anchor.js';
import { markdownToPlain } from '../shared/markdownText.js';
import type { Rebased } from '../shared/change.js';
import type { DocState, Participant, Round, RoundNote, Thread } from '../shared/types.js';
import type { ImageInput } from './adapters/types.js';
import { parseAnswer, type ParsedAnswer } from './docAnswer.js';
import { composeRound, repairMessage } from './docPrompt.js';
import { deriveTitle, RouterError, UNTITLED, type Router } from './router.js';

export function emptyDoc(input: { brief?: string; markdown?: string } = {}): DocState {
  return {
    brief: input.brief ?? '',
    markdown: input.markdown ?? '',
    savedAt: new Date().toISOString(),
    revision: 0,
    included: [],
    rounds: [],
    proposals: [],
    nextProposal: 1,
  };
}

/** Adds a participant's answer to the doc. Returns proposals whose quote failed to match the snapshot exactly once. */
export function ingest(doc: DocState, author: string, round: Round, answer: ParsedAnswer, now: string): { quote: string; reason: string }[] {
  const index = indexString(markdownToPlain(round.snapshot));
  const rejected: { quote: string; reason: string }[] = [];
  for (const prop of answer.proposals) {
    const hits = findAll(index, prop.quote);
    if (hits.length !== 1) {
      rejected.push({ quote: prop.quote, reason: hits.length ? `matched ${hits.length} places` : 'not found' });
      continue;
    }
    const quote = normalize(cleanQuote(prop.quote));
    const same = doc.proposals.find(
      (x) => x.status === 'open' && normalize(cleanQuote(x.quote)) === quote && normalize(x.replacement) === normalize(prop.replacement),
    );
    if (same) {
      if (!same.authors.includes(author)) {
        if (same.round === round.n) same.authors.push(author);
        else same.replies.push({ from: author, stance: 'agree', text: prop.reason, round: round.n, at: now });
      }
      continue;
    }
    doc.proposals.push({
      id: `P${doc.nextProposal++}`,
      round: round.n,
      authors: [author],
      quote: prop.quote,
      ...contextAt(index, hits[0], quote.length),
      replacement: prop.replacement,
      reason: prop.reason,
      status: 'open',
      replies: [],
    });
  }
  for (const r of answer.replies) {
    const target = doc.proposals.find((x) => x.id === r.proposal);
    if (!target || target.authors.includes(author)) continue;
    target.replies.push({ from: author, stance: r.stance, text: r.text, round: round.n, at: now });
  }
  return rejected;
}

export class DocService {
  constructor(protected router: Router) {}

  async create(input: { brief?: string; markdown?: string } = {}): Promise<Thread> {
    const thread = await this.router.createThread();
    thread.kind = 'doc';
    thread.doc = emptyDoc(input);
    if (input.brief?.trim()) thread.title = deriveTitle(input.brief, []);
    await this.router.save(thread);
    return thread;
  }

  async openAsDoc(threadId: string, replyId: string): Promise<Thread> {
    const source = await this.router.getThread(threadId);
    if (!source) throw new RouterError('not_found', 'That thread does not exist.');
    const reply = source.messages.find((m) => m.id === replyId && m.kind === 'reply');
    if (!reply || reply.kind !== 'reply' || reply.status !== 'done') throw new RouterError('not_found', 'That reply is not finished or no longer exists.');
    const first = source.messages.find((m) => m.kind === 'user' && m.text.trim());
    const thread = await this.create({ brief: first?.kind === 'user' ? first.text : '', markdown: reply.text });
    if (source.title !== UNTITLED) thread.title = source.title;
    // Fresh sessions: a doc never shares a CLI conversation with a chat thread.
    for (const p of source.participants) {
      await this.router.addParticipant(thread.id, { provider: p.provider, model: p.model, effort: p.effort });
    }
    await this.router.save(thread);
    return thread;
  }

  async saveDoc(threadId: string, input: { revision: number; markdown?: string; brief?: string; briefAttachmentIds?: string[] }): Promise<void> {
    const thread = await this.mustDoc(threadId);
    const doc = thread.doc;
    if (input.revision !== doc.revision) throw new RouterError('busy', 'The document changed on the server. Reload to keep editing.');
    if (input.briefAttachmentIds) doc.briefAttachments = await this.router.resolveAttachments(thread.id, input.briefAttachmentIds);
    if (input.markdown !== undefined) doc.markdown = input.markdown;
    if (input.brief !== undefined) {
      doc.brief = input.brief;
      if (thread.title === UNTITLED && input.brief.trim()) thread.title = deriveTitle(input.brief, []);
    }
    doc.savedAt = new Date().toISOString();
    await this.router.save(thread);
  }

  async setIncluded(threadId: string, participantId: string, included: boolean): Promise<void> {
    const thread = await this.mustDoc(threadId);
    if (!thread.participants.some((p) => p.id === participantId)) throw new RouterError('not_found', 'That participant does not exist.');
    const rest = thread.doc.included.filter((id) => id !== participantId);
    thread.doc.included = included ? [...rest, participantId] : rest;
    await this.router.save(thread);
  }

  async updateProposal(
    threadId: string,
    proposalId: string,
    input: {
      status?: 'accepted' | 'rejected' | 'dismissed';
      replacement?: string;
      notChosen?: string[];
      /** Open suggestions the accepted change rewrote. */
      superseded?: string[];
      /** Open suggestions whose quote the change touched but whose own change still applies, moved onto the new text. */
      rebased?: Rebased[];
    },
  ): Promise<void> {
    const thread = await this.mustDoc(threadId);
    const p = thread.doc.proposals.find((x) => x.id === proposalId);
    if (!p) throw new RouterError('not_found', 'That proposal no longer exists.');
    if (p.status !== 'open') throw new RouterError('invalid', 'That proposal is already settled.');
    const now = new Date().toISOString();
    if (input.replacement !== undefined) p.replacement = input.replacement;
    if (input.status) {
      p.status = input.status;
      p.resolvedAt = now;
    }
    const others = (ids: string[] | undefined, status: 'not_chosen' | 'superseded') => {
      for (const id of ids ?? []) {
        const other = thread.doc.proposals.find((x) => x.id === id);
        if (other?.status === 'open') {
          other.status = status;
          other.resolvedAt = now;
        }
      }
    };
    others(input.notChosen, 'not_chosen');
    others(input.superseded, 'superseded');
    for (const r of input.rebased ?? []) {
      const other = thread.doc.proposals.find((x) => x.id === r.id);
      if (other?.status === 'open') Object.assign(other, { quote: r.quote, replacement: r.replacement, prefix: r.prefix, suffix: r.suffix });
    }
    await this.router.save(thread);
  }

  async reply(threadId: string, proposalId: string, text: string): Promise<void> {
    const thread = await this.mustDoc(threadId);
    const p = thread.doc.proposals.find((x) => x.id === proposalId);
    if (!p) throw new RouterError('not_found', 'That proposal no longer exists.');
    if (!text.trim()) throw new RouterError('invalid', 'Write a reply first.');
    p.replies.push({ from: 'user', text: text.trim(), at: new Date().toISOString() });
    await this.router.save(thread);
  }

  async restore(threadId: string, round: number): Promise<void> {
    const thread = await this.mustDoc(threadId);
    const r = thread.doc.rounds.find((x) => x.n === round);
    if (!r) throw new RouterError('not_found', 'That round does not exist.');
    thread.doc.markdown = r.snapshot;
    thread.doc.revision++;
    thread.doc.savedAt = new Date().toISOString();
    await this.router.save(thread);
  }

  async startRound(threadId: string): Promise<{ round: number; done: Promise<void> }> {
    const thread = await this.mustDoc(threadId);
    const doc = thread.doc;
    if (this.router.roundRunning(threadId)) throw new RouterError('busy', 'A review round is already running.');
    const people = doc.included
      .map((id) => thread.participants.find((p) => p.id === id))
      .filter((p): p is Participant => !!p);
    if (!people.length) throw new RouterError('invalid', 'Include at least one participant.');
    if (!doc.markdown.trim()) throw new RouterError('invalid', 'Write or paste a draft first.');
    const n = doc.rounds.length + 1;
    const round: Round = {
      n,
      sentAt: new Date().toISOString(),
      snapshot: doc.markdown,
      participants: people.map((p) => p.id),
      notes: Object.fromEntries(people.map((p) => [p.id, { status: 'running' } as RoundNote])),
    };
    const messages = await this.prepare(thread, people, round);
    const controller = new AbortController();
    this.router.registerRound(threadId, controller);
    this.controllers.set(threadId, controller);
    doc.rounds.push(round);
    try {
      await this.router.save(thread);
    } catch (e) {
      doc.rounds.pop();
      this.finish(threadId, people);
      throw e;
    }
    const done = Promise.all(people.map((p) => this.review(thread, p, round, messages.get(p.id)!, controller.signal)))
      .then(() => {})
      .finally(() => this.finish(threadId, []));
    return { round: n, done };
  }

  stopRound(threadId: string): boolean {
    const running = this.router.roundRunning(threadId);
    if (running) this.controllers.get(threadId)?.abort();
    return running;
  }

  async retryReview(threadId: string, participantId: string): Promise<{ done: Promise<void> }> {
    const thread = await this.mustDoc(threadId);
    const round = thread.doc.rounds.at(-1);
    const note = round?.notes[participantId];
    if (!round || !note || (note.status !== 'error' && note.status !== 'stopped')) {
      throw new RouterError('invalid', 'Only a failed or stopped review in the latest round can be retried.');
    }
    if (this.router.roundRunning(threadId)) throw new RouterError('busy', 'A review round is already running.');
    const p = thread.participants.find((x) => x.id === participantId);
    if (!p) throw new RouterError('not_found', 'That participant does not exist.');
    const messages = await this.prepare(thread, [p], round);
    const controller = new AbortController();
    this.router.registerRound(threadId, controller);
    this.controllers.set(threadId, controller);
    const previous = note;
    round.notes[p.id] = { status: 'running' };
    try {
      await this.router.save(thread);
    } catch (e) {
      round.notes[p.id] = previous;
      this.finish(threadId, [p]);
      throw e;
    }
    const done = this.review(thread, p, round, messages.get(p.id)!, controller.signal).finally(() => this.finish(threadId, []));
    return { done };
  }

  private controllers = new Map<string, AbortController>();

  /** Reserves each participant and builds its message against the round snapshot. */
  private async prepare(thread: Thread & { doc: DocState }, people: Participant[], round: Round): Promise<Map<string, { text: string; images: ImageInput[] }>> {
    const reserved: Participant[] = [];
    for (const p of people) {
      if (!this.router.tryReserve(p.id)) {
        this.finish(thread.id, reserved);
        throw new RouterError('busy', 'A participant is still replying.');
      }
      reserved.push(p);
    }
    try {
      const { blocks, images } = await this.router.renderAttachments(thread.id, thread.doc.briefAttachments ?? []);
      const asSent = { ...thread.doc, markdown: round.snapshot };
      return new Map(people.map((p) => [p.id, {
        text: composeRound({ doc: asSent, round: round.n, receiver: p.id, briefBlocks: blocks, since: this.lastReview(thread.doc, p.id, round.n) }),
        images,
      }]));
    } catch (e) {
      this.finish(thread.id, reserved);
      throw e;
    }
  }

  private lastReview(doc: DocState, participantId: string, before: number): string | undefined {
    return [...doc.rounds].reverse().find((r) => r.n < before && r.participants.includes(participantId))?.sentAt;
  }

  private async review(thread: Thread & { doc: DocState }, p: Participant, round: Round, message: { text: string; images: ImageInput[] }, signal: AbortSignal): Promise<void> {
    const hooks = { onActivity: (text: string) => this.router.emit(thread.id, { type: 'activity', messageId: `doc:${p.id}`, text }) };
    const known = new Set(thread.doc.proposals.filter((x) => x.status === 'open').map((x) => x.id));
    const note: RoundNote = { status: 'running' };
    try {
      let result = await this.router.runTurn(p, message.text, message.images, signal, hooks);
      if (result.status === 'done') {
        note.answer = result.text;
        let parsed = parseAnswer(result.text, known);
        if (!parsed.ok) {
          const repair = await this.router.runTurn(p, repairMessage(parsed.reason), [], signal, hooks);
          if (repair.status === 'done') parsed = parseAnswer(repair.text, known);
          else result = repair;
        }
        if (result.status === 'done') {
          if (parsed.ok) {
            note.status = 'done';
            note.verdict = parsed.value.verdict;
            note.note = parsed.value.note;
            note.rejected = ingest(thread.doc, p.id, round, parsed.value, new Date().toISOString());
          } else {
            note.status = 'error';
            note.error = { code: 'parse', message: `The answer ${parsed.reason}.` };
          }
        }
      }
      if (result.status === 'stopped') note.status = 'stopped';
      if (result.status === 'error') {
        note.status = 'error';
        note.error = result.error;
      }
    } catch (e) {
      console.error('consensus: could not read the review', e);
      note.status = 'error';
      note.error = { code: 'parse', message: `Could not read the answer: ${(e as Error).message}` };
    } finally {
      round.notes[p.id] = note;
      this.router.release(p.id);
    }
    if (this.router.isDeleted(thread.id)) return;
    try {
      await this.router.save(thread);
    } catch (e) {
      console.error('consensus: could not save the review', e);
    }
  }

  /** Ends a round: frees any participants still reserved and forgets its controller. */
  private finish(threadId: string, people: Participant[]): void {
    for (const p of people) this.router.release(p.id);
    this.router.unregisterRound(threadId);
    this.controllers.delete(threadId);
  }

  protected async mustDoc(threadId: string): Promise<Thread & { doc: DocState }> {
    const thread = await this.router.getThread(threadId);
    if (!thread) throw new RouterError('not_found', 'That thread does not exist.');
    if (thread.kind !== 'doc' || !thread.doc) throw new RouterError('invalid', 'This thread is not a doc.');
    return thread as Thread & { doc: DocState };
  }
}
