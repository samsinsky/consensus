import { marked } from 'marked';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** The plain words of a Markdown document as the editor shows them: no marks, one block per line. */
export function markdownToPlain(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  const text = html
    .replace(/<\/(p|h[1-6]|li|blockquote|pre)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decode(text).trim();
}

function decode(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? whole;
  });
}
