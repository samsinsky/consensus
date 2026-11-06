// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { docExtensions } from '../../src/web/doc/DocEditor.js';
import { linesFromHtml } from '../../src/web/doc/paste.js';

// jsdom has no ClipboardEvent; ProseMirror only needs the constructor to exist.
beforeAll(() => {
  (globalThis as any).ClipboardEvent ??= class extends Event {
    clipboardData = null;
  };
});

let editor: Editor | undefined;
afterEach(() => editor?.destroy());
const make = (md = '') =>
  (editor = new Editor({ element: document.body.appendChild(document.createElement('div')), extensions: docExtensions(), content: md, contentType: 'markdown' }));

const EMAIL = "Hi Jake,\n\nThanks for following up, that's great news!\n\nHave a great weekend!\n\nBest, \nSam";
const LINES = "<p>Hi Jake,</p><p></p><p>Thanks for following up, that's great news!</p><p></p><p>Have a great weekend!</p><p></p><p>Best,</p><p>Sam</p>";

describe('pasting into the doc', () => {
  it('keeps plain text lines and blank lines exactly', () => {
    const ed = make();
    ed.view.pasteText(EMAIL);
    expect(ed.getHTML()).toBe(LINES);
  });

  it('keeps an email client\'s blank lines, which arrive as <div><br></div>', () => {
    const ed = make();
    ed.view.pasteHTML(
      "<div>Hi Jake,</div><div><br></div><div>Thanks for following up, that's great news!</div><div><br></div><div>Have a great weekend!</div><div><br></div><div>Best,&nbsp;</div><div>Sam</div>",
    );
    expect(ed.getHTML()).toBe(LINES);
  });

  it('turns line breaks inside a paragraph into lines, keeping formatting', () => {
    const ed = make();
    ed.view.pasteHTML('<p>Hi <strong>Jake</strong>,<br><br>Thanks!</p><p>Best, <br>Sam</p>');
    expect(ed.getHTML()).toBe('<p>Hi <strong>Jake</strong>,</p><p></p><p>Thanks!</p><p>Best,</p><p>Sam</p>');
  });

  it('survives saving and reloading', () => {
    const ed = make();
    ed.view.pasteText(EMAIL);
    expect(make(ed.getMarkdown()).getHTML()).toBe(LINES);
  });

  it('joins a pasted fragment into the line the cursor is on', () => {
    const ed = make('Hello there');
    ed.commands.setTextSelection(7);
    ed.view.pasteText('big ');
    expect(ed.getHTML()).toBe('<p>Hello big there</p>');
  });
});

describe('linesFromHtml', () => {
  it('drops hidden characters and treats a trailing <br> as the end of its line', () => {
    expect(linesFromHtml('<div>the direction​<br></div><div>next</div>')).toBe('<p>the direction</p><p>next</p>');
  });
  it('handles bare text with no wrapping block', () => {
    expect(linesFromHtml('one<br><br>two')).toBe('<p>one</p><p></p><p>two</p>');
  });
});
