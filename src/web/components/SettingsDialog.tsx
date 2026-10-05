import { useEffect, useState } from 'react';
import { PROVIDER_IDS, PROVIDERS, type ModelOption, type ProviderId, type Settings } from '../../shared/types.js';
import { api } from '../api.js';
import { ModelPicker } from './ModelPicker.js';

type Props = { models: Record<ProviderId, ModelOption[]>; onClose: () => void };

export function SettingsDialog({ models, onClose }: Props) {
  const [prompt, setPrompt] = useState<string>();
  const [settings, setSettings] = useState<Settings>();
  const [status, setStatus] = useState<string>();

  useEffect(() => {
    api.getSettings().then((s) => {
      setPrompt(s.prompt);
      setSettings(s.settings);
    });
  }, []);

  const save = async (next: { prompt?: string; settings?: Settings }) => {
    try {
      const saved = await api.putSettings(next);
      setPrompt(saved.prompt);
      setSettings(saved.settings);
      setStatus('Saved. Applies to new participants.');
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  if (prompt === undefined || !settings) return null;
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <header><h2>Settings</h2><button className="ghost" onClick={onClose}>Close</button></header>
        <label className="field">
          System prompt
          <textarea rows={14} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </label>
        <button className="primary" onClick={() => save({ prompt })}>Save prompt</button>
        <h3>Default model per provider</h3>
        {PROVIDER_IDS.map((id) => (
          <div key={id} className="field-row">
            <span className="provider-name"><span className={`dot ${id}`} /> {PROVIDERS[id].name}</span>
            <ModelPicker
              models={models}
              defaults={settings.defaults}
              fixedProvider={id}
              initial={{ provider: id, ...settings.defaults[id] }}
              submitLabel="Save"
              onPick={(_p, model, effort) => save({ settings: { defaults: { ...settings.defaults, [id]: { model, effort } } } })}
            />
          </div>
        ))}
        {status && <p className="hint">{status}</p>}
      </div>
    </div>
  );
}
