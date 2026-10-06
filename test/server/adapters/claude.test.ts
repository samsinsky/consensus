import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createClaudeAdapter } from '../../../src/server/adapters/claude.js';
import type { AdapterEvent, SendRequest } from '../../../src/server/adapters/types.js';
import { collect, fakeCli, type FakeScript } from '../../helpers/fake.js';

const OK_RUN: FakeScript = {
  lines: [
    { type: 'system', subtype: 'init', session_id: 'sess-new' },
    { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '' } }, session_id: 'sess-new' },
    { type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hello, ' } }, session_id: 'sess-new' },
    { type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'world.' } }, session_id: 'sess-new' },
    { type: 'result', subtype: 'success', is_error: false, result: 'Hello, world.', session_id: 'sess-new' },
  ],
};

function setup(script: FakeScript) {
  const fake = fakeCli(script);
  const adapter = createClaudeAdapter({ workdir: mkdtempSync(join(tmpdir(), 'consensus-wd-')), ...fake.options });
  const req = (over: Partial<SendRequest> = {}): SendRequest => ({
    message: 'Write a headline', model: 'opus', promptHash: 'abc', promptPath: '/tmp/prompt.md',
    signal: new AbortController().signal, ...over,
  });
  return { fake, adapter, req };
}

describe('claude adapter', () => {
  it('streams session, deltas and done', async () => {
    const { adapter, req } = setup(OK_RUN);
    const events = await collect(adapter.send(req()));
    expect(events).toEqual<AdapterEvent[]>([
      { type: 'session', sessionId: 'sess-new' },
      { type: 'delta', text: 'Hello, ' },
      { type: 'delta', text: 'world.' },
      { type: 'done', text: 'Hello, world.' },
    ]);
  });

  it('replaces the system prompt and isolates settings on a first message', async () => {
    const { fake, adapter, req } = setup(OK_RUN);
    await collect(adapter.send(req()));
    const { argv } = await fake.record();
    const args = argv;
    expect(args).toEqual(expect.arrayContaining(['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--strict-mcp-config', '--no-chrome']));
    expect(args[args.indexOf('--system-prompt-file') + 1]).toBe('/tmp/prompt.md');
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('');
    expect(args[args.indexOf('--model') + 1]).toBe('opus');
    expect(args).not.toContain('--resume');
    expect(args).not.toContain('--effort');
  });

  it('forks from the last session and sets effort when resuming', async () => {
    const { fake, adapter, req } = setup(OK_RUN);
    await collect(adapter.send(req({ sessionId: 'sess-old', effort: 'high' })));
    const args = (await fake.record()).argv;
    expect(args[args.indexOf('--resume') + 1]).toBe('sess-old');
    expect(args).toContain('--fork-session');
    expect(args[args.indexOf('--effort') + 1]).toBe('high');
  });

  it('passes the message on stdin untouched', async () => {
    const { fake, adapter, req } = setup(OK_RUN);
    const message = '-- starts with dashes\nFeedback from another reviewer:\n<quoted>\n"a" & <b>\n</quoted>';
    await collect(adapter.send(req({ message })));
    expect((await fake.record()).stdin).toBe(message);
  });

  it('turns an error result into an error event', async () => {
    const { adapter, req } = setup({
      lines: [{ type: 'system', subtype: 'init', session_id: 's' }, { type: 'result', subtype: 'error_during_execution', is_error: true, result: 'API Error: 429 rate limit' }],
      exitCode: 1,
    });
    const events = await collect(adapter.send(req()));
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'rate_limited' } });
  });

  it('classifies a sign-in failure with no result line', async () => {
    const { adapter, req } = setup({ stderr: 'Not logged in · Please run /login', exitCode: 1 });
    const events = await collect(adapter.send(req()));
    expect(events).toEqual([{ type: 'error', error: expect.objectContaining({ code: 'not_logged_in' }) }]);
  });

  it('ends quietly when aborted', async () => {
    const { adapter, req } = setup({ lines: OK_RUN.lines!.slice(0, 3), hang: true });
    const ac = new AbortController();
    const events: AdapterEvent[] = [];
    for await (const ev of adapter.send(req({ signal: ac.signal }))) {
      events.push(ev);
      if (ev.type === 'delta') ac.abort();
    }
    expect(events.map((e) => e.type)).toEqual(['session', 'delta']);
  });

  it('lists model aliases', async () => {
    const { adapter } = setup(OK_RUN);
    const models = await adapter.listModels();
    expect(models.map((m) => m.id)).toEqual(['opus', 'sonnet', 'haiku']);
  });
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
});

