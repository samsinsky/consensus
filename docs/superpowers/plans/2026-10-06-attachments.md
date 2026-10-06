# Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Sam attach text documents and images to messages by drag and drop, paperclip or paste; send them to Claude, ChatGPT and Gemini through each CLI's own channel; store them with their thread; and delete threads with their files.

**Architecture:** A new `AttachmentStore` saves each upload under `~/.consensus/threads/<threadId>/attachments/<id>/` and extracts document text on upload. Messages hold attachment references. The router inlines document text as `<attachment>` blocks and passes images to adapters as `ImageInput[]`; Claude switches to stream-json input for image turns, Codex adds `-i` flags, Gemini copies images into its workdir and runs a `view_file`-only agent variant for that turn.

**Tech Stack:** Node 24, TypeScript 5, React 19, Vitest, `mammoth` (docx), `unpdf` (pdf).

**Spec:** `docs/superpowers/specs/2026-10-05-consensus-design.md` (section "Attachments")

## Global Constraints

- Supported: text `.txt .md .csv .json .html .htm`; documents `.docx .pdf`; images `.png .jpg .jpeg .gif .webp`.
- Limits: 20MB per document or text file, 5MB per image, 10 attachments per message, 100,000 extracted characters (cut with a visible note).
- Inline format: `<attachment name="NAME">\nTEXT\n</attachment>`; truncation note: `[Truncated: only the first 100,000 characters are included.]`
- Storage: `~/.consensus/threads/<threadId>/attachments/<attachmentId>/file<ext>`, `extracted.txt`, `meta.json`.
- Uploads: `POST /api/threads/:id/attachments`, raw body, `x-filename` (URI-encoded), required `x-consensus-upload: 1`.
- Only images are served back (`GET /api/threads/:id/attachments/:attachmentId`), with `x-content-type-options: nosniff`.
- Forwarding carries the original request's attachments only. Retry resends the same attachments.
- Gemini image turns use agent `consensus-<hash>-viewer` with `tools: [view_file]`; all other Gemini turns keep `tools: []`.
- Delete thread removes the thread JSON, `threads/<id>/`, and `workdir/gemini/attachments/<id>/`; a reply finishing after deletion must not recreate the thread.
- Startup sweep deletes unreferenced uploads older than 24 hours.
- UI copy: no em dashes.

## Review Focus

1. **Another website posts a file to the upload endpoint:** refused, because the request lacks `x-consensus-upload` (forces a CORS preflight) and fails the Origin check. Test: Task 2 "rejects uploads without the upload header".
2. **A file named `../../.ssh/id_rsa.txt` or with quotes and unicode:** stored inside its attachment folder under a fixed name; the display name keeps only the base name. Test: Task 1 "stores files under fixed names whatever the upload is called".
3. **An attached `.html` file is requested back from the server:** not served, so it can never run as a page on the Consensus origin. Test: Task 2 "serves images only".
4. **Deleting a thread while a reply streams:** the reply stops, files are removed, and the finishing reply does not recreate the thread file. Test: Task 3 "deletes a thread mid-reply without it coming back".
5. **Retrying or forwarding after a restart:** attachments resolve from disk, not memory. Test: Task 3 "resends attachments on retry from a fresh router".

---

## File map

```
src/shared/types.ts                 + Attachment, AttachmentKind; UserMessage.attachments
src/server/attachments.ts           AttachmentStore, AttachmentError, limits, extraction
src/server/store.ts                 + ThreadStore.delete
src/server/router.ts                + attachments in send/retry/forward, deleteThread, sweepAttachments
src/server/http.ts                  + upload, serve image, DELETE thread, attachmentIds on send
src/server/cli.ts                   + startup sweep
src/server/adapters/types.ts        + ImageInput, SendRequest.images
src/server/adapters/claude.ts       + stream-json image input
src/server/adapters/codex.ts        + -i flags
src/server/adapters/gemini.ts       + image copies and viewer agent
src/web/api.ts                      + uploadAttachment, deleteThread, attachmentUrl, attachmentIds
src/web/format.ts                   formatSize
src/web/useAttachments.ts           pending upload state
src/web/components/AttachmentChip.tsx
src/web/components/Composer.tsx     + drop area, paperclip, paste, chips
src/web/components/MessageView.tsx  + attachment chips
src/web/components/ThreadView.tsx   + delete thread, Composer wraps MessageList
src/web/App.tsx                     + onDeleted
scripts/smoke.ts                    + image check per provider
test/fixtures/make_fixtures.py, sample.docx, sample.pdf, blank.pdf
```

---

### Task 1: Attachment store and extraction

**Files:**
- Modify: `src/shared/types.ts`, `package.json` (deps)
- Create: `src/server/attachments.ts`, `test/fixtures/make_fixtures.py`, `test/fixtures/sample.docx`, `test/fixtures/sample.pdf`, `test/fixtures/blank.pdf`
- Test: `test/server/attachments.test.ts`

**Interfaces:**
- Produces:
  - `type AttachmentKind = 'text' | 'image'`
  - `type Attachment = { id: string; name: string; kind: AttachmentKind; mime: string; size: number; chars?: number; truncated?: boolean; createdAt: string }`
  - `UserMessage.attachments?: Attachment[]`
  - `ATTACHMENT_LIMITS = { fileBytes, imageBytes, chars, perMessage }`
  - `class AttachmentError extends Error { status: 400 | 413 | 415 | 422 }`
  - `truncationNote(): string`
  - `class AttachmentStore { constructor(threadsDir: string); save(threadId, name, data: Buffer): Promise<Attachment>; get(threadId, id): Promise<Attachment | undefined>; filePath(threadId, att): string; text(threadId, att): Promise<string>; removeThread(threadId): Promise<void>; sweep(threadId, referenced: Set<string>, maxAgeMs: number, now?: number): Promise<number> }`

- [ ] **Step 1: Install dependencies and generate fixtures**

```bash
npm install mammoth@1 unpdf@1
```

