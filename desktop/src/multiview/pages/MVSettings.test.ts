import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SETTINGS_CATEGORIES, type SettingsTab } from "./MVSettings";

const mvSettingsSource = readFileSync(fileURLToPath(new URL("./MVSettings.tsx", import.meta.url)), "utf8");
const mvSettingsCssSource = readFileSync(fileURLToPath(new URL("./MVSettings.css", import.meta.url)), "utf8");

describe("MVSettings Critical Vocabulary & Tab Completeness", () => {
  it("strictly enforces zero occurrences of the prohibited word anywhere in MVSettings source", () => {
    // Critical Vocabulary Rule: NEVER use the prohibited word
    expect(mvSettingsSource.toLowerCase()).not.toContain("sanctuary");
    expect(mvSettingsCssSource.toLowerCase()).not.toContain("sanctuary");
  });

  it("uses approved replacement terminology for auditorium displays in Bible section", () => {
    expect(mvSettingsSource).toContain("Boost outline and contrast for washed-out auditoriums or high-ambient light.");
  });

  it("defines all 12 tabs across Application, Production & Stream, and Account & System categories", () => {
    const allTabIds: SettingsTab[] = SETTINGS_CATEGORIES.flatMap((c) => c.items.map((i) => i.id));
    
    // Application
    expect(allTabIds).toContain("general");
    expect(allTabIds).toContain("appearance");
    expect(allTabIds).toContain("bible");
    
    // Production & Stream
    expect(allTabIds).toContain("broadcast");
    expect(allTabIds).toContain("branding");
    expect(allTabIds).toContain("obs");
    expect(allTabIds).toContain("vmix");
    expect(allTabIds).toContain("audio");
    expect(allTabIds).toContain("mobile");
    expect(allTabIds).toContain("automation");
    
    // Account & System
    expect(allTabIds).toContain("usage");
    expect(allTabIds).toContain("storage");
    
    expect(allTabIds.length).toBe(12);
  });

  it("lists Mobile Companion under Coming soon, not under Production & Stream", () => {
    const production = SETTINGS_CATEGORIES.find((c) => c.group === "Production & Stream")!;
    expect(production.items.map((i) => i.id)).not.toContain("mobile");
    const soon = SETTINGS_CATEGORIES.find((c) => c.group === "Coming soon")!;
    expect(soon.items.map((i) => i.id)).toEqual(["mobile"]);
    expect(soon.items.every((i) => i.comingSoon === true)).toBe(true);
  });

  it("includes broadcast and all 12 tabs in validTabs for direct navigation and URL search params", () => {
    expect(mvSettingsSource).toContain('validTabs: SettingsTab[] = ["general", "appearance", "bible", "branding", "obs", "vmix", "broadcast", "mobile", "automation", "usage", "storage", "audio"]');
    expect(mvSettingsSource).toContain("setActiveTab(tabParam)");
  });
});

describe("MVSettings Audio & Microphone Input Tab", () => {
  it("formats Input Gain & Digital Pre-amp without text collision using switch-left and block display", () => {
    expect(mvSettingsSource).toContain('<div className="switch-left">');
    expect(mvSettingsSource).toContain('<label className="form-label" style={{ marginBottom: "2px", display: "block" }}>Input Gain & Digital Pre-amp</label>');
    expect(mvSettingsSource).toContain('<span className="switch-subtitle" style={{ display: "block" }}>Boost microphone pickup sensitivity before speech recognition processing.</span>');
    expect(mvSettingsCssSource).toMatch(/\.form-label\s*\{[^}]*display:\s*block;/);
    expect(mvSettingsCssSource).toMatch(/\.switch-subtitle\s*\{[^}]*display:\s*block;/);
  });

  it("implements dual Web Audio API and native Tauri live level monitoring", () => {
    // Web Audio API monitor
    expect(mvSettingsSource).toContain("navigator.mediaDevices.getUserMedia");
    expect(mvSettingsSource).toContain("audioCtx.createMediaStreamSource");
    expect(mvSettingsSource).toContain("audioCtx.createAnalyser");
    expect(mvSettingsSource).toContain("analyser.fftSize = 256");
    expect(mvSettingsSource).toContain("analyser.getByteFrequencyData");
    expect(mvSettingsSource).toContain("requestAnimationFrame(updateLevel)");

    // Gain node tied to digital pre-amp slider
    expect(mvSettingsSource).toContain("gainNodeRef.current = gainNode");
    expect(mvSettingsSource).toContain("gainNodeRef.current.gain.value");

    // Native Tauri capture fallback and event subscriptions
    expect(mvSettingsSource).toContain('safeTauriInvoke("start_audio_capture"');
    expect(mvSettingsSource).toContain('safeTauriListen<{ level: number }>("audio-chunk"');
    expect(mvSettingsSource).toContain('safeTauriListen<{ level: number }>("assemblyai-audio-level"');

    // Clean teardown on unmount or tab leave
    expect(mvSettingsSource).toContain("stream?.getTracks().forEach((t) => t.stop())");
    expect(mvSettingsSource).toContain("audioCtx?.close()");
    expect(mvSettingsSource).toContain('safeTauriInvoke("stop_audio_capture")');
    expect(mvSettingsSource).toContain("cancelAnimationFrame(animId)");
  });

  it("renders a live VU meter with active signal percentage and glowing indicator", () => {
    expect(mvSettingsSource).toContain("Input Level Meter");
    expect(mvSettingsSource).toContain("Signal Active ({Math.round(liveAudioLevel * 100)}%)");
    expect(mvSettingsSource).toContain("No Signal");
    expect(mvSettingsSource).toContain("backgroundColor: liveAudioLevel > 0.85 ?");
  });

  it("provides microphone selection and device rescanning", () => {
    expect(mvSettingsSource).toContain("Preferred Microphone Input");
    expect(mvSettingsSource).toContain("Default System Microphone");
    expect(mvSettingsSource).toContain("refreshAudioMics");
    expect(mvSettingsSource).toContain("Scanning...");
    expect(mvSettingsSource).toContain("Rescan");
  });
});

