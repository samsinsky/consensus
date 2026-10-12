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

  describe('following the stream', () => {
    const reply = (text: string) => ({ id: 'r1', kind: 'reply' as const, participantId: 'a', model: 'haiku', text, status: 'streaming' as const, startedAt: '' }) as any;
    let root: ReturnType<typeof createRoot>;
    let box: HTMLElement;
    let height: number;
    const render = (messages: any[]) => act(() => root.render(<MessageList thread={thread} messages={messages} activity={{}} onForward={() => {}} />));
    const scrollTo = (top: number) => { box.scrollTop = top; box.dispatchEvent(new Event('scroll')); };

    beforeEach(() => {
      const host = document.createElement('div');
      root = createRoot(host);
      render([...thread.messages, reply('a')]);
      box = host.querySelector('.messages') as HTMLElement;
      height = 1000;
      Object.defineProperty(box, 'scrollHeight', { get: () => height });
      Object.defineProperty(box, 'clientHeight', { get: () => 400 });
      let top = 0;
      Object.defineProperty(box, 'scrollTop', { get: () => top, set: (v) => { top = Math.min(v, height - 400); } });
    });
    afterEach(() => act(() => root.unmount()));

    it('stays at the bottom while text arrives when the reader is at the bottom', () => {
      scrollTo(600);
      height = 1300;
      render([...thread.messages, reply('a longer reply')]);
      expect(box.scrollTop).toBe(900);
    });

    it('leaves the reader in place while text arrives when they have scrolled up', () => {
      scrollTo(200);
      height = 1300;
      render([...thread.messages, reply('a longer reply')]);
      expect(box.scrollTop).toBe(200);
    });

    it('follows again once the reader scrolls back to the bottom', () => {
      scrollTo(200);
      scrollTo(600);
      height = 1300;
      render([...thread.messages, reply('a longer reply')]);
      expect(box.scrollTop).toBe(900);
    });

    it('jumps to the bottom when the user sends a new message', () => {
      scrollTo(200);
      height = 1300;
      render([...thread.messages, reply('a'), { id: 'u2', kind: 'user', to: 'a', text: 'Next', quotes: [], sentAt: '' }]);
      expect(box.scrollTop).toBe(900);
    });
  });
});
