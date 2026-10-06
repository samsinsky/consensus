import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import mammoth from 'mammoth';
import { extractText as extractPdfText, getDocumentProxy } from 'unpdf';
import type { Attachment, AttachmentKind } from '../shared/types.js';

export const ATTACHMENT_LIMITS = {
  fileBytes: 20 * 1024 * 1024,
  imageBytes: 5 * 1024 * 1024,
  chars: 100_000,
  perMessage: 10,
};

const TEXT_TYPES: Record<string, string> = {
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv',
  '.json': 'application/json', '.html': 'text/html', '.htm': 'text/html',
};
const DOC_TYPES: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pdf': 'application/pdf',
};
const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
};
const SAFE_ID = /^[\w-]+$/;

export class AttachmentError extends Error {
  constructor(public status: 400 | 413 | 415 | 422, message: string) {
    super(message);
  }
}

export function truncationNote(): string {
  return `[Truncated: only the first ${ATTACHMENT_LIMITS.chars.toLocaleString('en-US')} characters are included.]`;
}

export class AttachmentStore {
  constructor(private threadsDir: string) {}

  private root(threadId: string): string {
    return join(this.threadsDir, threadId, 'attachments');
  }

  async save(threadId: string, rawName: string, data: Buffer): Promise<Attachment> {
    if (!SAFE_ID.test(threadId)) throw new AttachmentError(400, 'Unknown thread.');
    // Keep only the base name for display; the file itself is stored under a fixed name.
    const name = rawName.split(/[\\/]/).pop()!.trim() || 'file';
    const ext = extname(name).toLowerCase();
    const kind: AttachmentKind | undefined = IMAGE_TYPES[ext] ? 'image' : TEXT_TYPES[ext] || DOC_TYPES[ext] ? 'text' : undefined;
    if (!kind) {
      throw new AttachmentError(415, `Consensus can't read ${ext || 'files without an extension'}. Attach text, Word, PDF or image files.`);
    }
    const limit = kind === 'image' ? ATTACHMENT_LIMITS.imageBytes : ATTACHMENT_LIMITS.fileBytes;
    if (data.length > limit) throw new AttachmentError(413, `${name} is larger than ${limit / 1024 / 1024}MB.`);

    const att: Attachment = {
      id: randomUUID(), name, kind, mime: IMAGE_TYPES[ext] ?? TEXT_TYPES[ext] ?? DOC_TYPES[ext],
      size: data.length, createdAt: new Date().toISOString(),
    };
    let text: string | undefined;
    if (kind === 'text') {
      text = (await extract(ext, data)).trim();
      if (!text) throw new AttachmentError(422, `No text found in ${name}. Scanned PDFs and image-only documents aren't supported.`);
      if (text.length > ATTACHMENT_LIMITS.chars) {
        text = text.slice(0, ATTACHMENT_LIMITS.chars);
        att.truncated = true;
      }
      att.chars = text.length;
    }
    const dir = join(this.root(threadId), att.id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `file${ext}`), data);
    if (text !== undefined) await writeFile(join(dir, 'extracted.txt'), text);
    await writeFile(join(dir, 'meta.json'), JSON.stringify(att));
    return att;
  }

  async get(threadId: string, id: string): Promise<Attachment | undefined> {
    if (!SAFE_ID.test(threadId) || !SAFE_ID.test(id)) return undefined;
    try {
      return JSON.parse(await readFile(join(this.root(threadId), id, 'meta.json'), 'utf8'));
    } catch {
      return undefined;
    }
  }

  filePath(threadId: string, att: Attachment): string {
    return join(this.root(threadId), att.id, `file${extname(att.name).toLowerCase()}`);
  }

  text(threadId: string, att: Attachment): Promise<string> {
    return readFile(join(this.root(threadId), att.id, 'extracted.txt'), 'utf8');
  }

  async removeThread(threadId: string): Promise<void> {
    if (!SAFE_ID.test(threadId)) return;
    await rm(join(this.threadsDir, threadId), { recursive: true, force: true });
  }

  /** Deletes uploads no message references once they are older than maxAgeMs. */
  async sweep(threadId: string, referenced: Set<string>, maxAgeMs: number, now = Date.now()): Promise<number> {
    let ids: string[];
    try {
      ids = await readdir(this.root(threadId));
    } catch {
      return 0;
    }
    let removed = 0;
    for (const id of ids) {
      if (referenced.has(id)) continue;
      const att = await this.get(threadId, id);
      if (att && now - Date.parse(att.createdAt) < maxAgeMs) continue;
      await rm(join(this.root(threadId), id), { recursive: true, force: true });
      removed++;
    }
    return removed;
  }
}

async function extract(ext: string, data: Buffer): Promise<string> {
  if (ext === '.docx') {
    try {
      return (await mammoth.extractRawText({ buffer: data })).value;
    } catch {
      throw new AttachmentError(422, 'That Word file could not be read.');
    }
  }
  if (ext === '.pdf') {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(data));
      return (await extractPdfText(pdf, { mergePages: true })).text;
    } catch {
      throw new AttachmentError(422, 'That PDF could not be read.');
    }
  }
  return data.toString('utf8');
}
