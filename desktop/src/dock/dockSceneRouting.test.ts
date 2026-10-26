import { describe, expect, it, vi } from "vitest";
import { dockObsClient, getMcePresentationVisibilityKeepSet, isMceLowerThirdSourceName } from "./dockObsClient";
import routingSource from "./dockSceneRouting.ts?raw";
import routingControlSource from "./components/DockSceneRoutingControl.tsx?raw";
import bibleTabSource from "./tabs/DockBibleTab.tsx?raw";
import worshipTabSource from "./tabs/DockWorshipTab.tsx?raw";
import notesTabSource from "./tabs/DockNotesTab.tsx?raw";
import mediaTabSource from "./tabs/DockMediaTab.tsx?raw";
import ministryTabSource from "./tabs/DockMinistryTab.tsx?raw";
import countdownTabSource from "./tabs/DockCountdownsTab.tsx?raw";
import timeTabSource from "./tabs/DockTimeTab.tsx?raw";
import dockPageSource from "./DockPage.tsx?raw";
import obsClientSource from "./dockObsClient.ts?raw";
import bibleOverlaySource from "../../public/mce-bible-overlay.html?raw";
import presentationOverlaySource from "../../public/presentation.html?raw";
import presentationBridgeSource from "../services/presentationDockBridge.ts?raw";
import worshipOverlaySource from "../../public/mce-worship-overlay.html?raw";
import notesOverlaySource from "../../public/mce-note.html?raw";
import lowerThirdOverlaySource from "../../public/lower-third-overlay.html?raw";
import {
  getDockOutputDestinations,
  getDockSceneRouteTargets,
  isDockOutputRouted,
  normalizeDockSceneRoute,
  presentationOnlyRoutePatch,
} from "./dockSceneRouting";

