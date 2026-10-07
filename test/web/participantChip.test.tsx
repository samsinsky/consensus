// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ModelOption, ProviderDefaults, ProviderId, Thread } from '../../src/shared/types.js';
import { ParticipantChip } from '../../src/web/components/ParticipantChip.js';

const models: Record<ProviderId, ModelOption[]> = { claude: [{ id: 'opus', label: 'Opus', efforts: [] }], codex: [], gemini: [] };
const defaults: Record<ProviderId, ProviderDefaults> = { claude: { model: 'opus' }, codex: { model: 'x' }, gemini: { model: 'y' } };
const thread: Thread = {
  id: 't', title: 'T', createdAt: '', updatedAt: '', messages: [],
  participants: [{ id: 'a', provider: 'claude', model: 'opus', promptHash: 'h', createdAt: '' }],
};

function renderChip() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => createRoot(host).render(<ParticipantChip thread={thread} models={models} defaults={defaults} target="a" onSelect={() => {}} />));
  act(() => (host.querySelector('.chip') as HTMLButtonElement).click());
  return host;
}

describe('ParticipantChip', () => {
  beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; document.body.innerHTML = ''; });

  it('closes when clicking outside the menu', () => {
    const host = renderChip();
    expect(host.querySelector('.chip-menu')).not.toBeNull();
    act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(host.querySelector('.chip-menu')).toBeNull();
  });

  it('stays open when clicking inside the menu', () => {
    const host = renderChip();
    act(() => { host.querySelector('.chip-menu')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(host.querySelector('.chip-menu')).not.toBeNull();
  });

  it('closes on Escape', () => {
    const host = renderChip();
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(host.querySelector('.chip-menu')).toBeNull();
  });
});
