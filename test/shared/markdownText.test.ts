import { describe, expect, it } from 'vitest';
import { normalize } from '../../src/shared/anchor.js';
import { decode, markdownToPlain } from '../../src/shared/markdownText.js';

describe('markdownToPlain', () => {
  it('keeps the words and drops the marks', () => {
    const md = '## About me\n\nI **ship** *fast* and [write](https://x.com) code.\n\n- one\n- two & three\n\n1. first\n\n"Quoted" it\'s 1 < 2';
    expect(normalize(markdownToPlain(md))).toBe('About me I ship fast and write code. one two & three first "Quoted" it\'s 1 < 2');
  });

  it('leaves an entity with an impossible code point as written', () => {
    expect(markdownToPlain('a &#99999999; b &#xFFFFFFFF; c')).toBe('a &#99999999; b &#xFFFFFFFF; c');
    expect(decode('a &#99999999; b &#xFFFFFFFF; &#65;')).toBe('a &#99999999; b &#xFFFFFFFF; A');
  });

  it('returns empty text for an empty document', () => {
    expect(markdownToPlain('')).toBe('');
  });
});
