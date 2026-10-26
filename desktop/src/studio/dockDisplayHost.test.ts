import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DockDisplayInfo } from "../dock/dockDisplayOutput";

const state = vi.hoisted(() => ({
  monitors: [] as DockDisplayInfo[],
  active: null as string | null,
  projectorListeners: [] as Array<(list: Array<{ label: string }>) => void>,
  screenLostListeners: [] as Array<(projector: { label: string; where: string }) => void>,
}));

const window = vi.hoisted(() => ({
  listStudioMonitors: vi.fn(async () => state.monitors),
  openProjector: vi.fn(async (_feed: string, key: string) => ({ label: `studio-projector-${key}`, feed: "program", monitorKey: key, where: key })),
  closeProjector: vi.fn(async () => undefined),
  adoptStrayProjectors: vi.fn(async () => undefined),
  closeAllProjectors: vi.fn(async () => undefined),
  onProjectorScreenLost: vi.fn((listener: (projector: { label: string; where: string }) => void) => {
    state.screenLostListeners.push(listener);
    return () => undefined;
  }),
  onProjectorsChange: vi.fn((listener: (list: Array<{ label: string }>) => void) => {
    state.projectorListeners.push(listener);
    return () => undefined;
  }),
}));
const engine = vi.hoisted(() => ({
  goLiveItem: vi.fn(async () => true),
  clearProgram: vi.fn(async () => true),
  getProgramState: vi.fn(() => ({ active: state.active })),
}));
const bridge = vi.hoisted(() => ({ publish: vi.fn(), subscribe: vi.fn(() => () => undefined), connect: vi.fn() }));

vi.mock("./studioOutputWindow", () => window);
vi.mock("./studioEngine", () => engine);
vi.mock("../dock/dockOverlayBridge", () => ({ overlayBridge: bridge }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));

const laptop: DockDisplayInfo = { key: "laptop", name: "Built-in Retina Display", width: 2880, height: 1800, x: 0, y: 0, isControlScreen: true };
const projector: DockDisplayInfo = { key: "pj", name: "EPSON PJ", width: 1920, height: 1080, x: 2880, y: 0, isControlScreen: false };
const saved = { enabled: true, monitorKey: "pj", monitorName: "EPSON PJ" };
const item = { module: "bible" as const, data: { text: "For God so loved" }, label: "John 3:16" };

