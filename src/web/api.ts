import type { ModelOption, Participant, ProviderId, Quote, Settings, Thread, ThreadSummary } from '../shared/types.js';

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
  return (res.status === 204 ? undefined : await res.json()) as T;
}

type Sent = { userMessageId: string; replyMessageId: string };
export type SettingsPayload = { prompt: string; settings: Settings };

export const api = {
  listThreads: () => call<ThreadSummary[]>('GET', '/api/threads'),
  createThread: () => call<Thread>('POST', '/api/threads', {}),
  renameThread: (threadId: string, title: string) => call<void>('PATCH', `/api/threads/${threadId}`, { title }),
  addParticipant: (threadId: string, body: { provider: ProviderId; model: string; effort?: string }) =>
    call<Participant>('POST', `/api/threads/${threadId}/participants`, body),
  changeModel: (threadId: string, participantId: string, body: { model: string; effort?: string }) =>
    call<void>('PATCH', `/api/threads/${threadId}/participants/${participantId}`, body),
  send: (threadId: string, body: { to: string; text: string; quotes: Quote[] }) =>
    call<Sent>('POST', `/api/threads/${threadId}/messages`, body),
  stop: (threadId: string, replyId: string) => call<void>('POST', `/api/threads/${threadId}/replies/${replyId}/stop`),
  retry: (threadId: string, replyId: string) => call<Sent>('POST', `/api/threads/${threadId}/replies/${replyId}/retry`),
  models: () => call<Record<ProviderId, ModelOption[]>>('GET', '/api/models'),
  getSettings: () => call<SettingsPayload>('GET', '/api/settings'),
  putSettings: (body: Partial<SettingsPayload>) => call<SettingsPayload>('PUT', '/api/settings', body),
};
