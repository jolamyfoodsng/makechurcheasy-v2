/**
 * studio-graphic-placement.js — where a Broadcast graphic sits on the Studio output.
 *
 * The graphic page (broadcastPreviewHtml.ts) draws the graphic centred on a 1440 x 810 canvas that is
 * scaled to fill its frame. To put it "bottom left" the output used to push the frame a fixed share of
 * the screen to the left and down, which cut off the sides of wide graphics. Here the graphic's real
 * box is measured and moved so its edge lands on a margin, and it is centred when it is too big to fit.
 * Plain script: loaded by studio-output.html and by the tests.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MCEGraphicPlacement = api;
})(typeof self !== "undefined" ? self : this, function () {
  var CANVAS_W = 1440;
  var CANVAS_H = 810;

  /** The graphic's box in frame pixels, from its layout box on the canvas (offsetLeft/Top/Width/Height). */
  function contentBox(frameW, frameH, box) {
    if (!frameW || !frameH || !box || !box.width || !box.height) return null;
    var k = Math.min(frameW / CANVAS_W, frameH / CANVAS_H);
    var tx = (frameW - CANVAS_W * k) / 2;
    var ty = (frameH - CANVAS_H * k) / 2;
    return {
      frameW: frameW,
      frameH: frameH,
      left: tx + box.left * k,
      top: ty + box.top * k,
      right: tx + (box.left + box.width) * k,
      bottom: ty + (box.top + box.height) * k
    };
  }

  function axisShift(start, end, size, edge, scale, margin) {
    var c = size / 2;
    var a = c + (start - c) * scale;
    var b = c + (end - c) * scale;
    // Too big to sit against an edge: centre it rather than cut one side off.
    if (b - a >= size - 2 * margin) return c - (a + b) / 2;
    if (edge < 0) return margin - a;
    if (edge > 0) return size - margin - b;
    return c - (a + b) / 2;
  }

  /** Pixels to move the frame (after it is scaled about its centre) so the graphic sits at `position`. */
  function offsets(box, position, scalePercent) {
    var scale = Math.max(30, Math.min(200, Number(scalePercent) || 100)) / 100;
    var name = String(position || "center");
    var xEdge = /left$/.test(name) ? -1 : /right$/.test(name) ? 1 : 0;
    var yEdge = /^top/.test(name) ? -1 : /^bottom/.test(name) ? 1 : 0;
    var margin = Math.round(Math.min(box.frameW, box.frameH) * 0.04);
    return {
      dx: axisShift(box.left, box.right, box.frameW, xEdge, scale, margin),
      dy: axisShift(box.top, box.bottom, box.frameH, yEdge, scale, margin),
      scale: scale
    };
  }

  return { contentBox: contentBox, offsets: offsets, CANVAS_W: CANVAS_W, CANVAS_H: CANVAS_H };
});
