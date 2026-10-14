import type { Editor } from '@tiptap/core';

/** The link under the cursor or selection, widening the selection to cover all of it. */
export function currentLink(editor: Editor): string {
  if (editor.isActive('link')) editor.commands.extendMarkRange('link');
  return (editor.getAttributes('link').href as string | undefined) ?? '';
}

/** Cmd+K: link the selection, insert the address when nothing is selected, or unlink on an empty address. */
export function applyLink(editor: Editor, raw: string) {
  const chain = editor.chain().focus().extendMarkRange('link');
  const href = raw.trim();
  if (!href) return chain.unsetLink().run();
  const url = /^[a-z][a-z0-9+.-]*:/i.test(href) ? href : `https://${href}`;
  if (editor.state.selection.empty && !editor.isActive('link')) {
    return chain.insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] }).run();
  }
  return chain.setLink({ href: url }).run();
}
