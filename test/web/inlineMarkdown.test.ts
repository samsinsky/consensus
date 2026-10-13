import { describe, expect, it } from 'vitest';
import { cleanMarkdown, inlineMarkdown } from '../../src/web/doc/inlineMarkdown.js';

describe('inlineMarkdown', () => {
  it('turns bold, italic and links into marks', () => {
    expect(inlineMarkdown('I **ship** *fast* and [write](https://x.com) code')).toEqual([
      { type: 'text', text: 'I ' },
      { type: 'text', text: 'ship', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'fast', marks: [{ type: 'italic' }] },
      { type: 'text', text: ' and ' },
      { type: 'text', text: 'write', marks: [{ type: 'link', attrs: { href: 'https://x.com' } }] },
      { type: 'text', text: ' code' },
    ]);
  });

  it('nests marks and leaves snake_case alone', () => {
    expect(inlineMarkdown('**very snake_case bold**')).toEqual([
      { type: 'text', text: 'very snake_case bold', marks: [{ type: 'bold' }] },
    ]);
    expect(inlineMarkdown('**bold *and italic***')).toEqual([
      { type: 'text', text: 'bold ', marks: [{ type: 'bold' }] },
      { type: 'text', text: 'and italic', marks: [{ type: 'bold' }, { type: 'italic' }] },
    ]);
  });

  it('returns nothing for an empty replacement', () => {
    expect(inlineMarkdown('')).toEqual([]);
  });
});

describe('cleanMarkdown', () => {
  it('undoes the entity escaping in saved Markdown', () => {
    expect(cleanMarkdown('two &amp; three, 1 &lt; 2 &gt; 0')).toBe('two & three, 1 < 2 > 0');
  });
});
