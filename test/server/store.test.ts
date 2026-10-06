import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ThreadStore } from '../../src/server/store.js';

const newStore = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'consensus-threads-'));
  return { dir, store: new ThreadStore(dir) };
};

describe('ThreadStore', () => {
  it('creates and reloads a thread exactly', async () => {
    const { store } = await newStore();
    const t = await store.create();
    t.participants.push({ id: 'p1', provider: 'claude', model: 'opus', effort: 'high', promptHash: 'h', createdAt: t.createdAt });
    t.messages.push({ id: 'm1', kind: 'user', to: 'p1', text: 'Hi', quotes: [], sentAt: t.createdAt });
    await store.save(t);
    expect(await store.get(t.id)).toEqual(t);
    expect(t.title).toBe('Untitled thread');
  });

  it('lists threads newest first', async () => {
    const { store } = await newStore();
    const a = await store.create('A');
    const b = await store.create('B');
    a.title = 'A2';
    await new Promise((r) => setTimeout(r, 5));
    await store.save(a);
    const list = await store.list();
    expect(list.map((s) => s.title)).toEqual(['A2', 'B']);
    expect(list[0].id).toBe(a.id);
    expect(b.id).not.toBe(a.id);
  });

  it('skips unreadable thread files when listing', async () => {
    const { dir, store } = await newStore();
    await store.create('Good');
    await writeFile(join(dir, 'broken.json'), '{"id": "broken", "title": ');
    const list = await store.list();
    expect(list.map((s) => s.title)).toEqual(['Good']);
  });

  it('marks streaming replies as interrupted on load', async () => {
    const { store } = await newStore();
    const t = await store.create();
    t.messages.push({ id: 'r1', kind: 'reply', from: 'p1', text: 'Half a sen', model: 'opus', status: 'streaming', sentAt: t.createdAt });
    await store.save(t);
    const loaded = await store.get(t.id);
    const reply = loaded!.messages[0];
    expect(reply.kind === 'reply' && reply.status).toBe('error');
    expect(reply.kind === 'reply' && reply.error?.code).toBe('interrupted');
    expect(reply.kind === 'reply' && reply.text).toBe('Half a sen');
  });

  it('leaves no temp files after saving', async () => {
    const { dir, store } = await newStore();
    const t = await store.create();
    await store.save(t);
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('returns undefined for unknown or unsafe ids', async () => {
    const { store } = await newStore();
    expect(await store.get('nope')).toBeUndefined();
    expect(await store.get('../etc/passwd')).toBeUndefined();
  });
  it('deletes a thread file', async () => {
    const { store } = await newStore();
    const t = await store.create();
    await store.delete(t.id);
    expect(await store.get(t.id)).toBeUndefined();
    await expect(store.delete('../nope')).resolves.toBeUndefined();
  });
});

