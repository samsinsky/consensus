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
