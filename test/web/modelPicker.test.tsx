// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelOption, ProviderDefaults, ProviderId } from '../../src/shared/types.js';
import { ModelPicker } from '../../src/web/components/ModelPicker.js';

const models: Record<ProviderId, ModelOption[]> = {
  claude: [{ id: 'opus', label: 'Opus', efforts: ['low', 'high'] }, { id: 'haiku', label: 'Haiku', efforts: [] }],
  codex: [],
  gemini: [{ id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', efforts: ['high', 'low'] }, { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', efforts: ['high', 'medium', 'low'] }],
};
const defaults: Record<ProviderId, ProviderDefaults> = {
  claude: { model: 'opus', effort: 'high' }, codex: { model: 'x' }, gemini: { model: 'gemini-3.8-flash', effort: 'medium' },
};

function setValue(select: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('ModelPicker', () => {
  beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });

  it('labels each dropdown and offers no "default effort" option', () => {
    const host = document.createElement('div');
    act(() => createRoot(host).render(<ModelPicker models={models} defaults={defaults} submitLabel="Add" onPick={() => {}} />));
    expect([...host.querySelectorAll('.field-head')].map((h) => h.textContent)).toEqual(['Provider', 'Model', 'Effort']);
    const effort = host.querySelectorAll('select')[2] as HTMLSelectElement;
    expect([...effort.options].map((o) => o.value)).toEqual(['low', 'high']);
    expect(effort.value).toBe('high');
  });

  it("falls back to a level the new model offers and hides effort when it has none", () => {
    const onPick = vi.fn();
    const host = document.createElement('div');
    act(() => createRoot(host).render(<ModelPicker models={models} defaults={defaults} submitLabel="Add" onPick={onPick} />));
    act(() => setValue(host.querySelectorAll('select')[0] as HTMLSelectElement, 'gemini'));
    act(() => setValue(host.querySelectorAll('select')[1] as HTMLSelectElement, 'gemini-3.1-pro'));
    const effort = host.querySelectorAll('select')[2] as HTMLSelectElement;
    expect(effort.value).toBe('high');
    act(() => (host.querySelector('button') as HTMLButtonElement).click());
    expect(onPick).toHaveBeenLastCalledWith('gemini', 'gemini-3.1-pro', 'high');
    act(() => setValue(host.querySelectorAll('select')[0] as HTMLSelectElement, 'claude'));
    act(() => setValue(host.querySelectorAll('select')[1] as HTMLSelectElement, 'haiku'));
    expect(host.querySelectorAll('select')).toHaveLength(2);
    act(() => (host.querySelector('button') as HTMLButtonElement).click());
    expect(onPick).toHaveBeenLastCalledWith('claude', 'haiku', undefined);
  });
});
