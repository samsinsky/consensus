import { describe, expect, it } from 'vitest';
import type { Thread } from '../../src/shared/types.js';
import { applyActivity, applyEvent, autoQuote, nextActive, paneMessages, streamingReply } from '../../src/web/threadState.js';

const base: Thread = {
  id: 't', title: 'T', createdAt: '', updatedAt: '',
  participants: [
    { id: 'a', provider: 'claude', model: 'opus', promptHash: 'h', createdAt: '' },
    { id: 'b', provider: 'codex', model: 'gpt-6-luna', promptHash: 'h', createdAt: '' },
  ],
  messages: [
    { id: 'u1', kind: 'user', to: 'a', text: 'Hi', quotes: [], sentAt: '' },
    { id: 'r1', kind: 'reply', from: 'a', text: 'Hel', model: 'opus', status: 'streaming', sentAt: '' },
    { id: 'm1', kind: 'model_change', participant: 'b', from: 'x', to: 'y', sentAt: '' },
    { id: 'u2', kind: 'user', to: 'b', text: 'Yo', quotes: [], sentAt: '' },
  ],
};

describe('threadState', () => {
  it('replaces the thread on a thread event', () => {
    const next = { ...base, title: 'New' };
    expect(applyEvent(base, { type: 'thread', thread: next })).toBe(next);
  });

  it('appends deltas to the matching reply only', () => {
    const next = applyEvent(base, { type: 'delta', messageId: 'r1', text: 'lo' })!;
    expect(next.messages[1]).toMatchObject({ text: 'Hello' });
    expect(next.messages[0]).toBe(base.messages[0]);
  });

  it('ignores deltas before the first snapshot', () => {
    expect(applyEvent(undefined, { type: 'delta', messageId: 'r1', text: 'x' })).toBeUndefined();
  });

  it('filters a pane to one participant', () => {
    expect(paneMessages(base, 'a').map((m) => m.id)).toEqual(['u1', 'r1']);
    expect(paneMessages(base, 'b').map((m) => m.id)).toEqual(['m1', 'u2']);
  });

  it('finds the streaming reply for a participant', () => {
    expect(streamingReply(base, 'a')?.id).toBe('r1');
    expect(streamingReply(base, 'b')).toBeUndefined();
  });

  it('keeps the current target, else falls back to the last recipient', () => {
    expect(nextActive(base, 'a')).toBe('a');
    expect(nextActive(base, 'gone')).toBe('b');
    expect(nextActive({ ...base, messages: [] })).toBe('b');
    expect(nextActive({ ...base, participants: [], messages: [] })).toBeUndefined();
  });
});

describe('autoQuote', () => {
  const t: Thread = {
    ...base,
    participants: [...base.participants, { id: 'c', provider: 'gemini', model: 'g', promptHash: 'h', createdAt: '' }],
    messages: [
      { id: 'ra', kind: 'reply', from: 'a', text: 'Draft from A', model: 'opus', status: 'done', sentAt: '' },
      { id: 'rc', kind: 'reply', from: 'c', text: 'Half', model: 'g', status: 'streaming', sentAt: '' },
    ],
  };

  it('attaches the latest finished reply when sending to someone else', () => {
    expect(autoQuote(t, 'b', new Set())).toEqual({ messageId: 'ra', text: 'Draft from A' });
  });

  it('attaches nothing when sending to the participant that replied last', () => {
    expect(autoQuote(t, 'a', new Set())).toBeUndefined();
  });

  it('skips a reply the user dismissed', () => {
    expect(autoQuote(t, 'b', new Set(['ra']))).toBeUndefined();
  });

  it('ignores replies still streaming, stopped or failed', () => {
    const only = { ...t, messages: [{ ...t.messages[0], status: 'stopped' as const }, t.messages[1]] };
    expect(autoQuote(only, 'b', new Set())).toBeUndefined();
  });

  it('attaches nothing without a target', () => {
    expect(autoQuote(t, undefined, new Set())).toBeUndefined();
  });
});

describe('activity', () => {
  it('never mixes activity into reply text', () => {
    const next = applyEvent(base, { type: 'activity', messageId: 'r1', text: 'Reading nodejs.org' });
    expect(next).toBe(base);
  });

  it('tracks the latest activity per streaming reply', () => {
    let map = applyActivity({}, { type: 'activity', messageId: 'r1', text: 'Searching the web' });
    map = applyActivity(map, { type: 'activity', messageId: 'r1', text: 'Reading nodejs.org' });
    expect(map).toEqual({ r1: 'Reading nodejs.org' });
    expect(applyActivity(map, { type: 'delta', messageId: 'r1', text: 'x' })).toBe(map);
  });
});
