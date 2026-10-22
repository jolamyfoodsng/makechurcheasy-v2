import { describe, expect, it } from "vitest";
import { applyLayoutAdjust, isLayoutAdjustDefault, layoutVerseStyle, pickLayoutAdjust, readLayoutAdjust, readLayoutBackdrop, resolveBackdropMediaUrl } from "./adjust";
import type { LayerAnimation, ThemeLayout } from "./types";

// Every layer needs an "in" and an "out" animation; these tests don't care which.
const NO_ANIM = { preset: "none", duration: 0, delay: 0, easing: "out-cubic" } as const satisfies LayerAnimation;
const anim = { in: NO_ANIM, out: NO_ANIM };

const LT: ThemeLayout = {
  version: 1,
  format: "lower-third",
  swap: "content",
  layers: [
    { id: "band", name: "Band", type: "box", anchor: "top-left", x: 0, y: 800, w: 1920, h: 200, style: {}, ...anim },
    { id: "verse", name: "Verse", type: "text", parentId: "band", content: "{text}", anchor: "top-left", x: 20, y: 20, w: 1800, h: 150, style: { fontSize: 50, minFontSize: 24 }, ...anim },
    { id: "ref", name: "Reference", type: "text", content: "{reference}", anchor: "top-left", x: 40, y: 760, w: 600, h: "auto", style: { fontSize: 30 }, ...anim },
    { id: "fixed", name: "Fixed", type: "text", content: "LIVE", anchor: "top-left", x: 0, y: 0, w: 100, h: "auto", style: { fontSize: 20 }, ...anim },
  ],
};

describe("layout adjust", () => {
  it("returns the same layout when nothing is changed", () => {
    expect(applyLayoutAdjust(LT, {})).toBe(LT);
    expect(isLayoutAdjustDefault({})).toBe(true);
  });

  it("scales verse and reference separately and leaves fixed text alone", () => {
    const out = applyLayoutAdjust(LT, { layoutTextScale: 150, layoutRefScale: 200 });
    const by = (id: string) => out.layers.find((l) => l.id === id)!;
    expect(by("verse").style.fontSize).toBe(75);
    expect(by("verse").style.minFontSize).toBe(36);
    expect(by("ref").style.fontSize).toBe(60);
    expect(by("fixed").style.fontSize).toBe(20);
  });

  it("moves only top-level layers of a lower third", () => {
    const out = applyLayoutAdjust(LT, { layoutOffsetY: -100 });
    expect(out.layers.find((l) => l.id === "band")!.y).toBe(700);
    expect(out.layers.find((l) => l.id === "verse")!.y).toBe(20);
    const fs = applyLayoutAdjust({ ...LT, format: "fullscreen" }, { layoutOffsetY: -100 });
    expect(fs.layers.find((l) => l.id === "band")!.y).toBe(800);
  });

  it("clamps values and only picks the fields that are set", () => {
    expect(readLayoutAdjust({ layoutTextScale: 999, layoutOffsetY: -9999 })).toEqual({
      layoutTextScale: 200,
      layoutRefScale: 100,
      layoutLineHeight: 100,
      layoutOffsetY: -400,
    });
    expect(pickLayoutAdjust({ fontSize: 40, layoutRefScale: 120 })).toEqual({ layoutRefScale: 120 });
  });
});

const FS: ThemeLayout = {
  version: 1,
  format: "fullscreen",
  swap: "content",
  layers: [
    { id: "bg", name: "Background", type: "box", anchor: "top-left", x: 0, y: 0, w: 1920, h: 1080, style: { fill: "#123456" }, ...anim },
    { id: "glow", name: "Glow", type: "box", anchor: "center", x: 960, y: 540, w: 600, h: 600, style: { fill: "#fff" }, ...anim },
    { id: "verse", name: "Verse", type: "text", content: "{text}", anchor: "center", x: 960, y: 540, w: 1500, h: 600, style: { fontSize: 80 }, ...anim },
  ],
};