`test/fixtures/make_fixtures.py`:
```python
"""Writes tiny docx and pdf fixtures for attachment tests. Run: python3 test/fixtures/make_fixtures.py"""
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))

def docx(path, text):
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            '</Types>')
        z.writestr('_rels/.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '</Relationships>')
        z.writestr('word/document.xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            f'<w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>')

def pdf(path, text):
    content = f'BT /F1 12 Tf 10 50 Td ({text}) Tj ET'.encode() if text else b''
    objects = [
        b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        b'<< /Length ' + str(len(content)).encode() + b' >>\nstream\n' + content + b'\nendstream',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ]
    out = b'%PDF-1.4\n'
    offsets = []
    for i, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += f'{i} 0 obj\n'.encode() + body + b'\nendobj\n'
    xref = len(out)
    out += f'xref\n0 {len(objects) + 1}\n0000000000 65535 f \n'.encode()
    out += b''.join(f'{o:010d} 00000 n \n'.encode() for o in offsets)
    out += f'trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    with open(path, 'wb') as f:
        f.write(out)

docx(os.path.join(HERE, 'sample.docx'), 'Hello from Word')
pdf(os.path.join(HERE, 'sample.pdf'), 'Hello from PDF')
pdf(os.path.join(HERE, 'blank.pdf'), '')
```

Run: `python3 test/fixtures/make_fixtures.py && ls test/fixtures`
Expected: `blank.pdf make_fixtures.py sample.docx sample.pdf`

- [ ] **Step 2: Add the types**

In `src/shared/types.ts`, after the `Quote` type:
```ts
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
```
And in `UserMessage`, after `quotes: Quote[];`:
```ts
  attachments?: Attachment[];
```

- [ ] **Step 3: Write the failing tests**

`test/server/attachments.test.ts`:
```ts
import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ATTACHMENT_LIMITS, AttachmentStore } from '../../src/server/attachments.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const newStore = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'consensus-att-'));
  return { dir, store: new AttachmentStore(dir) };
};
const fixture = (name: string) => readFile(join(FIXTURES, name));

describe('AttachmentStore', () => {
  it('saves a text file and its extracted text', async () => {
    const { store } = await newStore();
    const att = await store.save('t1', 'brief.md', Buffer.from('# Brief\nAudience: CFOs'));
    expect(att).toMatchObject({ name: 'brief.md', kind: 'text', mime: 'text/markdown', size: 22, chars: 22 });
    expect(await store.text('t1', att)).toBe('# Brief\nAudience: CFOs');
    expect(await store.get('t1', att.id)).toEqual(att);
  });

  it('extracts text from Word and PDF files', async () => {
    const { store } = await newStore();
    const docx = await store.save('t1', 'notes.docx', await fixture('sample.docx'));
    const pdf = await store.save('t1', 'deck.pdf', await fixture('sample.pdf'));
    expect(await store.text('t1', docx)).toBe('Hello from Word');
    expect(await store.text('t1', pdf)).toContain('Hello from PDF');
  });

  it('refuses documents with no text', async () => {
    const { store } = await newStore();
    await expect(store.save('t1', 'scan.pdf', await fixture('blank.pdf'))).rejects.toMatchObject({
      status: 422, message: "No text found in scan.pdf. Scanned PDFs and image-only documents aren't supported.",
    });
  });

  it('saves images without extracting text', async () => {
    const { store } = await newStore();
    const att = await store.save('t1', 'Shot.PNG', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(att).toMatchObject({ kind: 'image', mime: 'image/png', size: 4 });
    expect(att.chars).toBeUndefined();
    expect(store.filePath('t1', att).endsWith(`${att.id}/file.png`)).toBe(true);
  });

  it('refuses unsupported types and oversized files', async () => {
    const { store } = await newStore();
    await expect(store.save('t1', 'run.exe', Buffer.from('x'))).rejects.toMatchObject({ status: 415 });
    await expect(store.save('t1', 'big.png', Buffer.alloc(ATTACHMENT_LIMITS.imageBytes + 1))).rejects.toMatchObject({ status: 413 });
    await expect(store.save('t1', 'big.txt', Buffer.alloc(ATTACHMENT_LIMITS.fileBytes + 1, 97))).rejects.toMatchObject({ status: 413 });
  });

  it('cuts long text at the character limit', async () => {
    const { store } = await newStore();
    const att = await store.save('t1', 'long.txt', Buffer.from('a'.repeat(ATTACHMENT_LIMITS.chars + 50)));
    expect(att).toMatchObject({ truncated: true, chars: ATTACHMENT_LIMITS.chars });
    expect((await store.text('t1', att)).length).toBe(ATTACHMENT_LIMITS.chars);
  });

  it('stores files under fixed names whatever the upload is called', async () => {
    const { dir, store } = await newStore();
    const att = await store.save('t1', '../../.ssh/"id" ✨.txt', Buffer.from('secret-ish'));
    expect(att.name).toBe('"id" ✨.txt');
    expect((await readdir(join(dir, 't1', 'attachments', att.id))).sort()).toEqual(['extracted.txt', 'file.txt', 'meta.json']);
  });

  it('rejects unsafe thread and attachment ids', async () => {
    const { store } = await newStore();
    await expect(store.save('../x', 'a.txt', Buffer.from('a'))).rejects.toMatchObject({ status: 400 });
    expect(await store.get('t1', '../meta')).toBeUndefined();
  });

  it('sweeps old unreferenced uploads and keeps the rest', async () => {
    const { store } = await newStore();
    const kept = await store.save('t1', 'kept.txt', Buffer.from('a'));
    const old = await store.save('t1', 'old.txt', Buffer.from('b'));
    const fresh = await store.save('t1', 'fresh.txt', Buffer.from('c'));
    const later = Date.parse(fresh.createdAt) + 25 * 3600 * 1000;
    const removed = await store.sweep('t1', new Set([kept.id]), 24 * 3600 * 1000, later);
    expect(removed).toBe(2);
    expect(await store.get('t1', kept.id)).toBeDefined();
    expect(await store.get('t1', old.id)).toBeUndefined();
    expect(await store.sweep('t1', new Set(), 24 * 3600 * 1000)).toBe(0);
  });

  it('removes a whole thread folder', async () => {
    const { dir, store } = await newStore();
    await store.save('t1', 'a.txt', Buffer.from('a'));
    await store.removeThread('t1');
    await expect(stat(join(dir, 't1'))).rejects.toThrow();
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run test/server/attachments.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 5: Implement the store**

`src/server/attachments.ts`:
```ts
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
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run test/server/attachments.test.ts && npm run typecheck`
Expected: 10 tests PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add attachment store with text extraction"
```

---

### Task 2: Upload, serve and delete over HTTP; startup sweep

