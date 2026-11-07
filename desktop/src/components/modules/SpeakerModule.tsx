import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LT_THEMES, LT_ALL_THEMES } from "../../lowerthirds/themes";
import type { LowerThirdTheme, LTVariable, LTPosition, LTSize, LTFontSize, LTAnimationIn, LTCustomStyle, LTDurationConfig, LTExitStyle } from "../../lowerthirds/types";
import {
  LT_DEFAULT_CUSTOM_STYLE,
  LT_DURATION_CHIPS,
  LT_EXIT_STYLES,
  LT_EXIT_STYLE_LABELS,
} from "../../lowerthirds/types";
import { lowerThirdObsService, buildOverlayUrl } from "../../lowerthirds/lowerThirdObsService";
import { useLowerThird } from "../../lowerthirds/lowerThirdStore";
import { obsService } from "../../services/obsService";
import { getDisplaySceneName } from "../../services/obsSceneTargets";
import { serviceStore } from "../../services/serviceStore";
import { useServiceGate } from "../../hooks/useServiceGate";
import { ObsScenesPanel } from "../shared/ObsScenesPanel";
import { ltDurationStore } from "../../lowerthirds/ltDurationStore";
import { getSettings, updateSettings, MV_SETTINGS_UPDATED_EVENT, type MVSettings, type SpeakerProfileSetting } from "../../multiview/mvStore";
import { applyRuntimeBranding, isLogoVariable } from "../../lowerthirds/runtimeBranding";
import { isSpeakerTheme } from "../../lowerthirds/speakerThemeUtils";
import { getMinistryData, buildSpeakerRoleMap } from "../../services/ministryStore";
import "../../lowerthirds/lowerthirds.css";
import "./speaker-module.css";
import Icon from "../Icon";
import { getUserScopedKey } from "../../services/userScopedStorage";
import { getRecommendedPollingInterval } from "../../services/performanceManager";

interface SpeakerPreset {
  id: string;
  label: string;
  name: string;
  title: string;
  ministry: string;
  /** A short tag shown on the theme, e.g. "Speaker", "Ministry", "Live from London" */
  titleLabel: string;
}

const SPEAKER_PRESETS_STORAGE_KEY = "service-hub.speaker.presets";
const SPEAKER_THEME_ORDER_STORAGE_KEY = "service-hub.speaker.theme-order";

const SPEAKER_THEME_IDS = new Set(
  LT_ALL_THEMES
    .filter((theme): theme is LowerThirdTheme => Boolean(theme))
    .filter((theme) => isSpeakerTheme(theme))
    .map((theme) => theme.id),
);

/** Map each theme ID to its preview image in /lower_thirds_images/ */
const THEME_IMAGE_MAP: Record<string, string> = {
  "lt-01-scripture-bold": "/lower_thirds_images/scripture_bold.png",
  "lt-02-prayer-declaration": "/lower_thirds_images/prayer_declaration.png",
  "lt-03-speaker-identity": "/lower_thirds_images/speaker_identity.png",
  "lt-04-worship-lyrics": "/lower_thirds_images/worship_lyrics.png",
  "lt-07-minimal-floating-bar": "/lower_thirds_images/mininial_floating_bar.png",
  "lt-08-grunge-scripture": "/lower_thirds_images/grunge_scripture.png",
  "lt-11-social-follow": "/lower_thirds_images/social_follow.png",
  "lt-12-breaking-news": "/lower_thirds_images/breaking_news_ticker.png",
  "lt-15-elegant-quote": "/lower_thirds_images/elegant_quote.png",
  "lt-19-verse-modern": "/lower_thirds_images/modern_verse.png",
  "lt-26-remote-guest": "/lower_thirds_images/pastor_daniel_two.png",
  "lt-27-social-grid-item": "/lower_thirds_images/social_grid_item.png",
  "lt-32-broadcast-news": "/lower_thirds_images/broadcast_news.png",
  "lt-31-information-bar": "/lower_thirds_images/visit_our_website.png",
  "lt-16-corporate-name": "/lower_thirds_images/pastor_daniel_carter.png",
};

function getConfiguredSpeakerProfiles(settings: ReturnType<typeof getSettings>): SpeakerProfileSetting[] {
  const structured = Array.isArray(settings.pastorSpeakers)
    ? settings.pastorSpeakers
      .map((profile) => ({
        name: String(profile?.name || "").trim(),
        role: String(profile?.role || "").trim(),
        imageUrl: String(profile?.imageUrl || "").trim(),
        isMain: profile?.isMain,
      }))
      .filter((profile) => profile.name.length > 0)
    : [];

  if (structured.length > 0) return structured;

  return settings.pastorNames
    .split(/\r?\n|,/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name, role: "" }));
}

function buildDefaultSpeakerPresets(): SpeakerPreset[] {
  const ministry = getMinistryData();
  const churchName = ministry.churchName.trim() || "Your Church Example";
  const parsedSpeakers = ministry.speakers.length > 0
    ? ministry.speakers.map((s) => ({ name: s.name.trim(), role: (s.role || "").trim() }))
    : getConfiguredSpeakerProfiles(getSettings());

  if (parsedSpeakers.length === 0) {
    return [
      {
        id: "lead-pastor",
        label: "Lead Pastor",
        name: "Your Pastor's Name",
        title: `Lead Pastor, ${churchName}`,
        ministry: churchName,
        titleLabel: "Speaker",
      },
    ];
  }

  // Sort: main pastor first
  const sorted = [...parsedSpeakers].sort((a, b) => {
    const aIsMain = a.name.trim().toLowerCase() === ministry.mainPastorName.toLowerCase();
    const bIsMain = b.name.trim().toLowerCase() === ministry.mainPastorName.toLowerCase();
    if (aIsMain && !bIsMain) return -1;
    if (!aIsMain && bIsMain) return 1;
    return 0;
  });

  return sorted.map((speaker, index) => {
    const role = speaker.role.trim() || (index === 0 ? "Lead Pastor" : "Pastor");
    const label = role.length <= 30 ? role : `Speaker ${index + 1}`;
    return {
      id: `lead-pastor-${index + 1}`,
      label,
      name: speaker.name,
      title: `${role}, ${churchName}`,
      ministry: churchName,
      titleLabel: role,
    };
  });
}

/**
 * Sync a speaker preset back to the centralized mv-settings.pastorSpeakers list.
 * Adds the speaker if they don't already exist (matched by name, case-insensitive).
 * This ensures speakers added in the Service Hub are visible in Settings and the Dock.
 */
function syncSpeakerToSettings(name: string, role: string): void {
  const settings = getSettings();
  const existing = Array.isArray(settings.pastorSpeakers) ? settings.pastorSpeakers : [];
  const key = name.trim().toLowerCase();
  if (!key) return;

  const alreadyExists = existing.some(
    (sp) => sp.name.trim().toLowerCase() === key
  );
  if (alreadyExists) return;

  const updated = [...existing, { name: name.trim(), role: role.trim() }];
  updateSettings({
    pastorSpeakers: updated,
    pastorNames: updated.map((sp) => sp.name).join("\n"),
  });
}

/**
 * Remove a speaker from the centralized mv-settings.pastorSpeakers list.
 * Matched by name (case-insensitive).
 */
function removeSpeakerFromSettings(name: string): void {
  const settings = getSettings();
  const existing = Array.isArray(settings.pastorSpeakers) ? settings.pastorSpeakers : [];
  const key = name.trim().toLowerCase();
  if (!key) return;

  const updated = existing.filter((sp) => sp.name.trim().toLowerCase() !== key);
  if (updated.length !== existing.length) {
    updateSettings({
      pastorSpeakers: updated,
      pastorNames: updated.map((sp) => sp.name).join("\n"),
    });
  }
}

