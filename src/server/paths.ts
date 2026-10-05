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
