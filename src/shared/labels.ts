import { PROVIDERS, type Participant } from './types.js';

export function modelLabel(model: string, effort?: string): string {
  return effort ? `${model} ${effort}` : model;
}

export function participantLabel(p: Participant, all: Participant[]): string {
  const base = `${PROVIDERS[p.provider].name} · ${modelLabel(p.model, p.effort)}`;
  const twins = all.filter(
    (o) => o.provider === p.provider && o.model === p.model && o.effort === p.effort,
  );
  if (twins.length < 2) return base;
  return `${base} #${twins.findIndex((o) => o.id === p.id) + 1}`;
}