**Files:**
- Modify: `src/server/store.ts`, `src/server/router.ts`, `src/server/http.ts`, `src/server/cli.ts`
- Test: `test/server/http.test.ts`, `test/server/store.test.ts`

**Interfaces:**
- Consumes: `AttachmentStore`, `AttachmentError`, `ATTACHMENT_LIMITS` (Task 1).
- Produces:
  - `ThreadStore.delete(id: string): Promise<void>`
  - Router deps gain `attachments?: AttachmentStore` (defaults to `new AttachmentStore(paths.threads)`); `Router.attachments` readonly.
  - `Router.deleteThread(threadId): Promise<void>`; `Router.sweepAttachments(maxAgeMs?): Promise<number>`
  - HTTP: `POST /api/threads/:id/attachments` → `Attachment`; `GET /api/threads/:id/attachments/:aid` → image bytes; `DELETE /api/threads/:id` → 204.
  - `createConsensusServer` deps gain optional `attachments` (defaults to `router.attachments`).

- [ ] **Step 1: Write the failing tests**

Append to `test/server/store.test.ts` (inside the describe):
```ts
  it('deletes a thread file', async () => {
    const { store } = await newStore();
    const t = await store.create();
    await store.delete(t.id);
    expect(await store.get(t.id)).toBeUndefined();
    await expect(store.delete('../nope')).resolves.toBeUndefined();
  });
```

Append to `test/server/http.test.ts` (inside the describe):
```ts
  const upload = (threadId: string, name: string, body: Buffer, headers: Record<string, string> = { 'x-consensus-upload': '1' }) =>
    fetch(`${base}/api/threads/${threadId}/attachments`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent(name), ...headers },
      body,
    });

  it('uploads a file and serves images back', async () => {
    const thread = (await api('POST', '/api/threads', {})).body as Thread;
    const res = await upload(thread.id, 'shot.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(res.status).toBe(200);
    const att = await res.json();
    expect(att).toMatchObject({ name: 'shot.png', kind: 'image' });
    const img = await fetch(`${base}/api/threads/${thread.id}/attachments/${att.id}`);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(img.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await img.arrayBuffer())).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it('rejects uploads without the upload header', async () => {
    const thread = (await api('POST', '/api/threads', {})).body as Thread;
    expect((await upload(thread.id, 'a.txt', Buffer.from('a'), {})).status).toBe(415);
    expect((await upload(thread.id, 'a.txt', Buffer.from('a'), { 'x-consensus-upload': '0' })).status).toBe(415);
  });

  it('reports unsupported and empty files with their reason', async () => {
    const thread = (await api('POST', '/api/threads', {})).body as Thread;
    const bad = await upload(thread.id, 'run.exe', Buffer.from('x'));
    expect(bad.status).toBe(415);
    expect((await bad.json()).error).toContain("Consensus can't read .exe");
  });

  it('serves images only', async () => {
    const thread = (await api('POST', '/api/threads', {})).body as Thread;
    const att = await (await upload(thread.id, 'page.html', Buffer.from('<script>alert(1)</script>'))).json();
    expect((await fetch(`${base}/api/threads/${thread.id}/attachments/${att.id}`)).status).toBe(404);
  });

  it('deletes a thread with its files', async () => {
    const thread = (await api('POST', '/api/threads', {})).body as Thread;
    const att = await (await upload(thread.id, 'shot.png', Buffer.from([1, 2]))).json();
    expect((await api('DELETE', `/api/threads/${thread.id}`)).status).toBe(204);
    expect((await api('GET', `/api/threads/${thread.id}`)).status).toBe(404);
    expect((await fetch(`${base}/api/threads/${thread.id}/attachments/${att.id}`)).status).toBe(404);
    expect((await api('GET', '/api/threads')).body).toEqual([]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/server/http.test.ts test/server/store.test.ts`
Expected: FAIL (404s, `store.delete is not a function`).

- [ ] **Step 3: Add `ThreadStore.delete`**

In `src/server/store.ts`, add `rm` to the `node:fs/promises` import and this method after `save`:
```ts
  async delete(id: string): Promise<void> {
    if (!SAFE_ID.test(id)) return;
    await rm(this.file(id), { force: true });
  }
```

- [ ] **Step 4: Add deletion and sweeping to the router**

In `src/server/router.ts`:
- Add imports: `import { rm } from 'node:fs/promises';`, `import { join } from 'node:path';`, `import { AttachmentStore } from './attachments.js';`
- Add `attachments?: AttachmentStore;` to `Deps`.
- Replace the constructor and add fields:
```ts
  private deleted = new Set<string>();
  readonly attachments: AttachmentStore;

  constructor(private deps: Deps) {
    this.attachments = deps.attachments ?? new AttachmentStore(deps.paths.threads);
  }
```
- Add methods after `renameThread`:
```ts
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
```
- At the top of `commit`, add:
```ts
    if (this.deleted.has(thread.id)) return;
```
- In `getThread`, return `undefined` when `this.deleted.has(id)`.

- [ ] **Step 5: Add the HTTP routes**

In `src/server/http.ts`:
- Imports: `import { ATTACHMENT_LIMITS, AttachmentError, type AttachmentStore } from './attachments.js';`
- Add `attachments?: AttachmentStore;` to `Deps`; inside `createConsensusServer`, after destructuring: `const attachments = deps.attachments ?? router.attachments;`
- Add routes before the `GET /api/threads/:id/events` route:
```ts
    ['DELETE', re(`/api/threads/${ID}`), async (_q, res, [id]) => {
      await router.deleteThread(id);
      res.writeHead(204).end();
    }],
    ['POST', re(`/api/threads/${ID}/attachments`), async (req, res, [id]) => {
      if (!(await router.getThread(id))) throw new RouterError('not_found', 'That thread does not exist.');
      const name = decodeURIComponent(String(req.headers['x-filename'] ?? 'file'));
      json(res, 200, await attachments.save(id, name, await readRaw(req, ATTACHMENT_LIMITS.fileBytes)));
    }],
    ['GET', re(`/api/threads/${ID}/attachments/${ID}`), async (_q, res, [id, aid]) => {
      const att = await attachments.get(id, aid);
      // Only images come back; serving an attached HTML file would run it on this origin.
      if (!att || att.kind !== 'image') throw new RouterError('not_found', 'Not found.');
      const body = await readFile(attachments.filePath(id, att));
      res.writeHead(200, {
        'content-type': att.mime,
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, max-age=86400',
      }).end(body);
    }],
```
- In the error handler, before the `RouterError` branch:
```ts
      if (e instanceof AttachmentError) return json(res, e.status, { error: e.message });
```
- In `refuseForeign`, change the body check so uploads carrying the header pass:
```ts
  const isUpload = req.headers['x-consensus-upload'] === '1';
  if (hasBody && !isUpload && !String(req.headers['content-type'] ?? '').startsWith('application/json')) {
    return { status: 415, error: 'Send JSON.' };
  }
```
- Add after `readJson`:
```ts
async function readRaw(req: IncomingMessage, limit: number): Promise<Buffer> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new AttachmentError(413, `Files can be at most ${limit / 1024 / 1024}MB.`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
```

