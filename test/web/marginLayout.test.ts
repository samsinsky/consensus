import { describe, expect, it } from 'vitest';
import { stackCards } from '../../src/web/doc/marginLayout.js';

describe('stackCards', () => {
  it('keeps cards at their text when there is room', () => {
    expect(stackCards([{ id: 'a', top: 0, height: 50 }, { id: 'b', top: 200, height: 50 }])).toEqual({ a: 0, b: 200 });
  });

  it('pushes close cards down in text order', () => {
    expect(stackCards([{ id: 'b', top: 20, height: 50 }, { id: 'a', top: 0, height: 50 }], undefined, 8)).toEqual({ a: 0, b: 58 });
  });

  it('lines the focused card up with its text and moves earlier cards up', () => {
    const tops = stackCards([{ id: 'a', top: 100, height: 50 }, { id: 'b', top: 110, height: 50 }, { id: 'c', top: 120, height: 50 }], 'b', 8);
    expect(tops).toEqual({ a: 52, b: 110, c: 168 });
  });

  it('never places a card above the top', () => {
    const tops = stackCards([{ id: 'a', top: 0, height: 50 }, { id: 'b', top: 10, height: 50 }], 'b', 8);
    expect(tops).toEqual({ a: 0, b: 58 });
  });
});
