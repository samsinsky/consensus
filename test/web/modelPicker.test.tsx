// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ModelOption, ProviderDefaults, ProviderId } from '../../src/shared/types.js';
import { ModelPicker } from '../../src/web/components/ModelPicker.js';

const models: Record<ProviderId, ModelOption[]> = {
  claude: [{ id: 'opus', label: 'Opus', efforts: [] }],
  codex: [
    { id: 'gpt-5.6-terra', label: 'GPT-5.6-Terra', efforts: ['high'], description: 'Older balanced model for straightforward work.' },
    { id: 'gpt-6-luna', label: 'GPT-6-Luna', efforts: ['high'], description: 'Fast and affordable model for easier tasks.' },
  ],
  gemini: [],
};
const defaults: Record<ProviderId, ProviderDefaults> = {
  claude: { model: 'opus' }, codex: { model: 'gpt-5.6-terra', effort: 'high' }, gemini: { model: 'g' },
};

describe('ModelPicker', () => {
  beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });

  it("shows the selected model's description and updates it on change", () => {
    const host = document.createElement('div');
    act(() => createRoot(host).render(<ModelPicker models={models} defaults={defaults} fixedProvider="codex" submitLabel="Add" onPick={() => {}} />));
    expect(host.querySelector('.model-desc')!.textContent).toBe('Older balanced model for straightforward work.');
    const select = host.querySelector('select')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'gpt-6-luna');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host.querySelector('.model-desc')!.textContent).toBe('Fast and affordable model for easier tasks.');
  });

  it('shows no description when the model has none', () => {
    const host = document.createElement('div');
    act(() => createRoot(host).render(<ModelPicker models={models} defaults={defaults} fixedProvider="claude" submitLabel="Add" onPick={() => {}} />));
    expect(host.querySelector('.model-desc')).toBeNull();
  });
});
