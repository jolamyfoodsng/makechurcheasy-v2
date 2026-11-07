import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  DEFAULT_SCRIPTURE_GOLD_CIRCLE_SETTINGS,
  normalizeScriptureGoldCircleSettings,
  loadScriptureGoldCircleSettings,
  saveScriptureGoldCircleSettings,
  buildScriptureGoldCirclePanelUrl,
  applyScriptureGoldCircleLook,
  SCRIPTURE_GOLD_CIRCLE_SCENE_NAME,
  SCRIPTURE_GOLD_CIRCLE_PANEL_SOURCE,
  SCRIPTURE_GOLD_CIRCLE_BG_SOURCE,
  SCRIPTURE_GOLD_CIRCLE_LAYOUT_PREFIX,
  scriptureGoldCircleLayoutId,
  isScriptureGoldCircleLayoutId,
  parseScriptureGoldCircleThemeId,
  listScriptureGoldCircleThemes,
  saveScriptureGoldCircleTheme,
  getScriptureGoldCircleTheme,
  deleteScriptureGoldCircleTheme,
  renameScriptureGoldCircleTheme,
  type ScriptureGoldCircleObsClient,
} from "./scriptureGoldCircleLook";

describe("normalizeScriptureGoldCircleSettings", () => {
  it("keeps a fully valid settings object as it is", () => {
    const settings = {
      cameraSceneName: "Main Camera", accentColor: "#112233", backgroundColor: "#eeeeee", textColor: "#ffffff",
      showLive: false, circle: { x: 10, y: 20, diameter: 500 }, camera: { zoom: 1.5, focusX: 30, focusY: 70 },
      animationIn: "fade-up" as const,
    };
    expect(normalizeScriptureGoldCircleSettings(settings)).toEqual(settings);
  });

  it("falls back to the defaults for anything missing or invalid", () => {
    expect(normalizeScriptureGoldCircleSettings(null)).toEqual(DEFAULT_SCRIPTURE_GOLD_CIRCLE_SETTINGS);
    expect(normalizeScriptureGoldCircleSettings({})).toEqual(DEFAULT_SCRIPTURE_GOLD_CIRCLE_SETTINGS);
    expect(normalizeScriptureGoldCircleSettings({ accentColor: "not-a-color" }).accentColor).toBe(DEFAULT_SCRIPTURE_GOLD_CIRCLE_SETTINGS.accentColor);
    expect(normalizeScriptureGoldCircleSettings({ circle: { diameter: 9999 } }).circle.diameter).toBe(DEFAULT_SCRIPTURE_GOLD_CIRCLE_SETTINGS.circle.diameter);
    expect(normalizeScriptureGoldCircleSettings({ circle: { diameter: -5 } }).circle.diameter).toBe(DEFAULT_SCRIPTURE_GOLD_CIRCLE_SETTINGS.circle.diameter);
  });

  it("keeps the camera framing in range", () => {
    const n = normalizeScriptureGoldCircleSettings({ camera: { zoom: 9, focusX: -20, focusY: 400 } });
    expect(n.camera).toEqual({ zoom: 3, focusX: 0, focusY: 100 });
  });

  it("keeps the circle inside the 1920 x 1080 canvas", () => {
    const n = normalizeScriptureGoldCircleSettings({ circle: { x: 5000, y: 5000, diameter: 400 } });
    expect(n.circle.x).toBeLessThanOrEqual(1920 - 400);
    expect(n.circle.y).toBeLessThanOrEqual(1080 - 400);
  });

  it("trims a camera scene name and ignores a non-string one", () => {
    expect(normalizeScriptureGoldCircleSettings({ cameraSceneName: "  Main Camera  " }).cameraSceneName).toBe("Main Camera");
    expect(normalizeScriptureGoldCircleSettings({ cameraSceneName: 42 as unknown as string }).cameraSceneName).toBe("");
  });

  it("defaults animationIn to \"none\" and falls back on an invalid value", () => {
    expect(normalizeScriptureGoldCircleSettings(null).animationIn).toBe("none");
    expect(normalizeScriptureGoldCircleSettings({}).animationIn).toBe("none");
    expect(normalizeScriptureGoldCircleSettings({ animationIn: "spin-wildly" as never }).animationIn).toBe("none");
  });

  it("keeps a valid animationIn value", () => {
    expect(normalizeScriptureGoldCircleSettings({ animationIn: "slide-up" }).animationIn).toBe("slide-up");
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
    const saved = saveScriptureGoldCircleSettings({ ...DEFAULT_SCRIPTURE_GOLD_CIRCLE_SETTINGS, cameraSceneName: "Main Camera", accentColor: "#aabbcc", textColor: "#000000", circle: { x: 1, y: 2, diameter: 300 }, animationIn: "bounce-in" });
    expect(loadScriptureGoldCircleSettings()).toEqual(saved);
    expect(loadScriptureGoldCircleSettings().animationIn).toBe("bounce-in");
  });

  it("returns the defaults when nothing is saved yet", () => {
    expect(loadScriptureGoldCircleSettings()).toEqual(DEFAULT_SCRIPTURE_GOLD_CIRCLE_SETTINGS);
  });

  it("does not throw on corrupted storage", () => {
    localStorage.setItem("mce-dock-scripture-gold-circle-settings", "{not json");
    expect(loadScriptureGoldCircleSettings()).toEqual(DEFAULT_SCRIPTURE_GOLD_CIRCLE_SETTINGS);
  });
});

