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
  /** After SIGTERM, how long before SIGKILL. */
  killGraceMs?: number;
  /** When the reader stops early, how long to let the CLI finish exiting (and saving its session). */
  exitGraceMs?: number;
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

const DEFAULT_KILL_GRACE_MS = 5_000;
const DEFAULT_EXIT_GRACE_MS = 5_000;

/** Every running CLI, so shutdown can end them all. */
const running = new Set<{ stop: () => void; forceKill: () => void }>();

export function killAllChildren(): void {
  for (const r of [...running]) r.stop();
}

export function forceKillAllChildren(): void {
  for (const r of [...running]) r.forceKill();
}

/** Spawns a CLI, yields each stdout line (parsed when it is JSON), then one exit item. */
export async function* runJsonl(opts: RunOptions): AsyncGenerator<ProcItem> {
  const killGraceMs = opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  // Own process group, so a kill also reaches helpers the CLI started.
  const child = spawn(opts.bin, opts.args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: [opts.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    detached: true,
  });
  let stderr = '';
  let spawnError: string | undefined;
  let aborted = false;
  let timedOut = false;
  let exited = false;
  let forceTimer: NodeJS.Timeout | undefined;
  child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', (d: string) => (stderr += d));
  const closed = new Promise<number | null>((resolve) => {
    child.on('close', (code) => resolve(code));
    child.on('error', (e: NodeJS.ErrnoException) => {
      spawnError = e.code ?? e.message;
      exited = true;
      resolve(null);
    });
  });
  const exitedPromise = new Promise<void>((resolve) => {
    child.on('exit', () => {
      exited = true;
      resolve();
    });
    child.on('error', () => resolve());
  });
  if (opts.stdin !== undefined) {
    child.stdin!.on('error', () => {});
    child.stdin!.end(opts.stdin);
  }

  const signalGroup = (sig: NodeJS.Signals) => {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, sig);
    } catch {
      try {
        child.kill(sig);
      } catch {
        // Already gone.
      }
    }
  };
  const kill = () => {
    if (!child.pid) return;
    signalGroup('SIGTERM');
    if (!forceTimer) {
      forceTimer = setTimeout(() => signalGroup('SIGKILL'), killGraceMs);
      forceTimer.unref();
    }
  };
  const onAbort = () => {
    aborted = true;
    kill();
  };
  const entry = { stop: onAbort, forceKill: () => { aborted = true; signalGroup('SIGKILL'); } };
  running.add(entry);
  if (opts.signal.aborted) onAbort();
  else opts.signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, opts.timeoutMs);

  try {
    const lines = createInterface({ input: child.stdout! });
    // A helper the CLI started may hold stdout open after the CLI exits; stop reading shortly after exit.
    exitedPromise.then(() => setTimeout(() => lines.close(), 1_000).unref());
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
    const code = await closed;
    yield { type: 'exit', info: { code, stderr, aborted, timedOut, spawnError } };
  } finally {
    clearTimeout(timer);
    opts.signal.removeEventListener('abort', onAbort);
    running.delete(entry);
    if (!exited && !aborted && !timedOut) {
      // The reader stopped early after a finished reply: let the CLI save its session and exit.
      const grace = new Promise((r) => setTimeout(r, opts.exitGraceMs ?? DEFAULT_EXIT_GRACE_MS).unref());
      await Promise.race([exitedPromise, grace]);
    }
    if (!exited) kill();
  }
}
