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
  ignoreTerm?: boolean;
  grandchild?: boolean;
  exitDelayMs?: number;
  markerFile?: string;
};

const FAKE = fileURLToPath(new URL('./fake-cli.mjs', import.meta.url));

export function fakeCli(script: FakeScript) {
  const dir = mkdtempSync(join(tmpdir(), 'relay-fake-'));
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