describe("layout backdrop (Dock background for full-screen layer themes)", () => {
  it("changes nothing for the theme's own background without darkness", () => {
    expect(applyLayoutAdjust(FS, { backgroundType: "theme" })).toBe(FS);
    expect(applyLayoutAdjust(FS, {})).toBe(FS);
  });

  it("replaces the full-canvas background layer with the picked image", () => {
    const out = applyLayoutAdjust(FS, { backgroundType: "image", backgroundImage: "/uploads/church.jpg" });
    expect(out.layers[0].id).toBe("mce-backdrop");
    expect(out.layers[0].type).toBe("image");
    expect(out.layers[0].style.src).toBe("/uploads/church.jpg");
    expect(out.layers.find((l) => l.id === "bg")!.hidden).toBe(true);
    expect(out.layers.find((l) => l.id === "glow")!.hidden).toBeUndefined();
    expect(out.layers.find((l) => l.id === "verse")!.hidden).toBeUndefined();
  });

  it("plays a picked video, and a colour or gradient", () => {
    const video = applyLayoutAdjust(FS, { backgroundType: "video", backgroundVideo: "/uploads/loop.mp4" });
    expect(video.layers[0].style.videoSrc).toBe("/uploads/loop.mp4");
    const solid = applyLayoutAdjust(FS, { backgroundType: "color", backgroundColor: "#ff0000" });
    expect(solid.layers[0].style.fill).toBe("#ff0000");
    const grad = applyLayoutAdjust(FS, { backgroundType: "color", backgroundColor: "#ff0000", backgroundColorEnd: "#000000", bgGradientAngle: 90 });
    expect(grad.layers[0].style.gradient?.stops.map((st) => st.color)).toEqual(["#ff0000", "#000000"]);
    expect(grad.layers[0].style.gradient?.angle).toBe(90);
  });

  it("Off hides the theme's background and adds nothing", () => {
    const out = applyLayoutAdjust(FS, { backgroundType: "off", layoutBackdropDarkness: 50 });
    expect(out.layers.length).toBe(FS.layers.length);
    expect(out.layers.find((l) => l.id === "bg")!.hidden).toBe(true);
  });

  it("darkness sits right above the theme's own background, below the rest", () => {
    const out = applyLayoutAdjust(FS, { layoutBackdropDarkness: 40 });
    expect(out.layers.map((l) => l.id)).toEqual(["bg", "mce-backdrop-dim", "glow", "verse"]);
    expect(out.layers[1].opacity).toBeCloseTo(0.4);
    expect(out.layers[1].style.fill).toBe("#000000");
  });

  it("darkness goes above a picked background", () => {
    const out = applyLayoutAdjust(FS, { backgroundType: "image", backgroundImage: "/uploads/a.jpg", layoutBackdropDarkness: 60 });
    expect(out.layers.map((l) => l.id).slice(0, 3)).toEqual(["mce-backdrop", "mce-backdrop-dim", "bg"]);
  });

  it("never adds a full-screen background to a lower third (the colour fills its card instead)", () => {
    const out = applyLayoutAdjust(LT, { backgroundType: "color", backgroundColor: "#f00", layoutBackdropDarkness: 80 });
    expect(out.layers.some((l) => l.id.startsWith("mce-backdrop"))).toBe(false);
    expect(out.layers.find((l) => l.id === "band")?.style.fill).toBe("#f00");
  });

  it("falls back to the theme when the picked media is missing or unusable", () => {
    expect(readLayoutBackdrop({ backgroundType: "image", backgroundImage: "" }).kind).toBe("theme");
    expect(readLayoutBackdrop({ backgroundType: "image", backgroundImage: "__FROM_CSS__" }).kind).toBe("theme");
    expect(resolveBackdropMediaUrl("file:///Users/me/Media/loop.mp4")).toBe("/uploads/loop.mp4");
    expect(resolveBackdropMediaUrl("uploads/a b.jpg")).toBe("/uploads/a b.jpg");
    expect(resolveBackdropMediaUrl("https://cdn.example.com/a.mp4")).toBe("https://cdn.example.com/a.mp4");
  });
});

describe("layout adjust: line height and title", () => {
  const TITLED: ThemeLayout = {
    ...LT,
    layers: LT.layers.map((l) => (l.id === "verse" ? { ...l, style: { ...l.style, lineHeight: 1.2 } } : l)),
  };

  it("scales only the verse line spacing (default 1.3 when the theme sets none)", () => {
    const out = applyLayoutAdjust(TITLED, { layoutLineHeight: 150 });
    const by = (id: string) => out.layers.find((l) => l.id === id)!;
    expect(by("verse").style.lineHeight).toBe(1.8);
    expect(by("ref").style.lineHeight).toBeUndefined();
    expect(applyLayoutAdjust(LT, { layoutLineHeight: 100 })).toBe(LT);
    expect(applyLayoutAdjust(LT, { layoutLineHeight: 80 }).layers.find((l) => l.id === "verse")!.style.lineHeight).toBe(1.04);
  });

  it("hides and restores the title with Show title", () => {
    expect(applyLayoutAdjust(LT, { layoutShowTitle: false }).showHeading).toBe(false);
    const hiddenInTheme: ThemeLayout = { ...LT, showHeading: false };
    expect(applyLayoutAdjust(hiddenInTheme, { layoutShowTitle: true }).showHeading).toBeUndefined();
    expect(applyLayoutAdjust(hiddenInTheme, {})).toBe(hiddenInTheme);
    expect(applyLayoutAdjust(LT, { layoutShowTitle: true })).toBe(LT);
  });

  it("picks the new fields and treats them as changes", () => {
    expect(pickLayoutAdjust({ layoutLineHeight: 120, layoutShowTitle: false })).toEqual({ layoutLineHeight: 120, layoutShowTitle: false });
    expect(isLayoutAdjustDefault({ layoutLineHeight: 120 })).toBe(false);
    expect(isLayoutAdjustDefault({ layoutShowTitle: false })).toBe(false);
  });
});

