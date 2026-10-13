import { describe, expect, it } from 'vitest';
import { normalize } from '../../src/shared/anchor.js';
import { markdownToPlain } from '../../src/shared/markdownText.js';

describe('markdownToPlain', () => {
  it('keeps the words and drops the marks', () => {
    const md = '## About me\n\nI **ship** *fast* and [write](https://x.com) code.\n\n- one\n- two & three\n\n1. first\n\n"Quoted" it\'s 1 < 2';
    expect(normalize(markdownToPlain(md))).toBe('About me I ship fast and write code. one two & three first "Quoted" it\'s 1 < 2');
  });

  it('returns empty text for an empty document', () => {
    expect(markdownToPlain('')).toBe('');
  });
});
