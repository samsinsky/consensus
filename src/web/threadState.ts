import type { Message, Quote, ReplyMessage, Thread, ThreadEvent } from '../shared/types.js';

export function applyEvent(thread: Thread | undefined, ev: ThreadEvent): Thread | undefined {
  if (ev.type === 'thread') return ev.thread;
  if (!thread) return thread;
  return {
    ...thread,
    messages: thread.messages.map((m) =>
      m.id === ev.messageId && m.kind === 'reply' ? { ...m, text: m.text + ev.text } : m,
    ),
  };
}

export function paneMessages(thread: Thread, participantId: string): Message[] {
  return thread.messages.filter(
    (m) =>
      (m.kind === 'user' && m.to === participantId) ||
      (m.kind === 'reply' && m.from === participantId) ||
      (m.kind === 'model_change' && m.participant === participantId),
  );
}

export function streamingReply(thread: Thread, participantId: string): ReplyMessage | undefined {
  return thread.messages.find(
    (m): m is ReplyMessage => m.kind === 'reply' && m.from === participantId && m.status === 'streaming',
  );
}

export function nextActive(thread: Thread, current?: string): string | undefined {
  if (current && thread.participants.some((p) => p.id === current)) return current;
  const lastUser = [...thread.messages].reverse().find((m) => m.kind === 'user');
  if (lastUser?.kind === 'user') return lastUser.to;
  return thread.participants.at(-1)?.id;
}

/** The reply to forward automatically: the latest finished reply, unless the target wrote it or it was dismissed. */
export function autoQuote(thread: Thread, target: string | undefined, dismissed: Set<string>): Quote | undefined {
  if (!target) return undefined;
  const latest = [...thread.messages]
    .reverse()
    .find((m): m is ReplyMessage => m.kind === 'reply' && m.status === 'done' && m.text.length > 0);
  if (!latest || latest.from === target || dismissed.has(latest.id)) return undefined;
  return { messageId: latest.id, text: latest.text };
}
