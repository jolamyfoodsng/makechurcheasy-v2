import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  DEFAULT_SCRIPTURE_ARCH_SETTINGS,
  normalizeScriptureArchSettings,
  loadScriptureArchSettings,
  saveScriptureArchSettings,
  buildScriptureArchPanelUrl,
  cameraTargetRect,
  applyScriptureArchLook,
  SCRIPTURE_ARCH_SCENE_NAME,
  SCRIPTURE_ARCH_PANEL_SOURCE,
  SCRIPTURE_ARCH_BG_SOURCE,
  SCRIPTURE_ARCH_LAYOUT_PREFIX,
  scriptureArchLayoutId,
  isScriptureArchLayoutId,
  parseScriptureArchThemeId,
  listScriptureArchThemes,
  saveScriptureArchTheme,
  getScriptureArchTheme,
  deleteScriptureArchTheme,
  renameScriptureArchTheme,
  type ScriptureArchObsClient,
} from "./scriptureArchLook";

describe("normalizeScriptureArchSettings", () => {
  it("keeps a fully valid settings object as it is", () => {
    const settings = {
      cameraSceneName: "Main Camera", accentColor: "#112233", backgroundColor: "#eeeeee", textColor: "#ffffff",
      showLive: false, window: { x: 10, y: 20, width: 500, height: 700 }, camera: { zoom: 1.5, focusX: 30, focusY: 70 },
      animationIn: "fade-up" as const,
    };
    expect(normalizeScriptureArchSettings(settings)).toEqual(settings);
  });

  it("falls back to the defaults for anything missing or invalid", () => {
    expect(normalizeScriptureArchSettings(null)).toEqual(DEFAULT_SCRIPTURE_ARCH_SETTINGS);
    expect(normalizeScriptureArchSettings({})).toEqual(DEFAULT_SCRIPTURE_ARCH_SETTINGS);
    expect(normalizeScriptureArchSettings({ accentColor: "not-a-color" }).accentColor).toBe(DEFAULT_SCRIPTURE_ARCH_SETTINGS.accentColor);
    expect(normalizeScriptureArchSettings({ window: { width: 9999 } }).window.width).toBe(DEFAULT_SCRIPTURE_ARCH_SETTINGS.window.width);
    expect(normalizeScriptureArchSettings({ window: { width: -5 } }).window.width).toBe(DEFAULT_SCRIPTURE_ARCH_SETTINGS.window.width);
  });

  it("keeps the camera framing in range", () => {
    const n = normalizeScriptureArchSettings({ camera: { zoom: 9, focusX: -20, focusY: 400 } });
    expect(n.camera).toEqual({ zoom: 3, focusX: 0, focusY: 100 });
  });

  it("keeps the window inside the 1920 x 1080 canvas", () => {
    const n = normalizeScriptureArchSettings({ window: { x: 5000, y: 5000, width: 400, height: 400 } });
    expect(n.window.x).toBeLessThanOrEqual(1920 - 400);
    expect(n.window.y).toBeLessThanOrEqual(1080 - 400);
  });

  it("trims a camera scene name and ignores a non-string one", () => {
    expect(normalizeScriptureArchSettings({ cameraSceneName: "  Main Camera  " }).cameraSceneName).toBe("Main Camera");
    expect(normalizeScriptureArchSettings({ cameraSceneName: 42 as unknown as string }).cameraSceneName).toBe("");
  });

  it("defaults animationIn to \"none\" and falls back on an invalid value", () => {
    expect(normalizeScriptureArchSettings(null).animationIn).toBe("none");
    expect(normalizeScriptureArchSettings({}).animationIn).toBe("none");
    expect(normalizeScriptureArchSettings({ animationIn: "spin-wildly" as never }).animationIn).toBe("none");
  });

  it("keeps a valid animationIn value", () => {
    expect(normalizeScriptureArchSettings({ animationIn: "slide-up" }).animationIn).toBe("slide-up");
  });
});

function installLocalStorageMock() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
  });
}

