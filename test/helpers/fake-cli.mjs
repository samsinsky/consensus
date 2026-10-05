#!/usr/bin/env node
// Replays a scripted CLI run: records argv and stdin, prints lines, then exits or hangs.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const script = JSON.parse(readFileSync(process.env.FAKE_SCRIPT, 'utf8'));
if (script.ignoreTerm) process.on('SIGTERM', () => {});
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
  if (script.grandchild) {
    // A helper that inherits stdout and outlives a plain SIGTERM to its parent.
    spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'inherit', 'inherit'] });
  }
  for (const line of script.lines ?? []) {
    process.stdout.write(line + '\n');
    if (script.delayMs) await new Promise((r) => setTimeout(r, script.delayMs));
  }
  if (script.stderr) process.stderr.write(script.stderr);
  if (script.hang) {
    setInterval(() => {}, 1000);
    return;
  }
  if (script.exitDelayMs) {
    await new Promise((r) => setTimeout(r, script.exitDelayMs));
    if (script.markerFile) writeFileSync(script.markerFile, 'saved');
  }
  process.exitCode = script.exitCode ?? 0;
}
