// Live check against the real CLIs. Uses a little quota on each plan.
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { createAdapters } from '../src/server/adapters/index.js';
import type { AdapterEvent, ImageInput, ProviderAdapter } from '../src/server/adapters/types.js';
import { makePaths } from '../src/server/paths.js';
import { snapshotPath, snapshotPrompt, writePrompt } from '../src/server/prompt.js';
import type { ProviderId } from '../src/shared/types.js';

// web: the model used for the web check; Luna sometimes gives up after one failed page open, Terra does not.
const CHEAP: Record<ProviderId, { model: string; effort?: string; switchTo: string; web: string }> = {
  claude: { model: 'haiku', switchTo: 'sonnet', web: 'haiku' },
  codex: { model: 'gpt-5.5', effort: 'low', switchTo: 'gpt-6-luna', web: 'gpt-5.6-terra' },
  gemini: { model: 'gemini-3.8-flash-low', switchTo: 'gemini-3.1-pro-low', web: 'gemini-3.1-pro-low' },
};

type Outcome = { session?: string; text: string; deltas: number; done: boolean; error?: string; sources: string[] };

async function run(adapter: ProviderAdapter, base: { promptHash: string; promptPath: string }, opts: {
  message: string; model: string; effort?: string; sessionId?: string; abortAfterDelta?: boolean; images?: ImageInput[];
}): Promise<Outcome> {
  const ac = new AbortController();
  const out: Outcome = { text: '', deltas: 0, done: false, sources: [] };
  // Stop after the first delta or 3s, whichever comes first; Codex sends no deltas until the reply is whole.
  const guard = setTimeout(() => ac.abort(), opts.abortAfterDelta ? 3_000 : 180_000);
  for await (const ev of adapter.send({ ...base, ...opts, signal: ac.signal }) as AsyncIterable<AdapterEvent>) {
    if (ev.type === 'session') out.session = ev.sessionId;
    if (ev.type === 'delta') {
      out.deltas++;
      out.text += ev.text;
      if (opts.abortAfterDelta) ac.abort();
    }
    if (ev.type === 'source') out.sources.push(ev.url);
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

function bluePng(): Buffer {
  const size = 64;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, Buffer.from([0x10, 0x30, 0xd0]))]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// A neutral file name, so a model cannot guess the color from it.
const imagePath = join(paths.home, 'a7.png');
await writeFile(imagePath, bluePng());
const image: ImageInput = { id: 'a7', name: 'a7.png', mime: 'image/png', path: imagePath, threadId: 'smoke' };
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

  const seen = await run(a, base, { message: 'What single color fills the attached image? One word.', model: c.model, effort: c.effort, images: [image] });
  check(`${id} image`, seen.done && /blue/i.test(seen.text), seen.error ?? seen.text);

  // A phrase made up for this run, so only a real page read can return it.
  const phrase = `violet-otter-${Date.now()}`;
  const url = `https://httpbin.org/base64/${Buffer.from(`Secret phrase: ${phrase}`).toString('base64')}`;
  const web = await run(a, base, { message: `Open ${url} and reply with exactly the secret phrase it shows, nothing else.`, model: c.web, effort: c.effort });
  check(`${id} web page`, web.done && web.text.includes(phrase) && web.sources.some((u) => u.includes('httpbin.org')), web.error ?? `${web.text} | sources: ${web.sources.join(' ')}`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
