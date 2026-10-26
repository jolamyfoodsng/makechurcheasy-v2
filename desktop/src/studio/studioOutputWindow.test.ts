import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeWindow = {
  label: string;
  decorated: boolean;
  x: number;
  y: number;
  destroyed: boolean;
};

const state = vi.hoisted(() => ({
  windows: [] as FakeWindow[],
  invokes: [] as Array<{ cmd: string; args: Record<string, unknown> }>,
}));

const projector = { name: "Samsung", position: { x: -3840, y: 0 }, size: { width: 3840, height: 2160 }, scaleFactor: 1 };
const laptop = { name: "Built-in", position: { x: 0, y: 0 }, size: { width: 3024, height: 1964 }, scaleFactor: 2 };

function handle(w: FakeWindow) {
  return {
    label: w.label,
    isDecorated: async () => w.decorated,
    outerPosition: async () => ({ x: w.x, y: w.y }),
    show: async () => undefined,
    setFocus: async () => undefined,
    setFullscreen: async () => undefined,
    setPosition: async () => undefined,
    setSize: async () => undefined,
    destroy: async () => { w.destroyed = true; state.windows = state.windows.filter((x) => x !== w); },
    close: async () => undefined,
    once: async () => () => undefined,
  };
}

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getAllWebviewWindows: async () => state.windows.map(handle),
  WebviewWindow: {
    getByLabel: async (label: string) => {
      const w = state.windows.find((x) => x.label === label);
      return w ? handle(w) : null;
    },
  },
}));
const screens = vi.hoisted(() => ({ connected: true }));
vi.mock("@tauri-apps/api/window", () => ({
  availableMonitors: async () => (screens.connected ? [laptop, projector] : [laptop]),
  currentMonitor: async () => laptop,
  PhysicalPosition: class {},
  PhysicalSize: class {},
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    state.invokes.push({ cmd, args });
    if (cmd === "open_studio_projector") {
      state.windows.push({ label: String(args.label), decorated: Boolean(args.decorations), x: Number(args.x), y: Number(args.y), destroyed: false });
    }
  },
}));
vi.mock("../services/overlayUrl", () => ({ getOverlayBaseUrl: async () => "http://127.0.0.1:45678" }));
vi.mock("./studioEngine", () => ({ toLoopbackBase: (base: string) => base }));
vi.mock("../dock/dockOverlayBridge", () => ({ overlayBridge: { subscribe: () => () => undefined, connect: () => undefined } }));

const samsungKey = "Samsung@-3840,0:3840x2160";

describe("studio projectors: one per screen", () => {
  beforeEach(() => {
    vi.resetModules();
    state.windows = [];
    state.invokes = [];
    screens.connected = true;
    vi.useRealTimers();
  });

  it("closes a projector within a second of its screen being unplugged, and says so", async () => {
    vi.useFakeTimers();
    const { openProjector, onProjectorScreenLost, listOpenProjectors } = await import("./studioOutputWindow");
    const lost: string[] = [];
    onProjectorScreenLost((p) => lost.push(p.where));
    await openProjector("program", samsungKey, { exactMonitor: true });
    screens.connected = false;
    await vi.advanceTimersByTimeAsync(1100);
    expect(state.windows).toHaveLength(0);
    expect(listOpenProjectors()).toEqual([]);
    expect(lost).toEqual(["Samsung"]);
  });

  it("closes every projector, including ones left from before a reload", async () => {
    state.windows = [
      { label: "studio-projector-program-1-1", decorated: false, x: -3840, y: 0, destroyed: false },
      { label: "studio-projector-preview-2-2", decorated: true, x: 100, y: 100, destroyed: false },
    ];
    const { closeAllProjectors } = await import("./studioOutputWindow");
    await closeAllProjectors();
    expect(state.windows).toHaveLength(0);
  });

  it("takes back windows left from before a reload and closes duplicates on the same screen", async () => {
    state.windows = [
      { label: "studio-projector-program-1-1", decorated: false, x: -3840, y: 0, destroyed: false },
      { label: "studio-projector-program-2-2", decorated: false, x: -3840, y: 0, destroyed: false },
      { label: "studio-projector-program-3-3", decorated: false, x: -3840, y: 0, destroyed: false },
    ];
    const { adoptStrayProjectors, listOpenProjectors } = await import("./studioOutputWindow");
    await adoptStrayProjectors();
    expect(listOpenProjectors()).toEqual([
      { label: "studio-projector-program-1-1", feed: "program", monitorKey: samsungKey, where: "Samsung" },
    ]);
    expect(state.windows.map((w) => w.label)).toEqual(["studio-projector-program-1-1"]);
  });

  it("reuses the projector already on that screen instead of opening another", async () => {
    state.windows = [{ label: "studio-projector-program-1-1", decorated: false, x: -3840, y: 0, destroyed: false }];
    const { openProjector } = await import("./studioOutputWindow");
    const opened = await openProjector("program", samsungKey, { exactMonitor: true });
    expect(opened).toMatchObject({ label: "studio-projector-program-1-1", reused: true });
    expect(state.invokes.some((i) => i.cmd === "open_studio_projector")).toBe(false);
    expect(state.windows).toHaveLength(1);
  });

  it("opening twice on the same screen leaves one window", async () => {
    const { openProjector } = await import("./studioOutputWindow");
    const first = await openProjector("program", samsungKey, { exactMonitor: true });
    const second = await openProjector("program", samsungKey, { exactMonitor: true });
    expect(second.label).toBe(first.label);
    expect(state.windows).toHaveLength(1);
  });

  it("keeps a separate projector on a different screen", async () => {
    state.windows = [{ label: "studio-projector-program-1-1", decorated: false, x: 0, y: 0, destroyed: false }];
    const { openProjector, listOpenProjectors } = await import("./studioOutputWindow");
    await openProjector("program", samsungKey, { exactMonitor: true });
    expect(listOpenProjectors().map((p) => p.monitorKey).sort()).toEqual(["Built-in@0,0:3024x1964", samsungKey].sort());
  });
});
