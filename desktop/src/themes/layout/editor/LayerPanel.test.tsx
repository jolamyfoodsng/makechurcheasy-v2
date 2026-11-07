import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BLANK_FULLSCREEN } from "../blankTheme";
import type { ThemeLayout } from "../types";
import LayerPanel from "./LayerPanel";

const render = (layout: ThemeLayout, selectedId: string) =>
  renderToStaticMarkup(<LayerPanel layout={layout} selectedId={selectedId} onSelect={() => undefined} onChange={() => undefined} />);

describe("layer inspector order", () => {
  it("puts quick changes first and keeps name, what it shows and position under Advanced options", () => {
    const html = render(BLANK_FULLSCREEN, "verse");
    const quick = html.indexOf("Text colour");
    const advanced = html.indexOf("Advanced options");
    expect(quick).toBeGreaterThan(-1);
    expect(advanced).toBeGreaterThan(quick);
    expect(html.indexOf("Font")).toBeLessThan(advanced);
    expect(html.indexOf("Background bar behind the text")).toBeLessThan(advanced);
    for (const label of ["Layer name (only you see it)", "Shows", "Exact position &amp; size", "Opacity (0–1)", "Smallest size"]) {
      expect(html.indexOf(label)).toBeGreaterThan(advanced);
    }
    // Closed until opened.
    expect(html).toMatch(/<details class="le-advanced">/);
  });

  it("shows the bar colour only while the background bar is on", () => {
    const withBar: ThemeLayout = {
      ...BLANK_FULLSCREEN,
      layers: BLANK_FULLSCREEN.layers.map((l) => (l.id === "verse" ? { ...l, style: { ...l.style, fill: "#112233" } } : l)),
    };
    expect(render(withBar, "verse")).toContain("Bar colour");
    expect(render(BLANK_FULLSCREEN, "verse")).not.toContain("Bar colour");
  });
});

describe("quick position and background off", () => {
  it("shows labelled position buttons above the verse number colour", () => {
    const html = renderToStaticMarkup(
      <LayerPanel layout={BLANK_FULLSCREEN} selectedId="verse" onSelect={() => undefined} onChange={() => undefined} onAlign={() => undefined} />,
    );
    const pos = html.indexOf("Position on screen");
    expect(pos).toBeGreaterThan(-1);
    expect(pos).toBeLessThan(html.indexOf("Verse number colour"));
    expect(pos).toBeLessThan(html.indexOf("Advanced options"));
    for (const label of ["Across", "Up and down", "Move to the left", "Move to the bottom", "Align", "Letters", "Style"]) {
      expect(html).toContain(label);
    }
  });

  it("offers Off for the background and says it is see-through", () => {
    const off: ThemeLayout = {
      ...BLANK_FULLSCREEN,
      layers: BLANK_FULLSCREEN.layers.map((l) => (l.id === "bg" ? { ...l, style: { ...l.style, fill: "transparent" } } : l)),
    };
    expect(render(BLANK_FULLSCREEN, "verse")).toContain(">Off</button>");
    expect(render(off, "verse")).toContain("No background. It is see-through");
  });
});
