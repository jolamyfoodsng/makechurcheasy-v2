import { describe, expect, it } from "vitest";
import ministrySource from "../dock/tabs/DockMinistryTab.tsx?raw";
import lowerThirdOverlayHtml from "../../public/lower-third-overlay.html?raw";
import lowerThirdObsServiceSource from "./lowerThirdObsService.ts?raw";
import { LT_SIZE_FONT_SCALE, LT_SIZE_SCALE, LT_SIZE_WIDTH, LT_VISUAL_OUTPUT_SCALE } from "./types";

describe("lower-third size presets", () => {
  it("keeps size presets intact and applies a separate output scale", () => {
    expect(LT_VISUAL_OUTPUT_SCALE).toBeCloseTo(1);
    expect(LT_SIZE_SCALE.xs).toBeCloseTo(0.6);
    expect(LT_SIZE_WIDTH.xs).toBeCloseTo(32);
    expect(LT_SIZE_FONT_SCALE.xs).toBeCloseTo(0.7);
    expect(LT_SIZE_SCALE.lg).toBeCloseTo(1);
    expect(LT_SIZE_SCALE.xl).toBeCloseTo(1.35);
    expect(LT_SIZE_WIDTH.xl).toBeCloseTo(82);
    expect(LT_SIZE_FONT_SCALE.xl).toBeCloseTo(1.35);
    expect(LT_SIZE_WIDTH.x2).toBeCloseTo(100);
    expect(LT_SIZE_FONT_SCALE.x2).toBeCloseTo(2);
  });

  it("sends the output scale to the overlay renderer", () => {
    expect(lowerThirdObsServiceSource).toContain("visualScale: LT_VISUAL_OUTPUT_SCALE");
    expect(lowerThirdOverlayHtml).toContain("--lt-visual-scale");
    expect(lowerThirdOverlayHtml).toContain("--lt-size-scale");
    expect(lowerThirdOverlayHtml).toContain("var requestedScale = visualScale * sizeScale");
    expect(lowerThirdOverlayHtml).toContain("var contentNode = frame.firstElementChild || frame");
    expect(lowerThirdOverlayHtml).toContain("var finalScale = requestedScale * fitScale");
    expect(lowerThirdOverlayHtml).toContain("let fitRetryTimerId = 0");
    expect(lowerThirdOverlayHtml).toContain("fitRetryTimerId = setTimeout");
    expect(lowerThirdOverlayHtml).toContain("function setupOverlayResizeObserver()");
    expect(lowerThirdOverlayHtml).toContain("if (root) resizeObserver.observe(root)");
    expect(lowerThirdOverlayHtml).toContain("data.visualScale, data.scale");
  });

  it("limits the Ministry lower-third picker to XS, SM, MD, and LG", () => {
    expect(ministrySource).toContain('const MINISTRY_LT_SIZE_OPTIONS: LTSize[] = ["xs", "sm", "md", "lg"];');
    expect(ministrySource).toContain("return resolveMinistryLtSize(getSettings().defaultSpeakerSize);");
    expect(ministrySource).toContain("readNativeDockSetting<unknown>(MINISTRY_LT_SIZE_STORAGE_KEY)");
    expect(ministrySource).toContain("writeNativeDockSetting(MINISTRY_LT_SIZE_STORAGE_KEY, s)");
    expect(ministrySource).toContain("sourceWidth: 1920");
    expect(ministrySource).toContain("sourceHeight: 1080");
    expect(ministrySource).not.toContain('(["xl", "x2"] as LTSize[])');
  });
});
