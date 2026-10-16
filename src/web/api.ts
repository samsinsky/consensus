import type { Attachment, ModelOption, Participant, ProviderId, Quote, Settings, Thread, ThreadKind, ThreadSummary } from '../shared/types.js';
import type { Rebased } from '../shared/change.js';

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  const text = res.status === 204 ? '' : await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

type Sent = { userMessageId: string; replyMessageId: string };
export type SettingsPayload = { prompt: string; settings: Settings };

export const api = {
  listThreads: () => call<ThreadSummary[]>('GET', '/api/threads'),
  createThread: (kind: ThreadKind = 'chat') => call<Thread>('POST', '/api/threads', kind === 'doc' ? { kind } : {}),
  createDoc: (body: { brief?: string; markdown?: string } = {}) => call<Thread>('POST', '/api/threads', { kind: 'doc', ...body }),
  openAsDoc: (threadId: string, replyId: string) => call<Thread>('POST', `/api/threads/${threadId}/open-as-doc`, { replyId }),
  saveDoc: (threadId: string, body: { revision: number; markdown?: string; brief?: string; briefAttachmentIds?: string[] }) =>
    call<void>('PUT', `/api/threads/${threadId}/doc`, body),
  setIncluded: (threadId: string, participantId: string, included: boolean) =>
    call<void>('PATCH', `/api/threads/${threadId}/participants/${participantId}`, { included }),
  removeParticipant: (threadId: string, participantId: string) => call<void>('DELETE', `/api/threads/${threadId}/participants/${participantId}`),
  startRound: (threadId: string) => call<{ round: number }>('POST', `/api/threads/${threadId}/rounds`),
  stopRound: (threadId: string) => call<void>('POST', `/api/threads/${threadId}/rounds/stop`),
  retryReview: (threadId: string, participantId: string) => call<void>('POST', `/api/threads/${threadId}/participants/${participantId}/retry-review`),
  updateProposal: (
    threadId: string,
    proposalId: string,
    body: { status?: 'accepted' | 'rejected' | 'dismissed'; replacement?: string; notChosen?: string[]; superseded?: string[]; rebased?: Rebased[] },
  ) =>
    call<void>('PATCH', `/api/threads/${threadId}/proposals/${proposalId}`, body),
  replyToProposal: (threadId: string, proposalId: string, text: string) =>
    call<void>('POST', `/api/threads/${threadId}/proposals/${proposalId}/replies`, { text }),
  restore: (threadId: string, round: number) => call<void>('POST', `/api/threads/${threadId}/restore`, { round }),
  renameThread: (threadId: string, title: string) => call<void>('PATCH', `/api/threads/${threadId}`, { title }),
  addParticipant: (threadId: string, body: { provider: ProviderId; model: string; effort?: string }) =>
    call<Participant>('POST', `/api/threads/${threadId}/participants`, body),
  changeModel: (threadId: string, participantId: string, body: { model: string; effort?: string }) =>
    call<void>('PATCH', `/api/threads/${threadId}/participants/${participantId}`, body),
  send: (threadId: string, body: { to: string; text: string; quotes: Quote[]; attachmentIds: string[] }) =>
    call<Sent>('POST', `/api/threads/${threadId}/messages`, body),
  stop: (threadId: string, replyId: string) => call<void>('POST', `/api/threads/${threadId}/replies/${replyId}/stop`),
  retry: (threadId: string, replyId: string) => call<Sent>('POST', `/api/threads/${threadId}/replies/${replyId}/retry`),
  uploadAttachment: async (threadId: string, file: File): Promise<Attachment> => {
    const res = await fetch(`/api/threads/${threadId}/attachments`, {
      method: 'POST',
      headers: {
        'x-consensus-upload': '1',
        'x-filename': encodeURIComponent(file.name),
        'content-type': file.type || 'application/octet-stream',
      },
      body: file,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? res.statusText);
    }
    return res.json();
  },
  deleteThread: (threadId: string) => call<void>('DELETE', `/api/threads/${threadId}`),
  attachmentUrl: (threadId: string, attachmentId: string) => `/api/threads/${threadId}/attachments/${attachmentId}`,
  models: () => call<Record<ProviderId, ModelOption[]>>('GET', '/api/models'),
  getSettings: () => call<SettingsPayload>('GET', '/api/settings'),
  putSettings: (body: Partial<SettingsPayload>) => call<SettingsPayload>('PUT', '/api/settings', body),
};