describe("settings persistence", () => {
  beforeEach(() => { installLocalStorageMock(); });

  it("round-trips through localStorage", () => {
    const saved = saveScriptureArchSettings({ ...DEFAULT_SCRIPTURE_ARCH_SETTINGS, cameraSceneName: "Main Camera", accentColor: "#aabbcc", textColor: "#000000", window: { x: 1, y: 2, width: 300, height: 400 }, animationIn: "bounce-in" });
    expect(loadScriptureArchSettings()).toEqual(saved);
    expect(loadScriptureArchSettings().animationIn).toBe("bounce-in");
  });

  it("returns the defaults when nothing is saved yet", () => {
    expect(loadScriptureArchSettings()).toEqual(DEFAULT_SCRIPTURE_ARCH_SETTINGS);
  });

  it("does not throw on corrupted storage", () => {
    localStorage.setItem("mce-dock-scripture-arch-settings", "{not json");
    expect(loadScriptureArchSettings()).toEqual(DEFAULT_SCRIPTURE_ARCH_SETTINGS);
  });
});

describe("buildScriptureArchPanelUrl", () => {
  it("carries the colors and window geometry, and listens on the bible relay channel", () => {
    const url = buildScriptureArchPanelUrl({ ...DEFAULT_SCRIPTURE_ARCH_SETTINGS, cameraSceneName: "Main Camera", accentColor: "#2254F4", textColor: "#0B1437", window: { x: 102, y: 94, width: 540, height: 760 } });
    expect(url).toContain("mce-multiview-scripture-arch.html");
    expect(url).toContain("tab=bible");
    expect(url).toContain("accent=2254F4");
    expect(url).toContain("text=0B1437");
    expect(url).toContain("wx=102");
    expect(url).toContain("wy=94");
    expect(url).toContain("ww=540");
    expect(url).toContain("wh=760");
  });

  it("carries the background color and the LIVE switch", () => {
    const url = buildScriptureArchPanelUrl({ ...DEFAULT_SCRIPTURE_ARCH_SETTINGS, backgroundColor: "#102030", showLive: false });
    expect(url).toContain("bg=102030");
    expect(url).toContain("live=0");
  });

  it("carries the chosen animate-in style", () => {
    const url = buildScriptureArchPanelUrl({ ...DEFAULT_SCRIPTURE_ARCH_SETTINGS, animationIn: "flip-in" });
    expect(url).toContain("anim=flip-in");
  });
});

describe("scriptureArchLayoutId / parseScriptureArchThemeId", () => {
  it("round-trips a theme id through the synthetic layout id", () => {
    const layoutId = scriptureArchLayoutId("abc123");
    expect(layoutId).toBe(`${SCRIPTURE_ARCH_LAYOUT_PREFIX}abc123`);
    expect(isScriptureArchLayoutId(layoutId)).toBe(true);
    expect(parseScriptureArchThemeId(layoutId)).toBe("abc123");
  });

  it("does not treat a real GalleryLayout id as a Scripture Arch one", () => {
    expect(isScriptureArchLayoutId("quad")).toBe(false);
    expect(parseScriptureArchThemeId("quad")).toBeNull();
    expect(isScriptureArchLayoutId(undefined)).toBe(false);
    expect(isScriptureArchLayoutId(null)).toBe(false);
  });
});