describe("buildScriptureGoldCirclePanelUrl", () => {
  it("carries the colors and circle geometry, and listens on the bible relay channel", () => {
    const url = buildScriptureGoldCirclePanelUrl({ ...DEFAULT_SCRIPTURE_GOLD_CIRCLE_SETTINGS, cameraSceneName: "Main Camera", accentColor: "#D4AF6A", textColor: "#F5F1E8", circle: { x: 102, y: 94, diameter: 700 } });
    expect(url).toContain("mce-multiview-scripture-gold-circle.html");
    expect(url).toContain("tab=bible");
    expect(url).toContain("accent=D4AF6A");
    expect(url).toContain("text=F5F1E8");
    expect(url).toContain("cx=102");
    expect(url).toContain("cy=94");
    expect(url).toContain("cd=700");
  });

  it("carries the background color and the LIVE switch", () => {
    const url = buildScriptureGoldCirclePanelUrl({ ...DEFAULT_SCRIPTURE_GOLD_CIRCLE_SETTINGS, backgroundColor: "#102030", showLive: false });
    expect(url).toContain("bg=102030");
    expect(url).toContain("live=0");
  });

  it("carries the chosen animate-in style", () => {
    const url = buildScriptureGoldCirclePanelUrl({ ...DEFAULT_SCRIPTURE_GOLD_CIRCLE_SETTINGS, animationIn: "flip-in" });
    expect(url).toContain("anim=flip-in");
  });
});

describe("scriptureGoldCircleLayoutId / parseScriptureGoldCircleThemeId", () => {
  it("round-trips a theme id through the synthetic layout id", () => {
    const layoutId = scriptureGoldCircleLayoutId("abc123");
    expect(layoutId).toBe(`${SCRIPTURE_GOLD_CIRCLE_LAYOUT_PREFIX}abc123`);
    expect(isScriptureGoldCircleLayoutId(layoutId)).toBe(true);
    expect(parseScriptureGoldCircleThemeId(layoutId)).toBe("abc123");
  });

  it("does not treat a real GalleryLayout id as a Scripture Gold Circle one", () => {
    expect(isScriptureGoldCircleLayoutId("quad")).toBe(false);
    expect(parseScriptureGoldCircleThemeId("quad")).toBeNull();
    expect(isScriptureGoldCircleLayoutId(undefined)).toBe(false);
    expect(isScriptureGoldCircleLayoutId(null)).toBe(false);
  });
});

