import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import dockBibleTabSource from "./DockBibleTab.tsx?raw";

const dockCssSource = readFileSync(fileURLToPath(new URL("../dock.css", import.meta.url)), "utf8");

describe("DockBibleTab bottom toolbar and picker refinements", () => {
  it("removes verse navigation arrow keys from the bottom toolbar", () => {
    // verse-nav container should no longer be rendered inside DockBottomToolbar
    expect(dockBibleTabSource).not.toContain('className="dock-bible-reader__verse-nav"');
    expect(dockBibleTabSource).not.toContain('className="dock-bible-reader__verse-nav-btn"');
  });

  it("promotes Quick Edit outside the three dots in centerAction", () => {
    expect(dockBibleTabSource).toContain('centerAction={\n                <button\n                  type="button"\n                  className="dock-bible-reader__quick-edit-toolbar-btn"');
    expect(dockBibleTabSource).toContain('onClick={() => openThemeSettings("text")}');
    expect(dockBibleTabSource).toContain('dock-bible-reader__quick-edit-label');
  });

  it("merges top actions into the bottom toolbar overflow menu", () => {
    // The actions menu holds Compare, History and Reload
    expect(dockBibleTabSource).toContain("setShowBibleActionsMenu(false);\n                      setShowComparePopover(true);");
    expect(dockBibleTabSource).toContain("setShowBibleActionsMenu(false);\n                      setShowBibleHistory(true);");
    expect(dockBibleTabSource).toContain("setShowBibleActionsMenu(false);\n                      window.location.reload();");
    expect(dockBibleTabSource).toContain('data-dock-compare-trigger="true"');
  });

  it("renders the Compare Translations popover portal at top-level with z-index 20000", () => {
    expect(dockBibleTabSource).toContain("renderComparePopover()");
    expect(dockBibleTabSource).toContain("zIndex: 20000");
    expect(dockCssSource).toContain(".dock-bible-compare-popover,\n.dock-bible-reference-popover {\n  position: absolute;\n  top: calc(100% + 6px);\n  right: 0;\n  z-index: 20000;");
  });

  it("uses book initials and compact 5-column book grid and 6-column chapter grid", () => {
    expect(dockBibleTabSource).toContain("getBookInitials(b)");
    expect(dockBibleTabSource).toContain("BIBLE_BOOK_INITIALS");
    expect(dockCssSource).toContain(".dock-bible-picker-books-grid {\n  display: grid;\n  grid-template-columns: repeat(5, 1fr);");
    expect(dockCssSource).toContain(".dock-bible-picker-chapters-grid {\n  display: grid;\n  grid-template-columns: repeat(6, 1fr);");
    expect(dockCssSource).toContain(".dock-bible-chapter-bar:has(.dock-bible-picker-popover),\n.dock-bible-chapter-bar--picker-open {\n  z-index: 10005;\n}");
    expect(dockCssSource).toContain("z-index: 10010;");
  });

  it("scales search font size relative to dock font scale", () => {
    expect(dockCssSource).toContain("font-size: clamp(10.5px, calc(11.5px * var(--dock-font-scale, 1)), 13px);");
  });
});
