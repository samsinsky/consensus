/**
 * Tops for margin cards so none overlap. Cards keep their text order; the focused card sits level with its
 * text, earlier cards move up and later ones down. If that would push a card above 0, everything shifts down.
 */
export function stackCards(items: { id: string; top: number; height: number }[], focused?: string, gap = 8): Record<string, number> {
  const sorted = [...items].sort((a, b) => a.top - b.top || a.id.localeCompare(b.id));
  const tops: Record<string, number> = {};
  const k = focused ? sorted.findIndex((i) => i.id === focused) : -1;
  const from = k >= 0 ? k : 0;
  let y = -Infinity;
  for (let i = from; i < sorted.length; i++) {
    const t = Math.max(sorted[i].top, y);
    tops[sorted[i].id] = t;
    y = t + sorted[i].height + gap;
  }
  let bottom = k >= 0 ? tops[sorted[k].id] - gap : Infinity;
  for (let i = from - 1; i >= 0; i--) {
    const t = Math.min(sorted[i].top, bottom - sorted[i].height);
    tops[sorted[i].id] = t;
    bottom = t - gap;
  }
  const min = Math.min(0, ...Object.values(tops));
  if (min < 0) for (const id of Object.keys(tops)) tops[id] -= min;
  return tops;
}