const PREVIEW_VERSE_TEXT =
  "Therefore, holy brethren, partakers of the heavenly calling, consider the Apostle and High Priest of our confession.";

type SpeakerPosition = "left" | "center" | "right";

const DEFAULT_THEME_ID =
  LT_ALL_THEMES.find((theme) => theme.id === "lt-03-speaker-identity")?.id ??
  LT_THEMES[0]?.id ??
  "";

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function sanitizePreset(candidate: unknown): SpeakerPreset | null {
  if (!candidate || typeof candidate !== "object") return null;
  const maybe = candidate as Partial<Record<string, unknown>>;
  const id = typeof maybe.id === "string" ? maybe.id.trim() : "";
  const label = typeof maybe.label === "string" ? maybe.label.trim() : "";
  const name = typeof maybe.name === "string" ? maybe.name.trim() : "";
  const title = typeof maybe.title === "string" ? maybe.title.trim() : "";
  const ministry = typeof maybe.ministry === "string" ? maybe.ministry.trim() : "";
  // Support legacy "ministryText" or new "titleLabel"
  const titleLabel = typeof maybe.titleLabel === "string" ? maybe.titleLabel.trim()
    : typeof maybe.ministryText === "string" ? (maybe.ministryText as string).trim()
      : "";
  if (!id || !label || !name) return null;
  return { id, label, name, title, ministry, titleLabel };
}

function loadStoredPresets(): SpeakerPreset[] {
  const fallback = buildDefaultSpeakerPresets();
  try {
    const stored = parseJson<unknown[]>(localStorage.getItem(getUserScopedKey(SPEAKER_PRESETS_STORAGE_KEY)));
    if (!Array.isArray(stored)) return fallback;

    const seen = new Set<string>();
    const presets = stored
      .map(sanitizePreset)
      .filter((preset): preset is SpeakerPreset => Boolean(preset))
      .filter((preset) => {
        if (seen.has(preset.id)) return false;
        seen.add(preset.id);
        return true;
      });

    const settings = getSettings();
    const hasConfiguredSpeakers = getConfiguredSpeakerProfiles(settings).length > 0;
    if (
      hasConfiguredSpeakers &&
      presets.length === 1 &&
      presets[0].id.startsWith("lead-pastor") &&
      presets[0].name.toLowerCase() === "pastor daniel carter"
    ) {
      return buildDefaultSpeakerPresets();
    }

    return presets.length > 0 ? presets : fallback;
  } catch {
    return fallback;
  }
}

function normalizeThemeOrder(storedOrder: string[] | null): string[] {
  const validIds = LT_THEMES.map((theme) => theme.id).filter((id) => SPEAKER_THEME_IDS.has(id));
  const validSet = new Set(validIds);
  const seen = new Set<string>();
  const normalized: string[] = [];

  if (storedOrder) {
    for (const id of storedOrder) {
      if (!validSet.has(id) || seen.has(id)) continue;
      normalized.push(id);
      seen.add(id);
    }
  }

  for (const id of validIds) {
    if (seen.has(id)) continue;
    normalized.push(id);
  }

  return normalized;
}

function loadStoredThemeOrder(): string[] {
  try {
    const stored = parseJson<unknown[]>(localStorage.getItem(getUserScopedKey(SPEAKER_THEME_ORDER_STORAGE_KEY)));
    if (!Array.isArray(stored)) return normalizeThemeOrder(null);
    return normalizeThemeOrder(stored.filter((value): value is string => typeof value === "string"));
  } catch {
    return normalizeThemeOrder(null);
  }
}

function createPresetId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function derivePresetLabel(name: string): string {
  const cleaned = name.trim().replace(/\s+/g, " ");
  if (!cleaned) return "Custom Speaker";
  const words = cleaned.split(" ");
  if (words.length === 1) return words[0];
  return `${words[0]} ${words[words.length - 1]}`.slice(0, 28);
}

function buildPreviewValue(
  variable: LTVariable,
  speakerName: string,
  speakerTitle: string,
  ministryVal: string,
  titleLabelVal: string,
  brandLogoUrl: string,
  roleMap?: Map<string, string>,
): string {
  const key = variable.key.toLowerCase();
  const label = variable.label.toLowerCase();
  const hint = `${key} ${label}`;

  // Auto-resolve role from ministry store if speaker name matches a known speaker
  let resolvedTitle = speakerTitle;
  if (!resolvedTitle && speakerName && roleMap) {
    const lookup = roleMap.get(speakerName.trim().toLowerCase());
    if (lookup) resolvedTitle = lookup;
  }

  // ── Exact key mappings for specific themes ──

  // Remote Guest: location → titleLabel, name → speakerName, title → role + ministry
  if (key === "location") {
    return titleLabelVal || variable.defaultValue || "Speaker";
  }

  if (isLogoVariable(variable)) {
    return brandLogoUrl || variable.defaultValue || "";
  }

  // Broadcast News: logo → titleLabel, headline → speakerName, website → role + ministry
  if (key === "logo") {
    return titleLabelVal || variable.defaultValue || "Speaker";
  }
  if (key === "headline") {
    return speakerName || variable.defaultValue || "Speaker Name";
  }
  if (key === "website") {
    const combined = [resolvedTitle, ministryVal].filter(Boolean).join(" · ");
    return combined || variable.defaultValue || "";
  }

  // Breaking News: badge → titleLabel
  if (key === "badge") {
    return titleLabelVal || variable.defaultValue || "Speaker";
  }

  // Information Bar: tagline → speakerName, mainText → role + ministry
  if (key === "tagline") {
    return speakerName || variable.defaultValue || "Speaker Name";
  }
  if (key === "maintext") {
    const combined = [resolvedTitle, ministryVal].filter(Boolean).join(" · ");
    return combined || variable.defaultValue || "";
  }

  // Elegant Quote: quote → speakerName used as main text, author → role + ministry
  if (key === "quote") {
    return speakerName || variable.defaultValue || "Speaker Name";
  }
  if (key === "author") {
    const combined = [resolvedTitle, ministryVal].filter(Boolean).join(", ");
    return combined || variable.defaultValue || "";
  }

  // ── Hint-based mappings ──

  if (hint.includes("speaker") || hint.includes("pastor") || hint.includes("name")) {
    return speakerName || variable.defaultValue || "Speaker Name";
  }
  if (
    hint.includes("title") ||
    hint.includes("role") ||
    hint.includes("sub-heading") ||
    hint.includes("subtitle")
  ) {
    // For themes that use "title" as role+ministry combined (e.g. Remote Guest)
    if (key === "title") {
      const combined = [resolvedTitle, ministryVal].filter(Boolean).join(", ");
      return combined || variable.defaultValue || "Guest Minister";
    }
    return resolvedTitle || variable.defaultValue || "Guest Minister";
  }
  if (hint.includes("ministry") || hint.includes("church") || hint.includes("organization")) {
    return ministryVal || variable.defaultValue || "Your Church Example";
  }
  if (hint.includes("label")) {
    return titleLabelVal || variable.defaultValue || "Speaker";
  }
  if (hint.includes("verse") && hint.includes("text")) {
    return PREVIEW_VERSE_TEXT;
  }
  if (hint.includes("reference")) {
    return "Hebrews 3:1 (NKJV)";
  }
  if (hint.includes("line1")) return speakerName || "Your Pastor's Name";
  if (hint.includes("line2")) return resolvedTitle || "Lead Pastor";
  if (hint.includes("announcement") || hint.includes("event")) return titleLabelVal || "Sunday Service - 9:00 AM";

  if (variable.type === "toggle") {
    if (variable.defaultValue === "false") return "false";
    return "true";
  }

  if (variable.type === "select") {
    return variable.defaultValue || variable.options?.[0]?.value || "";
  }

  return variable.defaultValue || "";
}

