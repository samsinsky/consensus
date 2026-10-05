# Consensus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Consensus, a local web app that routes prose work between Claude, ChatGPT, and Gemini participants through their official CLIs on Sam's existing subscriptions.

**Architecture:** A Node + TypeScript server spawns `claude`, `codex`, and `agy` headlessly through one adapter interface, keeps threads as JSON files under `~/.consensus`, and streams events to a React page over Server-Sent Events. The router sends each message only to its chosen participant and inlines forwarded quotes; Claude and Codex fork their session every turn so a stopped reply never enters memory.

**Tech Stack:** Node 24, TypeScript 5, React 19, Vite 7, Vitest 3, react-markdown 10, tsx.

**Spec:** `docs/superpowers/specs/2026-10-05-consensus-design.md`

## Global Constraints

- Node 24 and TypeScript throughout; ESM (`"type": "module"`); relative imports end in `.js`.
- No API keys. Every model call goes through `claude`, `codex`, or `agy` signed in with Sam's subscription.
- Provider IDs are exactly `'claude' | 'codex' | 'gemini'`; display names are Claude, ChatGPT, Gemini.
- The user-facing term is "participant", never "chat", "agent", or "bot". Threads are "threads", never "pieces".
- Quote format sent to models, verbatim: `Feedback from another reviewer:\n<quoted>\n…\n</quoted>`. Never name the source provider.
- Data lives under `~/.consensus` (override with `CONSENSUS_HOME`): `threads/<id>.json`, `prompts/default.md`, `prompts/snapshots/<hash>.md`, `settings.json`, `workdir/<provider>/`.
- Server binds to `127.0.0.1` only. Default port 4747.
- Each CLI runs in its own empty working directory, `~/.consensus/workdir/<provider>`.
- Error codes: `not_installed`, `not_logged_in`, `rate_limited`, `timeout`, `interrupted`, `unknown`.
- Copy in the UI: no em dashes.
- Verified CLI versions: Claude Code 2.1.289, Codex CLI 0.160.1, Antigravity CLI 1.2.17.

## Review Focus

1. **Sending to a participant whose reply is still streaming:** the server rejects it with 409 and "That participant is still replying."; other participants stay usable. Test: Task 8, "rejects a second send to a busy participant".
2. **Consensus restarts while a reply streams:** on reload the reply shows as an `interrupted` error with Retry, and the participant's session stays at its last completed turn. Test: Task 3, "marks streaming replies as interrupted on load".
3. **A corrupt or half-written thread file:** the sidebar still lists every other thread. Test: Task 3, "skips unreadable thread files when listing".
4. **A CLI missing from PATH:** the reply shows `not_installed` with the install command, and the server keeps running. Test: Task 4, "reports a missing binary as not_installed".
5. **A message that starts with `-`, or spans many lines with quotes and angle brackets:** the model receives it byte for byte. Tests: Task 5 "passes the message on stdin untouched", Task 6 "sends the prompt on stdin", Task 7 "attaches the prompt to -p= so leading dashes survive".

---

## File map

```
consensus/
  package.json, tsconfig.json, tsconfig.server.json, vite.config.ts, vitest.config.ts, .gitignore, README.md
  src/shared/types.ts          domain types shared by server and web
  src/shared/labels.ts         participant and model labels
  src/server/paths.ts          ~/.consensus layout
  src/server/prompt.ts         default prompt, read/write, snapshots
  src/server/settings.ts       per-provider default model and effort
  src/server/store.ts          ThreadStore: JSON files, atomic writes
  src/server/hub.ts            per-thread event fan-out
  src/server/router.ts         Router: participants, send, stop, retry, model change
  src/server/http.ts           HTTP API, SSE, static files
  src/server/cli.ts            `consensus` entry point
  src/server/adapters/types.ts     ProviderAdapter, SendRequest, AdapterEvent
  src/server/adapters/process.ts   runJsonl: spawn, line parsing, abort, timeout
  src/server/adapters/errors.ts    classifyError
  src/server/adapters/claude.ts    Claude Code adapter
  src/server/adapters/codex.ts     Codex CLI adapter
  src/server/adapters/gemini.ts    Antigravity CLI adapter
  src/server/adapters/index.ts     createAdapters
  src/web/index.html, main.tsx, App.tsx, api.ts, useThread.ts, threadState.ts, styles.css
  src/web/components/ThreadsSidebar.tsx, ThreadView.tsx, MessageList.tsx, MessageView.tsx,
                     Composer.tsx, ParticipantChip.tsx, ModelPicker.tsx, SettingsDialog.tsx
  scripts/smoke.ts             live check against the real CLIs
  test/helpers/fake-cli.mjs    replays scripted output as a fake CLI
  test/helpers/fake.ts         builds fake CLI scripts
  test/helpers/queue.ts        AsyncQueue for controllable adapters
  test/**/*.test.ts
```

---

### Task 1: Scaffold, shared types, labels

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.server.json`, `vite.config.ts`, `vitest.config.ts`, `.gitignore`
- Create: `src/shared/types.ts`, `src/shared/labels.ts`
- Test: `test/shared/labels.test.ts`

**Interfaces:**
- Produces: every type in `src/shared/types.ts`; `PROVIDERS`, `PROVIDER_IDS`; `modelLabel(model, effort?)`, `participantLabel(p, all)`.

- [ ] **Step 1: Create project files**

`package.json`:
```json
{
  "name": "consensus",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "consensus": "dist/server/cli.js" },
  "scripts": {
    "dev:server": "tsx watch src/server/cli.ts --no-open",
    "dev:web": "vite",
    "build": "vite build && tsc -p tsconfig.server.json",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "smoke": "tsx scripts/smoke.ts"
  }
}
```

Then install dependencies:
```bash
npm install react@19 react-dom@19 react-markdown@10
npm install -D typescript@5 vite@7 @vitejs/plugin-react vitest@3 tsx @types/node@24 @types/react@19 @types/react-dom@19
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test", "scripts"]
}
```

`tsconfig.server.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": false, "rootDir": "src", "outDir": "dist" },
  "include": ["src/server", "src/shared"]
}
```

`vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:4747' } },
});
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'node', testTimeout: 15000 },
});
```

`.gitignore`:
```
node_modules/
dist/
```

- [ ] **Step 2: Write shared types**

`src/shared/types.ts`:
```ts
export type ProviderId = 'claude' | 'codex' | 'gemini';

export const PROVIDER_IDS: ProviderId[] = ['claude', 'codex', 'gemini'];

export const PROVIDERS: Record<ProviderId, { name: string }> = {
  claude: { name: 'Claude' },
  codex: { name: 'ChatGPT' },
  gemini: { name: 'Gemini' },
};

/** efforts is empty when the provider bakes effort into the model id. */
export type ModelOption = { id: string; label: string; efforts: string[] };

export type Participant = {
  id: string;
  provider: ProviderId;
  model: string;
  effort?: string;
  /** Last completed session. Only advances when a reply finishes. */
  sessionId?: string;
  /** Hash of the system prompt snapshot this participant started with. */
  promptHash: string;
  createdAt: string;
};

export type Quote = { messageId: string; text: string };

export type ErrorCode =
  | 'not_installed'
  | 'not_logged_in'
  | 'rate_limited'
  | 'timeout'
  | 'interrupted'
  | 'unknown';

export type AdapterError = { code: ErrorCode; message: string; fix?: string };

export type Origin = 'manual' | 'loop';

export type UserMessage = {
  id: string;
  kind: 'user';
  to: string;
  text: string;
  quotes: Quote[];
  sentAt: string;
  origin?: Origin;
};

export type ReplyStatus = 'streaming' | 'done' | 'stopped' | 'error';

export type ReplyMessage = {
  id: string;
  kind: 'reply';
  from: string;
  text: string;
  model: string;
  effort?: string;
  status: ReplyStatus;
  error?: AdapterError;
  sentAt: string;
  origin?: Origin;
};

export type ModelChangeMessage = {
  id: string;
  kind: 'model_change';
  participant: string;
  from: string;
  to: string;
  sentAt: string;
};

export type Message = UserMessage | ReplyMessage | ModelChangeMessage;

export type Thread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  participants: Participant[];
  messages: Message[];
};

export type ThreadSummary = { id: string; title: string; updatedAt: string };

export type ProviderDefaults = { model: string; effort?: string };

export type Settings = { defaults: Record<ProviderId, ProviderDefaults> };

export type ThreadEvent =
  | { type: 'thread'; thread: Thread }
  | { type: 'delta'; messageId: string; text: string };
```

- [ ] **Step 3: Write the failing label tests**

`test/shared/labels.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { modelLabel, participantLabel } from '../../src/shared/labels.js';
import type { Participant } from '../../src/shared/types.js';

const p = (id: string, provider: Participant['provider'], model: string, effort?: string): Participant => ({
  id, provider, model, effort, promptHash: 'h', createdAt: '2026-10-05T00:00:00Z',
});

