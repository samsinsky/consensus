import type { ThreadSummary } from '../../shared/types.js';

type Props = {
  threads: ThreadSummary[];
  activeId?: string;
  collapsed: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onSettings: () => void;
};

export function ThreadsSidebar({ threads, activeId, collapsed, onToggle, onSelect, onNew, onSettings }: Props) {
  if (collapsed) {
    return (
      <nav className="sidebar collapsed">
        <button className="ghost" onClick={onToggle} title="Show threads">»</button>
      </nav>
    );
  }
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
        {threads.map((t) => (
          <li key={t.id}>
            <button className={t.id === activeId ? 'thread active' : 'thread'} onClick={() => onSelect(t.id)}>
              {t.title}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
