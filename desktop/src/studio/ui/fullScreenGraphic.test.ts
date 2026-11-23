import { describe, expect, it } from "vitest";
import { KINETIC_LOWER_THIRD_THEMES } from "../../lowerthirds/kineticThemes";
import { isFullScreenGraphic } from "./BroadcastGraphicsDrawer";
import type { LowerThirdTheme } from "../../lowerthirds/types";

const themes = KINETIC_LOWER_THIRD_THEMES as unknown as LowerThirdTheme[];
const byId = (id: string) => themes.find((t) => t.id === id)!;

describe("isFullScreenGraphic", () => {
  it("treats the bank account giving screen as full screen", () => {
    expect(isFullScreenGraphic(byId("lt-sun-accountx"))).toBe(true);
  });

  it("leaves ordinary lower thirds positionable", () => {
    const lowerThird = themes.find((t) => t.category === "speaker")!;
    expect(isFullScreenGraphic(lowerThird)).toBe(false);
  });

  it("detects admin packages drawn with pkg-fullscreen", () => {
    expect(isFullScreenGraphic({ id: "x", html: '<div class="gb pkg-fullscreen"></div>' } as LowerThirdTheme)).toBe(true);
  });
});
