import { Extension, type Editor, type Extensions } from '@tiptap/core';
import { Placeholder } from '@tiptap/extensions';
import { Markdown } from '@tiptap/markdown';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef, useState } from 'react';
import { applyLink, currentLink } from './link.js';
import { PasteLines } from './paste.js';

export function docExtensions(): Extensions {
  return [
    StarterKit.configure({ link: { openOnClick: false } }),
    Markdown,
    PasteLines,
    Placeholder.configure({ placeholder: 'Paste or write the copy you want reviewed.' }),
  ];
}

type Props = {
  markdown: string;
  /** A new value reloads markdown into the editor, as after Restore. */
  revision: number;
  onChange: (markdown: string) => void;
  onReady: (editor: Editor) => void;
  /** A proposal's text was clicked, or, with no id, plain text: clear the focus. */
  onPick: (proposalId?: string) => void;
  extensions?: Extensions;
};

export function DocEditor({ markdown, revision, onChange, onReady, onPick, extensions = [] }: Props) {
  const change = useRef(onChange);
  change.current = onChange;
  const wrap = useRef<HTMLDivElement>(null);
  const [linkBox, setLinkBox] = useState<{ href: string; top: number; left: number }>();
  const openLink = useRef<(ed: Editor) => void>(undefined);
  openLink.current = (ed) => {
    const href = currentLink(ed);
    const at = ed.view.coordsAtPos(ed.state.selection.from);
    const box = wrap.current?.getBoundingClientRect();
    setLinkBox({ href, top: at.bottom - (box?.top ?? 0) + 4, left: at.left - (box?.left ?? 0) });
  };
  const editor = useEditor({
    extensions: [
      ...docExtensions(),
      Extension.create({
        name: 'linkShortcut',
        addKeyboardShortcuts() {
          return { 'Mod-k': () => (openLink.current?.(this.editor), true) };
        },
      }),
      ...extensions,
    ],
    content: markdown,
    contentType: 'markdown',
    onUpdate: ({ editor: ed }) => change.current(ed.getMarkdown()),
  });

  useEffect(() => {
    if (editor) onReady(editor);
    // onReady is called once per editor instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const loaded = useRef(revision);
  useEffect(() => {
    if (!editor || loaded.current === revision) return;
    loaded.current = revision;
    editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false });
  }, [editor, revision, markdown]);

  return (
    <div
      ref={wrap}
      className="doc-editor"
      onClick={(e) => {
        onPick((e.target as HTMLElement).closest<HTMLElement>('[data-proposal]')?.dataset.proposal);
      }}
    >
      <EditorContent editor={editor} />
      {linkBox && editor && (
        <input
          className="link-box"
          style={{ top: linkBox.top, left: linkBox.left }}
          autoFocus
          defaultValue={linkBox.href}
          placeholder="Paste a link, Enter to apply"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              applyLink(editor, e.currentTarget.value);
              setLinkBox(undefined);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setLinkBox(undefined);
              editor.commands.focus();
            }
          }}
          onBlur={() => setLinkBox(undefined)}
        />
      )}
    </div>
  );
}
