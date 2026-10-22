import { describe, expect, it } from "vitest";
import dockObsClientSource from "../dockObsClient.ts?raw";
import editorSource from "./DockLowerThirdEditor.tsx?raw";
import ministrySource from "./DockMinistryTab.tsx?raw";
import worshipSource from "./DockWorshipTab.tsx?raw";
import notesSource from "./DockNotesTab.tsx?raw";
import lowerThirdOverlayHtml from "../../../public/lower-third-overlay.html?raw";

describe("Dock lower-third animate out wiring", () => {
  it("routes animate out through the dock client instead of discarding the prepared URL", () => {
    expect(editorSource).toContain("onAnimateOut(url)");
    expect(ministrySource).toContain("animateLowerThirdOverlayUrlOut(url, exitDuration, { sourceName: activeLtSource() })");
    expect(ministrySource).not.toContain("onAnimateOut={async (url) => {\n                      void url;");
  });

  it("uses an OBS browser event for lower-third exit before falling back to URL updates", () => {
    const methodStart = dockObsClientSource.indexOf("async animateLowerThirdOverlayUrlOut(");
    const methodEnd = dockObsClientSource.indexOf("\n  // ── Worship lyrics overlay ──", methodStart);
    const methodSource = dockObsClientSource.slice(methodStart, methodEnd);
    const eventIndex = methodSource.indexOf('emitBrowserOverlayPacket("lower-third"');
    const fallbackIndex = methodSource.indexOf('buildBlankedOverlayUrlFromCurrentSource(ltSource, "")');
    expect(eventIndex).toBeGreaterThan(-1);
    expect(fallbackIndex).toBeGreaterThan(-1);
    expect(eventIndex).toBeLessThan(fallbackIndex);
    expect(methodSource).toContain("_url: string");
  });

  it("replaces a live Ministry lower third without reloading the OBS browser URL", () => {
    const replaceIndex = ministrySource.indexOf("await dockObsClient.replaceLiveLowerThirdOverlayUrl(url, ltSourceOptions, exitDuration);");
    const firstPushIndex = ministrySource.indexOf("await dockObsClient.pushLowerThirdOverlayUrl(url, ltSourceOptions);");
    expect(replaceIndex).toBeGreaterThan(-1);
    expect(firstPushIndex).toBeGreaterThan(-1);
    expect(replaceIndex).toBeLessThan(firstPushIndex);
    expect(dockObsClientSource).toContain("async replaceLiveLowerThirdOverlayUrl");
    expect(dockObsClientSource).toContain('emitBrowserOverlayPacket("lower-third", nextPacket, overlayCss, packetTarget)');
    expect(dockObsClientSource).toContain('inputSettings: { url, css: overlayCss }');
  });

  it("stages the Ministry size until the user presses Go Live", () => {
    expect(editorSource).toContain("const url = buildOverlayUrl(");
    expect(editorSource).toContain("size,");
    expect(editorSource).not.toContain("pendingLiveSizeUpdateRef");
    expect(editorSource).not.toContain("latestHandleSendRef.current()");
    expect(ministrySource).not.toContain("live={ltLive}");
    expect(ministrySource).toContain("writeNativeDockSetting(MINISTRY_LT_SIZE_STORAGE_KEY, s)");
  });

  it("keeps Appearance behind an accessible collapsible section", () => {
    expect(editorSource).toContain("const [appearanceOpen, setAppearanceOpen] = useState(false);");
    expect(editorSource).toContain("aria-expanded={appearanceOpen}");
    expect(editorSource).toContain("aria-controls={LT_APPEARANCE_PANEL_ID}");
    expect(editorSource).toContain("id={LT_APPEARANCE_PANEL_ID}");
    expect(editorSource).toContain("{appearanceOpen && (");
  });

  it("uses compact visible Ministry labels while keeping full accessible labels", () => {
    expect(ministrySource).toContain('t("ministry.tickerShort", "Ticker")');
    expect(ministrySource).toContain('t("ministry.lowerThirdsShort", "Lower-Third")');
    expect(ministrySource).toContain('t("ministry.timeShort", "Time")');
    expect(ministrySource).toContain('aria-label={t("ministry.lowerThirds")}');
    expect(ministrySource).toContain('aria-label={t("ministry.time", "Time")}');
  });

  it("keeps Bible verse themes in the Bible tab instead of mixing them into Low", () => {
    expect(ministrySource).not.toContain("loadDockFavoriteBibleThemes");
    expect(ministrySource).not.toContain('entries.push({ kind: "bible"');
    expect(ministrySource).toContain("For Scripture, choose the lower-third theme in Bible.");
  });

  it("keeps theme-defined exit animations as the default", () => {
    expect(editorSource).toContain('const overlayExitStyle = exitStyle === "fade" ? undefined : exitStyle;');
  });

  it("injects theme CSS before blanked/out rendering", () => {
    const cssInjectionIndex = lowerThirdOverlayHtml.indexOf("injectThemeCss(data);");
    const blankedIndex = lowerThirdOverlayHtml.indexOf("if (blanked) {");
    expect(cssInjectionIndex).toBeGreaterThan(-1);
    expect(blankedIndex).toBeGreaterThan(-1);
    expect(cssInjectionIndex).toBeLessThan(blankedIndex);
  });

  it("listens for OBS browser lower-third exit events without reloading the browser source", () => {
    expect(lowerThirdOverlayHtml).toContain('window.addEventListener("mce-overlay-packet", readFromObsBrowserEvent)');
    expect(lowerThirdOverlayHtml).toContain('if (packet.action === "animate-out")');
    expect(lowerThirdOverlayHtml).toContain("if (isExiting) return true;");
    expect(lowerThirdOverlayHtml).toContain("pendingThemePayload");
    expect(lowerThirdOverlayHtml).toContain("readCssOverlayData");
    expect(lowerThirdOverlayHtml).toContain('writeRenderAck(packet, "lower-third")');
  });

  it("keeps the source visible until the exit duration completes", () => {
    expect(dockObsClientSource).toContain("async animateLowerThirdOverlayUrlOut");
    expect(dockObsClientSource).toContain("sceneItemEnabled: true");
    // Waits for slow (staggered) exits too, not only the theme's stated duration.
    expect(dockObsClientSource).toContain("await this.sleep(delivered ? Math.max(waitMs, LT_EXIT_SETTLE_MS) : 0)");
    expect(dockObsClientSource).toContain("await this.hideOverlaySource(sceneName, ltSource)");
  });

  it("empties the page before hiding it, so the next Send never shows the old graphic", () => {
    const animateOut = dockObsClientSource.slice(dockObsClientSource.indexOf("async animateLowerThirdOverlayUrlOut"));
    const empty = animateOut.indexOf("await this.emptyLowerThirdPage(ltSource)");
    const hide = animateOut.indexOf("await this.hideOverlaySource(sceneName, ltSource)");
    expect(empty).toBeGreaterThan(0);
    expect(empty).toBeLessThan(hide);
    expect(dockObsClientSource).toContain('{ action: "clear", timestamp: Date.now() }');
    // Scene-routed lower thirds are emptied before they are hidden as well.
    expect(dockObsClientSource).toContain('if (module === "lower-third") await this.emptyLowerThirdPage(sourceName);');
    expect(lowerThirdOverlayHtml).toContain('if (packet.action === "clear")');
  });

  it("gives the source its new page before turning it back on", () => {
    const push = dockObsClientSource.slice(dockObsClientSource.indexOf("async pushLowerThirdOverlayUrl("));
    const body = push.slice(0, push.indexOf("async replaceLiveLowerThirdOverlayUrl"));
    expect(body).toContain('"keep",');
    expect(body.indexOf('"SetInputSettings"')).toBeLessThan(body.indexOf('"SetSceneItemEnabled"'));
  });
});

