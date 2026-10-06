// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { CollapsibleQuote } from '../../src/web/components/CollapsibleQuote.js';

function render(text: string) {
  const host = document.createElement('div');
  act(() => createRoot(host).render(<CollapsibleQuote text={text} />));
  return host;
}

describe('CollapsibleQuote', () => {
  beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });

  it('shows short quotes in full with no toggle', () => {
    const host = render('One line');
    expect(host.querySelector('button')).toBeNull();
    expect(host.querySelector('.quote')!.classList.contains('collapsed')).toBe(false);
  });

  it('starts long quotes collapsed and toggles them', () => {
    const host = render('1\n2\n3\n4\n5');
    const quote = host.querySelector('.quote')!;
    const button = host.querySelector('button')!;
    expect(quote.classList.contains('collapsed')).toBe(true);
    expect(button.textContent).toBe('Show more');
    act(() => button.click());
    expect(quote.classList.contains('collapsed')).toBe(false);
    expect(button.textContent).toBe('Show less');
  });

  it('treats one very long line as long', () => {
    expect(render('x'.repeat(400)).querySelector('button')).not.toBeNull();
  });
});
