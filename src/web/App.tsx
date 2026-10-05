import { useCallback, useEffect, useState } from 'react';
import type { ModelOption, ProviderId, Settings, ThreadSummary } from '../shared/types.js';
import { api } from './api.js';
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
  const thread = useThread(activeId);

  const refresh = useCallback(() => api.listThreads().then(setThreads), []);
  const reloadSettings = useCallback(() => api.getSettings().then((s) => setSettings(s.settings)), []);

  useEffect(() => {
    refresh();
    reloadSettings();
    api.models().then(setModels);
  }, [refresh, reloadSettings]);

  useEffect(() => {
    if (thread) refresh();
  }, [thread?.title, thread?.updatedAt, refresh]);

  const newThread = async () => {
    const t = await api.createThread();
    await refresh();
    setActiveId(t.id);
  };

  return (
    <div className="app">
      <ThreadsSidebar
        threads={threads}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={newThread}
        onSettings={() => setShowSettings(true)}
      />
      <main className="main">
        {thread && models && settings ? (
          <ThreadView key={thread.id} thread={thread} models={models} defaults={settings.defaults} />
        ) : (
          <div className="empty">
            <p>Pick a thread or start a new one.</p>
            <button onClick={newThread}>New thread</button>
          </div>
        )}
      </main>
      {showSettings && models && (
        <SettingsDialog models={models} onClose={() => { setShowSettings(false); reloadSettings(); }} />
      )}
    </div>
  );
}

