import { useState } from 'react';
import type { ThreadSummary } from '../../shared/types.js';
import { clampSidebarWidth } from '../layout.js';

type Props = {
  threads: ThreadSummary[];
  activeId?: string;
  collapsed: boolean;
  width: number;
  onResize: (width: number) => void;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onSettings: () => void;
  onDelete: (id: string) => void;
};

export function ThreadsSidebar({ threads, activeId, collapsed, width, onResize, onToggle, onSelect, onNew, onSettings, onDelete }: Props) {
  const [confirming, setConfirming] = useState<string>();

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
      <button className="new-thread" onClick={onNew}>+ New thread</button>
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
