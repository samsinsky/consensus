import { PROVIDERS, type Participant, type ReplyMessage } from './types.js';

export function modelLabel(model: string, effort?: string): string {
  return effort ? `${model} ${effort}` : model;
}

/** "Claude" alone, or "Claude #2" when the thread has several Claude participants. */
export function participantName(p: Participant, all: Participant[]): string {
  const siblings = all.filter((o) => o.provider === p.provider);
  const name = PROVIDERS[p.provider].name;
  if (siblings.length < 2) return name;
  return `${name} #${p.ordinal ?? siblings.findIndex((o) => o.id === p.id) + 1}`;
}

export function participantLabel(p: Participant, all: Participant[]): string {
  return `${participantName(p, all)} · ${modelLabel(p.model, p.effort)}`;
}

/** Labels a reply with the model that wrote it, which may differ from the participant's current one. */
export function replyLabel(reply: ReplyMessage, p: Participant, all: Participant[]): string {
  return `${participantName(p, all)} · ${modelLabel(reply.model, reply.effort)}`;
}
