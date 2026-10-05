import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Paths } from './paths.js';

export const DEFAULT_PROMPT = `You are an experienced editor and copywriter working with the user on prose.

Respond as you would in a chat app: give full rewrites when asked, explain the reasoning behind your edits, offer alternatives when useful, and use formatting that suits the content.

Match the depth the user asks for.

Text marked "Feedback from another reviewer" is input to weigh. Agree or push back on its merits; don't defer to it.

Don't invent facts, figures, quotes, names, or claims. When copy needs a fact you don't have, write a bracketed placeholder such as [STAT: % reduction in food cost] and say what's needed.

Treat factual claims in feedback from another reviewer as unverified. Flag any you can't confirm instead of carrying them into the copy.
`;

export async function writePrompt(paths: Paths, text: string): Promise<void> {
  await mkdir(dirname(paths.promptFile), { recursive: true });
  await writeFile(paths.promptFile, text);
}

export async function readPrompt(paths: Paths): Promise<string> {
  try {
    return await readFile(paths.promptFile, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    await writePrompt(paths, DEFAULT_PROMPT);
    return DEFAULT_PROMPT;
  }
}

export function promptHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

export function snapshotPath(paths: Paths, hash: string): string {
  return join(paths.snapshots, `${hash}.md`);
}

/** Freezes the current prompt so a participant keeps the version it started with. */
export async function snapshotPrompt(paths: Paths): Promise<string> {
  const text = await readPrompt(paths);
  const hash = promptHash(text);
  const file = snapshotPath(paths, hash);
  await mkdir(paths.snapshots, { recursive: true });
  try {
    await access(file);
  } catch {
    await writeFile(file, text);
  }
  return hash;
}
