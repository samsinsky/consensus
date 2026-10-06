// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../src/web/api.js';
import { useAttachments } from '../../src/web/useAttachments.js';

let hook: ReturnType<typeof useAttachments>;
function Harness() {
  hook = useAttachments('t1');
  return null;
}

describe('useAttachments', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(api, 'uploadAttachment').mockImplementation(async (_t, file) => ({
      id: file.name, name: file.name, kind: 'text', mime: 'text/plain', size: file.size, createdAt: '',
    }));
  });
  afterEach(() => vi.restoreAllMocks());

  it('refuses oversized or unsupported files without uploading them', async () => {
    act(() => createRoot(document.createElement('div')).render(<Harness />));
    await act(async () => hook.add([new File(['x'], 'run.exe'), new File([new Uint8Array(6 * 1024 * 1024)], 'big.png')]));
    expect(api.uploadAttachment).not.toHaveBeenCalled();
    expect(hook.files.map((f) => [f.status, f.error])).toEqual([
      ['error', "Consensus can't read .exe. Attach text, Word, PDF or image files."],
      ['error', 'big.png is larger than 5MB.'],
    ]);
  });

  it('removes only the files that were sent', async () => {
    act(() => createRoot(document.createElement('div')).render(<Harness />));
    await act(async () => hook.add([new File(['a'], 'a.txt')]));
    const sent = hook.files.map((f) => f.key);
    await act(async () => hook.add([new File(['b'], 'b.txt')]));
    act(() => hook.removeKeys(sent));
    expect(hook.files.map((f) => f.name)).toEqual(['b.txt']);
  });
});
