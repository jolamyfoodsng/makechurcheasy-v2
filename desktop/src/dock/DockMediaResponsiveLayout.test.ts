import { describe, expect, it } from "vitest";
import dockMediaTabSource from "./tabs/DockMediaTab.tsx?raw";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dockCssSource = readFileSync(fileURLToPath(new URL("./dock.css", import.meta.url)), "utf8");

describe("Dock Media responsive layout", () => {
  it("keeps the left rail exclusive to short-height docks", () => {
    expect(dockMediaTabSource).toContain('isCompactHeight ? " dock-media-console--short-height" : ""');
    expect(dockMediaTabSource).not.toContain('isNarrowWidth || isCompactHeight ? " dock-media-console--narrow"');
    expect(dockMediaTabSource).toContain('aria-orientation={isCompactHeight ? "vertical" : "horizontal"}');
    expect(dockCssSource).toContain(".dock-media-console--short-height .dock-media-tabs-column");
    expect(dockCssSource).not.toContain(".dock-media-console--narrow .dock-media-tabs-column");
  });

  it("includes ultra-compact height rules and shortened labels for docks <= 400px", () => {
    expect(dockMediaTabSource).toContain('isUltraCompactHeight ? " dock-media-console--ultra-compact" : ""');
    expect(dockMediaTabSource).toContain("{ id: \"recent\", label: t('media.recentlyUsed') }");
    expect(dockMediaTabSource).toContain("{ id: \"uploaded\", label: t('media.newlyUploaded') }");
    expect(dockCssSource).toContain(".dock-media-console--ultra-compact .dock-media-list");
    expect(dockCssSource).toContain(".dock-media-console--ultra-compact .dock-media-pill");
    expect(dockCssSource).toContain("@media (max-height: 400px)");
  });

  it("shows tab text labels alongside icons when width is sufficient, with templates hidden from visible bar", () => {
    expect(dockMediaTabSource).not.toContain("{useCompactMediaTabs ? <Icon name=\"upload\"");
    expect(dockMediaTabSource).not.toContain("{useCompactMediaTabs ? <Icon name=\"collections\"");
    expect(dockMediaTabSource).not.toContain("{useCompactMediaTabs ? <Icon name=\"grid_view\"");
    expect(dockMediaTabSource).toContain("{t('media.uploads')}");
    expect(dockMediaTabSource).toContain("{t('media.tabAnimations')}");
    expect(dockMediaTabSource).toContain("{t('media.patterns', 'Patterns')}");
    expect(dockMediaTabSource).toContain("{t('media.tabText')}");
    expect(dockMediaTabSource).toContain("dock-media-tab__label");
    expect(dockMediaTabSource).toContain("name=\"perm_media\"");
    expect(dockMediaTabSource).toContain("name=\"movie\"");
    expect(dockMediaTabSource).toContain("name=\"grid_view\"");
    expect(dockMediaTabSource).toContain("name=\"title\"");
    // Templates tab is preserved in the code logic/types but excluded from the visible tabs bar
    expect(dockMediaTabSource).not.toContain("setBrowserTab(\"templates\")");
    expect(dockCssSource).toContain(".dock-media-tabs {\n  display: flex;\n  gap: 0;\n  border-bottom: 1px solid var(--dock-border-soft);\n  overflow-x: auto;");
    expect(dockCssSource).toContain(".dock-media-tabs--compact .dock-media-tab__label {\n  display: none;\n}");
  });
});

