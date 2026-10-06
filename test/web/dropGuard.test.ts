// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { guardFileDrops } from '../../src/web/dropGuard.js';

function fileEvent(type: string, types: string[]) {
  const ev = new Event(type, { cancelable: true, bubbles: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { types } });
  return ev;
}

describe('guardFileDrops', () => {
  it('stops the browser opening files dropped outside a drop area', () => {
    const stop = guardFileDrops(window);
    const drop = fileEvent('drop', ['Files']);
    const over = fileEvent('dragover', ['Files']);
    window.dispatchEvent(drop);
    window.dispatchEvent(over);
    expect(drop.defaultPrevented).toBe(true);
    expect(over.defaultPrevented).toBe(true);
    stop();
  });

  it('leaves text drags alone', () => {
    const stop = guardFileDrops(window);
    const drop = fileEvent('drop', ['text/plain']);
    window.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(false);
    stop();
  });
});
