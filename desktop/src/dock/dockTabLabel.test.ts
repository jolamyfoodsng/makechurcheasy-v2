import { describe, expect, it } from "vitest";
import { resolveDockTabLabel, themeHasLayerHeading } from "./dockObsClient";
import { BLANK_LOWER_THIRD } from "../themes/layout/blankTheme";

const song = { songTitle: "Amazing Grace", sectionLabel: "Chorus" };

describe("worship heading label", () => {
  it("fills the heading of a layer theme in Auto mode", () => {
    expect(resolveDockTabLabel("auto", song, "", { layerHeading: true })).toBe("Amazing Grace · Chorus");
    expect(resolveDockTabLabel("auto", { songTitle: "Amazing Grace", sectionLabel: "" }, "", { layerHeading: true })).toBe("Amazing Grace");
  });

  it("keeps the old Auto behaviour for themes without a layer heading", () => {
    expect(resolveDockTabLabel("auto", song, "")).toBe("");
    expect(resolveDockTabLabel("auto", song, "", { layerHeading: false })).toBe("");
  });

  it("still follows an explicit label choice", () => {
    expect(resolveDockTabLabel("none", song, "", { layerHeading: true })).toBe("");
    expect(resolveDockTabLabel("title", song, "", { layerHeading: true })).toBe("Amazing Grace");
  });

  it("spots layer themes that have a heading", () => {
    expect(themeHasLayerHeading({ layout: BLANK_LOWER_THIRD })).toBe(true);
    expect(themeHasLayerHeading({ fontSize: 40 })).toBe(false);
    expect(themeHasLayerHeading(null)).toBe(false);
  });
});
