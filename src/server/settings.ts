import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PROVIDER_IDS, type Settings } from '../shared/types.js';
import type { Paths } from './paths.js';

export const DEFAULT_SETTINGS: Settings = {
  defaults: {
    claude: { model: 'opus', effort: 'high' },
    codex: { model: 'gpt-5.6-terra', effort: 'high' },
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