- [ ] **Step 6: Sweep on startup**

In `src/server/cli.ts`, after the router is created:
```ts
router.sweepAttachments().then(
  (n) => n > 0 && console.log(`Removed ${n} unsent attachment${n === 1 ? '' : 's'}.`),
  (e) => console.error('consensus: attachment cleanup failed', e),
);
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS (6 new).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: upload, serve and delete attachments; delete threads"
```

---

### Task 3: Router sends attachments, forwards and retries them

**Files:**
- Modify: `src/server/adapters/types.ts`, `src/server/router.ts`, `src/server/http.ts`
- Test: `test/server/router.test.ts`

**Interfaces:**
- Produces:
  - `type ImageInput = { id: string; name: string; mime: string; path: string; threadId: string }`; `SendRequest.images?: ImageInput[]`
  - `SendInput.attachmentIds?: string[]`
  - `attachmentBlock(att: Attachment, text: string): string`
  - `ForwardContext` gains `originalBlocks?: string[]` and `originalAttachments?: Attachment[]`
  - `composeOutgoing(text, quotes, ctx?, attachmentBlocks?: string[])`
  - HTTP `POST /api/threads/:id/messages` accepts `attachmentIds`.

- [ ] **Step 1: Add the adapter type**

In `src/server/adapters/types.ts`, before `SendRequest`:
```ts
export type ImageInput = { id: string; name: string; mime: string; path: string; threadId: string };
```
And in `SendRequest`, after `promptPath`:
```ts
  /** Images for this turn; text attachments are already inlined in message. */
  images?: ImageInput[];
```

- [ ] **Step 2: Write the failing tests**

Append to `test/server/router.test.ts`:
```ts
describe('Router attachments', () => {
  it('inlines document text before the message and passes images', async () => {
    const { t, a } = await threadWithTwo();
    const doc = await router.attachments.save(t.id, 'brief.md', Buffer.from('Audience: CFOs'));
    const img = await router.attachments.save(t.id, 'shot.png', Buffer.from([1, 2, 3]));
    await router.send(t.id, { to: a.id, text: 'Draft a headline', attachmentIds: [doc.id, img.id] });
    expect(claude.requests[0].message).toBe('<attachment name="brief.md">\nAudience: CFOs\n</attachment>\n\nDraft a headline');
    expect(claude.requests[0].images).toEqual([
      { id: img.id, name: 'shot.png', mime: 'image/png', path: router.attachments.filePath(t.id, img), threadId: t.id },
    ]);
    const sent = (await router.getThread(t.id))!.messages[0];
    expect(sent.kind === 'user' && sent.attachments?.map((x) => x.name)).toEqual(['brief.md', 'shot.png']);
  });

  it('notes when a document was cut', async () => {
    const { t, a } = await threadWithTwo();
    const doc = await router.attachments.save(t.id, 'long.txt', Buffer.from('a'.repeat(100_010)));
    await router.send(t.id, { to: a.id, text: 'Summarize', attachmentIds: [doc.id] });
    expect(claude.requests[0].message).toContain('\n[Truncated: only the first 100,000 characters are included.]\n</attachment>');
  });

  it('sends attachments with no text and refuses unknown or too many', async () => {
    const { t, a, b } = await threadWithTwo();
    const doc = await router.attachments.save(t.id, 'brief.md', Buffer.from('Brief'));
    await expect(router.send(t.id, { to: a.id, text: '', attachmentIds: [doc.id] })).resolves.toBeDefined();
    expect(claude.requests[0].message).toBe('<attachment name="brief.md">\nBrief\n</attachment>');
    await expect(router.send(t.id, { to: b.id, text: 'x', attachmentIds: ['missing'] })).rejects.toMatchObject({ code: 'invalid' });
    await expect(router.send(t.id, { to: b.id, text: 'x', attachmentIds: Array(11).fill(doc.id) })).rejects.toMatchObject({ code: 'invalid' });
  });

  it("forwards the original request's attachments, not later ones", async () => {
    const { t, a, b } = await threadWithTwo();
    const brief = await router.attachments.save(t.id, 'brief.md', Buffer.from('Audience: CFOs'));
    const logo = await router.attachments.save(t.id, 'logo.png', Buffer.from([1]));
    const s1 = await router.send(t.id, { to: a.id, text: 'Write a headline', attachmentIds: [brief.id, logo.id] });
    claude.last().push({ type: 'done', text: 'Kitchens that run themselves' });
    claude.last().end();
    await s1.done;
    await router.send(t.id, { to: b.id, text: 'Critique', quotes: [{ messageId: s1.replyMessageId, text: 'Kitchens that run themselves' }] });
    expect(codex.requests[0].message).toBe(
      'Original request:\n<request>\nWrite a headline\n</request>\n\n' +
        '<attachment name="brief.md">\nAudience: CFOs\n</attachment>\n\n' +
        'Feedback from another reviewer:\n<quoted>\nKitchens that run themselves\n</quoted>\n\n' +
        'Critique',
    );
    expect(codex.requests[0].images?.map((i) => i.id)).toEqual([logo.id]);
  });

  it('resends attachments on retry from a fresh router', async () => {
    const { t, a } = await threadWithTwo();
    const doc = await router.attachments.save(t.id, 'brief.md', Buffer.from('Brief'));
    const s1 = await router.send(t.id, { to: a.id, text: 'Go', attachmentIds: [doc.id] });
    claude.last().push({ type: 'error', error: { code: 'unknown', message: 'x' } });
    claude.last().end();
    await s1.done;
    const fresh = new Router({ store, hub, paths: (router as any).deps.paths, adapters: { claude: claude.adapter, codex: codex.adapter, gemini: controllable('gemini').adapter } });
    await fresh.retry(t.id, s1.replyMessageId);
    expect(claude.requests.at(-1)!.message).toBe(claude.requests[0].message);
  });

  it('deletes a thread mid-reply without it coming back', async () => {
    const { t, a } = await threadWithTwo();
    await router.attachments.save(t.id, 'brief.md', Buffer.from('Brief'));
    const s1 = await router.send(t.id, { to: a.id, text: 'Long one' });
    claude.last().push({ type: 'delta', text: 'Partial' });
    await flush();
    await router.deleteThread(t.id);
    await s1.done;
    expect(await store.get(t.id)).toBeUndefined();
    expect(await router.getThread(t.id)).toBeUndefined();
    expect((await store.list()).map((s) => s.id)).not.toContain(t.id);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/server/router.test.ts`
