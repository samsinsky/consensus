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
