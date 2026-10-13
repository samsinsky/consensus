import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { stackCards } from './marginLayout.js';

type Item = { key: string; anchor: number; node: ReactNode };
type Props = { header: ReactNode; footer: ReactNode; items: Item[]; focused?: string; topOf: (pos: number) => number; version: number };

/** Notes pinned on top, then one card per proposal level with its text, then the resolved line. */
export function Margin({ header, footer, items, focused, topOf, version }: Props) {
  const area = useRef<HTMLDivElement>(null);
  const [tops, setTops] = useState<Record<string, number>>({});

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const areaTop = el.getBoundingClientRect().top;
    const measured = items.map((i) => ({
      id: i.key,
      top: topOf(i.anchor) - areaTop,
      height: (el.querySelector(`[data-card="${CSS.escape(i.key)}"]`) as HTMLElement | null)?.offsetHeight ?? 0,
    }));
    const next = stackCards(measured, focused);
    setTops((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  });

  const bottom = Math.max(0, ...items.map((i) => (tops[i.key] ?? 0) + 200));
  return (
    <aside className="margin">
      <div className="notes">{header}</div>
      <div className="cards" ref={area} style={{ minHeight: bottom }} data-version={version}>
        {items.map((i) => (
          <div key={i.key} data-card={i.key} className="card-slot" style={{ top: tops[i.key] ?? 0 }}>
            {i.node}
          </div>
        ))}
      </div>
      {footer}
    </aside>
  );
}
