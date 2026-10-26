/**
 * ministryLtTabs.ts — browser-style tabs for the Dock's Lower Thirds section.
 *
 * Each tab remembers its own theme, size and content slots, so an operator can keep
 * several lower thirds ready and switch between them. The + button clones the current
 * tab. How many tabs a church gets depends on its plan. Tabs can be renamed, and pinned
 * tabs sit at the start of the row and can't be closed.
 */

import type { LTSize } from "../lowerthirds/types";

export interface MinistryLtTab {
  id: string;
  /** ltEntryKey() of the chosen theme; null until one is picked. */
  themeKey: string | null;
  size?: LTSize;
  /** Name the operator gave the tab; unnamed tabs show "Tab N". */
  name?: string;
  pinned?: boolean;
}

/** Long enough for "Pastor's welcome", short enough to keep the tab row tidy. */
export const LT_TAB_NAME_MAX = 24;

export const MINISTRY_LT_TABS_STORAGE_KEY = "dock-ministry-lower-third-tabs";
/** The first tab keeps the slots the single editor used before tabs existed. */
export const FIRST_LT_TAB_ID = "main";

/** -1 = unlimited. Free has one tab (the + button is disabled). */
const LT_TAB_LIMITS: Record<string, number> = {
  free: 1,
  basic: 3,
  growth: 10,
  pro: -1,
};

export function ltTabLimitForPlan(plan: string | null | undefined): number {
  const key = String(plan || "free").trim().toLowerCase();
  return LT_TAB_LIMITS[key] ?? 1;
}

export function canAddLtTab(count: number, limit: number): boolean {
  return limit < 0 || count < limit;
}

/** Tabs the plan allows; extra tabs from a higher plan are kept but hidden until an upgrade. */
export function usableLtTabs(tabs: MinistryLtTab[], limit: number): MinistryLtTab[] {
  return limit < 0 ? tabs : tabs.slice(0, Math.max(1, limit));
}

/** Content-slot editor id for a tab. */
export function ltTabEditorId(tab: Pick<MinistryLtTab, "id">): string {
  return tab.id === FIRST_LT_TAB_ID ? "default" : `tab-${tab.id}`;
}

export function createFirstLtTab(themeKey: string | null, size?: LTSize): MinistryLtTab {
  return { id: FIRST_LT_TAB_ID, themeKey, ...(size ? { size } : {}) };
}

export function newLtTabId(existing: MinistryLtTab[]): string {
  const taken = new Set(existing.map((t) => t.id));
  let id = "";
  do {
    id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  } while (taken.has(id));
  return id;
}

/** Pinned tabs first; otherwise the order is kept. */
export function orderLtTabs(tabs: MinistryLtTab[]): MinistryLtTab[] {
  const pinned = tabs.filter((t) => t.pinned);
  if (pinned.length === 0 || pinned.length === tabs.length) return tabs;
  return [...pinned, ...tabs.filter((t) => !t.pinned)];
}

/** Insert a copy of `source` right after it. The copy keeps the content but not the name or pin. */
export function cloneLtTab(tabs: MinistryLtTab[], sourceId: string, newId: string): MinistryLtTab[] {
  const index = tabs.findIndex((t) => t.id === sourceId);
  if (index < 0) return tabs;
  const { name: _name, pinned: _pinned, ...content } = tabs[index];
  const copy: MinistryLtTab = { ...content, id: newId };
  return orderLtTabs([...tabs.slice(0, index + 1), copy, ...tabs.slice(index + 1)]);
}

/** Trimmed, single-line and capped; undefined when nothing is left. */
export function cleanLtTabName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const name = Array.from(raw.replace(/\s+/g, " ").trim()).slice(0, LT_TAB_NAME_MAX).join("").trim();
  return name || undefined;
}

/** Rename a tab. An empty name keeps the previous one. */
export function renameLtTab(tabs: MinistryLtTab[], id: string, raw: string): MinistryLtTab[] {
  const name = cleanLtTabName(raw);
  const tab = tabs.find((t) => t.id === id);
  if (!name || !tab || tab.name === name) return tabs;
  return updateLtTab(tabs, id, { name });
}

/** Pin moves a tab to the end of the pinned group; unpin moves it to the start of the rest. */
export function setLtTabPinned(tabs: MinistryLtTab[], id: string, pinned: boolean): MinistryLtTab[] {
  const tab = tabs.find((t) => t.id === id);
  if (!tab || Boolean(tab.pinned) === pinned) return tabs;
  const others = tabs.filter((t) => t.id !== id);
  const changed: MinistryLtTab = { ...tab };
  if (pinned) changed.pinned = true;
  else delete changed.pinned;
  const pinnedCount = others.filter((t) => t.pinned).length;
  return orderLtTabs([...others.slice(0, pinnedCount), changed, ...others.slice(pinnedCount)]);
}

/** Remove a tab (never the last one, never a pinned one) and say which tab to show next. */
export function closeLtTab(
  tabs: MinistryLtTab[],
  closingId: string,
  activeId: string,
): { tabs: MinistryLtTab[]; activeId: string } {
  if (tabs.length <= 1) return { tabs, activeId };
  const index = tabs.findIndex((t) => t.id === closingId);
  if (index < 0 || tabs[index].pinned) return { tabs, activeId };
  const next = tabs.filter((t) => t.id !== closingId);
  if (closingId !== activeId) return { tabs: next, activeId };
  return { tabs: next, activeId: next[Math.min(index, next.length - 1)].id };
}

export function updateLtTab(tabs: MinistryLtTab[], id: string, patch: Partial<Omit<MinistryLtTab, "id">>): MinistryLtTab[] {
  return tabs.map((t) => (t.id === id ? { ...t, ...patch } : t));
}

/** Read the saved tabs; null when there are none (or the value is not usable). */
export function parseLtTabs(raw: unknown): { tabs: MinistryLtTab[]; activeId: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as { tabs?: unknown; activeId?: unknown };
  if (!Array.isArray(data.tabs)) return null;
  const seen = new Set<string>();
  let tabs: MinistryLtTab[] = [];
  for (const item of data.tabs) {
    if (!item || typeof item !== "object") continue;
    const { id, themeKey, size, name, pinned } = item as Record<string, unknown>;
    const cleanName = cleanLtTabName(name);
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    seen.add(id);
    tabs.push({
      id,
      themeKey: typeof themeKey === "string" ? themeKey : null,
      ...(typeof size === "string" ? { size: size as LTSize } : {}),
      ...(cleanName ? { name: cleanName } : {}),
      ...(pinned === true ? { pinned: true } : {}),
    });
  }
  if (tabs.length === 0) return null;
  tabs = orderLtTabs(tabs);
  const activeId = typeof data.activeId === "string" && seen.has(data.activeId) ? data.activeId : tabs[0].id;
  return { tabs, activeId };
}
