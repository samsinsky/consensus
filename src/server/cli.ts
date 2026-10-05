#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdapters } from './adapters/index.js';
import { createRelayServer } from './http.js';
import { EventHub } from './hub.js';
import { makePaths } from './paths.js';
import { readPrompt } from './prompt.js';
import { Router } from './router.js';
import { ThreadStore } from './store.js';

const args = process.argv.slice(2);
const portFlag = args.indexOf('--port');
const port = Number(portFlag >= 0 ? args[portFlag + 1] : process.env.RELAY_PORT ?? 4747);
const shouldOpen = !args.includes('--no-open');

const paths = makePaths();
await mkdir(paths.threads, { recursive: true });
await readPrompt(paths);

const store = new ThreadStore(paths.threads);
const hub = new EventHub();
const adapters = createAdapters(paths);
const router = new Router({ store, hub, paths, adapters });
const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const server = createRelayServer({ router, store, hub, paths, adapters, webDir });

server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${port} is in use. Is Relay already running? Try: relay --port ${port + 1}`);
    process.exit(1);
  }
  throw e;
});

server.listen(port, '127.0.0.1', () => {
  const url = `http://localhost:${port}`;
  console.log(`Relay running at ${url}`);
  if (shouldOpen) spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
});
