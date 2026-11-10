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

// Second and later participants from one provider shift the brand hue a little, alternating sides, so they
// stay recognisably that provider but can be told apart. The first keeps the brand color.
const HUE_SHIFTS = [0, 45, -45, 90, -90];

export function hueShift(p: Participant, all: Participant[]): number {
  const siblings = all.filter((o) => o.provider === p.provider);
  if (siblings.length < 2) return 0;
  const n = (p.ordinal ?? siblings.findIndex((o) => o.id === p.id) + 1) - 1;
  return HUE_SHIFTS[n % HUE_SHIFTS.length];
}

/** The CSS color for a participant: its provider's, turned by its hue shift. */
export function participantColor(p: Participant, all: Participant[]): string {
  const shift = hueShift(p, all);
  return shift ? `oklch(from var(--${p.provider}) l c calc(h + ${shift}))` : `var(--${p.provider})`;
}
