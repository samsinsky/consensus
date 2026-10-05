import type { AdapterError, ProviderId } from '../../shared/types.js';
import type { ExitInfo } from './process.js';

const FIX: Record<ProviderId, { install: string; login: string; cli: string }> = {
  claude: { cli: 'Claude Code', install: 'curl -fsSL https://claude.ai/install.sh | bash', login: 'claude, then run /login' },
  codex: { cli: 'Codex CLI', install: 'npm i -g @openai/codex', login: 'codex login' },
  gemini: { cli: 'Antigravity CLI', install: 'curl -fsSL https://antigravity.google/cli/install.sh | bash', login: 'agy, complete sign-in, then quit' },
};

const LOGIN = /not logged in|not logged into|please run \/login|unauthori[sz]ed|\b401\b|sign[- ]?in required|authentication/i;
const RATE = /rate.?limit|usage limit|quota|\b429\b|too many requests/i;

export function classifyError(
  provider: ProviderId,
  info: Partial<ExitInfo> & { detail?: string },
): AdapterError {
  const fix = FIX[provider];
  if (info.spawnError === 'ENOENT') {
    return { code: 'not_installed', message: `${fix.cli} is not installed or not on PATH.`, fix: fix.install };
  }
  if (info.timedOut) {
    return { code: 'timeout', message: `${fix.cli} took too long to reply.` };
  }
  const text = [info.detail, info.stderr].filter(Boolean).join('\n').trim();
  if (LOGIN.test(text)) {
    return { code: 'not_logged_in', message: `${fix.cli} is not signed in.`, fix: fix.login };
  }
  if (RATE.test(text)) {
    return { code: 'rate_limited', message: `${fix.cli} hit a usage limit. ${tail(text, 300)}`.trim() };
  }
  const exit = info.code === undefined ? '' : ` (exit ${info.code})`;
  return { code: 'unknown', message: tail(text || `${fix.cli} ended without a reply${exit}.`, 500) };
}

function tail(text: string, max: number): string {
  return text.length <= max ? text : text.slice(text.length - max);
}
