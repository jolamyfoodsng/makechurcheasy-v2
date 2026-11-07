import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Appearance now lives in the native dock settings store (not localStorage), which fills in
// once the signed-in user's scope hydrates. The store is stood in for by a plain map.
const nativeSettings = new Map<string, unknown>();

vi.mock("./localDockSettings", () => ({
  readNativeDockSetting: (key: string) => nativeSettings.get(key),
  writeNativeDockSetting: (key: string, value: unknown) => {
    nativeSettings.set(key, value);
    return Promise.resolve();
  },
}));

describe("app appearance hydration", () => {
  beforeEach(() => {
    nativeSettings.clear();
    vi.stubGlobal("window", {
      location: { pathname: "/settings" },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("BroadcastChannel", undefined);
  });

  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("rehydrates a saved palette after the user's settings become available", async () => {
    vi.resetModules();
    const appearance = await import("./appAppearance");
    expect(appearance.loadAppAppearance().palette).toBe("classic-blue");

    nativeSettings.set("ocs-app-appearance", {
      palette: "ember",
      customAccent: "#C2410C",
      updatedAt: Date.now(),
    });

    expect(appearance.refreshAppAppearance().palette).toBe("ember");
  });
});
