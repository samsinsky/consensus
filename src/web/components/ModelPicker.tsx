import { useState } from 'react';
import { PROVIDER_IDS, PROVIDERS, type ModelOption, type ProviderDefaults, type ProviderId } from '../../shared/types.js';

type Props = {
  models: Record<ProviderId, ModelOption[]>;
  defaults: Record<ProviderId, ProviderDefaults>;
  fixedProvider?: ProviderId;
  initial?: { provider: ProviderId; model: string; effort?: string };
  submitLabel: string;
  onPick: (provider: ProviderId, model: string, effort?: string) => void;
};

export function ModelPicker({ models, defaults, fixedProvider, initial, submitLabel, onPick }: Props) {
  const [provider, setProvider] = useState<ProviderId>(initial?.provider ?? fixedProvider ?? 'claude');
  const [model, setModel] = useState(initial?.model ?? defaults[provider].model);
  const [effort, setEffort] = useState(initial?.effort ?? defaults[provider].effort ?? '');
  const options = models[provider] ?? [];
  const efforts = options.find((m) => m.id === model)?.efforts ?? [];
  // Always a real level: the chosen one if this model offers it, else the provider default, else the first.
  const fallback = defaults[provider].effort;
  const chosen = efforts.includes(effort) ? effort : fallback && efforts.includes(fallback) ? fallback : efforts[0];

  const changeProvider = (p: ProviderId) => {
    setProvider(p);
    setModel(defaults[p].model);
    setEffort(defaults[p].effort ?? '');
  };

  return (
    <div className="model-picker">
      {!fixedProvider && (
        <label className="field-col">
          <span className="field-head">Provider</span>
          <select value={provider} onChange={(e) => changeProvider(e.target.value as ProviderId)}>
            {PROVIDER_IDS.map((id) => <option key={id} value={id}>{PROVIDERS[id].name}</option>)}
          </select>
        </label>
      )}
      <label className="field-col">
        <span className="field-head">Model</span>
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          {!options.some((m) => m.id === model) && <option value={model}>{model}</option>}
          {options.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </label>
      {efforts.length > 0 && (
        <label className="field-col">
          <span className="field-head">Effort</span>
          <select value={chosen} onChange={(e) => setEffort(e.target.value)}>
            {efforts.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </label>
      )}
      <button onClick={() => onPick(provider, model, efforts.length ? chosen : undefined)}>{submitLabel}</button>
    </div>
  );
}
