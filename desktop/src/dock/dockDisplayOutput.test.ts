import { describe, expect, it } from "vitest";
import {
  describeDockDisplays,
  dockDisplayLabel,
  dockDisplayProblemMessage,
  normalizeDockDisplayOutput,
  resolveDockDisplayTarget,
  selectableDockDisplays,
  supportsDockDisplayOutput,
  type DockDisplayInfo,
} from "./dockDisplayOutput";
import { normalizeDockSceneRoute } from "./dockSceneRouting";

const laptop: DockDisplayInfo = {
  key: "Built-in Retina Display@0,0:2880x1800",
  name: "Built-in Retina Display",
  width: 2880,
  height: 1800,
  x: 0,
  y: 0,
  isControlScreen: true,
};
const projector: DockDisplayInfo = {
  key: "EPSON PJ@2880,0:1920x1080",
  name: "EPSON PJ",
  width: 1920,
  height: 1080,
  x: 2880,
  y: 0,
  isControlScreen: false,
};
const tv: DockDisplayInfo = {
  key: "LG TV@-1920,0:3840x2160",
  name: "LG TV",
  width: 3840,
  height: 2160,
  x: -1920,
  y: 0,
  isControlScreen: false,
};

describe("dock display output", () => {
  it("is saved with the tab's Output settings and is off by default", () => {
    expect(normalizeDockSceneRoute(undefined).display).toEqual({ enabled: false, monitorKey: "", monitorName: "", mode: "fullscreen" });
    const route = normalizeDockSceneRoute({
      enabled: false,
      targets: [],
      display: { enabled: true, monitorKey: projector.key, monitorName: "EPSON PJ" },
    });
    expect(route.display).toEqual({ enabled: true, monitorKey: projector.key, monitorName: "EPSON PJ", mode: "fullscreen" });
    expect(normalizeDockDisplayOutput({ enabled: true, monitorKey: "pj", mode: "lower-third" }).mode).toBe("lower-third");
    expect(normalizeDockDisplayOutput({ enabled: true, monitorKey: "pj", mode: "inherit" }).mode).toBe("inherit");
    expect(normalizeDockDisplayOutput({ enabled: true, monitorKey: "pj", mode: "sideways" }).mode).toBe("fullscreen");
  });

  it("cannot be on without a chosen screen", () => {
    expect(normalizeDockDisplayOutput({ enabled: true, monitorKey: "  " }).enabled).toBe(false);
    expect(normalizeDockDisplayOutput("nonsense")).toEqual({ enabled: false, monitorKey: "", monitorName: "", mode: "fullscreen" });
  });

  it("only offers it on tabs the projector can draw", () => {
    expect(supportsDockDisplayOutput("bible")).toBe(true);
    expect(supportsDockDisplayOutput("worship")).toBe(true);
    expect(supportsDockDisplayOutput("notes")).toBe(true);
    expect(supportsDockDisplayOutput("countdown")).toBe(false);
    expect(supportsDockDisplayOutput("lower-third")).toBe(false);
  });

  it("lists every screen but never offers this computer's own", () => {
    const choices = describeDockDisplays([laptop, projector]);
    expect(choices.map((d) => d.isComputerScreen)).toEqual([true, false]);
    expect(selectableDockDisplays([laptop, projector]).map((d) => d.name)).toEqual(["EPSON PJ"]);
    // A laptop panel counts even when the app window sits on the external screen.
    expect(selectableDockDisplays([{ ...laptop, isControlScreen: false }, { ...projector, isControlScreen: true }])).toEqual([]);
    expect(selectableDockDisplays([laptop])).toEqual([]);
    expect(dockDisplayLabel(projector)).toBe("EPSON PJ · 1920×1080");
  });

  it("uses the saved screen when it is connected", () => {
    const saved = { enabled: true, monitorKey: projector.key, monitorName: "EPSON PJ" };
    const result = resolveDockDisplayTarget(saved, [laptop, projector, tv]);
    expect(result).toMatchObject({ status: "ready", moved: false, display: { key: projector.key } });
  });

  it("finds the saved screen by name after it moved", () => {
    const moved = { ...projector, key: "EPSON PJ@-1920,0:1920x1080", x: -1920 };
    const saved = { enabled: true, monitorKey: projector.key, monitorName: "EPSON PJ" };
    expect(resolveDockDisplayTarget(saved, [laptop, moved])).toMatchObject({
      status: "ready",
      moved: true,
      display: { key: moved.key },
    });
  });

  it("finds a re-plugged screen that macOS renamed, by its place and size", () => {
    const saved = { enabled: true, monitorKey: "Monitor #28969@-3840,0:3840x2160", monitorName: "Monitor #28969" };
    const renamed = { ...tv, key: "Monitor #28970@-3840,0:3840x2160", name: "Monitor #28970", x: -3840 };
    expect(resolveDockDisplayTarget(saved, [laptop, renamed])).toMatchObject({
      status: "ready",
      moved: true,
      display: { key: renamed.key, name: "Monitor #28970" },
    });
  });

  it("finds a renamed screen in a new place by size only when no other screen has that size", () => {
    const saved = { enabled: true, monitorKey: "Monitor #28969@-3840,0:3840x2160", monitorName: "Monitor #28969" };
    const moved = { ...tv, key: "Monitor #28970@3024,0:3840x2160", name: "Monitor #28970", x: 3024 };
    expect(resolveDockDisplayTarget(saved, [laptop, moved])).toMatchObject({ status: "ready", display: { key: moved.key } });
    const twin = { ...tv, key: "Monitor #5@6864,0:3840x2160", name: "Monitor #5", x: 6864 };
    expect(resolveDockDisplayTarget(saved, [laptop, moved, twin])).toEqual({ status: "missing", monitorName: "Monitor #28969" });
  });

  it("never falls back to another screen when the saved one is unplugged", () => {
    const saved = { enabled: true, monitorKey: projector.key, monitorName: "EPSON PJ" };
    const result = resolveDockDisplayTarget(saved, [laptop, tv]);
    expect(result).toEqual({ status: "missing", monitorName: "EPSON PJ" });
    expect(dockDisplayProblemMessage(result)).toContain("EPSON PJ isn't connected");
    expect(dockDisplayProblemMessage(result)).toContain("OBS still got the content");
    expect(resolveDockDisplayTarget(saved, [laptop])).toEqual({ status: "missing", monitorName: "EPSON PJ" });
    expect(resolveDockDisplayTarget(saved, [])).toEqual({ status: "missing", monitorName: "EPSON PJ" });
  });

  it("refuses a saved screen that is now this computer's own", () => {
    const saved = { enabled: true, monitorKey: projector.key, monitorName: "EPSON PJ" };
    const result = resolveDockDisplayTarget(saved, [{ ...projector, isControlScreen: true }]);
    expect(result).toEqual({ status: "computer-screen", monitorName: "EPSON PJ" });
    expect(dockDisplayProblemMessage(result)).toContain("this computer's own screen");
  });

  it("does nothing when it is off", () => {
    expect(resolveDockDisplayTarget({ enabled: false, monitorKey: projector.key, monitorName: "EPSON PJ" }, [projector]))
      .toEqual({ status: "off" });
  });
});
