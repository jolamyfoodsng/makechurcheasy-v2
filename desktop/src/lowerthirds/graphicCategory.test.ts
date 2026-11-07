import { describe, expect, it } from "vitest";
import { BUNDLED_GRAPHIC_PACKAGES } from "./bundledGraphicPackages";
import { graphicCategoryOf, isNewGraphic, NEW_GRAPHIC_DAYS, splitNewGraphics } from "./graphicCategory";
import { packageToTheme } from "./graphicPackages";

const DAY = 24 * 60 * 60 * 1000;
const theme = (id: string, addedAt?: string) => ({ id, addedAt });

describe("new graphics", () => {
  const now = Date.parse("2026-11-10");

  it("counts a graphic as new for a limited time after it was added", () => {
    expect(isNewGraphic(theme("a", "2026-11-05"), now)).toBe(true);
    expect(isNewGraphic(theme("a", "2026-11-05"), Date.parse("2026-11-05") + (NEW_GRAPHIC_DAYS + 1) * DAY)).toBe(false);
    expect(isNewGraphic(theme("a"), now)).toBe(false);
    expect(isNewGraphic(theme("a", "not a date"), now)).toBe(false);
  });

  it("puts new graphics first, newest first, and keeps the rest in order", () => {
    const list = [theme("old1"), theme("new-a", "2026-11-01"), theme("old2"), theme("new-b", "2026-11-05")];
    const { fresh, rest } = splitNewGraphics(list, (t) => t, now);
    expect(fresh.map((t) => t.id)).toEqual(["new-b", "new-a"]);
    expect(rest.map((t) => t.id)).toEqual(["old1", "old2"]);
  });

  it("carries the added date, search tags and category into the library", () => {
    const pkg = BUNDLED_GRAPHIC_PACKAGES.find((p) => p.id === "corner-logo-turn")!;
    const t = packageToTheme(pkg);
    expect(t.addedAt).toBe(pkg.addedAt);
    expect(t.tags).toEqual(expect.arrayContaining(["Logo", "Rotate"]));
    expect(graphicCategoryOf(t)).toBe("branding");
  });
});
