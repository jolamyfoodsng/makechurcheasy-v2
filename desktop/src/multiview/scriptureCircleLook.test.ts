import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  DEFAULT_SCRIPTURE_CIRCLE_SETTINGS,
  normalizeScriptureCircleSettings,
  loadScriptureCircleSettings,
  saveScriptureCircleSettings,
  buildScriptureCirclePanelUrl,
  calculateFillTransform,
  cameraTargetRect,
  applyScriptureCircleLook,
  SCRIPTURE_CIRCLE_SCENE_NAME,
  SCRIPTURE_CIRCLE_PANEL_SOURCE,
  SCRIPTURE_CIRCLE_BG_SOURCE,
  SCRIPTURE_CIRCLE_LAYOUT_PREFIX,
  scriptureCircleLayoutId,
  isScriptureCircleLayoutId,
  parseScriptureCircleThemeId,
  listScriptureCircleThemes,
  saveScriptureCircleTheme,
  getScriptureCircleTheme,
  deleteScriptureCircleTheme,
  renameScriptureCircleTheme,
  type ScriptureCircleObsClient,
} from "./scriptureCircleLook";

describe("normalizeScriptureCircleSettings", () => {
  it("keeps a fully valid settings object as it is", () => {
    const settings = {
      cameraSceneName: "Main Camera", wedgeColor: "#112233", paperColor: "#eeeeee", textColor: "#ffffff",
      showLive: false, shape: "box" as const, circle: { x: 10, y: 20, diameter: 500 }, camera: { zoom: 1.5, focusX: 30, focusY: 70 },
      animationIn: "fade-up" as const,
    };
    expect(normalizeScriptureCircleSettings(settings)).toEqual(settings);
  });

  it("falls back to the defaults for anything missing or invalid", () => {
    expect(normalizeScriptureCircleSettings(null)).toEqual(DEFAULT_SCRIPTURE_CIRCLE_SETTINGS);
    expect(normalizeScriptureCircleSettings({})).toEqual(DEFAULT_SCRIPTURE_CIRCLE_SETTINGS);
    expect(normalizeScriptureCircleSettings({ wedgeColor: "not-a-color" }).wedgeColor).toBe(DEFAULT_SCRIPTURE_CIRCLE_SETTINGS.wedgeColor);
    expect(normalizeScriptureCircleSettings({ circle: { diameter: 9999 } }).circle.diameter).toBe(DEFAULT_SCRIPTURE_CIRCLE_SETTINGS.circle.diameter);
    expect(normalizeScriptureCircleSettings({ circle: { diameter: -5 } }).circle.diameter).toBe(DEFAULT_SCRIPTURE_CIRCLE_SETTINGS.circle.diameter);
  });

  it("keeps the camera framing in range and ignores an unknown shape", () => {
    const n = normalizeScriptureCircleSettings({ shape: "hexagon" as never, camera: { zoom: 9, focusX: -20, focusY: 400 } });
    expect(n.shape).toBe("circle");
    expect(n.camera).toEqual({ zoom: 3, focusX: 0, focusY: 100 });
  });

  it("keeps the circle inside the 1920 x 1080 canvas", () => {
    const n = normalizeScriptureCircleSettings({ circle: { x: 5000, y: 5000, diameter: 400 } });
    expect(n.circle.x).toBeLessThanOrEqual(1920 - 400);
    expect(n.circle.y).toBeLessThanOrEqual(1080 - 400);
  });

  it("trims a camera scene name and ignores a non-string one", () => {
    expect(normalizeScriptureCircleSettings({ cameraSceneName: "  Main Camera  " }).cameraSceneName).toBe("Main Camera");
    expect(normalizeScriptureCircleSettings({ cameraSceneName: 42 as unknown as string }).cameraSceneName).toBe("");
  });

  it("defaults animationIn to \"none\" and falls back on an invalid value", () => {
    expect(normalizeScriptureCircleSettings(null).animationIn).toBe("none");
    expect(normalizeScriptureCircleSettings({}).animationIn).toBe("none");
    expect(normalizeScriptureCircleSettings({ animationIn: "spin-wildly" as never }).animationIn).toBe("none");
  });

  it("keeps a valid animationIn value", () => {
    expect(normalizeScriptureCircleSettings({ animationIn: "slide-up" }).animationIn).toBe("slide-up");
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
    const saved = saveScriptureCircleSettings({ ...DEFAULT_SCRIPTURE_CIRCLE_SETTINGS, cameraSceneName: "Main Camera", wedgeColor: "#aabbcc", textColor: "#000000", circle: { x: 1, y: 2, diameter: 300 }, animationIn: "zoom-in" });
    expect(loadScriptureCircleSettings()).toEqual(saved);
    expect(loadScriptureCircleSettings().animationIn).toBe("zoom-in");
  });

  it("returns the defaults when nothing is saved yet", () => {
    expect(loadScriptureCircleSettings()).toEqual(DEFAULT_SCRIPTURE_CIRCLE_SETTINGS);
  });

  it("does not throw on corrupted storage", () => {
    localStorage.setItem("mce-dock-scripture-circle-settings", "{not json");
    expect(loadScriptureCircleSettings()).toEqual(DEFAULT_SCRIPTURE_CIRCLE_SETTINGS);
  });
});

