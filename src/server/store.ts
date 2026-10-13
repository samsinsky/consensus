import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Thread, ThreadSummary } from '../shared/types.js';

const SAFE_ID = /^[\w-]+$/;

export class ThreadStore {
  constructor(private dir: string) {}

  async create(title = 'Untitled thread'): Promise<Thread> {
    const now = new Date().toISOString();
    const thread: Thread = { id: randomUUID(), title, createdAt: now, updatedAt: now, participants: [], messages: [] };
    await this.save(thread);
    return thread;
  }

  async get(id: string): Promise<Thread | undefined> {
    if (!SAFE_ID.test(id)) return undefined;
    let thread: Thread;
    try {
      thread = JSON.parse(await readFile(this.file(id), 'utf8'));
    } catch {
      return undefined;
    }
    for (const m of thread.messages) {
      if (m.kind === 'reply' && m.status === 'streaming') {
        m.status = 'error';
        m.error = { code: 'interrupted', message: 'Consensus stopped before this reply finished.' };
      }
    }
    return thread;
  }

  async list(): Promise<ThreadSummary[]> {
    await mkdir(this.dir, { recursive: true });
    const files = (await readdir(this.dir)).filter((f) => f.endsWith('.json'));
    const summaries: ThreadSummary[] = [];
    for (const f of files) {
      try {
        const t = JSON.parse(await readFile(join(this.dir, f), 'utf8')) as Thread;
        summaries.push({ id: t.id, title: t.title, updatedAt: t.updatedAt, kind: t.kind });
      } catch {
        console.warn(`consensus: skipping unreadable thread file ${f}`);
      }
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async save(thread: Thread): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    thread.updatedAt = new Date().toISOString();
    const tmp = join(this.dir, `.${thread.id}.${randomUUID()}.tmp`);
    await writeFile(tmp, JSON.stringify(thread, null, 2));
    await rename(tmp, this.file(thread.id));
  }

  async delete(id: string): Promise<void> {
    if (!SAFE_ID.test(id)) return;
    await rm(this.file(id), { force: true });
  }

  private file(id: string): string {
    return join(this.dir, `${id}.json`);
  }
}
