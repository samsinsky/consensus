// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { docExtensions } from '../../src/web/doc/DocEditor.js';
import { applyLink, currentLink } from '../../src/web/doc/link.js';

let editor: Editor | undefined;
afterEach(() => editor?.destroy());

const make = (md: string) => (editor = new Editor({ element: document.createElement('div'), extensions: docExtensions(), content: md, contentType: 'markdown' }));
// Positions: paragraph content starts at 1.
const select = (from: number, to = from) => editor!.commands.setTextSelection({ from, to });

describe('Cmd+K links', () => {
  it('links the selected words', () => {
    make('See my site today.');
    select(5, 12); // "my site"
    applyLink(editor!, 'https://x.com');
    expect(editor!.getMarkdown().trim()).toBe('See [my site](https://x.com) today.');
  });

  it('adds https:// to a bare domain', () => {
    make('See my site today.');
    select(5, 12);
    applyLink(editor!, 'x.com');
    expect(editor!.getMarkdown().trim()).toBe('See [my site](https://x.com) today.');
  });

  it('with no selection, inserts the address as linked text', () => {
    make('See today.');
    select(5);
    applyLink(editor!, 'https://x.com');
    expect(editor!.getMarkdown().trim()).toBe('See [https://x.com](https://x.com)today.');
  });

  it('with the cursor inside a link, reads and edits the whole link', () => {
    make('See [my site](https://x.com) today.');
    select(7);
    expect(currentLink(editor!)).toBe('https://x.com');
    applyLink(editor!, 'https://y.com');
    expect(editor!.getMarkdown().trim()).toBe('See [my site](https://y.com) today.');
  });

  it('an empty address removes the link', () => {
    make('See [my site](https://x.com) today.');
    select(7);
    applyLink(editor!, '  ');
    expect(editor!.getMarkdown().trim()).toBe('See my site today.');
  });
});