describe("MVSettings Production, Appearance, and System Tabs", () => {
  it("includes OBS Studio WebSocket connection controls and test action", () => {
    expect(mvSettingsSource).toContain("OBS Studio WebSocket");
    expect(mvSettingsSource).toContain("handleTestObs");
    expect(mvSettingsSource).toContain("obsStatus === \"connected\"");
    expect(mvSettingsSource).toContain("mvSettings.obs.autoReconnectFallback");
    expect(mvSettingsSource).toContain("settings.obsAutoReconnect");
    expect(mvSettingsSource).toContain("Force Reconnect");
    expect(mvSettingsSource).toContain("View Logs");
  });

  it("includes Scripture & Bible controls with themes and formatting", () => {
    expect(mvSettingsSource).toContain("bDefaultTranslation");
    expect(mvSettingsSource).toContain("bDefaultThemeId");
    expect(mvSettingsSource).toContain("Maximum Lines Per Slide");
    expect(mvSettingsSource).toContain("bShowVerseNumbers");
    expect(mvSettingsSource).toContain("Auto-send on Double Click");
    expect(mvSettingsSource).toContain("handleSaveBible");
  });

  it("includes General preferences and desktop update manager", () => {
    expect(mvSettingsSource).toContain("interfaceLanguage");
    expect(mvSettingsSource).toContain("handleCheckForUpdates");
    expect(mvSettingsSource).toContain("handleInstallUpdate");
    expect(mvSettingsSource).toContain("handleResetSettings");
  });

  it("includes Church & Branding sync and lower-third duration settings", () => {
    expect(mvSettingsSource).toContain("Lower-Third Display Duration");
    expect(mvSettingsSource).toContain("applyLowerThirdDefaultDuration");
    expect(mvSettingsSource).toContain("defaultBibleOverlayMode");
    expect(mvSettingsSource).toContain("Stream Ticker Crawl Speed");
    expect(mvSettingsSource).toContain("runSync");
  });

  it("includes Appearance customization with theme modes and layout densities", () => {
    expect(mvSettingsSource).toContain("APP_APPEARANCE_PALETTES");
    expect(mvSettingsSource).toContain("Custom accent");
    expect(mvSettingsSource).toContain("density-comfortable");
    expect(mvSettingsSource).toContain("density-balanced");
    expect(mvSettingsSource).toContain("density-compact");
    expect(mvSettingsSource).toContain("highContrastUI");
    expect(mvSettingsSource).toContain("reduceMotion");
    expect(mvSettingsSource).toContain("roundedCorners");
  });

  it("includes Mobile Companion remote server and pairing actions", () => {
    expect(mvSettingsSource).toContain("mobileRemoteEnabled");
    expect(mvSettingsSource).toContain("mobileServerStatus");
    expect(mvSettingsSource).toContain("mobilePairingQrDataUrl");
    expect(mvSettingsSource).toContain("mobileWebUrl");
    expect(mvSettingsSource).toContain("mobileApprovedDevices");
    expect(mvSettingsSource).toContain("mobileDeviceRequests");
    expect(mvSettingsSource).toContain("mobilePermissions");
  });

  it("includes Plan & AI Credits overview and Data Storage management", () => {
    // Usage tab
    expect(mvSettingsSource).toContain("AccountSummaryCards");
    expect(mvSettingsSource).toContain("creditsRemaining");
    expect(mvSettingsSource).toContain("recentTransactions");
    expect(mvSettingsSource).toContain("LocalDevPlanSwitcher");

    // Storage tab
    expect(mvSettingsSource).toContain("CloudSyncSettingsCard");
    expect(mvSettingsSource).toContain("handleResetChurchOnboarding");
    expect(mvSettingsSource).toContain("handleClearWorship");
    expect(mvSettingsSource).toContain("handleClear");
  });
});
