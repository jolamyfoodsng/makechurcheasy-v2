/**
 * graphicCategory.ts — which library category a graphic belongs to (Speaker, Giving, Welcome, ...).
 * Same rules the Broadcast Graphics page uses, kept here so the Studio drawer lists the same groups.
 */
import type { LowerThirdTheme } from "./types";

export const GRAPHIC_CATEGORY_TABS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "mine", label: "My graphics" },
  { key: "speaker", label: "Speaker" },
  { key: "service", label: "Service" },
  { key: "welcome", label: "Welcome" },
  { key: "giving", label: "Giving" },
  { key: "subscribe", label: "Subscribe" },
  { key: "announcements", label: "Announcements" },
  { key: "countdown", label: "Countdown" },
  { key: "social", label: "Social Media" },
  { key: "branding", label: "Logo & Branding" },
  { key: "scripture", label: "Scripture" },
  { key: "quotes", label: "Quotes" },
  { key: "others", label: "Others" },
];

/** How long a graphic counts as new: listed first in the library and marked "New". */
export const NEW_GRAPHIC_DAYS = 45;
const DAY_MS = 24 * 60 * 60 * 1000;

/** When the graphic joined the library (ms), or 0 when it doesn't say. */
export function graphicAddedAt(theme: object): number {
  const raw = (theme as { addedAt?: unknown }).addedAt;
  const ms = typeof raw === "string" ? Date.parse(raw) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

export function isNewGraphic(theme: object, now = Date.now()): boolean {
  const added = graphicAddedAt(theme);
  return added > 0 && now - added < NEW_GRAPHIC_DAYS * DAY_MS;
}

/** Splits a list into the new graphics (newest first) and the rest (order kept). */
export function splitNewGraphics<T>(items: T[], themeOf: (item: T) => object, now = Date.now()): { fresh: T[]; rest: T[] } {
  const fresh: T[] = [];
  const rest: T[] = [];
  for (const item of items) (isNewGraphic(themeOf(item), now) ? fresh : rest).push(item);
  fresh.sort((a, b) => graphicAddedAt(themeOf(b)) - graphicAddedAt(themeOf(a)));
  return { fresh, rest };
}

const KEYS = new Set(GRAPHIC_CATEGORY_TABS.map((c) => c.key).filter((k) => k !== "all" && k !== "mine"));

export function graphicCategoryOf(theme: Pick<LowerThirdTheme, "id" | "name" | "category" | "tags"> & { graphicCategory?: string }): string {
  const own = String(theme.graphicCategory || "").toLowerCase();
  if (KEYS.has(own)) return own;
  const tags = (theme.tags || []).map((t) => t.toLowerCase());
  const id = theme.id.toLowerCase();
  const name = theme.name.toLowerCase();
  if (tags.includes("speaker") || theme.category === "speaker") return "speaker";
  if (tags.includes("welcome") || name.includes("welcome") || id.includes("join") || id.includes("guest") || id.includes("connect")) return "welcome";
  if (tags.includes("giving") || name.includes("giving") || id.includes("give") || id.includes("tithe") || id.includes("offering")) return "giving";
  if (tags.includes("subscribe") || id.includes("sub-") || id.includes("subscribe")) return "subscribe";
  if (tags.includes("announcement") || name.includes("announcement") || id.includes("service-times") || id.includes("kids-checkin") || id.includes("event") || id.includes("baptism")) return "announcements";
  if (tags.includes("countdown") || name.includes("countdown") || id.includes("countdown")) return "countdown";
  if (tags.includes("social") || name.includes("social") || id.includes("handle") || id.includes("website")) return "social";
  if (tags.includes("scripture") || theme.category === "bible" || id.includes("prayer")) return "scripture";
  return "others";
}