Expected: the 6 new tests FAIL.

- [ ] **Step 4: Implement attachments in the router**

In `src/server/router.ts`:
- Imports: add `Attachment` to the shared types import; `import type { ImageInput, ProviderAdapter } from './adapters/types.js';`; `import { ATTACHMENT_LIMITS, truncationNote, type AttachmentStore } from './attachments.js';` (keep the value import of `AttachmentStore` from Task 2).
- `SendInput` becomes:
```ts
export type SendInput = { to: string; text: string; quotes?: Quote[]; attachmentIds?: string[]; origin?: Origin };
```
- Replace `ForwardContext` and `composeOutgoing`:
```ts
/** Task plus current state for forwarded quotes; contexts line up with quotes by index. */
export type ForwardContext = {
  originalRequest?: string;
  originalAttachments?: Attachment[];
  /** Rendered text blocks for originalAttachments. */
  originalBlocks?: string[];
  contexts: (string | undefined)[];
};

export function attachmentBlock(att: Attachment, text: string): string {
  const note = att.truncated ? `\n${truncationNote()}` : '';
  return `<attachment name="${att.name.replace(/"/g, "'")}">\n${text}${note}\n</attachment>`;
}

export function composeOutgoing(text: string, quotes: Quote[], ctx: ForwardContext = { contexts: [] }, attachmentBlocks: string[] = []): string {
  const blocks: string[] = [];
  if (quotes.length) {
    if (ctx.originalRequest) blocks.push(`Original request:\n<request>\n${ctx.originalRequest}\n</request>`);
    blocks.push(...(ctx.originalBlocks ?? []));
    quotes.forEach((q, i) => {
      const context = ctx.contexts[i];
      if (context) blocks.push(`Text another reviewer was responding to:\n<context>\n${context}\n</context>`);
      blocks.push(`Feedback from another reviewer:\n<quoted>\n${q.text}\n</quoted>`);
    });
  }
  blocks.push(...attachmentBlocks);
  if (!blocks.length) return text;
  return [...blocks, text].filter(Boolean).join('\n\n');
}
```
- Replace `forwardContext` and `rootRequest`:
```ts
export function forwardContext(thread: Thread, quotes: Quote[]): ForwardContext {
  let root: UserMessage | undefined;
  const contexts = quotes.map((q) => {
    const prompt = promptOf(thread, q.messageId);
    if (!prompt) return undefined;
    root ??= rootPrompt(thread, prompt);
    const context = prompt.quotes.map((x) => x.text).join('\n\n');
    return context || undefined;
  });
  return { originalRequest: root?.text.trim() || undefined, originalAttachments: root?.attachments ?? [], contexts };
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
```
- In `send`, replace the validation line and the message construction so attachments resolve first:
```ts
    const attachments = await this.resolveAttachments(thread.id, input.attachmentIds ?? []);
    if (!input.text.trim() && !quotes.length && !attachments.length) {
      throw new RouterError('invalid', 'Write a message, forward a quote or attach a file.');
    }
    if (this.busy.has(p.id)) throw new RouterError('busy', 'That participant is still replying.');
    const { message: outgoing, images } = await this.buildOutgoing(thread, input.text, quotes, attachments);
```
  Set `attachments: attachments.length ? attachments : undefined` on the `UserMessage` literal, delete the old `const outgoing = composeOutgoing(...)` line, and change the `run` call to `this.run(thread, p, reply, outgoing, images, controller)`.
- `run` gains an `images: ImageInput[]` parameter after `message` and passes `images: images.length ? images : undefined` in the adapter request.
- `retry` passes `attachmentIds: user.attachments?.map((x) => x.id)`.
- Add helpers:
```ts
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
```

- [ ] **Step 5: Accept `attachmentIds` over HTTP**

In the `POST /api/threads/:id/messages` handler in `src/server/http.ts`:
```ts
      const attachmentIds = Array.isArray(body.attachmentIds) ? body.attachmentIds.filter((x: unknown) => typeof x === 'string') : [];
      const { userMessageId, replyMessageId, done } = await router.send(id, { to: body.to, text: body.text, quotes, attachmentIds });
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS (6 new).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: send, forward and retry attachments"
```

---

### Task 4: Images in each adapter

**Files:**
- Modify: `src/server/adapters/claude.ts`, `src/server/adapters/codex.ts`, `src/server/adapters/gemini.ts`
- Test: `test/server/adapters/claude.test.ts`, `test/server/adapters/codex.test.ts`, `test/server/adapters/gemini.test.ts`

**Interfaces:**
- Consumes: `ImageInput`, `SendRequest.images` (Task 3).
- Produces: `agentName(hash)` unchanged; Gemini viewer agent `${agentName(hash)}-viewer`.

- [ ] **Step 1: Write the failing tests**

Append to `test/server/adapters/claude.test.ts` (inside the describe):
```ts
  it('sends images as stream-json content blocks', async () => {
    const { fake, adapter, req } = setup(OK_RUN);
    const path = join(mkdtempSync(join(tmpdir(), 'img-')), 'file.png');
    writeFileSync(path, Buffer.from([1, 2, 3]));
    await collect(adapter.send(req({ message: 'What is this?', images: [{ id: 'i1', name: 'a.png', mime: 'image/png', path, threadId: 't' }] })));
    const { argv, stdin } = await fake.record();
    expect(argv[argv.indexOf('--input-format') + 1]).toBe('stream-json');
    expect(JSON.parse(stdin)).toEqual({
      type: 'user',
      message: { role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AQID' } },
        { type: 'text', text: 'What is this?' },
      ] },
    });
  });

  it('keeps plain stdin for messages without images', async () => {
    const { fake, adapter, req } = setup(OK_RUN);
    await collect(adapter.send(req()));
    expect((await fake.record()).argv).not.toContain('--input-format');
  });
