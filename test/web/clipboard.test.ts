// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanText, copyFormatted, tightHtml } from '../../src/web/doc/clipboard.js';

describe('tightHtml', () => {
  it('joins paragraphs into tight lines, keeping formatting and only the blank lines the writer left', () => {
    expect(tightHtml('<p></p><p>Hi <strong>Michael</strong>,</p><p></p><p>Thanks!</p><p>Thanks,</p><p>Sam</p><p></p>')).toBe(
      '<div>Hi <strong>Michael</strong>,<br><br>Thanks!<br>Thanks,<br>Sam</div>',
    );
  });
  it('removes hidden characters and trailing spaces', () => {
    expect(tightHtml('<p>the direction​ </p><p>Best,  <br>Sam</p>')).toBe('<div>the direction<br>Best,<br>Sam</div>');
  });
  it('keeps a link\'s target and drops every other attribute', () => {
    expect(tightHtml('<p class="x">See <a target="_blank" rel="noopener" class="y" href="https://x.com">this</a></p>')).toBe(
      '<div>See <a href="https://x.com">this</a></div>',
    );
  });
  it('keeps lists, without their margins', () => {
    expect(tightHtml('<p>Two things:</p><ul><li><p>one</p></li></ul><p>Sam</p>')).toBe(
      '<div>Two things:</div><ul style="margin: 0"><li><p style="margin: 0">one</p></li></ul><div>Sam</div>',
    );
  });
});

describe('cleanText', () => {
  it('keeps the writer\'s blank lines and strips hidden characters', () => {
    expect(cleanText('\nHi,\n\nThank you, \nSa­m  \n')).toBe('Hi,\n\nThank you,\nSam');
  });
});

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