describe('labels', () => {
  it('joins model and effort', () => {
    expect(modelLabel('opus', 'high')).toBe('opus high');
    expect(modelLabel('gemini-3.1-pro-high')).toBe('gemini-3.1-pro-high');
  });

  it('labels a lone participant with provider name and model', () => {
    const a = p('a', 'codex', 'gpt-6-luna', 'high');
    expect(participantLabel(a, [a])).toBe('ChatGPT · gpt-6-luna high');
  });

  it('numbers participants that share provider, model and effort', () => {
    const a = p('a', 'claude', 'opus', 'high');
    const b = p('b', 'claude', 'opus', 'high');
    const c = p('c', 'claude', 'sonnet', 'high');
    const all = [a, b, c];
    expect(participantLabel(a, all)).toBe('Claude · opus high #1');
    expect(participantLabel(b, all)).toBe('Claude · opus high #2');
    expect(participantLabel(c, all)).toBe('Claude · sonnet high');
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run test/shared/labels.test.ts`
Expected: FAIL, cannot resolve `src/shared/labels.js`.

- [ ] **Step 5: Implement labels**

`src/shared/labels.ts`:
```ts
import { PROVIDERS, type Participant } from './types.js';

export function modelLabel(model: string, effort?: string): string {
  return effort ? `${model} ${effort}` : model;
}

export function participantLabel(p: Participant, all: Participant[]): string {
  const base = `${PROVIDERS[p.provider].name} · ${modelLabel(p.model, p.effort)}`;
  const twins = all.filter(
    (o) => o.provider === p.provider && o.model === p.model && o.effort === p.effort,
  );
  if (twins.length < 2) return base;
  return `${base} #${twins.findIndex((o) => o.id === p.id) + 1}`;
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run test/shared/labels.test.ts && npm run typecheck`
Expected: 3 tests PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: scaffold project with shared types and labels"
```

---

### Task 2: Paths, system prompt, settings

**Files:**
- Create: `src/server/paths.ts`, `src/server/prompt.ts`, `src/server/settings.ts`
- Test: `test/server/prompt.test.ts`, `test/server/settings.test.ts`

**Interfaces:**
- Consumes: `Settings`, `ProviderId` from Task 1.
- Produces:
  - `makePaths(home?: string): Paths` with `home`, `threads`, `promptFile`, `snapshots`, `settings`, `workdir(provider)`.
  - `DEFAULT_PROMPT: string`; `readPrompt(paths): Promise<string>`; `writePrompt(paths, text): Promise<void>`; `promptHash(text): string`; `snapshotPath(paths, hash): string`; `snapshotPrompt(paths): Promise<string>` (returns hash).
  - `DEFAULT_SETTINGS: Settings`; `loadSettings(paths): Promise<Settings>`; `saveSettings(paths, s): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

`test/server/prompt.test.ts`:
```ts
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makePaths } from '../../src/server/paths.js';
import {
  DEFAULT_PROMPT, promptHash, readPrompt, snapshotPath, snapshotPrompt, writePrompt,
} from '../../src/server/prompt.js';

const tmpPaths = async () => makePaths(await mkdtemp(join(tmpdir(), 'consensus-')));

describe('prompt', () => {
  it('creates the default prompt on first read', async () => {
    const paths = await tmpPaths();
    expect(await readPrompt(paths)).toBe(DEFAULT_PROMPT);
    expect(await readFile(paths.promptFile, 'utf8')).toBe(DEFAULT_PROMPT);
  });

  it('default prompt carries the reviewer and no-fabrication rules', () => {
    expect(DEFAULT_PROMPT).toContain('Feedback from another reviewer');
    expect(DEFAULT_PROMPT).toContain("Don't invent facts");
    expect(DEFAULT_PROMPT).toContain('[STAT: % reduction in food cost]');
    expect(DEFAULT_PROMPT).not.toContain('—');
  });

  it('snapshots the current prompt by content hash', async () => {
    const paths = await tmpPaths();
    await writePrompt(paths, 'Version one');
    const h1 = await snapshotPrompt(paths);
    await writePrompt(paths, 'Version two');
    const h2 = await snapshotPrompt(paths);
    expect(h1).toBe(promptHash('Version one'));
    expect(h1).not.toBe(h2);
    expect(await readFile(snapshotPath(paths, h1), 'utf8')).toBe('Version one');
    expect(await readFile(snapshotPath(paths, h2), 'utf8')).toBe('Version two');
  });
});
```

`test/server/settings.test.ts`:
```ts
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makePaths } from '../../src/server/paths.js';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../../src/server/settings.js';

describe('settings', () => {
  it('returns defaults when no file exists', async () => {
    const paths = makePaths(await mkdtemp(join(tmpdir(), 'consensus-')));
    expect(await loadSettings(paths)).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips saved settings', async () => {
    const paths = makePaths(await mkdtemp(join(tmpdir(), 'consensus-')));
    const s = structuredClone(DEFAULT_SETTINGS);
    s.defaults.claude = { model: 'sonnet', effort: 'medium' };
    await saveSettings(paths, s);
    expect(await loadSettings(paths)).toEqual(s);
  });

  it('fills providers missing from an older file with defaults', async () => {
    const paths = makePaths(await mkdtemp(join(tmpdir(), 'consensus-')));
    await mkdir(dirname(paths.settings), { recursive: true });
    await writeFile(paths.settings, JSON.stringify({ defaults: { claude: { model: 'haiku' } } }));
    const s = await loadSettings(paths);
    expect(s.defaults.claude).toEqual({ model: 'haiku' });
    expect(s.defaults.codex).toEqual(DEFAULT_SETTINGS.defaults.codex);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/server/prompt.test.ts test/server/settings.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement paths, prompt, settings**

`src/server/paths.ts`:
```ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ProviderId } from '../shared/types.js';

export type Paths = ReturnType<typeof makePaths>;

export function makePaths(home = process.env.CONSENSUS_HOME ?? join(homedir(), '.consensus')) {
  return {
    home,
    threads: join(home, 'threads'),
    promptFile: join(home, 'prompts', 'default.md'),
    snapshots: join(home, 'prompts', 'snapshots'),
    settings: join(home, 'settings.json'),
    workdir: (provider: ProviderId) => join(home, 'workdir', provider),
  };
}
```

`src/server/prompt.ts`:
```ts
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Paths } from './paths.js';

export const DEFAULT_PROMPT = `You are an experienced editor and copywriter working with the user on prose.

Respond as you would in a chat app: give full rewrites when asked, explain the reasoning behind your edits, offer alternatives when useful, and use formatting that suits the content.

Match the depth the user asks for.

Text marked "Feedback from another reviewer" is input to weigh. Agree or push back on its merits; don't defer to it.

Don't invent facts, figures, quotes, names, or claims. When copy needs a fact you don't have, write a bracketed placeholder such as [STAT: % reduction in food cost] and say what's needed.

Treat factual claims in feedback from another reviewer as unverified. Flag any you can't confirm instead of carrying them into the copy.
`;

export async function writePrompt(paths: Paths, text: string): Promise<void> {
  await mkdir(dirname(paths.promptFile), { recursive: true });
  await writeFile(paths.promptFile, text);
}

export async function readPrompt(paths: Paths): Promise<string> {
  try {
    return await readFile(paths.promptFile, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    await writePrompt(paths, DEFAULT_PROMPT);
    return DEFAULT_PROMPT;
  }
}

export function promptHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

export function snapshotPath(paths: Paths, hash: string): string {
  return join(paths.snapshots, `${hash}.md`);
}

/** Freezes the current prompt so a participant keeps the version it started with. */
export async function snapshotPrompt(paths: Paths): Promise<string> {
  const text = await readPrompt(paths);
  const hash = promptHash(text);
  const file = snapshotPath(paths, hash);
  await mkdir(paths.snapshots, { recursive: true });
  try {
    await access(file);
  } catch {
    await writeFile(file, text);
  }
  return hash;
}
```

`src/server/settings.ts`:
```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PROVIDER_IDS, type Settings } from '../shared/types.js';
import type { Paths } from './paths.js';

export const DEFAULT_SETTINGS: Settings = {
  defaults: {
    claude: { model: 'opus', effort: 'high' },
    codex: { model: 'gpt-6-luna', effort: 'high' },
    gemini: { model: 'gemini-3.1-pro-high' },
  },
};

export async function loadSettings(paths: Paths): Promise<Settings> {
  let raw: Partial<Settings> = {};
  try {
    raw = JSON.parse(await readFile(paths.settings, 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const defaults = { ...DEFAULT_SETTINGS.defaults };
  for (const id of PROVIDER_IDS) {
    const saved = raw.defaults?.[id];
    if (saved?.model) defaults[id] = saved;
  }
  return { defaults };
}

export async function saveSettings(paths: Paths, settings: Settings): Promise<void> {
  await mkdir(dirname(paths.settings), { recursive: true });
  await writeFile(paths.settings, JSON.stringify(settings, null, 2));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/server/prompt.test.ts test/server/settings.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add consensus paths, system prompt snapshots and settings"
```

---

### Task 3: Thread store

**Files:**
- Create: `src/server/store.ts`
- Test: `test/server/store.test.ts`

**Interfaces:**
- Consumes: `Thread`, `ThreadSummary` from Task 1.
- Produces: `class ThreadStore { constructor(dir: string); create(title?: string): Promise<Thread>; get(id: string): Promise<Thread | undefined>; list(): Promise<ThreadSummary[]>; save(thread: Thread): Promise<void> }`. `get` converts any `streaming` reply into an `interrupted` error.

- [ ] **Step 1: Write the failing tests**

`test/server/store.test.ts`:
```ts
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/server/store.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the store**

`src/server/store.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Thread, ThreadSummary } from '../shared/types.js';

const SAFE_ID = /^[\w-]+$/;

export class ThreadStore {
  constructor(private dir: string) {}

  async create(title = 'Untitled thread'): Promise<Thread> {
    const now = new Date().toISOString();
    const thread: Thread = { id: randomUUID(), title, createdAt: now, updatedAt: now, participants: [], messages: [] };
    await this.save(thread);
    return thread;
  }

  async get(id: string): Promise<Thread | undefined> {
    if (!SAFE_ID.test(id)) return undefined;
    let thread: Thread;
    try {
      thread = JSON.parse(await readFile(this.file(id), 'utf8'));
    } catch {
      return undefined;
    }
    for (const m of thread.messages) {
      if (m.kind === 'reply' && m.status === 'streaming') {
        m.status = 'error';
        m.error = { code: 'interrupted', message: 'Consensus stopped before this reply finished.' };
      }
    }
    return thread;
  }

  async list(): Promise<ThreadSummary[]> {
    await mkdir(this.dir, { recursive: true });
    const files = (await readdir(this.dir)).filter((f) => f.endsWith('.json'));
    const summaries: ThreadSummary[] = [];
    for (const f of files) {
      try {
        const t = JSON.parse(await readFile(join(this.dir, f), 'utf8')) as Thread;
        summaries.push({ id: t.id, title: t.title, updatedAt: t.updatedAt });
      } catch {
        console.warn(`consensus: skipping unreadable thread file ${f}`);
      }
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async save(thread: Thread): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    thread.updatedAt = new Date().toISOString();
    const tmp = join(this.dir, `.${thread.id}.${randomUUID()}.tmp`);
    await writeFile(tmp, JSON.stringify(thread, null, 2));
    await rename(tmp, this.file(thread.id));
  }

  private file(id: string): string {
    return join(this.dir, `${id}.json`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/server/store.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add JSON thread store with atomic writes and crash recovery"
```

---

### Task 4: Process runner, error classification, fake CLI

**Files:**
- Create: `src/server/adapters/types.ts`, `src/server/adapters/process.ts`, `src/server/adapters/errors.ts`
- Create: `test/helpers/fake-cli.mjs`, `test/helpers/fake.ts`
- Test: `test/server/adapters/process.test.ts`, `test/server/adapters/errors.test.ts`

**Interfaces:**
- Consumes: `ProviderId`, `ModelOption`, `AdapterError` from Task 1.
- Produces:
  - `SendRequest`, `AdapterEvent`, `ProviderAdapter`, `CliOptions` (see code).
  - `runJsonl(opts: RunOptions): AsyncGenerator<ProcItem>` where `ProcItem = { type: 'json'; value: any } | { type: 'line'; text: string } | { type: 'exit'; info: ExitInfo }`.
  - `ExitInfo = { code: number | null; stderr: string; aborted: boolean; timedOut: boolean; spawnError?: string }`.
  - `classifyError(provider: ProviderId, info: Partial<ExitInfo> & { detail?: string }): AdapterError`.
  - Test helper `fakeCli(script: FakeScript): FakeCli` with `{ options: Pick<CliOptions, 'bin' | 'binArgs' | 'env'>; record(): Promise<{ argv: string[]; stdin: string }> }`.

- [ ] **Step 1: Write adapter types**

`src/server/adapters/types.ts`:
```ts
import type { AdapterError, ModelOption, ProviderId } from '../../shared/types.js';

export type SendRequest = {
  /** Last completed session; absent on a participant's first message. */
  sessionId?: string;
  /** Final text, quotes already inlined. */
  message: string;
  model: string;
  effort?: string;
  promptHash: string;
  promptPath: string;
  signal: AbortSignal;
};

export type AdapterEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'delta'; text: string }
  | { type: 'warning'; message: string }
  | { type: 'done'; text: string }
  | { type: 'error'; error: AdapterError };

export interface ProviderAdapter {
  id: ProviderId;
  listModels(): Promise<ModelOption[]>;
  /** Ends without done or error when the request's signal aborts. */
  send(req: SendRequest): AsyncIterable<AdapterEvent>;
}

export type CliOptions = {
  workdir: string;
  bin?: string;
  /** Arguments placed before the adapter's own, used by tests to run the fake CLI. */
  binArgs?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
};

export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
```

- [ ] **Step 2: Write the fake CLI and its helper**

`test/helpers/fake-cli.mjs`:
```js
#!/usr/bin/env node
// Replays a scripted CLI run: records argv and stdin, prints lines, then exits or hangs.
import { readFileSync, writeFileSync } from 'node:fs';

const script = JSON.parse(readFileSync(process.env.FAKE_SCRIPT, 'utf8'));
let stdin = '';
let started = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (stdin += d));
process.stdin.on('end', run);
process.stdin.on('error', run);

async function run() {
  if (started) return;
  started = true;
  writeFileSync(process.env.FAKE_RECORD, JSON.stringify({ argv: process.argv.slice(2), stdin }));
  for (const line of script.lines ?? []) {
    process.stdout.write(line + '\n');
    if (script.delayMs) await new Promise((r) => setTimeout(r, script.delayMs));
  }
  if (script.stderr) process.stderr.write(script.stderr);
  if (script.hang) {
    setInterval(() => {}, 1000);
    return;
  }
  process.exitCode = script.exitCode ?? 0;
}
```

`test/helpers/fake.ts`:
```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type FakeScript = {
  lines?: (string | object)[];
  delayMs?: number;
  stderr?: string;
  exitCode?: number;
  hang?: boolean;
};

const FAKE = fileURLToPath(new URL('./fake-cli.mjs', import.meta.url));

export function fakeCli(script: FakeScript) {
  const dir = mkdtempSync(join(tmpdir(), 'consensus-fake-'));
  const scriptFile = join(dir, 'script.json');
  const recordFile = join(dir, 'record.json');
  const lines = (script.lines ?? []).map((l) => (typeof l === 'string' ? l : JSON.stringify(l)));
  writeFileSync(scriptFile, JSON.stringify({ ...script, lines }));
  return {
    dir,
    options: {
      bin: process.execPath,
      binArgs: [FAKE],
      env: { FAKE_SCRIPT: scriptFile, FAKE_RECORD: recordFile },
    },
    async record(): Promise<{ argv: string[]; stdin: string }> {
      return JSON.parse(await readFile(recordFile, 'utf8'));
    },
  };
}

export async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}
```

- [ ] **Step 3: Write the failing tests**

`test/server/adapters/process.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { runJsonl, type ProcItem } from '../../../src/server/adapters/process.js';
import { collect, fakeCli } from '../../helpers/fake.js';

const run = (fake: ReturnType<typeof fakeCli>, extra: { stdin?: string; signal?: AbortSignal; timeoutMs?: number } = {}) =>
  runJsonl({
    bin: fake.options.bin,
    args: fake.options.binArgs,
    cwd: fake.dir,
    env: fake.options.env,
    signal: extra.signal ?? new AbortController().signal,
    timeoutMs: extra.timeoutMs ?? 10_000,
    stdin: extra.stdin,
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
      runJsonl({ bin: '/nonexistent/consensus-cli', args: [], cwd: '/', signal: new AbortController().signal, timeoutMs: 1000 }),
    );
    expect(exitOf(items)).toMatchObject({ info: { spawnError: 'ENOENT' } });
  });
});
```

`test/server/adapters/errors.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { classifyError } from '../../../src/server/adapters/errors.js';

describe('classifyError', () => {
  it('reports a missing binary as not_installed', () => {
    const e = classifyError('gemini', { spawnError: 'ENOENT' });
    expect(e.code).toBe('not_installed');
    expect(e.fix).toBe('curl -fsSL https://antigravity.google/cli/install.sh | bash');
  });

  it.each([
    ['claude', 'Not logged in · Please run /login', 'claude, then run /login'],
    ['codex', 'Error: Not logged in. Run codex login', 'codex login'],
    ['gemini', 'error getting token source: You are not logged into Antigravity.', 'agy, complete sign-in, then quit'],
  ] as const)('detects sign-in problems for %s', (provider, stderr, fix) => {
    const e = classifyError(provider, { code: 1, stderr });
    expect(e).toMatchObject({ code: 'not_logged_in', fix });
  });

  it('detects rate limits', () => {
    expect(classifyError('codex', { detail: "You've hit your usage limit." }).code).toBe('rate_limited');
    expect(classifyError('claude', { stderr: '429 Too Many Requests' }).code).toBe('rate_limited');
  });

  it('reports timeouts', () => {
    expect(classifyError('claude', { timedOut: true }).code).toBe('timeout');
  });

  it('falls back to unknown with the tail of the output', () => {
    const e = classifyError('codex', { code: 2, stderr: 'x'.repeat(1000) + 'the real cause' });
    expect(e.code).toBe('unknown');
    expect(e.message.endsWith('the real cause')).toBe(true);
    expect(e.message.length).toBeLessThanOrEqual(500);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run test/server/adapters`
Expected: FAIL, modules not found.

- [ ] **Step 5: Implement the runner and classifier**

`src/server/adapters/process.ts`:
```ts
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export type RunOptions = {
  bin: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  stdin?: string;
  signal: AbortSignal;
  timeoutMs: number;
};

export type ExitInfo = {
  code: number | null;
  stderr: string;
  aborted: boolean;
  timedOut: boolean;
  spawnError?: string;
};

export type ProcItem =
  | { type: 'json'; value: any }
  | { type: 'line'; text: string }
  | { type: 'exit'; info: ExitInfo };

/** Spawns a CLI, yields each stdout line (parsed when it is JSON), then one exit item. */
export async function* runJsonl(opts: RunOptions): AsyncGenerator<ProcItem> {
  const child = spawn(opts.bin, opts.args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: [opts.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  let spawnError: string | undefined;
  let aborted = false;
  let timedOut = false;
  child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', (d: string) => (stderr += d));
  const exited = new Promise<number | null>((resolve) => {
    child.on('close', (code) => resolve(code));
    child.on('error', (e: NodeJS.ErrnoException) => {
      spawnError = e.code ?? e.message;
      resolve(null);
    });
  });
  if (opts.stdin !== undefined) {
    child.stdin!.on('error', () => {});
    child.stdin!.end(opts.stdin);
  }
  const kill = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  };
  const onAbort = () => {
    aborted = true;
    kill();
  };
  if (opts.signal.aborted) onAbort();
  else opts.signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, opts.timeoutMs);

  try {
    const lines = createInterface({ input: child.stdout! });
    for await (const raw of lines) {
      const text = raw.trim();
      if (!text) continue;
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        yield { type: 'line', text };
        continue;
      }
      yield { type: 'json', value };
    }
    const code = await exited;
    yield { type: 'exit', info: { code, stderr, aborted, timedOut, spawnError } };
  } finally {
    clearTimeout(timer);
    opts.signal.removeEventListener('abort', onAbort);
    kill();
  }
}
```

`src/server/adapters/errors.ts`:
```ts
import type { AdapterError, ProviderId } from '../../shared/types.js';
import type { ExitInfo } from './process.js';

const FIX: Record<ProviderId, { install: string; login: string; cli: string }> = {
  claude: { cli: 'Claude Code', install: 'curl -fsSL https://claude.ai/install.sh | bash', login: 'claude, then run /login' },
  codex: { cli: 'Codex CLI', install: 'npm i -g @openai/codex', login: 'codex login' },
  gemini: { cli: 'Antigravity CLI', install: 'curl -fsSL https://antigravity.google/cli/install.sh | bash', login: 'agy, complete sign-in, then quit' },
};

const LOGIN = /not logged in|not logged into|please run \/login|unauthori[sz]ed|\b401\b|sign[- ]?in required|authentication/i;
const RATE = /rate.?limit|usage limit|quota|\b429\b|too many requests/i;

export function classifyError(
  provider: ProviderId,
  info: Partial<ExitInfo> & { detail?: string },
): AdapterError {
  const fix = FIX[provider];
  if (info.spawnError === 'ENOENT') {
    return { code: 'not_installed', message: `${fix.cli} is not installed or not on PATH.`, fix: fix.install };
  }
  if (info.timedOut) {
    return { code: 'timeout', message: `${fix.cli} took too long to reply.` };
  }
  const text = [info.detail, info.stderr].filter(Boolean).join('\n').trim();
  if (LOGIN.test(text)) {
    return { code: 'not_logged_in', message: `${fix.cli} is not signed in.`, fix: fix.login };
  }
  if (RATE.test(text)) {
    return { code: 'rate_limited', message: `${fix.cli} hit a usage limit. ${tail(text, 300)}`.trim() };
  }
  const exit = info.code === undefined ? '' : ` (exit ${info.code})`;
  return { code: 'unknown', message: tail(text || `${fix.cli} ended without a reply${exit}.`, 500) };
}

function tail(text: string, max: number): string {
  return text.length <= max ? text : text.slice(text.length - max);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/server/adapters`
Expected: 13 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add CLI process runner, error classification and fake CLI"
```

---

### Task 5: Claude adapter

**Files:**
- Create: `src/server/adapters/claude.ts`
- Test: `test/server/adapters/claude.test.ts`

**Interfaces:**
- Consumes: `runJsonl`, `classifyError`, `ProviderAdapter`, `CliOptions`, `DEFAULT_TIMEOUT_MS` from Task 4.
- Produces: `createClaudeAdapter(opts: CliOptions): ProviderAdapter`.

Verified stream (Claude Code 2.1.289, `--output-format stream-json --verbose --include-partial-messages`): every event carries `session_id`; text arrives as `{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"…"}}}`; the run ends with `{"type":"result","subtype":"success","is_error":false,"result":"<full text>"}`. With `--resume X --fork-session`, the events carry the new forked ID.

- [ ] **Step 1: Write the failing tests**

`test/server/adapters/claude.test.ts`:
```ts
import { mkdtempSync } from 'node:fs';
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
    const args = argv.slice(1);
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
    const args = (await fake.record()).argv.slice(1);
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/server/adapters/claude.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the adapter**

`src/server/adapters/claude.ts`:
```ts
import { mkdir } from 'node:fs/promises';
import type { ModelOption } from '../../shared/types.js';
import { classifyError } from './errors.js';
import { runJsonl } from './process.js';
import { DEFAULT_TIMEOUT_MS, type AdapterEvent, type CliOptions, type ProviderAdapter, type SendRequest } from './types.js';

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

const MODELS: ModelOption[] = [
  { id: 'opus', label: 'Opus', efforts: EFFORTS },
  { id: 'sonnet', label: 'Sonnet', efforts: EFFORTS },
  { id: 'haiku', label: 'Haiku', efforts: [] },
];

export function createClaudeAdapter(opts: CliOptions): ProviderAdapter {
  return {
    id: 'claude',
    listModels: async () => MODELS,
    send: (req) => send(opts, req),
  };
}

async function* send(opts: CliOptions, req: SendRequest): AsyncGenerator<AdapterEvent> {
  await mkdir(opts.workdir, { recursive: true });
  const args = [
    ...(opts.binArgs ?? []),
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--system-prompt-file', req.promptPath,
    '--tools', '',
    '--setting-sources', '',
    '--strict-mcp-config',
    '--no-chrome',
    '--model', req.model,
  ];
  if (req.effort) args.push('--effort', req.effort);
  // Fork every turn: a stopped turn lands in a fork we never record.
  if (req.sessionId) args.push('--resume', req.sessionId, '--fork-session');

  let sessionSent = false;
  let noise = '';
  for await (const item of runJsonl({
    bin: opts.bin ?? 'claude',
    args,
    cwd: opts.workdir,
    env: opts.env,
    stdin: req.message,
    signal: req.signal,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  })) {
    if (item.type === 'line') {
      noise += item.text + '\n';
    } else if (item.type === 'json') {
      const ev = item.value;
      if (!sessionSent && typeof ev.session_id === 'string') {
        sessionSent = true;
        yield { type: 'session', sessionId: ev.session_id };
      }
      if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta' && ev.event.delta?.type === 'text_delta') {
        yield { type: 'delta', text: ev.event.delta.text };
      } else if (ev.type === 'result') {
        if (ev.is_error || ev.subtype !== 'success') {
          yield { type: 'error', error: classifyError('claude', { detail: String(ev.result ?? ev.subtype ?? '') }) };
        } else {
          yield { type: 'done', text: String(ev.result ?? '') };
        }
        return;
      }
    } else {
      if (item.info.aborted) return;
      yield { type: 'error', error: classifyError('claude', { ...item.info, detail: noise }) };
      return;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/server/adapters/claude.test.ts`
Expected: 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Claude Code adapter with per-turn session forks"
```

---

### Task 6: Codex adapter

**Files:**
- Create: `src/server/adapters/codex.ts`
- Test: `test/server/adapters/codex.test.ts`

**Interfaces:**
- Consumes: Task 4 exports.
- Produces: `createCodexAdapter(opts: CliOptions & { codexHome?: string }): ProviderAdapter`.

Verified stream (Codex CLI 0.160.1, `exec --json`): `{"type":"thread.started","thread_id":"…"}`, `{"type":"turn.started"}`, `{"type":"item.completed","item":{"type":"agent_message","text":"…"}}`, `{"type":"turn.completed","usage":{…}}`. No text deltas; the whole message arrives in one item. A model switch on resume emits `{"type":"item.completed","item":{"type":"error","message":"This session was recorded with model …"}}` and then succeeds. `codex exec fork <id>` prints a new `thread_id` and keeps the history. `exec fork` rejects `-s`, so the sandbox goes through `-c sandbox_mode="read-only"`. `--ignore-user-config` skips Sam's plugins and `notify` hook while keeping ChatGPT sign-in.

- [ ] **Step 1: Write the failing tests**

`test/server/adapters/codex.test.ts`:
```ts
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
    const args = (await fake.record()).argv.slice(1);
    expect(args[0]).toBe('exec');
    expect(args).not.toContain('fork');
    expect(args).toEqual(expect.arrayContaining(['--json', '--skip-git-repo-check', '--ignore-user-config']));
    expect(args[args.indexOf('-m') + 1]).toBe('gpt-6-luna');
    expect(args).toContain('model_instructions_file="/tmp/my prompt.md"');
    expect(args).toContain('sandbox_mode="read-only"');
    expect(args).toContain('model_reasoning_effort="high"');
    expect(args.at(-1)).toBe('-');
  });

  it('forks from the last session when resuming', async () => {
    const { fake, adapter, req } = setup(OK_RUN);
    await collect(adapter.send(req({ sessionId: 'th-old' })));
    const args = (await fake.record()).argv.slice(1);
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
    expect(events.at(-1)).toEqual({ type: 'done', text: 'First.\n\nSecond.' });
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

  it('lists models from the Codex cache, without review-only models', async () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-home-'));
    writeFileSync(join(home, 'models_cache.json'), JSON.stringify({
      models: [
        { slug: 'gpt-6-luna', display_name: 'GPT-6-Luna', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] },
        { slug: 'codex-auto-review', display_name: 'Codex Auto Review', supported_reasoning_levels: [] },
      ],
    }));
    const { adapter } = setup(OK_RUN, home);
    expect(await adapter.listModels()).toEqual([{ id: 'gpt-6-luna', label: 'GPT-6-Luna', efforts: ['low', 'high'] }]);
  });

  it('falls back to a default model list when the cache is missing', async () => {
    const { adapter } = setup(OK_RUN, '/nonexistent');
    expect((await adapter.listModels())[0].id).toBe('gpt-6-luna');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/server/adapters/codex.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the adapter**

`src/server/adapters/codex.ts`:
```ts
import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ModelOption } from '../../shared/types.js';
import { classifyError } from './errors.js';
import { runJsonl } from './process.js';
import { DEFAULT_TIMEOUT_MS, type AdapterEvent, type CliOptions, type ProviderAdapter, type SendRequest } from './types.js';

const FALLBACK_MODELS: ModelOption[] = [
  { id: 'gpt-6-luna', label: 'GPT-6-Luna', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
];

type CodexOptions = CliOptions & { codexHome?: string };

export function createCodexAdapter(opts: CodexOptions): ProviderAdapter {
  return {
    id: 'codex',
    listModels: () => listModels(opts.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex')),
    send: (req) => send(opts, req),
  };
}

async function listModels(codexHome: string): Promise<ModelOption[]> {
  try {
    const cache = JSON.parse(await readFile(join(codexHome, 'models_cache.json'), 'utf8'));
    const models: any[] = Array.isArray(cache) ? cache : cache.models ?? [];
    const options = models
      .filter((m) => typeof m.slug === 'string' && !m.slug.includes('auto-review'))
      .map((m) => ({
        id: m.slug as string,
        label: (m.display_name as string) ?? m.slug,
        efforts: ((m.supported_reasoning_levels ?? []) as { effort: string }[]).map((l) => l.effort),
      }));
    return options.length ? options : FALLBACK_MODELS;
  } catch {
    return FALLBACK_MODELS;
  }
}

async function* send(opts: CodexOptions, req: SendRequest): AsyncGenerator<AdapterEvent> {
  await mkdir(opts.workdir, { recursive: true });
  const common = [
    '--json',
    '--skip-git-repo-check',
    '--ignore-user-config',
    '-m', req.model,
    '-c', `model_instructions_file=${JSON.stringify(req.promptPath)}`,
    '-c', 'sandbox_mode="read-only"',
  ];
  if (req.effort) common.push('-c', `model_reasoning_effort=${JSON.stringify(req.effort)}`);
  // Fork every turn: a stopped turn lands in a fork we never record.
  const head = req.sessionId ? ['exec', 'fork', req.sessionId] : ['exec'];
  const args = [...(opts.binArgs ?? []), ...head, ...common, '-'];

  const texts: string[] = [];
  let lastError = '';
  let noise = '';
  for await (const item of runJsonl({
    bin: opts.bin ?? 'codex',
    args,
    cwd: opts.workdir,
    env: opts.env,
    stdin: req.message,
    signal: req.signal,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  })) {
    if (item.type === 'line') {
      noise += item.text + '\n';
    } else if (item.type === 'json') {
      const ev = item.value;
      if (ev.type === 'thread.started' && typeof ev.thread_id === 'string') {
        yield { type: 'session', sessionId: ev.thread_id };
      } else if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') {
        const text = String(ev.item.text ?? '');
        yield { type: 'delta', text: texts.length ? `\n\n${text}` : text };
        texts.push(text);
      } else if (ev.type === 'item.completed' && ev.item?.type === 'error') {
        yield { type: 'warning', message: String(ev.item.message ?? '') };
      } else if (ev.type === 'error') {
        lastError = String(ev.message ?? '');
      } else if (ev.type === 'turn.completed') {
        yield { type: 'done', text: texts.join('\n\n') };
        return;
      } else if (ev.type === 'turn.failed') {
        const detail = [lastError, ev.error?.message].filter(Boolean).join('\n');
        yield { type: 'error', error: classifyError('codex', { detail }) };
        return;
      }
    } else {
      if (item.info.aborted) return;
      yield { type: 'error', error: classifyError('codex', { ...item.info, detail: [lastError, noise].join('\n') }) };
      return;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/server/adapters/codex.test.ts`
Expected: 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Codex CLI adapter with per-turn session forks"
```

---

### Task 7: Antigravity (Gemini) adapter

**Files:**
- Create: `src/server/adapters/gemini.ts`
- Test: `test/server/adapters/gemini.test.ts`

**Interfaces:**
- Consumes: Task 4 exports.
- Produces: `createGeminiAdapter(opts: CliOptions): ProviderAdapter`; `agentName(promptHash: string): string`.

Verified stream (Antigravity CLI 1.2.17, `--output-format stream-json`): first line `{"event":"init","conversation_id":"…"}`; text in `{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"…"}}`; final `{"event":"result","result":{"status":"SUCCESS","response":"…"}}`. A custom agent in `<cwd>/.agents/agents/<name>.md` with `tools: []` replaces most of the coding prompt (input dropped from 11,877 to 2,072 tokens) and the model follows its body. `--conversation <id>` resumes with a different `--model`. A killed turn does not persist, so no fork is needed. `-p` must be last or attached (`-p=<prompt>`); a separate `-p` swallows the next flag.

- [ ] **Step 1: Write the failing tests**

`test/server/adapters/gemini.test.ts`:
```ts
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

  it('writes a tool-less agent carrying the prompt snapshot', async () => {
    const { adapter, req, workdir } = setup(OK_RUN);
    await collect(adapter.send(req()));
    const agent = await readFile(join(workdir, '.agents', 'agents', 'consensus-abc123.md'), 'utf8');
    expect(agent).toBe('---\nname: consensus-abc123\ndescription: Consensus prose participant.\ntools: []\n---\nYou are an experienced editor.\n');
    expect(agentName('abc123')).toBe('consensus-abc123');
  });

  it('runs the agent with model and stream output, resuming by conversation', async () => {
    const { fake, adapter, req } = setup(OK_RUN);
    await collect(adapter.send(req({ sessionId: 'conv-0' })));
    const args = (await fake.record()).argv.slice(1);
    expect(args[args.indexOf('--agent') + 1]).toBe('consensus-abc123');
    expect(args[args.indexOf('--model') + 1]).toBe('gemini-3.1-pro-high');
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(args[args.indexOf('--conversation') + 1]).toBe('conv-0');
  });

  it('attaches the prompt to -p= so leading dashes survive', async () => {
    const { fake, adapter, req } = setup(OK_RUN);
    await collect(adapter.send(req({ message: '--model x\nline two' })));
    const args = (await fake.record()).argv.slice(1);
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

  it('lists Gemini models from agy models output', async () => {
    const { adapter } = setup({
      lines: ['Fetching available models...', 'gemini-3.1-pro-high\tGemini 3.1 Pro (High)', 'claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)', 'gemini-3.8-flash-low\tGemini 3.8 Flash (Low)'],
    });
    expect(await adapter.listModels()).toEqual([
      { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)', efforts: [] },
      { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)', efforts: [] },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/server/adapters/gemini.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the adapter**

`src/server/adapters/gemini.ts`:
```ts
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelOption } from '../../shared/types.js';
import { classifyError } from './errors.js';
import { runJsonl } from './process.js';
import { DEFAULT_TIMEOUT_MS, type AdapterEvent, type CliOptions, type ProviderAdapter, type SendRequest } from './types.js';

const FALLBACK_MODELS: ModelOption[] = [
  { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)', efforts: [] },
  { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)', efforts: [] },
];
const MODELS_TTL_MS = 10 * 60 * 1000;

export function agentName(promptHash: string): string {
  return `consensus-${promptHash}`;
}

export function createGeminiAdapter(opts: CliOptions): ProviderAdapter {
  let cache: { at: number; models: ModelOption[] } | undefined;
  return {
    id: 'gemini',
    async listModels() {
      if (cache && Date.now() - cache.at < MODELS_TTL_MS) return cache.models;
      const models = await listModels(opts);
      cache = { at: Date.now(), models };
      return models;
    },
    send: (req) => send(opts, req),
  };
}

async function listModels(opts: CliOptions): Promise<ModelOption[]> {
  await mkdir(opts.workdir, { recursive: true });
  const models: ModelOption[] = [];
  for await (const item of runJsonl({
    bin: opts.bin ?? 'agy',
    args: [...(opts.binArgs ?? []), 'models'],
    cwd: opts.workdir,
    env: opts.env,
    signal: new AbortController().signal,
    timeoutMs: 30_000,
  })) {
    if (item.type !== 'line') continue;
    const m = /^(gemini-\S+)\t(.+)$/.exec(item.text);
    if (m) models.push({ id: m[1], label: m[2].trim(), efforts: [] });
  }
  return models.length ? models : FALLBACK_MODELS;
}

/** Antigravity has no system-prompt flag; a custom agent's body becomes its system prompt. */
async function ensureAgent(workdir: string, req: SendRequest): Promise<string> {
  const name = agentName(req.promptHash);
  const dir = join(workdir, '.agents', 'agents');
  const file = join(dir, `${name}.md`);
  try {
    await access(file);
  } catch {
    await mkdir(dir, { recursive: true });
    const body = await readFile(req.promptPath, 'utf8');
    await writeFile(file, `---\nname: ${name}\ndescription: Consensus prose participant.\ntools: []\n---\n${body}`);
  }
  return name;
}

async function* send(opts: CliOptions, req: SendRequest): AsyncGenerator<AdapterEvent> {
  await mkdir(opts.workdir, { recursive: true });
  const name = await ensureAgent(opts.workdir, req);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const args = [
    ...(opts.binArgs ?? []),
    '--agent', name,
    '--model', req.model,
    '--output-format', 'stream-json',
    '--print-timeout', `${Math.ceil(timeoutMs / 1000)}s`,
  ];
  // Antigravity drops a cancelled turn itself, so resuming in place is safe.
  if (req.sessionId) args.push('--conversation', req.sessionId);
  args.push(`-p=${req.message}`);

  let sessionSent = false;
  let noise = '';
  for await (const item of runJsonl({
    bin: opts.bin ?? 'agy',
    args,
    cwd: opts.workdir,
    env: opts.env,
    signal: req.signal,
    timeoutMs: timeoutMs + 30_000,
  })) {
    if (item.type === 'line') {
      noise += item.text + '\n';
    } else if (item.type === 'json') {
      const ev = item.value;
      if (!sessionSent && ev.event === 'init' && typeof ev.conversation_id === 'string') {
        sessionSent = true;
        yield { type: 'session', sessionId: ev.conversation_id };
      } else if (ev.event === 'step_update' && ev.step_update?.step_type === 'agent_response' && ev.step_update.text_delta) {
        yield { type: 'delta', text: String(ev.step_update.text_delta) };
      } else if (ev.event === 'result') {
        const r = ev.result ?? {};
        if (r.status === 'SUCCESS') {
          yield { type: 'done', text: String(r.response ?? '').trimEnd() };
        } else {
          const detail = [r.error, r.status, noise].filter(Boolean).join('\n');
          yield { type: 'error', error: classifyError('gemini', { detail }) };
        }
        return;
      }
    } else {
      if (item.info.aborted) return;
      yield { type: 'error', error: classifyError('gemini', { ...item.info, detail: noise }) };
      return;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/server/adapters/gemini.test.ts`
Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Antigravity CLI adapter using a tool-less custom agent"
```

---

### Task 8: Event hub and router

**Files:**
- Create: `src/server/hub.ts`, `src/server/router.ts`
- Create: `test/helpers/queue.ts`
- Test: `test/server/router.test.ts`

**Interfaces:**
- Consumes: `ThreadStore` (Task 3), `Paths`, `snapshotPrompt`, `snapshotPath` (Task 2), `ProviderAdapter`, `AdapterEvent` (Task 4), `modelLabel` (Task 1).
- Produces:
  - `class EventHub { subscribe(threadId, fn: (ev: ThreadEvent) => void): () => void; emit(threadId, ev: ThreadEvent): void }`
  - `composeOutgoing(text: string, quotes: Quote[]): string`
  - `class RouterError extends Error { code: 'not_found' | 'busy' | 'invalid' }`
  - `type SendInput = { to: string; text: string; quotes?: Quote[]; origin?: Origin }`
  - `class Router` with:
    - `getThread(id): Promise<Thread | undefined>`
    - `createThread(): Promise<Thread>`
    - `addParticipant(threadId, { provider, model, effort? }): Promise<Participant>`
    - `changeModel(threadId, participantId, { model, effort? }): Promise<void>`
    - `send(threadId, input: SendInput): Promise<{ userMessageId: string; replyMessageId: string; done: Promise<void> }>`
    - `stop(threadId, replyId): boolean`
    - `retry(threadId, replyId): Promise<{ userMessageId; replyMessageId; done }>`
  - `send` returning a plain function result (not tied to HTTP) is the hook the spec reserves for automatic looped routing.

- [ ] **Step 1: Write the queue helper**

`test/helpers/queue.ts`:
```ts
/** An async iterable the test feeds by hand. */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: ((r: IteratorResult<T>) => void)[] = [];
  private closed = false;

  push(item: T) {
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.items.push(item);
  }

  end() {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as T, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift()!, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as T, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}
```

- [ ] **Step 2: Write the failing tests**

`test/server/router.test.ts`:
```ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AdapterEvent, ProviderAdapter, SendRequest } from '../../src/server/adapters/types.js';
import { EventHub } from '../../src/server/hub.js';
import { makePaths } from '../../src/server/paths.js';
import { composeOutgoing, Router, RouterError } from '../../src/server/router.js';
import { ThreadStore } from '../../src/server/store.js';
import type { ProviderId, ThreadEvent } from '../../src/shared/types.js';
import { AsyncQueue } from '../helpers/queue.js';

function controllable(id: ProviderId) {
  const requests: SendRequest[] = [];
  const queues: AsyncQueue<AdapterEvent>[] = [];
  const adapter: ProviderAdapter = {
    id,
    listModels: async () => [],
    send(req) {
      requests.push(req);
      const q = new AsyncQueue<AdapterEvent>();
      req.signal.addEventListener('abort', () => q.end());
      queues.push(q);
      return q;
    },
  };
  return { adapter, requests, last: () => queues.at(-1)! };
}

let claude: ReturnType<typeof controllable>;
let codex: ReturnType<typeof controllable>;
let router: Router;
let store: ThreadStore;
let hub: EventHub;

beforeEach(async () => {
  const paths = makePaths(await mkdtemp(join(tmpdir(), 'consensus-')));
  claude = controllable('claude');
  codex = controllable('codex');
  store = new ThreadStore(paths.threads);
  hub = new EventHub();
  router = new Router({
    store, hub, paths,
    adapters: { claude: claude.adapter, codex: codex.adapter, gemini: controllable('gemini').adapter },
  });
});

async function threadWithTwo() {
  const t = await router.createThread();
  const a = await router.addParticipant(t.id, { provider: 'claude', model: 'opus', effort: 'high' });
  const b = await router.addParticipant(t.id, { provider: 'codex', model: 'gpt-6-luna', effort: 'high' });
  return { t, a, b };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('composeOutgoing', () => {
  it('returns the text alone when nothing is quoted', () => {
    expect(composeOutgoing('Tighten it', [])).toBe('Tighten it');
  });

  it('wraps each quote without naming its source', () => {
    expect(composeOutgoing('Critique these', [{ messageId: 'm1', text: 'Option A' }, { messageId: 'm2', text: 'Option B' }])).toBe(
      'Feedback from another reviewer:\n<quoted>\nOption A\n</quoted>\n\n' +
        'Feedback from another reviewer:\n<quoted>\nOption B\n</quoted>\n\n' +
        'Critique these',
    );
  });
});

describe('Router', () => {
  it('sends only to the chosen participant with its model and effort', async () => {
    const { t, b } = await threadWithTwo();
    await router.send(t.id, { to: b.id, text: 'Critique', quotes: [{ messageId: 'x', text: 'Draft' }] });
    expect(claude.requests).toHaveLength(0);
    expect(codex.requests).toHaveLength(1);
    expect(codex.requests[0]).toMatchObject({
      model: 'gpt-6-luna', effort: 'high', sessionId: undefined,
      message: composeOutgoing('Critique', [{ messageId: 'x', text: 'Draft' }]),
    });
    expect(codex.requests[0].promptPath).toContain(b.promptHash);
  });

  it('streams deltas through the hub and records the finished reply', async () => {
    const { t, a } = await threadWithTwo();
    const events: ThreadEvent[] = [];
    hub.subscribe(t.id, (e) => events.push(e));
    const { replyMessageId, done } = await router.send(t.id, { to: a.id, text: 'Draft a headline' });
    const q = claude.last();
    q.push({ type: 'session', sessionId: 's1' });
    q.push({ type: 'delta', text: 'Kitchens ' });
    q.push({ type: 'delta', text: 'that run themselves' });
    q.push({ type: 'done', text: 'Kitchens that run themselves' });
    q.end();
    await done;
    expect(events.filter((e) => e.type === 'delta').map((e) => e.type === 'delta' && e.text)).toEqual(['Kitchens ', 'that run themselves']);
    const thread = (await router.getThread(t.id))!;
    const reply = thread.messages.find((m) => m.id === replyMessageId)!;
    expect(reply).toMatchObject({ kind: 'reply', status: 'done', text: 'Kitchens that run themselves', model: 'opus' });
    expect(thread.participants.find((p) => p.id === a.id)!.sessionId).toBe('s1');
    expect((await store.get(t.id))!.messages.find((m) => m.id === replyMessageId)).toMatchObject({ status: 'done' });
  });

  it('resumes from the last completed session', async () => {
    const { t, a } = await threadWithTwo();
    const first = await router.send(t.id, { to: a.id, text: 'One' });
    claude.last().push({ type: 'session', sessionId: 's1' });
    claude.last().push({ type: 'done', text: 'ok' });
    claude.last().end();
    await first.done;
    await router.send(t.id, { to: a.id, text: 'Two' });
    expect(claude.requests[1].sessionId).toBe('s1');
  });

  it('rejects a second send to a busy participant', async () => {
    const { t, a, b } = await threadWithTwo();
    await router.send(t.id, { to: a.id, text: 'One' });
    await expect(router.send(t.id, { to: a.id, text: 'Two' })).rejects.toMatchObject({ code: 'busy', message: 'That participant is still replying.' });
    await expect(router.send(t.id, { to: b.id, text: 'Other' })).resolves.toBeDefined();
  });

  it('stops a reply, keeps its text and leaves the session unchanged', async () => {
    const { t, a } = await threadWithTwo();
    const { replyMessageId, done } = await router.send(t.id, { to: a.id, text: 'Long essay' });
    claude.last().push({ type: 'session', sessionId: 'fork-discarded' });
    claude.last().push({ type: 'delta', text: 'Partial' });
    await flush();
    expect(router.stop(t.id, replyMessageId)).toBe(true);
    await done;
    const thread = (await router.getThread(t.id))!;
    expect(thread.messages.find((m) => m.id === replyMessageId)).toMatchObject({ status: 'stopped', text: 'Partial' });
    expect(thread.participants.find((p) => p.id === a.id)!.sessionId).toBeUndefined();
    await expect(router.send(t.id, { to: a.id, text: 'Again' })).resolves.toBeDefined();
  });

  it('ignores stop after a reply finished', async () => {
    const { t, a } = await threadWithTwo();
    const { replyMessageId, done } = await router.send(t.id, { to: a.id, text: 'Hi' });
    claude.last().push({ type: 'done', text: 'Hello' });
    claude.last().end();
    await done;
    expect(router.stop(t.id, replyMessageId)).toBe(false);
    expect((await router.getThread(t.id))!.messages.find((m) => m.id === replyMessageId)).toMatchObject({ status: 'done' });
  });

  it('records adapter errors without advancing the session', async () => {
    const { t, a } = await threadWithTwo();
    const { replyMessageId, done } = await router.send(t.id, { to: a.id, text: 'Hi' });
    claude.last().push({ type: 'session', sessionId: 'never-kept' });
    claude.last().push({ type: 'error', error: { code: 'not_logged_in', message: 'Claude Code is not signed in.', fix: 'claude, then run /login' } });
    claude.last().end();
    await done;
    const thread = (await router.getThread(t.id))!;
    expect(thread.messages.find((m) => m.id === replyMessageId)).toMatchObject({ status: 'error', error: { code: 'not_logged_in' } });
    expect(thread.participants[0].sessionId).toBeUndefined();
  });

  it('retries a failed reply with the same message', async () => {
    const { t, a } = await threadWithTwo();
    const first = await router.send(t.id, { to: a.id, text: 'Hi', quotes: [{ messageId: 'q', text: 'Quoted' }] });
    claude.last().push({ type: 'error', error: { code: 'unknown', message: 'x' } });
    claude.last().end();
    await first.done;
    await router.retry(t.id, first.replyMessageId);
    expect(claude.requests[1].message).toBe(claude.requests[0].message);
  });

  it('changes a participant model and marks the switch in the timeline', async () => {
    const { t, a } = await threadWithTwo();
    await router.changeModel(t.id, a.id, { model: 'sonnet', effort: 'medium' });
    const thread = (await router.getThread(t.id))!;
    expect(thread.messages.at(-1)).toMatchObject({ kind: 'model_change', participant: a.id, from: 'opus high', to: 'sonnet medium' });
    await router.send(t.id, { to: a.id, text: 'Go' });
    expect(claude.requests[0]).toMatchObject({ model: 'sonnet', effort: 'medium' });
  });

  it('refuses a model change while the participant is replying', async () => {
    const { t, a } = await threadWithTwo();
    await router.send(t.id, { to: a.id, text: 'Go' });
    await expect(router.changeModel(t.id, a.id, { model: 'sonnet' })).rejects.toMatchObject({ code: 'busy' });
  });

  it('titles the thread from the first message', async () => {
    const { t, a } = await threadWithTwo();
    await router.send(t.id, { to: a.id, text: 'Homepage hero for ops leaders\nMore detail here' });
    expect((await router.getThread(t.id))!.title).toBe('Homepage hero for ops leaders');
  });

  it('rejects empty messages and unknown participants', async () => {
    const { t, a } = await threadWithTwo();
    await expect(router.send(t.id, { to: a.id, text: '   ' })).rejects.toBeInstanceOf(RouterError);
    await expect(router.send(t.id, { to: 'nobody', text: 'Hi' })).rejects.toMatchObject({ code: 'not_found' });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/server/router.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement the hub and router**

`src/server/hub.ts`:
```ts
import type { ThreadEvent } from '../shared/types.js';

type Listener = (ev: ThreadEvent) => void;

export class EventHub {
  private listeners = new Map<string, Set<Listener>>();

  subscribe(threadId: string, fn: Listener): () => void {
    let set = this.listeners.get(threadId);
    if (!set) this.listeners.set(threadId, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit(threadId: string, ev: ThreadEvent): void {
    for (const fn of this.listeners.get(threadId) ?? []) fn(ev);
  }
}
```

`src/server/router.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { modelLabel } from '../shared/labels.js';
import type { Origin, Participant, ProviderId, Quote, ReplyMessage, Thread, UserMessage } from '../shared/types.js';
import type { ProviderAdapter } from './adapters/types.js';
import type { EventHub } from './hub.js';
import type { Paths } from './paths.js';
import { snapshotPath, snapshotPrompt } from './prompt.js';
import type { ThreadStore } from './store.js';

export class RouterError extends Error {
  constructor(public code: 'not_found' | 'busy' | 'invalid', message: string) {
    super(message);
  }
}

export type SendInput = { to: string; text: string; quotes?: Quote[]; origin?: Origin };
export type SendResult = { userMessageId: string; replyMessageId: string; done: Promise<void> };

type Deps = {
  store: ThreadStore;
  hub: EventHub;
  paths: Paths;
  adapters: Record<ProviderId, ProviderAdapter>;
};

const UNTITLED = 'Untitled thread';

export function composeOutgoing(text: string, quotes: Quote[]): string {
  if (!quotes.length) return text;
  const blocks = quotes.map((q) => `Feedback from another reviewer:\n<quoted>\n${q.text}\n</quoted>`);
  return [...blocks, text].join('\n\n');
}

export class Router {
  private threads = new Map<string, Thread>();
  private saves = new Map<string, Promise<void>>();
  private inflight = new Map<string, AbortController>();
  private busy = new Set<string>();

  constructor(private deps: Deps) {}

  async getThread(id: string): Promise<Thread | undefined> {
    const cached = this.threads.get(id);
    if (cached) return cached;
    const loaded = await this.deps.store.get(id);
    if (loaded) this.threads.set(id, loaded);
    return loaded;
  }

  async createThread(): Promise<Thread> {
    const thread = await this.deps.store.create(UNTITLED);
    this.threads.set(thread.id, thread);
    return thread;
  }

  async addParticipant(threadId: string, input: { provider: ProviderId; model: string; effort?: string }): Promise<Participant> {
    const thread = await this.mustThread(threadId);
    const participant: Participant = {
      id: randomUUID(),
      provider: input.provider,
      model: input.model,
      effort: input.effort || undefined,
      promptHash: await snapshotPrompt(this.deps.paths),
      createdAt: new Date().toISOString(),
    };
    thread.participants.push(participant);
    await this.commit(thread);
    return participant;
  }

  async changeModel(threadId: string, participantId: string, input: { model: string; effort?: string }): Promise<void> {
    const thread = await this.mustThread(threadId);
    const p = this.mustParticipant(thread, participantId);
    if (this.busy.has(p.id)) throw new RouterError('busy', 'That participant is still replying.');
    const from = modelLabel(p.model, p.effort);
    p.model = input.model;
    p.effort = input.effort || undefined;
    thread.messages.push({
      id: randomUUID(), kind: 'model_change', participant: p.id,
      from, to: modelLabel(p.model, p.effort), sentAt: new Date().toISOString(),
    });
    await this.commit(thread);
  }

  async send(threadId: string, input: SendInput): Promise<SendResult> {
    const thread = await this.mustThread(threadId);
    const p = this.mustParticipant(thread, input.to);
    const quotes = input.quotes ?? [];
    if (!input.text.trim() && !quotes.length) throw new RouterError('invalid', 'Write a message or forward a quote.');
    if (this.busy.has(p.id)) throw new RouterError('busy', 'That participant is still replying.');

    const now = new Date().toISOString();
    const user: UserMessage = { id: randomUUID(), kind: 'user', to: p.id, text: input.text, quotes, sentAt: now, origin: input.origin };
    const reply: ReplyMessage = {
      id: randomUUID(), kind: 'reply', from: p.id, text: '', model: p.model, effort: p.effort,
      status: 'streaming', sentAt: now, origin: input.origin,
    };
    thread.messages.push(user, reply);
    if (thread.title === UNTITLED) thread.title = deriveTitle(input.text, quotes);

    const controller = new AbortController();
    this.busy.add(p.id);
    this.inflight.set(reply.id, controller);
    await this.commit(thread);
    const done = this.run(thread, p, reply, composeOutgoing(input.text, quotes), controller);
    return { userMessageId: user.id, replyMessageId: reply.id, done };
  }

  stop(threadId: string, replyId: string): boolean {
    const controller = this.inflight.get(replyId);
    if (!controller || !this.threads.get(threadId)) return false;
    controller.abort();
    return true;
  }

  async retry(threadId: string, replyId: string): Promise<SendResult> {
    const thread = await this.mustThread(threadId);
    const idx = thread.messages.findIndex((m) => m.id === replyId && m.kind === 'reply');
    if (idx < 0) throw new RouterError('not_found', 'That reply no longer exists.');
    const reply = thread.messages[idx] as ReplyMessage;
    const user = thread.messages
      .slice(0, idx)
      .reverse()
      .find((m): m is UserMessage => m.kind === 'user' && m.to === reply.from);
    if (!user) throw new RouterError('not_found', 'Could not find the message to retry.');
    return this.send(threadId, { to: user.to, text: user.text, quotes: user.quotes });
  }

  private async run(thread: Thread, p: Participant, reply: ReplyMessage, message: string, controller: AbortController): Promise<void> {
    const adapter = this.deps.adapters[p.provider];
    let pendingSession: string | undefined;
    let finished = false;
    try {
      for await (const ev of adapter.send({
        sessionId: p.sessionId, message, model: p.model, effort: p.effort,
        promptHash: p.promptHash, promptPath: snapshotPath(this.deps.paths, p.promptHash),
        signal: controller.signal,
      })) {
        if (ev.type === 'session') {
          pendingSession = ev.sessionId;
        } else if (ev.type === 'delta') {
          reply.text += ev.text;
          this.deps.hub.emit(thread.id, { type: 'delta', messageId: reply.id, text: ev.text });
        } else if (ev.type === 'warning') {
          console.warn(`consensus: ${p.provider}: ${ev.message}`);
        } else if (ev.type === 'done') {
          reply.text = ev.text;
          reply.status = 'done';
          // Only a finished turn advances memory; stopped or failed forks are dropped.
          if (pendingSession) p.sessionId = pendingSession;
          finished = true;
        } else if (ev.type === 'error') {
          reply.status = 'error';
          reply.error = ev.error;
          finished = true;
        }
      }
    } catch (e) {
      reply.status = 'error';
      reply.error = { code: 'unknown', message: e instanceof Error ? e.message : String(e) };
      finished = true;
    }
    if (!finished) {
      if (controller.signal.aborted) {
        reply.status = 'stopped';
      } else {
        reply.status = 'error';
        reply.error = { code: 'unknown', message: 'The CLI ended without a reply.' };
      }
    }
    this.busy.delete(p.id);
    this.inflight.delete(reply.id);
    await this.commit(thread);
  }

  private async commit(thread: Thread): Promise<void> {
    const prev = this.saves.get(thread.id) ?? Promise.resolve();
    thread.updatedAt = new Date().toISOString();
    const next = prev.then(() => this.deps.store.save(thread));
    this.saves.set(thread.id, next.catch((e) => console.error('consensus: save failed', e)));
    this.deps.hub.emit(thread.id, { type: 'thread', thread });
    await next;
  }

  private async mustThread(id: string): Promise<Thread> {
    const thread = await this.getThread(id);
    if (!thread) throw new RouterError('not_found', 'That thread does not exist.');
    return thread;
  }

  private mustParticipant(thread: Thread, id: string): Participant {
    const p = thread.participants.find((x) => x.id === id);
    if (!p) throw new RouterError('not_found', 'That participant does not exist.');
    return p;
  }
}

function deriveTitle(text: string, quotes: Quote[]): string {
  const source = text.trim() || quotes[0]?.text.trim() || UNTITLED;
  const line = source.split('\n')[0].trim();
  return line.length > 60 ? `${line.slice(0, 57)}...` : line;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/server/router.test.ts`
Expected: 14 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add router with per-participant routing, stop, retry and model change"
```

---

### Task 9: HTTP API, SSE, adapter registry, `consensus` command

**Files:**
- Create: `src/server/http.ts`, `src/server/adapters/index.ts`, `src/server/cli.ts`
- Test: `test/server/http.test.ts`

**Interfaces:**
- Consumes: `Router`, `RouterError` (Task 8), `EventHub` (Task 8), `ThreadStore` (Task 3), `readPrompt`, `writePrompt`, `loadSettings`, `saveSettings`, `makePaths` (Task 2), adapters (Tasks 5–7).
- Produces:
  - `createAdapters(paths: Paths): Record<ProviderId, ProviderAdapter>`
  - `createConsensusServer(deps: { router; store; hub; paths; adapters; webDir?: string }): http.Server`
  - HTTP API (all JSON; errors are `{ "error": string }`):

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/threads` | | `ThreadSummary[]` |
| POST | `/api/threads` | `{}` | `Thread` |
| GET | `/api/threads/:id` | | `Thread` |
| GET | `/api/threads/:id/events` | | SSE of `ThreadEvent`, starting with `{type:'thread'}` |
| POST | `/api/threads/:id/participants` | `{provider, model, effort?}` | `Participant` |
| PATCH | `/api/threads/:id/participants/:pid` | `{model, effort?}` | 204 |
| POST | `/api/threads/:id/messages` | `{to, text, quotes?}` | 202 `{userMessageId, replyMessageId}` |
| POST | `/api/threads/:id/replies/:rid/stop` | | 204, or 404 when not running |
| POST | `/api/threads/:id/replies/:rid/retry` | | 202 `{userMessageId, replyMessageId}` |
| GET | `/api/models` | | `Record<ProviderId, ModelOption[]>` |
| GET | `/api/settings` | | `{prompt: string, settings: Settings}` |
| PUT | `/api/settings` | `{prompt?, settings?}` | `{prompt, settings}` |

`RouterError` codes map to 404 (`not_found`), 409 (`busy`), 400 (`invalid`).

- [ ] **Step 1: Write the failing tests**

`test/server/http.test.ts`:
```ts
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AdapterEvent, ProviderAdapter, SendRequest } from '../../src/server/adapters/types.js';
import { createConsensusServer } from '../../src/server/http.js';
import { EventHub } from '../../src/server/hub.js';
import { makePaths } from '../../src/server/paths.js';
import { Router } from '../../src/server/router.js';
import { ThreadStore } from '../../src/server/store.js';
import type { ProviderId, Thread, ThreadEvent } from '../../src/shared/types.js';
import { AsyncQueue } from '../helpers/queue.js';

let server: Server;
let base: string;
let queues: AsyncQueue<AdapterEvent>[];
let webDir: string;

const fakeAdapter = (id: ProviderId): ProviderAdapter => ({
  id,
  listModels: async () => [{ id: `${id}-model`, label: 'M', efforts: [] }],
  send(req: SendRequest) {
    const q = new AsyncQueue<AdapterEvent>();
    req.signal.addEventListener('abort', () => q.end());
    queues.push(q);
    return q;
  },
});

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'consensus-'));
  const paths = makePaths(home);
  webDir = join(home, 'web');
  await mkdir(webDir);
  await writeFile(join(webDir, 'index.html'), '<!doctype html><title>Consensus</title>');
  queues = [];
  const store = new ThreadStore(paths.threads);
  const hub = new EventHub();
  const adapters = { claude: fakeAdapter('claude'), codex: fakeAdapter('codex'), gemini: fakeAdapter('gemini') };
  const router = new Router({ store, hub, paths, adapters });
  server = createConsensusServer({ router, store, hub, paths, adapters, webDir });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }));

const api = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
};

async function readEvents(path: string, until: (ev: ThreadEvent) => boolean): Promise<ThreadEvent[]> {
  const res = await fetch(base + path);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: ThreadEvent[] = [];
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (!chunk.startsWith('data: ')) continue;
      const ev = JSON.parse(chunk.slice(6)) as ThreadEvent;
      events.push(ev);
      if (until(ev)) {
        await reader.cancel();
        return events;
      }
    }
  }
  return events;
}

describe('HTTP API', () => {
  it('creates a thread, adds a participant, sends and streams', async () => {
    const thread = (await api('POST', '/api/threads', {})).body as Thread;
    const p = (await api('POST', `/api/threads/${thread.id}/participants`, { provider: 'claude', model: 'opus', effort: 'high' })).body;
    const listening = readEvents(`/api/threads/${thread.id}/events`, (ev) => ev.type === 'delta');
    await new Promise((r) => setTimeout(r, 50));
    const sent = await api('POST', `/api/threads/${thread.id}/messages`, { to: p.id, text: 'Draft', quotes: [] });
    expect(sent.status).toBe(202);
    queues[0].push({ type: 'delta', text: 'Kitchens' });
    const events = await listening;
    expect(events[0].type).toBe('thread');
    expect(events.at(-1)).toEqual({ type: 'delta', messageId: sent.body.replyMessageId, text: 'Kitchens' });
  });

  it('returns 409 when the participant is busy and 204 on stop', async () => {
    const thread = (await api('POST', '/api/threads', {})).body as Thread;
    const p = (await api('POST', `/api/threads/${thread.id}/participants`, { provider: 'codex', model: 'gpt-6-luna' })).body;
    const first = await api('POST', `/api/threads/${thread.id}/messages`, { to: p.id, text: 'One' });
    const second = await api('POST', `/api/threads/${thread.id}/messages`, { to: p.id, text: 'Two' });
    expect(second).toEqual({ status: 409, body: { error: 'That participant is still replying.' } });
    const stop = await api('POST', `/api/threads/${thread.id}/replies/${first.body.replyMessageId}/stop`);
    expect(stop.status).toBe(204);
  });

  it('returns 404 for an unknown thread and 400 for a bad provider', async () => {
    expect((await api('GET', '/api/threads/does-not-exist')).status).toBe(404);
    const thread = (await api('POST', '/api/threads', {})).body as Thread;
    expect((await api('POST', `/api/threads/${thread.id}/participants`, { provider: 'grok', model: 'x' })).status).toBe(400);
  });

  it('lists threads, models and settings, and saves the prompt', async () => {
    await api('POST', '/api/threads', {});
    expect((await api('GET', '/api/threads')).body).toHaveLength(1);
    expect((await api('GET', '/api/models')).body.codex).toEqual([{ id: 'codex-model', label: 'M', efforts: [] }]);
    const saved = await api('PUT', '/api/settings', { prompt: 'Be brief.' });
    expect(saved.body.prompt).toBe('Be brief.');
    expect((await api('GET', '/api/settings')).body.settings.defaults.claude.model).toBe('opus');
  });

  it('serves the web app and refuses paths outside it', async () => {
    const index = await fetch(base + '/some/client/route');
    expect(await index.text()).toContain('<title>Consensus</title>');
    const status = await new Promise<number>((resolve) => {
      const port = new URL(base).port;
      request({ host: '127.0.0.1', port, path: '/..%2f..%2fpackage.json' }, (res) => resolve(res.statusCode!)).end();
    });
    expect(status).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/server/http.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the adapter registry**

`src/server/adapters/index.ts`:
```ts
import type { ProviderId } from '../../shared/types.js';
import type { Paths } from '../paths.js';
import { createClaudeAdapter } from './claude.js';
import { createCodexAdapter } from './codex.js';
import { createGeminiAdapter } from './gemini.js';
import type { ProviderAdapter } from './types.js';

export function createAdapters(paths: Paths): Record<ProviderId, ProviderAdapter> {
  return {
    claude: createClaudeAdapter({ workdir: paths.workdir('claude'), bin: process.env.CONSENSUS_CLAUDE_BIN }),
    codex: createCodexAdapter({ workdir: paths.workdir('codex'), bin: process.env.CONSENSUS_CODEX_BIN }),
    gemini: createGeminiAdapter({ workdir: paths.workdir('gemini'), bin: process.env.CONSENSUS_AGY_BIN }),
  };
}
```

- [ ] **Step 4: Implement the HTTP server**

`src/server/http.ts`:
```ts
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { PROVIDER_IDS, type ProviderId, type Settings, type ThreadEvent } from '../shared/types.js';
import type { ProviderAdapter } from './adapters/types.js';
import type { EventHub } from './hub.js';
import type { Paths } from './paths.js';
import { readPrompt, writePrompt } from './prompt.js';
import { RouterError, type Router } from './router.js';
import { loadSettings, saveSettings } from './settings.js';
import type { ThreadStore } from './store.js';

type Deps = {
  router: Router;
  store: ThreadStore;
  hub: EventHub;
  paths: Paths;
  adapters: Record<ProviderId, ProviderAdapter>;
  webDir?: string;
};

type Handler = (req: IncomingMessage, res: ServerResponse, params: string[]) => Promise<void>;

const ID = '([\\w-]+)';
const MAX_BODY = 5 * 1024 * 1024;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};

export function createConsensusServer(deps: Deps): Server {
  const { router, store, hub, paths, adapters } = deps;

  const routes: [string, RegExp, Handler][] = [
    ['GET', /^\/api\/threads$/, async (_q, res) => json(res, 200, await store.list())],
    ['POST', /^\/api\/threads$/, async (_q, res) => json(res, 200, await router.createThread())],
    ['GET', re(`/api/threads/${ID}`), async (_q, res, [id]) => {
      const thread = await router.getThread(id);
      if (!thread) throw new RouterError('not_found', 'That thread does not exist.');
      json(res, 200, thread);
    }],
    ['GET', re(`/api/threads/${ID}/events`), async (req, res, [id]) => {
      const thread = await router.getThread(id);
      if (!thread) throw new RouterError('not_found', 'That thread does not exist.');
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const write = (ev: ThreadEvent) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
      write({ type: 'thread', thread });
      const unsubscribe = hub.subscribe(id, write);
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
      req.on('close', () => {
        unsubscribe();
        clearInterval(heartbeat);
      });
    }],
    ['POST', re(`/api/threads/${ID}/participants`), async (req, res, [id]) => {
      const body = await readJson(req);
      if (!PROVIDER_IDS.includes(body.provider)) throw new RouterError('invalid', 'Unknown provider.');
      if (typeof body.model !== 'string' || !body.model) throw new RouterError('invalid', 'Pick a model.');
      json(res, 200, await router.addParticipant(id, { provider: body.provider, model: body.model, effort: optString(body.effort) }));
    }],
    ['PATCH', re(`/api/threads/${ID}/participants/${ID}`), async (req, res, [id, pid]) => {
      const body = await readJson(req);
      if (typeof body.model !== 'string' || !body.model) throw new RouterError('invalid', 'Pick a model.');
      await router.changeModel(id, pid, { model: body.model, effort: optString(body.effort) });
      res.writeHead(204).end();
    }],
    ['POST', re(`/api/threads/${ID}/messages`), async (req, res, [id]) => {
      const body = await readJson(req);
      if (typeof body.to !== 'string' || typeof body.text !== 'string') throw new RouterError('invalid', 'Missing recipient or text.');
      const quotes = Array.isArray(body.quotes)
        ? body.quotes.filter((q: any) => typeof q?.text === 'string').map((q: any) => ({ messageId: String(q.messageId ?? ''), text: q.text }))
        : [];
      const { userMessageId, replyMessageId } = await router.send(id, { to: body.to, text: body.text, quotes });
      json(res, 202, { userMessageId, replyMessageId });
    }],
    ['POST', re(`/api/threads/${ID}/replies/${ID}/stop`), async (_q, res, [id, rid]) => {
      if (!router.stop(id, rid)) throw new RouterError('not_found', 'That reply is not running.');
      res.writeHead(204).end();
    }],
    ['POST', re(`/api/threads/${ID}/replies/${ID}/retry`), async (_q, res, [id, rid]) => {
      const { userMessageId, replyMessageId } = await router.retry(id, rid);
      json(res, 202, { userMessageId, replyMessageId });
    }],
    ['GET', /^\/api\/models$/, async (_q, res) => {
      const entries = await Promise.all(
        PROVIDER_IDS.map(async (id) => [id, await adapters[id].listModels().catch(() => [])] as const),
      );
      json(res, 200, Object.fromEntries(entries));
    }],
    ['GET', /^\/api\/settings$/, async (_q, res) => {
      json(res, 200, { prompt: await readPrompt(paths), settings: await loadSettings(paths) });
    }],
    ['PUT', /^\/api\/settings$/, async (req, res) => {
      const body = await readJson(req);
      if (typeof body.prompt === 'string') await writePrompt(paths, body.prompt);
      if (body.settings?.defaults) await saveSettings(paths, body.settings as Settings);
      json(res, 200, { prompt: await readPrompt(paths), settings: await loadSettings(paths) });
    }],
  ];

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      for (const [method, pattern, handler] of routes) {
        const m = pattern.exec(url.pathname);
        if (m && req.method === method) return await handler(req, res, m.slice(1));
      }
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found.' });
      await serveStatic(deps.webDir, req, res);
    } catch (e) {
      if (res.headersSent) return void res.end();
      if (e instanceof RouterError) {
        const status = { not_found: 404, busy: 409, invalid: 400 }[e.code];
        return json(res, status, { error: e.message });
      }
      console.error('consensus:', e);
      json(res, 500, { error: e instanceof Error ? e.message : 'Server error.' });
    }
  });
}

function re(path: string): RegExp {
  return new RegExp(`^${path}$`);
}

function optString(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<any> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new RouterError('invalid', 'Request too large.');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new RouterError('invalid', 'Request body is not valid JSON.');
  }
}

async function serveStatic(webDir: string | undefined, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!webDir) return json(res, 404, { error: 'Not found.' });
  const rawPath = (req.url ?? '/').split('?')[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return json(res, 400, { error: 'Bad path.' });
  }
  const root = normalize(webDir + sep);
  const file = normalize(join(webDir, decoded));
  if (!file.startsWith(root) && file !== normalize(webDir)) return json(res, 403, { error: 'Forbidden.' });
  for (const candidate of [file, join(webDir, 'index.html')]) {
    try {
      const body = await readFile(candidate);
      res.writeHead(200, { 'content-type': TYPES[extname(candidate)] ?? 'application/octet-stream' }).end(body);
      return;
    } catch {
      // Unknown paths fall through to index.html for client-side routes.
    }
  }
  json(res, 404, { error: 'Not found.' });
}
```

- [ ] **Step 5: Implement the `consensus` command**

`src/server/cli.ts`:
```ts
#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdapters } from './adapters/index.js';
import { createConsensusServer } from './http.js';
import { EventHub } from './hub.js';
import { makePaths } from './paths.js';
import { readPrompt } from './prompt.js';
import { Router } from './router.js';
import { ThreadStore } from './store.js';

const args = process.argv.slice(2);
const portFlag = args.indexOf('--port');
const port = Number(portFlag >= 0 ? args[portFlag + 1] : process.env.CONSENSUS_PORT ?? 4747);
const shouldOpen = !args.includes('--no-open');

const paths = makePaths();
await mkdir(paths.threads, { recursive: true });
await readPrompt(paths);

const store = new ThreadStore(paths.threads);
const hub = new EventHub();
const adapters = createAdapters(paths);
const router = new Router({ store, hub, paths, adapters });
const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const server = createConsensusServer({ router, store, hub, paths, adapters, webDir });

server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${port} is in use. Is Consensus already running? Try: consensus --port ${port + 1}`);
    process.exit(1);
  }
  throw e;
});

server.listen(port, '127.0.0.1', () => {
  const url = `http://localhost:${port}`;
  console.log(`Consensus running at ${url}`);
  if (shouldOpen) spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
});
```

- [ ] **Step 6: Run the whole suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests PASS (5 new); typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add HTTP API with SSE streaming and consensus command"
```

---

### Task 10: Web client state, API client, app shell, timeline

**Files:**
- Create: `src/web/index.html`, `src/web/main.tsx`, `src/web/App.tsx`, `src/web/api.ts`, `src/web/useThread.ts`, `src/web/threadState.ts`, `src/web/styles.css`
- Create: `src/web/components/ThreadsSidebar.tsx`, `src/web/components/ThreadView.tsx`, `src/web/components/MessageList.tsx`, `src/web/components/MessageView.tsx`
- Test: `test/web/threadState.test.ts`

**Interfaces:**
- Consumes: shared types and labels (Task 1); HTTP API (Task 9).
- Produces:
  - `applyEvent(thread: Thread | undefined, ev: ThreadEvent): Thread | undefined`
  - `paneMessages(thread: Thread, participantId: string): Message[]`
  - `streamingReply(thread: Thread, participantId: string): ReplyMessage | undefined`
  - `nextActive(thread: Thread, current?: string): string | undefined`
  - `api` object (see code); `useThread(id?: string): Thread | undefined`
  - `<MessageList thread messages onForward />`, `<ThreadView thread models defaults />` (ThreadView gains Composer and Panes in Tasks 11–12).

- [ ] **Step 1: Write the failing state tests**

`test/web/threadState.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Thread } from '../../src/shared/types.js';
import { applyEvent, nextActive, paneMessages, streamingReply } from '../../src/web/threadState.js';

const base: Thread = {
  id: 't', title: 'T', createdAt: '', updatedAt: '',
  participants: [
    { id: 'a', provider: 'claude', model: 'opus', promptHash: 'h', createdAt: '' },
    { id: 'b', provider: 'codex', model: 'gpt-6-luna', promptHash: 'h', createdAt: '' },
  ],
  messages: [
    { id: 'u1', kind: 'user', to: 'a', text: 'Hi', quotes: [], sentAt: '' },
    { id: 'r1', kind: 'reply', from: 'a', text: 'Hel', model: 'opus', status: 'streaming', sentAt: '' },
    { id: 'm1', kind: 'model_change', participant: 'b', from: 'x', to: 'y', sentAt: '' },
    { id: 'u2', kind: 'user', to: 'b', text: 'Yo', quotes: [], sentAt: '' },
  ],
};

describe('threadState', () => {
  it('replaces the thread on a thread event', () => {
    const next = { ...base, title: 'New' };
    expect(applyEvent(base, { type: 'thread', thread: next })).toBe(next);
  });

  it('appends deltas to the matching reply only', () => {
    const next = applyEvent(base, { type: 'delta', messageId: 'r1', text: 'lo' })!;
    expect(next.messages[1]).toMatchObject({ text: 'Hello' });
    expect(next.messages[0]).toBe(base.messages[0]);
  });

  it('ignores deltas before the first snapshot', () => {
    expect(applyEvent(undefined, { type: 'delta', messageId: 'r1', text: 'x' })).toBeUndefined();
  });

  it('filters a pane to one participant', () => {
    expect(paneMessages(base, 'a').map((m) => m.id)).toEqual(['u1', 'r1']);
    expect(paneMessages(base, 'b').map((m) => m.id)).toEqual(['m1', 'u2']);
  });

  it('finds the streaming reply for a participant', () => {
    expect(streamingReply(base, 'a')?.id).toBe('r1');
    expect(streamingReply(base, 'b')).toBeUndefined();
  });

  it('keeps the current target, else falls back to the last recipient', () => {
    expect(nextActive(base, 'a')).toBe('a');
    expect(nextActive(base, 'gone')).toBe('b');
    expect(nextActive({ ...base, messages: [] })).toBe('b');
    expect(nextActive({ ...base, participants: [], messages: [] })).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/web/threadState.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement state helpers, API client and hook**

`src/web/threadState.ts`:
```ts
import type { Message, ReplyMessage, Thread, ThreadEvent } from '../shared/types.js';

export function applyEvent(thread: Thread | undefined, ev: ThreadEvent): Thread | undefined {
  if (ev.type === 'thread') return ev.thread;
  if (!thread) return thread;
  return {
    ...thread,
    messages: thread.messages.map((m) =>
      m.id === ev.messageId && m.kind === 'reply' ? { ...m, text: m.text + ev.text } : m,
    ),
  };
}

export function paneMessages(thread: Thread, participantId: string): Message[] {
  return thread.messages.filter(
    (m) =>
      (m.kind === 'user' && m.to === participantId) ||
      (m.kind === 'reply' && m.from === participantId) ||
      (m.kind === 'model_change' && m.participant === participantId),
  );
}

export function streamingReply(thread: Thread, participantId: string): ReplyMessage | undefined {
  return thread.messages.find(
    (m): m is ReplyMessage => m.kind === 'reply' && m.from === participantId && m.status === 'streaming',
  );
}

export function nextActive(thread: Thread, current?: string): string | undefined {
  if (current && thread.participants.some((p) => p.id === current)) return current;
  const lastUser = [...thread.messages].reverse().find((m) => m.kind === 'user');
  if (lastUser?.kind === 'user') return lastUser.to;
  return thread.participants.at(-1)?.id;
}
```

`src/web/api.ts`:
```ts
import type { ModelOption, Participant, ProviderId, Quote, Settings, Thread, ThreadSummary } from '../shared/types.js';

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

type Sent = { userMessageId: string; replyMessageId: string };
export type SettingsPayload = { prompt: string; settings: Settings };

export const api = {
  listThreads: () => call<ThreadSummary[]>('GET', '/api/threads'),
  createThread: () => call<Thread>('POST', '/api/threads', {}),
  addParticipant: (threadId: string, body: { provider: ProviderId; model: string; effort?: string }) =>
    call<Participant>('POST', `/api/threads/${threadId}/participants`, body),
  changeModel: (threadId: string, participantId: string, body: { model: string; effort?: string }) =>
    call<void>('PATCH', `/api/threads/${threadId}/participants/${participantId}`, body),
  send: (threadId: string, body: { to: string; text: string; quotes: Quote[] }) =>
    call<Sent>('POST', `/api/threads/${threadId}/messages`, body),
  stop: (threadId: string, replyId: string) => call<void>('POST', `/api/threads/${threadId}/replies/${replyId}/stop`),
  retry: (threadId: string, replyId: string) => call<Sent>('POST', `/api/threads/${threadId}/replies/${replyId}/retry`),
  models: () => call<Record<ProviderId, ModelOption[]>>('GET', '/api/models'),
  getSettings: () => call<SettingsPayload>('GET', '/api/settings'),
  putSettings: (body: Partial<SettingsPayload>) => call<SettingsPayload>('PUT', '/api/settings', body),
};
```

`src/web/useThread.ts`:
```ts
import { useEffect, useState } from 'react';
import type { Thread, ThreadEvent } from '../shared/types.js';
import { applyEvent } from './threadState.js';

export function useThread(id?: string): Thread | undefined {
  const [thread, setThread] = useState<Thread>();
  useEffect(() => {
    setThread(undefined);
    if (!id) return;
    const source = new EventSource(`/api/threads/${id}/events`);
    source.onmessage = (e) => setThread((t) => applyEvent(t, JSON.parse(e.data) as ThreadEvent));
    return () => source.close();
  }, [id]);
  return thread;
}
```

- [ ] **Step 4: Run state tests to verify they pass**

Run: `npx vitest run test/web/threadState.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: Write the page, styles, sidebar and timeline components**

`src/web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Consensus</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`src/web/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);
```

`src/web/App.tsx`:
```tsx
import { useCallback, useEffect, useState } from 'react';
import type { ModelOption, ProviderId, Settings, ThreadSummary } from '../shared/types.js';
import { api } from './api.js';
import { ThreadsSidebar } from './components/ThreadsSidebar.js';
import { ThreadView } from './components/ThreadView.js';
import { useThread } from './useThread.js';

export function App() {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [models, setModels] = useState<Record<ProviderId, ModelOption[]>>();
  const [settings, setSettings] = useState<Settings>();
  const [showSettings, setShowSettings] = useState(false);
  const thread = useThread(activeId);

  const refresh = useCallback(() => api.listThreads().then(setThreads), []);
  const reloadSettings = useCallback(() => api.getSettings().then((s) => setSettings(s.settings)), []);

  useEffect(() => {
    refresh();
    reloadSettings();
    api.models().then(setModels);
  }, [refresh, reloadSettings]);

  useEffect(() => {
    if (thread) refresh();
  }, [thread?.title, thread?.updatedAt, refresh]);

  const newThread = async () => {
    const t = await api.createThread();
    await refresh();
    setActiveId(t.id);
  };

  return (
    <div className="app">
      <ThreadsSidebar
        threads={threads}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={newThread}
        onSettings={() => setShowSettings(true)}
      />
      <main className="main">
        {thread && models && settings ? (
          <ThreadView key={thread.id} thread={thread} models={models} defaults={settings.defaults} />
        ) : (
          <div className="empty">
            <p>Pick a thread or start a new one.</p>
            <button onClick={newThread}>New thread</button>
          </div>
        )}
      </main>
      {showSettings && models && (
        <SettingsSlot models={models} onClose={() => { setShowSettings(false); reloadSettings(); }} />
      )}
    </div>
  );
}

// Replaced by SettingsDialog in Task 12.
function SettingsSlot(_: { models: Record<ProviderId, ModelOption[]>; onClose: () => void }) {
  return null;
}
```

`src/web/components/ThreadsSidebar.tsx`:
```tsx
import type { ThreadSummary } from '../../shared/types.js';

type Props = {
  threads: ThreadSummary[];
  activeId?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onSettings: () => void;
};

export function ThreadsSidebar({ threads, activeId, onSelect, onNew, onSettings }: Props) {
  return (
    <nav className="sidebar">
      <div className="sidebar-head">
        <strong>Consensus</strong>
        <button className="ghost" onClick={onSettings} title="Settings">Settings</button>
      </div>
      <button className="new-thread" onClick={onNew}>+ New thread</button>
      <ul>
        {threads.map((t) => (
          <li key={t.id}>
            <button className={t.id === activeId ? 'thread active' : 'thread'} onClick={() => onSelect(t.id)}>
              {t.title}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

`src/web/components/MessageList.tsx`:
```tsx
import { useEffect, useRef } from 'react';
import type { Message, Quote, Thread } from '../../shared/types.js';
import { MessageView } from './MessageView.js';

type Props = { thread: Thread; messages: Message[]; onForward: (q: Quote) => void };

export function MessageList({ thread, messages, onForward }: Props) {
  const end = useRef<HTMLDivElement>(null);
  const lastText = messages.at(-1)?.kind === 'reply' ? (messages.at(-1) as { text: string }).text.length : 0;
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [messages.length, lastText]);
  return (
    <div className="messages">
      {messages.map((m) => (
        <MessageView key={m.id} thread={thread} message={m} onForward={onForward} />
      ))}
      <div ref={end} />
    </div>
  );
}
```

`src/web/components/MessageView.tsx`:
```tsx
import { useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { participantLabel } from '../../shared/labels.js';
import type { Message, Quote, Thread } from '../../shared/types.js';
import { api } from '../api.js';

type Props = { thread: Thread; message: Message; onForward: (q: Quote) => void };

export function MessageView({ thread, message, onForward }: Props) {
  const body = useRef<HTMLDivElement>(null);
  const [actionError, setActionError] = useState<string>();
  const label = (id: string) => {
    const p = thread.participants.find((x) => x.id === id);
    return p ? participantLabel(p, thread.participants) : 'Removed participant';
  };
  const provider = (id: string) => thread.participants.find((x) => x.id === id)?.provider ?? 'claude';
  const act = (fn: () => Promise<unknown>) => fn().catch((e: Error) => setActionError(e.message));

  if (message.kind === 'model_change') {
    return <div className="marker">{label(message.participant)} switched from {message.from} to {message.to}</div>;
  }

  if (message.kind === 'user') {
    return (
      <div className="msg user">
        <div className="msg-head">You → <span className={`dot ${provider(message.to)}`} /> {label(message.to)}</div>
        {message.quotes.map((q, i) => (
          <blockquote key={i} className="quote">{q.text}</blockquote>
        ))}
        {message.text && <div className="msg-body plain">{message.text}</div>}
      </div>
    );
  }

  const forward = () => {
    // Forward only the highlighted part when the selection sits inside this reply.
    const sel = window.getSelection();
    const inside = sel && !sel.isCollapsed && body.current?.contains(sel.anchorNode) && body.current.contains(sel.focusNode);
    onForward({ messageId: message.id, text: inside ? sel!.toString() : message.text });
  };

  return (
    <div className={`msg reply ${message.status}`}>
      <div className="msg-head">
        <span className={`dot ${provider(message.from)}`} /> {label(message.from)}
        {message.status === 'stopped' && <span className="badge">stopped</span>}
      </div>
      <div className="msg-body" ref={body}>
        {message.text ? <Markdown>{message.text}</Markdown> : message.status === 'streaming' ? <span className="typing">Thinking…</span> : null}
      </div>
      {message.status === 'error' && message.error && (
        <div className="error">
          <p>{message.error.message}</p>
          {message.error.fix && <p>Fix: <code>{message.error.fix}</code></p>}
          <button onClick={() => act(() => api.retry(thread.id, message.id))}>Retry</button>
        </div>
      )}
      <div className="msg-actions">
        {message.status === 'streaming' && <button onClick={() => act(() => api.stop(thread.id, message.id))}>Stop</button>}
        {message.text && (
          <button onMouseDown={(e) => e.preventDefault()} onClick={forward} title="Highlight text first to forward only part">
            Forward ▸
          </button>
        )}
      </div>
      {actionError && <p className="error-inline">{actionError}</p>}
    </div>
  );
}
```

`src/web/components/ThreadView.tsx` (timeline only for now; Task 11 adds the composer, Task 12 adds panes):
```tsx
import { useState } from 'react';
import type { ModelOption, ProviderDefaults, ProviderId, Quote, Thread } from '../../shared/types.js';
import { MessageList } from './MessageList.js';

type Props = {
  thread: Thread;
  models: Record<ProviderId, ModelOption[]>;
  defaults: Record<ProviderId, ProviderDefaults>;
};

export function ThreadView({ thread }: Props) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const forward = (q: Quote) => setQuotes((qs) => [...qs, q]);
  return (
    <section className="thread-view">
      <header className="thread-head"><h1>{thread.title}</h1></header>
      <MessageList thread={thread} messages={thread.messages} onForward={forward} />
      <p className="hint">{quotes.length} quote(s) ready to forward</p>
    </section>
  );
}
```

`src/web/styles.css`:
```css
:root {
  --bg: #fbfaf8; --panel: #ffffff; --text: #1f1d1a; --muted: #6b665e; --line: #e6e2dc;
  --accent: #2f5bd3; --error-bg: #fdecea; --error: #a3261b;
  --claude: #d97757; --codex: #10a37f; --gemini: #4285f4;
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; font-size: 15px; color: var(--text);
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #161513; --panel: #1f1e1b; --text: #ece9e4; --muted: #a39d93; --line: #34312c; --error-bg: #3a1f1c; --error: #f2a49b; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); }
button { font: inherit; color: inherit; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: default; }
button.ghost { border-color: transparent; background: transparent; color: var(--muted); }
textarea, select { font: inherit; color: inherit; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 8px; }
.app { display: grid; grid-template-columns: 240px 1fr; height: 100vh; }
.sidebar { border-right: 1px solid var(--line); padding: 12px; overflow-y: auto; }
.sidebar-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.sidebar ul { list-style: none; margin: 8px 0 0; padding: 0; }
.new-thread { width: 100%; }
.thread { width: 100%; text-align: left; border: none; background: transparent; padding: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.thread.active { background: var(--line); }
.main { overflow: hidden; display: flex; }
.empty { margin: auto; text-align: center; color: var(--muted); }
.thread-view { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.thread-head { display: flex; align-items: center; gap: 12px; padding: 12px 20px; border-bottom: 1px solid var(--line); }
.thread-head h1 { font-size: 16px; margin: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.messages { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 14px; }
.msg { max-width: 820px; width: 100%; margin: 0 auto; }
.msg-head { font-size: 13px; color: var(--muted); display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.msg.user .msg-body { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
.msg-body.plain { white-space: pre-wrap; }
.msg.reply .msg-body { line-height: 1.55; }
.msg-actions { display: flex; gap: 6px; margin-top: 4px; }
.msg-actions button { font-size: 12px; padding: 3px 8px; }
.dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.dot.claude { background: var(--claude); } .dot.codex { background: var(--codex); } .dot.gemini { background: var(--gemini); }
.badge { font-size: 11px; border: 1px solid var(--line); border-radius: 6px; padding: 0 6px; }
.quote { margin: 0 0 6px; padding: 6px 10px; border-left: 3px solid var(--line); color: var(--muted); white-space: pre-wrap; max-height: 120px; overflow: hidden; }
.marker { text-align: center; font-size: 12px; color: var(--muted); }
.typing { color: var(--muted); }
.error { background: var(--error-bg); color: var(--error); border-radius: 8px; padding: 8px 12px; margin-top: 6px; }
.error p { margin: 0 0 6px; }
.error-inline { color: var(--error); font-size: 13px; }
.hint { color: var(--muted); font-size: 12px; padding: 0 20px; }
```

- [ ] **Step 6: Build and check the timeline in the browser**

Run: `npm run build && node dist/server/cli.js --port 4799 --no-open`
Then, using the `claude-in-chrome` tools (never `chrome-devtools` or `gly-eng` chrome): open `http://localhost:4799`, click **New thread**, and confirm the sidebar lists "Untitled thread" and the main area shows the title with an empty timeline. Stop the server with Ctrl+C.
Expected: page loads with no console errors.

- [ ] **Step 7: Run tests and typecheck, then commit**

Run: `npm test && npm run typecheck`
Expected: all PASS.

```bash
git add -A
git commit -m "feat: add web app shell, thread state and timeline"
```

---

### Task 11: Composer, participant chip, forwarding

**Files:**
- Create: `src/web/components/Composer.tsx`, `src/web/components/ParticipantChip.tsx`, `src/web/components/ModelPicker.tsx`
- Modify: `src/web/components/ThreadView.tsx` (replace whole file)
- Modify: `src/web/styles.css` (append)

**Interfaces:**
- Consumes: `api`, `streamingReply`, `nextActive` (Task 10); `participantLabel` (Task 1).
- Produces:
  - `<ModelPicker models provider? fixedProvider? initial onPick(provider, model, effort?) submitLabel />`
  - `<ParticipantChip thread models defaults target? onSelect(id) />`
  - `<Composer thread models defaults target? lockTarget onTargetChange quotes setQuotes />`

- [ ] **Step 1: Write ModelPicker**

`src/web/components/ModelPicker.tsx`:
```tsx
import { useState } from 'react';
import { PROVIDER_IDS, PROVIDERS, type ModelOption, type ProviderDefaults, type ProviderId } from '../../shared/types.js';

type Props = {
  models: Record<ProviderId, ModelOption[]>;
  defaults: Record<ProviderId, ProviderDefaults>;
  fixedProvider?: ProviderId;
  initial?: { provider: ProviderId; model: string; effort?: string };
  submitLabel: string;
  onPick: (provider: ProviderId, model: string, effort?: string) => void;
};

export function ModelPicker({ models, defaults, fixedProvider, initial, submitLabel, onPick }: Props) {
  const [provider, setProvider] = useState<ProviderId>(initial?.provider ?? fixedProvider ?? 'claude');
  const [model, setModel] = useState(initial?.model ?? defaults[provider].model);
  const [effort, setEffort] = useState(initial?.effort ?? defaults[provider].effort ?? '');
  const options = models[provider] ?? [];
  const efforts = options.find((m) => m.id === model)?.efforts ?? [];

  const changeProvider = (p: ProviderId) => {
    setProvider(p);
    setModel(defaults[p].model);
    setEffort(defaults[p].effort ?? '');
  };

  return (
    <div className="model-picker">
      {!fixedProvider && (
        <select value={provider} onChange={(e) => changeProvider(e.target.value as ProviderId)}>
          {PROVIDER_IDS.map((id) => <option key={id} value={id}>{PROVIDERS[id].name}</option>)}
        </select>
      )}
      <select value={model} onChange={(e) => setModel(e.target.value)}>
        {!options.some((m) => m.id === model) && <option value={model}>{model}</option>}
        {options.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      {efforts.length > 0 && (
        <select value={effort} onChange={(e) => setEffort(e.target.value)}>
          <option value="">default effort</option>
          {efforts.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      )}
      <button onClick={() => onPick(provider, model, efforts.length && effort ? effort : undefined)}>{submitLabel}</button>
    </div>
  );
}
```

- [ ] **Step 2: Write ParticipantChip**

`src/web/components/ParticipantChip.tsx`:
```tsx
import { useState } from 'react';
import { participantLabel } from '../../shared/labels.js';
import type { ModelOption, ProviderDefaults, ProviderId, Thread } from '../../shared/types.js';
import { api } from '../api.js';
import { ModelPicker } from './ModelPicker.js';

type Props = {
  thread: Thread;
  models: Record<ProviderId, ModelOption[]>;
  defaults: Record<ProviderId, ProviderDefaults>;
  target?: string;
  onSelect: (participantId: string) => void;
};

type Mode = { kind: 'list' } | { kind: 'new' } | { kind: 'change'; participantId: string };

export function ParticipantChip({ thread, models, defaults, target, onSelect }: Props) {
  const [open, setOpen] = useState(thread.participants.length === 0);
  const [mode, setMode] = useState<Mode>({ kind: thread.participants.length ? 'list' : 'new' });
  const [error, setError] = useState<string>();
  const current = thread.participants.find((p) => p.id === target);

  const close = () => {
    setOpen(false);
    setMode({ kind: 'list' });
    setError(undefined);
  };

  const create = async (provider: ProviderId, model: string, effort?: string) => {
    try {
      const p = await api.addParticipant(thread.id, { provider, model, effort });
      onSelect(p.id);
      close();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const change = async (participantId: string, model: string, effort?: string) => {
    try {
      await api.changeModel(thread.id, participantId, { model, effort });
      close();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="chip-wrap">
      <button className={`chip ${current?.provider ?? ''}`} onClick={() => (open ? close() : setOpen(true))}>
        {current ? <><span className={`dot ${current.provider}`} /> {participantLabel(current, thread.participants)}</> : 'Choose a participant'} ▾
      </button>
      {open && (
        <div className="chip-menu">
          {mode.kind === 'list' && (
            <>
              <div className="menu-label">Participants in this thread</div>
              {thread.participants.map((p) => (
                <div key={p.id} className="menu-row">
                  <button className="menu-item" onClick={() => { onSelect(p.id); close(); }}>
                    <span className={`dot ${p.provider}`} /> {participantLabel(p, thread.participants)} {p.id === target && '✓'}
                  </button>
                  <button className="ghost" onClick={() => setMode({ kind: 'change', participantId: p.id })}>Change model</button>
                </div>
              ))}
              <button className="menu-item new" onClick={() => setMode({ kind: 'new' })}>+ New participant</button>
            </>
          )}
          {mode.kind === 'new' && (
            <>
              <div className="menu-label">New participant</div>
              <ModelPicker models={models} defaults={defaults} submitLabel="Add" onPick={create} />
            </>
          )}
          {mode.kind === 'change' && (() => {
            const p = thread.participants.find((x) => x.id === mode.participantId)!;
            return (
              <>
                <div className="menu-label">Change model for {participantLabel(p, thread.participants)}</div>
                <ModelPicker
                  models={models}
                  defaults={defaults}
                  fixedProvider={p.provider}
                  initial={{ provider: p.provider, model: p.model, effort: p.effort }}
                  submitLabel="Switch"
                  onPick={(_prov, model, effort) => change(p.id, model, effort)}
                />
              </>
            );
          })()}
          {error && <p className="error-inline">{error}</p>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write Composer**

`src/web/components/Composer.tsx`:
```tsx
import { useState } from 'react';
import { participantLabel } from '../../shared/labels.js';
import type { ModelOption, ProviderDefaults, ProviderId, Quote, Thread } from '../../shared/types.js';
import { api } from '../api.js';
import { streamingReply } from '../threadState.js';
import { ParticipantChip } from './ParticipantChip.js';

type Props = {
  thread: Thread;
  models: Record<ProviderId, ModelOption[]>;
  defaults: Record<ProviderId, ProviderDefaults>;
  target?: string;
  lockTarget: boolean;
  onTargetChange: (participantId: string) => void;
  quotes: Quote[];
  setQuotes: (q: Quote[]) => void;
};

export function Composer({ thread, models, defaults, target, lockTarget, onTargetChange, quotes, setQuotes }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const running = target ? streamingReply(thread, target) : undefined;
  const lockedParticipant = thread.participants.find((p) => p.id === target);
  const canSend = !!target && !running && !sending && (text.trim().length > 0 || quotes.length > 0);

  const send = async () => {
    if (!canSend || !target) return;
    setSending(true);
    setError(undefined);
    try {
      await api.send(thread.id, { to: target, text, quotes });
      setText('');
      setQuotes([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="composer">
      {quotes.length > 0 && (
        <div className="quote-tray">
          {quotes.map((q, i) => (
            <div key={i} className="tray-item">
              <span>{q.text.length > 140 ? `${q.text.slice(0, 140)}…` : q.text}</span>
              <button className="ghost" onClick={() => setQuotes(quotes.filter((_, j) => j !== i))} title="Remove quote">×</button>
            </div>
          ))}
        </div>
      )}
      <div className="composer-row">
        <span className="to">To:</span>
        {lockTarget && lockedParticipant ? (
          <span className="chip static"><span className={`dot ${lockedParticipant.provider}`} /> {participantLabel(lockedParticipant, thread.participants)}</span>
        ) : (
          <ParticipantChip thread={thread} models={models} defaults={defaults} target={target} onSelect={onTargetChange} />
        )}
      </div>
      <div className="composer-row">
        <textarea
          rows={3}
          value={text}
          placeholder={running ? 'Waiting for the reply…' : 'Write your message. Cmd+Enter to send.'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        {running ? (
          <button onClick={() => api.stop(thread.id, running.id).catch((e: Error) => setError(e.message))}>Stop</button>
        ) : (
          <button className="primary" disabled={!canSend} onClick={send}>Send</button>
        )}
      </div>
      {error && <p className="error-inline">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Wire the composer into ThreadView**

Replace `src/web/components/ThreadView.tsx`:
```tsx
import { useEffect, useState } from 'react';
import type { ModelOption, ProviderDefaults, ProviderId, Quote, Thread } from '../../shared/types.js';
import { nextActive } from '../threadState.js';
import { Composer } from './Composer.js';
import { MessageList } from './MessageList.js';

type Props = {
  thread: Thread;
  models: Record<ProviderId, ModelOption[]>;
  defaults: Record<ProviderId, ProviderDefaults>;
};

export function ThreadView({ thread, models, defaults }: Props) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [active, setActive] = useState<string | undefined>(() => nextActive(thread));
  useEffect(() => setActive((a) => nextActive(thread, a)), [thread]);
  const forward = (q: Quote) => setQuotes((qs) => [...qs, q]);

  return (
    <section className="thread-view">
      <header className="thread-head"><h1>{thread.title}</h1></header>
      <MessageList thread={thread} messages={thread.messages} onForward={forward} />
      <Composer
        thread={thread} models={models} defaults={defaults}
        target={active} lockTarget={false} onTargetChange={setActive}
        quotes={quotes} setQuotes={setQuotes}
      />
    </section>
  );
}
```

- [ ] **Step 5: Append composer styles**

Append to `src/web/styles.css`:
```css
.composer { border-top: 1px solid var(--line); padding: 10px 20px 14px; display: flex; flex-direction: column; gap: 8px; }
.composer-row { display: flex; gap: 8px; align-items: flex-end; max-width: 820px; width: 100%; margin: 0 auto; }
.composer textarea { flex: 1; resize: vertical; min-height: 60px; }
.to { color: var(--muted); font-size: 13px; align-self: center; }
button.primary { background: var(--accent); border-color: var(--accent); color: white; }
.chip-wrap { position: relative; }
.chip { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; font-size: 13px; }
.chip.static { border: 1px solid var(--line); padding: 4px 10px; }
.chip-menu { position: absolute; bottom: calc(100% + 6px); left: 0; z-index: 10; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 8px; min-width: 340px; box-shadow: 0 6px 24px rgb(0 0 0 / 0.15); display: flex; flex-direction: column; gap: 4px; }
.menu-label { font-size: 12px; color: var(--muted); padding: 4px; }
.menu-row { display: flex; gap: 4px; }
.menu-item { flex: 1; text-align: left; border: none; display: flex; align-items: center; gap: 6px; }
.menu-item.new { color: var(--accent); }
.model-picker { display: flex; gap: 6px; flex-wrap: wrap; }
.quote-tray { display: flex; flex-direction: column; gap: 4px; max-width: 820px; width: 100%; margin: 0 auto; }
.tray-item { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; color: var(--muted); border-left: 3px solid var(--accent); padding: 4px 8px; background: var(--panel); }
```

- [ ] **Step 6: Check the flow end to end in the browser**

Run: `npm run build && node dist/server/cli.js --port 4799 --no-open`
Using the `claude-in-chrome` tools on `http://localhost:4799`:
1. New thread. The chip menu opens on "New participant"; add Claude · haiku. Send "Reply with one short sentence about lighthouses." Confirm the reply streams and the thread title updates.
2. Highlight two words of the reply, click **Forward ▸**, and confirm the tray shows only those words.
3. Open the chip, add ChatGPT · gpt-5.5 low, type "Critique this", send. Confirm the timeline shows "You → ChatGPT · gpt-5.5 low" with the quote block, and a reply arrives.
4. Open the chip, click **Change model** on the Claude participant, switch to sonnet, and confirm the timeline marker "Claude · sonnet … switched from haiku to sonnet".
5. Send Claude "Write 300 words about bridges." and click **Stop** mid-stream. Confirm the badge "stopped" and partial text.
Expected: every step behaves as described; no console errors.

- [ ] **Step 7: Run tests and typecheck, then commit**

Run: `npm test && npm run typecheck`

```bash
git add -A
git commit -m "feat: add composer, participant chip, model change and forwarding"
```

---

### Task 12: Panes view and settings

**Files:**
- Create: `src/web/components/SettingsDialog.tsx`
- Modify: `src/web/components/ThreadView.tsx` (replace whole file)
- Modify: `src/web/App.tsx` (swap `SettingsSlot` for `SettingsDialog`)
- Modify: `src/web/styles.css` (append)

**Interfaces:**
- Consumes: `paneMessages` (Task 10), `Composer`, `ModelPicker` (Task 11), `api.getSettings`, `api.putSettings`.
- Produces: `<SettingsDialog models onClose />`; ThreadView with a Timeline/Panes toggle.

- [ ] **Step 1: Replace ThreadView with timeline and panes**

`src/web/components/ThreadView.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { participantLabel } from '../../shared/labels.js';
import type { ModelOption, ProviderDefaults, ProviderId, Quote, Thread } from '../../shared/types.js';
import { nextActive, paneMessages } from '../threadState.js';
import { Composer } from './Composer.js';
import { MessageList } from './MessageList.js';

type Props = {
  thread: Thread;
  models: Record<ProviderId, ModelOption[]>;
  defaults: Record<ProviderId, ProviderDefaults>;
};

export function ThreadView({ thread, models, defaults }: Props) {
  const [view, setView] = useState<'timeline' | 'panes'>('timeline');
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [active, setActive] = useState<string | undefined>(() => nextActive(thread));
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useEffect(() => setActive((a) => nextActive(thread, a)), [thread]);

  const forward = (q: Quote) => setQuotes((qs) => [...qs, q]);
  const toggle = (id: string) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const composer = (target: string | undefined, lock: boolean) => (
    <Composer
      thread={thread} models={models} defaults={defaults}
      target={target} lockTarget={lock} onTargetChange={setActive}
      quotes={quotes} setQuotes={setQuotes}
    />
  );
  const shown = thread.participants.filter((p) => !hidden.has(p.id));

  return (
    <section className="thread-view">
      <header className="thread-head">
        <h1>{thread.title}</h1>
        <div className="view-toggle">
          <button className={view === 'timeline' ? 'on' : ''} onClick={() => setView('timeline')}>Timeline</button>
          <button className={view === 'panes' ? 'on' : ''} onClick={() => setView('panes')} disabled={!thread.participants.length}>Panes</button>
        </div>
      </header>
      {view === 'panes' && (
        <div className="pane-picker">
          {thread.participants.map((p) => (
            <label key={p.id}>
              <input type="checkbox" checked={!hidden.has(p.id)} onChange={() => toggle(p.id)} />
              <span className={`dot ${p.provider}`} /> {participantLabel(p, thread.participants)}
            </label>
          ))}
        </div>
      )}
      {view === 'timeline' ? (
        <>
          <MessageList thread={thread} messages={thread.messages} onForward={forward} />
          {composer(active, false)}
        </>
      ) : (
        <div className="panes">
          {shown.map((p) => (
            <section key={p.id} className="pane">
              <h2><span className={`dot ${p.provider}`} /> {participantLabel(p, thread.participants)}</h2>
              <MessageList thread={thread} messages={paneMessages(thread, p.id)} onForward={forward} />
              {composer(p.id, true)}
            </section>
          ))}
          {!shown.length && <p className="empty">Tick a participant to show its pane.</p>}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Write SettingsDialog**

`src/web/components/SettingsDialog.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { PROVIDER_IDS, PROVIDERS, type ModelOption, type ProviderId, type Settings } from '../../shared/types.js';
import { api } from '../api.js';
import { ModelPicker } from './ModelPicker.js';

type Props = { models: Record<ProviderId, ModelOption[]>; onClose: () => void };

export function SettingsDialog({ models, onClose }: Props) {
  const [prompt, setPrompt] = useState<string>();
  const [settings, setSettings] = useState<Settings>();
  const [status, setStatus] = useState<string>();

  useEffect(() => {
    api.getSettings().then((s) => {
      setPrompt(s.prompt);
      setSettings(s.settings);
    });
  }, []);

  const save = async (next: { prompt?: string; settings?: Settings }) => {
    try {
      const saved = await api.putSettings(next);
      setPrompt(saved.prompt);
      setSettings(saved.settings);
      setStatus('Saved. Applies to new participants.');
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  if (prompt === undefined || !settings) return null;
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <header><h2>Settings</h2><button className="ghost" onClick={onClose}>Close</button></header>
        <label className="field">
          System prompt
          <textarea rows={14} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </label>
        <button className="primary" onClick={() => save({ prompt })}>Save prompt</button>
        <h3>Default model per provider</h3>
        {PROVIDER_IDS.map((id) => (
          <div key={id} className="field-row">
            <span className="provider-name"><span className={`dot ${id}`} /> {PROVIDERS[id].name}</span>
            <ModelPicker
              models={models}
              defaults={settings.defaults}
              fixedProvider={id}
              initial={{ provider: id, ...settings.defaults[id] }}
              submitLabel="Save"
              onPick={(_p, model, effort) => save({ settings: { defaults: { ...settings.defaults, [id]: { model, effort } } } })}
            />
          </div>
        ))}
        {status && <p className="hint">{status}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Use SettingsDialog in App**

In `src/web/App.tsx`, add the import:
```tsx
import { SettingsDialog } from './components/SettingsDialog.js';
```
Replace the `SettingsSlot` usage:
```tsx
        <SettingsSlot models={models} onClose={() => { setShowSettings(false); reloadSettings(); }} />
```
with:
```tsx
        <SettingsDialog models={models} onClose={() => { setShowSettings(false); reloadSettings(); }} />
```
and delete the `SettingsSlot` function and its comment at the bottom of the file.

- [ ] **Step 4: Append panes and dialog styles**

Append to `src/web/styles.css`:
```css
.view-toggle { display: flex; }
.view-toggle button { border-radius: 0; }
.view-toggle button:first-child { border-radius: 8px 0 0 8px; }
.view-toggle button:last-child { border-radius: 0 8px 8px 0; border-left: none; }
.view-toggle button.on { background: var(--line); }
.pane-picker { display: flex; gap: 14px; padding: 8px 20px; border-bottom: 1px solid var(--line); font-size: 13px; flex-wrap: wrap; }
.pane-picker label { display: flex; align-items: center; gap: 6px; }
.panes { flex: 1; display: flex; overflow-x: auto; min-height: 0; }
.pane { flex: 1 0 380px; display: flex; flex-direction: column; border-right: 1px solid var(--line); min-height: 0; }
.pane h2 { font-size: 14px; margin: 0; padding: 10px 16px; border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 6px; }
.pane .messages { padding: 12px 16px; }
.pane .composer { padding: 8px 16px 12px; }
.dialog-backdrop { position: fixed; inset: 0; background: rgb(0 0 0 / 0.35); display: flex; align-items: center; justify-content: center; z-index: 20; }
.dialog { background: var(--bg); border-radius: 12px; padding: 18px 20px; width: min(760px, 92vw); max-height: 88vh; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
.dialog header { display: flex; justify-content: space-between; align-items: center; }
.dialog h2, .dialog h3 { margin: 0; }
.field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--muted); }
.field textarea { color: var(--text); font-family: ui-monospace, monospace; font-size: 13px; }
.field-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.provider-name { width: 90px; display: flex; align-items: center; gap: 6px; }
```

- [ ] **Step 5: Check panes and settings in the browser**

Run: `npm run build && node dist/server/cli.js --port 4799 --no-open`
Using the `claude-in-chrome` tools on `http://localhost:4799`, open the thread from Task 11:
1. Click **Panes**. Confirm one column per participant, each holding only its own messages, each with a locked "To:" label.
2. Untick one participant and confirm its pane disappears.
3. Forward a reply from one pane, send it from the other pane's composer, and confirm the message appears in that pane and in the Timeline.
4. Open **Settings**, edit the prompt, save, and confirm "Saved. Applies to new participants." Change the Claude default to sonnet and confirm the new-participant picker preselects sonnet.
Expected: all behave as described; no console errors.

- [ ] **Step 6: Run tests and typecheck, then commit**

Run: `npm test && npm run typecheck`

```bash
git add -A
git commit -m "feat: add panes view and settings dialog"
```

---

### Task 13: Live smoke test, README, install, quality check

**Files:**
- Create: `scripts/smoke.ts`, `README.md`

**Interfaces:**
- Consumes: `createAdapters` (Task 9), `makePaths`, `writePrompt`, `snapshotPrompt`, `snapshotPath` (Task 2), `AdapterEvent` (Task 4).

- [ ] **Step 1: Write the smoke script**

`scripts/smoke.ts`:
```ts
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
```

- [ ] **Step 2: Run the smoke test against the real CLIs**

Run: `npm run smoke`
Expected: 12 PASS lines and "All checks passed". If a provider fails, rerun only that one (`npm run smoke -- codex`) and fix the adapter before continuing. Record any changed CLI behavior in the spec's "Verified behavior" table.

- [ ] **Step 3: Write the README**

`README.md`:
````markdown
# Consensus

Route prose work between Claude, ChatGPT, and Gemini participants in one thread, on your existing subscriptions.

## Setup

1. Install and sign in to each CLI:
   - Claude Code: `curl -fsSL https://claude.ai/install.sh | bash`, then `claude` and `/login`
   - Codex CLI: `npm i -g @openai/codex`, then `codex login` (choose ChatGPT)
   - Antigravity CLI: `curl -fsSL https://antigravity.google/cli/install.sh | bash`, then `agy` to sign in, then quit
2. Build and link Consensus:
   ```bash
   npm install
   npm run build
   npm link
   ```
3. Run `consensus`. The app opens at http://localhost:4747.

## Daily use

- **New thread** for each piece of copy.
- The **To:** chip picks the participant, or adds a new one with its own provider, model and effort.
- **Forward ▸** attaches a reply, or just the highlighted part, to your next message. Models see it as "Feedback from another reviewer" and never learn who wrote it.
- **Panes** shows each participant's conversation side by side.
- **Settings** edits the system prompt (applies to new participants) and default models.

Data lives in `~/.consensus`. Threads are plain JSON in `~/.consensus/threads`.

## Development

```bash
npm run dev:server   # API on :4747
npm run dev:web      # UI on :5173 with hot reload
npm test             # unit tests, no quota used
npm run smoke        # live check against the real CLIs, uses a little quota
```

Run `npm run smoke` after upgrading any of the three CLIs.
````

- [ ] **Step 4: Install the command**

Run: `npm run build && npm link && which consensus`
Expected: prints a path ending in `/consensus`.

- [ ] **Step 5: Quality check with Sam**

Run `consensus`. With Sam, rerun his earlier Codex vs ChatGPT comparison: same prompt and copy, sent to ChatGPT · gpt-6-luna high, Claude · opus high, and Gemini · gemini-3.1-pro-high in one thread. Sam compares the replies with the ChatGPT web app's answer.
Expected: Sam judges the replies at least as deep and useful as the web app's. If one provider reads noticeably more coding-flavored or terse, note it and adjust `~/.consensus/prompts/default.md` from Settings before closing the task.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add live smoke test and README"
```