describe("layout adjust: verse box grows with bigger text", () => {
  const GROW: ThemeLayout = {
    version: 1,
    format: "fullscreen",
    swap: "content",
    layers: [
      { id: "bg", name: "Background", type: "box", anchor: "top-left", x: 0, y: 0, w: 1920, h: 1080, style: { fill: "#123456" }, ...anim },
      { id: "ref", name: "Reference", type: "text", content: "{reference}", anchor: "top-center", x: 960, y: 200, w: 1200, h: 60, style: { fontSize: 40 }, ...anim },
      { id: "verse", name: "Verse", type: "text", content: "{text}", anchor: "top-center", x: 960, y: 300, w: 1400, h: 400, style: { fontSize: 60 }, ...anim },
      { id: "tr", name: "Translation", type: "text", content: "{translation}", anchor: "top-right", x: 1660, y: 900, w: 200, h: 40, style: { fontSize: 24 }, ...anim },
    ],
  };
  const verseOf = (l: ThemeLayout) => l.layers.find((x) => x.id === "verse")!;

  it("does not move the box at 100%", () => {
    expect(verseOf(applyLayoutAdjust(GROW, { layoutLineHeight: 100 }))).toBe(verseOf(GROW));
  });

  it("grows the box by the size change while there is room", () => {
    const v = verseOf(applyLayoutAdjust(GROW, { layoutTextScale: 125 }));
    expect(v.h).toBe(500);
    // Only 16px of room above (reference ends at 260, keeps 24px clear); the rest goes below.
    expect(v.y).toBe(284);
    expect(v.x).toBe(960);
    expect(v.w).toBe(1400);
  });

  it("stops at the reference and translation, and spills to the free side", () => {
    const v = verseOf(applyLayoutAdjust(GROW, { layoutTextScale: 200 }));
    // Top stops 24px under the reference (260 + 24); bottom 24px above the translation (900 - 24).
    expect(v.y).toBe(284);
    expect(v.y + (v.h as number)).toBe(876);
  });

  it("counts bigger line spacing too", () => {
    expect(verseOf(applyLayoutAdjust(GROW, { layoutLineHeight: 125 })).h).toBe(500);
  });

  it("stays inside its card in a lower third", () => {
    const v = verseOf(applyLayoutAdjust(LT, { layoutTextScale: 200 }));
    // Band is 200 tall; the verse sat 20 from its top and 30 from its bottom.
    expect(v.y).toBe(20);
    expect(v.h).toBe(160);
  });

  it("leaves auto-height and smaller text alone", () => {
    expect(verseOf(applyLayoutAdjust(GROW, { layoutTextScale: 80 })).h).toBe(400);
    const auto = { ...GROW, layers: GROW.layers.map((l) => (l.id === "verse" ? { ...l, h: "auto" as const } : l)) };
    expect(verseOf(applyLayoutAdjust(auto, { layoutTextScale: 150 })).h).toBe("auto");
  });
});

describe("layout backdrop: lower-third card", () => {
  const card = (out: ThemeLayout) => out.layers.find((l) => l.id === "band")!;

  it("a picked colour fills the card that holds the words", () => {
    const out = applyLayoutAdjust(LT, { backgroundType: "color", backgroundColor: "#123456" });
    expect(card(out).style.fill).toBe("#123456");
    expect(card(out).hidden).toBeFalsy();
    // The words are untouched.
    expect(out.layers.find((l) => l.id === "verse")).toEqual(LT.layers.find((l) => l.id === "verse"));
  });

  it("a picked picture or video covers the card", () => {
    const pic = applyLayoutAdjust(LT, { backgroundType: "image", backgroundImage: "/uploads/hills.jpg", layoutBackdropDarkness: 40 });
    expect(card(pic).style).toMatchObject({ src: "/uploads/hills.jpg", fit: "cover", dim: 40 });
    const vid = applyLayoutAdjust(LT, { backgroundType: "video", backgroundVideo: "/uploads/loop.mp4" });
    expect(card(vid).style).toMatchObject({ videoSrc: "/uploads/loop.mp4", fit: "cover" });
  });

  it("keeps the theme's own card when the background is the theme's", () => {
    expect(applyLayoutAdjust(LT, { backgroundType: "theme", backgroundColor: "#123456" })).toBe(LT);
  });

  it("uses the file path when a large picture was replaced by a marker", () => {
    const b = readLayoutBackdrop({ backgroundType: "image", backgroundImage: "__FROM_CSS__", backgroundImageFilePath: "/uploads/big.jpg" });
    expect(b.kind).toBe("image");
    expect(b.image).toBe("/uploads/big.jpg");
  });
});

