import { useState } from 'react';
import type { ThreadKind, ThreadSummary } from '../../shared/types.js';
import { clampSidebarWidth } from '../layout.js';

type Props = {
  threads: ThreadSummary[];
  activeId?: string;
  collapsed: boolean;
  width: number;
  onResize: (width: number) => void;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onNew: (kind: ThreadKind) => void;
  onSettings: () => void;
  onDelete: (id: string) => void;
};

export function ThreadsSidebar({ threads, activeId, collapsed, width, onResize, onToggle, onSelect, onNew, onSettings, onDelete }: Props) {
  const [confirming, setConfirming] = useState<string>();
  const [choosing, setChoosing] = useState(false);

  if (collapsed) {
    return (
      <nav className="sidebar collapsed">
        <button className="ghost" onClick={onToggle} title="Show threads">»</button>
      </nav>
    );
  }

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const onMove = (ev: MouseEvent) => onResize(clampSidebarWidth(width + ev.clientX - startX));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.classList.remove('resizing');
    };
    document.body.classList.add('resizing');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <nav className="sidebar">
      <div className="sidebar-head">
        <strong>Consensus</strong>
        <span>
          <button className="ghost" onClick={onSettings} title="Settings">Settings</button>
          <button className="ghost" onClick={onToggle} title="Hide threads">«</button>
        </span>
      </div>
      <button className="new-thread" onClick={() => setChoosing((c) => !c)}>+ New thread</button>
      {choosing && (
        <div className="new-choice">
          <button onClick={() => { setChoosing(false); onNew('chat'); }}>Chat</button>
          <button onClick={() => { setChoosing(false); onNew('doc'); }}>Doc</button>
        </div>
      )}
      <ul>
        {threads.map((t) =>
          confirming === t.id ? (
            <li key={t.id} className="thread-confirm">
              <span>Delete this thread?</span>
              <button className="danger" onClick={() => { setConfirming(undefined); onDelete(t.id); }}>Delete</button>
              <button className="ghost" onClick={() => setConfirming(undefined)}>Cancel</button>
            </li>
          ) : (
            <li key={t.id} className="thread-row">
              <button className={t.id === activeId ? 'thread active' : 'thread'} onClick={() => onSelect(t.id)}>
                {t.kind === 'doc' && (
                  <svg className="doc-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Doc">
                    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h6" />
                  </svg>
                )}
                {t.title}
              </button>
              <button className="ghost thread-delete" onClick={() => setConfirming(t.id)} title="Delete thread">×</button>
            </li>
          ),
        )}
      </ul>
      <div className="resize-handle" onMouseDown={startResize} title="Drag to resize" />
    </nav>
  );
}
