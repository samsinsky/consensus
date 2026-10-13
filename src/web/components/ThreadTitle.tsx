import { useState } from 'react';
import type { Thread } from '../../shared/types.js';
import { api } from '../api.js';

export function ThreadTitle({ thread }: { thread: Thread }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(thread.title);
  const [error, setError] = useState<string>();

  const start = () => {
    setDraft(thread.title);
    setError(undefined);
    setEditing(true);
  };
  const save = async () => {
    if (draft.trim() === thread.title) return setEditing(false);
    try {
      await api.renameThread(thread.id, draft);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!editing) {
    return (
      <h1 className="title" onClick={start} title="Rename thread">
        {thread.title} <span className="edit-icon">✎</span>
      </h1>
    );
  }
  return (
    <div className="title-edit">
      <input
        autoFocus
        value={draft}
        maxLength={120}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
      {error && <span className="error-inline">{error}</span>}
    </div>
  );
}
