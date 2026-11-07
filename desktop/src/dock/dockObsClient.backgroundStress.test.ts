import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dockObsClient } from "./dockObsClient";
import { removeNativeDockSetting, writeNativeDockSetting } from "../services/localDockSettings";

vi.mock("./dockEntitlement", () => ({
  isDockFreePlan: vi.fn(() => false),
  isDockTrialActive: vi.fn(() => false),
  getDockPlan: vi.fn(() => "growth"),
}));

type BackgroundTheme = Record<string, unknown>;
type InputState = {
  inputKind: string;
  inputSettings: Record<string, unknown>;
};
type SceneItemState = {
  sourceName: string;
  sceneItemId: number;
  sceneItemIndex: number;
  enabled: boolean;
};

function makeBackgroundTheme(overrides: Partial<BackgroundTheme>): BackgroundTheme {
  return {
    backgroundColor: "transparent",
    backgroundColorEnd: "",
    backgroundImage: "",
    backgroundImageFilePath: "",
    backgroundPattern: "",
    backgroundVideo: "",
    backgroundVideoFilePath: "",
    backgroundOpacity: 1,
    ...overrides,
  };
}

function decodeBackgroundPacket(url: string): Record<string, unknown> {
  const encoded = url.split("#data=")[1] ?? "";
  return JSON.parse(decodeURIComponent(encoded)) as Record<string, unknown>;
}