describe("dock scene routing", () => {
  it("gives every selected-scene overlay its own stable source name", () => {
    expect(dockObsClient.getSceneRouteSourceName("bible", "Livestream Scene"))
      .toBe("Bible - MCE Livestream Scene");
    expect(dockObsClient.getSceneRouteSourceName("lower-third", "Livestream Scene"))
      .toBe("Lower Third - MCE Livestream Scene");
    expect(dockObsClient.getSceneRouteSourceName("countdown", "Livestream Scene", "Background"))
      .toBe("Countdown Background - MCE Livestream Scene");
    expect(dockObsClient.getSceneRouteSourceName("time", "Livestream Scene"))
      .toBe("Time - MCE Livestream Scene");
  });

  it("persists an independent target and an explicit MCE Presentation sync choice per module", () => {
    expect(routingSource).toContain('const SCENE_ROUTING_STORAGE_KEY = "dock-scene-routing-v1"');
    expect(routingSource).toContain("syncPresentation: candidate.syncPresentation !== false");
    expect(normalizeDockSceneRoute(undefined).syncPresentation).toBe(true);
    expect(routingSource).toContain("readNativeDockSetting<StoredSceneRoutes>(SCENE_ROUTING_STORAGE_KEY)");
    expect(routingSource).toContain('export type DockSceneOutputMode = "inherit" | "fullscreen" | "lower-third"');
    expect(routingSource).toContain("targets: DockSceneRouteTarget[]");
  });

  it("migrates the legacy single-scene route and preserves per-scene formats", () => {
    expect(normalizeDockSceneRoute({ enabled: true, sceneName: "Camera", syncPresentation: false })).toEqual({
      enabled: true,
      sceneName: "Camera",
      targets: [{ sceneName: "Camera", mode: "inherit" }],
      syncPresentation: false,
      display: { enabled: false, monitorKey: "", monitorName: "", mode: "fullscreen" },
    });

    const route = normalizeDockSceneRoute({
      enabled: true,
      targets: [
        { sceneName: "Full Screen", mode: "fullscreen" },
        { sceneName: "Lower Third", mode: "lower-third" },
        { sceneName: "Full Screen", mode: "inherit" },
      ],
      syncPresentation: true,
    });
    expect(route.sceneName).toBe("Full Screen");
    expect(getDockSceneRouteTargets(route)).toEqual([
      { sceneName: "Full Screen", mode: "fullscreen" },
      { sceneName: "Lower Third", mode: "lower-third" },
    ]);
  });

  it("uses a small, stable URL and targets packets to the independent browser input", () => {
    const methodStart = obsClientSource.indexOf("private async pushSceneRouteBrowserSource(");
    const methodEnd = obsClientSource.indexOf("\n  async clearSceneRouteSource", methodStart);
    const methodSource = obsClientSource.slice(methodStart, methodEnd);

    expect(methodSource).toContain("ensureOverlaySource(sceneName, sourceName");
    expect(methodSource).toContain("buildSceneRouteOverlayUrl(options.url, sourceName)");
    expect(methodSource).toContain("const documentNeedsLoad = needsRouteReconciliation");
    expect(methodSource).toContain("await this.hasBrowserSourceUrlChanged(sourceName, stableSourceUrl)");
    expect(methodSource).toContain("if (documentNeedsLoad) await this.sleep(220)");
    expect(methodSource).toContain("const needsRouteReconciliation = !routeWasRecentlyPrepared || !hasStableLoadedDocument");
    expect(obsClientSource).toContain("SCENE_ROUTE_SOURCE_RECONCILE_MS");
    expect(methodSource).toContain("emitBrowserOverlayPacket(");
    expect(methodSource).toContain("this.buildOverlayUrlFromPayload(stableSourceUrl, options.overlayPacket)");
    expect(methodSource).toContain("if (documentNeedsLoad) {");
  });

  it("keeps route packets isolated from the shared MCE Presentation overlays", () => {
    expect(obsClientSource).toContain("...(targetSource ? { targetSource } : {})");
    expect(obsClientSource).toContain('event_name: "mce-overlay-packet"');
    expect(obsClientSource).toContain("event_data: {\n                tab: tabType,");
    for (const overlaySource of [bibleOverlaySource, worshipOverlaySource, notesOverlaySource]) {
      expect(overlaySource).toContain("const _routeSource");
      expect(overlaySource).toMatch(/if \(_routeSource && (?:targetSource && )?targetSource !== _routeSource\) return false;/);
    }
    expect(lowerThirdOverlaySource).toContain("const routeSource");
    expect(lowerThirdOverlaySource).toContain("const lowerThirdChannel");
    expect(lowerThirdOverlaySource).toContain("targetSource !== routeSource");
  });

  it("isolates only MCE-owned sources when a new presentation source is activated", () => {
    const methodStart = obsClientSource.indexOf("private async ensureActiveMceOverlaySource(");
    const methodEnd = obsClientSource.indexOf("\n  private invalidateActiveMceOverlayState", methodStart);
    const methodSource = obsClientSource.slice(methodStart, methodEnd);

    expect(methodSource).toContain("isMcePresentationManagedSource(item.sourceName)");
    expect(methodSource).toContain('addVisibilityRequest(PRESENTATION_SCENE_NAME, item.sceneItemId, false)');
    expect(methodSource).toContain("presentationSourceVisibility");
    expect(methodSource).toContain("lowerThirdSourceVisibility");
    expect(methodSource).toContain("PRESENTATION_SCENE_NAME");
    expect(methodSource).toContain("MCE Presentation only");
  });

  it("updates the clicked module before focusing its shared output source", () => {
    expect(obsClientSource).toContain('focusMcePresentationModule("bible")');
    expect(obsClientSource).toContain('focusMcePresentationModule("worship")');
    expect(obsClientSource).toContain('focusMcePresentationModule("notes")');
    expect(obsClientSource).toContain("Deliver the new verse while the source is still hidden");
    expect(obsClientSource).toContain("The packet is now current.");
    expect(obsClientSource).toContain("Only after that do we isolate this tab's");
    expect(obsClientSource).toContain("focusMcePresentationModule(\"media\")");
    expect(mediaTabSource).not.toContain("How the slideshow works");
    expect(mediaTabSource).toContain('useState("MCE slideshow")');
    expect(mediaTabSource).toContain('const sourceName = playlistName.trim() || "MCE slideshow"');
  });

  it("does not reorder the active source when only the verse payload changes", () => {
    const methodStart = obsClientSource.indexOf("private async ensureActiveMceOverlaySource(");
    const methodEnd = obsClientSource.indexOf("\n  /** Apply the operator's MCE-only visibility preference", methodStart);
    const methodSource = obsClientSource.slice(methodStart, methodEnd);
    const stateCheckIndex = methodSource.indexOf("this._activeMceOverlayStateByScene[targetScene] === stateSignature");
    const firstOrderingIndex = methodSource.indexOf("await this.ensureTickerAboveSource(targetScene, primary,");

    expect(stateCheckIndex).toBeGreaterThan(-1);
    expect(firstOrderingIndex).toBeGreaterThan(stateCheckIndex);
  });

  it("hides the sources to hide first and shows the new one in the same step", () => {
    const methodStart = obsClientSource.indexOf("private async ensureActiveMceOverlaySource(");
    const methodEnd = obsClientSource.indexOf("\n  /** Apply the operator's MCE-only visibility preference", methodStart);
    const methodSource = obsClientSource.slice(methodStart, methodEnd);

    // Stacking the new source must not switch it on early.
    expect(methodSource).toContain("await this.ensureTickerAboveSource(targetScene, primary, { leaveVisibility: true })");
    // Hides come first, then the show, applied in one serial-frame batch.
    expect(methodSource).toContain("const requests = [...hideRequests, ...showRequests];");
    expect(methodSource).toContain("this.callBatch(requests, 1)");
    expect(methodSource.indexOf("[...hideRequests, ...showRequests]")).toBeGreaterThan(-1);
  });

  it("does not show a source before its first packet lands on a cold start", () => {
    const methodStart = obsClientSource.indexOf("async ensureModuleSourceOpenAndOnTop(");
    const methodEnd = obsClientSource.indexOf("async reconcileMcePresentationVisibility", methodStart);
    const methodSource = obsClientSource.slice(methodStart, methodEnd);

    expect(methodSource).toContain("const coldStart");
    expect(methodSource).toContain("coldStart ? 3000 : 450");
  });

  it("removes legacy single-Bible content before compare output is shown", () => {
    expect(obsClientSource).toContain("hideLegacyBibleContentSources");
    expect(obsClientSource).toContain('getMcePresentationSourceFamily(item.sourceName) !== "bible"');
    expect(obsClientSource).toContain("if (compareEnabled)");
    expect(obsClientSource).toContain("PRESENTATION_SCENE_NAME, sceneName");
    expect(bibleOverlaySource).toContain("visibility: hidden;");
  });

  it("sends a compare selection through one authoritative Bible projection path", () => {
    const comparePushStart = bibleTabSource.indexOf("const publishComparePassageOutput");
    const comparePushEnd = bibleTabSource.indexOf("const handleComparePassageNavigation", comparePushStart);
    const comparePushSource = bibleTabSource.slice(comparePushStart, comparePushEnd);

    expect(comparePushSource).toContain("await pushLive()");
    expect(comparePushSource).not.toContain("primeBibleOverlay(");
  });

  it("keeps an already-live Bible source visible across a Dock refresh", () => {
    expect(obsClientSource).toContain('const MCE_PRESENTATION_ACTIVE_MODULE_KEY = "ocs-dock-presentation-active-module-v1"');
    expect(obsClientSource).toContain("writeNativeDockSetting(MCE_PRESENTATION_ACTIVE_MODULE_KEY, module)");
    expect(obsClientSource).toContain("private async tryPushRestoredLiveBiblePacket");
    expect(obsClientSource).toContain("if (await this.tryPushRestoredLiveBiblePacket(data)) return;");
    expect(obsClientSource).toContain("await this.deliverCssOverlayPacket(sourceName, \"bible\", packet, baseUrl, themeCss)");
    expect(obsClientSource).toContain('await this._ensureFullscreenScene("bible", mode, "keep")');
  });

  it("paints Worship from native and cached local state before background refresh", () => {
    expect(worshipTabSource).toContain("useState<DockSong[]>(() => loadCachedSongs())");
    expect(worshipTabSource).toContain("applyPreferences(loadDockWorshipPreferences(), BUILTIN_THEMES)");
    expect(worshipTabSource).toContain("if (!preferencesHydrated || !prefsReadyRef.current) return;");
  });

  it("verifies the live OBS browser source painted the new font", () => {
    const methodStart = obsClientSource.indexOf("async refreshOutputTypography(): Promise<void>");
    const methodEnd = obsClientSource.indexOf("\n  private extractOverlayPacketFromCss", methodStart);
    const methodSource = obsClientSource.slice(methodStart, methodEnd);
    const restartStart = obsClientSource.indexOf("private async setBrowserSourceCssAndRestart");
    const restartEnd = obsClientSource.indexOf("\n  /**", restartStart);
    const restartSource = obsClientSource.slice(restartStart, restartEnd);

    expect(methodSource).toContain("await this.connect().catch");
    expect(methodSource).toContain("waitForOverlayRenderAck");
    expect(methodSource).toContain("setBrowserSourceCssAndRestart");
    expect(restartSource).toContain("restart_cef: true");
    expect(restartSource).toContain("restart_cef: false");
  });

  it("keeps the active MCE content family and structural program reference only", () => {
    const keepSet = getMcePresentationVisibilityKeepSet("MCE Browser - Bible", [
      { sourceName: "MCE Program Scene Reference", sceneItemIndex: 0 },
      { sourceName: "MCE Browser - Bible", sceneItemIndex: 1 },
      { sourceName: "MCE BG - Bible", sceneItemIndex: 2 },
      { sourceName: "MCE Browser - Worship", sceneItemIndex: 3 },
      { sourceName: "MCE Ticker", sceneItemIndex: 4 },
      { sourceName: "User Camera", sceneItemIndex: 5 },
    ]);

    expect(keepSet.has("MCE Browser - Bible")).toBe(true);
    expect(keepSet.has("MCE BG - Bible")).toBe(true);
    expect(keepSet.has("MCE Program Scene Reference")).toBe(true);
    expect(keepSet.has("MCE Browser - Worship")).toBe(false);
    // The ticker is started and stopped only from the Ministry tab; a verse never hides it.
    expect(keepSet.has("MCE Ticker")).toBe(true);
    expect(keepSet.has("User Camera")).toBe(false);
  });

  it("lets a lower third sit on top of everything except other lower thirds unless asked to hide the rest", () => {
    const items = [
      { sourceName: "MCE Browser - Bible", sceneItemIndex: 0 },
      { sourceName: "MCE Browser - Worship", sceneItemIndex: 1 },
      { sourceName: "MCE LT: Speaker strap", sceneItemIndex: 2 },
      { sourceName: "MCE LT: Giving banner", sceneItemIndex: 3 },
      { sourceName: "MCE Ticker", sceneItemIndex: 4 },
    ];

    const overlay = getMcePresentationVisibilityKeepSet("MCE LT: Speaker strap", items, "overlay");
    const activeOnly = getMcePresentationVisibilityKeepSet("MCE LT: Speaker strap", items, "active-only");

    expect(overlay.has("MCE LT: Speaker strap")).toBe(true);
    expect(overlay.has("MCE Browser - Bible")).toBe(true);
    expect(overlay.has("MCE Browser - Worship")).toBe(true);
    expect(overlay.has("MCE Ticker")).toBe(true);
    expect(overlay.has("MCE LT: Giving banner")).toBe(false);

    expect(activeOnly.has("MCE LT: Speaker strap")).toBe(true);
    expect(activeOnly.has("MCE Browser - Bible")).toBe(false);
    expect(activeOnly.has("MCE Browser - Worship")).toBe(false);
    expect(activeOnly.has("MCE Ticker")).toBe(true);
  });

  it("recognises every lower-third source name", () => {
    expect(isMceLowerThirdSourceName("Lower Third - MCE Presentation")).toBe(true);
    expect(isMceLowerThirdSourceName("Animated Lower Thirds - MCE Presentation")).toBe(true);
    expect(isMceLowerThirdSourceName("MCE LT: Speaker strap")).toBe(true);
    expect(isMceLowerThirdSourceName("MCE Browser - Bible")).toBe(false);
    expect(isMceLowerThirdSourceName("Ticker - MCE Presentation")).toBe(false);
  });

  it("preserves audio sources when preserveAudio is true (default) upon switching presentation content", () => {
    const items = [
      { sourceName: "MCE Program Scene Reference", sceneItemIndex: 0 },
      { sourceName: "MCE Browser - Bible", sceneItemIndex: 1 },
      { sourceName: "MCE Browser - Worship", sceneItemIndex: 2 },
      { sourceName: "Audio - MCE Presentation", sceneItemIndex: 3 },
      { sourceName: "MCE Media - Audio", sceneItemIndex: 4 },
      { sourceName: "MCE Scene Audio - Pad - media", sceneItemIndex: 5 },
    ];

    const keepSet = getMcePresentationVisibilityKeepSet("MCE Browser - Bible", items, "active-only", true);

    expect(keepSet.has("MCE Browser - Bible")).toBe(true);
    expect(keepSet.has("MCE Program Scene Reference")).toBe(true);
    expect(keepSet.has("MCE Browser - Worship")).toBe(false);
    expect(keepSet.has("Audio - MCE Presentation")).toBe(true);
    expect(keepSet.has("MCE Media - Audio")).toBe(true);
    expect(keepSet.has("MCE Scene Audio - Pad - media")).toBe(true);
  });

  it("hides audio sources when preserveAudio is explicitly set to false", () => {
    const items = [
      { sourceName: "MCE Browser - Bible", sceneItemIndex: 0 },
      { sourceName: "Audio - MCE Presentation", sceneItemIndex: 1 },
    ];

    const keepSet = getMcePresentationVisibilityKeepSet("MCE Browser - Bible", items, "active-only", false);

    expect(keepSet.has("MCE Browser - Bible")).toBe(true);
    expect(keepSet.has("Audio - MCE Presentation")).toBe(false);
  });

  it("exposes the same scene picker in every requested output area", () => {
    expect(routingControlSource).toContain("Send to another scene");
    expect(routingControlSource).toContain("Also update MCE Presentation");
    expect(routingControlSource).toContain("Target scenes");
    expect(routingControlSource).toContain("Full screen");
    expect(routingControlSource).toContain("Lower third");
    expect(bibleTabSource).toContain('module="bible"');
    expect(worshipTabSource).toContain('module="worship"');
    expect(notesTabSource).toContain('module="notes"');
    expect(ministryTabSource).toContain('module="ticker"');
    expect(ministryTabSource).toContain('module="lower-third"');
    expect(countdownTabSource).toContain('module="countdown"');
    expect(timeTabSource).toContain('module="time"');
  });

  it("routes each tab through its independent sender before optionally syncing MCE Presentation", () => {
    expect(obsClientSource).toContain("async pushBibleToScene");
    expect(obsClientSource).toContain("async pushBibleToScenes");
    expect(obsClientSource).toContain("async pushWorshipToScene");
    expect(obsClientSource).toContain("async pushNotesToScene");
    expect(obsClientSource).toContain("async pushTickerToScene");
    expect(obsClientSource).toContain("async pushLowerThirdOverlayUrlToScene");
    expect(countdownTabSource).toContain("getObsTargets(cd)");
    expect(ministryTabSource).toContain("tickerSceneRoute.syncPresentation");
    expect(ministryTabSource).toContain("lowerThirdSceneRoute.syncPresentation");
  });

  it("keeps every routed Bible target inside one latest-only mutation", async () => {
    const client = dockObsClient as unknown as Record<string, any>;
    const previousInternal = client.pushBibleToSceneInternal;
    const previousTail = client._bibleMutationTail;
    const previousCounter = client._bibleMutationCounter;
    const sentScenes: string[] = [];

    client._bibleMutationTail = Promise.resolve();
    client._bibleMutationCounter = 0;
    client.pushBibleToSceneInternal = vi.fn(async (_data: unknown, sceneName: string) => {
      sentScenes.push(sceneName);
    });

    try {
      await client.pushBibleToScenes([
        {
          sceneName: "General",
          data: { book: "John", chapter: 3, verse: 16, translation: "KJV" },
        },
        {
          sceneName: "Live Stream",
          data: { book: "John", chapter: 3, verse: 16, translation: "KJV" },
        },
      ]);

      expect(sentScenes).toEqual(["General", "Live Stream"]);
    } finally {
      client.pushBibleToSceneInternal = previousInternal;
      client._bibleMutationTail = previousTail;
      client._bibleMutationCounter = previousCounter;
    }
  });

  it("keeps linked Bible presentation output aligned with two- and three-passage compare", () => {
    expect(presentationBridgeSource).toContain(".slice(0, 3)");
    expect(presentationBridgeSource).toContain("presentationCompareColumns.length >= 2");
    expect(presentationOverlaySource).toContain(".slice(0, 3)");
    expect(presentationOverlaySource).toContain("const columnCount = Math.max(2, Math.min(3, columns.length));");
    expect(presentationOverlaySource).toContain("compareColumns.length >= 2");
    expect(bibleOverlaySource).toContain("applyFullscreenCompareLayoutMode(currentCompareLayout);");
  });

  it("keeps the Dock typography control separate from the CMG Sans OBS default", () => {
    expect(dockPageSource).toContain("page.dockFontFamily");
    expect(dockPageSource).toContain("page.dockFontSize");
    expect(dockPageSource).not.toContain("page.obsFontFamily");
    expect(dockPageSource).not.toContain("dock-output-font-family");
    expect(dockPageSource).not.toContain("OBS output size");
    expect(obsClientSource).toContain("loadDockOutputFontFamily");
    expect(obsClientSource).toContain("async refreshOutputTypography");
    expect(bibleOverlaySource).toContain("--mce-output-font-family");
    expect(bibleOverlaySource).toContain("'--mce-output-font-family'");
    expect(presentationBridgeSource).toContain("loadDockOutputFontFamily");
  });

  it("re-fits Bible text responsively when the mobile viewport or line count changes", () => {
    expect(bibleOverlaySource).toContain('width=device-width');
    expect(bibleOverlaySource).toContain("document.addEventListener('DOMContentLoaded', fit");
    expect(bibleOverlaySource).toContain("function getVisualScale");
    expect(bibleOverlaySource).toContain("const absoluteFloor = Math.max(fallback, 16)");
    expect(bibleTabSource).toContain("void handleSyncBibleBrowserSettings({}, safeLineCount);");
    expect(bibleTabSource).toContain("Line count changes the actual passage layout");
  });

  it("publishes linked compare navigation to the active OBS or presentation route", () => {
    expect(bibleTabSource).toContain("const nextDrafts = comparePassageDrafts.map");
    expect(bibleTabSource).toContain("draftsOverride: nextDrafts");
    expect(bibleTabSource).toContain("void publishComparePassageOutput({");
  });

  it("keeps the Bible overlay fit cache tied to the active theme mode", () => {
    expect(bibleOverlaySource).toContain("lastAppliedThemeKeyByMode[activeMode] || ''");
    expect(bibleOverlaySource).not.toContain("lastAppliedThemeKey,\n");
  });

  it("updates Notes slides in place without restarting a full-layer fade", () => {
    expect(notesOverlaySource).not.toContain("mce-preview-slide-fade");
    expect(notesOverlaySource).not.toContain("restartPreviewFade");
  });

  it("delivers every routed lower-third update as a complete targeted packet", () => {
    const methodStart = obsClientSource.indexOf("async pushLowerThirdOverlayUrlToScene(");
    const methodEnd = obsClientSource.indexOf("\n  /**\n   * Push a Bible verse", methodStart);
    const methodSource = obsClientSource.slice(methodStart, methodEnd);

    expect(methodSource).toContain("const parsed = this.parseOverlayPayloadUrl(url);");
    expect(methodSource).toContain("url: parsed.baseUrl");
    expect(methodSource).toContain("overlayPacket: parsed.payload");
    expect(methodSource).toContain('overlayTab: "lower-third"');
    expect(methodSource).toContain("this.rememberCssOverlayTransport(sourceName, parsed.payload, parsed.baseUrl, \"\", \"lower-third\")");
  });

  it.each([
    ["Bible", bibleOverlaySource],
    ["Worship", worshipOverlaySource],
    ["Notes", notesOverlaySource],
  ])("%s overlay never starts in a stale mode or fades from the old mode while hidden", (_name, source) => {
    // The URL mode and the packet in the URL hash come before the cached packet.
    const readInitialMode = source.slice(
      source.indexOf("function readInitialMode()"),
      source.indexOf("const initialMode = readInitialMode();"),
    );
    expect(readInitialMode.indexOf("get('mode')")).toBeGreaterThan(-1);
    expect(readInitialMode.indexOf("get('mode')")).toBeLessThan(readInitialMode.indexOf("window.location.hash"));
    expect(readInitialMode.indexOf("window.location.hash")).toBeLessThan(readInitialMode.indexOf("localStorage.getItem(_storageKey)"));
    // The first reveal never replaces a mode a live packet already chose.
    expect(source).toContain("const revealMode = activeMode || packetMode || initialMode;");
    expect(source).toContain("if (!activeMode) setActiveLayer(revealMode);");
    expect(source).not.toContain("setActiveLayer(initialMode);");
    // A mode switch while the source is hidden snaps instead of cross-fading.
    expect(source).toContain("obsSourceVisibleChanged");
    expect(source).toContain("const snapToLayer = Boolean(activeMode) && (document.hidden || !_mceSourceVisible);");
  });
});