function buildThemePreviewValues(
  theme: LowerThirdTheme,
  speakerName: string,
  speakerTitle: string,
  ministryVal: string,
  titleLabelVal: string,
  brandLogoUrl: string,
): Record<string, string> {
  const roleMap = buildSpeakerRoleMap();
  const values: Record<string, string> = {};
  for (const variable of theme.variables) {
    values[variable.key] = buildPreviewValue(
      variable,
      speakerName,
      speakerTitle,
      ministryVal,
      titleLabelVal,
      brandLogoUrl,
      roleMap,
    );
  }
  return values;
}

function substituteVariables(html: string, values: Record<string, string>): string {
  return html.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match;
  });
}

function escapeStyle(styleText: string): string {
  return styleText.replace(/<\/style/gi, "<\\/style");
}

function buildThemePreviewDoc(
  theme: LowerThirdTheme,
  speakerName: string,
  speakerTitle: string,
  ministryVal: string,
  titleLabelVal: string,
  brandingSettings: Pick<MVSettings, "brandColor" | "brandLogoPath">,
  options?: {
    variant?: "card" | "monitor";
    showOverlay?: boolean;
    position?: SpeakerPosition;
  },
): string {
  const runtimeBranding = applyRuntimeBranding(theme, {}, brandingSettings);
  const runtimeTheme = runtimeBranding.theme;
  const variant = options?.variant ?? "card";
  const showOverlay = options?.showOverlay ?? true;
  const position = options?.position ?? "center";
  const values = buildThemePreviewValues(
    runtimeTheme,
    speakerName,
    speakerTitle,
    ministryVal,
    titleLabelVal,
    runtimeBranding.logoUrl,
  );
  const renderedHtml = showOverlay ? substituteVariables(runtimeTheme.html || "", values).split("{{state}}").join("in") : "";
  const themeCss = escapeStyle(runtimeTheme.css || "");
  const positionTargetX =
    position === "left" ? 0.28 : position === "right" ? 0.72 : 0.5;

  const cardOrMonitorZoom = variant === "card" ? 2.8 : 2.15;
  const cardOrMonitorFocusY = variant === "card" ? 755 : 735;
  const cardOrMonitorTargetY = variant === "card" ? 0.72 : 0.74;
  const stageBackground =
    variant === "card"
      ? `radial-gradient(circle at 14% 14%, rgba(255,255,255,0.08), transparent 45%),
        linear-gradient(145deg, #17233b 0%, #0d1a33 60%, #0a1324 100%)`
      : `linear-gradient(145deg, #111827 0%, #0b1529 58%, #07101f 100%)`;
  const standbyMarkup = showOverlay
    ? ""
    : `<div id="preview-standby">Standby</div>`;
  const standbyStyle = variant === "monitor"
    ? `
    #preview-standby {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: rgba(255,255,255,0.7);
      background: rgba(0, 0, 0, 0.35);
      pointer-events: none;
    }
    `
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <style>
    @font-face {
      font-family: 'Inter';
      font-style: normal;
      font-weight: 100 900;
      src: local('Inter'), local('Inter-Regular'), local('-apple-system'), local('BlinkMacSystemFont');
    }
  </style>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: transparent;
      font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    }
    body { position: relative; }
    #preview-root {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: ${stageBackground};
    }
    #preview-stage {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 1080px;
      transform-origin: top left;
      pointer-events: none;
    }
    ${standbyStyle}
    ${themeCss}
  </style>
</head>
<body>
  <div id="preview-root">
    <div id="preview-stage">${renderedHtml}</div>
    ${standbyMarkup}
  </div>
  <script>
    (function() {
      var stage = document.getElementById("preview-stage");
      if (!stage) return;
      function fit() {
        var w = window.innerWidth || 320;
        var h = window.innerHeight || 180;
        var fitScale = Math.min(w / 1920, h / 1080);
        var zoom = ${cardOrMonitorZoom};
        var scale = Math.max(fitScale * zoom, 0.05);
        var focusX = 960;
        var focusY = ${cardOrMonitorFocusY};
        var targetX = w * ${positionTargetX};
        var targetY = h * ${cardOrMonitorTargetY};
        stage.style.left = "0px";
        stage.style.top = "-228.92px";
        stage.style.transform = "scale(" + scale + ")";
      }
      fit();
      window.addEventListener("resize", fit);
    })();
  </script>
