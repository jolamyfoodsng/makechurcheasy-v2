import { describe, expect, it } from "vitest";

import {
  formatDockTickerMessages,
  getDockTickerThemeOptionsForFavorites,
  renderDockTickerThemeHtml,
  resolveDockTickerThemeOption,
} from "./tickerThemeCatalog";
import { DOCK_FONT_FAMILY_OPTIONS, normalizeDockFontFamily } from "./dockFontFamily";

describe("tickerThemeCatalog", () => {
  it("includes permanent ticker themes when they are favorited", () => {
    const options = getDockTickerThemeOptionsForFavorites(new Set(["ticker-bottom"]));

    expect(options.map((option) => option.id)).toContain("ticker-bottom");
    expect(options.find((option) => option.id === "ticker-bottom")?.source).toBe("permanent");
  });

  it("renders permanent ticker themes with live ticker controls", () => {
    const option = resolveDockTickerThemeOption("ticker-bottom");
    expect(option?.source).toBe("permanent");

    const html = renderDockTickerThemeHtml({
      option: option!,
      heading: "Updates",
      messages: ["Alpha", "Beta"],
      speed: 88,
      position: "top",
      loop: false,
      paused: true,
    });

    expect(html).toContain("Updates");
    expect(html).toContain("Alpha   •   Beta");
    expect(html).toContain("top: 0 !important; bottom: auto !important;");
    expect(html).toContain("animation-iteration-count: 1 !important;");
    expect(html).toContain("animation-play-state: paused !important;");
  });

  it("renders dock-native ticker themes with override colors", () => {
    const option = resolveDockTickerThemeOption("ticker-fresh");
    expect(option?.source).toBe("dock");
    if (!option || option.source !== "dock") {
      throw new Error("Expected dock ticker theme");
    }

    const html = renderDockTickerThemeHtml({
      option,
      heading: "Live",
      messages: ["Welcome"],
      speed: 50,
      position: "bottom",
      loop: true,
      paused: false,
      colors: {
        ...option.theme.defaultColors,
        accent: "#123456",
        separator: "#123456",
      },
    });

    expect(html).toContain("#123456");
    expect(html).toContain("Welcome");
  });

  it("allows only bundled font families and applies the selection to source HTML", () => {
    const font = DOCK_FONT_FAMILY_OPTIONS.find((option) => option.id === "sora");
    expect(font).toBeDefined();
    expect(normalizeDockFontFamily(font?.family)).toBe(font?.family);
    expect(normalizeDockFontFamily("font-family: malicious")).toBe("");

    const option = resolveDockTickerThemeOption("ticker-fresh");
    const html = renderDockTickerThemeHtml({
      option: option!,
      heading: "Live",
      messages: ["Welcome"],
      speed: 50,
      position: "bottom",
      loop: true,
      fontFamily: font?.family,
    });

    expect(html).toContain(`font-family:${font?.family}`);
  });

  it("applies the selected font to permanent ticker templates", () => {
    const option = resolveDockTickerThemeOption("ticker-bottom");
    const font = DOCK_FONT_FAMILY_OPTIONS.find((item) => item.id === "outfit");
    const html = renderDockTickerThemeHtml({
      option: option!,
      heading: "Updates",
      messages: ["Welcome"],
      speed: 50,
      position: "bottom",
      loop: true,
      fontFamily: font?.family,
    });

    expect(html).toContain(`font-family: ${font?.family} !important;`);
  });

  it("adds extra space before the next native ticker message and supports divider styles", () => {
    const option = resolveDockTickerThemeOption("ticker-fresh");
    const html = renderDockTickerThemeHtml({
      option: option!,
      heading: "Live",
      messages: ["Alpha", "Beta"],
      speed: 50,
      position: "bottom",
      loop: true,
      divider: "diamond",
      messageSpacing: 50,
    });

    expect(html).toContain("margin-left:50px");
    expect(html).toContain("◆");
  });

  it("applies spacing and a creative divider to a permanent HTML ticker", () => {
    const option = resolveDockTickerThemeOption("ticker-bottom");
    const html = renderDockTickerThemeHtml({
      option: option!,
      heading: "Follow Us",
      messages: ["@church", "@mce"],
      speed: 50,
      position: "bottom",
      loop: true,
      divider: "spark",
      messageSpacing: 50,
    });

    expect(html).toContain("gap: calc(22px + 50px)");
    expect(html).toContain('content: "✦";');
  });

  it("lets the Sunrise heading show the live time instead of the heading text", () => {
    const option = resolveDockTickerThemeOption("ticker-sunrise");
    expect(option?.source).toBe("permanent");
    const render = (headingMode: "text" | "time") => renderDockTickerThemeHtml({
      option: option!,
      heading: "This Week",
      headingMode,
      messages: ["Welcome"],
      speed: 50,
      position: "bottom",
      loop: true,
      divider: "theme",
      messageSpacing: 0,
    });
    const time = render("time");
    expect(time).toContain('data-heading="time"');
    expect(time).toContain("data-live-clock");
    expect(time).not.toContain("{{clock}}");
    expect(time).toMatch(/data-live-clock>\d{1,2}[:.]\d{2}/);
    expect(time).toContain("setInterval(t,1000)");
    const text = render("text");
    expect(text).toContain('data-heading="text"');
    expect(text).toContain("This Week");
  });

  it("has one Sunrise ticker, not a separate Sunrise Clock", () => {
    expect(resolveDockTickerThemeOption("ticker-sunrise")?.name).toBe("Sunrise");
    expect(resolveDockTickerThemeOption("ticker-sunrise-clock")?.id).not.toBe("ticker-sunrise-clock");
    expect(resolveDockTickerThemeOption("ticker-rotating-logo")?.id).not.toBe("ticker-rotating-logo");
  });

  it("scrolls pill tickers at a steady pixel speed that follows the Speed setting", () => {
    const option = resolveDockTickerThemeOption("ticker-sunrise")!;
    const render = (speed: number) => renderDockTickerThemeHtml({ option, heading: "H", messages: ["Hi"], speed, position: "bottom", loop: true });
    expect(render(100)).toContain("var pps=320;");
    expect(render(1)).toContain("var pps=60;");
    expect(render(50)).toContain("var pps=180;");
  });

  it("formats presentation ticker text with the selected divider and spacing", () => {
    expect(formatDockTickerMessages(["Alpha", "Beta"], "line", 16)).toContain("Alpha");
    expect(formatDockTickerMessages(["Alpha", "Beta"], "line", 16)).toContain("—");
    expect(formatDockTickerMessages(["Alpha", "Beta"], "none", 16)).not.toContain("•");
  });
});
