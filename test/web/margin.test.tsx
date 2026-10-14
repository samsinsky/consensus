// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Margin } from '../../src/web/doc/Margin.js';

class FakeRO {
  static instances: FakeRO[] = [];
  observed = new Set<Element>();
  disconnected = false;
  constructor(public cb: () => void) {
    FakeRO.instances.push(this);
  }
  observe(el: Element) {
    this.observed.add(el);
  }
  unobserve(el: Element) {
    this.observed.delete(el);
  }
  disconnect() {
    this.disconnected = true;
    this.observed.clear();
  }
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).ResizeObserver = FakeRO;
  FakeRO.instances = [];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (globalThis as any).ResizeObserver;
});

describe('Margin', () => {
  it('re-measures when a card slot changes size', () => {
    const items = [
      { key: 'a', anchor: 0, node: <div>A</div> },
      { key: 'b', anchor: 10, node: <div>B</div> },
    ];
    act(() => root.render(<Margin header={null} footer={null} items={items} topOf={(p) => p} version={1} />));
    const slot = (k: string) => host.querySelector(`[data-card="${k}"]`) as HTMLElement;
    expect(slot('b').style.top).toBe('10px');
    const live = FakeRO.instances.filter((o) => !o.disconnected);
    expect(live.some((o) => o.observed.has(slot('a')))).toBe(true);
    Object.defineProperty(slot('a'), 'offsetHeight', { configurable: true, value: 50 });
    act(() => live.forEach((o) => o.cb()));
    expect(slot('b').style.top).toBe('58px');
  });

  it('places cards the same way however far the margin has scrolled', () => {
    const items = [{ key: 'a', anchor: 300, node: <div>A</div> }];
    const aside = () => host.querySelector('aside.margin') as HTMLElement;
    const cards = () => host.querySelector('.cards') as HTMLElement;
    act(() => root.render(<Margin header={null} footer={null} items={items} topOf={(p) => p} version={1} />));
    // Scrolled down 120px: the cards area moves up on screen by the same amount.
    Object.defineProperty(aside(), 'scrollTop', { configurable: true, value: 120 });
    aside().getBoundingClientRect = () => ({ top: 50 } as DOMRect);
    cards().getBoundingClientRect = () => ({ top: 50 + 40 - 120 } as DOMRect);
    act(() => FakeRO.instances.filter((o) => !o.disconnected).forEach((o) => o.cb()));
    expect((host.querySelector('[data-card="a"]') as HTMLElement).style.top).toBe('260px');
  });
});
