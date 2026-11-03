import { describe, expect, it } from "vitest";
import { buildMceTitleXml, titleContentFromState, titleFieldsFromItem, titleImagesForLayout } from "./vmixTitles";
import type { PresentationRemoteState } from "./presentationState";

function state(patch: Partial<PresentationRemoteState>): PresentationRemoteState {
  return { sessionId: "s", fullscreen: null, lowerThird: null, graphic: null, updatedAt: 1, ...patch };
}

describe("MCE Presentation title file", () => {
  const xml = buildMceTitleXml({ background: "C:/t/bg.png", bar: "C:/t/bar.png", accent: "C:/t/a&b.png" });

  it("has the text fields for both looks, shrinking long text to fit", () => {
    for (const name of ["Reference", "Text", "LTReference", "LTText"]) {
      expect(xml).toContain(`<TextBlock Name="${name}"`);
    }
    expect(xml).toContain('AutoSize="Shrink"');
    expect(xml).toContain('<Storyboard Type="TransitionOut">');
  });

  it("uses images MCE can swap for the background, the bar and the accent", () => {
    expect(xml).toContain('<Image Name="Background"');
    expect(xml).toContain('<Image Name="Bar"');
    expect(xml).toContain('Source="C:/t/a&amp;b.png"');
  });

  it("shows only the background for full screen and only the bar for lower thirds", () => {
    const images = { background: "bg", bar: "bar", accent: "accent" };
    expect(titleImagesForLayout("fullscreen", images)).toEqual({ background: "bg", bar: "", accent: "" });
    expect(titleImagesForLayout("lowerThird", images)).toEqual({ background: "", bar: "bar", accent: "accent" });
  });
});

describe("what the vMix titles show", () => {
  it("puts a verse on the full-screen title with its reference and version", () => {
    const content = titleContentFromState(state({
      fullscreen: { id: "b", source: "bible", title: "John 3:16", reference: "KJV", body: "For God so loved the world" },
    }));
    expect(content).toEqual({ kind: "fullscreen", job: "scripture", reference: "John 3:16 (KJV)", text: "For God so loved the world" });
  });

  it("puts a lower third on the lower-third title", () => {
    const content = titleContentFromState(state({
      lowerThird: { id: "b", source: "bible", title: "Psalm 23:1", reference: "NIV", body: "The Lord is my shepherd" },
    }));
    expect(content?.kind).toBe("lowerThird");
  });

  it("shows only the lyrics for a song slide unless the title is asked for", () => {
    const lyrics = titleFieldsFromItem({ id: "w", source: "worship", title: "Amazing Grace", body: "Amazing grace, how sweet the sound" });
    expect(lyrics).toEqual({ reference: "", text: "Amazing grace, how sweet the sound" });
  });

  it("shows a name with the role under it", () => {
    const name = titleFieldsFromItem({ id: "t", source: "text", title: "Pastor John", reference: "Ministry", body: "Senior Pastor" });
    expect(name).toEqual({ reference: "Senior Pastor", text: "Pastor John" });
  });

  it("can't show media or countdowns as titles", () => {
    expect(titleFieldsFromItem({ id: "m", source: "media", variant: "media", title: "Clip" })).toBeNull();
    expect(titleContentFromState(state({ fullscreen: { id: "c", source: "countdown", variant: "countdown", title: "Start" } }))).toBeNull();
    expect(titleContentFromState(null)).toBeNull();
  });
});
