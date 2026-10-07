export const SIDEBAR = { min: 180, max: 480, initial: 240 };

export function clampSidebarWidth(px: number): number {
  return Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, Math.round(px)));
}
