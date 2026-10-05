import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { forceKillAllChildren, killAllChildren, runJsonl, type ProcItem } from '../../../src/server/adapters/process.js';
import { collect, fakeCli } from '../../helpers/fake.js';

const run = (fake: ReturnType<typeof fakeCli>, extra: { stdin?: string; signal?: AbortSignal; timeoutMs?: number; killGraceMs?: number; exitGraceMs?: number } = {}) =>
  runJsonl({
    bin: fake.options.bin,
    args: fake.options.binArgs,
    cwd: fake.dir,
    env: fake.options.env,
    signal: extra.signal ?? new AbortController().signal,
    timeoutMs: extra.timeoutMs ?? 10_000,
    stdin: extra.stdin,
    killGraceMs: extra.killGraceMs,
    exitGraceMs: extra.exitGraceMs,
  });

const exitOf = (items: ProcItem[]) => items.find((i) => i.type === 'exit')!;

describe('runJsonl', () => {
  it('parses JSON lines and passes other lines through', async () => {
    const fake = fakeCli({ lines: [{ a: 1 }, 'not json', { b: 2 }] });
    const items = await collect(run(fake));
    expect(items.slice(0, 3)).toEqual([
      { type: 'json', value: { a: 1 } },
      { type: 'line', text: 'not json' },
      { type: 'json', value: { b: 2 } },
    ]);
    expect(exitOf(items)).toMatchObject({ type: 'exit', info: { code: 0, aborted: false, timedOut: false } });
  });

  it('writes stdin to the process', async () => {
    const fake = fakeCli({ lines: [] });
    await collect(run(fake, { stdin: '--leading dashes\nsecond line' }));
    expect((await fake.record()).stdin).toBe('--leading dashes\nsecond line');
  });

  it('captures exit code and stderr', async () => {
    const fake = fakeCli({ stderr: 'boom', exitCode: 3 });
    const items = await collect(run(fake));
    expect(exitOf(items)).toMatchObject({ info: { code: 3, stderr: 'boom' } });
  });

  it('kills the process on abort', async () => {
    const fake = fakeCli({ lines: [{ x: 1 }], hang: true });
    const ac = new AbortController();
    const items: ProcItem[] = [];
    for await (const item of run(fake, { signal: ac.signal })) {
      items.push(item);
      if (item.type === 'json') ac.abort();
    }
    expect(exitOf(items)).toMatchObject({ info: { aborted: true } });
  });

  it('kills the process on timeout', async () => {
    const fake = fakeCli({ hang: true });
    const items = await collect(run(fake, { timeoutMs: 300 }));
    expect(exitOf(items)).toMatchObject({ info: { timedOut: true } });
  });

  it('reports a missing binary as a spawn error', async () => {
    const items = await collect(
      runJsonl({ bin: '/nonexistent/relay-cli', args: [], cwd: '/', signal: new AbortController().signal, timeoutMs: 1000 }),
    );
    expect(exitOf(items)).toMatchObject({ info: { spawnError: 'ENOENT' } });
  });
});

describe('runJsonl process control', () => {
  it('force-kills a CLI that ignores SIGTERM on abort', async () => {
    const fake = fakeCli({ lines: [{ x: 1 }], hang: true, ignoreTerm: true });
    const ac = new AbortController();
    const started = Date.now();
    const items: ProcItem[] = [];
    for await (const item of run(fake, { signal: ac.signal, killGraceMs: 300 })) {
      items.push(item);
      if (item.type === 'json') ac.abort();
    }
    expect(Date.now() - started).toBeLessThan(5000);
    expect(exitOf(items)).toMatchObject({ info: { aborted: true } });
  });

  it('kills a helper process that holds stdout open', async () => {
    const fake = fakeCli({ lines: [{ x: 1 }], hang: true, grandchild: true });
    const ac = new AbortController();
    const started = Date.now();
    for await (const item of run(fake, { signal: ac.signal, killGraceMs: 300 })) {
      if (item.type === 'json') ac.abort();
    }
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('lets a CLI finish exiting after the reader stops early', async () => {
    const marker = join(fakeCli({}).dir, 'marker');
    const fake = fakeCli({ lines: [{ result: 1 }], exitDelayMs: 300, markerFile: marker });
    for await (const item of run(fake)) {
      if (item.type === 'json') break;
    }
    expect(existsSync(marker)).toBe(true);
  });

  it('stops every running CLI on shutdown', async () => {
    const fake = fakeCli({ lines: [{ x: 1 }], hang: true });
    const consumed = (async () => {
      for await (const item of run(fake, { killGraceMs: 300 })) {
        if (item.type === 'json') killAllChildren();
      }
    })();
    await expect(Promise.race([consumed.then(() => 'ended'), new Promise((r) => setTimeout(() => r('hung'), 5000))])).resolves.toBe('ended');
  });
  it('force-kills every running CLI at once, even one ignoring SIGTERM', async () => {
    const fake = fakeCli({ lines: [{ x: 1 }], hang: true, ignoreTerm: true });
    const consumed = (async () => {
      for await (const item of run(fake, { killGraceMs: 60_000 })) {
        if (item.type === 'json') forceKillAllChildren();
      }
    })();
    await expect(Promise.race([consumed.then(() => 'ended'), new Promise((r) => setTimeout(() => r('hung'), 5000))])).resolves.toBe('ended');
  });
});

