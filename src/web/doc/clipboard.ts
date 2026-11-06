// Copy is for pasting a draft into an email: lines come in tight, blank lines only where the writer left them,
// and nothing hidden rides along.

const SPACES = /[   ]/g;
const INVISIBLE = /[​-‍⁠﻿­]/g;
const TRAILING = /[ \t]+(?=<br>|$)/g;

/** Text with odd spaces made plain and invisible characters removed. */
export function scrub(text: string): string {
  return text.replace(SPACES, ' ').replace(INVISIBLE, '');
}

/** Plain text without odd spaces, invisible characters, trailing spaces, or blank lines at either end. */
export function cleanText(text: string): string {
  return scrub(text)
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

/** The editor's HTML with its paragraphs joined into lines, so rich editors paste them without gaps between. */
export function tightHtml(html: string): string {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    text.data = scrub(text.data);
  }
  // Only the link target survives, so the email client styles the text as its own.
  for (const el of body.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) if (!(el.tagName === 'A' && attr.name === 'href')) el.removeAttribute(attr.name);
  }
  const out: string[] = [];
  let lines: string[] = [];
  const flush = () => {
    while (lines.at(-1) === '') lines.pop();
    if (lines.length) out.push(`<div>${lines.join('<br>')}</div>`);
    lines = [];
  };
  for (const el of [...body.children]) {
    if (el.tagName === 'P') {
      const line = el.innerHTML.replace(TRAILING, '');
      // An empty paragraph is a blank line the writer left; keep it, except before the first line.
      const empty = !line.replace(/<br[^>]*>/g, '').trim();
      if (!empty) lines.push(line);
      else if (lines.length || out.length) lines.push('');
      continue;
    }
    flush();
    for (const block of [el, ...el.querySelectorAll('p, ul, ol')]) block.setAttribute('style', 'margin: 0');
    out.push(el.outerHTML);
  }
  flush();
  return out.join('');
}

/** Copies formatted text so it pastes cleanly into Google Docs, LinkedIn or Gmail, with plain text as the fallback. */
export async function copyFormatted(html: string, text: string): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      }),
    ]);
    return;
  }
  await navigator.clipboard.writeText(text);
}
