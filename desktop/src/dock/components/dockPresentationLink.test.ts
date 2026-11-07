import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

describe("DockPresentationLink Card and Modal", () => {
  const cardPath = path.resolve(__dirname, "DockPresentationLinkCard.tsx");
  const modalPath = path.resolve(__dirname, "DockPresentationLinkModal.tsx");
  const cssPath = path.resolve(__dirname, "DockPresentationLinkCard.css");

  it("DockPresentationLinkCard exports a compact bar with bold link and help button", () => {
    const content = fs.readFileSync(cardPath, "utf-8");
    expect(content).toContain("onOpenHelp");
    expect(content).toContain("dock-presentation-link-bar");
    expect(content).toContain("dock-presentation-link-bar__code");
    expect(content).toContain("dock-presentation-link-bar__help-btn");
    expect(content).toContain("data-testid=\"dock-copy-presentation-link\"");
  });

  it("DockPresentationLinkModal clearly explains free plan downgrade and provides bold link", () => {
    const content = fs.readFileSync(modalPath, "utf-8");
    expect(content).toContain("DockPresentationLinkModal");
    expect(content).toContain("<ModalDialog");
    expect(content).toContain("<ModalCodeRow");
    expect(content).toContain("dock.freePlanNoticeDesc");
    expect(content).not.toContain("Explore Multi-Scene Plans");
    expect(content).not.toContain("3-Step Setup");
  });

  it("DockPresentationLinkCard.css provides bold font and compact styles", () => {
    const css = fs.readFileSync(cssPath, "utf-8");
    expect(css).toContain("font-weight: 700");
    expect(css).toContain(".dock-presentation-link-bar");
  });
});
