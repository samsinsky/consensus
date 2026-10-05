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