describe("dock display host", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.clearAllMocks();
    state.monitors = [laptop, projector];
    state.active = null;
    state.projectorListeners = [];
    state.screenLostListeners = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the Studio projector on exactly the chosen screen and puts the item on it", async () => {
    const { hostShowOnDisplay } = await import("./dockDisplayHost");
    const result = await hostShowOnDisplay(saved, item);
    expect(result).toMatchObject({ ok: true, status: "ready" });
    expect(window.openProjector).toHaveBeenCalledWith("program", "pj", { exactMonitor: true, rememberScreen: false });
    expect(engine.goLiveItem).toHaveBeenCalledWith(item, "fullscreen");
  });

  it("tells the operator when it opens a new projector, not when it reuses one", async () => {
    const { hostShowOnDisplay, onDockDisplayNotice } = await import("./dockDisplayHost");
    const notices: Array<[string, string]> = [];
    const stop = onDockDisplayNotice((message, tone) => notices.push([message, tone]));
    await hostShowOnDisplay(saved, item);
    expect(notices).toEqual([["Showing on EPSON PJ. To close it: Output → Close all projectors, or right-click it.", "info"]]);
    for (const listener of state.projectorListeners) listener([]);
    window.openProjector.mockResolvedValueOnce({ label: "studio-projector-pj", feed: "program", monitorKey: "pj", where: "pj", reused: true } as never);
    await hostShowOnDisplay(saved, item);
    expect(notices).toHaveLength(1);
    stop();
  });

  it("does not project anywhere when the saved screen is unplugged", async () => {
    state.monitors = [laptop];
    const { hostShowOnDisplay } = await import("./dockDisplayHost");
    const result = await hostShowOnDisplay(saved, item);
    expect(result).toMatchObject({ ok: false, status: "missing" });
    expect(result.message).toContain("EPSON PJ isn't connected");
    expect(window.openProjector).not.toHaveBeenCalled();
    expect(engine.goLiveItem).not.toHaveBeenCalled();
  });

  it("reports a projector that fails to open instead of throwing", async () => {
    window.openProjector.mockRejectedValueOnce(new Error("That display is no longer connected."));
    const { hostShowOnDisplay } = await import("./dockDisplayHost");
    await expect(hostShowOnDisplay(saved, item)).resolves.toMatchObject({
      ok: false,
      status: "error",
      message: "That display is no longer connected.",
    });
  });

  it("tells the Dock when its projector's screen was unplugged, and opens a fresh one next time", async () => {
    const { hostShowOnDisplay, onDockDisplayNotice } = await import("./dockDisplayHost");
    const notices: string[] = [];
    const stop = onDockDisplayNotice((message) => notices.push(message));
    await hostShowOnDisplay(saved, item);
    // Studio's own watcher closes the window and reports it.
    for (const listener of state.screenLostListeners) listener({ label: "studio-projector-pj", where: "EPSON PJ" });
    expect(notices[notices.length - 1]).toContain("EPSON PJ was disconnected");
    window.openProjector.mockClear();
    await hostShowOnDisplay(saved, item);
    expect(window.openProjector).toHaveBeenCalledTimes(1);
    expect(bridge.publish).toHaveBeenCalledWith(expect.objectContaining({ channel: "dock-display", type: "notice" }));
    stop();
  });

  it("reuses the open projector for the next verse without checking screens again", async () => {
    const { hostShowOnDisplay } = await import("./dockDisplayHost");
    await hostShowOnDisplay(saved, item);
    window.listStudioMonitors.mockClear();
    window.openProjector.mockClear();
    const next = { ...item, label: "John 3:17" };
    await expect(hostShowOnDisplay(saved, next, "lower-third")).resolves.toMatchObject({ ok: true });
    expect(window.listStudioMonitors).not.toHaveBeenCalled();
    expect(window.openProjector).not.toHaveBeenCalled();
    expect(engine.goLiveItem).toHaveBeenLastCalledWith(next, "lower-third");
  });

  it("opens the projector again after it was closed", async () => {
    const { hostShowOnDisplay } = await import("./dockDisplayHost");
    await hostShowOnDisplay(saved, item);
    for (const listener of state.projectorListeners) listener([]);
    window.openProjector.mockClear();
    await hostShowOnDisplay(saved, item);
    expect(window.openProjector).toHaveBeenCalledTimes(1);
  });

  it("clears in the look it last showed", async () => {
    const { hostShowOnDisplay, hostClearDisplay } = await import("./dockDisplayHost");
    await hostShowOnDisplay(saved, item, "lower-third");
    state.active = "bible";
    await hostClearDisplay("bible");
    expect(engine.clearProgram).toHaveBeenCalledWith("lower-third", { preserveAlternate: true });
  });

  it("Close all projectors closes every projector and forgets the Dock's", async () => {
    const { hostShowOnDisplay, hostCloseAllProjectors } = await import("./dockDisplayHost");
    await hostShowOnDisplay(saved, item);
    await hostCloseAllProjectors();
    expect(window.closeAllProjectors).toHaveBeenCalledTimes(1);
    window.openProjector.mockClear();
    await hostShowOnDisplay(saved, item);
    expect(window.openProjector).toHaveBeenCalledTimes(1);
  });

  it("only clears the display when it is showing this tab's content", async () => {
    const { hostClearDisplay } = await import("./dockDisplayHost");
    state.active = "worship";
    await hostClearDisplay("bible");
    expect(engine.clearProgram).not.toHaveBeenCalled();
    state.active = "bible";
    await hostClearDisplay("bible");
    expect(engine.clearProgram).toHaveBeenCalledWith("fullscreen", { preserveAlternate: true });
  });
});
