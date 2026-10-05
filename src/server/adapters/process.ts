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
