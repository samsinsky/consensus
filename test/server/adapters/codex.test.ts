import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCodexAdapter } from '../../../src/server/adapters/codex.js';
import type { SendRequest } from '../../../src/server/adapters/types.js';
import { collect, fakeCli, type FakeScript } from '../../helpers/fake.js';

const OK_RUN: FakeScript = {
  lines: [
    { type: 'thread.started', thread_id: 'th-new' },
    { type: 'turn.started' },
    { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'Three options:' } },
    { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } },
  ],
};

function setup(script: FakeScript, codexHome?: string) {
  const fake = fakeCli(script);
  const adapter = createCodexAdapter({ workdir: mkdtempSync(join(tmpdir(), 'consensus-wd-')), codexHome, ...fake.options });
  const req = (over: Partial<SendRequest> = {}): SendRequest => ({
    message: 'Write a headline', model: 'gpt-6-luna', promptHash: 'abc', promptPath: '/tmp/my prompt.md',
    signal: new AbortController().signal, ...over,
  });
  return { fake, adapter, req };
}

describe('codex adapter', () => {
  it('emits session, one delta and done', async () => {
    const { adapter, req } = setup(OK_RUN);
    expect(await collect(adapter.send(req()))).toEqual([
      { type: 'session', sessionId: 'th-new' },
      { type: 'delta', text: 'Three options:' },
      { type: 'done', text: 'Three options:' },
    ]);
  });

  it('starts a fresh exec with prose instructions and a read-only sandbox', async () => {
    const { fake, adapter, req } = setup(OK_RUN);
    await collect(adapter.send(req({ effort: 'high' })));
    const args = (await fake.record()).argv;
    expect(args[0]).toBe('exec');
    expect(args).not.toContain('fork');
    expect(args).toEqual(expect.arrayContaining(['--json', '--skip-git-repo-check', '--ignore-user-config']));
    expect(args[args.indexOf('-m') + 1]).toBe('gpt-6-luna');
    expect(args).toContain('model_instructions_file="/tmp/my prompt.md"');
    expect(args).toContain('sandbox_mode="read-only"');
    expect(args).toContain('model_reasoning_effort="high"');
    expect(args.at(-1)).toBe('-');
  });

  it('asks for full-length replies and turns off agent features', async () => {
    const { fake, adapter, req } = setup(OK_RUN);
    await collect(adapter.send(req({ sessionId: 'th-old' })));
    const args = (await fake.record()).argv;
    expect(args).toContain('model_verbosity="high"');
    for (const feature of ['multi_agent', 'skill_search', 'plugins', 'apps', 'browser_use', 'computer_use', 'image_generation']) {
      expect(args).toContain(`features.${feature}=false`);
    }
  });

  it('forks from the last session when resuming', async () => {
    const { fake, adapter, req } = setup(OK_RUN);
    await collect(adapter.send(req({ sessionId: 'th-old' })));
    const args = (await fake.record()).argv;
    expect(args.slice(0, 3)).toEqual(['exec', 'fork', 'th-old']);
  });

  it('sends the prompt on stdin', async () => {
    const { fake, adapter, req } = setup(OK_RUN);
    await collect(adapter.send(req({ message: '-s not a flag\n<quoted>x</quoted>' })));
    expect((await fake.record()).stdin).toBe('-s not a flag\n<quoted>x</quoted>');
  });

  it('turns error items into warnings and joins several messages', async () => {
    const { adapter, req } = setup({
      lines: [
        { type: 'thread.started', thread_id: 't' },
        { type: 'item.completed', item: { type: 'error', message: 'This session was recorded with model `gpt-6-luna`' } },
        { type: 'item.completed', item: { type: 'agent_message', text: 'First.' } },
        { type: 'item.completed', item: { type: 'agent_message', text: 'Second.' } },
        { type: 'turn.completed' },
      ],
    });
    const events = await collect(adapter.send(req()));
    expect(events).toContainEqual({ type: 'warning', message: 'This session was recorded with model `gpt-6-luna`' });
    expect(events).toContainEqual({ type: 'delta', text: '\n\nSecond.' });
    // Earlier messages narrate tool use; the reply is the final message.
    expect(events.at(-1)).toEqual({ type: 'done', text: 'Second.' });
  });

  it('classifies a failed turn using the preceding error event', async () => {
    const { adapter, req } = setup({
      lines: [
        { type: 'thread.started', thread_id: 't' },
        { type: 'error', message: "You've hit your usage limit. Try again later." },
        { type: 'turn.failed', error: { message: 'turn failed' } },
      ],
      exitCode: 1,
    });
    const events = await collect(adapter.send(req()));
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'rate_limited' } });
  });

  it('lists models from the Codex cache, without review-only or hidden models', async () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-home-'));
    writeFileSync(join(home, 'models_cache.json'), JSON.stringify({
      models: [
        { slug: 'gpt-6-luna', display_name: 'GPT-6-Luna', description: 'Fast and affordable model for easier tasks.', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] },
        { slug: 'codex-auto-review', display_name: 'Codex Auto Review', supported_reasoning_levels: [] },
        { slug: 'gpt-reserve', display_name: 'GPT Reserve', visibility: 'hide', supported_reasoning_levels: [{ effort: 'high' }] },
      ],
    }));
    const { adapter } = setup(OK_RUN, home);
    expect(await adapter.listModels()).toEqual([{ id: 'gpt-6-luna', label: 'GPT-6-Luna', efforts: ['low', 'high'] }]);
  });

  it('falls back to a default model list when the cache is missing', async () => {
    const { adapter } = setup(OK_RUN, '/nonexistent');
    expect((await adapter.listModels())[0].id).toBe('gpt-5.6-terra');
  });
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
  it('turns on live web search', async () => {
    const { fake, adapter, req } = setup(OK_RUN);
    await collect(adapter.send(req()));
    expect((await fake.record()).argv).toContain('web_search="live"');
  });

  it('reports searches and opened pages', async () => {
    const { adapter, req } = setup({
      lines: [
        { type: 'thread.started', thread_id: 't' },
        { type: 'item.started', item: { type: 'web_search', query: '', action: { type: 'other' } } },
        { type: 'item.completed', item: { type: 'web_search', query: 'node lts', action: { type: 'search', query: 'node lts' } } },
        { type: 'item.completed', item: { type: 'web_search', query: 'https://nodejs.org/en/download/', action: { type: 'open_page', url: 'https://nodejs.org/en/download/' } } },
        { type: 'item.completed', item: { type: 'agent_message', text: 'v24' } },
        { type: 'turn.completed' },
      ],
    });
    const events = await collect(adapter.send(req()));
    expect(events.filter((e) => e.type === 'activity' || e.type === 'source')).toEqual([
      { type: 'activity', text: 'Searching the web' },
      { type: 'activity', text: 'Reading nodejs.org' },
      { type: 'source', url: 'https://nodejs.org/en/download/' },
    ]);
  });
});

