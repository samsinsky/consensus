// Live check against the real CLIs. Uses a little quota on each plan.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdapters } from '../src/server/adapters/index.js';
import type { AdapterEvent, ProviderAdapter } from '../src/server/adapters/types.js';
import { makePaths } from '../src/server/paths.js';
import { snapshotPath, snapshotPrompt, writePrompt } from '../src/server/prompt.js';
import type { ProviderId } from '../src/shared/types.js';

const CHEAP: Record<ProviderId, { model: string; effort?: string; switchTo: string }> = {
  claude: { model: 'haiku', switchTo: 'sonnet' },
  codex: { model: 'gpt-5.5', effort: 'low', switchTo: 'gpt-6-luna' },
  gemini: { model: 'gemini-3.8-flash-low', switchTo: 'gemini-3.1-pro-low' },
};

type Outcome = { session?: string; text: string; deltas: number; done: boolean; error?: string };

async function run(adapter: ProviderAdapter, base: { promptHash: string; promptPath: string }, opts: {
  message: string; model: string; effort?: string; sessionId?: string; abortAfterDelta?: boolean;
}): Promise<Outcome> {
  const ac = new AbortController();
  const out: Outcome = { text: '', deltas: 0, done: false };
  // Stop after the first delta or 3s, whichever comes first; Codex sends no deltas until the reply is whole.
  const guard = setTimeout(() => ac.abort(), opts.abortAfterDelta ? 3_000 : 180_000);
  for await (const ev of adapter.send({ ...base, ...opts, signal: ac.signal }) as AsyncIterable<AdapterEvent>) {
    if (ev.type === 'session') out.session = ev.sessionId;
    if (ev.type === 'delta') {
      out.deltas++;
      out.text += ev.text;
      if (opts.abortAfterDelta) ac.abort();
    }
    if (ev.type === 'done') { out.done = true; out.text = ev.text; }
    if (ev.type === 'error') out.error = `${ev.error.code}: ${ev.error.message}`;
  }
  clearTimeout(guard);
  return out;
}

const only = process.argv[2] as ProviderId | undefined;
const paths = makePaths(await mkdtemp(join(tmpdir(), 'consensus-smoke-')));
await writePrompt(paths, 'You are a terse test assistant. Follow instructions exactly.\n');
const promptHash = await snapshotPrompt(paths);
const base = { promptHash, promptPath: snapshotPath(paths, promptHash) };
const adapters = createAdapters(paths);
let failures = 0;

const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail.replace(/\s+/g, ' ').slice(0, 140)}`);
  if (!ok) failures++;
};

for (const id of (only ? [only] : (['claude', 'codex', 'gemini'] as ProviderId[]))) {
  const a = adapters[id];
  const c = CHEAP[id];
  console.log(`\n== ${id}`);
  const first = await run(a, base, { message: 'Reply with exactly the word: PINEAPPLE', model: c.model, effort: c.effort });
  check(`${id} first reply`, first.done && /PINEAPPLE/i.test(first.text) && !!first.session, first.error ?? first.text);
  if (!first.session) continue;

  const second = await run(a, base, { message: 'What word did you reply with last time? Reply with just that word.', model: c.switchTo, sessionId: first.session });
  check(`${id} resume after model change`, second.done && /PINEAPPLE/i.test(second.text), second.error ?? second.text);
  const good = second.session ?? first.session;

  const stopped = await run(a, base, { message: 'Write 400 words about lighthouses. Begin with the word ZEBRA.', model: c.model, effort: c.effort, sessionId: good, abortAfterDelta: true });
  check(`${id} stop`, !stopped.done, `deltas=${stopped.deltas}`);

  const after = await run(a, base, { message: 'Have you written the word ZEBRA anywhere in this conversation? Answer only yes or no.', model: c.model, effort: c.effort, sessionId: good });
  check(`${id} stopped turn not remembered`, after.done && /\bno\b/i.test(after.text), after.error ?? after.text);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
