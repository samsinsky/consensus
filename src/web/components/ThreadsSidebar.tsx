import type { ThreadSummary } from '../../shared/types.js';

type Props = {
  threads: ThreadSummary[];
  activeId?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onSettings: () => void;
};

export function ThreadsSidebar({ threads, activeId, onSelect, onNew, onSettings }: Props) {
  return (
    <nav className="sidebar">
      <div className="sidebar-head">
        <strong>Consensus</strong>
        <button className="ghost" onClick={onSettings} title="Settings">Settings</button>
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