describe("routed output summary", () => {
  const base = normalizeDockSceneRoute({
    enabled: true,
    targets: [{ sceneName: "invite_your_friends", mode: "lower-third" }],
    syncPresentation: false,
    display: { enabled: true, monitorKey: "pj", monitorName: "EPSON PJ" },
  });

  it("lists every place a send reaches", () => {
    expect(isDockOutputRouted(base)).toBe(true);
    expect(getDockOutputDestinations(base)).toEqual([
      { kind: "scene", name: "invite_your_friends", mode: "lower-third" },
      { kind: "display", name: "EPSON PJ", mode: "fullscreen" },
    ]);
    expect(getDockOutputDestinations({ ...base, syncPresentation: true }).map((d) => d.kind))
      .toEqual(["scene", "presentation", "display"]);
  });

  it("still sends to MCE Presentation when only a display is added", () => {
    const displayOnly = { ...base, enabled: false };
    expect(isDockOutputRouted(displayOnly)).toBe(true);
    expect(getDockOutputDestinations(displayOnly).map((d) => d.kind)).toEqual(["presentation", "display"]);
  });

  it("is not routed when scenes and display are off", () => {
    const off = normalizeDockSceneRoute({ enabled: false, targets: [{ sceneName: "BRB", mode: "inherit" }] });
    expect(isDockOutputRouted(off)).toBe(false);
    expect(getDockOutputDestinations(off)).toEqual([{ kind: "presentation", name: "MCE Presentation" }]);
  });

  it("MCE Presentation only turns off scenes and display but keeps the saved choices", () => {
    const patched = normalizeDockSceneRoute({ ...base, ...presentationOnlyRoutePatch(base) });
    expect(isDockOutputRouted(patched)).toBe(false);
    expect(patched.targets).toEqual(base.targets);
    expect(patched.display).toEqual({ enabled: false, monitorKey: "pj", monitorName: "EPSON PJ", mode: "fullscreen" });
  });
});