```
Add `writeFileSync` to that file's `node:fs` import.

Append to `test/server/adapters/codex.test.ts` (inside the describe):
```ts
  it('passes each image with -i before the stdin marker', async () => {
    const { fake, adapter, req } = setup(OK_RUN);
    const images = [
      { id: 'i1', name: 'a.png', mime: 'image/png', path: '/tmp/x/a.png', threadId: 't' },
      { id: 'i2', name: 'b.jpg', mime: 'image/jpeg', path: '/tmp/x/b.jpg', threadId: 't' },
    ];
    await collect(adapter.send(req({ sessionId: 'th-old', images })));
    const args = (await fake.record()).argv;
    expect(args.slice(-5)).toEqual(['-i', '/tmp/x/a.png', '-i', '/tmp/x/b.jpg', '-']);
  });
```

Append to `test/server/adapters/gemini.test.ts` (inside the describe):
```ts
  it('copies images into its folder and uses the view_file agent for that turn', async () => {
    const { fake, adapter, req, workdir } = setup(OK_RUN);
    const src = join(workdir, 'upload.png');
    writeFileSync(src, Buffer.from([9, 9]));
    await collect(adapter.send(req({ message: 'Thoughts?', images: [{ id: 'i1', name: 'hero.png', mime: 'image/png', path: src, threadId: 't9' }] })));
    const args = (await fake.record()).argv;
    expect(args[args.indexOf('--agent') + 1]).toBe('consensus-abc123-viewer');
    expect(args.at(-1)).toBe('-p=Attached images. Use view_file to look at each one before replying:\n- attachments/t9/i1.png (hero.png)\n\nThoughts?');
    expect(await readFile(join(workdir, 'attachments', 't9', 'i1.png'))).toEqual(Buffer.from([9, 9]));
    const agent = await readFile(join(workdir, '.agents', 'agents', 'consensus-abc123-viewer.md'), 'utf8');
    expect(agent).toBe('---\nname: consensus-abc123-viewer\ndescription: Consensus prose participant.\ntools:\n  - view_file\n---\nYou are an experienced editor.\n');
  });

  it('keeps the tool-less agent when there are no images', async () => {
    const { fake, adapter, req } = setup(OK_RUN);
    await collect(adapter.send(req()));
    const args = (await fake.record()).argv;
    expect(args[args.indexOf('--agent') + 1]).toBe('consensus-abc123');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/server/adapters`
Expected: the 5 new tests FAIL.

- [ ] **Step 3: Claude: stream-json input for image turns**

In `src/server/adapters/claude.ts`:
- Import `readFile` from `node:fs/promises` and `type ImageInput` from `./types.js`.
- After the `--fork-session` line:
```ts
  const images = req.images ?? [];
  if (images.length) args.push('--input-format', 'stream-json');
```
- Pass `stdin: images.length ? await imageMessage(req.message, images) : req.message,` to `runJsonl`.
- Add at the bottom:
```ts
/** One stream-json user message: image blocks first, then the text. */
async function imageMessage(text: string, images: ImageInput[]): Promise<string> {
  const content: object[] = [];
  for (const img of images) {
    content.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: (await readFile(img.path)).toString('base64') } });
  }
  content.push({ type: 'text', text });
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`;
}
```

- [ ] **Step 4: Codex: `-i` flags**

In `src/server/adapters/codex.ts`, change the args line to:
```ts
  const imageArgs = (req.images ?? []).flatMap((img) => ['-i', img.path]);
  const args = [...(opts.binArgs ?? []), ...head, ...common, ...imageArgs, '-'];
```

- [ ] **Step 5: Gemini: copies and the viewer agent**

In `src/server/adapters/gemini.ts`:
- Add `copyFile` to the `node:fs/promises` import, `extname` to the `node:path` import, and `type ImageInput` to the types import.
- Replace `ensureAgent`:
```ts
/** Antigravity has no system-prompt flag; a custom agent's body becomes its system prompt. */
async function ensureAgent(workdir: string, req: SendRequest, viewer: boolean): Promise<string> {
  const name = viewer ? `${agentName(req.promptHash)}-viewer` : agentName(req.promptHash);
  const dir = join(workdir, '.agents', 'agents');
  const file = join(dir, `${name}.md`);
  try {
    await access(file);
  } catch {
    await mkdir(dir, { recursive: true });
    const body = await readFile(req.promptPath, 'utf8');
    // The viewer variant exists only for image turns: Antigravity's input accepts text alone.
    const tools = viewer ? 'tools:\n  - view_file' : 'tools: []';
    await writeFile(file, `---\nname: ${name}\ndescription: Consensus prose participant.\n${tools}\n---\n${body}`);
  }
  return name;
}

async function copyImages(workdir: string, images: ImageInput[]): Promise<string[]> {
  const rels: string[] = [];
  for (const img of images) {
    const rel = `attachments/${img.threadId}/${img.id}${extname(img.path).toLowerCase()}`;
    await mkdir(join(workdir, 'attachments', img.threadId), { recursive: true });
    await copyFile(img.path, join(workdir, rel));
    rels.push(rel);
  }
  return rels;
}
```
- In `send`, replace `const name = await ensureAgent(opts.workdir, req);` with:
```ts
  const images = req.images ?? [];
  const name = await ensureAgent(opts.workdir, req, images.length > 0);
  let message = req.message;
  if (images.length) {
    const rels = await copyImages(opts.workdir, images);
    const list = rels.map((rel, i) => `- ${rel} (${images[i].name})`).join('\n');
    message = `Attached images. Use view_file to look at each one before replying:\n${list}\n\n${req.message}`;
  }
```
  and change `args.push(`-p=${req.message}`);` to `args.push(`-p=${message}`);`.

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: pass images to Claude, Codex and Gemini"
```

---

### Task 5: Attachments in the interface; delete thread

**Files:**
- Create: `src/web/format.ts`, `src/web/useAttachments.ts`, `src/web/components/AttachmentChip.tsx`
- Modify: `src/web/api.ts`, `src/web/components/Composer.tsx`, `src/web/components/MessageView.tsx`, `src/web/components/ThreadView.tsx`, `src/web/App.tsx`, `src/web/styles.css`
- Test: `test/web/format.test.ts`

**Interfaces:**
- Consumes: HTTP routes (Tasks 2–3).
- Produces: `formatSize(bytes): string`; `useAttachments(threadId)` → `{ files: PendingFile[], add(files: File[]), remove(key), clear() }`; `<AttachmentChip />`; `Composer` accepts `children` and renders them inside its drop area; `ThreadView` prop `onDeleted: () => void`.

- [ ] **Step 1: Write the failing test**

`test/web/format.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { formatSize } from '../../src/web/format.js';