describe("buildScriptureCirclePanelUrl", () => {
  it("carries the colors and circle geometry, and listens on the bible relay channel", () => {
    const url = buildScriptureCirclePanelUrl({ ...DEFAULT_SCRIPTURE_CIRCLE_SETTINGS, cameraSceneName: "Main Camera", wedgeColor: "#C14E29", textColor: "#17171B", circle: { x: 102, y: 94, diameter: 720 } });
    expect(url).toContain("mce-multiview-scripture-circle.html");
    expect(url).toContain("tab=bible");
    expect(url).toContain("wedge=C14E29");
    expect(url).toContain("text=17171B");
    expect(url).toContain("cx=102");
    expect(url).toContain("cy=94");
    expect(url).toContain("cd=720");
  });

  it("carries the right-side color, the shape and the LIVE switch", () => {
    const url = buildScriptureCirclePanelUrl({ ...DEFAULT_SCRIPTURE_CIRCLE_SETTINGS, paperColor: "#102030", shape: "box", showLive: false });
    expect(url).toContain("paper=102030");
    expect(url).toContain("shape=box");
    expect(url).toContain("live=0");
  });

  it("carries the chosen animate-in style", () => {
    const url = buildScriptureCirclePanelUrl({ ...DEFAULT_SCRIPTURE_CIRCLE_SETTINGS, animationIn: "flip-in" });
    expect(url).toContain("anim=flip-in");
  });
});

describe("calculateFillTransform", () => {
  it("covers the target with no gaps for a wider-than-tall source cropped into a square", () => {
    const t = calculateFillTransform(1920, 1080, { x: 102, y: 94, width: 720, height: 720 });
    // A 1920x1080 source scaled to cover a 720x720 square: scale = 720/1080 (the limiting dimension).
    expect(t.scaleX).toBeCloseTo(720 / 1080, 5);
    expect(t.scaleX).toBe(t.scaleY);
    expect(t.positionX).toBe(102);
    expect(t.positionY).toBe(94);
    // Centered crop: the extra width is split evenly left/right.
    expect(t.cropLeft).toBe(t.cropRight);
    expect(t.cropTop).toBe(0);
    expect(t.cropBottom).toBe(0);
  });

  it("needs no crop when the source already matches the target's aspect ratio", () => {
    const t = calculateFillTransform(720, 720, { x: 0, y: 0, width: 720, height: 720 });
    expect(t.cropLeft + t.cropRight + t.cropTop + t.cropBottom).toBe(0);
    expect(t.scaleX).toBe(1);
  });

  it("zooms in and keeps the chosen point of the picture in view", () => {
    const target = { x: 0, y: 0, width: 720, height: 720 };
    const t = calculateFillTransform(1920, 1080, target, { zoom: 2, focusX: 0, focusY: 100 });
    expect(t.scaleX).toBeCloseTo((720 / 1080) * 2, 5);
    // Focus at the left edge and the bottom: nothing cropped from the left or bottom.
    expect(t.cropLeft).toBe(0);
    expect(t.cropBottom).toBe(0);
    // What stays visible is exactly the target size once scaled.
    expect((1920 - t.cropLeft - t.cropRight) * t.scaleX).toBeCloseTo(720, 5);
    expect((1080 - t.cropTop - t.cropBottom) * t.scaleY).toBeCloseTo(720, 5);
  });

  it("falls back to the target size for a missing or zero source size", () => {
    const t = calculateFillTransform(0, 0, { x: 0, y: 0, width: 400, height: 300 });
    expect(t.scaleX).toBe(1);
    expect(t.scaleY).toBe(1);
  });
});

