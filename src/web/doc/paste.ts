import { Extension } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import { scrub } from './clipboard.js';

// In the doc every line is a paragraph and a blank line is an empty one. ProseMirror's own paste
// collapses blank lines in plain text and drops the <div><br></div> email clients use for them, so a
// pasted draft lost its spacing. These keep every line and every blank line exactly as pasted.

const BLOCKS = 'p, div, h1, h2, h3, h4, h5, h6, ul, ol, li, blockquote, pre, table';

/** Pasted HTML with each line as its own paragraph and each blank line as an empty one. */
export function linesFromHtml(html: string): string {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const doc = body.ownerDocument;
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) (node as Text).data = scrub((node as Text).data);
  // Bare text and line breaks with no block around them, as some apps copy.
  if (!body.querySelector(BLOCKS)) {
    const wrap = doc.createElement('div');
    wrap.append(...body.childNodes);
    body.append(wrap);
  }
  const leaves = [...body.querySelectorAll('p, div')].filter((el) => !el.querySelector(BLOCKS) && !el.closest('li'));
  for (const el of leaves) {
    const groups: Node[][] = [[]];
    for (const n of [...el.childNodes]) {
      if (n.nodeName === 'BR') groups.push([]);
      else groups.at(-1)!.push(n);
    }
    // A <br> that ends a block ends its line; it isn't a blank line of its own.
    if (groups.length > 1 && groups.at(-1)!.every(blank)) groups.pop();
    el.replaceWith(...groups.map((g) => line(doc, g)));
  }
  return body.innerHTML;
}

function blank(n: Node): boolean {
  return !(n.textContent ?? '').trim();
}

function line(doc: Document, nodes: Node[]): HTMLParagraphElement {
  const p = doc.createElement('p');
  if (nodes.every(blank)) return p;
  p.append(...nodes);
  // Trailing spaces would ride along into every copy.
  let last: Node | null = p;
  while (last && last.nodeType !== Node.TEXT_NODE) last = last.lastChild;
  if (last) (last as Text).data = (last as Text).data.replace(/[ \t]+$/, '');
  return p;
}

export const PasteLines = Extension.create({
  name: 'pasteLines',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          transformPastedHTML: linesFromHtml,
          clipboardTextParser: (text, _context, _plain, view) => {
            // The last line joins the text after the cursor, so only lines that end in a break lose trailing spaces.
            const lines = scrub(text).split(/\r\n?|\n/).map((l, i, all) => (i < all.length - 1 ? l.trimEnd() : l));
            while (lines.length > 1 && !lines.at(-1)) lines.pop();
            while (lines.length > 1 && !lines[0]) lines.shift();
            const { schema } = view.state;
            const paragraphs = lines.map((l) => schema.nodes.paragraph.create(null, l ? schema.text(l) : undefined));
            // Open on both sides, so the first and last lines join the paragraph being pasted into.
            return new Slice(Fragment.from(paragraphs), 1, 1);
          },
        },
      }),
    ];
  },
});
