import { useCallback, useState } from 'react';
import type { Attachment } from '../shared/types.js';
import { api } from './api.js';

export type PendingFile = {
  key: string;
  name: string;
  size: number;
  status: 'uploading' | 'ready' | 'error';
  attachment?: Attachment;
  error?: string;
};

/** Uploads files as soon as they are added; the composer sends the ready ones. */
export function useAttachments(threadId: string) {
  const [files, setFiles] = useState<PendingFile[]>([]);
  const update = (key: string, patch: Partial<PendingFile>) =>
    setFiles((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)));

  const add = useCallback((list: File[]) => {
    for (const file of list) {
      const key = crypto.randomUUID();
      setFiles((fs) => [...fs, { key, name: file.name, size: file.size, status: 'uploading' }]);
      api.uploadAttachment(threadId, file).then(
        (attachment) => update(key, { status: 'ready', attachment }),
        (e: Error) => update(key, { status: 'error', error: e.message }),
      );
    }
  }, [threadId]);

  const remove = (key: string) => setFiles((fs) => fs.filter((f) => f.key !== key));
  const clear = () => setFiles([]);
  return { files, add, remove, clear };
}
