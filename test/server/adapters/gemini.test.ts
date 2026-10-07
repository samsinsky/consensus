import { mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentName, createGeminiAdapter } from '../../../src/server/adapters/gemini.js';
import type { SendRequest } from '../../../src/server/adapters/types.js';
import { collect, fakeCli, type FakeScript } from '../../helpers/fake.js';

const OK_RUN: FakeScript = {
  lines: [
    { event: 'init', conversation_id: 'conv-1', init: { tools: [] } },
    { event: 'step_update', step_update: { conversation_id: 'conv-1', step_type: 'user_input', state: 'DONE' } },
    { event: 'step_update', step_update: { conversation_id: 'conv-1', step_type: 'agent_response', state: 'ACTIVE', text_delta: 'Hello there' } },
    { event: 'step_update', step_update: { conversation_id: 'conv-1', step_type: 'agent_response', state: 'DONE', text_delta: '.\n' } },
    { event: 'result', result: { conversation_id: 'conv-1', status: 'SUCCESS', response: 'Hello there.\n' } },
  ],
};

function setup(script: FakeScript) {
  const fake = fakeCli(script);
  const workdir = mkdtempSync(join(tmpdir(), 'consensus-wd-'));
  const promptPath = join(workdir, 'snapshot.md');
  writeFileSync(promptPath, 'You are an experienced editor.\n');
  const adapter = createGeminiAdapter({ workdir, ...fake.options });
  const req = (over: Partial<SendRequest> = {}): SendRequest => ({
    message: 'Write a headline', model: 'gemini-3.1-pro-high', promptHash: 'abc123', promptPath,
    signal: new AbortController().signal, ...over,
  });
  return { fake, adapter, req, workdir };
}

