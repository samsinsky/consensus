// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { Sources } from '../../src/web/components/Sources.js';

function render(urls: string[]) {
  const host = document.createElement('div');
  act(() => createRoot(host).render(<Sources urls={urls} />));
  return host;
}

describe('Sources', () => {
  beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });

  it('starts collapsed with up to three site icons and a count of the other sites', () => {
    const host = render([
      'https://nodejs.org/en', 'https://nodejs.org/en/download', 'https://github.com/nodejs/Release',
      'https://www.heroku.com/x', 'https://geeksforgeeks.org/a', 'https://endoflife.date/nodejs',
    ]);
    expect(host.querySelector('.sources-toggle')!.textContent).toContain('Sources');
    expect([...host.querySelectorAll('.favicon img')].map((i) => i.getAttribute('src'))).toEqual([
      'https://nodejs.org/favicon.ico', 'https://github.com/favicon.ico', 'https://heroku.com/favicon.ico',
    ]);
    expect(host.querySelector('.sources-more')!.textContent).toBe('+ 2 more');
    expect(host.querySelector('.sources-list')).toBeNull();
  });

  it('shows no count for three sites or fewer', () => {
    expect(render(['https://a.com/1', 'https://b.com/2']).querySelector('.sources-more')).toBeNull();
  });

  it('expands to every page as a link', () => {
    const host = render(['https://nodejs.org/en', 'https://nodejs.org/en/download']);
    act(() => (host.querySelector('.sources-toggle') as HTMLButtonElement).click());
    const links = [...host.querySelectorAll('.sources-list a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://nodejs.org/en', 'https://nodejs.org/en/download']);
    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(links[0].getAttribute('rel')).toContain('noreferrer');
  });

  it('falls back to the first letter when a site has no icon', () => {
    const host = render(['https://example.com/a']);
    act(() => { host.querySelector('.favicon img')!.dispatchEvent(new Event('error')); });
    expect(host.querySelector('.favicon')!.textContent).toBe('E');
  });

  it('renders nothing without sources', () => {
    expect(render([]).innerHTML).toBe('');
  });
});
