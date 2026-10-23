import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES } from "../bible/themes/builtinThemes";
import { STARTER_DEFAULT_THEME_ID } from "./layout/presetThemes";
import { lockedThemeMessage, planLockedThemeIds, planOpenThemeIds } from "./planLocks";

const builtins = BUILTIN_THEMES.map((theme) => ({ id: theme.id, source: theme.source }));

describe("plan theme locks", () => {
  it("opens the first N ready-made themes, the default first", () => {
    const open = [...planOpenThemeIds(2)];
    expect(open).toHaveLength(2);
    expect(open[0]).toBe(STARTER_DEFAULT_THEME_ID);
    expect(planLockedThemeIds(builtins, 2).size).toBe(builtins.length - 2);
    expect(planLockedThemeIds(builtins, 2).has(open[0])).toBe(false);
  });

  it("locks nothing on an unlimited plan", () => {
    expect(planLockedThemeIds(builtins, -1).size).toBe(0);
    expect(planLockedThemeIds(builtins, Infinity).size).toBe(0);
  });

  it("never locks a church's own themes", () => {
    const own = { id: "custom-1", source: "custom" as const };
    expect(planLockedThemeIds([...builtins, own], 0).has("custom-1")).toBe(false);
  });

  it("locks EasyWorship themes past the plan's limit, so a trial import isn't free on Free", () => {
    const imported = ["c", "a", "b"].map((name, i) => ({
      id: `easyworship-${name}`, source: "custom" as const, createdAt: `2026-10-0${i + 1}T00:00:00Z`,
    }));
    const locked = planLockedThemeIds([...builtins, ...imported], 2);
    // The two imported first stay open, the third locks; the church's own themes still never lock.
    expect(["easyworship-c", "easyworship-a", "easyworship-b"].map((id) => locked.has(id))).toEqual([false, false, true]);
    expect(planLockedThemeIds([...builtins, ...imported], -1).size).toBe(0);
    expect(planLockedThemeIds(imported, 2, ["easyworship-b"]).size).toBe(0);
  });

  it("keeps the selected / in-use theme open", () => {
    const last = builtins[builtins.length - 1].id;
    expect(planLockedThemeIds(builtins, 2).has(last)).toBe(true);
    expect(planLockedThemeIds(builtins, 2, [last]).has(last)).toBe(false);
  });

  it("phrases the upgrade message", () => {
    expect(lockedThemeMessage(2)).toContain("first 2");
    expect(lockedThemeMessage(0)).toContain("doesn't include");
  });
});
