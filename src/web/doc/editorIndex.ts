import type { Node as PMNode } from '@tiptap/pm/model';
import { buildIndex, type TextIndex } from '../../shared/anchor.js';

/** The editor's plain words, each mapped to its ProseMirror position. Blocks and hard breaks read as spaces. */
export function editorIndex(doc: PMNode): TextIndex {
  const chars: { ch: string; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.isText) {
      const text = node.text ?? '';
      for (let i = 0; i < text.length; i++) chars.push({ ch: text[i], pos: pos + i });
    } else if (node.type.name === 'hardBreak' || node.isBlock) {
      chars.push({ ch: '\n', pos });
    }
    return true;
  });
  return buildIndex(chars);
}
