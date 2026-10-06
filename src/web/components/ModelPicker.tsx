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
  const selected = options.find((m) => m.id === model);
  const efforts = selected?.efforts ?? [];

  const changeProvider = (p: ProviderId) => {
    setProvider(p);
    setModel(defaults[p].model);
    setEffort(defaults[p].effort ?? '');
  };

  return (
    <div className="model-picker">
      {!fixedProvider && (
        <select value={provider} onChange={(e) => changeProvider(e.target.value as ProviderId)}>
          {PROVIDER_IDS.map((id) => <option key={id} value={id}>{PROVIDERS[id].name}</option>)}
        </select>
      )}
      <select value={model} onChange={(e) => setModel(e.target.value)}>
        {!options.some((m) => m.id === model) && <option value={model}>{model}</option>}
        {options.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      {efforts.length > 0 && (
        <select value={effort} onChange={(e) => setEffort(e.target.value)}>
          <option value="">default effort</option>
          {efforts.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      )}
      <button onClick={() => onPick(provider, model, efforts.length && effort ? effort : undefined)}>{submitLabel}</button>
      {selected?.description && <p className="model-desc">{selected.description}</p>}
    </div>
  );
}
