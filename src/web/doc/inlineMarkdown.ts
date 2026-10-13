import type { Editor, JSONContent } from '@tiptap/core';

type MarkJson = { type: string; attrs?: Record<string, unknown> };

// Bold, then italic, then links. Underscore emphasis only at word edges, so snake_case stays.
const TOKEN = /\*\*(.+?)\*\*(?!\*)|(?<!\w)__(.+?)__(?!\w)|\*(.+?)\*|(?<!\w)_(.+?)_(?!\w)|\[([^\]]+)\]\(([^)\s]+)\)/;

/** A replacement's inline Markdown as TipTap text nodes with marks. */
export function inlineMarkdown(md: string, marks: MarkJson[] = []): JSONContent[] {
  const out: JSONContent[] = [];
  let rest = md;
  while (rest) {
    const m = TOKEN.exec(rest);
    if (!m) {
      out.push(textNode(rest, marks));
      break;
    }
    if (m.index) out.push(textNode(rest.slice(0, m.index), marks));
    if (m[1] !== undefined || m[2] !== undefined) out.push(...inlineMarkdown(m[1] ?? m[2], [...marks, { type: 'bold' }]));
    else if (m[3] !== undefined || m[4] !== undefined) out.push(...inlineMarkdown(m[3] ?? m[4], [...marks, { type: 'italic' }]));
    else out.push(...inlineMarkdown(m[5], [...marks, { type: 'link', attrs: { href: m[6] } }]));
    rest = rest.slice(m.index + m[0].length);
  }
  return out.filter((n) => n.text);
}

/** Replaces a range with a proposal's text, keeping the formatting the replaced words had. */
export function applyReplacement(editor: Editor, range: { from: number; to: number }, replacement: string): void {
  const inherited = (editor.state.doc.nodeAt(range.from)?.marks ?? []).map((m) => m.toJSON() as MarkJson);
  const content = inlineMarkdown(replacement.replace(/\s*\n+\s*/g, ' ')).map((n) => {
    const own = (n.marks ?? []) as MarkJson[];
    const marks = [...inherited.filter((m) => !own.some((o) => o.type === m.type)), ...own];
    return marks.length ? { ...n, marks } : { type: 'text', text: n.text };
  });
  if (content.length) editor.chain().insertContentAt(range, content).run();
  else editor.chain().deleteRange(range).run();
}

function textNode(text: string, marks: MarkJson[]): JSONContent {
  return marks.length ? { type: 'text', text, marks: marks.map((m) => ({ ...m })) } : { type: 'text', text };
}
