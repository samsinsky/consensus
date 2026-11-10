import type { CSSProperties } from 'react';
import { participantColor } from '../../shared/labels.js';
import type { Participant } from '../../shared/types.js';

/** A participant's color dot, in its own shade when it shares a provider with another participant. */
export function Dot({ p, all }: { p: Participant | undefined; all: Participant[] }) {
  if (!p) return <span className="dot" />;
  return <span className={`dot ${p.provider}`} style={{ '--who': participantColor(p, all) } as CSSProperties} />;
}
