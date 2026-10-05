import { describe, expect, it } from 'vitest';
import { modelLabel, participantLabel } from '../../src/shared/labels.js';
import type { Participant } from '../../src/shared/types.js';

const p = (id: string, provider: Participant['provider'], model: string, effort?: string): Participant => ({
  id, provider, model, effort, promptHash: 'h', createdAt: '2026-10-05T00:00:00Z',
});

describe('labels', () => {
  it('joins model and effort', () => {
    expect(modelLabel('opus', 'high')).toBe('opus high');
    expect(modelLabel('gemini-3.1-pro-high')).toBe('gemini-3.1-pro-high');
  });

  it('labels a lone participant with provider name and model', () => {
    const a = p('a', 'codex', 'gpt-6-luna', 'high');
    expect(participantLabel(a, [a])).toBe('ChatGPT · gpt-6-luna high');
  });

  it('numbers participants that share provider, model and effort', () => {
    const a = p('a', 'claude', 'opus', 'high');
    const b = p('b', 'claude', 'opus', 'high');
    const c = p('c', 'claude', 'sonnet', 'high');
    const all = [a, b, c];
    expect(participantLabel(a, all)).toBe('Claude · opus high #1');
    expect(participantLabel(b, all)).toBe('Claude · opus high #2');
    expect(participantLabel(c, all)).toBe('Claude · sonnet high');
  });
});
