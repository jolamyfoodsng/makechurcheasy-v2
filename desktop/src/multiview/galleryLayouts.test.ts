import { describe, expect, it } from "vitest";
import { GALLERY_CATEGORIES, GALLERY_LAYOUTS } from "./galleryLayouts";
import { TEMPLATE_LIBRARY } from "./templates";

describe("gallery language", () => {
  it("describes source-neutral layouts instead of implying bundled cameras or logos", () => {
    const cameraLabels = GALLERY_LAYOUTS.flatMap((layout) =>
      layout.slots.filter((slot) => slot.contentType === "camera").map((slot) => slot.label),
    );

    expect(cameraLabels.length).toBeGreaterThan(0);
    for (const label of cameraLabels) {
      expect(label.toLowerCase()).not.toContain("camera");
    }
  });

  it("uses layout-focused category labels", () => {
    expect(GALLERY_CATEGORIES.find((category) => category.key === "cameras")?.label).toBe("Multi-source");
    expect(GALLERY_CATEGORIES.find((category) => category.key === "hybrid")?.label).toBe("Combined");
  });
});

describe("multimedia scene portrait layout", () => {
  it("exposes separate full-canvas and portrait scene slots", () => {
    const layout = GALLERY_LAYOUTS.find((item) => item.id === "multimedia-scene-portrait");

    expect(layout).toBeDefined();
    expect(layout?.category).toBe("multimedia");
    expect(layout?.defaultFrameId).toBe("clean-white-round");
    expect(layout?.slots).toEqual([
      expect.objectContaining({
        id: "multimedia-background",
        label: "Background Scene",
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        zIndex: 1,
      }),
      expect.objectContaining({
        id: "multimedia-portrait",
        label: "Portrait / Short-form Scene",
        x: 72,
        y: 72,
        width: 520,
        height: 936,
        zIndex: 2,
      }),
    ]);
    expect(layout?.defaultSlotFrames).toEqual({
      "multimedia-background": "none",
      "multimedia-portrait": "inherit",
    });
  });
});

describe("multimedia landscape half layout", () => {
  it("fills the left half while keeping a full-canvas background scene", () => {
    const layout = GALLERY_LAYOUTS.find((item) => item.id === "multimedia-scene-half-left");

    expect(layout).toBeDefined();
    expect(layout?.category).toBe("multimedia");
    expect(layout?.defaultFrameId).toBe("broadcast-gold");
    expect(layout?.slots).toEqual([
      expect.objectContaining({
        id: "multimedia-half-background",
        label: "Background Scene",
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        zIndex: 1,
      }),
      expect.objectContaining({
        id: "multimedia-half-left",
        label: "Left Half Landscape Scene",
        x: 0,
        y: 0,
        width: 960,
        height: 1080,
        zIndex: 2,
      }),
    ]);
    expect(layout?.defaultSlotFrames).toEqual({
      "multimedia-half-background": "none",
      "multimedia-half-left": "inherit",
    });
  });
});

describe("removed templates exclusion", () => {
  it("ensures Social Media CTA, Offering / Giving, and Main Content + Translation are absent", () => {
    const layoutNames = GALLERY_LAYOUTS.map((l) => l.name.toLowerCase());
    const layoutIds = GALLERY_LAYOUTS.map((l) => l.id);

    expect(layoutNames.some((n) => n.includes("social media cta"))).toBe(false);
    expect(layoutNames.some((n) => n.includes("offering"))).toBe(false);
    expect(layoutNames.some((n) => n === "main content + translation")).toBe(false);
    expect(layoutIds).not.toContain("translation-layout");
    expect(layoutIds).not.toContain("offering");
    expect(layoutIds).not.toContain("social-cta");
  });

  it("keeps retired templates out of both the app and OBS catalogs", () => {
    const retiredIds = [
      "worship",
      "pre-service",
      "baptism",
      "funeral",
      "worship-lyrics-full",
      "panel-discussion",
      "main-two-inserts",
      "youth-game",
      "kids-puppet",
      "youth-service",
      "pip",
      "announcement",
      "logo-tr",
      "logo-tl",
      "logo-br",
      "logo-bl",
      "logo-2-top",
      "logo-2-bottom",
      "logo-4-corners",
      "communion",
      "wedding",
      "sermon-slides",
      "worship-confidence",
      "prayer-request",
      "sermon-focus-pip",
      "l-shaped",
    ];

    const templateIds = TEMPLATE_LIBRARY.map((template) => template.id);
    const galleryIds = GALLERY_LAYOUTS.map((layout) => layout.id);

    for (const id of retiredIds) {
      expect(templateIds).not.toContain(`tpl_${id}`);
      expect(galleryIds).not.toContain(id);
    }
  });
});
