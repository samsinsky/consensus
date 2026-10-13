// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { findAll, locate, normalize, toSource } from '../../src/shared/anchor.js';
import { markdownToPlain } from '../../src/shared/markdownText.js';
import { docExtensions } from '../../src/web/doc/DocEditor.js';
import { editorIndex } from '../../src/web/doc/editorIndex.js';
import { applyReplacement, cleanMarkdown } from '../../src/web/doc/inlineMarkdown.js';

let editor: Editor | undefined;
afterEach(() => editor?.destroy());

const make = (md: string) => (editor = new Editor({ element: document.createElement('div'), extensions: docExtensions(), content: md, contentType: 'markdown' }));

const FIXTURES = [
  '## About me\n\nI **ship** *fast* and [write](https://x.com) code.\n\n- one\n- two & three\n\n1. first\n\n"Quoted" it\'s 1 < 2',
  'I make complicated systems feel simple at every layer: schema, algorithm, and interface.\n\nAs founding PM at Galley Solutions, I built the product-led sales motion.',
  'Line one  \nline two after a hard break.\n\n> A quote block.',
];

describe('editorIndex', () => {
  it('reads the same words the server reads from Markdown', () => {
    for (const md of FIXTURES) expect(editorIndex(make(md).state.doc).text).toBe(normalize(markdownToPlain(md)));
  });

  it('maps a quote back to the exact editor range, across formatting', () => {
    const ed = make('I **ship** *fast* and code.');
    const index = editorIndex(ed.state.doc);
    const { from, to } = toSource(index, locate(index, { quote: 'ship fast and', prefix: '', suffix: '' })!);
    expect(ed.state.doc.textBetween(from, to)).toBe('ship fast and');
  });

  it('an edited quote no longer anchors', () => {
    const ed = make('I have gone deep on LLMs.');
    const index = editorIndex(ed.state.doc);
    const { from } = toSource(index, { start: findAll(index, 'deep')[0], end: findAll(index, 'deep')[0] + 4 });
    ed.chain().insertContentAt(from, 'very ').run();
    expect(locate(editorIndex(ed.state.doc), { quote: 'gone deep on', prefix: '', suffix: '' })).toBeUndefined();
  });
});

describe('applyReplacement', () => {
  it('swaps the words and applies Markdown formatting', () => {
    const ed = make('I have gone deep on LLMs.');
    const index = editorIndex(ed.state.doc);
    applyReplacement(ed, toSource(index, locate(index, { quote: 'gone deep on', prefix: '', suffix: '' })!), 'gained **hands-on** experience with');
    expect(ed.getHTML()).toBe('<p>I have gained <strong>hands-on</strong> experience with LLMs.</p>');
    expect(cleanMarkdown(ed.getMarkdown())).toBe('I have gained **hands-on** experience with LLMs.');
  });

  it('keeps the formatting of the words it replaces, and deletes on an empty replacement', () => {
    const ed = make('I **ship fast** daily.');
    let index = editorIndex(ed.state.doc);
    applyReplacement(ed, toSource(index, locate(index, { quote: 'ship fast', prefix: '', suffix: '' })!), 'deliver');
    expect(ed.getHTML()).toBe('<p>I <strong>deliver</strong> daily.</p>');
    index = editorIndex(ed.state.doc);
    applyReplacement(ed, toSource(index, locate(index, { quote: 'daily', prefix: '', suffix: '' })!), '');
    expect(ed.getText()).toBe('I deliver .');
  });
});