describe("Ministry lower-third tabs in OBS", () => {
  it("checks OBS for a lower third already on screen and plays it out before the new one", () => {
    expect(ministrySource).toContain("if (ltLive || await dockObsClient.isLowerThirdSourceShowing(ltSourceOptions.sourceName)) {");
    expect(ministrySource).toContain("await dockObsClient.replaceLiveLowerThirdOverlayUrl(url, ltSourceOptions, exitDuration);");
  });

  it("offers one shared source or a source per tab, and remembers the choice", () => {
    expect(ministrySource).toContain('const MINISTRY_LT_SOURCE_MODE_KEY = "dock-ministry-lower-third-source-mode";');
    expect(ministrySource).toContain("void writeNativeDockSetting(MINISTRY_LT_SOURCE_MODE_KEY, mode);");
    expect(ministrySource).toContain("dockObsClient.setLowerThirdPerTabSources(ltPerTab);");
  });

  it("with a source per tab, sends packets to that tab's page only and leaves the other tabs on screen", () => {
    expect(dockObsClientSource).toContain("const packetTarget = this._ltPerTabSources ? ltSource : undefined;");
    expect(dockObsClientSource).toContain("const deliveredGlobal = !onlyThisSource && await this.emitBrowserOverlayPacket(");
    expect(dockObsClientSource).toContain("this._ltPerTabSources && isMinistryLtTabSource(primary) && isMinistryLtTabSource(item.sourceName)");
    expect(dockObsClientSource).toContain('return `MCE LT: Tab ${tabId.slice(-6)}`;');
    // Per-tab pages get ?mceSource= so they ignore packets meant for another tab.
    expect(dockObsClientSource).toContain("return this.buildSceneRouteOverlayUrl(url, sourceName);");
    expect(lowerThirdOverlayHtml).toContain('new URLSearchParams(window.location.search).get("mceSource")');
  });
});

describe("Worship and Notes quick controls with a layer theme", () => {
  it("translate LG / XL / 2XL, + / −, Bold and Italic for the theme before applying them", () => {
    expect(worshipSource).toContain("patch = withLayerThemeQuickPatch(patch, {");
    expect(worshipSource).toContain("settings={layerThemeQuickDisplay(");
    expect(ministrySource).not.toContain("withLayerThemeQuickPatch");
    expect(notesSource).toContain("patch = withLayerThemeQuickPatch(patch, {");
    expect(notesSource).toContain("return layerThemeQuickDisplay({");
  });
});