describe("dockObsClient background reflection stress", () => {
  const client = dockObsClient as unknown as Record<string, any>;
  let originalMethods: Record<string, unknown>;
  let inputs: Map<string, InputState>;
  let sceneItems: Map<string, Map<string, SceneItemState>>;
  let nextSceneItemId: number;
  let callLog: Array<{ method: string; payload: Record<string, unknown> }>;
  let currentProgramSceneName: string;
  let currentPreviewSceneName: string;
  let studioModeEnabled: boolean;

  const fullscreenVariants = [
    {
      expectedKind: "color_source_v3",
      theme: makeBackgroundTheme({
        backgroundColor: "#123456",
        backgroundColorEnd: "#123456",
      }),
      assertInput: (input: InputState) => {
        expect(input.inputSettings.color).toBeTypeOf("number");
      },
    },
    {
      expectedKind: "image_source",
      theme: makeBackgroundTheme({
        backgroundImage: "/uploads/fullscreen-a.png",
        backgroundImageFilePath: "/tmp/fullscreen-a.png",
      }),
      assertInput: (input: InputState) => {
        expect(input.inputSettings.file).toBe("/tmp/fullscreen-a.png");
      },
    },
    {
      expectedKind: "ffmpeg_source",
      theme: makeBackgroundTheme({
        backgroundVideo: "file:///tmp/fullscreen-a.mp4",
        backgroundVideoFilePath: "/tmp/fullscreen-a.mp4",
      }),
      assertInput: (input: InputState) => {
        expect(input.inputSettings.local_file).toBe("/tmp/fullscreen-a.mp4");
      },
    },
    {
      expectedKind: "browser_source",
      theme: makeBackgroundTheme({
        backgroundColor: "#101820",
        backgroundColorEnd: "#203040",
      }),
      assertInput: (input: InputState) => {
        const packet = decodeBackgroundPacket(String(input.inputSettings.url || ""));
        expect((packet.theme as Record<string, unknown>).backgroundColor).toBe("#101820");
        expect((packet.theme as Record<string, unknown>).backgroundColorEnd).toBe("#203040");
      },
    },
    {
      expectedKind: "browser_source",
      theme: makeBackgroundTheme({
        backgroundPattern: "diagonal-lines",
      }),
      assertInput: (input: InputState) => {
        const packet = decodeBackgroundPacket(String(input.inputSettings.url || ""));
        expect((packet.theme as Record<string, unknown>).backgroundPattern).toBe("diagonal-lines");
      },
    },
  ] as const;

  const lowerThirdVariants = [
    {
      theme: makeBackgroundTheme({
        backgroundColor: "#112233",
      }),
      assertTheme: (theme: Record<string, unknown>) => {
        expect(theme.backgroundColor).toBe("#112233");
      },
    },
    {
      theme: makeBackgroundTheme({
        backgroundColor: "#112233",
        backgroundColorEnd: "#334455",
      }),
      assertTheme: (theme: Record<string, unknown>) => {
        expect(theme.backgroundColor).toBe("#112233");
        expect(theme.backgroundColorEnd).toBe("#334455");
      },
    },
    {
      theme: makeBackgroundTheme({
        backgroundImage: "/uploads/lower-third-image.png",
      }),
      assertTheme: (theme: Record<string, unknown>) => {
        expect(theme.backgroundImage).toBe("/uploads/lower-third-image.png");
      },
    },
    {
      theme: makeBackgroundTheme({
        backgroundVideo: "/uploads/lower-third-video.mp4",
      }),
      assertTheme: (theme: Record<string, unknown>) => {
        expect(theme.backgroundVideo).toBe("/uploads/lower-third-video.mp4");
      },
    },
    {
      theme: makeBackgroundTheme({
        backgroundPattern: "cross-hatch",
      }),
      assertTheme: (theme: Record<string, unknown>) => {
        expect(theme.backgroundPattern).toBe("cross-hatch");
      },
    },
  ] as const;

  beforeEach(() => {
    originalMethods = {
      call: client.call,
      obs: client.obs,
      getCanvasSize: client.getCanvasSize,
      prepareBrowserThemeAssets: client.prepareBrowserThemeAssets,
      getSceneItemListCached: client.getSceneItemListCached,
      invalidateSceneItemListCache: client.invalidateSceneItemListCache,
      buildOverlayHtmlUrl: client.buildOverlayHtmlUrl,
      bringBibleOverlayForward: client.bringBibleOverlayForward,
      publishFullscreenOverlayPacket: client.publishFullscreenOverlayPacket,
      deliverCssOverlayPacket: client.deliverCssOverlayPacket,
      getPresentationTargetScene: client.getPresentationTargetScene,
      fitSceneSourceToLowerThirdWindow: client.fitSceneSourceToLowerThirdWindow,
      fitSceneSourceToCanvas: client.fitSceneSourceToCanvas,
      ensureTickerAboveSource: client.ensureTickerAboveSource,
      ensureOverlaySource: client.ensureOverlaySource,
      ensureActiveMceOverlaySource: client.ensureActiveMceOverlaySource,
      _ensureFullscreenScene: client._ensureFullscreenScene,
      hideSceneSource: client.hideSceneSource,
      hideFullscreenBg: client.hideFullscreenBg,
      _hideLowerThirdBgSource: client._hideLowerThirdBgSource,
      waitForOverlayRenderAck: client.waitForOverlayRenderAck,
      focusMcePresentationModule: client.focusMcePresentationModule,
      promotePresentationScene: client.promotePresentationScene,
      ensurePresentationPreviewActive: client.ensurePresentationPreviewActive,
      ensurePresentationSceneReady: client.ensurePresentationSceneReady,
      ensureDedicatedScene: client.ensureDedicatedScene,
      getCurrentProgramSceneName: client.getCurrentProgramSceneName,
      waitForSceneMatch: client.waitForSceneMatch,
      prepareFastOverlayScene: client.prepareFastOverlayScene,
      pushWorshipLyrics: client.pushWorshipLyrics,
      pushNotesLyrics: client.pushNotesLyrics,
      readSceneMode: client.readSceneMode,
      readRestoreOriginalScene: client.readRestoreOriginalScene,
      isStudioModeEnabled: client.isStudioModeEnabled,
      sleep: client.sleep,
      _status: client._status,
    };

    inputs = new Map();
    sceneItems = new Map();
    nextSceneItemId = 1;
    callLog = [];
    currentProgramSceneName = "Main";
    currentPreviewSceneName = "Preview";
    studioModeEnabled = false;

    client.resetPresentationSceneState();
    client._programSceneBeforePush.clear();
    client._programBackgroundManagedScenes = new Set<string>();
    client._programBackgroundManagedScenesHydrated = true;
    client._status = "connected";

    client.getCanvasSize = vi.fn(async () => ({ width: 1920, height: 1080 }));
    client.prepareBrowserThemeAssets = vi.fn(async (settings: Record<string, unknown> | null) => settings);
    client.sleep = vi.fn(async () => {});
    client.buildOverlayHtmlUrl = vi.fn((file: string) => `http://overlay.test/${file}`);
    client.invalidateSceneItemListCache = vi.fn();
    // Model a healthy OBS browser-source render by default. Recovery behavior
    // is covered by the explicit missing-ack test below.
    client.waitForOverlayRenderAck = vi.fn(async () => true);
    client.getSceneItemListCached = vi.fn(async (sceneName: string) => {
      const items = Array.from(sceneItems.get(sceneName)?.values() ?? []);
      return items.map((item) => ({
        sourceName: item.sourceName,
        sceneItemId: item.sceneItemId,
        sceneItemIndex: item.sceneItemIndex,
      }));
    });
    client.call = vi.fn(async (method: string, payload: Record<string, unknown> = {}) => {
      callLog.push({ method, payload });

      switch (method) {
        case "GetInputList":
          return {
            inputs: Array.from(inputs.entries()).map(([inputName, input]) => ({
              inputName,
              inputKind: input.inputKind,
            })),
          };
        case "CreateInput":
          inputs.set(String(payload.inputName), {
            inputKind: String(payload.inputKind),
            inputSettings: { ...(payload.inputSettings as Record<string, unknown>) },
          });
          return {};
        case "SetInputSettings": {
          const inputName = String(payload.inputName);
          const existing = inputs.get(inputName);
          if (!existing) throw new Error(`Missing input ${inputName}`);
          existing.inputSettings = { ...(payload.inputSettings as Record<string, unknown>) };
          return {};
        }
        case "GetInputSettings": {
          const inputName = String(payload.inputName);
          const existing = inputs.get(inputName);
          if (!existing) throw new Error(`Missing input ${inputName}`);
          return { inputSettings: existing.inputSettings };
        }
        case "CallVendorRequest":
          return {};
        case "RemoveInput":
          inputs.delete(String(payload.inputName));
          return {};
        case "GetSceneItemList": {
          const items = Array.from(sceneItems.get(String(payload.sceneName))?.values() ?? []);
          return {
            sceneItems: items.map((item) => ({
            sourceName: item.sourceName,
            sceneItemId: item.sceneItemId,
            sceneItemIndex: item.sceneItemIndex,
            sceneItemEnabled: item.enabled,
          })),
        };
        }
        case "GetSceneList":
          return {
            scenes: Array.from(sceneItems.keys()).map((sceneName) => ({ sceneName })),
            currentProgramSceneName,
            currentPreviewSceneName,
          };
        case "CreateScene":
          if (!sceneItems.has(String(payload.sceneName))) {
            sceneItems.set(String(payload.sceneName), new Map());
          }
          return {};
        case "GetStudioModeEnabled":
          return { studioModeEnabled };
        case "GetCurrentProgramScene":
          return { currentProgramSceneName };
        case "SetCurrentProgramScene":
          currentProgramSceneName = String(payload.sceneName);
          return {};
        case "GetCurrentPreviewScene":
          return { currentPreviewSceneName };
        case "SetCurrentPreviewScene":
          currentPreviewSceneName = String(payload.sceneName);
          return {};
        case "CreateSceneItem": {
          const sceneName = String(payload.sceneName);
          const sourceName = String(payload.sourceName);
          const item: SceneItemState = {
            sourceName,
            sceneItemId: nextSceneItemId++,
            sceneItemIndex: 0,
            enabled: payload.sceneItemEnabled !== false,
          };
          if (!sceneItems.has(sceneName)) sceneItems.set(sceneName, new Map());
          sceneItems.get(sceneName)!.set(sourceName, item);
          return { sceneItemId: item.sceneItemId };
        }
        case "SetSceneItemTransform":
          return {};
        case "SetSceneItemIndex": {
          const sceneName = String(payload.sceneName);
          const sceneItemId = Number(payload.sceneItemId);
          const item = Array.from(sceneItems.get(sceneName)?.values() ?? []).find((entry) => entry.sceneItemId === sceneItemId);
          if (item) item.sceneItemIndex = Number(payload.sceneItemIndex);
          return {};
        }
        case "SetSceneItemEnabled": {
          const sceneName = String(payload.sceneName);
          const sceneItemId = Number(payload.sceneItemId);
          const item = Array.from(sceneItems.get(sceneName)?.values() ?? []).find((entry) => entry.sceneItemId === sceneItemId);
          if (item) item.enabled = Boolean(payload.sceneItemEnabled);
          return {};
        }
        case "RemoveSceneItem": {
          const sceneName = String(payload.sceneName);
          const sceneItemId = Number(payload.sceneItemId);
          const target = Array.from(sceneItems.get(sceneName)?.entries() ?? []).find(([, item]) => item.sceneItemId === sceneItemId);
          if (target) sceneItems.get(sceneName)!.delete(target[0]);
          return {};
        }
        case "PressInputPropertiesButton":
          return {};
        default:
          throw new Error(`Unhandled OBS call: ${method}`);
      }
    });
  });

  afterEach(() => {
    Object.assign(client, originalMethods);
    client._programSceneBeforePush.clear();
    client._programBackgroundManagedScenes = null;
    client._programBackgroundManagedScenesHydrated = false;
    client.resetPresentationSceneState();
    removeNativeDockSetting("ocs-dock-program-background-scenes-v1");
    removeNativeDockSetting("ocs-dock-program-background-last-scene-v1");
    removeNativeDockSetting("ocs-dock-projection-settings");
    vi.restoreAllMocks();
  });

  it("reflects 50 sequential fullscreen background changes across OBS source types", async () => {
    for (let index = 0; index < 50; index += 1) {
      const variant = fullscreenVariants[index % fullscreenVariants.length];
      const beforeCalls = callLog.length;

      await client._ensureFullscreenBgSource("bible", variant.theme);

      expect(callLog.length).toBeGreaterThan(beforeCalls);

      const names = client._bgSourceNames("bible");
      const activeSlot = client._bgActiveSlot["bible"] || "A";
      const activeName = activeSlot === "A" ? names.a : names.b;
      const activeInput = inputs.get(activeName);

      expect(activeInput?.inputKind).toBe(variant.expectedKind);
      variant.assertInput(activeInput!);
      expect(client._activeFullscreenBgSignature["bible"]).not.toBe("__hidden__");
    }
  });

  it("drops a superseded Bible prime packet before it can repaint an older pattern", async () => {
    const deliveredPatterns: string[] = [];
    client.publishFullscreenOverlayPacket = vi.fn((packet: { theme?: Record<string, unknown> | null }) => {
      deliveredPatterns.push(String(packet.theme?.backgroundPattern ?? ""));
    });
    client.deliverCssOverlayPacket = vi.fn(async (
      _sourceName: string,
      _tab: string,
      packet: { theme?: Record<string, unknown> | null },
    ) => {
      deliveredPatterns.push(String(packet.theme?.backgroundPattern ?? ""));
    });

    const oldPrime = client.primeBibleOverlay({
      book: "John",
      chapter: 3,
      verse: 16,
      translation: "KJV",
      verseText: "Old verse",
      overlayMode: "lower-third",
      bibleThemeSettings: makeBackgroundTheme({ backgroundPattern: "old-pattern" }),
    });
    const newPrime = client.primeBibleOverlay({
      book: "John",
      chapter: 3,
      verse: 17,
      translation: "KJV",
      verseText: "New verse",
      overlayMode: "lower-third",
      bibleThemeSettings: makeBackgroundTheme({ backgroundPattern: "new-pattern" }),
    });

    await Promise.all([oldPrime, newPrime]);

    expect(deliveredPatterns).toEqual(["new-pattern", "new-pattern"]);
  });

  it("removes legacy Bible background slots for the unified browser source", async () => {
    inputs.set("MCE BG - Bible", {
      inputKind: "color_source_v3",
      inputSettings: {},
    });
    inputs.set("MCE BG - Bible 2", {
      inputKind: "image_source",
      inputSettings: {},
    });
    sceneItems.set("MCE Presentation", new Map([
      ["MCE BG - Bible", { sourceName: "MCE BG - Bible", sceneItemId: 1, sceneItemIndex: 0, enabled: true }],
      ["MCE BG - Bible 2", { sourceName: "MCE BG - Bible 2", sceneItemId: 2, sceneItemIndex: 1, enabled: false }],
    ]));

    await client._removeFullscreenBgSources("bible");

    expect(inputs.has("MCE BG - Bible")).toBe(false);
    expect(inputs.has("MCE BG - Bible 2")).toBe(false);
    expect(sceneItems.get("MCE Presentation")?.size).toBe(0);
    expect(client._activeFullscreenBgSignature.bible).toBe("__hidden__");
  });

  it("recreates MCE Presentation before retrying a scene-source add after repeated manual deletion", async () => {
    const realCall = originalMethods.call as (requestType: string, requestData?: Record<string, unknown>) => Promise<unknown>;
    const sceneNames = new Set(["Main"]);

    client.call = realCall;
    client._knownScenes = new Set(["Main", "MCE Presentation"]);
    client._presentationSceneDeletedAt = 0;
    client.obs = {
      call: vi.fn(async (method: string, payload: Record<string, unknown> = {}) => {
        callLog.push({ method, payload });
        switch (method) {
          case "GetSceneList":
            return { scenes: Array.from(sceneNames).map((sceneName) => ({ sceneName })) };
          case "CreateScene": {
            const sceneName = String(payload.sceneName);
            sceneNames.add(sceneName);
            sceneItems.set(sceneName, new Map());
            return {};
          }
          case "CreateSceneItem": {
            const sceneName = String(payload.sceneName);
            const sourceName = String(payload.sourceName);
            if (!sceneNames.has(sourceName)) {
              throw new Error(`No source was found by the name of \`${sourceName}\` within the canvas \`${sceneName}\`.`);
            }
            const item: SceneItemState = {
              sourceName,
              sceneItemId: nextSceneItemId++,
              sceneItemIndex: 0,
              enabled: payload.sceneItemEnabled !== false,
            };
            if (!sceneItems.has(sceneName)) sceneItems.set(sceneName, new Map());
            sceneItems.get(sceneName)!.set(sourceName, item);
            return { sceneItemId: item.sceneItemId };
          }
          case "PressInputPropertiesButton":
            return {};
          default:
            throw new Error(`Unhandled OBS call: ${method}`);
        }
      }),
    };

    const addPresentationToMain = () => client.call("CreateSceneItem", {
      sceneName: "Main",
      sourceName: "MCE Presentation",
      sceneItemEnabled: true,
    });

    await addPresentationToMain();

    // Delete it again after the first automatic recovery. The second request
    // must follow the same self-healing path rather than showing an OBS error.
    sceneNames.delete("MCE Presentation");
    sceneItems.get("Main")?.delete("MCE Presentation");
    client._knownScenes.add("MCE Presentation");

    await addPresentationToMain();

    expect(sceneNames.has("MCE Presentation")).toBe(true);
    expect(sceneItems.get("Main")?.has("MCE Presentation")).toBe(true);
    expect(callLog.filter((entry) => entry.method === "CreateScene" && entry.payload.sceneName === "MCE Presentation")).toHaveLength(2);
    expect(callLog.filter((entry) => entry.method === "CreateSceneItem" && entry.payload.sourceName === "MCE Presentation")).toHaveLength(4);
  });

  it("switches OBS Preview to MCE Presentation when Studio Mode is enabled", async () => {
    studioModeEnabled = true;
    currentProgramSceneName = "Pastor Camera";
    currentPreviewSceneName = "Offering";
    sceneItems.set("MCE Presentation", new Map());
    sceneItems.set("Pastor Camera", new Map());
    client.ensurePresentationSceneReady = vi.fn(async () => {});
    client.readSceneMode = vi.fn(() => "no-clone");

    await client.promotePresentationScene("bible");

    expect(callLog).toContainEqual({
      method: "SetCurrentPreviewScene",
      payload: { sceneName: "MCE Presentation" },
    });
    expect(callLog).not.toContainEqual({
      method: "SetCurrentProgramScene",
      payload: { sceneName: "MCE Presentation" },
    });
  });

  it("switches OBS Program to MCE Presentation when Studio Mode is disabled", async () => {
    studioModeEnabled = false;
    currentProgramSceneName = "Pastor Camera";
    currentPreviewSceneName = "";
    sceneItems.set("MCE Presentation", new Map([
      ["MCE Worship", { sourceName: "MCE Worship", sceneItemId: 10, sceneItemIndex: 1, enabled: true }],
    ]));
    sceneItems.set("Pastor Camera", new Map());
    client.ensurePresentationSceneReady = vi.fn(async () => {});
    client.readSceneMode = vi.fn(() => "auto-duplicate");

    await client.promotePresentationScene("worship");

    expect(sceneItems.get("MCE Presentation")?.has("Pastor Camera")).toBe(true);
    expect(callLog).toContainEqual({
      method: "SetCurrentProgramScene",
      payload: { sceneName: "MCE Presentation" },
    });
    expect(callLog.some((entry) => (
      entry.method === "CreateSceneItem" &&
      entry.payload.sceneName === "Pastor Camera" &&
      entry.payload.sourceName === "MCE Presentation"
    ))).toBe(false);
  });

  it("restores the original Program scene after fullscreen Bible is cleared", async () => {
    client.readRestoreOriginalScene = vi.fn(() => true);
    client.readSceneMode = vi.fn(() => "auto-duplicate");
    client.isStudioModeEnabled = vi.fn(async () => false);

    client.rememberUserScene("Pastor Camera", "bible");
    // Repeated sends must not replace the original snapshot with the helper
    // presentation scene after MCE has already become Program.
    client.rememberUserScene("MCE Presentation", "bible");
    currentProgramSceneName = "MCE Presentation";

    const restored = await client.restoreProgramSceneBeforePush("bible");

    expect(restored).toBe(true);
    expect(currentProgramSceneName).toBe("Pastor Camera");
    expect(callLog).toContainEqual({
      method: "SetCurrentProgramScene",
      payload: { sceneName: "Pastor Camera" },
    });
    expect(client._programSceneBeforePush.has("bible")).toBe(false);
  });

  it("removes Program scene nesting when Program background is turned off", async () => {
    sceneItems.set("MCE Presentation", new Map([
      ["Pastor Camera", { sourceName: "Pastor Camera", sceneItemId: 10, sceneItemIndex: 0, enabled: true }],
      ["MCE Worship", { sourceName: "MCE Worship", sceneItemId: 11, sceneItemIndex: 1, enabled: true }],
    ]));
    sceneItems.set("Pastor Camera", new Map([
      ["MCE Presentation", { sourceName: "MCE Presentation", sceneItemId: 20, sceneItemIndex: 3, enabled: true }],
    ]));
    client.readSceneMode = vi.fn(() => "no-clone");
    client.ensurePresentationSceneReady = vi.fn(async () => {});
    client.getCurrentProgramSceneName = vi.fn(async () => "Pastor Camera");
    client._programBackgroundManagedScenes = new Set(["Pastor Camera"]);

    await client.applyProjectionSettings({ allowSceneMutation: true });

    expect(sceneItems.get("MCE Presentation")?.has("Pastor Camera")).toBe(false);
    expect(sceneItems.get("MCE Presentation")?.has("MCE Worship")).toBe(true);
    expect(sceneItems.get("Pastor Camera")?.has("MCE Presentation")).toBe(false);
  });

  it("replaces the previous Program scene underlay instead of stacking program scenes", async () => {
    sceneItems.set("MCE Presentation", new Map([
      ["Pastor Camera", { sourceName: "Pastor Camera", sceneItemId: 10, sceneItemIndex: 0, enabled: true }],
      ["MCE Worship", { sourceName: "MCE Worship", sceneItemId: 11, sceneItemIndex: 1, enabled: true }],
    ]));
    sceneItems.set("Pastor Camera", new Map());
    sceneItems.set("Camera 2", new Map());
    client.readSceneMode = vi.fn(() => "auto-duplicate");
    client.isStudioModeEnabled = vi.fn(async () => true);
    client.ensurePresentationSceneReady = vi.fn(async () => {});
    client.getCurrentProgramSceneName = vi.fn(async () => "Camera 2");
    client._programBackgroundManagedScenes = new Set(["Pastor Camera"]);

    await client.ensureProgramSceneAsSourceInPresentation(true);

    const presentationItems = sceneItems.get("MCE Presentation");
    expect(presentationItems?.has("Pastor Camera")).toBe(false);
    expect(presentationItems?.has("Camera 2")).toBe(true);
    expect(presentationItems?.has("MCE Worship")).toBe(true);
    expect(Array.from(presentationItems?.values() ?? []).filter((item) => (
      item.sourceName === "Pastor Camera" || item.sourceName === "Camera 2"
    ))).toHaveLength(1);
  });

  it("leaves an untracked user scene source inside MCE Presentation untouched", async () => {
    sceneItems.set("MCE Presentation", new Map([
      ["User Camera Scene", { sourceName: "User Camera Scene", sceneItemId: 10, sceneItemIndex: 0, enabled: true }],
      ["MCE Worship", { sourceName: "MCE Worship", sceneItemId: 11, sceneItemIndex: 1, enabled: true }],
    ]));
    sceneItems.set("User Camera Scene", new Map());
    sceneItems.set("Camera 2", new Map());
    client.readSceneMode = vi.fn(() => "auto-duplicate");
    client.isStudioModeEnabled = vi.fn(async () => true);
    client.ensurePresentationSceneReady = vi.fn(async () => {});
    client.getCurrentProgramSceneName = vi.fn(async () => "Camera 2");

    await client.ensureProgramSceneAsSourceInPresentation(true);

    expect(sceneItems.get("MCE Presentation")?.has("User Camera Scene")).toBe(true);
    expect(callLog.some((entry) => (
      entry.method === "RemoveSceneItem" &&
      entry.payload.sceneName === "MCE Presentation" &&
      entry.payload.sceneItemId === 10
    ))).toBe(false);
  });

  it("reconciles a Program scene in non-Studio Mode when background routing is on", async () => {
    writeNativeDockSetting("ocs-dock-projection-settings", {
      sceneMode: "auto-duplicate",
      settingsVersion: 3,
      programBackgroundOptIn: true,
    });
    sceneItems.set("MCE Presentation", new Map([
      ["MCE Worship", { sourceName: "MCE Worship", sceneItemId: 11, sceneItemIndex: 1, enabled: true }],
    ]));
    sceneItems.set("Camera 2", new Map());
    client.readSceneMode = vi.fn(() => "auto-duplicate");
    client.isStudioModeEnabled = vi.fn(async () => false);
    client.ensurePresentationSceneReady = vi.fn(async () => {});

    try {
      await client.reconcileProgramBackground("Camera 2", true);

      expect(sceneItems.get("MCE Presentation")?.has("Camera 2")).toBe(true);
      expect(callLog.some((entry) => (
        entry.method === "CreateSceneItem" &&
        entry.payload.sceneName === "MCE Presentation" &&
        entry.payload.sourceName === "Camera 2"
      ))).toBe(true);
    } finally {
      removeNativeDockSetting("ocs-dock-projection-settings");
    }
  });

  it("reuses the current Program scene underlay when it is already correct", async () => {
    sceneItems.set("MCE Presentation", new Map([
      ["Camera 2", { sourceName: "Camera 2", sceneItemId: 10, sceneItemIndex: 0, enabled: true }],
      ["MCE Worship", { sourceName: "MCE Worship", sceneItemId: 11, sceneItemIndex: 1, enabled: true }],
    ]));
    sceneItems.set("Camera 2", new Map());
    client.readSceneMode = vi.fn(() => "auto-duplicate");
    client.isStudioModeEnabled = vi.fn(async () => true);
    client.ensurePresentationSceneReady = vi.fn(async () => {});
    client.getCurrentProgramSceneName = vi.fn(async () => "Camera 2");

    await client.ensureProgramSceneAsSourceInPresentation();
    const callsAfterFirstPass = callLog.length;
    await client.ensureProgramSceneAsSourceInPresentation();

    const presentationItems = sceneItems.get("MCE Presentation");
    expect(presentationItems?.has("Camera 2")).toBe(true);
    expect(presentationItems?.has("MCE Worship")).toBe(true);
    expect(callLog.some((entry) => (
      entry.method === "CreateSceneItem" &&
      entry.payload.sceneName === "MCE Presentation" &&
      entry.payload.sourceName === "Camera 2"
    ))).toBe(false);
    expect(callLog.some((entry) => (
      entry.method === "RemoveSceneItem" &&
      entry.payload.sceneName === "MCE Presentation" &&
      entry.payload.sceneItemId === 10
    ))).toBe(false);
    expect(callLog).toHaveLength(callsAfterFirstPass);
  });

  it("keeps the copied Program scene underlay when MCE Presentation is already Program", async () => {
    sceneItems.set("MCE Presentation", new Map([
      ["Pastor Camera", { sourceName: "Pastor Camera", sceneItemId: 10, sceneItemIndex: 0, enabled: true }],
      ["MCE Worship", { sourceName: "MCE Worship", sceneItemId: 11, sceneItemIndex: 1, enabled: true }],
    ]));
    sceneItems.set("Pastor Camera", new Map());
    client.readSceneMode = vi.fn(() => "auto-duplicate");
    client.isStudioModeEnabled = vi.fn(async () => true);
    client.ensurePresentationSceneReady = vi.fn(async () => {});
    client.getCurrentProgramSceneName = vi.fn(async () => "MCE Presentation");

    await client.ensureProgramSceneAsSourceInPresentation(true);

    expect(sceneItems.get("MCE Presentation")?.has("Pastor Camera")).toBe(true);
    expect(sceneItems.get("MCE Presentation")?.has("MCE Worship")).toBe(true);
    expect(callLog.some((entry) => (
      entry.method === "RemoveSceneItem" &&
      entry.payload.sceneName === "MCE Presentation" &&
      entry.payload.sceneItemId === 10
    ))).toBe(false);
  });

  it("keeps routing live on repeated fast overlay sends while layout prep stays cached", async () => {
    const fitSource = vi.fn(async () => {});
    client.promotePresentationScene = vi.fn(async () => {});
    client.ensureTickerAboveSource = vi.fn(async () => {});
    client.getPresentationTargetScene = vi.fn(async () => ({ sceneName: "MCE Presentation" }));

    await client.prepareFastOverlayScene("bible", "MCE Browser - Bible", fitSource);
    await client.prepareFastOverlayScene("bible", "MCE Browser - Bible", fitSource);

    expect(client.promotePresentationScene).toHaveBeenCalledTimes(0);
    expect(fitSource).toHaveBeenCalledTimes(2);
  });

  it("preserves the last presentation underlay while a managed multiview scene is Program", async () => {
    sceneItems.set("MCE Presentation", new Map([
      ["Pastor Camera", { sourceName: "Pastor Camera", sceneItemId: 10, sceneItemIndex: 0, enabled: true }],
      ["MCE Worship", { sourceName: "MCE Worship", sceneItemId: 11, sceneItemIndex: 1, enabled: true }],
    ]));
    sceneItems.set("Pastor Camera", new Map());
    sceneItems.set("MV: Multiview 1", new Map());
    client.readSceneMode = vi.fn(() => "auto-duplicate");
    client.isStudioModeEnabled = vi.fn(async () => true);
    client.ensurePresentationSceneReady = vi.fn(async () => {});
    client.getCurrentProgramSceneName = vi.fn(async () => "MV: Multiview 1");

    await client.ensureProgramSceneAsSourceInPresentation(true);

    const presentationItems = sceneItems.get("MCE Presentation");
    expect(presentationItems?.has("Pastor Camera")).toBe(true);
    expect(presentationItems?.has("MV: Multiview 1")).toBe(false);
    expect(presentationItems?.has("MCE Worship")).toBe(true);
    expect(callLog.some((entry) => entry.method === "RemoveSceneItem")).toBe(false);
    expect(callLog.some((entry) => (
      entry.method === "CreateSceneItem" &&
      entry.payload.sceneName === "MCE Presentation" &&
      entry.payload.sourceName === "MV: Multiview 1"
    ))).toBe(false);
  });

  it("preserves the last presentation underlay in no-clone mode for Multiview", async () => {
    sceneItems.set("MCE Presentation", new Map([
      ["Camera 2", { sourceName: "Camera 2", sceneItemId: 10, sceneItemIndex: 0, enabled: true }],
      ["MCE Worship", { sourceName: "MCE Worship", sceneItemId: 11, sceneItemIndex: 1, enabled: true }],
    ]));
    sceneItems.set("MV: Multiview 1", new Map());
    client.readSceneMode = vi.fn(() => "no-clone");
    client.getCurrentProgramSceneName = vi.fn(async () => "MV: Multiview 1");

    await client.ensureNoProgramSceneUnderlayInPresentation(true);

    expect(sceneItems.get("MCE Presentation")?.has("Camera 2")).toBe(true);
    expect(sceneItems.get("MCE Presentation")?.has("MCE Worship")).toBe(true);
    expect(callLog.some((entry) => entry.method === "RemoveSceneItem")).toBe(false);
  });

  it("does not remove MCE Presentation from Multiview while Bible lower-third initializes", async () => {
    sceneItems.set("MV: Multiview 1", new Map([
      ["MCE Presentation", { sourceName: "MCE Presentation", sceneItemId: 20, sceneItemIndex: 1, enabled: true }],
    ]));
    sceneItems.set("MCE Presentation", new Map());
    currentProgramSceneName = "MV: Multiview 1";
    client.getPresentationTargetScene = vi.fn(async () => ({ sceneName: "MCE Presentation", studioMode: false }));
    client._ensureFullscreenScene = vi.fn(async () => ({ sceneName: "MCE Presentation", browserItemId: 1 }));
    client.ensureOverlaySource = vi.fn(async () => {});
    client.ensureActiveMceOverlaySource = vi.fn(async () => {});
    client.ensureTickerAboveSource = vi.fn(async () => {});
    client.hideSceneSource = vi.fn(async () => {});
    client.hideFullscreenBg = vi.fn(async () => {});
    client._hideLowerThirdBgSource = vi.fn(async () => {});
    client.fitSceneSourceToCanvas = vi.fn(async () => {});
    client.publishFullscreenOverlayPacket = vi.fn();
    client.deliverCssOverlayPacket = vi.fn(async () => {});

    await client.pushBible({
      book: "John",
      chapter: 1,
      verse: 1,
      translation: "KJV",
      verseText: "In the beginning was the Word.",
      overlayMode: "lower-third",
      bibleThemeSettings: makeBackgroundTheme({ backgroundColor: "#112233" }),
    });

    expect(sceneItems.get("MV: Multiview 1")?.has("MCE Presentation")).toBe(true);
    expect(callLog.some((entry) => (
      entry.method === "RemoveSceneItem" &&
      entry.payload.sceneName === "MV: Multiview 1"
    ))).toBe(false);
  });

  it("turns multiview scenes off immediately without fade filters", async () => {
    sceneItems.set("MV: Multiview 1", new Map([
      ["mv_a", { sourceName: "mv_a", sceneItemId: 10, sceneItemIndex: 0, enabled: true }],
      ["mv_b", { sourceName: "mv_b", sceneItemId: 11, sceneItemIndex: 1, enabled: true }],
    ]));

    await client.fadeOutAllSceneItems("MV: Multiview 1");

    expect(Array.from(sceneItems.get("MV: Multiview 1")?.values() ?? []).every((item) => item.enabled === false)).toBe(true);
    expect(callLog.some((entry) => (
      entry.method === "CreateSourceFilter" ||
      entry.method === "SetSourceFilterSettings" ||
      entry.method === "RemoveSourceFilter"
    ))).toBe(false);
  });

  it("does not rewrite the Bible browser URL when OBS already has the overlay document loaded", async () => {
    const sourceName = "MCE Browser - Bible";
    const baseUrl = "http://overlay.test/mce-bible-overlay.html?v=2026-07-29-1-lt-bg-image&tab=bible";
    inputs.set(sourceName, {
      inputKind: "browser_source",
      inputSettings: {
        url: `${baseUrl}#data=${encodeURIComponent(JSON.stringify({ mode: "fullscreen", slide: { text: "Old verse" } }))}`,
        css: "",
      },
    });
    client._lastBrowserSourceUrlBySource[sourceName] = "";

    await client.deliverCssOverlayPacket(
      sourceName,
      "bible",
      {
        slide: { id: "dock-bible-slide", reference: "Acts 3:1 (KJV)", text: "Now Peter and John went up together.", verseRange: "1" },
        theme: makeBackgroundTheme({ backgroundPattern: "diagonal-lines" }),
        live: true,
        blanked: false,
        timestamp: 123,
        mode: "fullscreen",
      },
      baseUrl,
      "",
    );

    const urlWrites = callLog.filter((entry) =>
      entry.method === "SetInputSettings" &&
      Object.prototype.hasOwnProperty.call(entry.payload.inputSettings as Record<string, unknown>, "url")
    );
    const browserEvent = callLog.find((entry) => entry.method === "CallVendorRequest");

    expect(urlWrites).toHaveLength(0);
    expect(callLog.some((entry) => entry.method === "GetInputSettings" && entry.payload.inputName === sourceName)).toBe(true);
    expect(browserEvent).toBeDefined();
    expect((browserEvent?.payload.requestData as {
      event_data?: { event_data?: { targetSource?: string } };
    }).event_data?.event_data?.targetSource).toBe(sourceName);
    expect(client._lastBrowserSourceUrlBySource[sourceName]).toBe(baseUrl);
  });

  it("automatically cache-busts the Bible document when OBS has a different page loaded after a Dock startup", async () => {
    const sourceName = "MCE Browser - Bible";
    const baseUrl = "http://overlay.test/mce-bible-overlay.html";
    inputs.set(sourceName, {
      inputKind: "browser_source",
      inputSettings: { url: "http://overlay.test/mce-bible-overlay.html?v=older-build", css: "" },
    });
    delete client._lastBrowserSourceUrlBySource[sourceName];

    const packet = {
      slide: { id: "dock-bible-slide", reference: "John 3:16 (KJV)", text: "For God so loved the world.", verseRange: "16" },
      theme: makeBackgroundTheme({ backgroundColor: "#101820" }),
      live: true,
      blanked: false,
      timestamp: 125,
      mode: "fullscreen",
    };

    await client.deliverCssOverlayPacket(sourceName, "bible", packet, baseUrl, "");

    const startupWrite = callLog.find((entry) => entry.method === "SetInputSettings" && String(
      (entry.payload.inputSettings as Record<string, unknown>).url || "",
    ).includes("mceReload="));
    const startupUrl = String((startupWrite?.payload.inputSettings as Record<string, unknown> | undefined)?.url || "");
    expect(startupUrl).toContain("mceReload=");
    expect((startupWrite?.payload.inputSettings as Record<string, unknown> | undefined)?.css).toContain("--overlay-data");

    callLog.length = 0;
    await client.deliverCssOverlayPacket(
      sourceName,
      "bible",
      { ...packet, timestamp: 126, slide: { ...packet.slide, text: "A new verse without a document reload." } },
      baseUrl,
      "",
    );
    expect(callLog.some((entry) => entry.method === "SetInputSettings" && (
      entry.payload.inputSettings as Record<string, unknown>
    ).url)).toBe(false);
    expect(callLog.some((entry) => entry.method === "CallVendorRequest")).toBe(true);
  });

  it("delivers Bible background changes through the in-place browser event", async () => {
    const sourceName = "MCE Browser - Bible";
    const baseUrl = "http://overlay.test/mce-bible-overlay.html?v=2026-07-29-1-lt-bg-image&tab=bible";
    inputs.set(sourceName, {
      inputKind: "browser_source",
      inputSettings: { url: baseUrl, css: "" },
    });
    client._lastBrowserSourceUrlBySource[sourceName] = baseUrl;
    client._lastCssOverlayPacketBySource[sourceName] = {
      slide: { id: "dock-bible-slide", reference: "Acts 3:1 (KJV)", text: "Old verse", verseRange: "1" },
      theme: makeBackgroundTheme({ backgroundColor: "#000000" }),
      live: true,
      blanked: false,
      timestamp: 122,
      mode: "fullscreen",
    };
    client._lastCssOverlayBaseUrlBySource[sourceName] = baseUrl;
    client._lastCssOverlayThemeCssBySource[sourceName] = "";

    await client.deliverCssOverlayPacket(
      sourceName,
      "bible",
      {
        slide: { id: "dock-bible-slide", reference: "Acts 3:1 (KJV)", text: "Old verse", verseRange: "1" },
        theme: makeBackgroundTheme({ backgroundPattern: "diagonal-lines" }),
        live: true,
        blanked: false,
        timestamp: 124,
        mode: "fullscreen",
      },
      baseUrl,
      ":root { --bg-pattern-data: url(\"data:image/svg+xml,%3Csvg%2F%3E\"); }",
    );

    const sourceWrites = callLog.filter((entry) => entry.method === "SetInputSettings");

    expect(sourceWrites).toHaveLength(0);
    expect(callLog.some((entry) => entry.method === "CallVendorRequest")).toBe(true);
    expect(client._lastCssOverlayThemeCssBySource[sourceName]).toContain("--bg-pattern-data");
  });

  it("updates a Bible click through the live event without rewriting source CSS", async () => {
    const sourceName = "MCE Browser - Bible";
    const baseUrl = "http://overlay.test/mce-bible-overlay.html?v=2026-07-29-1-lt-bg-image&tab=bible";
    const theme = makeBackgroundTheme({ backgroundColor: "#000000" });

    inputs.set(sourceName, {
      inputKind: "browser_source",
      inputSettings: { url: baseUrl, css: "" },
    });
    client._lastBrowserSourceUrlBySource[sourceName] = baseUrl;
    client._lastCssOverlayPacketBySource[sourceName] = {
      slide: { id: "dock-bible-slide", reference: "Acts 3:1 (KJV)", text: "Old verse", verseRange: "1" },
      theme,
      live: true,
      blanked: false,
      timestamp: 122,
      mode: "fullscreen",
    };
    client._lastCssOverlayBaseUrlBySource[sourceName] = baseUrl;
    client._lastCssOverlayThemeCssBySource[sourceName] = "";

    await client.deliverCssOverlayPacket(
      sourceName,
      "bible",
      {
        slide: { id: "dock-bible-slide", reference: "Acts 3:2 (KJV)", text: "A new visible verse", verseRange: "2" },
        theme,
        live: true,
        blanked: false,
        timestamp: 124,
        mode: "fullscreen",
      },
      baseUrl,
      "",
    );

    const cssWrites = callLog.filter((entry) =>
      entry.method === "SetInputSettings" &&
      Object.prototype.hasOwnProperty.call(entry.payload.inputSettings as Record<string, unknown>, "css")
    );

    expect(callLog.some((entry) => entry.method === "CallVendorRequest")).toBe(true);
    expect(cssWrites).toHaveLength(0);
  });

  it("does not reload the browser source when a render acknowledgement is delayed", async () => {
    const sourceName = "MCE Browser - Bible";
    const baseUrl = "http://overlay.test/mce-bible-overlay.html?v=2026-07-29-1-lt-bg-image&tab=bible";
    inputs.set(sourceName, {
      inputKind: "browser_source",
      inputSettings: { url: baseUrl, css: "" },
    });
    client._lastBrowserSourceUrlBySource[sourceName] = baseUrl;
    client._lastCssOverlayPacketBySource[sourceName] = {
      slide: { id: "dock-bible-slide", reference: "Acts 3:1 (KJV)", text: "Old verse", verseRange: "1" },
      theme: makeBackgroundTheme({ backgroundColor: "#000000" }),
      live: true,
      blanked: false,
      timestamp: 122,
      mode: "lower-third",
    };
    client._lastCssOverlayBaseUrlBySource[sourceName] = baseUrl;
    client._lastCssOverlayThemeCssBySource[sourceName] = "";
    client.waitForOverlayRenderAck = vi.fn(async () => false);

    await client.deliverCssOverlayPacket(
      sourceName,
      "bible",
      {
        slide: { id: "dock-bible-slide", reference: "Acts 3:2 (KJV)", text: "A new visible verse", verseRange: "2" },
        theme: makeBackgroundTheme({ backgroundColor: "#000000" }),
        live: true,
        blanked: false,
        timestamp: 124,
        mode: "lower-third",
      },
      baseUrl,
      "",
    );

    expect(callLog.some((entry) => entry.method === "CallVendorRequest")).toBe(true);
    expect(callLog.some((entry) => (
      entry.method === "SetInputSettings" &&
      Object.prototype.hasOwnProperty.call(entry.payload.inputSettings as Record<string, unknown>, "css")
    ))).toBe(false);
    expect(client.waitForOverlayRenderAck).not.toHaveBeenCalled();
  });

  it("keeps Bible fullscreen setup stable when only background settings change", () => {
    const firstSignature = client.buildBibleFullscreenSetupSignature(
      "MCE Presentation",
      "Camera",
      makeBackgroundTheme({ backgroundPattern: "diagonal-lines" }),
    );
    const nextSignature = client.buildBibleFullscreenSetupSignature(
      "MCE Presentation",
      "Camera",
      makeBackgroundTheme({ backgroundPattern: "cross-hatch", backgroundOpacity: 0.75 }),
    );

    expect(nextSignature).toBe(firstSignature);
  });

  it.each([
    {
      label: "Worship",
      tab: "worship",
      sourceName: "Worship - MCE Presentation",
      baseUrl: "http://overlay.test/mce-worship-overlay.html",
      initializedKey: "_worshipInitialized",
      fastMethod: "pushWorshipOverlayFast",
      fallbackMethod: "pushWorshipLyrics",
    },
    {
      label: "Notes",
      tab: "notes",
      sourceName: "Worship - MCE Presentation", // Worship and Notes share one source
      baseUrl: "http://overlay.test/mce-note.html",
      initializedKey: "_notesInitialized",
      fastMethod: "pushNotesOverlayFast",
      fallbackMethod: "pushNotesLyrics",
    },
  ] as const)("reuses the loaded $label overlay document after a dock reload", async ({
    tab,
    sourceName,
    baseUrl,
    initializedKey,
    fastMethod,
    fallbackMethod,
  }) => {
    inputs.set(sourceName, {
      inputKind: "browser_source",
      inputSettings: {
        url: `${baseUrl}#data=${encodeURIComponent(JSON.stringify({ mode: "lower-third", slide: { text: "Old text" } }))}`,
        css: "",
      },
    });
    sceneItems.set("MCE Presentation", new Map([
      [sourceName, { sourceName, sceneItemId: 100, sceneItemIndex: 0, enabled: true }],
    ]));
    client[initializedKey] = false;
    client._lastBrowserSourceUrlBySource[sourceName] = "";
    client[fallbackMethod] = vi.fn(async () => {});
    client.prepareFastOverlayScene = vi.fn(async () => {});

    await client[fastMethod]({
      sectionText: "Keep this text live",
      sectionLabel: "Verse 1",
      songTitle: "Reload Check",
      bibleThemeSettings: makeBackgroundTheme({ backgroundPattern: "diagonal-lines" }),
    });

    const sourceWrites = callLog.filter((entry) => entry.method === "SetInputSettings");

    expect(client[fallbackMethod]).not.toHaveBeenCalled();
    expect(client[initializedKey]).toBe(true);
    expect(client._lastBrowserSourceUrlBySource[sourceName]).toBe(baseUrl);
    expect(client.prepareFastOverlayScene).toHaveBeenCalledWith(tab, sourceName, expect.any(Function));
    expect(callLog.some((entry) => entry.method === "GetInputSettings" && entry.payload.inputName === sourceName)).toBe(true);
    expect(callLog.some((entry) => entry.method === "CallVendorRequest")).toBe(true);
    expect(sourceWrites).toHaveLength(0);
  });

  it.each([
    {
      label: "Bible",
      sourceName: "Bible - MCE Presentation",
      initializedKey: "_bibleLtInitialized",
      lastModeKey: "_lastBibleMode",
      fastMethod: "pushBibleOverlayFast",
      tab: "bible",
      payload: {
        verseText: "New Bible text",
        referenceText: "John 3:16 (KJV)",
        verseRange: "16",
      },
    },
    {
      label: "Worship",
      sourceName: "Worship - MCE Presentation",
      initializedKey: "_worshipInitialized",
      lastModeKey: "_lastOverlayMode",
      fastMethod: "pushWorshipOverlayFast",
      tab: "worship",
      payload: {
        sectionText: "New worship text",
        sectionLabel: "Verse",
        songTitle: "New song",
      },
    },
    {
      label: "Notes",
      sourceName: "Worship - MCE Presentation", // Worship and Notes share one source
      initializedKey: "_notesInitialized",
      lastModeKey: "_lastOverlayMode",
      fastMethod: "pushNotesOverlayFast",
      tab: "notes",
      payload: {
        sectionText: "New note text",
        sectionLabel: "Note",
        songTitle: "New note",
      },
    },
  ] as const)("delivers the new $label packet before focusing its source", async ({
    sourceName,
    initializedKey,
    lastModeKey,
    fastMethod,
    tab,
    payload,
  }) => {
    const events: string[] = [];
    client[initializedKey] = true;
    client._lastBrowserSourceUrlBySource[sourceName] = "http://overlay.test/existing";
    if (lastModeKey === "_lastBibleMode") {
      client._lastBibleMode = "lower-third";
    } else {
      client._lastOverlayMode[sourceName] = "lower-third";
    }
    client.publishFullscreenOverlayPacket = vi.fn();
    client.deliverCssOverlayPacket = vi.fn(async () => {
      events.push("deliver");
    });
    client.focusMcePresentationModule = vi.fn(async () => {
      events.push("focus");
    });
    client.prepareFastOverlayScene = vi.fn(async () => {
      events.push("prepare");
    });
    client.promotePresentationScene = vi.fn(async () => {
      events.push("promote");
    });

    await client[fastMethod]({
      ...payload,
      bibleThemeSettings: makeBackgroundTheme({ backgroundPattern: "diagonal-lines" }),
    });

    expect(events.indexOf("deliver")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("focus")).toBeGreaterThan(events.indexOf("deliver"));
    if (tab !== "bible") {
      expect(events.indexOf("prepare")).toBeGreaterThan(events.indexOf("deliver"));
      expect(events.indexOf("focus")).toBeGreaterThan(events.indexOf("prepare"));
      expect(events.indexOf("promote")).toBeGreaterThan(events.indexOf("focus"));
    }
  });

  it.each([
    {
      label: "Worship",
      sourceName: "Worship - MCE Presentation",
      baseUrl: "http://overlay.test/mce-worship-overlay.html",
      initializedKey: "_worshipInitialized",
      primeMethod: "primeWorshipOverlay",
    },
    {
      label: "Notes",
      sourceName: "Worship - MCE Presentation", // Worship and Notes share one source
      baseUrl: "http://overlay.test/mce-note.html",
      initializedKey: "_notesInitialized",
      primeMethod: "primeNotesOverlay",
    },
  ] as const)("does not double-publish $label while priming a loaded overlay document", async ({
    sourceName,
    baseUrl,
    initializedKey,
    primeMethod,
  }) => {
    inputs.set(sourceName, {
      inputKind: "browser_source",
      inputSettings: {
        url: `${baseUrl}#data=${encodeURIComponent(JSON.stringify({ mode: "lower-third", slide: { text: "Already live" } }))}`,
        css: "",
      },
    });
    sceneItems.set("MCE Presentation", new Map([
      [sourceName, { sourceName, sceneItemId: 110, sceneItemIndex: 0, enabled: true }],
    ]));
    client[initializedKey] = false;
    client._lastBrowserSourceUrlBySource[sourceName] = "";
    client.publishFullscreenOverlayPacket = vi.fn();

    await client[primeMethod]({
      sectionText: "Do not flash this",
      sectionLabel: "Verse 1",
      songTitle: "Reload Check",
      overlayMode: "lower-third",
      bibleThemeSettings: makeBackgroundTheme({ backgroundPattern: "diagonal-lines" }),
    });

    const sourceWrites = callLog.filter((entry) => entry.method === "SetInputSettings");

    expect(client.publishFullscreenOverlayPacket).not.toHaveBeenCalled();
    expect(callLog.some((entry) => entry.method === "CallVendorRequest")).toBe(false);
    expect(sourceWrites).toHaveLength(0);
    expect(client[initializedKey]).toBe(true);
    expect(client._lastBrowserSourceUrlBySource[sourceName]).toBe(baseUrl);
    expect(client._lastCssOverlayBaseUrlBySource[sourceName]).toBe(baseUrl);
  });

  it.each([
    { label: "Worship", sourceName: "Worship - MCE Presentation", baseUrl: "http://overlay.test/mce-worship-overlay.html", initializedKey: "_worshipInitialized", primeMethod: "primeWorshipOverlay" },
    { label: "Notes", sourceName: "Worship - MCE Presentation", baseUrl: "http://overlay.test/mce-note.html", initializedKey: "_notesInitialized", primeMethod: "primeNotesOverlay" },
  ] as const)("sends a background-only change to a loaded $label overlay as a theme-only packet", async ({ sourceName, baseUrl, initializedKey, primeMethod }) => {
    inputs.set(sourceName, { inputKind: "browser_source", inputSettings: { url: baseUrl, css: "" } });
    sceneItems.set("MCE Presentation", new Map([[sourceName, { sourceName, sceneItemId: 111, sceneItemIndex: 0, enabled: true }]]));
    client[initializedKey] = true;
    client._lastBrowserSourceUrlBySource[sourceName] = baseUrl;
    client._lastCssOverlayBaseUrlBySource[sourceName] = baseUrl;
    client.publishFullscreenOverlayPacket = vi.fn();

    await client[primeMethod]({
      overlayMode: "lower-third",
      backgroundOnly: true,
      bibleThemeSettings: makeBackgroundTheme({ backgroundPattern: "diagonal-lines" }),
    });

    expect(client.publishFullscreenOverlayPacket).toHaveBeenCalledTimes(1);
    const [packet] = (client.publishFullscreenOverlayPacket as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(packet.slide).toBeNull();
    expect(packet.theme).toBeTruthy();
    expect(packet.mode).toBe("lower-third");
  });

  it("reflects 50 sequential Bible lower-third background changes through the fast overlay path", async () => {
    client._bibleLtInitialized = true;
    client._lastBibleMode = "lower-third";
    client._lastBrowserSourceUrlBySource[client._fullscreenSceneDefs.bible.browserSourceName] = "http://overlay.test/existing";
    client.bringBibleOverlayForward = vi.fn(async () => {});
    client.publishFullscreenOverlayPacket = vi.fn();
    const packets: Array<Record<string, unknown>> = [];
    client.deliverCssOverlayPacket = vi.fn(async (_source: string, _type: string, packet: Record<string, unknown>) => {
      packets.push(packet);
    });
    client.getPresentationTargetScene = vi.fn(async () => ({ sceneName: "Preview Scene" }));
    client.fitSceneSourceToLowerThirdWindow = vi.fn(async () => {});
    client.promotePresentationScene = vi.fn(async () => {});

    for (let index = 0; index < 50; index += 1) {
      const variant = lowerThirdVariants[index % lowerThirdVariants.length];
      await client.pushBibleOverlayFast({
        verseText: `Stress verse ${index + 1}`,
        referenceText: "John 3:16 (KJV)",
        verseRange: "16",
        bibleThemeSettings: variant.theme,
      });

      const packet = packets[packets.length - 1];
      expect(packet).toBeTruthy();
      const theme = packet!.theme as Record<string, unknown>;
      variant.assertTheme(theme);
      expect(packet!.mode).toBe("lower-third");
    }
  });

  it("reflects 50 sequential Worship lower-third background changes through the fast overlay path", async () => {
    const sourceName = "MCE Browser - Worship";
    client._worshipInitialized = true;
    client._lastOverlayMode[sourceName] = "lower-third";
    client._lastBrowserSourceUrlBySource[sourceName] = "http://overlay.test/existing";
    client.publishFullscreenOverlayPacket = vi.fn();
    const packets: Array<Record<string, unknown>> = [];
    client.deliverCssOverlayPacket = vi.fn(async (_source: string, _type: string, packet: Record<string, unknown>) => {
      packets.push(packet);
    });
    client.getPresentationTargetScene = vi.fn(async () => ({ sceneName: "Preview Scene" }));
    client.fitSceneSourceToLowerThirdWindow = vi.fn(async () => {});
    client.promotePresentationScene = vi.fn(async () => {});

    for (let index = 0; index < 50; index += 1) {
      const variant = lowerThirdVariants[index % lowerThirdVariants.length];
      await client.pushWorshipOverlayFast({
        sectionText: `Stress worship section ${index + 1}`,
        sectionLabel: "Verse",
        songTitle: "Stress Song",
        bibleThemeSettings: variant.theme,
      });

      const packet = packets[packets.length - 1];
      expect(packet).toBeTruthy();
      const theme = packet!.theme as Record<string, unknown>;
      variant.assertTheme(theme);
      expect(packet!.mode).toBe("lower-third");
    }
  });

  it("preserves Worship lower-third text case through the fast overlay path", async () => {
    const sourceName = "MCE Browser - Worship";
    client._worshipInitialized = true;
    client._lastOverlayMode[sourceName] = "lower-third";
    client._lastBrowserSourceUrlBySource[sourceName] = "http://overlay.test/existing";
    client.publishFullscreenOverlayPacket = vi.fn();
    const packets: Array<Record<string, unknown>> = [];
    client.deliverCssOverlayPacket = vi.fn(async (_source: string, _type: string, packet: Record<string, unknown>) => {
      packets.push(packet);
    });
    client.fitSceneSourceToLowerThirdWindow = vi.fn(async () => {});

    await client.pushWorshipOverlayFast({
      sectionText: "saved by grace",
      sectionLabel: "Chorus",
      songTitle: "Case Test",
      bibleThemeSettings: makeBackgroundTheme({
        textTransform: "uppercase",
        fontColor: "#ffffff",
        fontSize: 56,
      }),
    });

    const packet = packets[packets.length - 1];
    expect(packet).toBeTruthy();
    expect((packet!.theme as Record<string, unknown>).textTransform).toBe("uppercase");
    expect((packet!.slide as Record<string, unknown>).text).toBe("saved by grace");
  });

  it("programmatically triggers OBS refreshnocache on browser source", async () => {
    const success = await client.refreshBrowserSourceCache("MCE Browser - Notes");
    expect(success).toBe(true);

    const refreshCalls = callLog.filter(
      (c) =>
        c.method === "PressInputPropertiesButton" &&
        c.payload.inputName === "MCE Browser - Notes" &&
        c.payload.propertyName === "refreshnocache",
    );
    expect(refreshCalls.length).toBe(1);
  });

  it("refreshes all overlay caches via refreshAllOverlayCaches", async () => {
    await client.refreshAllOverlayCaches();

    const refreshCalls = callLog.filter(
      (c) =>
        c.method === "PressInputPropertiesButton" &&
        c.payload.propertyName === "refreshnocache",
    );
    // Bible, Worship (shared with Notes) and Countdown each have a browser source
    expect(refreshCalls.length).toBeGreaterThanOrEqual(3);
    const inputNames = refreshCalls.map((c) => c.payload.inputName);
    expect(inputNames).toContain("Bible - MCE Presentation");
    expect(inputNames).toContain("Worship - MCE Presentation");
    expect(inputNames).not.toContain("Notes - MCE Presentation");
    expect(inputNames).toContain("Countdown - MCE Presentation");
  });
});
