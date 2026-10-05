import { describe, expect, it } from 'vitest';
import { classifyError } from '../../../src/server/adapters/errors.js';

describe('classifyError', () => {
  it('reports a missing binary as not_installed', () => {
    const e = classifyError('gemini', { spawnError: 'ENOENT' });
    expect(e.code).toBe('not_installed');
    expect(e.fix).toBe('curl -fsSL https://antigravity.google/cli/install.sh | bash');
  });

  it.each([
    ['claude', 'Not logged in · Please run /login', 'claude, then run /login'],
    ['codex', 'Error: Not logged in. Run codex login', 'codex login'],
    ['gemini', 'error getting token source: You are not logged into Antigravity.', 'agy, complete sign-in, then quit'],
  ] as const)('detects sign-in problems for %s', (provider, stderr, fix) => {
    const e = classifyError(provider, { code: 1, stderr });
    expect(e).toMatchObject({ code: 'not_logged_in', fix });
  });

  it('detects rate limits', () => {
    expect(classifyError('codex', { detail: "You've hit your usage limit." }).code).toBe('rate_limited');
    expect(classifyError('claude', { stderr: '429 Too Many Requests' }).code).toBe('rate_limited');
  });

  it('reports timeouts', () => {
    expect(classifyError('claude', { timedOut: true }).code).toBe('timeout');
  });

  it('falls back to unknown with the tail of the output', () => {
    const e = classifyError('codex', { code: 2, stderr: 'x'.repeat(1000) + 'the real cause' });
    expect(e.code).toBe('unknown');
    expect(e.message.endsWith('the real cause')).toBe(true);
    expect(e.message.length).toBeLessThanOrEqual(500);
  });
});
