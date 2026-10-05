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