describe("Scripture Gold Circle theme CRUD", () => {
  beforeEach(() => { installLocalStorageMock(); });

  it("returns an empty list when nothing is saved yet", () => {
    expect(listScriptureGoldCircleThemes()).toEqual([]);
  });

  it("creates a theme with a generated id and default name", () => {
    const theme = saveScriptureGoldCircleTheme({ name: "", settings: DEFAULT_SCRIPTURE_GOLD_CIRCLE_SETTINGS });
    expect(theme.id).toBeTruthy();
    expect(theme.name).toBe("Scripture Gold Circle");
    expect(listScriptureGoldCircleThemes()).toHaveLength(1);
  });

  it("bumps the default name when it's already taken", () => {
    saveScriptureGoldCircleTheme({ name: "", settings: DEFAULT_SCRIPTURE_GOLD_CIRCLE_SETTINGS });
    const second = saveScriptureGoldCircleTheme({ name: "", settings: DEFAULT_SCRIPTURE_GOLD_CIRCLE_SETTINGS });
    const third = saveScriptureGoldCircleTheme({ name: "", settings: DEFAULT_SCRIPTURE_GOLD_CIRCLE_SETTINGS });
    expect(second.name).toBe("Scripture Gold Circle 2");
    expect(third.name).toBe("Scripture Gold Circle 3");
  });

  it("updates an existing theme in place when saved again with its id", () => {
    const first = saveScriptureGoldCircleTheme({ name: "Morning Service", settings: DEFAULT_SCRIPTURE_GOLD_CIRCLE_SETTINGS });
    const updatedSettings = { ...DEFAULT_SCRIPTURE_GOLD_CIRCLE_SETTINGS, accentColor: "#000000" };
    const second = saveScriptureGoldCircleTheme({ id: first.id, name: "Morning Service", settings: updatedSettings });

    expect(second.id).toBe(first.id);
    expect(listScriptureGoldCircleThemes()).toHaveLength(1);
    expect(getScriptureGoldCircleTheme(first.id)?.settings.accentColor).toBe("#000000");
  });

  it("supports multiple named themes at once", () => {
    const a = saveScriptureGoldCircleTheme({ name: "Morning", settings: DEFAULT_SCRIPTURE_GOLD_CIRCLE_SETTINGS });
    const b = saveScriptureGoldCircleTheme({ name: "Evening", settings: { ...DEFAULT_SCRIPTURE_GOLD_CIRCLE_SETTINGS, accentColor: "#111111" } });

    const all = listScriptureGoldCircleThemes();
    expect(all.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
    expect(getScriptureGoldCircleTheme(a.id)?.name).toBe("Morning");
    expect(getScriptureGoldCircleTheme(b.id)?.name).toBe("Evening");
  });

  it("renames a theme without touching its settings", () => {
    const theme = saveScriptureGoldCircleTheme({ name: "Old Name", settings: DEFAULT_SCRIPTURE_GOLD_CIRCLE_SETTINGS });
    const renamed = renameScriptureGoldCircleTheme(theme.id, "New Name");
    expect(renamed?.name).toBe("New Name");
    expect(getScriptureGoldCircleTheme(theme.id)?.name).toBe("New Name");
  });

  it("returns null when renaming a theme that doesn't exist", () => {
    expect(renameScriptureGoldCircleTheme("missing", "Whatever")).toBeNull();
  });

  it("deletes a theme", () => {
    const theme = saveScriptureGoldCircleTheme({ name: "Temp", settings: DEFAULT_SCRIPTURE_GOLD_CIRCLE_SETTINGS });
    deleteScriptureGoldCircleTheme(theme.id);
    expect(getScriptureGoldCircleTheme(theme.id)).toBeNull();
    expect(listScriptureGoldCircleThemes()).toEqual([]);
  });

  it("does not throw on corrupted theme storage", () => {
    localStorage.setItem("mce-dock-scripture-gold-circle-themes", "{not json");
    expect(listScriptureGoldCircleThemes()).toEqual([]);
  });

  it("ignores malformed entries in the saved list", () => {
    localStorage.setItem("mce-dock-scripture-gold-circle-themes", JSON.stringify([{ foo: "bar" }, null, 42]));
    expect(listScriptureGoldCircleThemes()).toEqual([]);
  });
});

describe("applyScriptureGoldCircleLook", () => {
  function fakeObs(initialScenes: string[] = []) {
    const scenes = new Set(initialScenes);
    const items = new Map<string, number>();
    const transforms = new Map<number, Record<string, unknown>>();
    const indexes = new Map<number, number>();
    let nextId = 1;
    const calls: Array<{ type: string; params?: Record<string, unknown> }> = [];
    const client: ScriptureGoldCircleObsClient = {
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
    const settings = normalizeScriptureGoldCircleSettings({ cameraSceneName: "Main Camera" });

    const result = await applyScriptureGoldCircleLook(client, settings);

    expect(result.sceneName).toBe(SCRIPTURE_GOLD_CIRCLE_SCENE_NAME);
    expect(scenes.has(SCRIPTURE_GOLD_CIRCLE_SCENE_NAME)).toBe(true);
    expect(items.has(SCRIPTURE_GOLD_CIRCLE_BG_SOURCE)).toBe(true);
    expect(items.has("Main Camera")).toBe(true);
    expect(items.has(SCRIPTURE_GOLD_CIRCLE_PANEL_SOURCE)).toBe(true);
    expect(indexes.get(items.get(SCRIPTURE_GOLD_CIRCLE_BG_SOURCE)!)).toBe(0);
    expect(indexes.get(items.get("Main Camera")!)).toBe(1);
    expect(indexes.get(items.get(SCRIPTURE_GOLD_CIRCLE_PANEL_SOURCE)!)).toBe(2);
  });

  it("refuses to run without a chosen camera scene", async () => {
    const { client } = fakeObs();
    await expect(applyScriptureGoldCircleLook(client, normalizeScriptureGoldCircleSettings({}))).rejects.toThrow(/camera/i);
  });

  it("reuses the existing items instead of duplicating them when applied again", async () => {
    const { client, items, calls } = fakeObs();
    const settings = normalizeScriptureGoldCircleSettings({ cameraSceneName: "Main Camera" });

    await applyScriptureGoldCircleLook(client, settings);
    const afterFirst = items.size;
    calls.length = 0;
    await applyScriptureGoldCircleLook(client, { ...settings, accentColor: "#000000" });

    expect(items.size).toBe(afterFirst);
    expect(calls.some((c) => c.type === "CreateInput")).toBe(false);
    expect(calls.some((c) => c.type === "CreateSceneItem")).toBe(false);
    expect(calls.some((c) => c.type === "SetInputSettings")).toBe(true);
  });

  it("crops the camera to fully cover the circle's bounding box", async () => {
    const { client, items, transforms } = fakeObs();
    const settings = normalizeScriptureGoldCircleSettings({ cameraSceneName: "Main Camera", circle: { x: 102, y: 94, diameter: 700 } });

    await applyScriptureGoldCircleLook(client, settings);

    const camTransform = transforms.get(items.get("Main Camera")!) as { positionX: number; positionY: number };
    expect(camTransform.positionX).toBe(102);
    expect(camTransform.positionY).toBe(94);
  });
});
