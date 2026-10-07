// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Thread } from '../../src/shared/types.js';
import { MessageList } from '../../src/web/components/MessageList.js';

const thread: Thread = {
  id: 't', title: 'T', createdAt: '', updatedAt: '',
  participants: [{ id: 'a', provider: 'claude', model: 'haiku', promptHash: 'h', createdAt: '' }],
  messages: [{ id: 'u1', kind: 'user', to: 'a', text: 'Hi', quotes: [], sentAt: '' }],
};

describe('MessageList', () => {
  const original = Element.prototype.scrollIntoView;
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    // Chrome 152 returns a Promise from scrollIntoView.
    Element.prototype.scrollIntoView = function () { return Promise.resolve() as any; };
  });
  afterEach(() => { Element.prototype.scrollIntoView = original; });

  it('survives re-render and unmount when scrollIntoView returns a Promise', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(<MessageList thread={thread} messages={thread.messages} activity={{}} onForward={() => {}} />));
    const more = [...thread.messages, { id: 'u2', kind: 'user' as const, to: 'a', text: 'Again', quotes: [], sentAt: '' }];
    expect(() => act(() => root.render(<MessageList thread={thread} messages={more} activity={{}} onForward={() => {}} />))).not.toThrow();
    expect(() => act(() => root.unmount())).not.toThrow();
  });
});