describe("layout adjust: verse box growth", () => {
  // The Bible full-screen theme pushed to OBS: an auto-height reference above a fixed verse box.
  const FULL: ThemeLayout = {
    version: 1,
    format: "fullscreen",
    layers: [
      { id: "bg", name: "Background", type: "box", x: 0, y: 0, w: 1920, h: 1080, anchor: "top-left", style: { fill: "#11053b" } },
      { id: "reference", name: "Reference", type: "text", content: "{reference}", x: 960, y: 210, w: 1500, h: "auto", anchor: "top-center", style: { fontSize: 72, maxLines: 1, hug: true, padding: [10, 28, 8, 40] } },
      { id: "verse", name: "Verse", type: "text", content: "{text}", x: 960, y: 360, w: 1600, h: 560, anchor: "top-center", style: { fontSize: 80, lineHeight: 1.22, minFontSize: 38 } },
    ],
  } as ThemeLayout;

  it("keeps a finite place for the verse when the line spacing grows it", () => {
    const verse = applyLayoutAdjust(FULL, { layoutLineHeight: 105 }).layers.find((l) => l.id === "verse")!;
    expect(verse.y).toBe(346);
    expect(verse.h).toBe(588);
  });

  it("leaves the verse where it was rather than giving it no place", () => {
    const broken = { ...FULL, layers: FULL.layers.map((l) => (l.id === "reference" ? { ...l, y: Number.NaN } : l)) } as ThemeLayout;
    const verse = applyLayoutAdjust(broken, { layoutLineHeight: 105 }).layers.find((l) => l.id === "verse")!;
    expect(Number.isFinite(verse.y)).toBe(true);
    expect(Number.isFinite(verse.h as number)).toBe(true);
  });
});

describe("layout adjust: bold and italic", () => {
  const by = (layout: ThemeLayout, id: string) => layout.layers.find((l) => l.id === id)!;

  it("changes only the verse text and leaves the reference alone", () => {
    const out = applyLayoutAdjust(LT, { layoutBold: true, layoutItalic: true });
    expect(by(out, "verse").style.fontWeight).toBe(700);
    expect(by(out, "verse").style.italic).toBe(true);
    expect(by(out, "ref").style.fontWeight).toBeUndefined();
    expect(by(out, "ref").style.italic).toBeUndefined();
  });

  it("turns bold and italic off when the operator says so", () => {
    const heavy: ThemeLayout = {
      ...LT,
      layers: LT.layers.map((l) => (l.id === "verse" ? { ...l, style: { ...l.style, fontWeight: 900, italic: true } } : l)),
    };
    const out = applyLayoutAdjust(heavy, { layoutBold: false, layoutItalic: false });
    expect(by(out, "verse").style.fontWeight).toBe(400);
    expect(by(out, "verse").style.italic).toBe(false);
  });

  it("keeps a heavier design weight when bold is turned on", () => {
    const heavy: ThemeLayout = {
      ...LT,
      layers: LT.layers.map((l) => (l.id === "verse" ? { ...l, style: { ...l.style, fontWeight: 900 } } : l)),
    };
    expect(by(applyLayoutAdjust(heavy, { layoutBold: true }), "verse").style.fontWeight).toBe(900);
  });

  it("works together with size, and counts as a change", () => {
    const out = applyLayoutAdjust(LT, { layoutTextScale: 150, layoutBold: true });
    expect(by(out, "verse").style.fontSize).toBe(75);
    expect(by(out, "verse").style.fontWeight).toBe(700);
    expect(isLayoutAdjustDefault({ layoutBold: false })).toBe(false);
    expect(pickLayoutAdjust({ layoutBold: true, layoutItalic: false })).toEqual({ layoutBold: true, layoutItalic: false });
  });

  it("shows how the theme is designed before anything is chosen", () => {
    expect(layoutVerseStyle(LT)).toEqual({ bold: false, italic: false });
    const heavy: ThemeLayout = {
      ...LT,
      layers: LT.layers.map((l) => (l.id === "verse" ? { ...l, style: { ...l.style, fontWeight: 800, italic: true } } : l)),
    };
    expect(layoutVerseStyle(heavy)).toEqual({ bold: true, italic: true });
  });
});
