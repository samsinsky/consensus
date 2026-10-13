import { useState } from 'react';
import Markdown from 'react-markdown';
import type { Round } from '../../shared/types.js';

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function HistoryMenu({ rounds, onRestore }: { rounds: Round[]; onRestore: (round: number) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<Round>();
  const [error, setError] = useState<string>();
  if (!rounds.length) return null;

  const restore = async (n: number) => {
    try {
      await onRestore(n);
      setViewing(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="history">
      <button className="ghost icon-btn" title="History" aria-label="History" onClick={() => setOpen((o) => !o)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" />
        </svg>
      </button>
      {open && (
        <div className="history-menu">
          {[...rounds].reverse().map((r) => (
            <button key={r.n} className="menu-item" onClick={() => { setViewing(r); setOpen(false); }}>
              Round {r.n} · {time(r.sentAt)}
            </button>
          ))}
        </div>
      )}
      {viewing && (
        <div className="dialog-backdrop" onClick={() => setViewing(undefined)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <header><h2>Round {viewing.n} · {time(viewing.sentAt)}</h2><button className="ghost" onClick={() => setViewing(undefined)}>Close</button></header>
            <div className="snapshot"><Markdown>{viewing.snapshot}</Markdown></div>
            <div className="card-actions"><button onClick={() => restore(viewing.n)}>Restore</button></div>
            {error && <p className="error-inline">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