describe("scriptureCircleLayoutId / parseScriptureCircleThemeId", () => {
  it("round-trips a theme id through the synthetic layout id", () => {
    const layoutId = scriptureCircleLayoutId("abc123");
    expect(layoutId).toBe(`${SCRIPTURE_CIRCLE_LAYOUT_PREFIX}abc123`);
    expect(isScriptureCircleLayoutId(layoutId)).toBe(true);
    expect(parseScriptureCircleThemeId(layoutId)).toBe("abc123");
  });

  it("does not treat a real GalleryLayout id as a Scripture Circle one", () => {
    expect(isScriptureCircleLayoutId("quad")).toBe(false);
    expect(parseScriptureCircleThemeId("quad")).toBeNull();
    expect(isScriptureCircleLayoutId(undefined)).toBe(false);
    expect(isScriptureCircleLayoutId(null)).toBe(false);
  });
});

describe("Scripture Circle theme CRUD", () => {
  beforeEach(() => { installLocalStorageMock(); });

  it("returns an empty list when nothing is saved yet", () => {
    expect(listScriptureCircleThemes()).toEqual([]);
  });

  it("creates a theme with a generated id and default name", () => {
    const theme = saveScriptureCircleTheme({ name: "", settings: DEFAULT_SCRIPTURE_CIRCLE_SETTINGS });
    expect(theme.id).toBeTruthy();
    expect(theme.name).toBe("Scripture Circle");
    expect(listScriptureCircleThemes()).toHaveLength(1);
  });

  it("bumps the default name when it's already taken", () => {
    saveScriptureCircleTheme({ name: "", settings: DEFAULT_SCRIPTURE_CIRCLE_SETTINGS });
    const second = saveScriptureCircleTheme({ name: "", settings: DEFAULT_SCRIPTURE_CIRCLE_SETTINGS });
    const third = saveScriptureCircleTheme({ name: "", settings: DEFAULT_SCRIPTURE_CIRCLE_SETTINGS });
    expect(second.name).toBe("Scripture Circle 2");
    expect(third.name).toBe("Scripture Circle 3");
  });

  it("updates an existing theme in place when saved again with its id", () => {
    const first = saveScriptureCircleTheme({ name: "Morning Service", settings: DEFAULT_SCRIPTURE_CIRCLE_SETTINGS });
    const updatedSettings = { ...DEFAULT_SCRIPTURE_CIRCLE_SETTINGS, wedgeColor: "#000000" };
    const second = saveScriptureCircleTheme({ id: first.id, name: "Morning Service", settings: updatedSettings });

    expect(second.id).toBe(first.id);
    expect(listScriptureCircleThemes()).toHaveLength(1);
    expect(getScriptureCircleTheme(first.id)?.settings.wedgeColor).toBe("#000000");
  });

  it("supports multiple named themes at once", () => {
    const a = saveScriptureCircleTheme({ name: "Morning", settings: DEFAULT_SCRIPTURE_CIRCLE_SETTINGS });
    const b = saveScriptureCircleTheme({ name: "Evening", settings: { ...DEFAULT_SCRIPTURE_CIRCLE_SETTINGS, wedgeColor: "#111111" } });

    const all = listScriptureCircleThemes();
    expect(all.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
    expect(getScriptureCircleTheme(a.id)?.name).toBe("Morning");
    expect(getScriptureCircleTheme(b.id)?.name).toBe("Evening");
  });

  it("renames a theme without touching its settings", () => {
    const theme = saveScriptureCircleTheme({ name: "Old Name", settings: DEFAULT_SCRIPTURE_CIRCLE_SETTINGS });
    const renamed = renameScriptureCircleTheme(theme.id, "New Name");
    expect(renamed?.name).toBe("New Name");
    expect(getScriptureCircleTheme(theme.id)?.name).toBe("New Name");
  });

  it("returns null when renaming a theme that doesn't exist", () => {
    expect(renameScriptureCircleTheme("missing", "Whatever")).toBeNull();
  });

  it("deletes a theme", () => {
    const theme = saveScriptureCircleTheme({ name: "Temp", settings: DEFAULT_SCRIPTURE_CIRCLE_SETTINGS });
    deleteScriptureCircleTheme(theme.id);
    expect(getScriptureCircleTheme(theme.id)).toBeNull();
    expect(listScriptureCircleThemes()).toEqual([]);
  });

  it("does not throw on corrupted theme storage", () => {
    localStorage.setItem("mce-dock-scripture-circle-themes", "{not json");
    expect(listScriptureCircleThemes()).toEqual([]);
  });

  it("ignores malformed entries in the saved list", () => {
    localStorage.setItem("mce-dock-scripture-circle-themes", JSON.stringify([{ foo: "bar" }, null, 42]));
    expect(listScriptureCircleThemes()).toEqual([]);
  });
});

describe("cameraTargetRect", () => {
  it("is the circle's own bounding box, so a centered fill always fully covers the circle", () => {
    expect(cameraTargetRect({ x: 102, y: 94, diameter: 720 })).toEqual({ x: 102, y: 94, width: 720, height: 720 });
  });

  it("scales the window onto a smaller OBS canvas", () => {
    expect(cameraTargetRect({ x: 90, y: 60, diameter: 720 }, 2 / 3)).toEqual({ x: 60, y: 40, width: 480, height: 480 });
  });
});

describe("applyScriptureCircleLook", () => {
  function fakeObs(initialScenes: string[] = []) {
    const scenes = new Set(initialScenes);
    const items = new Map<string, number>(); // sourceName -> sceneItemId
    const transforms = new Map<number, Record<string, unknown>>();
    const indexes = new Map<number, number>();
    let nextId = 1;
    const calls: Array<{ type: string; params?: Record<string, unknown> }> = [];
    const client: ScriptureCircleObsClient = {
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
    const settings = normalizeScriptureCircleSettings({ cameraSceneName: "Main Camera" });

    const result = await applyScriptureCircleLook(client, settings);

    expect(result.sceneName).toBe(SCRIPTURE_CIRCLE_SCENE_NAME);
    expect(scenes.has(SCRIPTURE_CIRCLE_SCENE_NAME)).toBe(true);
    expect(items.has(SCRIPTURE_CIRCLE_BG_SOURCE)).toBe(true);
    expect(items.has("Main Camera")).toBe(true);
    expect(items.has(SCRIPTURE_CIRCLE_PANEL_SOURCE)).toBe(true);
    // Panel is on top, camera in the middle, background at the bottom.
    expect(indexes.get(items.get(SCRIPTURE_CIRCLE_BG_SOURCE)!)).toBe(0);
    expect(indexes.get(items.get("Main Camera")!)).toBe(1);
    expect(indexes.get(items.get(SCRIPTURE_CIRCLE_PANEL_SOURCE)!)).toBe(2);
  });

  it("refuses to run without a chosen camera scene", async () => {
    const { client } = fakeObs();
    await expect(applyScriptureCircleLook(client, normalizeScriptureCircleSettings({}))).rejects.toThrow(/camera/i);
  });

  it("reuses the existing items instead of duplicating them when applied again", async () => {
    const { client, items, calls } = fakeObs();
    const settings = normalizeScriptureCircleSettings({ cameraSceneName: "Main Camera" });

    await applyScriptureCircleLook(client, settings);
    const afterFirst = items.size;
    calls.length = 0;
    await applyScriptureCircleLook(client, { ...settings, wedgeColor: "#000000" });

    expect(items.size).toBe(afterFirst);
    expect(calls.some((c) => c.type === "CreateInput")).toBe(false);
    expect(calls.some((c) => c.type === "CreateSceneItem")).toBe(false);
    // The panel's URL still gets updated so the new color actually reaches OBS.
    expect(calls.some((c) => c.type === "SetInputSettings")).toBe(true);
  });

  it("crops the camera to fully cover the circle's bounding box", async () => {
    const { client, items, transforms } = fakeObs();
    const settings = normalizeScriptureCircleSettings({ cameraSceneName: "Main Camera", circle: { x: 102, y: 94, diameter: 720 } });

    await applyScriptureCircleLook(client, settings);

    const camTransform = transforms.get(items.get("Main Camera")!) as { positionX: number; positionY: number };
    expect(camTransform.positionX).toBe(102);
    expect(camTransform.positionY).toBe(94);
  });
});