</body>
</html>`;
}

export interface SpeakerModuleProps {
  isActive?: boolean;
  /** Deep-link: auto-select this preset when set */
  initialSelectPresetId?: string | null;
  /** Called after the deep-link selection has been consumed */
  onConsumeInitialSelect?: () => void;
}

export function SpeakerModule({
  isActive = true,
  initialSelectPresetId,
  onConsumeInitialSelect,
}: SpeakerModuleProps) {
  const [obsConnected, setObsConnected] = useState(obsService.status === "connected");
  const [programScene, setProgramScene] = useState("");
  const [speakerPresets, setSpeakerPresets] = useState<SpeakerPreset[]>(() => loadStoredPresets());
  const [selectedPresetId, setSelectedPresetId] = useState<string>(() => loadStoredPresets()[0]?.id ?? "");
  const [themeOrder, setThemeOrder] = useState<string[]>(() => loadStoredThemeOrder());
  const [themeId, setThemeId] = useState<string>(DEFAULT_THEME_ID);
  const [speakerName, setSpeakerName] = useState<string>(() => loadStoredPresets()[0]?.name ?? "");
  const [speakerTitle, setSpeakerTitle] = useState<string>(() => loadStoredPresets()[0]?.title ?? "");
  const [ministry, setMinistry] = useState<string>(() => loadStoredPresets()[0]?.ministry ?? "");
  const [titleLabel, setTitleLabel] = useState<string>(() => loadStoredPresets()[0]?.titleLabel ?? "");
  const [sentToPreview, setSentToPreview] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [speakerVisible, setSpeakerVisible] = useState(true);
  const [themeDropdownOpen, setThemeDropdownOpen] = useState(false);
  const [showAddPresetModal, setShowAddPresetModal] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [newPresetTitle, setNewPresetTitle] = useState("");
  const [newPresetMinistry, setNewPresetMinistry] = useState("");
  const [newPresetTitleLabel, setNewPresetTitleLabel] = useState("");
  const [presetError, setPresetError] = useState("");
  const [urlCopied, setUrlCopied] = useState(false);
  const [mvSettings, setMvSettings] = useState<MVSettings>(() => getSettings());

  useEffect(() => {
    const onSettingsUpdated = (event: Event) => {
      const custom = event as CustomEvent<MVSettings>;
      setMvSettings(custom.detail ?? getSettings());
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === "mv-settings") {
        setMvSettings(getSettings());
      }
    };
    window.addEventListener(MV_SETTINGS_UPDATED_EVENT, onSettingsUpdated as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(MV_SETTINGS_UPDATED_EVENT, onSettingsUpdated as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Service gate (no-op — service gate concept removed)
  const { checkServiceActive } = useServiceGate();

  // ── Duration store state (subscribe to singleton) ──
  const [spkDurationActive, setSpkDurationActive] = useState(() => ltDurationStore.activeState);
  const [spkDurationConfig, setSpkDurationConfig] = useState<LTDurationConfig>(() =>
    ltDurationStore.getConfigForLT(`speaker-${selectedPresetId || "current"}`, "speaker"),
  );

  // Subscribe to ltDurationStore changes
  useEffect(() => {
    const unsub = ltDurationStore.subscribe(() => {
      setSpkDurationActive(ltDurationStore.activeState);
    });
    return unsub;
  }, []);

  // Update duration config when preset changes
  useEffect(() => {
    setSpkDurationConfig(ltDurationStore.getConfigForLT(`speaker-${selectedPresetId || "current"}`, "speaker"));
  }, [selectedPresetId]);

  // Duration config handlers (don't depend on `lt`)
  const handleSpkDurationChange = useCallback((seconds: number) => {
    const newConfig: LTDurationConfig = { ...spkDurationConfig, durationSeconds: seconds, useDefaults: false, isPinned: seconds === 0 };
    setSpkDurationConfig(newConfig);
    ltDurationStore.setConfigForLT(`speaker-${selectedPresetId || "current"}`, newConfig);
  }, [spkDurationConfig, selectedPresetId]);

  const handleSpkExitStyleChange = useCallback((style: LTExitStyle) => {
    const newConfig: LTDurationConfig = { ...spkDurationConfig, exitStyle: style, useDefaults: false };
    setSpkDurationConfig(newConfig);
    ltDurationStore.setConfigForLT(`speaker-${selectedPresetId || "current"}`, newConfig);
  }, [spkDurationConfig, selectedPresetId]);

  const handleSpkUseDefaultsToggle = useCallback(() => {
    const newConfig: LTDurationConfig = { ...spkDurationConfig, useDefaults: !spkDurationConfig.useDefaults };
    if (newConfig.useDefaults) {
      const defaults = ltDurationStore.getConfigForLT(`speaker-${selectedPresetId || "current"}`, "speaker");
      newConfig.durationSeconds = defaults.durationSeconds;
      newConfig.triggerMode = defaults.triggerMode;
      newConfig.exitStyle = defaults.exitStyle;
    }
    setSpkDurationConfig(newConfig);
    ltDurationStore.setConfigForLT(`speaker-${selectedPresetId || "current"}`, newConfig);
  }, [spkDurationConfig, selectedPresetId]);

  const handleSpkPinToggle = useCallback(() => {
    if (spkDurationActive.activeLowerThirdId) {
      ltDurationStore.togglePin();
    }
  }, [spkDurationActive.activeLowerThirdId]);

  // Access the lower-third store so we can sync theme + values
  const lt = useLowerThird();

  // Register auto-clear callback (depends on `lt`)
  useEffect(() => {
    ltDurationStore.setAutoClearCallback(async () => {
      try {
        await lowerThirdObsService.blankAll();
        setIsLive(false);
        setSentToPreview(false);
        lt.dispatch({ type: "SET_LIVE", live: false });
      } catch (err) {
        console.warn("[Speaker] Auto-clear failed:", err);
      }
    });
  }, [lt]);

  const handleSpkNowShowingClear = useCallback(async () => {
    try {
      await lowerThirdObsService.blankAll();
      ltDurationStore.clear();
      setIsLive(false);
      setSentToPreview(false);
      lt.dispatch({ type: "SET_LIVE", live: false });
    } catch (err) {
      console.warn("[Speaker] Now Showing clear failed:", err);
    }
  }, [lt]);

  // ── Theme variable values (actual content sent to OBS) ──
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});

  // ── Customization state ──
  const [ltSize, setLtSize] = useState<LTSize>("xl");
  const [ltFontSize, setLtFontSize] = useState<LTFontSize>("lg");
  const [ltPosition, setLtPosition] = useState<LTPosition>("bottom-left");
  const [ltAnimationIn, setLtAnimationIn] = useState<LTAnimationIn>("slide-left");
  const [displaySettingsOpen, setDisplaySettingsOpen] = useState(false);
  const customStyles = useMemo<LTCustomStyle>(
    () => ({ ...LT_DEFAULT_CUSTOM_STYLE, accentColor: mvSettings.brandColor || LT_DEFAULT_CUSTOM_STYLE.accentColor }),
    [mvSettings.brandColor],
  );

  const themeMap = useMemo(() => {
    const map = new Map<string, LowerThirdTheme>();
    for (const theme of LT_ALL_THEMES) {
      map.set(theme.id, theme);
    }
    return map;
  }, []);

  const orderedThemes = useMemo(() => {
    const themes: LowerThirdTheme[] = [];
    const seen = new Set<string>();
    for (const id of themeOrder) {
      const theme = themeMap.get(id);
      if (!theme || !isSpeakerTheme(theme)) continue;
      if (seen.has(theme.id)) continue;
      seen.add(theme.id);
      themes.push(theme);
    }
    for (const theme of LT_THEMES) {
      if (!isSpeakerTheme(theme)) continue;
      if (seen.has(theme.id)) continue;
      seen.add(theme.id);
      themes.push(theme);
    }
    return themes;
  }, [themeMap, themeOrder]);

  const selectedTheme = useMemo<LowerThirdTheme | null>(
    () => themeMap.get(themeId) ?? orderedThemes[0] ?? null,
    [orderedThemes, themeId, themeMap],
  );
  const activeBranding = useMemo(
    () => (selectedTheme ? applyRuntimeBranding(selectedTheme, {}, mvSettings) : null),
    [mvSettings, selectedTheme],
  );

  const previewMonitorDoc = useMemo(() => {
    if (!selectedTheme) return null;
    // Map ltPosition back to the simple position for the preview doc
    const pos: SpeakerPosition =
      ltPosition.includes("left") ? "left" : ltPosition.includes("right") ? "right" : "center";
    return buildThemePreviewDoc(selectedTheme, speakerName, speakerTitle, ministry, titleLabel, mvSettings, {
      variant: "monitor",
      showOverlay: true,
      position: pos,
    });
  }, [ltPosition, ministry, mvSettings, selectedTheme, speakerName, speakerTitle, titleLabel]);

  useEffect(() => {
    const unsubscribe = obsService.onStatusChange((status) => {
      setObsConnected(status === "connected");
      // Refresh OBS scenes when connection status changes
      if (status === "connected") {
        lt.refreshScenes();
      } else {
        setProgramScene("");
      }
    });
    // Initial scene refresh if already connected
    if (obsService.isConnected) {
      lt.refreshScenes();
    }
    return unsubscribe;
  }, []);

  // Auto-refresh OBS scenes every 500ms so deleted/added scenes stay in sync.
  useEffect(() => {
    if (!isActive) return;

    const poll = async () => {
      if (!obsService.isConnected) {
        setProgramScene("");
        return;
      }
      await lt.refreshScenes();
      try {
        setProgramScene(getDisplaySceneName(await obsService.getCurrentProgramScene()));
      } catch {
        setProgramScene("");
      }
    };
    void poll();
    const iv = setInterval(() => { void poll(); }, getRecommendedPollingInterval(3000));
    return () => clearInterval(iv);
  }, [lt, isActive]);

  useEffect(() => {
    try {
      localStorage.setItem(getUserScopedKey(SPEAKER_PRESETS_STORAGE_KEY), JSON.stringify(speakerPresets));
    } catch {
      // ignore
    }
  }, [speakerPresets]);

  useEffect(() => {
    try {
      localStorage.setItem(getUserScopedKey(SPEAKER_THEME_ORDER_STORAGE_KEY), JSON.stringify(themeOrder));
    } catch {
      // ignore
    }
  }, [themeOrder]);

  useEffect(() => {
    if (speakerPresets.length === 0) return;
    const presetExists = speakerPresets.some((preset) => preset.id === selectedPresetId);
    if (presetExists) return;
    setSelectedPresetId(speakerPresets[0].id);
  }, [selectedPresetId, speakerPresets]);

  // Deep-link: select a specific preset when triggered from global search
  useEffect(() => {
    if (initialSelectPresetId) {
      setSelectedPresetId(initialSelectPresetId);
      onConsumeInitialSelect?.();
    }
  }, [initialSelectPresetId, onConsumeInitialSelect]);

  // Load fields from the selected preset when the user clicks a different preset
  const speakerPresetsRef = useRef(speakerPresets);
  speakerPresetsRef.current = speakerPresets;

  useEffect(() => {
    const selectedPreset = speakerPresetsRef.current.find((preset) => preset.id === selectedPresetId);
    if (!selectedPreset) return;
    setSpeakerName(selectedPreset.name);
    setSpeakerTitle(selectedPreset.title);
    setMinistry(selectedPreset.ministry);
    setTitleLabel(selectedPreset.titleLabel);
    // Only depend on selectedPresetId — NOT on speakerPresets — to avoid
    // a render loop with the "sync back" effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPresetId]);

  // Sync edited fields back into the selected Quick Select preset
  useEffect(() => {
    if (!selectedPresetId) return;
    setSpeakerPresets((prev) => {
      const idx = prev.findIndex((p) => p.id === selectedPresetId);
      if (idx === -1) return prev;
      const current = prev[idx];
      // Only update if something actually changed
      if (
        current.name === speakerName &&
        current.title === speakerTitle &&
        current.ministry === ministry &&
        current.titleLabel === titleLabel
      ) {
        return prev;
      }
      const updated = [...prev];
      updated[idx] = {
        ...current,
        name: speakerName,
        title: speakerTitle,
        ministry,
        titleLabel,
        label: derivePresetLabel(speakerName),
      };
      return updated;
    });
  }, [speakerName, speakerTitle, ministry, titleLabel, selectedPresetId]);

  // When theme or speaker name/title change, rebuild variable values
  // Smart-fill: map speaker name + title into the correct variable keys
  useEffect(() => {
    if (!selectedTheme) return;
    const vals: Record<string, string> = {};
    for (const v of selectedTheme.variables) {
      // If user has already edited this key, keep the user value
      if (variableValues[v.key] !== undefined && variableValues[v.key] !== "") {
        vals[v.key] = variableValues[v.key];
      } else {
        vals[v.key] = buildPreviewValue(
          v,
          speakerName,
          speakerTitle,
          ministry,
          titleLabel,
          activeBranding?.logoUrl || "",
        );
      }
    }
    setVariableValues(vals);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranding?.logoUrl, selectedTheme?.id]);

  // When speaker name/title/ministry change, re-fill the mapped variable fields
  useEffect(() => {
    if (!selectedTheme) return;
    setVariableValues((prev) => {
      const next = { ...prev };
      for (const v of selectedTheme.variables) {
        next[v.key] = buildPreviewValue(
          v,
          speakerName,
          speakerTitle,
          ministry,
          titleLabel,
          activeBranding?.logoUrl || "",
        );
      }
      return next;
    });
  }, [activeBranding?.logoUrl, ministry, selectedTheme, speakerName, speakerTitle, titleLabel]);

  // Auto-push settings changes to OBS when already sent to preview/live
  useEffect(() => {
    if (!selectedTheme || !sentToPreview) return;
    // Debounce slightly to avoid rapid pushes
    const timer = setTimeout(async () => {
      try {
        const mainScene = serviceStore.sceneMapping.mainScene;
        if (mainScene) {
          await lowerThirdObsService.pushToScene(
            mainScene,
            selectedTheme,
            variableValues,
            true,
            false,
            ltSize,
            customStyles,
            ltFontSize,
            ltPosition,
            undefined,
            undefined,
            ltAnimationIn,
            spkDurationConfig.exitStyle,
          );
        } else {
          await lowerThirdObsService.pushToAll(
            selectedTheme,
            variableValues,
            true,
            false,
            ltSize,
            customStyles,
            ltFontSize,
            ltPosition,
            undefined,
            undefined,
            ltAnimationIn,
            spkDurationConfig.exitStyle,
          );
        }
      } catch (err) {
        console.warn("[Speaker] Auto-push failed:", err);
      }
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ltPosition, ltAnimationIn, ltSize, ltFontSize, customStyles, variableValues]);

  useEffect(() => {
    if (!selectedTheme && orderedThemes.length > 0) {
      setThemeId(orderedThemes[0].id);
      return;
    }
    if (selectedTheme && selectedTheme.id !== themeId) {
      setThemeId(selectedTheme.id);
    }
  }, [orderedThemes, selectedTheme, themeId]);

  const promoteThemeToFront = (targetThemeId: string) => {
    setThemeOrder((prev) => {
      const normalized = normalizeThemeOrder(prev);
      return [targetThemeId, ...normalized.filter((id) => id !== targetThemeId)];
    });
  };

  const handleThemeSelect = (nextThemeId: string) => {
    setThemeId(nextThemeId);
    setThemeDropdownOpen(false);
    promoteThemeToFront(nextThemeId);
  };

  const handleOpenAddPreset = () => {
    setNewPresetName(speakerName.trim());
    setNewPresetTitle(speakerTitle.trim());
    setNewPresetMinistry(ministry.trim());
    setNewPresetTitleLabel(titleLabel.trim());
    setPresetError("");
    setShowAddPresetModal(true);
  };

  const handleSaveNewPreset = () => {
    const name = newPresetName.trim();
    const title = newPresetTitle.trim();
    const label = derivePresetLabel(name).slice(0, 40);

    if (!name) {
      setPresetError("Speaker name is required.");
      return;
    }

    const preset: SpeakerPreset = {
      id: createPresetId(),
      label: label || "Custom Speaker",
      name,
      title,
      ministry: newPresetMinistry.trim(),
      titleLabel: newPresetTitleLabel.trim(),
    };

    setSpeakerPresets((prev) => [preset, ...prev]);
    setSelectedPresetId(preset.id);
    setShowAddPresetModal(false);
    setPresetError("");
    syncSpeakerToSettings(name, newPresetTitleLabel.trim() || title);
  };

  // Toggle speaker output visibility (slide out / slide in)
  const handleToggleVisibility = useCallback(async () => {
    if (speakerVisible) {
      // Turning OFF — clear OBS output
      try {
        await lowerThirdObsService.clearAll();
        setIsLive(false);
        setSentToPreview(false);
        lt.dispatch({ type: "SET_LIVE", live: false });
      } catch (err) {
        console.warn("[Speaker] Failed to clear on hide:", err);
      }
      setSpeakerVisible(false);
    } else {
      // Turning ON — re-push the current speaker overlay to OBS
      setSpeakerVisible(true);
      if (selectedTheme) {
        try {
          const mainScene = serviceStore.sceneMapping.mainScene;
          if (mainScene) {
            await lowerThirdObsService.pushToScene(
              mainScene,
              selectedTheme,
              variableValues,
              true,
              false,
              ltSize,
              customStyles,
              ltFontSize,
              ltPosition,
              undefined,
              undefined,
              ltAnimationIn,
              spkDurationConfig.exitStyle,
            );
          } else {
            await lowerThirdObsService.pushToAll(
              selectedTheme,
              variableValues,
              true,
              false,
              ltSize,
              customStyles,
              ltFontSize,
              ltPosition,
              undefined,
              undefined,
              ltAnimationIn,
              spkDurationConfig.exitStyle,
            );
          }
          setSentToPreview(true);
        } catch (err) {
          console.warn("[Speaker] Failed to push on show:", err);
        }
      }
    }
  }, [speakerVisible, lt, selectedTheme, variableValues, ltSize, ltFontSize, ltPosition, ltAnimationIn, customStyles, spkDurationConfig.exitStyle]);

  const handleCopyUrl = useCallback(() => {
    if (!selectedTheme) return;
    const url = buildOverlayUrl(
      selectedTheme,
      variableValues,
      true,
      false,
      ltSize,
      customStyles,
      ltFontSize,
      ltPosition,
      undefined,
      undefined,
      ltAnimationIn,
    );
    navigator.clipboard.writeText(url).then(() => {
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 2000);
    }).catch((err) => {
      console.warn("[Speaker] Failed to copy URL:", err);
    });
  }, [selectedTheme, variableValues, ltSize, ltFontSize, ltPosition, ltAnimationIn, customStyles]);

  // ── Send speaker overlay to a specific OBS scene ──
  const [scenesRefreshing, setScenesRefreshing] = useState(false);
  const handleRefreshScenes = useCallback(async () => {
    setScenesRefreshing(true);
    try {
      await lt.refreshScenes();
    } finally {
      setScenesRefreshing(false);
    }
  }, [lt]);

  const handleSendToScene = useCallback(async (
    sceneName: string,
    mode: "scene" | "preview" | "program" = "scene",
  ) => {
    if (!selectedTheme || isSending) return;
    if (!checkServiceActive("send speaker info to OBS")) return;
    setIsSending(true);
    try {
      // Sync the lower-third store
      lt.selectTheme(selectedTheme.id);
      lt.setValues(variableValues);
      lt.setSize(ltSize);
      lt.setFontSize(ltFontSize);
      lt.setPosition(ltPosition);
      lt.setAnimationIn(ltAnimationIn);
      lt.setCustomStyle(customStyles);

      await lowerThirdObsService.pushToScene(
        sceneName,
        selectedTheme,
        variableValues,
        true,
        false,
        ltSize,
        customStyles,
        ltFontSize,
        ltPosition,
        undefined,
        undefined,
        ltAnimationIn,
        spkDurationConfig.exitStyle,
      );

      setSentToPreview(true);
      const shouldBeLive = mode === "program" || sceneName === programScene;
      setIsLive(shouldBeLive);
      lt.dispatch({ type: "SET_LIVE", live: shouldBeLive });

      if (shouldBeLive) {
        const currentPreset = speakerPresets.find((p) => p.id === selectedPresetId);
        ltDurationStore.show({
          ltId: `speaker-${selectedPresetId || "current"}`,
          label: currentPreset?.label || speakerName || selectedTheme.name,
          subtitle: speakerTitle || speakerName,
          themeId: selectedTheme.id,
          values: { ...variableValues },
          ltType: "speaker",
          config: spkDurationConfig,
        });
      }
    } catch (err) {
      console.warn(`[Speaker] Failed to send to scene "${sceneName}":`, err);
    } finally {
      setIsSending(false);
    }
  }, [
    selectedTheme,
    isSending,
    variableValues,
    ltSize,
    ltFontSize,
    ltPosition,
    ltAnimationIn,
    customStyles,
    lt,
    checkServiceActive,
    programScene,
    speakerPresets,
    selectedPresetId,
    speakerName,
    speakerTitle,
    spkDurationConfig,
  ]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isActive) return;
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "c" || e.key === "C")) {
        e.preventDefault();
        handleCopyUrl();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="speaker-module" data-active={isActive ? "true" : "false"}>
      {/* ── LEFT SIDEBAR: Quick Select Presets ── */}
      <aside className="speaker-module-sidebar">
        <div className="speaker-module-sidebar-head">
          <span className="speaker-module-sidebar-title">Quick Select</span>
          <button type="button" className="speaker-module-mini-btn" onClick={handleOpenAddPreset} title="Add">
            <Icon name="add" size={14} />
          </button>
        </div>
        <div className="speaker-module-sidebar-list">
          {speakerPresets.map((preset) => {
            const selected = preset.id === selectedPresetId;
            return (
              <div
                key={preset.id}
                className={`speaker-module-sidebar-preset${selected ? " is-selected" : ""}`}
                onClick={() => setSelectedPresetId(preset.id)}
              >
                <div className="speaker-module-sidebar-preset-info">
                  <span className="speaker-module-sidebar-preset-name">{preset.label}</span>
                  <span className="speaker-module-sidebar-preset-sub">{preset.name}</span>
                </div>
                <button
                  type="button"
                  className="speaker-module-preset-delete"
                  title="Delete preset"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSpeakerFromSettings(preset.name);
                    setSpeakerPresets((prev) => prev.filter((p) => p.id !== preset.id));
                  }}
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      {/* ── CENTER COLUMN: Preview + Content ── */}
      <main className="speaker-module-main">
        {/* ── PREVIEW BAR (top of center column) ── */}
        <div className="speaker-module-preview-bar">
          <div className="speaker-module-preview-frame">
            {previewMonitorDoc && (
              <iframe
                className="speaker-monitor-frame-iframe"
                srcDoc={previewMonitorDoc}
                title="Speaker Preview Monitor"
              />
            )}
          </div>
        </div>

        {/* ── CENTER BODY: Content + Theme + Duration ── */}
        <div className="speaker-module-body">
          <div className="speaker-module-col speaker-module-col--center">
            {/* ── Now Showing Strip ── */}
            {spkDurationActive.activeLowerThirdId && (
              <div className="lt-now-showing">
                <div className="lt-now-showing-left">
                  <div className={`lt-now-showing-badge${spkDurationActive.isVisible ? " lt-now-showing-badge--live" : ""}`}>
                    {spkDurationActive.isVisible ? "LIVE" : "HIDDEN"}
                  </div>
                  <div className="lt-now-showing-info">
                    <span className="lt-now-showing-label">{spkDurationActive.activeLabel}</span>
                    <span className="lt-now-showing-sub">{spkDurationActive.activeSubtitle}</span>
                  </div>
                </div>
                <div className="lt-now-showing-center">
                  {spkDurationActive.triggerMode === "timed" && !spkDurationActive.isPinned && spkDurationActive.totalDuration > 0 && (
                    <>
                      <div className="lt-now-showing-timer">
                        {spkDurationActive.remainingSeconds}s
                      </div>
                      <div className="lt-now-showing-progress">
                        <div
                          className="lt-now-showing-progress-bar"
                          style={{
                            width: `${spkDurationActive.totalDuration > 0 ? ((spkDurationActive.totalDuration - spkDurationActive.remainingSeconds) / spkDurationActive.totalDuration) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </>
                  )}
                  {spkDurationActive.isPinned && (
                    <span className="lt-now-showing-pinned">
                      <Icon name="push_pin" size={13} />
                      Pinned
                    </span>
                  )}
                  {spkDurationActive.triggerMode === "manual" && !spkDurationActive.isPinned && (
                    <span className="lt-now-showing-pinned">Manual</span>
                  )}
                  {spkDurationActive.triggerMode === "untilNext" && !spkDurationActive.isPinned && (
                    <span className="lt-now-showing-pinned">Until Next</span>
                  )}
                  {spkDurationActive.triggerMode === "untilSceneChange" && !spkDurationActive.isPinned && (
                    <span className="lt-now-showing-pinned">Until Scene Change</span>
                  )}
                </div>
                <div className="lt-now-showing-actions">
                  <button
                    className="lt-now-showing-btn"
                    onClick={handleSpkPinToggle}
                    title={spkDurationActive.isPinned ? "Unpin" : "Pin (stay until manually cleared)"}
                  >
                    <Icon name={spkDurationActive.isPinned ? "lock_open" : "push_pin"} size={14} />
                  </button>
                  <button
                    className="lt-now-showing-btn lt-now-showing-btn--clear"
                    onClick={handleSpkNowShowingClear}
                    title="Clear Now"
                  >
                    <Icon name="clear" size={14} />
                    Clear
                  </button>
                </div>
              </div>
            )}

            <div className="lt-page-form speaker-module-form-shell">
              <div className="lt-page-form-grid">
                <div className="lt-page-form-main">
                  <div className="lt-page-form-header">
                    <h4>
                      <Icon name="edit" size={16} style={{ color: "#C8102E" }} />
                      Edit Content
                    </h4>
                    <button
                      type="button"
                      className="lt-page-form-reset"
                      onClick={() => {
                        setSpeakerName("");
                        setSpeakerTitle("");
                        setMinistry("");
                        setTitleLabel("");
                      }}
                      title="Reset">
                      <Icon name="restart_alt" size={12} />
                      Reset
                    </button>
                  </div>

                  <div className="speaker-module-field-grid">
                    <div className="lt-page-form-field">
                      <label className="lt-page-form-label">Pastor Name</label>
                      <input
                        type="text"
                        className="lt-page-form-input"
                        value={speakerName}
                        onChange={(e) => setSpeakerName(e.target.value)}
                        placeholder="e.g. John Smith"
                      />
                    </div>
                    <div className="lt-page-form-field">
                      <label className="lt-page-form-label">Role</label>
                      <input
                        type="text"
                        className="lt-page-form-input"
                        value={speakerTitle}
                        onChange={(e) => setSpeakerTitle(e.target.value)}
                        placeholder="e.g. Senior Pastor"
                      />
                    </div>
                    <div className="lt-page-form-field">
                      <label className="lt-page-form-label">Ministry</label>
                      <input
                        type="text"
                        className="lt-page-form-input"
                        value={ministry}
                        onChange={(e) => setMinistry(e.target.value)}
                        placeholder="e.g. Your Church Example"
                      />
                    </div>
                    <div className="lt-page-form-field">
                      <label className="lt-page-form-label">Title</label>
                      <input
                        type="text"
                        className="lt-page-form-input"
                        value={titleLabel}
                        onChange={(e) => setTitleLabel(e.target.value)}
                        placeholder="e.g. Speaker, Ministry, Live from Lagos"
                      />
                    </div>
                  </div>
                </div>

                <div className="lt-page-form-side">
                  <div className="lt-page-theme-panel">
                    <div className="lt-page-theme-head">
                      <label className="lt-page-form-label" style={{ marginBottom: 0 }}>
                        Graphic Theme
                      </label>
                      <span className="lt-page-theme-meta">{orderedThemes.length} speaker templates</span>
                    </div>

                    <div
                      className="lt-page-theme-selector"
                      onClick={() => setThemeDropdownOpen((open) => !open)}
                    >
                      <div
                        className="lt-page-theme-preview-thumb"
                        style={{ background: `linear-gradient(135deg, ${selectedTheme?.accentColor || "#4ADE80"} 0%, #111827 100%)` }}
                      >
                        {selectedTheme && THEME_IMAGE_MAP[selectedTheme.id] ? (
                          <img
                            className="speaker-module-theme-thumb-img"
                            src={THEME_IMAGE_MAP[selectedTheme.id]}
                            alt={`${selectedTheme.name} preview`}
                            loading="lazy"
                            draggable={false}
                          />
                        ) : (
                          <Icon name={selectedTheme?.icon ?? "style"} size={20} />
                        )}
                      </div>
                      <span className="lt-page-theme-name">{selectedTheme?.name ?? "Theme"}</span>
                      <Icon name={themeDropdownOpen ? "arrow_drop_up" : "arrow_drop_down"} size={20} />
                    </div>

                    {themeDropdownOpen && (
                      <div className="lt-page-theme-dropdown">
                        {orderedThemes.map((theme) => {
                          const selected = theme.id === themeId;
                          const imgSrc = THEME_IMAGE_MAP[theme.id];
                          return (
                            <button
                              key={theme.id}
                              type="button"
                              className={`lt-page-theme-option${selected ? " active" : ""}`}
                              onClick={() => handleThemeSelect(theme.id)}
                            >
                              <div
                                className="lt-page-theme-option-thumb"
                                style={{ background: `linear-gradient(135deg, ${theme.accentColor || "#4ADE80"} 0%, #111827 100%)` }}
                              >
                                {imgSrc ? (
                                  <img
                                    className="speaker-module-theme-thumb-img"
                                    src={imgSrc}
                                    alt={`${theme.name} option preview`}
                                    loading="lazy"
                                    draggable={false}
                                  />
                                ) : (
                                  <Icon name={theme.icon} size={20} />
                                )}
                              </div>
                              <div className="lt-page-theme-option-info">
                                <span className="lt-page-theme-option-name">{theme.name}</span>
                                <span className="lt-page-theme-option-desc">{theme.description}</span>
                              </div>
                              {selected && (
                                <Icon name="check" size={20} className="lt-page-theme-check" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="lt-duration-section">
                    <div className="lt-duration-header">
                      <h4>
                        <Icon name="timer" size={14} />
                        Duration &amp; Auto-Clear
                      </h4>
                      <label className="lt-duration-defaults-toggle">
                        <input
                          type="checkbox"
                          checked={spkDurationConfig.useDefaults}
                          onChange={handleSpkUseDefaultsToggle}
                        />
                        <span>Use Defaults</span>
                      </label>
                    </div>

                    <div className="lt-duration-row">
                      <label className="lt-duration-label">Duration</label>
                      <div className="lt-duration-chips">
                        {LT_DURATION_CHIPS.map((s) => (
                          <button
                            key={s}
                            className={`lt-duration-chip${spkDurationConfig.durationSeconds === s && !spkDurationConfig.isPinned ? " lt-duration-chip--active" : ""}`}
                            onClick={() => handleSpkDurationChange(s)}
                            disabled={spkDurationConfig.useDefaults}
                            title={`${s}s`}
                          >
                            {s}s
                          </button>
                        ))}
                        <button
                          className={`lt-duration-chip lt-duration-chip--pin${spkDurationConfig.isPinned ? " lt-duration-chip--active" : ""}`}
                          onClick={() => handleSpkDurationChange(0)}
                          disabled={spkDurationConfig.useDefaults}
                          title="Pin (infinite duration)"
                        >
                          <Icon name="all_inclusive" size={13} />
                        </button>
                        <input
                          type="number"
                          className="lt-duration-input"
                          value={spkDurationConfig.isPinned ? "" : spkDurationConfig.durationSeconds}
                          onChange={(e) => handleSpkDurationChange(Math.max(1, parseInt(e.target.value) || 1))}
                          disabled={spkDurationConfig.useDefaults || spkDurationConfig.isPinned}
                          min={1}
                          max={300}
                          placeholder="∞"
                          title="Custom duration in seconds"
                        />
                      </div>
                    </div>

                    <div className="lt-duration-row">
                      <label className="lt-duration-label">Exit</label>
                      <select
                        className="lt-duration-select"
                        value={spkDurationConfig.exitStyle}
                        onChange={(e) => handleSpkExitStyleChange(e.target.value as LTExitStyle)}
                        disabled={spkDurationConfig.useDefaults}
                      >
                        {LT_EXIT_STYLES.map((s) => (
                          <option key={s} value={s}>{LT_EXIT_STYLE_LABELS[s]}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* ── Display Settings ── */}
                  <div className="lt-duration-section" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="lt-duration-header"
                      style={{ background: "none", border: "none", cursor: "pointer", width: "100%", display: "flex", alignItems: "center", gap: 6, padding: 0, color: "inherit" }}
                      onClick={() => setDisplaySettingsOpen(!displaySettingsOpen)}
                      title="Settings">
                      <Icon name="tune" size={14} />
                      <h4 style={{ margin: 0, flex: 1, textAlign: "left" }}>Display Settings</h4>
                      <Icon name={displaySettingsOpen ? "expand_less" : "expand_more"} size={16} />
                    </button>
                    {displaySettingsOpen && (
                      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                        <div className="lt-duration-row">
                          <label className="lt-duration-label">Size</label>
                          <div className="lt-duration-chips">
                            {(["s", "m", "l", "xl", "2xl", "3xl"] as LTSize[]).map((size) => (
                              <button
                                key={size}
                                className={`lt-duration-chip${ltSize === size ? " lt-duration-chip--active" : ""}`}
                                onClick={() => setLtSize(size)}
                                title={`Size ${size.toUpperCase()}`}
                              >
                                {size.toUpperCase()}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="lt-duration-row">
                          <label className="lt-duration-label">Font</label>
                          <div className="lt-duration-chips">
                            {(["xs", "s", "m", "l", "xl", "2xl", "3xl"] as LTFontSize[]).map((fs) => (
                              <button
                                key={fs}
                                className={`lt-duration-chip${ltFontSize === fs ? " lt-duration-chip--active" : ""}`}
                                onClick={() => setLtFontSize(fs)}
                                title={`Font size ${fs.toUpperCase()}`}
                              >
                                {fs.toUpperCase()}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="lt-duration-row">
                          <label className="lt-duration-label">Position</label>
                          <select
                            className="lt-duration-select"
                            value={ltPosition}
                            onChange={(e) => setLtPosition(e.target.value as LTPosition)}
                          >
                            <option value="bottom-left">Bottom Left</option>
                            <option value="bottom-center">Bottom Center</option>
                            <option value="bottom-right">Bottom Right</option>
                            <option value="top-left">Top Left</option>
                            <option value="top-center">Top Center</option>
                            <option value="top-right">Top Right</option>
                          </select>
                        </div>
                        <div className="lt-duration-row">
                          <label className="lt-duration-label">Animation</label>
                          <select
                            className="lt-duration-select"
                            value={ltAnimationIn}
                            onChange={(e) => setLtAnimationIn(e.target.value as LTAnimationIn)}
                          >
                            <option value="slide-left">Slide Left</option>
                            <option value="slide-right">Slide Right</option>
                            <option value="slide-up">Slide Up</option>
                            <option value="slide-down">Slide Down</option>
                            <option value="fade-in">Fade</option>
                            <option value="zoom-in">Zoom</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* ── RIGHT SIDEBAR: Push to OBS ── */}
      <aside className="speaker-module-sidebar-right">
        <div className="speaker-module-sidebar-right-head">
          <h4>Push to OBS</h4>
          <p>Send this speaker lower-third to OBS.</p>
        </div>
        <div className="speaker-module-sidebar-right-scroll">
          {/* ── Broadcast Status ── */}
          <div className="speaker-module-block speaker-module-broadcast-status">
            <div className="speaker-module-broadcast-status__header">
              <span className="speaker-module-block-title">Status</span>
              <span className={`speaker-module-status-badge speaker-module-status-badge--${isLive ? "on-air" : sentToPreview ? "in-preview" : "off-air"}`}>
                {isLive ? "ON AIR" : sentToPreview ? "IN PREVIEW" : "OFF AIR"}
              </span>
            </div>
            <button
              type="button"
              className={`speaker-module-btn speaker-module-btn--visibility ${speakerVisible ? "is-visible" : "is-hidden"}`}
              onClick={handleToggleVisibility}
              disabled={!selectedTheme || isSending || !obsConnected}
              title="visibility_off">
              <Icon name={speakerVisible ? "visibility" : "visibility_off"} size={15} />
              {speakerVisible ? "Hide" : "Show"}
            </button>
          </div>

          {/* ── OBS Scenes — list all real scenes from OBS ── */}
          <div className="speaker-module-block">
            <ObsScenesPanel
              title="OBS Scenes"
              contentLabel="speaker lower-third"
              description="Preview to check, then push to Program."
              connected={obsConnected}
              scenes={lt.state.obsScenes}
              mainScene={serviceStore.sceneMapping.mainScene}
              activeScene={programScene}
              activeScenes={isLive && serviceStore.sceneMapping.mainScene ? [serviceStore.sceneMapping.mainScene] : []}
              refreshing={scenesRefreshing}
              disabled={!selectedTheme || isSending}
              sendLabel="Send Speaker"
              onRefresh={handleRefreshScenes}
              onSendToScene={async (sceneName, mode) => {
                await handleSendToScene(sceneName, mode);
              }}
            />
          </div>

          {/* OBS Connection + Copy URL */}
          <div className="speaker-module-block">
            <div className="speaker-module-obs-row">
              <span className={`speaker-module-obs-dot${obsConnected ? " is-on" : ""}`} />
              <span style={{ fontSize: 11 }}>{obsConnected ? "Connected to OBS Studio" : "OBS disconnected"}</span>
            </div>
            <button
              type="button"
              className={`speaker-module-copy-url-btn${urlCopied ? " is-copied" : ""}`}
              onClick={handleCopyUrl}
              disabled={!selectedTheme}
              title="Copy the browser source overlay URL to clipboard (⌘⇧C)"
              style={{ marginTop: 6 }}
            >
              <Icon name={urlCopied ? "check" : "content_copy"} size={20} />
              <span>{urlCopied ? "Copied!" : "Copy Overlay URL"}</span>
              <kbd style={{
                marginLeft: "auto",
                padding: "1px 5px",
                background: "var(--surface-raised)",
                border: "1px solid var(--border)",
                borderRadius: 3,
                fontSize: 9,
                fontWeight: 700,
                color: "var(--text-muted)",
                lineHeight: 1.4,
                fontFamily: "inherit",
              }}>⌘⇧C</kbd>
            </button>
          </div>
        </div>
      </aside>

      {showAddPresetModal && (
        <div className="speaker-module-modal-backdrop" onClick={() => setShowAddPresetModal(false)}>
          <div
            className="speaker-module-modal speaker-module-modal--preset"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="speaker-module-modal-head">
              <h3>Add New Speaker</h3>
              <button
                type="button"
                className="speaker-module-modal-close"
                onClick={() => setShowAddPresetModal(false)}
                aria-label="Close add preset"
                title="Close">
                <Icon name="close" size={20} />
              </button>
            </div>

            <div className="speaker-module-modal-body">
              <label className="speaker-module-field">
                <span>Pastor Name</span>
                <input
                  type="text"
                  value={newPresetName}
                  onChange={(event) => setNewPresetName(event.target.value)}
                  placeholder="e.g. John Smith"
                />
              </label>
              <label className="speaker-module-field">
                <span>Role</span>
                <input
                  type="text"
                  value={newPresetTitle}
                  onChange={(event) => setNewPresetTitle(event.target.value)}
                  placeholder="e.g. Senior Pastor"
                />
              </label>
              <label className="speaker-module-field">
                <span>Ministry</span>
                <input
                  type="text"
                  value={newPresetMinistry}
                  onChange={(event) => setNewPresetMinistry(event.target.value)}
                  placeholder="e.g. Your Church Example"
                />
              </label>
              <label className="speaker-module-field">
                <span>Title</span>
                <input
                  type="text"
                  value={newPresetTitleLabel}
                  onChange={(event) => setNewPresetTitleLabel(event.target.value)}
                  placeholder="e.g. Speaker, Ministry"
                />
              </label>

              {presetError && <p className="speaker-module-modal-error">{presetError}</p>}
            </div>

            <div className="speaker-module-modal-foot">
              <button type="button" className="speaker-module-btn" onClick={() => setShowAddPresetModal(false)} title="Cancel">
                Cancel
              </button>
              <button type="button" className="speaker-module-btn live" onClick={handleSaveNewPreset} title="Save">
                Save Preset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
