/**
 * planLocks.ts — which ready-made themes a plan may use.
 *
 * A plan's `themes` limit (Free 2, Basic 10, Growth unlimited) is the number of
 * ready-made themes that are open: the FIRST N of the curated list (BUILTIN_THEMES
 * order, so the new-account themes always come first). The rest show a lock and open the
 * upgrade modal. Themes a church made itself are never locked (the create limit
 * covers those), and a theme that is already selected stays usable, so a church
 * that moves down a plan never loses the look it is live with.
 *
 * Imported themes (from EasyWorship) are content the plan pays for, like songs: importing is
 * free, but only the first N imported themes stay open, so themes brought in during a trial
 * lock when the church moves to Free.
 *
 * Pure functions only: the Themes page and the Dock theme browser share this.
 */
import type { BibleTheme } from "../bible/types";
import { BUILTIN_THEMES } from "../bible/themes/builtinThemes";

type LockableTheme = Pick<BibleTheme, "id" | "source"> & Partial<Pick<BibleTheme, "createdAt">>;

/** Themes created by an import (see buildEasyWorshipThemes) rather than by the church. */
export function isImportedTheme(theme: Pick<BibleTheme, "id">): boolean {
  return theme.id.startsWith("easyworship-");
}

/** Ids of the ready-made themes a plan with this limit may use (-1 = every one). */
export function planOpenThemeIds(limit: number): Set<string> {
  const ids = BUILTIN_THEMES.map((theme) => theme.id);
  return new Set(limit < 0 ? ids : ids.slice(0, Math.max(0, limit)));
}

/**
 * Ids in `themes` that the plan locks. `keepIds` stay open (selected / in use).
 * A limit of -1 (or Infinity) locks nothing.
 */
export function planLockedThemeIds(
  themes: readonly LockableTheme[],
  limit: number,
  keepIds: Iterable<string | null | undefined> = [],
): Set<string> {
  const locked = new Set<string>();
  if (limit < 0 || limit === Infinity) return locked;
  const open = planOpenThemeIds(limit);
  const keep = new Set<string>();
  for (const id of keepIds) if (id) keep.add(id);
  // The first N imported themes (oldest first, so the open ones don't change between screens).
  const openImported = new Set(
    themes
      .filter(isImportedTheme)
      .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id))
      .slice(0, Math.max(0, limit))
      .map((theme) => theme.id),
  );
  for (const theme of themes) {
    if (isImportedTheme(theme)) {
      if (!openImported.has(theme.id) && !keep.has(theme.id)) locked.add(theme.id);
      continue;
    }
    if (theme.source === "custom") continue;
    if (open.has(theme.id) || keep.has(theme.id)) continue;
    locked.add(theme.id);
  }
  return locked;
}

/** One line for the upgrade modal. */
export function lockedThemeMessage(limit: number): string {
  return limit <= 0
    ? "Your plan doesn't include the ready-made themes. Upgrade to use them."
    : `Your plan includes the first ${limit} ready-made themes. Upgrade to unlock this one and the rest.`;
}
