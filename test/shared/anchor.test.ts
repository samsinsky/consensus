import { describe, expect, it } from 'vitest';
import { buildIndex, cleanQuote, contextAt, findAll, indexString, locate, normalize, toSource } from '../../src/shared/anchor.js';

describe('normalize', () => {
  it('straightens quotes and collapses whitespace', () => {
    expect(normalize('  I’ve  gone\n\n“deep” on ')).toBe('I\'ve gone "deep" on');
  });
});

describe('cleanQuote', () => {
  it('drops Markdown marks a model copied from the document', () => {
    expect(cleanQuote('**gone deep on**')).toBe('gone deep on');
    expect(cleanQuote('*really* `fast`')).toBe('really fast');
    expect(cleanQuote('[my site](https://x.com) today')).toBe('my site today');
    expect(cleanQuote('- first item')).toBe('first item');
    expect(cleanQuote('## Heading')).toBe('Heading');
  });

  it('keeps underscores inside words', () => {
    expect(cleanQuote('snake_case name')).toBe('snake_case name');
  });
});

describe('index and find', () => {
  const index = indexString('Run kitchens.\n\nRun kitchens well.');

  it('keeps each character\'s source position', () => {
    expect(index.text).toBe('Run kitchens. Run kitchens well.');
    expect(index.map[14]).toBe(15);
  });

  it('finds every occurrence of a normalized quote', () => {
    expect(findAll(index, 'Run  kitchens')).toEqual([0, 14]);
    expect(findAll(index, '**kitchens well**')).toEqual([18]);
    expect(findAll(index, 'missing')).toEqual([]);
    expect(findAll(index, '   ')).toEqual([]);
  });

  it('builds from positioned characters', () => {
    const idx = buildIndex([{ ch: 'a', pos: 5 }, { ch: '\n', pos: 6 }, { ch: '\n', pos: 7 }, { ch: 'b', pos: 9 }]);
    expect(idx).toEqual({ text: 'a b', map: [5, 6, 9] });
  });
});

describe('locate', () => {
  it('anchors a unique quote', () => {
    const idx = indexString('One. Two. Three.');
    expect(locate(idx, { quote: 'Two.', prefix: '', suffix: '' })).toEqual({ start: 5, end: 9 });
  });

  it('picks the repeat whose surroundings match the stored context', () => {
    const idx = indexString('We ship fast. Later we ship fast again.');
    const second = findAll(idx, 'ship fast')[1];
    const ctx = contextAt(idx, second, 'ship fast'.length);
    expect(locate(idx, { quote: 'ship fast', ...ctx })).toEqual({ start: second, end: second + 9 });
  });

  it('returns undefined when the quote is gone', () => {
    expect(locate(indexString('Changed text'), { quote: 'old text', prefix: '', suffix: '' })).toBeUndefined();
  });

  it('maps a match back to source positions', () => {
    const idx = buildIndex([...'ab'].map((ch, i) => ({ ch, pos: 10 + i })));
    expect(toSource(idx, { start: 0, end: 2 })).toEqual({ from: 10, to: 12 });
  });
});

describe('contextAt', () => {
  it('takes up to 32 characters each side', () => {
    const idx = indexString(`${'a'.repeat(40)} quote ${'b'.repeat(40)}`);
    const start = findAll(idx, 'quote')[0];
    const ctx = contextAt(idx, start, 5);
    expect(ctx.prefix).toBe(`${'a'.repeat(31)} `);
    expect(ctx.suffix).toBe(` ${'b'.repeat(31)}`);
  });
});
