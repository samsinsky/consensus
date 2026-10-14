import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { stackCards } from './marginLayout.js';

type Item = { key: string; anchor: number; node: ReactNode };
type Props = { header: ReactNode; footer: ReactNode; items: Item[]; focused?: string; topOf: (pos: number) => number; version: number };

/** Notes pinned on top, then one card per proposal level with its text, then the resolved line. */
export function Margin({ header, footer, items, focused, topOf, version }: Props) {
  const area = useRef<HTMLDivElement>(null);
  const aside = useRef<HTMLElement>(null);
  const [tops, setTops] = useState<Record<string, number>>({});

  const slots = useRef(new Map<string, HTMLElement>());
  const measure = () => {
    const el = area.current;
    if (!el) return;
    // The margin scrolls on its own, so measure in its content coordinates; topOf does the same for the document.
    const box = aside.current;
    const areaTop = el.getBoundingClientRect().top - (box ? box.getBoundingClientRect().top - box.scrollTop : 0);
    const measured = items.map((i) => ({
      id: i.key,
      top: topOf(i.anchor) - areaTop,
      height: slots.current.get(i.key)?.offsetHeight ?? 0,
    }));
    const next = stackCards(measured, focused);
    setTops((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  };
  // Always call the latest closure, so the observer never measures with stale items.
  const latest = useRef(measure);
  latest.current = measure;

  useLayoutEffect(measure);

  // Cards grow on their own (reply errors, expanded answers), and the window or fonts can change: re-measure on any slot resize.
  const keys = items.map((i) => i.key).join('\u0000');
  useLayoutEffect(() => {
    const el = area.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => latest.current());
    slots.current.forEach((slot) => ro.observe(slot));
    ro.observe(el);
    return () => ro.disconnect();
  }, [keys]);

  // Bring the picked card into view when its text is clicked.
  useEffect(() => {
    if (focused) slots.current.get(focused)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [focused]);

  const bottom = Math.max(0, ...items.map((i) => (tops[i.key] ?? 0) + 200));
  return (
    <aside className="margin" ref={aside}>
      <div className="notes">{header}</div>
      <div className="cards" ref={area} style={{ minHeight: bottom }} data-version={version}>
        {items.map((i) => (
          <div
            key={i.key}
            data-card={i.key}
            ref={(n) => { if (n) slots.current.set(i.key, n); else slots.current.delete(i.key); }}
            className="card-slot" style={{ top: tops[i.key] ?? 0 }}>
            {i.node}
          </div>
        ))}
      </div>
      {footer}
    </aside>
  );
}