describe('formatSize', () => {
  it('formats bytes, kilobytes and megabytes', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
```

Run: `npx vitest run test/web/format.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 2: Implement `formatSize`**

`src/web/format.ts`:
```ts
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
```

Run: `npx vitest run test/web/format.test.ts`
Expected: PASS.

- [ ] **Step 3: Extend the API client**

In `src/web/api.ts`, add `Attachment` to the type import and these members:
```ts
  uploadAttachment: async (threadId: string, file: File): Promise<Attachment> => {
    const res = await fetch(`/api/threads/${threadId}/attachments`, {
      method: 'POST',
      headers: {
        'x-consensus-upload': '1',
        'x-filename': encodeURIComponent(file.name),
        'content-type': file.type || 'application/octet-stream',
      },
      body: file,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? res.statusText);
    }
    return res.json();
  },
  deleteThread: (threadId: string) => call<void>('DELETE', `/api/threads/${threadId}`),
  attachmentUrl: (threadId: string, attachmentId: string) => `/api/threads/${threadId}/attachments/${attachmentId}`,
```
and change `send`'s body type to `{ to: string; text: string; quotes: Quote[]; attachmentIds: string[] }`.

- [ ] **Step 4: Pending uploads hook**

`src/web/useAttachments.ts`:
```ts
import { useCallback, useState } from 'react';
import type { Attachment } from '../shared/types.js';
import { api } from './api.js';

export type PendingFile = {
  key: string;
  name: string;
  size: number;
  status: 'uploading' | 'ready' | 'error';
  attachment?: Attachment;
  error?: string;
};

/** Uploads files as soon as they are added; the composer sends the ready ones. */
export function useAttachments(threadId: string) {
  const [files, setFiles] = useState<PendingFile[]>([]);
  const update = (key: string, patch: Partial<PendingFile>) =>
    setFiles((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)));

  const add = useCallback((list: File[]) => {
    for (const file of list) {
      const key = crypto.randomUUID();
      setFiles((fs) => [...fs, { key, name: file.name, size: file.size, status: 'uploading' }]);
      api.uploadAttachment(threadId, file).then(
        (attachment) => update(key, { status: 'ready', attachment }),
        (e: Error) => update(key, { status: 'error', error: e.message }),
      );
    }
  }, [threadId]);

  const remove = (key: string) => setFiles((fs) => fs.filter((f) => f.key !== key));
  const clear = () => setFiles([]);
  return { files, add, remove, clear };
}
```

- [ ] **Step 5: Attachment chip**

`src/web/components/AttachmentChip.tsx`:
```tsx
import type { Attachment } from '../../shared/types.js';
import { api } from '../api.js';
import { formatSize } from '../format.js';

type Props = {
  threadId: string;
  name: string;
  size: number;
  attachment?: Attachment;
  status?: 'uploading' | 'ready' | 'error';
  error?: string;
  onRemove?: () => void;
};

export function AttachmentChip({ threadId, name, size, attachment, status = 'ready', error, onRemove }: Props) {
  const image = attachment?.kind === 'image';
  const meta =
    status === 'uploading' ? 'Uploading…' : status === 'error' ? error : `${formatSize(size)}${attachment?.truncated ? ' · cut to 100,000 characters' : ''}`;
  return (
    <div className={`att-chip ${status}`}>
      {image && attachment ? (
        <a href={api.attachmentUrl(threadId, attachment.id)} target="_blank" rel="noreferrer" title="Open full size">
          <img src={api.attachmentUrl(threadId, attachment.id)} alt={name} />
        </a>
      ) : (
        <span className="att-icon">📄</span>
      )}
      <span className="att-text">
        <span className="att-name">{name}</span>
        <span className="att-meta">{meta}</span>
      </span>
      {onRemove && <button className="ghost" onClick={onRemove} title="Remove">×</button>}
    </div>
  );
}
```

- [ ] **Step 6: Composer: drop area, paperclip, paste, chips**

In `src/web/components/Composer.tsx`:
- Imports: `useRef`, `useState` already present; add `type ReactNode` from react; `import { useAttachments } from '../useAttachments.js';`; `import { AttachmentChip } from './AttachmentChip.js';`
- Add `children?: ReactNode;` to `Props` and destructure it.
- Add near the top of the component:
```ts
  const { files, add, remove, clear } = useAttachments(thread.id);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const uploading = files.some((f) => f.status === 'uploading');
  const ready = files.filter((f) => f.status === 'ready' && f.attachment).map((f) => f.attachment!);
```
- `canSend` becomes:
```ts
  const canSend = !!target && !running && !sending && !uploading && (text.trim().length > 0 || outgoing.length > 0 || ready.length > 0);
```
- In `send`, pass `attachmentIds: ready.map((a) => a.id)` to `api.send` and call `clear()` after a successful send.
- Wrap the returned JSX:
```tsx
  return (
    <div
      className={dragging ? 'drop-area dragging' : 'drop-area'}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        add(Array.from(e.dataTransfer.files));
      }}
    >
      {children}
      <div className="composer">
        {/* existing quote tray stays here */}
        {files.length > 0 && (
          <div className="att-row">
            {files.map((f) => (
              <AttachmentChip key={f.key} threadId={thread.id} name={f.name} size={f.size} attachment={f.attachment}
                status={f.status} error={f.error} onRemove={() => remove(f.key)} />
            ))}
          </div>
        )}
        {/* existing "To:" row stays here */}
        <div className="composer-row">
          <button className="ghost attach" onClick={() => picker.current?.click()} title="Attach files">📎</button>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            accept=".txt,.md,.csv,.json,.html,.htm,.docx,.pdf,.png,.jpg,.jpeg,.gif,.webp"
            onChange={(e) => {
              add(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          {/* existing textarea, with this prop added: */}
          {/* onPaste={(e) => { const pasted = Array.from(e.clipboardData.files); if (pasted.length) { e.preventDefault(); add(pasted); } }} */}
          {/* existing Stop / Send button */}
        </div>
        {error && <p className="error-inline">{error}</p>}
      </div>
    </div>
  );
```
  Keep every existing element in place; the comments above mark where they sit. The `onPaste` handler goes on the existing `<textarea>`.

- [ ] **Step 7: MessageView: chips on sent messages**

In `src/web/components/MessageView.tsx`, import `AttachmentChip`, and in the user-message branch, after the quotes:
```tsx
        {message.attachments?.length ? (
          <div className="att-row">
            {message.attachments.map((a) => (
              <AttachmentChip key={a.id} threadId={thread.id} name={a.name} size={a.size} attachment={a} />
            ))}
          </div>
        ) : null}
```

- [ ] **Step 8: ThreadView: Composer wraps the list; delete thread**

In `src/web/components/ThreadView.tsx`:
- Add `onDeleted: () => void;` to `Props` and destructure it.
- Change the `composer` helper to take the list as children:
```tsx
  const composer = (target: string | undefined, lock: boolean, list: ReactNode) => (
    <Composer
      thread={thread} models={models} defaults={defaults}
      target={target} lockTarget={lock} onTargetChange={setActive}
      quotes={quotes} setQuotes={setQuotes}
    >
      {list}
    </Composer>
  );
```
  (import `type ReactNode` from react). Timeline: `composer(active, false, <MessageList thread={thread} messages={thread.messages} onForward={forward} />)`. Panes: inside each `.pane`, after the `<h2>`, `composer(p.id, true, <MessageList thread={thread} messages={paneMessages(thread, p.id)} onForward={forward} />)`.
- Add a delete control in the header, after the view toggle:
```tsx
        <DeleteThread threadId={thread.id} onDeleted={onDeleted} />
```
  and the component at the bottom:
```tsx
function DeleteThread({ threadId, onDeleted }: { threadId: string; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  if (!confirming) return <button className="ghost" onClick={() => setConfirming(true)}>Delete</button>;
  return (
    <span className="confirm">
      Delete this thread and its files?
      <button className="danger" onClick={() => api.deleteThread(threadId).then(onDeleted, (e: Error) => setError(e.message))}>Delete</button>
      <button onClick={() => setConfirming(false)}>Cancel</button>
      {error && <span className="error-inline">{error}</span>}
    </span>
  );
}
```
- In `src/web/App.tsx`, pass `onDeleted={() => { setActiveId(undefined); refresh(); }}` to `ThreadView`.

- [ ] **Step 9: Styles**

Append to `src/web/styles.css`:
```css
.drop-area { flex: 1; display: flex; flex-direction: column; min-height: 0; position: relative; }
.drop-area.dragging::after { content: 'Drop files to attach'; position: absolute; inset: 8px; border: 2px dashed var(--accent); border-radius: 12px; display: flex; align-items: center; justify-content: center; background: rgb(47 91 211 / 0.08); color: var(--accent); font-weight: 600; pointer-events: none; }
.att-row { display: flex; flex-wrap: wrap; gap: 6px; max-width: 820px; width: 100%; margin: 0 auto 6px; }
.att-chip { display: flex; align-items: center; gap: 8px; border: 1px solid var(--line); border-radius: 8px; padding: 4px 6px; background: var(--panel); max-width: 260px; }
.att-chip img { width: 36px; height: 36px; object-fit: cover; border-radius: 4px; display: block; }
.att-chip.error { border-color: var(--error); }
.att-chip.error .att-meta { color: var(--error); }
.att-icon { font-size: 20px; }
.att-text { display: flex; flex-direction: column; min-width: 0; }
.att-name { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.att-meta { font-size: 11px; color: var(--muted); }
button.attach { padding: 6px 8px; }
button.danger { background: var(--error); border-color: var(--error); color: white; }
.confirm { display: flex; align-items: center; gap: 6px; font-size: 13px; }
```

- [ ] **Step 10: Build and check in the browser**

Run: `npm test && npm run typecheck && npm run build`
Then start a scratch server (`CONSENSUS_HOME=<scratch> node dist/server/cli.js --port 4792 --no-open`) and, with the `claude-in-chrome` tools:
1. Create a thread, add a Claude participant. Drop or pick `test/fixtures/sample.docx` and a PNG; confirm chips show name and size, the PNG shows a thumbnail, and Send waits while uploading.
2. Send "What do the attachments say and show?" and confirm the sent message shows both chips and the reply mentions "Hello from Word" and the image.
3. Upload `test/fixtures/blank.pdf`; confirm the chip shows the "No text found" reason.
4. Delete the thread, confirm, and check it disappears from the sidebar and `threads/<id>/` is gone from the scratch folder.
Expected: all as described; no console errors.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: attach files by drag and drop, paperclip or paste; delete threads"
```

---

### Task 6: Live check with images

**Files:**
- Modify: `scripts/smoke.ts`

- [ ] **Step 1: Add an image check per provider**

In `scripts/smoke.ts`:
- Add imports: `import { writeFile } from 'node:fs/promises';`, `import { crc32, deflateSync } from 'node:zlib';`, and `type ImageInput` from the adapter types.
- Extend the `run` options type with `images?: ImageInput[]`.
- After `paths` is created, write a solid blue PNG under a neutral name:
```ts
function bluePng(): Buffer {
  const size = 64;
  const raw = Buffer.concat(Array.from({ length: size }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, Buffer.from([0x10, 0x30, 0xd0]))])));
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const imagePath = join(paths.home, 'a7.png');
await writeFile(imagePath, bluePng());
const image: ImageInput = { id: 'a7', name: 'a7.png', mime: 'image/png', path: imagePath, threadId: 'smoke' };
```
- At the end of each provider's checks:
```ts
  const seen = await run(a, base, { message: 'What single color fills the attached image? One word.', model: c.model, effort: c.effort, images: [image] });
  check(`${id} image`, seen.done && /blue/i.test(seen.text), seen.error ?? seen.text);
```

- [ ] **Step 2: Run the smoke test**

Run: `npm run smoke`
Expected: 15 PASS lines and "All checks passed".

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test: live image check for each provider"
```
