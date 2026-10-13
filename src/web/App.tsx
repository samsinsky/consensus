import { useCallback, useEffect, useState } from 'react';
import type { ModelOption, ProviderId, Settings, ThreadKind, ThreadSummary } from '../shared/types.js';
import { api } from './api.js';
import { guardFileDrops } from './dropGuard.js';
import { clampSidebarWidth, SIDEBAR } from './layout.js';
import { DocView } from './doc/DocView.js';
import { SettingsDialog } from './components/SettingsDialog.js';
import { ThreadsSidebar } from './components/ThreadsSidebar.js';
import { ThreadView } from './components/ThreadView.js';
import { useThread } from './useThread.js';

export function App() {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [models, setModels] = useState<Record<ProviderId, ModelOption[]>>();
  const [settings, setSettings] = useState<Settings>();
  const [showSettings, setShowSettings] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('consensus.sidebar') === 'collapsed';
    } catch {
      return false;
    }
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      return clampSidebarWidth(Number(localStorage.getItem('consensus.sidebarWidth')) || SIDEBAR.initial);
    } catch {
      return SIDEBAR.initial;
    }
  });
  const resizeSidebar = (width: number) => {
    setSidebarWidth(width);
    try {
      localStorage.setItem('consensus.sidebarWidth', String(width));
    } catch {
      // Storage can be blocked; the width still applies for this visit.
    }
  };
  const deleteThread = async (id: string) => {
    await api.deleteThread(id);
    if (id === activeId) setActiveId(undefined);
    refresh();
  };
  const toggleSidebar = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem('consensus.sidebar', c ? 'open' : 'collapsed');
      } catch {
        // Storage can be blocked; the toggle still works for this visit.
      }
      return !c;
    });
  const { thread, activity } = useThread(activeId);

  const refresh = useCallback(() => api.listThreads().then(setThreads), []);
  const reloadSettings = useCallback(() => api.getSettings().then((s) => setSettings(s.settings)), []);

  useEffect(() => guardFileDrops(window), []);

  useEffect(() => {
    refresh();
    reloadSettings();
    api.models().then(setModels);
  }, [refresh, reloadSettings]);

  useEffect(() => {
    if (thread) refresh();
  }, [thread?.title, thread?.updatedAt, refresh]);

  const newThread = async (kind: ThreadKind = 'chat') => {
    const t = await api.createThread(kind);
    await refresh();
    setActiveId(t.id);
  };
  const openThread = async (id: string) => {
    await refresh();
    setActiveId(id);
  };

  return (
    <div className={collapsed ? 'app sidebar-collapsed' : 'app'} style={collapsed ? undefined : { gridTemplateColumns: `${sidebarWidth}px 1fr` }}>
      <ThreadsSidebar
        threads={threads}
        activeId={activeId}
        collapsed={collapsed}
        width={sidebarWidth}
        onResize={resizeSidebar}
        onDelete={deleteThread}
        onToggle={toggleSidebar}
        onSelect={setActiveId}
        onNew={newThread}
        onSettings={() => setShowSettings(true)}
      />
      <main className="main">
        {thread && models && settings ? (
          thread.kind === 'doc' ? (
            <DocView key={thread.id} thread={thread} activity={activity} models={models} defaults={settings.defaults} />
          ) : (
            <ThreadView key={thread.id} thread={thread} activity={activity} models={models} defaults={settings.defaults} onOpenThread={openThread} />
          )
        ) : (
          <div className="empty">
            <p>Pick a thread or start a new one.</p>
            <button onClick={() => newThread()}>New thread</button>
          </div>
        )}
      </main>
      {showSettings && models && (
        <SettingsDialog models={models} onClose={() => { setShowSettings(false); reloadSettings(); }} />
      )}
    </div>
  );
}

