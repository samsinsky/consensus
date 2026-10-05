import { describe, expect, it } from 'vitest';
import { modelLabel, participantLabel, participantName, replyLabel } from '../../src/shared/labels.js';
import type { Participant, ReplyMessage } from '../../src/shared/types.js';

const p = (id: string, provider: Participant['provider'], model: string, effort?: string, ordinal?: number): Participant => ({
  id, provider, model, effort, ordinal, promptHash: 'h', createdAt: '2026-10-05T00:00:00Z',
});

const reply = (from: string, model: string, effort?: string): ReplyMessage => ({
  id: 'r', kind: 'reply', from, text: '', model, effort, status: 'done', sentAt: '',
});

describe('labels', () => {
  it('joins model and effort', () => {
    expect(modelLabel('opus', 'high')).toBe('opus high');
    expect(modelLabel('gemini-3.1-pro-high')).toBe('gemini-3.1-pro-high');
  });

  it('labels a lone participant with provider name and model', () => {
    const a = p('a', 'codex', 'gpt-6-luna', 'high', 1);
    expect(participantLabel(a, [a])).toBe('ChatGPT · gpt-6-luna high');
  });

  it('numbers participants that share a provider, by their creation ordinal', () => {
    const a = p('a', 'claude', 'opus', 'high', 1);
    const b = p('b', 'claude', 'opus', 'high', 2);
    const c = p('c', 'codex', 'gpt-6-luna', 'high', 1);
    const all = [a, b, c];
    expect(participantLabel(a, all)).toBe('Claude #1 · opus high');
    expect(participantLabel(b, all)).toBe('Claude #2 · opus high');
    expect(participantLabel(c, all)).toBe('ChatGPT · gpt-6-luna high');
  });

  it('keeps a participant number stable when its twin changes model', () => {
    const a = p('a', 'claude', 'opus', 'high', 1);
    const b = p('b', 'claude', 'sonnet', 'low', 2);
    expect(participantLabel(b, [a, b])).toBe('Claude #2 · sonnet low');
  });

  it('labels a reply with the model that wrote it, not the current one', () => {
    const a = p('a', 'claude', 'sonnet', 'high', 1);
    expect(replyLabel(reply('a', 'haiku'), a, [a])).toBe('Claude · haiku');
  });
  it('names a participant without its model, for the model-change marker', () => {
    const a = p('a', 'claude', 'sonnet', 'high', 1);
    const b = p('b', 'claude', 'opus', 'high', 2);
    expect(participantName(a, [a])).toBe('Claude');
    expect(participantName(b, [a, b])).toBe('Claude #2');
  });
});