describe('gemini adapter', () => {
  it('streams session, deltas and trimmed done', async () => {
    const { adapter, req } = setup(OK_RUN);
    expect(await collect(adapter.send(req()))).toEqual([
      { type: 'session', sessionId: 'conv-1' },
      { type: 'delta', text: 'Hello there' },
      { type: 'delta', text: '.\n' },
      { type: 'done', text: 'Hello there.' },
    ]);
  });

  it('writes a web-reading agent carrying the prompt snapshot', async () => {
    const { adapter, req, workdir } = setup(OK_RUN);
    await collect(adapter.send(req()));
    const agent = await readFile(join(workdir, '.agents', 'agents', 'consensus-abc123-web.md'), 'utf8');
    expect(agent).toBe('---\nname: consensus-abc123-web\ndescription: Consensus prose participant.\ntools:\n  - read_url_content\n  - search_web\n  - view_file\n---\nYou are an experienced editor.\n');
    expect(agentName('abc123')).toBe('consensus-abc123-web');
  });

  it('runs the agent with model and stream output, resuming by conversation', async () => {
    const { fake, adapter, req } = setup(OK_RUN);
    await collect(adapter.send(req({ sessionId: 'conv-0' })));
    const args = (await fake.record()).argv;
    expect(args[args.indexOf('--agent') + 1]).toBe('consensus-abc123-web');
    expect(args).toContain('--dangerously-skip-permissions');
    expect(args[args.indexOf('--model') + 1]).toBe('gemini-3.1-pro-high');
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(args[args.indexOf('--conversation') + 1]).toBe('conv-0');
  });

  it('attaches the prompt to -p= so leading dashes survive', async () => {
    const { fake, adapter, req } = setup(OK_RUN);
    await collect(adapter.send(req({ message: '--model x\nline two' })));
    const args = (await fake.record()).argv;
    expect(args.at(-1)).toBe('-p=--model x\nline two');
    expect(args).not.toContain('--conversation');
  });

  it('turns a failed result into an error', async () => {
    const { adapter, req } = setup({
      lines: [{ event: 'init', conversation_id: 'c' }, { event: 'result', result: { status: 'ERROR', error: 'quota exceeded' } }],
    });
    const events = await collect(adapter.send(req()));
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'rate_limited' } });
  });

  it('classifies a sign-in failure', async () => {
    const { adapter, req } = setup({ stderr: 'error getting token source: You are not logged into Antigravity.', exitCode: 1 });
    const events = await collect(adapter.send(req()));
    expect(events).toEqual([{ type: 'error', error: expect.objectContaining({ code: 'not_logged_in' }) }]);
  });

  it('groups Gemini models by name with their effort levels', async () => {
    const { adapter } = setup({
      lines: [
        'Fetching available models...',
        'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
        'gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)',
        'gemini-3.8-flash-low\tGemini 3.8 Flash (Low)',
        'gemini-3.1-pro-high\tGemini 3.1 Pro (High)',
        'gemini-3.1-pro-low\tGemini 3.1 Pro (Low)',
        'claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)',
      ],
    });
    expect(await adapter.listModels()).toEqual([
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', efforts: ['high', 'medium', 'low'] },
      { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', efforts: ['high', 'low'] },
    ]);
  });

  it('joins model and effort into the slug agy expects, and keeps older full slugs working', async () => {
    const first = setup(OK_RUN);
    await collect(first.adapter.send(first.req({ model: 'gemini-3.1-pro', effort: 'low' })));
    const a1 = (await first.fake.record()).argv;
    expect(a1[a1.indexOf('--model') + 1]).toBe('gemini-3.1-pro-low');
    const legacy = setup(OK_RUN);
    await collect(legacy.adapter.send(legacy.req({ model: 'gemini-3.1-pro-high' })));
    const a2 = (await legacy.fake.record()).argv;
    expect(a2[a2.indexOf('--model') + 1]).toBe('gemini-3.1-pro-high');
  });

  it('copies images into its folder and uses the view_file agent for that turn', async () => {
    const { fake, adapter, req, workdir } = setup(OK_RUN);
    const src = join(workdir, 'upload.png');
    writeFileSync(src, Buffer.from([9, 9]));
    await collect(adapter.send(req({ message: 'Thoughts?', images: [{ id: 'i1', name: 'hero.png', mime: 'image/png', path: src, threadId: 't9' }] })));
    const args = (await fake.record()).argv;
    expect(args[args.indexOf('--agent') + 1]).toBe('consensus-abc123-web');
    expect(args.at(-1)).toBe('-p=Attached images. Use view_file to look at each one before replying:\n- attachments/t9/i1.png (hero.png)\n\nThoughts?');
    expect(await readFile(join(workdir, 'attachments', 't9', 'i1.png'))).toEqual(Buffer.from([9, 9]));
  });

  it('refuses a message too long for one command-line argument without starting agy', async () => {
    const { fake, adapter, req } = setup(OK_RUN);
    const events = await collect(adapter.send(req({ message: 'é'.repeat(500_000) })));
    expect(events).toEqual([{ type: 'error', error: { code: 'unknown', message: 'Too much text for Gemini in one message (about 900KB at most). Attach fewer or shorter files.' } }]);
    await expect(fake.record()).rejects.toThrow();
  });
  it('reports searches and opened pages', async () => {
    const { adapter, req } = setup({
      lines: [
        { event: 'init', conversation_id: 'c' },
        { event: 'step_update', step_update: { step_type: 'tool', state: 'ACTIVE', tool_name: 'search_web', tool_info: { name: 'search_web', parameters: { query: 'node lts' } } } },
        { event: 'step_update', step_update: { step_type: 'tool', state: 'ACTIVE', tool_name: 'read_url_content', tool_info: { name: 'read_url_content', parameters: { Url: 'https://nodejs.org/en' } } } },
        { event: 'step_update', step_update: { step_type: 'tool', state: 'ACTIVE', tool_name: 'view_file', tool_info: { name: 'view_file', parameters: { AbsolutePath: '/x/content.md' } } } },
        { event: 'result', result: { status: 'SUCCESS', response: 'v24' } },
      ],
    });
    const events = await collect(adapter.send(req()));
    expect(events).toEqual([
      { type: 'session', sessionId: 'c' },
      { type: 'activity', text: 'Searching the web for "node lts"' },
      { type: 'activity', text: 'Reading nodejs.org' },
      { type: 'source', url: 'https://nodejs.org/en' },
      { type: 'done', text: 'v24' },
    ]);
  });
});

