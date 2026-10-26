import { describe, expect, it } from "vitest";
import {
  canAddLtTab,
  cleanLtTabName,
  cloneLtTab,
  closeLtTab,
  FIRST_LT_TAB_ID,
  ltTabEditorId,
  LT_TAB_NAME_MAX,
  ltTabLimitForPlan,
  orderLtTabs,
  parseLtTabs,
  renameLtTab,
  setLtTabPinned,
  usableLtTabs,
  type MinistryLtTab,
} from "./ministryLtTabs";

const tabs: MinistryLtTab[] = [
  { id: FIRST_LT_TAB_ID, themeKey: "lt:a", size: "sm" },
  { id: "b", themeKey: "lt:b" },
  { id: "c", themeKey: null },
];

describe("ministry lower-third tabs", () => {
  it("limits tabs by plan", () => {
    expect(ltTabLimitForPlan("free")).toBe(1);
    expect(ltTabLimitForPlan("basic")).toBe(3);
    expect(ltTabLimitForPlan("growth")).toBe(10);
    expect(ltTabLimitForPlan("pro")).toBe(-1);
    expect(ltTabLimitForPlan(undefined)).toBe(1);
    expect(canAddLtTab(1, 1)).toBe(false);
    expect(canAddLtTab(2, 3)).toBe(true);
    expect(canAddLtTab(3, 3)).toBe(false);
    expect(canAddLtTab(500, -1)).toBe(true);
    expect(usableLtTabs(tabs, 1).map((t) => t.id)).toEqual([FIRST_LT_TAB_ID]);
    expect(usableLtTabs(tabs, -1)).toHaveLength(3);
  });

  it("clones a tab right after its source", () => {
    const next = cloneLtTab(tabs, FIRST_LT_TAB_ID, "x");
    expect(next.map((t) => t.id)).toEqual([FIRST_LT_TAB_ID, "x", "b", "c"]);
    expect(next[1]).toEqual({ id: "x", themeKey: "lt:a", size: "sm" });
  });

  it("closes a tab and picks a neighbour", () => {
    expect(closeLtTab(tabs, "b", "b")).toEqual({ tabs: [tabs[0], tabs[2]], activeId: "c" });
    expect(closeLtTab(tabs, "c", "c").activeId).toBe("b");
    expect(closeLtTab(tabs, "c", FIRST_LT_TAB_ID).activeId).toBe(FIRST_LT_TAB_ID);
    expect(closeLtTab([tabs[0]], FIRST_LT_TAB_ID, FIRST_LT_TAB_ID).tabs).toHaveLength(1);
  });

  it("keeps the first tab on the original slots", () => {
    expect(ltTabEditorId({ id: FIRST_LT_TAB_ID })).toBe("default");
    expect(ltTabEditorId({ id: "b" })).toBe("tab-b");
  });

  it("reads saved tabs defensively", () => {
    expect(parseLtTabs(null)).toBeNull();
    expect(parseLtTabs({ tabs: [] })).toBeNull();
    expect(parseLtTabs({ tabs: [{ id: "a", themeKey: 3 }, { id: "a" }, "x"], activeId: "zzz" })).toEqual({
      tabs: [{ id: "a", themeKey: null }],
      activeId: "a",
    });
  });

  it("cleans tab names", () => {
    expect(cleanLtTabName("  Pastor   welcome \n")).toBe("Pastor welcome");
    expect(cleanLtTabName("   ")).toBeUndefined();
    expect(cleanLtTabName(42)).toBeUndefined();
    expect(cleanLtTabName("x".repeat(80))).toHaveLength(LT_TAB_NAME_MAX);
  });

  it("renames a tab and keeps the old name when the new one is empty", () => {
    const named = renameLtTab(tabs, "b", "  Announcements ");
    expect(named[1]).toEqual({ id: "b", themeKey: "lt:b", name: "Announcements" });
    expect(renameLtTab(named, "b", "   ")).toBe(named);
    expect(renameLtTab(named, "b", "Announcements")).toBe(named);
    expect(renameLtTab(named, "missing", "X")).toBe(named);
  });

  it("puts pinned tabs first and keeps the rest in order", () => {
    const pinnedC = setLtTabPinned(tabs, "c", true);
    expect(pinnedC.map((t) => t.id)).toEqual(["c", FIRST_LT_TAB_ID, "b"]);
    expect(pinnedC[0].pinned).toBe(true);
    const pinnedCB = setLtTabPinned(pinnedC, "b", true);
    expect(pinnedCB.map((t) => t.id)).toEqual(["c", "b", FIRST_LT_TAB_ID]);
    // Unpinning lands at the start of the unpinned tabs.
    const unpinnedC = setLtTabPinned(pinnedCB, "c", false);
    expect(unpinnedC.map((t) => t.id)).toEqual(["b", "c", FIRST_LT_TAB_ID]);
    expect("pinned" in unpinnedC[1]).toBe(false);
    expect(setLtTabPinned(pinnedC, "c", true)).toBe(pinnedC);
    expect(orderLtTabs(tabs)).toBe(tabs);
  });

  it("keeps an unnamed tab's label when pinning moves it", () => {
    // The Dock names a tab after its "Tab N" label before pinning it.
    const pinned = setLtTabPinned(renameLtTab(tabs, "c", "Tab 3"), "c", true);
    expect(pinned[0]).toEqual({ id: "c", themeKey: null, name: "Tab 3", pinned: true });
    const named = renameLtTab(tabs, "b", "Sermon");
    expect(renameLtTab(named, "b", "Sermon")).toBe(named);
  });

  it("won't close a pinned tab", () => {
    const pinned = setLtTabPinned(tabs, "b", true);
    expect(closeLtTab(pinned, "b", "b")).toEqual({ tabs: pinned, activeId: "b" });
    expect(closeLtTab(pinned, "c", "c").tabs.map((t) => t.id)).toEqual(["b", FIRST_LT_TAB_ID]);
  });

  it("clones without the name or pin, after the pinned tabs", () => {
    const pinned = renameLtTab(setLtTabPinned(tabs, "b", true), "b", "Sermon");
    const next = cloneLtTab(pinned, "b", "x");
    expect(next.map((t) => t.id)).toEqual(["b", "x", FIRST_LT_TAB_ID, "c"]);
    expect(next[1]).toEqual({ id: "x", themeKey: "lt:b" });
  });

  it("saves and loads names and pins", () => {
    const edited = renameLtTab(setLtTabPinned(tabs, "c", true), "c", "Welcome");
    const roundTrip = parseLtTabs(JSON.parse(JSON.stringify({ tabs: edited, activeId: "c" })));
    expect(roundTrip).toEqual({ tabs: edited, activeId: "c" });
  });

  it("loads tabs saved before names and pins existed", () => {
    const old = { tabs: [{ id: FIRST_LT_TAB_ID, themeKey: "lt:a", size: "sm" }, { id: "b", themeKey: "lt:b" }], activeId: "b" };
    expect(parseLtTabs(old)).toEqual(old);
  });

  it("cleans bad saved names and pins and puts pinned tabs first", () => {
    const parsed = parseLtTabs({
      tabs: [
        { id: "a", themeKey: null, name: "   ", pinned: "yes" },
        { id: "b", themeKey: null, name: "  Offering  ", pinned: true },
      ],
    });
    expect(parsed?.tabs).toEqual([
      { id: "b", themeKey: null, name: "Offering", pinned: true },
      { id: "a", themeKey: null },
    ]);
  });
});
