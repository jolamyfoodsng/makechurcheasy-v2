import { describe, expect, it } from "vitest";
// Plain script shared with public/studio-output.html.
// @ts-expect-error It is a plain script with no type declarations.
import placement from "../../public/studio-graphic-placement.js";

const { contentBox, offsets } = placement as {
  contentBox: (w: number, h: number, box: { left: number; top: number; width: number; height: number }) => { frameW: number; frameH: number; left: number; top: number; right: number; bottom: number } | null;
  offsets: (box: NonNullable<ReturnType<typeof contentBox>>, position: string, scale: number) => { dx: number; dy: number; scale: number };
};

/** A 1000 x 120 strap centred on the 1440 x 810 canvas, in a 1920 x 1080 frame (scale 4/3). */
const strap = () => contentBox(1920, 1080, { left: 220, top: 345, width: 1000, height: 120 })!;

describe("Studio graphic placement", () => {
  it("measures the graphic in frame pixels", () => {
    const box = strap();
    expect(Math.round(box.left)).toBe(293);
    expect(Math.round(box.right)).toBe(1627);
    expect(Math.round(box.bottom - box.top)).toBe(160);
  });

  it("bottom-left puts the left edge and bottom edge on the margin, so nothing is cut off", () => {
    const box = strap();
    const margin = Math.round(1080 * 0.04);
    const { dx, dy } = offsets(box, "bottom-left", 100);
    expect(Math.round(box.left + dx)).toBe(margin);
    expect(Math.round(box.bottom + dy)).toBe(1080 - margin);
    expect(box.right + dx).toBeLessThan(1920);
  });

  it("bottom-right and top-center sit on their edges", () => {
    const box = strap();
    const margin = Math.round(1080 * 0.04);
    const br = offsets(box, "bottom-right", 100);
    expect(Math.round(box.right + br.dx)).toBe(1920 - margin);
    const tc = offsets(box, "top-center", 100);
    expect(Math.round(box.top + tc.dy)).toBe(margin);
    expect(Math.round(tc.dx)).toBe(0);
  });

  it("centres a graphic that is too wide to sit against an edge", () => {
    const wide = contentBox(1920, 1080, { left: 20, top: 100, width: 1400, height: 400 })!;
    const { dx } = offsets(wide, "bottom-left", 100);
    expect(Math.round(wide.left + dx)).toBe(Math.round(1920 - (wide.right + dx)));
  });

  it("keeps the edge on the margin when the graphic is scaled", () => {
    const box = strap();
    const margin = Math.round(1080 * 0.04);
    const s = 70;
    const { dx, scale } = offsets(box, "bottom-left", s);
    const centre = 1920 / 2;
    expect(Math.round(centre + (box.left - centre) * scale + dx)).toBe(margin);
  });

  it("returns nothing for a graphic that has no size yet", () => {
    expect(contentBox(1920, 1080, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
  });
});
