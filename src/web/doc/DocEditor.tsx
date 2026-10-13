import type { Editor, Extensions } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef } from 'react';

export function docExtensions(): Extensions {
  return [StarterKit.configure({ link: { openOnClick: false } }), Markdown];
}

type Props = {
  markdown: string;
  /** A new value reloads markdown into the editor, as after Restore. */
  revision: number;
  onChange: (markdown: string) => void;
  onReady: (editor: Editor) => void;
  onPick: (proposalId: string) => void;
  extensions?: Extensions;
};

export function DocEditor({ markdown, revision, onChange, onReady, onPick, extensions = [] }: Props) {
  const change = useRef(onChange);
  change.current = onChange;
  const editor = useEditor({
    extensions: [...docExtensions(), ...extensions],
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
      className="doc-editor"
      onClick={(e) => {
        const id = (e.target as HTMLElement).closest<HTMLElement>('[data-proposal]')?.dataset.proposal;
        if (id) onPick(id);
      }}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
