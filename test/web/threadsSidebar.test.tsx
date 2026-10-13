// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreadsSidebar } from '../../src/web/components/ThreadsSidebar.js';
import { clampSidebarWidth } from '../../src/web/layout.js';

describe('ThreadsSidebar', () => {
  beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });

  it('deletes a thread from its row after confirming', () => {
    const onDelete = vi.fn();
    const host = document.createElement('div');
    act(() => createRoot(host).render(
      <ThreadsSidebar threads={[{ id: 't1', title: 'Hero', updatedAt: '' }, { id: 't2', title: 'Pricing', updatedAt: '' }]}
        collapsed={false} width={240} onResize={() => {}} onToggle={() => {}} onSelect={() => {}} onNew={() => {}} onSettings={() => {}} onDelete={onDelete} />,
    ));
    const rows = host.querySelectorAll('.thread-row');
    act(() => (rows[1].querySelector('.thread-delete') as HTMLButtonElement).click());
    expect(host.querySelector('.thread-confirm')!.textContent).toContain('Delete this thread?');
    expect(host.querySelector('.thread-confirm')!.textContent).not.toContain('files');
    act(() => (host.querySelector('.thread-confirm button.danger') as HTMLButtonElement).click());
    expect(onDelete).toHaveBeenCalledWith('t2');
  });

  it('keeps the sidebar between 180 and 480 pixels wide', () => {
    expect(clampSidebarWidth(100)).toBe(180);
    expect(clampSidebarWidth(300)).toBe(300);
    expect(clampSidebarWidth(900)).toBe(480);
  });

  it('offers Chat or Doc for a new thread and marks doc threads', () => {
    const onNew = vi.fn();
    const host = document.createElement('div');
    act(() => createRoot(host).render(
      <ThreadsSidebar threads={[{ id: 't1', title: 'Hero', updatedAt: '' }, { id: 't2', title: 'Bio', updatedAt: '', kind: 'doc' }]}
        collapsed={false} width={240} onResize={() => {}} onToggle={() => {}} onSelect={() => {}} onNew={onNew} onSettings={() => {}} onDelete={() => {}} />,
    ));
    const rows = host.querySelectorAll('.thread-row');
    expect(rows[0].querySelector('.doc-icon')).toBeNull();
    expect(rows[1].querySelector('.doc-icon')).not.toBeNull();
    act(() => (host.querySelector('.new-thread') as HTMLButtonElement).click());
    const choice = [...host.querySelectorAll('.new-choice button')] as HTMLButtonElement[];
    expect(choice.map((b) => b.textContent)).toEqual(['Chat', 'Doc']);
    act(() => choice[1].click());
    expect(onNew).toHaveBeenCalledWith('doc');
  });
});