describe("Scripture Arch theme CRUD", () => {
  beforeEach(() => { installLocalStorageMock(); });

  it("returns an empty list when nothing is saved yet", () => {
    expect(listScriptureArchThemes()).toEqual([]);
  });

  it("creates a theme with a generated id and default name", () => {
    const theme = saveScriptureArchTheme({ name: "", settings: DEFAULT_SCRIPTURE_ARCH_SETTINGS });
    expect(theme.id).toBeTruthy();
    expect(theme.name).toBe("Scripture Arch");
    expect(listScriptureArchThemes()).toHaveLength(1);
  });

  it("bumps the default name when it's already taken", () => {
    saveScriptureArchTheme({ name: "", settings: DEFAULT_SCRIPTURE_ARCH_SETTINGS });
    const second = saveScriptureArchTheme({ name: "", settings: DEFAULT_SCRIPTURE_ARCH_SETTINGS });
    const third = saveScriptureArchTheme({ name: "", settings: DEFAULT_SCRIPTURE_ARCH_SETTINGS });
    expect(second.name).toBe("Scripture Arch 2");
    expect(third.name).toBe("Scripture Arch 3");
  });

  it("updates an existing theme in place when saved again with its id", () => {
    const first = saveScriptureArchTheme({ name: "Morning Service", settings: DEFAULT_SCRIPTURE_ARCH_SETTINGS });
    const updatedSettings = { ...DEFAULT_SCRIPTURE_ARCH_SETTINGS, accentColor: "#000000" };
    const second = saveScriptureArchTheme({ id: first.id, name: "Morning Service", settings: updatedSettings });

    expect(second.id).toBe(first.id);
    expect(listScriptureArchThemes()).toHaveLength(1);
    expect(getScriptureArchTheme(first.id)?.settings.accentColor).toBe("#000000");
  });

  it("supports multiple named themes at once", () => {
    const a = saveScriptureArchTheme({ name: "Morning", settings: DEFAULT_SCRIPTURE_ARCH_SETTINGS });
    const b = saveScriptureArchTheme({ name: "Evening", settings: { ...DEFAULT_SCRIPTURE_ARCH_SETTINGS, accentColor: "#111111" } });

    const all = listScriptureArchThemes();
    expect(all.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
    expect(getScriptureArchTheme(a.id)?.name).toBe("Morning");
    expect(getScriptureArchTheme(b.id)?.name).toBe("Evening");
  });

  it("renames a theme without touching its settings", () => {
    const theme = saveScriptureArchTheme({ name: "Old Name", settings: DEFAULT_SCRIPTURE_ARCH_SETTINGS });
    const renamed = renameScriptureArchTheme(theme.id, "New Name");
    expect(renamed?.name).toBe("New Name");
    expect(getScriptureArchTheme(theme.id)?.name).toBe("New Name");
  });

  it("returns null when renaming a theme that doesn't exist", () => {
    expect(renameScriptureArchTheme("missing", "Whatever")).toBeNull();
  });

  it("deletes a theme", () => {
    const theme = saveScriptureArchTheme({ name: "Temp", settings: DEFAULT_SCRIPTURE_ARCH_SETTINGS });
    deleteScriptureArchTheme(theme.id);
    expect(getScriptureArchTheme(theme.id)).toBeNull();
    expect(listScriptureArchThemes()).toEqual([]);
  });

  it("does not throw on corrupted theme storage", () => {
    localStorage.setItem("mce-dock-scripture-arch-themes", "{not json");
    expect(listScriptureArchThemes()).toEqual([]);
  });

  it("ignores malformed entries in the saved list", () => {
    localStorage.setItem("mce-dock-scripture-arch-themes", JSON.stringify([{ foo: "bar" }, null, 42]));
    expect(listScriptureArchThemes()).toEqual([]);
  });
});

describe("cameraTargetRect", () => {
  it("is the window's own bounding box, so a centered fill always fully covers it", () => {
    expect(cameraTargetRect({ x: 102, y: 94, width: 540, height: 760 })).toEqual({ x: 102, y: 94, width: 540, height: 760 });
  });

  it("scales the window onto a smaller OBS canvas", () => {
    const rect = cameraTargetRect({ x: 90, y: 60, width: 540, height: 760 }, 2 / 3);
    expect(rect.x).toBe(60);
    expect(rect.y).toBe(40);
    expect(rect.width).toBe(360);
    expect(rect.height).toBeCloseTo(760 * (2 / 3), 5);
  });
});

describe("applyScriptureArchLook", () => {
  function fakeObs(initialScenes: string[] = []) {
    const scenes = new Set(initialScenes);
    const items = new Map<string, number>();
    const transforms = new Map<number, Record<string, unknown>>();
    const indexes = new Map<number, number>();
    let nextId = 1;
    const calls: Array<{ type: string; params?: Record<string, unknown> }> = [];
    const client: ScriptureArchObsClient = {
      async call(type, params) {
        calls.push({ type, params });
        switch (type) {
          case "GetSceneList":
            return { scenes: Array.from(scenes).map((sceneName) => ({ sceneName })) };
          case "CreateScene":
            scenes.add(String(params?.sceneName));
            return {};
          case "GetSceneItemList":
            return { sceneItems: Array.from(items.entries()).map(([sourceName, sceneItemId]) => ({ sourceName, sceneItemId })) };
          case "CreateInput":
          case "CreateSceneItem": {
            const id = nextId++;
            items.set(String(params?.inputName ?? params?.sourceName), id);
            return { sceneItemId: id };
          }
          case "SetSceneItemTransform":
            transforms.set(Number(params?.sceneItemId), params?.sceneItemTransform as Record<string, unknown>);
            return {};
          case "SetSceneItemIndex":
            indexes.set(Number(params?.sceneItemId), Number(params?.sceneItemIndex));
            return {};
          case "GetSceneItemTransform":
            return { sceneItemTransform: { sourceWidth: 1920, sourceHeight: 1080 } };
          case "SetInputSettings":
            return {};
          default:
            throw new Error(`unexpected call: ${type}`);
        }
      },
    };
    return { client, scenes, items, transforms, indexes, calls };
  }

  it("creates the scene and all three items on first use", async () => {
    const { client, scenes, items, indexes } = fakeObs();
    const settings = normalizeScriptureArchSettings({ cameraSceneName: "Main Camera" });

    const result = await applyScriptureArchLook(client, settings);

    expect(result.sceneName).toBe(SCRIPTURE_ARCH_SCENE_NAME);
    expect(scenes.has(SCRIPTURE_ARCH_SCENE_NAME)).toBe(true);
    expect(items.has(SCRIPTURE_ARCH_BG_SOURCE)).toBe(true);
    expect(items.has("Main Camera")).toBe(true);
    expect(items.has(SCRIPTURE_ARCH_PANEL_SOURCE)).toBe(true);
    expect(indexes.get(items.get(SCRIPTURE_ARCH_BG_SOURCE)!)).toBe(0);
    expect(indexes.get(items.get("Main Camera")!)).toBe(1);
    expect(indexes.get(items.get(SCRIPTURE_ARCH_PANEL_SOURCE)!)).toBe(2);
  });

  it("refuses to run without a chosen camera scene", async () => {
    const { client } = fakeObs();
    await expect(applyScriptureArchLook(client, normalizeScriptureArchSettings({}))).rejects.toThrow(/camera/i);
  });

  it("reuses the existing items instead of duplicating them when applied again", async () => {
    const { client, items, calls } = fakeObs();
    const settings = normalizeScriptureArchSettings({ cameraSceneName: "Main Camera" });

    await applyScriptureArchLook(client, settings);
    const afterFirst = items.size;
    calls.length = 0;
    await applyScriptureArchLook(client, { ...settings, accentColor: "#000000" });

    expect(items.size).toBe(afterFirst);
    expect(calls.some((c) => c.type === "CreateInput")).toBe(false);
    expect(calls.some((c) => c.type === "CreateSceneItem")).toBe(false);
    expect(calls.some((c) => c.type === "SetInputSettings")).toBe(true);
  });

  it("crops the camera to fully cover the window's bounding box", async () => {
    const { client, items, transforms } = fakeObs();
    const settings = normalizeScriptureArchSettings({ cameraSceneName: "Main Camera", window: { x: 102, y: 94, width: 540, height: 760 } });

    await applyScriptureArchLook(client, settings);

    const camTransform = transforms.get(items.get("Main Camera")!) as { positionX: number; positionY: number };
    expect(camTransform.positionX).toBe(102);
    expect(camTransform.positionY).toBe(94);
  });
});
