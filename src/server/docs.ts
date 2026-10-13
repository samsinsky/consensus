import type { DocState, Thread } from '../shared/types.js';
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
    input: { status?: 'accepted' | 'rejected' | 'dismissed'; replacement?: string; notChosen?: string[] },
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
    for (const id of input.notChosen ?? []) {
      const other = thread.doc.proposals.find((x) => x.id === id);
      if (other?.status === 'open') {
        other.status = 'not_chosen';
        other.resolvedAt = now;
      }
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

  protected async mustDoc(threadId: string): Promise<Thread & { doc: DocState }> {
    const thread = await this.router.getThread(threadId);
    if (!thread) throw new RouterError('not_found', 'That thread does not exist.');
    if (thread.kind !== 'doc' || !thread.doc) throw new RouterError('invalid', 'This thread is not a doc.');
    return thread as Thread & { doc: DocState };
  }
}
