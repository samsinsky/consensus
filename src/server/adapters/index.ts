import type { ProviderId } from '../../shared/types.js';
import type { Paths } from '../paths.js';
import { createClaudeAdapter } from './claude.js';
import { createCodexAdapter } from './codex.js';
import { createGeminiAdapter } from './gemini.js';
import type { ProviderAdapter } from './types.js';

export function createAdapters(paths: Paths): Record<ProviderId, ProviderAdapter> {
  return {
    claude: createClaudeAdapter({ workdir: paths.workdir('claude'), bin: process.env.RELAY_CLAUDE_BIN }),
    codex: createCodexAdapter({ workdir: paths.workdir('codex'), bin: process.env.RELAY_CODEX_BIN }),
    gemini: createGeminiAdapter({ workdir: paths.workdir('gemini'), bin: process.env.RELAY_AGY_BIN }),
  };
}
