// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyFormatted } from '../../src/web/doc/clipboard.js';

const original = (globalThis as any).ClipboardItem;
afterEach(() => {
  (globalThis as any).ClipboardItem = original;
});

describe('copyFormatted', () => {
  it('writes HTML with a plain-text fallback', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { write, writeText: vi.fn() }, configurable: true });
    (globalThis as any).ClipboardItem = class {
      constructor(public items: Record<string, Blob>) {}
    };
    await copyFormatted('<p>Hi <strong>there</strong></p>', 'Hi there');
    const item = write.mock.calls[0][0][0];
    expect(Object.keys(item.items)).toEqual(['text/html', 'text/plain']);
    expect(await item.items['text/plain'].text()).toBe('Hi there');
  });

  it('falls back to plain text where rich copy is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    (globalThis as any).ClipboardItem = undefined;
    await copyFormatted('<p>Hi</p>', 'Hi');
    expect(writeText).toHaveBeenCalledWith('Hi');
  });
});
