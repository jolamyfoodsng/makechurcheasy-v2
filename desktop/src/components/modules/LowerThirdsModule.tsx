/**
 * LowerThirdsPage.tsx — Full-page Lower Third editor
 *
 * Layout: 3-column
 *   Left sidebar  -> Quick Select presets (saved theme + content combos)
 *   Center        -> Preview monitor + Edit Content
 *   Right sidebar -> OBS connection card, send controls, scene list, shortcuts
 */

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useLowerThird } from "../../lowerthirds/lowerThirdStore";
import {
  LT_THEMES,
  LT_ALL_THEMES,
  getLTThemeById,
} from "../../lowerthirds/themes";
import type { LowerThirdTheme, LTVariable, LTDurationConfig, LTExitStyle } from "../../lowerthirds/types";
import {
  LT_PRESET_CATEGORIES,
  getPresetCategory,
  getThemesForCategory,
  mapCategoryFieldsToThemeValues,
  mapThemeValuesToCategoryFields,
} from "../../lowerthirds/ltPresetCategories";
import type { LTPresetCategoryId } from "../../lowerthirds/ltPresetCategories";
import {
  LT_SIZE_WIDTH,
  LT_SIZE_FONT_SCALE,
  LT_FONT_SIZE_SCALE,
  LT_DEFAULT_CUSTOM_STYLE,
  LT_DURATION_CHIPS,
  LT_EXIT_STYLES,
  LT_EXIT_STYLE_LABELS,
} from "../../lowerthirds/types";
import type { LTSize, LTFontSize, LTPosition, LTAnimationIn, LTCustomStyle } from "../../lowerthirds/types";
import { getInAppPreviewBaseUrlSync } from "../../services/overlayUrl";
import { buildOverlayUrl } from "../../lowerthirds/lowerThirdObsService";
import { obsService } from "../../services/obsService";
import { getDisplaySceneName } from "../../services/obsSceneTargets";
import { serviceStore } from "../../services/serviceStore";
import { getSettings, MV_SETTINGS_UPDATED_EVENT, type MVSettings } from "../../multiview/mvStore";
import { applyRuntimeBranding, isLogoVariable } from "../../lowerthirds/runtimeBranding";
import {
  REMOTE_PRODUCTION_THEMES_UPDATED_EVENT,
  fetchRemoteProductionThemes,
  getCachedRemoteProductionThemes,
  mergeRemoteLowerThirdThemes,
  type RemoteProductionTheme,
} from "../../services/remoteProductionThemes";
import { useServiceGate } from "../../hooks/useServiceGate";
import { ObsScenesPanel } from "../shared/ObsScenesPanel";
import { ltDurationStore } from "../../lowerthirds/ltDurationStore";
import { ltVersionHistory } from "../../lowerthirds/ltVersionHistory";
import type { LTVersionSnapshot, LTVersionGroup } from "../../lowerthirds/ltVersionHistory";
import "../../lowerthirds/lowerthirds.css";
import Icon from "../Icon";
import { getUserScopedKey } from "../../services/userScopedStorage";
import { getRecommendedPollingInterval } from "../../services/performanceManager";

// ---------------------------------------------------------------------------
// LT Preset types + persistence
// ---------------------------------------------------------------------------

interface LTPreset {
  id: string;
  label: string;
  themeId: string;
  values: Record<string, string>;
  /** Preset category — determines dynamic fields & filtered themes */
  categoryId?: LTPresetCategoryId;
  /** Category-level field values (mapped to theme vars on theme change) */
  categoryValues?: Record<string, string>;
  /** Selected social platforms (for follow-us category) */
  selectedPlatforms?: string[];
}

const LT_PRESETS_STORAGE_KEY = "service-hub.lt.presets";

function isHexColor(value: string | null | undefined): value is string {
  return /^#[0-9a-fA-F]{6}$/.test((value ?? "").trim());
}

function createLTPresetId(): string {
  return `lt-preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function loadLTPresets(): LTPreset[] {
  const fallback: LTPreset[] = [
    {
      id: "default-announcement",
      label: "Announcement",
      themeId: LT_THEMES[0]?.id ?? "",
      values: {},
    },
  ];
  try {
    const raw = localStorage.getItem(getUserScopedKey(LT_PRESETS_STORAGE_KEY));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed) || parsed.length === 0) return fallback;
    const presets = parsed.filter(
      (p): p is LTPreset =>
        !!p && typeof p === "object" &&
        typeof (p as Record<string, unknown>).id === "string" &&
        typeof (p as Record<string, unknown>).label === "string" &&
        typeof (p as Record<string, unknown>).themeId === "string",
    );
    return presets.length > 0 ? presets : fallback;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 10) return "just now";
  if (diff < 60) return diff + "s ago";
  const mins = Math.floor(diff / 60);
  if (mins < 60) return mins + "m ago";
  const hrs = Math.floor(mins / 60);
  return hrs + "h ago";
}

function toStartCase(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isInternalThemeVariable(v: LTVariable): boolean {
  const key = v.key.toLowerCase();
  return key === "state" || key === "animmode";
}

function isInternalGivingVariable(v: LTVariable): boolean {
  return isInternalThemeVariable(v);
}

function getGivingVariableType(v: LTVariable): "bank" | "qr" | "link" | "common" {
  const text = `${v.key} ${v.label}`.toLowerCase();
  if (text.includes("qr")) return "qr";
  if (
    text.includes("bank") ||
    text.includes("account") ||
    text.includes("acc") ||
    text.includes("sort code") ||
    text.includes("routing")
  ) {
    return "bank";
  }
  if (text.includes("url") || text.includes("link") || text.includes("website") || text.includes("site")) {
    return "link";
  }
  return "common";
}

const QR_IMAGE_UPLOAD_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".bmp"] as const;
const QR_IMAGE_UPLOAD_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml", "image/bmp"] as const;
const QR_IMAGE_UPLOAD_ACCEPT = [...QR_IMAGE_UPLOAD_MIME_TYPES, ...QR_IMAGE_UPLOAD_EXTENSIONS].join(",");

function hasAllowedQrImageExtension(filename: string): boolean {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = filename.slice(dot).toLowerCase();
  return QR_IMAGE_UPLOAD_EXTENSIONS.includes(ext as (typeof QR_IMAGE_UPLOAD_EXTENSIONS)[number]);
}

// ---------------------------------------------------------------------------
// Toast Component
// ---------------------------------------------------------------------------

function Toast({
  msg,
  type,
  onDone,
}: {
  msg: string;
  type: "success" | "error";
  onDone: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className={"lt-toast lt-toast--" + type}>
      <Icon name={type === "success" ? "check_circle" : "error"} size={16} />
      {msg}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OBS Connection Status Card
// ---------------------------------------------------------------------------

// @ts-ignore – kept for future re-use
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _OBSConnectionCard() {
  const [status, setStatus] = useState(obsService.status);
  const [sourceCount, setSrcCount] = useState(0);
  const { state } = useLowerThird();

  useEffect(() => {
    const unsub = obsService.onStatusChange((s) => setStatus(s));
    setStatus(obsService.status);
    return unsub;
  }, []);

  useEffect(() => {
    setSrcCount(state.obsSources.length);
  }, [state.obsSources]);

  const connected = status === "connected";

  return (
    <div className={"lt-obs-card" + (connected ? " lt-obs-card--connected" : "")}>
      <div className="lt-obs-card-dot" />
      <div className="lt-obs-card-info">
        <span className="lt-obs-card-label">
          {connected ? "Broadcast Connected" : "Broadcast Disconnected"}
        </span>
        {connected && (
          <span className="lt-obs-card-meta">
            {sourceCount} LT source{sourceCount !== 1 ? "s" : ""} found
          </span>
        )}
      </div>
      <Icon name={connected ? "cast_connected" : "cast"} size={20} className="lt-obs-card-icon" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live Preview URL Builder
// ---------------------------------------------------------------------------

function usePreviewUrl(
  theme: LowerThirdTheme | null,
  values: Record<string, string>,
  size: LTSize,
  fontSize: LTFontSize,
  position: LTPosition,
  customX: number,
  customY: number,
  animationIn: LTAnimationIn,
  customStyles: LTCustomStyle,
  brandingSettings: Pick<MVSettings, "brandColor" | "brandLogoPath">,
): string {
  return useMemo(() => {
    if (!theme) return "";
    const runtimeBranding = applyRuntimeBranding(theme, values, brandingSettings);
    const runtimeTheme = runtimeBranding.theme;
    const runtimeValues = runtimeBranding.values;
    const widthPct = LT_SIZE_WIDTH[size] ?? 65;
    const fontScale = LT_SIZE_FONT_SCALE[size] ?? 1;
    const fontSizeScale = LT_FONT_SIZE_SCALE[fontSize] ?? 1;
    const payload: Record<string, unknown> = {
      themeId: runtimeTheme.id,
      html: runtimeTheme.html,
      css: runtimeTheme.css,
      values: runtimeValues,
      live: true,
      blanked: false,
      size,
      scale: 1,
      widthPct,
      fontScale,
      fontSizeScale,
      position,
      customX,
      customY,
      animationIn,
      timestamp: Date.now(),
    };
    // Include dynamic font imports (e.g. Font Awesome for social loops)
    if (runtimeTheme.fontImports && runtimeTheme.fontImports.length > 0) {
      payload.fontImports = runtimeTheme.fontImports;
    }
    if (customStyles.bgColor) payload.bgColor = customStyles.bgColor;
    if (customStyles.textColor) payload.textColor = customStyles.textColor;
    payload.accentColor = customStyles.accentColor || runtimeBranding.brandColor;
    if (customStyles.bgImage) {
      payload.bgImage = customStyles.bgImage;
      payload.bgImageOpacity = customStyles.bgImageOpacity ?? 0.3;
    }
    if (customStyles.heightPx > 0) payload.heightPx = customStyles.heightPx;
    if (customStyles.logoScale > 0) payload.logoScale = customStyles.logoScale;
    const encoded = encodeURIComponent(JSON.stringify(payload));
    // In-app preview iframe: this computer's address (the Wi-Fi one shows a white box in the app).
    return getInAppPreviewBaseUrlSync() + "/lower-third-overlay.html#data=" + encoded;
  }, [theme, values, size, fontSize, position, customX, customY, animationIn, customStyles, brandingSettings]);
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

/** List variable input — renders items as a list with add/remove controls.
 *  The stored value is the items joined by separator for template rendering. */
function ListVariableInput({
  value,
  onChange,
  placeholder,
  separator,
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder: string;
  separator: string;
}) {
  // Parse items from joined string
  const items = value ? value.split(separator).map((s) => s.trim()).filter(Boolean) : [];
  const [draft, setDraft] = useState("");

  const addItem = () => {
    const text = draft.trim();
    if (!text) return;
    const next = [...items, text];
    onChange(next.join(separator));
    setDraft("");
  };

  const removeItem = (idx: number) => {
    const next = items.filter((_, i) => i !== idx);
    onChange(next.join(separator));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addItem();
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {/* Existing items */}
      {items.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 140, overflowY: "auto" }}>
          {items.map((item, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "var(--surface-raised)",
                borderRadius: 4,
                padding: "4px 8px",
                fontSize: 12,
              }}
            >
              <span style={{ flex: 1, color: "var(--text-secondary)" }}>{item}</span>
              <button
                onClick={() => removeItem(i)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 2,
                  display: "flex",
                  color: "var(--text-disabled)",
                }}
                title="Remove item"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      {/* Add new item */}
      <div style={{ display: "flex", gap: 4 }}>
        <input
          type="text"
          className="lt-page-form-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          style={{ flex: 1 }}
        />
        <button
          className="lt-page-btn lt-page-btn--secondary"
          style={{ width: "auto", padding: "4px 8px", fontSize: 10 }}
          onClick={addItem}
          disabled={!draft.trim()}
          title="Add">
          Add
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export interface LowerThirdsModuleProps {
  isActive?: boolean;
}

export function LowerThirdsModule({ isActive = true }: LowerThirdsModuleProps) {
  const {
    state,
    dispatch,
    selectTheme,
    setValue,
    setValues,
    setCustomPos,
    setCustomStyle,
    resetValues,
    sendToAll,
    sendToScene,
    blankAll,
    clearAll,
    refreshSources,
    refreshScenes,
  } = useLowerThird();

  // ── Quick Select preset state ──
  const [ltPresets, setLtPresets] = useState<LTPreset[]>(() => loadLTPresets());
  const [selectedPresetId, setSelectedPresetId] = useState<string>(() => loadLTPresets()[0]?.id ?? "");
  const [newPresetLabel, setNewPresetLabel] = useState("");
  const [presetError, setPresetError] = useState("");
  /** Preset picker — shown when user clicks "+" */
  const [showPresetPicker, setShowPresetPicker] = useState(false);

  // ── Theme picker dropdown ──
  const [themeDropdownOpen, setThemeDropdownOpen] = useState(false);
  const [remoteProductionThemes, setRemoteProductionThemes] = useState<RemoteProductionTheme[]>(() => getCachedRemoteProductionThemes());
  const availableLtThemes = useMemo(
    () => mergeRemoteLowerThirdThemes(LT_ALL_THEMES, remoteProductionThemes),
    [remoteProductionThemes],
  );
  const findAvailableLtTheme = useCallback(
    (themeId: string) => availableLtThemes.find((theme) => theme.id === themeId) ?? getLTThemeById(themeId),
    [availableLtThemes],
  );
  const selectAvailableLtTheme = useCallback(
    (themeId: string) => {
      const theme = findAvailableLtTheme(themeId);
      if (theme) {
        dispatch({ type: "SELECT_THEME", theme });
      }
      return theme;
    },
    [dispatch, findAvailableLtTheme],
  );

  // ── Version History ──
  const [showVersionPanel, setShowVersionPanel] = useState(false);
  const [versionGroups, setVersionGroups] = useState<LTVersionGroup[]>([]);
  const [previewingSnapshotId, setPreviewingSnapshotId] = useState<string | null>(null);

  // Local UI state
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_lastUpdatedStr, setLastUpdatedStr] = useState<string | null>(null);
  const [urlCopied, setUrlCopied] = useState(false);
  const [programScene, setProgramScene] = useState("");
  const previewRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const [previewScale, setPreviewScale] = useState(0.3);
  const [brandingSettings, setBrandingSettings] = useState<MVSettings>(() => getSettings());
  const churchBrandColorOptions = useMemo(
    () => [
      { label: "Church Primary", value: brandingSettings.brandColor },
      { label: "Church Secondary", value: brandingSettings.brandSecondaryColor },
      { label: "Church Accent", value: brandingSettings.brandAccentColor },
    ].filter((option): option is { label: string; value: string } => isHexColor(option.value)),
    [brandingSettings.brandAccentColor, brandingSettings.brandColor, brandingSettings.brandSecondaryColor],
  );

  // Keep module-level branding defaults in sync with Settings page updates.
  useEffect(() => {
    const onSettingsUpdated = (event: Event) => {
      const custom = event as CustomEvent<MVSettings>;
      setBrandingSettings(custom.detail ?? getSettings());
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === "mv-settings") {
        setBrandingSettings(getSettings());
      }
    };
    window.addEventListener(MV_SETTINGS_UPDATED_EVENT, onSettingsUpdated as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(MV_SETTINGS_UPDATED_EVENT, onSettingsUpdated as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    const syncCachedRemoteThemes = () => setRemoteProductionThemes(getCachedRemoteProductionThemes());
    syncCachedRemoteThemes();
    void fetchRemoteProductionThemes().then(setRemoteProductionThemes);
    window.addEventListener(REMOTE_PRODUCTION_THEMES_UPDATED_EVENT, syncCachedRemoteThemes);
    return () => window.removeEventListener(REMOTE_PRODUCTION_THEMES_UPDATED_EVENT, syncCachedRemoteThemes);
  }, []);

  // Service gate (no-op — service gate concept removed)
  const { checkServiceActive } = useServiceGate();

  // ── Duration store state (subscribe to singleton) ──
  const [durationActive, setDurationActive] = useState(() => ltDurationStore.activeState);
  const [durationConfig, setDurationConfig] = useState<LTDurationConfig>(() =>
    ltDurationStore.getConfigForLT(selectedPresetId || "current"),
  );

  // Subscribe to ltDurationStore changes
  useEffect(() => {
    const unsub = ltDurationStore.subscribe(() => {
      setDurationActive(ltDurationStore.activeState);
    });
    return unsub;
  }, []);

  // Update local duration config when preset changes
  useEffect(() => {
    setDurationConfig(ltDurationStore.getConfigForLT(selectedPresetId || "current"));
  }, [selectedPresetId]);

  // Register auto-clear callback (calls blankAll via the store)
  useEffect(() => {
    ltDurationStore.setAutoClearCallback(async (_exitStyle) => {
      try {
        await blankAll();
      } catch (err) {
        console.warn("[LT] Auto-clear failed:", err);
      }
    });
  }, [blankAll]);

  // Duration config handlers
  const handleDurationChange = useCallback((seconds: number) => {
    const newConfig: LTDurationConfig = { ...durationConfig, durationSeconds: seconds, useDefaults: false, isPinned: seconds === 0 };
    setDurationConfig(newConfig);
    ltDurationStore.setConfigForLT(selectedPresetId || "current", newConfig);
  }, [durationConfig, selectedPresetId]);

  const handleExitStyleChange = useCallback((style: LTExitStyle) => {
    const newConfig: LTDurationConfig = { ...durationConfig, exitStyle: style, useDefaults: false };
    setDurationConfig(newConfig);
    ltDurationStore.setConfigForLT(selectedPresetId || "current", newConfig);
  }, [durationConfig, selectedPresetId]);

  const handleUseDefaultsToggle = useCallback(() => {
    const newConfig: LTDurationConfig = { ...durationConfig, useDefaults: !durationConfig.useDefaults };
    if (newConfig.useDefaults) {
      // Reset to global defaults
      const defaults = ltDurationStore.getConfigForLT(selectedPresetId || "current");
      newConfig.durationSeconds = defaults.durationSeconds;
      newConfig.triggerMode = defaults.triggerMode;
      newConfig.exitStyle = defaults.exitStyle;
    }
    setDurationConfig(newConfig);
    ltDurationStore.setConfigForLT(selectedPresetId || "current", newConfig);
  }, [durationConfig, selectedPresetId]);

  const handlePinToggle = useCallback(() => {
    if (durationActive.activeLowerThirdId) {
      ltDurationStore.togglePin();
    }
  }, [durationActive.activeLowerThirdId]);

  const handleReshow = useCallback(async () => {
    const last = ltDurationStore.getLastShown();
    if (!last.themeId) return;
    // Restore last-shown theme + values and re-send
    selectAvailableLtTheme(last.themeId);
    for (const [k, v] of Object.entries(last.values)) {
      setValue(k, v);
    }
    // Wait a tick for state to propagate, then send
    setTimeout(async () => {
      try {
        await sendToAll();
        const preset = ltPresets.find((p) => p.id === last.id);
        ltDurationStore.show({
          ltId: last.id || "current",
          label: preset?.label || "Re-shown",
          subtitle: Object.values(last.values)[0] || "",
          themeId: last.themeId!,
          values: last.values,
        });
        setToast({ msg: "Re-shown last lower third", type: "success" });
      } catch {
        setToast({ msg: "Failed to re-show", type: "error" });
      }
    }, 50);
  }, [selectAvailableLtTheme, setValue, sendToAll, ltPresets]);

  const handleNowShowingClear = useCallback(async () => {
    try {
      await blankAll();
      ltDurationStore.clear();
      setToast({ msg: "Lower third cleared", type: "success" });
    } catch {
      setToast({ msg: "Failed to clear", type: "error" });
    }
  }, [blankAll]);

  // Preview URL
  const previewUrl = usePreviewUrl(
    state.selectedTheme,
    state.values,
    state.size,
    state.fontSize,
    state.position,
    state.customX,
    state.customY,
    state.animationIn,
    state.customStyles,
    brandingSettings,
  );

  // Apply runtime branding (logo + accent) to the currently active theme values.
  useEffect(() => {
    if (!state.selectedTheme) return;
    const runtime = applyRuntimeBranding(state.selectedTheme, state.values, brandingSettings);
    const shouldUseDefaultBrandColor =
      !state.customStyles.accentColor ||
      state.customStyles.accentColor === state.selectedTheme.accentColor;
    if (shouldUseDefaultBrandColor && state.customStyles.accentColor !== runtime.brandColor) {
      setCustomStyle({ accentColor: runtime.brandColor });
    }

    for (const variable of state.selectedTheme.variables) {
      if (!isLogoVariable(variable)) continue;
      const nextValue = runtime.values[variable.key] ?? "";
      if (!nextValue) continue;
      if (state.values[variable.key] !== nextValue) {
        setValue(variable.key, nextValue);
      }
    }
  }, [
    brandingSettings,
    setCustomStyle,
    setValue,
    state.customStyles.accentColor,
    state.selectedTheme,
    state.values,
  ]);

  // Dynamically scale the preview iframe so 1920px maps to the actual
  // preview frame width — keeps the preview pixel-accurate at any panel size.
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const update = () => setPreviewScale(el.clientWidth / 1920);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Auto-refresh OBS scenes every 500ms so deleted/added scenes sync quickly without excessive load.
  useEffect(() => {
    if (!isActive) return;

    const poll = async () => {
      if (!obsService.isConnected) {
        setProgramScene("");
        return;
      }
      refreshScenes();
      try {
        setProgramScene(getDisplaySceneName(await obsService.getCurrentProgramScene()));
      } catch {
        setProgramScene("");
      }
    };
    void poll();
    const iv = setInterval(() => { void poll(); }, getRecommendedPollingInterval(3000));
    return () => clearInterval(iv);
  }, [refreshScenes, isActive]);

  // Update "last updated" text every 10s
  useEffect(() => {
    if (!state.lastSentAt) {
      setLastUpdatedStr(null);
      return;
    }
    setLastUpdatedStr(timeAgo(state.lastSentAt));
    const iv = setInterval(() => setLastUpdatedStr(timeAgo(state.lastSentAt!)), 10000);
    return () => clearInterval(iv);
  }, [state.lastSentAt]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isActive) return;
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleSendAll();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "c" || e.key === "C")) {
        e.preventDefault();
        handleCopyUrl();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        handleClearAll();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Drag-and-drop positioning on preview
  const handlePreviewMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!previewRef.current || !state.selectedTheme) return;
      isDragging.current = true;
      updateDragPos(e.nativeEvent);
    },
    [state.selectedTheme],
  );

  const handlePreviewMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging.current || !previewRef.current) return;
      updateDragPos(e.nativeEvent);
    },
    [],
  );

  const handlePreviewMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  function updateDragPos(e: MouseEvent) {
    if (!previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    setCustomPos(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
  }

  const markDurationShown = useCallback(() => {
    if (!state.selectedTheme) return;
    const preset = ltPresets.find((p) => p.id === selectedPresetId);
    ltDurationStore.show({
      ltId: selectedPresetId || "current",
      label: preset?.label || state.selectedTheme.name,
      subtitle: Object.values(state.values)[0] || state.selectedTheme.name,
      themeId: state.selectedTheme.id,
      values: { ...state.values },
      config: durationConfig,
    });
  }, [state.selectedTheme, state.values, selectedPresetId, ltPresets, durationConfig]);

  // Send / Clear handlers with toast
  const handleSendAll = useCallback(async () => {
    if (!state.selectedTheme || state.isSending) return;
    if (!checkServiceActive("send lower thirds to OBS")) return;
    try {
      await sendToAll();
      markDurationShown();
      setToast({ msg: "All lower third sources updated!", type: "success" });
      // Track LT for service stats
      if (serviceStore.status === "preservice") {
        serviceStore.trackLowerThird();
      }
    } catch {
      setToast({ msg: "Failed to update sources", type: "error" });
    }
  }, [state.selectedTheme, state.isSending, sendToAll, checkServiceActive, markDurationShown]);

  const handleSendToScene = useCallback(
    async (
      sceneName: string,
      _mode: "scene" | "preview" | "program" = "scene",
    ) => {
      if (!state.selectedTheme || state.isSending) return;
      if (!checkServiceActive("send lower thirds to OBS")) return;
      try {
        await sendToScene(sceneName);
        markDurationShown();
        setToast({ msg: `Sent to scene "${sceneName}"`, type: "success" });
        if (serviceStore.status === "preservice") {
          serviceStore.trackLowerThird();
        }
      } catch {
        setToast({ msg: `Failed to send to scene "${sceneName}"`, type: "error" });
      }
    },
    [state.selectedTheme, state.isSending, sendToScene, checkServiceActive, markDurationShown],
  );

  const handleClearAll = useCallback(async () => {
    try {
      await clearAll();
      ltDurationStore.clear();
      setToast({ msg: "All sources cleared", type: "success" });
    } catch {
      setToast({ msg: "Failed to clear", type: "error" });
    }
  }, [clearAll]);

  // Hide/show without clearing edit state. Show always re-applies duration defaults.
  const handleToggleVisibility = useCallback(async () => {
    if (!state.selectedTheme || state.isSending || !obsService.isConnected) return;

    if (state.isLive) {
      try {
        await blankAll();
        ltDurationStore.setVisible(false);
        setToast({ msg: "Lower third hidden", type: "success" });
      } catch {
        setToast({ msg: "Failed to hide lower third", type: "error" });
      }
      return;
    }

    if (!checkServiceActive("send lower thirds to OBS")) return;

    try {
      await sendToAll();
      markDurationShown();
      ltDurationStore.setVisible(true);
      setToast({ msg: "Lower third shown", type: "success" });
      if (serviceStore.status === "preservice") {
        serviceStore.trackLowerThird();
      }
    } catch {
      setToast({ msg: "Failed to show lower third", type: "error" });
    }
  }, [state.selectedTheme, state.isSending, state.isLive, blankAll, checkServiceActive, sendToAll, markDurationShown]);

  // Copy the OBS browser-source overlay URL to clipboard
  const handleCopyUrl = useCallback(() => {
    if (!state.selectedTheme) return;
    const url = buildOverlayUrl(
      state.selectedTheme,
      state.values,
      true,
      false,
      state.size,
      state.customStyles,
      state.fontSize,
      state.position,
      state.customX,
      state.customY,
      state.animationIn,
    );
    navigator.clipboard.writeText(url).then(() => {
      setUrlCopied(true);
      setToast({ msg: "Overlay URL copied to clipboard!", type: "success" });
      setTimeout(() => setUrlCopied(false), 2000);
    }).catch(() => {
      setToast({ msg: "Failed to copy URL", type: "error" });
    });
  }, [state.selectedTheme, state.values, state.size, state.customStyles, state.fontSize, state.position, state.customX, state.customY, state.animationIn]);

  // ── Persist presets to localStorage ──
  useEffect(() => {
    localStorage.setItem(getUserScopedKey(LT_PRESETS_STORAGE_KEY), JSON.stringify(ltPresets));
  }, [ltPresets]);

  // ── When a preset is selected, load its theme + values ──
  useEffect(() => {
    const preset = ltPresets.find((p) => p.id === selectedPresetId);
    if (!preset) return;
    // Only select theme if it differs from current
    if (state.selectedTheme?.id !== preset.themeId) {
      selectTheme(preset.themeId);
    }
    // Load saved values into the form
    for (const [k, v] of Object.entries(preset.values)) {
      if (state.values[k] !== v) setValue(k, v);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPresetId]);

  // ── Auto-save: sync content back into the active preset whenever values or theme change ──
  useEffect(() => {
    if (!selectedPresetId || !state.selectedTheme) return;
    setLtPresets((prev) => {
      const idx = prev.findIndex((p) => p.id === selectedPresetId);
      if (idx === -1) return prev;
      const current = prev[idx];
      // Only update if something actually changed
      if (current.themeId === state.selectedTheme!.id && JSON.stringify(current.values) === JSON.stringify(state.values)) {
        return prev;
      }
      const updated = [...prev];
      updated[idx] = { ...current, themeId: state.selectedTheme!.id, values: { ...state.values } };
      return updated;
    });
  }, [selectedPresetId, state.selectedTheme, state.values]);

  // ── Version History: subscribe + record changes ──
  useEffect(() => {
    const unsub = ltVersionHistory.subscribe(() => {
      setVersionGroups(ltVersionHistory.getGroupsForPreset(selectedPresetId || "current"));
    });
    // Initial load
    setVersionGroups(ltVersionHistory.getGroupsForPreset(selectedPresetId || "current"));
    return unsub;
  }, [selectedPresetId]);

  // Record content changes to version history (debounced in the store)
  useEffect(() => {
    if (!state.selectedTheme || !selectedPresetId) return;
    ltVersionHistory.recordChange({
      themeId: state.selectedTheme.id,
      themeName: state.selectedTheme.name,
      themeAccent: state.selectedTheme.accentColor || "#444",
      values: state.values,
      durationConfig: durationConfig,
      presetId: selectedPresetId,
    });
  }, [state.values, state.selectedTheme, selectedPresetId, durationConfig]);

  // Restore a version snapshot
  const handleRestoreVersion = useCallback(
    (snapshot: LTVersionSnapshot) => {
      const restoredTheme = findAvailableLtTheme(snapshot.themeId);
      if (!restoredTheme) {
        setToast({ msg: "Could not restore version theme", type: "error" });
        return;
      }
      const restoredValues = { ...snapshot.values };

      // Apply full snapshot so preview + center input fields stay in sync.
      dispatch({ type: "SELECT_THEME", theme: restoredTheme });
      setValues(restoredValues);

      if (selectedPresetId) {
        setLtPresets((prev) => {
          const idx = prev.findIndex((p) => p.id === selectedPresetId);
          if (idx === -1) return prev;
          const current = prev[idx];
          const updated = [...prev];
          updated[idx] = {
            ...current,
            themeId: restoredTheme.id,
            values: restoredValues,
            categoryValues: { ...(current.categoryValues ?? {}), ...restoredValues },
          };
          return updated;
        });
      }

      // Restore duration config
      if (snapshot.durationConfig) {
        const newConfig: LTDurationConfig = {
          ...durationConfig,
          durationSeconds: snapshot.durationConfig.durationSeconds,
          exitStyle: snapshot.durationConfig.exitStyle,
          useDefaults: snapshot.durationConfig.useDefaults,
        };
        setDurationConfig(newConfig);
        ltDurationStore.setConfigForLT(selectedPresetId || "current", newConfig);
      }
      setPreviewingSnapshotId(null);
      setShowVersionPanel(false);
      setToast({ msg: "Version restored", type: "success" });
    },
    [dispatch, findAvailableLtTheme, setValues, durationConfig, selectedPresetId],
  );

  // ── Active preset's category (derived, needed by callbacks below) ──
  const activePreset = ltPresets.find((p) => p.id === selectedPresetId);
  const activeCategoryId = activePreset?.categoryId;
  const activeCategory = activeCategoryId ? getPresetCategory(activeCategoryId) : undefined;

  /** Update a raw theme variable value (dynamic field editing). */
  const handleThemeVariableChange = useCallback(
    (fieldKey: string, fieldValue: string) => {
      setValue(fieldKey, fieldValue);
      if (!selectedPresetId) return;
      setLtPresets((prev) => {
        const idx = prev.findIndex((p) => p.id === selectedPresetId);
        if (idx === -1) return prev;
        const current = prev[idx];
        const nextThemeValues = { ...state.values, [fieldKey]: fieldValue };
        const categorySeed = { ...(current.categoryValues ?? {}), [fieldKey]: fieldValue };
        const nextCategoryValues =
          activeCategoryId && state.selectedTheme && activeCategoryId !== "giving" && activeCategoryId !== "follow-us"
            ? mapThemeValuesToCategoryFields(activeCategoryId, state.selectedTheme, nextThemeValues, categorySeed)
            : categorySeed;
        const updated = [...prev];
        updated[idx] = { ...current, categoryValues: nextCategoryValues };
        return updated;
      });
    },
    [selectedPresetId, setValue, activeCategoryId, state.selectedTheme, state.values],
  );

  const applyChurchBrandAccent = useCallback((color: string) => {
    if (!color) {
      setCustomStyle({ accentColor: "" });
      return;
    }
    if (!isHexColor(color)) return;
    setCustomStyle({ accentColor: color });
    setToast({ msg: "Church brand color applied", type: "success" });
  }, [setCustomStyle]);

  const handleThemeQrUpload = useCallback(
    (fieldKey: string, file: File | null) => {
      if (!file) return;
      const isImageMime = file.type.startsWith("image/");
      const isAllowedExt = hasAllowedQrImageExtension(file.name);
      if (!isImageMime && !isAllowedExt) {
        setToast({ msg: "Unsupported QR file type", type: "error" });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = typeof reader.result === "string" ? reader.result : "";
        if (!dataUrl) {
          setToast({ msg: "Failed to read QR image", type: "error" });
          return;
        }
        handleThemeVariableChange(fieldKey, dataUrl);
      };
      reader.onerror = () => {
        setToast({ msg: "Failed to read QR image", type: "error" });
      };
      reader.readAsDataURL(file);
    },
    [handleThemeVariableChange],
  );

  // ── Add new preset (from category picker) ──
  const handleAddPreset = useCallback(() => {
    const label = newPresetLabel.trim();
    if (!label) { setPresetError("Enter a name"); return; }
    if (ltPresets.some((p) => p.label.toLowerCase() === label.toLowerCase())) {
      setPresetError("A preset with this name already exists");
      return;
    }
    const newP: LTPreset = {
      id: createLTPresetId(),
      label,
      themeId: state.selectedTheme?.id ?? availableLtThemes[0]?.id ?? LT_THEMES[0]?.id ?? "",
      values: { ...state.values },
    };
    setLtPresets((prev) => [...prev, newP]);
    setSelectedPresetId(newP.id);
    setNewPresetLabel("");
    setPresetError("");
    setShowPresetPicker(false);
    setToast({ msg: `Preset "${label}" created`, type: "success" });
  }, [newPresetLabel, ltPresets, state.selectedTheme, state.values, availableLtThemes]);

  /** Create a new preset from a selected category tile */
  const handlePickCategory = useCallback((catId: LTPresetCategoryId) => {
    const cat = getPresetCategory(catId);
    if (!cat) return;
    const bundledCategoryThemes = getThemesForCategory(catId);
    const bundledCategoryIds = new Set(bundledCategoryThemes.map((theme) => theme.id));
    const themes = availableLtThemes.filter((theme) => String(theme.category) === catId || bundledCategoryIds.has(theme.id));
    const defaultThemeId = cat.defaultThemeId || themes[0]?.id || availableLtThemes[0]?.id || LT_THEMES[0]?.id || "";
    const resolvedDefaultTheme = findAvailableLtTheme(defaultThemeId);
    const chosenTheme = (
      resolvedDefaultTheme && themes.some((theme) => theme.id === resolvedDefaultTheme.id)
        ? resolvedDefaultTheme
        : themes[0]
    );

    // Build default category field values
    const categoryValues: Record<string, string> = {};
    for (const f of cat.fields) {
      categoryValues[f.key] = f.defaultValue ?? "";
    }
    // Giving form is variable-driven; seed category values from the chosen theme.
    if (catId === "giving" && chosenTheme) {
      for (const v of chosenTheme.variables) {
        if (isInternalGivingVariable(v)) continue;
        if (!(v.key in categoryValues)) {
          categoryValues[v.key] = v.defaultValue ?? "";
        }
      }
    }

    // Build initial theme values from mapping
    const themeValues = chosenTheme
      ? mapCategoryFieldsToThemeValues(catId, categoryValues, chosenTheme)
      : {};
    const initialCategoryValues = chosenTheme
      ? mapThemeValuesToCategoryFields(catId, chosenTheme, themeValues, categoryValues)
      : categoryValues;

    const newP: LTPreset = {
      id: createLTPresetId(),
      label: cat.label,
      themeId: chosenTheme?.id ?? defaultThemeId,
      values: themeValues,
      categoryId: catId,
      categoryValues: initialCategoryValues,
      selectedPlatforms: catId === "follow-us" ? ["instagram", "facebook", "youtube"] : undefined,
    };

    setLtPresets((prev) => [...prev, newP]);
    setSelectedPresetId(newP.id);
    setShowPresetPicker(false);

    // Load theme + values into the editor
    if (chosenTheme) {
      dispatch({ type: "SELECT_THEME", theme: chosenTheme });
    } else {
      selectTheme(defaultThemeId);
    }
    for (const [k, v] of Object.entries(themeValues)) {
      setValue(k, v);
    }

    setToast({ msg: `"${cat.label}" preset created`, type: "success" });
  }, [availableLtThemes, dispatch, findAvailableLtTheme, selectTheme, setValue]);

  // ── Delete preset ──
  const handleDeletePreset = useCallback(
    (id: string) => {
      setLtPresets((prev) => {
        const next = prev.filter((p) => p.id !== id);
        if (next.length === 0) {
          // Always keep at least one
          const fallback: LTPreset = {
            id: createLTPresetId(),
            label: "Announcement",
            themeId: availableLtThemes[0]?.id ?? LT_THEMES[0]?.id ?? "",
            values: {},
          };
          return [fallback];
        }
        return next;
      });
      if (selectedPresetId === id) {
        setLtPresets((prev) => {
          setSelectedPresetId(prev[0]?.id ?? "");
          return prev;
        });
      }
    },
    [selectedPresetId, availableLtThemes],
  );

  // ── Duplicate preset ──
  const handleDuplicatePreset = useCallback((id: string) => {
    setLtPresets((prev) => {
      const src = prev.find((p) => p.id === id);
      if (!src) return prev;
      const dup: LTPreset = {
        ...src,
        id: createLTPresetId(),
        label: `${src.label} (Copy)`,
        values: { ...src.values },
        categoryValues: src.categoryValues ? { ...src.categoryValues } : undefined,
        selectedPlatforms: src.selectedPlatforms ? [...src.selectedPlatforms] : undefined,
      };
      const idx = prev.findIndex((p) => p.id === id);
      const next = [...prev];
      next.splice(idx + 1, 0, dup);
      return next;
    });
  }, []);

  // ── Reorder presets ──
  const handleMovePreset = useCallback((id: string, direction: "up" | "down") => {
    setLtPresets((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      if (idx < 0) return prev;
      const target = direction === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }, []);

  const themePickerThemes = useMemo(
    () => {
      if (!activeCategoryId) return availableLtThemes;
      const bundledCategoryThemes = getThemesForCategory(activeCategoryId);
      const bundledCategoryIds = new Set(bundledCategoryThemes.map((theme) => theme.id));
      return availableLtThemes.filter((theme) => String(theme.category) === activeCategoryId || bundledCategoryIds.has(theme.id));
    },
    [activeCategoryId, availableLtThemes],
  );

  const handleThemeSelectFromDropdown = useCallback((nextThemeId: string) => {
    const nextTheme = findAvailableLtTheme(nextThemeId);
    if (!nextTheme) return;
    dispatch({ type: "SELECT_THEME", theme: nextTheme });

    if (activeCategoryId && activePreset?.categoryValues) {
      const mapped = mapCategoryFieldsToThemeValues(activeCategoryId, activePreset.categoryValues, nextTheme);
      for (const [k, v] of Object.entries(mapped)) {
        setValue(k, v);
      }
      setLtPresets((prev) => {
        const idx = prev.findIndex((p) => p.id === selectedPresetId);
        if (idx === -1) return prev;
        const current = prev[idx];
        const seedCategoryValues = { ...(current.categoryValues ?? {}), ...mapped };
        const nextCategoryValues =
          activeCategoryId !== "giving" && activeCategoryId !== "follow-us"
            ? mapThemeValuesToCategoryFields(activeCategoryId, nextTheme, mapped, seedCategoryValues)
            : seedCategoryValues;
        const updated = [...prev];
        updated[idx] = {
          ...current,
          categoryValues: nextCategoryValues,
        };
        return updated;
      });
    }

    setThemeDropdownOpen(false);
  }, [dispatch, findAvailableLtTheme, activeCategoryId, activePreset?.categoryValues, setValue, selectedPresetId]);

  // Group variables by group label
  const groupedVars = useMemo(() => {
    if (!state.selectedTheme) return [];
    const groups: { label: string; vars: LTVariable[] }[] = [];
    const map = new Map<string, LTVariable[]>();
    for (const v of state.selectedTheme.variables) {
      if (isInternalThemeVariable(v)) continue;
      const g = v.group || "Content";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(v);
    }
    for (const [label, vars] of map) {
      groups.push({ label, vars });
    }
    return groups;
  }, [state.selectedTheme]);

  const theme = state.selectedTheme;
  const hasLogoVariable = Boolean(theme?.variables.some((variable) => isLogoVariable(variable)));

  const renderThemeVariableField = (v: LTVariable) => {
    const currentValue = state.values[v.key] ?? activePreset?.categoryValues?.[v.key] ?? v.defaultValue ?? "";
    const label = v.label || toStartCase(v.key);
    const isQrField = getGivingVariableType(v) === "qr";

    return (
      <div key={v.key} className="lt-page-form-field">
        <label className="lt-page-form-label">
          {label}
          {v.required && <span style={{ color: "#C8102E", marginLeft: 2 }}>*</span>}
        </label>
        {isQrField ? (
          <>
            <input
              type="text"
              className="lt-page-form-input"
              value={currentValue}
              onChange={(e) => handleThemeVariableChange(v.key, e.target.value)}
              placeholder={v.placeholder || "Paste QR image URL or upload"}
              maxLength={v.maxLength}
            />
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <label
                className="lt-page-btn lt-page-btn--secondary"
                style={{ width: "auto", padding: "4px 10px", fontSize: 10, cursor: "pointer" }}
              >
                <Icon name="upload" size={12} />
                Upload QR
                <input
                  type="file"
                  accept={QR_IMAGE_UPLOAD_ACCEPT}
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    handleThemeQrUpload(v.key, file);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
          </>
        ) : v.type === "text" || v.type === "number" ? (
          <input
            type={v.type}
            className="lt-page-form-input"
            value={currentValue}
            onChange={(e) => handleThemeVariableChange(v.key, e.target.value)}
            placeholder={v.placeholder || ""}
            maxLength={v.maxLength}
          />
        ) : v.type === "list" ? (
          <ListVariableInput
            value={currentValue}
            onChange={(val) => handleThemeVariableChange(v.key, val)}
            placeholder={v.placeholder || "Add item..."}
            separator={v.separator || " • "}
          />
        ) : v.type === "color" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="lt-customize-color-row">
              <input
                type="color"
                className="lt-customize-swatch"
                value={currentValue || "#ffffff"}
                onChange={(e) => handleThemeVariableChange(v.key, e.target.value)}
              />
              <input
                type="text"
                className="lt-page-form-input lt-customize-hex"
                value={currentValue}
                onChange={(e) => handleThemeVariableChange(v.key, e.target.value)}
                placeholder="#hex"
              />
            </div>
            {churchBrandColorOptions.length > 0 && (
              <select
                className="lt-page-form-input lt-brand-color-select"
                value=""
                onChange={(e) => {
                  const color = e.target.value;
                  if (color) handleThemeVariableChange(v.key, color);
                }}
                aria-label={`Use church brand color for ${label}`}
              >
                <option value="">Use church brand color...</option>
                {churchBrandColorOptions.map((option) => (
                  <option key={`${v.key}-${option.label}-${option.value}`} value={option.value}>
                    {option.label} ({option.value})
                  </option>
                ))}
              </select>
            )}
          </div>
        ) : v.type === "select" && v.options ? (
          <select
            className="lt-page-form-input"
            value={currentValue}
            onChange={(e) => handleThemeVariableChange(v.key, e.target.value)}
          >
            {v.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : v.type === "toggle" ? (
          <label className="lt-page-toggle">
            <input
              type="checkbox"
              checked={currentValue === "true"}
              onChange={(e) => handleThemeVariableChange(v.key, String(e.target.checked))}
            />
            {label}
          </label>
        ) : null}
      </div>
    );
  };

  // =========================================================================
  // RENDER
  // =========================================================================

  return (
    <div className="lt-page">
      {/* Toast */}
      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}

      {/* Header */}
      {/* <header className="lt-page-header">
        <div className="lt-page-header-left">
          <Icon name="subtitles" size={22} style={{ color: "#C8102E" }} />
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <h1 className="lt-page-title">Announcements &amp; Notes</h1>
            <span style={{ color: "var(--text-disabled)", fontSize: 13, fontWeight: 400 }}>/</span>
            <p className="lt-page-subtitle" style={{ margin: 0 }}>Design &amp; push overlays to OBS</p>
          </div>
        </div>
        <div className="lt-page-header-right">
          {lastUpdatedStr && (
            <span className="lt-last-updated">
              <Icon name="schedule" size={13} />
              Last updated: {lastUpdatedStr}
            </span>
          )}
          {state.isLive && (
            <div className="lt-page-live-badge">
              <span className="lt-page-live-dot" />
              LIVE
            </div>
          )}
          <button
            className="lt-page-header-btn"
            title="Keyboard shortcuts: Ctrl+Enter (Send) / Esc (Clear)"
          >
            <Icon name="keyboard" size={18} />
          </button>
        </div>
      </header> */}

      {/* Body */}
      <div className="lt-page-body">
        {/* ==================================================================
             LEFT SIDEBAR - Template Gallery
           ================================================================== */}
        <aside className="lt-page-sidebar-left" style={{ position: "relative" }}>
          <div className="lt-page-sidebar-header">
            {/* <h3>Quick Select</h3> */}
            <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
              <button
                className={`lt-version-btn${showVersionPanel ? " is-active" : ""}`}
                title="Version History"
                onClick={() => setShowVersionPanel((v) => !v)}
              >
                <Icon name="history" size={15} />
              </button>
              <button
                className="lt-page-sidebar-add-btn"
                title="Add new preset"
                onClick={() => setShowPresetPicker(true)}
                style={{
                  background: "none",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 26,
                  height: 26,
                }}
              >
                <Icon name="add" size={16} />
              </button>
            </div>
          </div>

          {/* Preset list */}
          <div className="lt-page-theme-list">
            {ltPresets.map((p) => {
              const isActive = selectedPresetId === p.id;
              const matchedTheme = findAvailableLtTheme(p.themeId);
              const cat = p.categoryId ? getPresetCategory(p.categoryId) : undefined;
              return (
                <button
                  key={p.id}
                  className={"lt-page-card" + (isActive ? " lt-page-card--active" : "")}
                  onClick={() => setSelectedPresetId(p.id)}
                  title="Delete">
                  <div
                    className="lt-page-card-preview"
                    style={{ background: cat?.color ?? matchedTheme?.accentColor ?? "#444" }}
                  >
                    <Icon name={cat?.icon ?? matchedTheme?.icon ?? "subtitles"} size={18} style={{ color: "#fff" }} />
                  </div>
                  <div className="lt-page-card-info">
                    <span className="lt-page-card-name">{p.label}</span>
                    <span style={{ fontSize: 10, color: "var(--text-disabled)" }}>
                      {cat ? cat.description : (matchedTheme?.name ?? "Unknown theme")}
                    </span>
                  </div>
                  {isActive && (
                    <Icon name="check_circle" size={20} className="lt-page-card-check" />
                  )}
                  {ltPresets.length > 1 && (
                    <div style={{ display: "flex", gap: 1, alignItems: "center", marginLeft: "auto" }}>
                      <button
                        className="lt-page-card-delete"
                        title="Move up"
                        onClick={(e) => { e.stopPropagation(); handleMovePreset(p.id, "up"); }}
                        style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "var(--text-disabled)", display: "flex" }}
                      >
                        <Icon name="arrow_upward" size={12} />
                      </button>
                      <button
                        className="lt-page-card-delete"
                        title="Move down"
                        onClick={(e) => { e.stopPropagation(); handleMovePreset(p.id, "down"); }}
                        style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "var(--text-disabled)", display: "flex" }}
                      >
                        <Icon name="arrow_downward" size={12} />
                      </button>
                      <button
                        className="lt-page-card-delete"
                        title="Duplicate preset"
                        onClick={(e) => { e.stopPropagation(); handleDuplicatePreset(p.id); }}
                        style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "var(--text-disabled)", display: "flex" }}
                      >
                        <Icon name="content_copy" size={12} />
                      </button>
                      <button
                        className="lt-page-card-delete"
                        title="Delete preset"
                        onClick={(e) => { e.stopPropagation(); handleDeletePreset(p.id); }}
                        style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "var(--text-disabled)", display: "flex" }}
                      >
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* ── Version History Panel ── */}
          {showVersionPanel && (
            <div className="lt-version-panel">
              <div className="lt-version-panel-head">
                <h4>
                  <Icon name="history" size={14} />
                  Version History
                </h4>
                <button
                  className="lt-version-panel-close"
                  onClick={() => { setShowVersionPanel(false); setPreviewingSnapshotId(null); }}
                  title="Close">
                  <Icon name="close" size={16} />
                </button>
              </div>
              <div className="lt-version-panel-body">
                {versionGroups.length === 0 ? (
                  <div className="lt-version-empty">
                    <Icon name="history" size={28} style={{ opacity: 0.4 }} />
                    <span>No history yet</span>
                    <span style={{ fontSize: 10, color: "var(--text-disabled)" }}>
                      Edits will be saved automatically
                    </span>
                  </div>
                ) : (
                  versionGroups.map((group) => (
                    <div key={group.label}>
                      <div className="lt-version-group-label">{group.label}</div>
                      {group.snapshots.map((snap) => (
                        <div
                          key={snap.id}
                          className={`lt-version-entry${previewingSnapshotId === snap.id ? " is-previewing" : ""}`}
                          onMouseEnter={() => setPreviewingSnapshotId(snap.id)}
                          onMouseLeave={() => setPreviewingSnapshotId(null)}
                        >
                          <div
                            className="lt-version-entry-dot"
                            style={{ background: snap.themeAccent }}
                          />
                          <div className="lt-version-entry-info">
                            <span className="lt-version-entry-theme">{snap.themeName}</span>
                            <span className="lt-version-entry-preview">{snap.previewText}</span>
                            <span className="lt-version-entry-time">
                              {new Date(snap.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}
                            </span>
                          </div>
                          <div className="lt-version-entry-actions">
                            <button
                              className="lt-version-restore-btn"
                              onClick={(e) => { e.stopPropagation(); handleRestoreVersion(snap); }}
                              title="Restore">
                              Restore
                            </button>
                            <button
                              className="lt-version-delete-btn"
                              onClick={(e) => { e.stopPropagation(); ltVersionHistory.deleteSnapshot(snap.id); }}
                              title="Delete this version"
                            >
                              <Icon name="close" size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
              {versionGroups.length > 0 && (
                <div className="lt-version-panel-foot">
                  <button
                    className="lt-version-clear-btn"
                    onClick={() => ltVersionHistory.clearForPreset(selectedPresetId || "current")}
                    title="Clear">
                    Clear History
                  </button>
                </div>
              )}
            </div>
          )}
        </aside>

        {/* ==================================================================
             CENTER - Preview + Controls
           ================================================================== */}
        <main className="lt-page-center">
          {!theme ? (
            <div className="lt-page-empty-center">
              <Icon name="subtitles" size={48} style={{ color: "var(--text-disabled)" }} />
              <h3>Select a Preset</h3>
              <p>Choose a preset from the Quick Select panel on the left to get started.</p>
            </div>
          ) : (
            <>
              {/* Live Preview Monitor */}
              <div className="lt-page-preview-wrap">
                <div className="lt-page-preview-label">
                  {/* <Icon name="visibility" size={14} /> */}
                  {/* Live Preview */}
                  {state.position === "custom" && (
                    <span style={{ marginLeft: "auto", fontSize: 10, opacity: 0.5 }}>
                      Click &amp; drag to reposition
                    </span>
                  )}
                </div>
                <div
                  className={
                    "lt-page-preview-frame " +
                    (state.position === "custom" ? " lt-page-preview-frame--draggable" : "")
                  }
                  ref={previewRef}
                  onMouseDown={state.position === "custom" ? handlePreviewMouseDown : undefined}
                  onMouseMove={state.position === "custom" ? handlePreviewMouseMove : undefined}
                  onMouseUp={state.position === "custom" ? handlePreviewMouseUp : undefined}
                  onMouseLeave={state.position === "custom" ? handlePreviewMouseUp : undefined}
                >
                  <div className="lt-page-preview-bg" />
                  {previewUrl && (
                    <iframe
                      key={previewUrl}
                      className="lt-page-preview-iframe"
                      style={{ transform: `scale(${previewScale})` }}
                      src={previewUrl}
                      title="Lower Third Preview"
                    />
                  )}
                  {/* Position indicator dot for custom mode */}
                  {state.position === "custom" && (
                    <div
                      className="lt-page-preview-pos-dot"
                      style={{ left: state.customX + "%", top: state.customY + "%" }}
                    />
                  )}
                </div>
              </div>

              {/* ── Now Showing Strip ── */}
              {durationActive.activeLowerThirdId && (
                <div className="lt-now-showing">
                  <div className="lt-now-showing-left">
                    <div className={`lt-now-showing-badge${durationActive.isVisible ? " lt-now-showing-badge--live" : ""}`}>
                      {durationActive.isVisible ? "LIVE" : "HIDDEN"}
                    </div>
                    <div className="lt-now-showing-info">
                      <span className="lt-now-showing-label">{durationActive.activeLabel}</span>
                      <span className="lt-now-showing-sub">{durationActive.activeSubtitle}</span>
                    </div>
                  </div>
                  <div className="lt-now-showing-center">
                    {durationActive.triggerMode === "timed" && !durationActive.isPinned && durationActive.totalDuration > 0 && (
                      <>
                        <div className="lt-now-showing-timer">
                          {durationActive.remainingSeconds}s
                        </div>
                        <div className="lt-now-showing-progress">
                          <div
                            className="lt-now-showing-progress-bar"
                            style={{
                              width: `${durationActive.totalDuration > 0 ? ((durationActive.totalDuration - durationActive.remainingSeconds) / durationActive.totalDuration) * 100 : 0}%`,
                            }}
                          />
                        </div>
                      </>
                    )}
                    {durationActive.isPinned && (
                      <span className="lt-now-showing-pinned">
                        <Icon name="push_pin" size={13} />
                        Pinned
                      </span>
                    )}
                    {durationActive.triggerMode === "manual" && !durationActive.isPinned && (
                      <span className="lt-now-showing-pinned">Manual</span>
                    )}
                    {durationActive.triggerMode === "untilNext" && !durationActive.isPinned && (
                      <span className="lt-now-showing-pinned">Until Next</span>
                    )}
                    {durationActive.triggerMode === "untilSceneChange" && !durationActive.isPinned && (
                      <span className="lt-now-showing-pinned">Until Scene Change</span>
                    )}
                  </div>
                  <div className="lt-now-showing-actions">
                    <button
                      className="lt-now-showing-btn"
                      onClick={handlePinToggle}
                      title={durationActive.isPinned ? "Unpin" : "Pin (stay until manually cleared)"}
                    >
                      <Icon name={durationActive.isPinned ? "lock_open" : "push_pin"} size={14} />
                    </button>
                    <button
                      className="lt-now-showing-btn lt-now-showing-btn--clear"
                      onClick={handleNowShowingClear}
                      title="Clear Now"
                    >
                      <Icon name="clear" size={14} />
                      Remove From OBS
                    </button>
                  </div>
                </div>
              )}

              {/* Re-show Last button (when nothing is active but we have a last-shown) */}
              {!durationActive.activeLowerThirdId && durationActive.lastShownLowerThirdId && (
                <button
                  className="lt-reshow-btn"
                  onClick={handleReshow}
                  title="Re-show the last lower third"
                >
                  <Icon name="replay" size={14} />
                  Re-show Last
                </button>
              )}

              {/* Edit Content */}
              <div className="lt-page-form">
                <div className="lt-page-form-header">
                  <h4>
                    Edit Content
                  </h4>


                  <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>

                    <div style={{ display: "flex", gap: 6, marginRight: 5 }}>
                      <button
                        className={`lt-page-btn lt-page-btn--visibility ${state.isLive ? "is-visible" : "is-hidden"}`}
                        style={{ flex: 1 }}
                        onClick={handleToggleVisibility}
                        title={state.isLive ? "Hide Lower Third" : "Show Lower Third"}
                        disabled={!theme || state.isSending || !obsService.isConnected}
                      >
                        <Icon name={state.isLive ? "visibility" : "visibility_off"} size={14} />
                        {/* {state.isLive ? "Visible" : "Hidden · Show"} */}
                      </button>
                    </div>

                    <button className="lt-page-form-reset" onClick={resetValues} title="Reset">
                      <Icon name="restart_alt" size={12} />
                      Reset
                    </button>
                  </div>
                </div>

                <div className="lt-page-form-grid">
                  <div className="lt-page-form-main">
                    {/* ═══ Category-aware Dynamic Form ═══ */}
                    {activeCategory && activeCategoryId ? (
                      <div className="lt-category-form">
                        {/* ── Theme variables (always dynamic, for every selected theme) ── */}
                        <div className="lt-page-form-group">
                          <div className="lt-page-form-group-title">Theme Fields</div>
                          {groupedVars.map(({ label, vars }) => (
                            <div key={`group-${label}`} style={{ marginBottom: 8 }}>
                              {groupedVars.length > 1 && (
                                <div style={{ fontSize: 10, textTransform: "uppercase", opacity: 0.6, marginBottom: 6 }}>
                                  {label}
                                </div>
                              )}
                              {vars.map((v) => renderThemeVariableField(v))}
                            </div>
                          ))}
                          {groupedVars.length === 0 && (
                            <p style={{ fontSize: 12, color: "var(--text-disabled)", textAlign: "center", padding: 8 }}>
                              This template has no editable detail fields.
                            </p>
                          )}
                        </div>
                        {hasLogoVariable && (
                          <div className="lt-page-form-group">
                            <div className="lt-page-form-group-title">Branding</div>
                            <div className="lt-page-form-field">
                              <label className="lt-page-form-label" htmlFor="lt-logo-scale-slider">
                                Logo Size
                              </label>
                              <div className="lt-page-slider-row">
                                <input
                                  id="lt-logo-scale-slider"
                                  type="range"
                                  min="0.75"
                                  max="2.4"
                                  step="0.05"
                                  value={state.customStyles.logoScale}
                                  className="lt-customize-slider"
                                  onChange={(e) => setCustomStyle({ logoScale: parseFloat(e.target.value) })}
                                />
                                <span className="lt-page-slider-value">
                                  {Math.round(state.customStyles.logoScale * 100)}%
                                </span>
                              </div>
                              <div className="lt-page-slider-help">
                                <span>Increase or reduce the church logo size for this lower-third.</span>
                                {Math.abs(state.customStyles.logoScale - LT_DEFAULT_CUSTOM_STYLE.logoScale) > 0.001 && (
                                  <button
                                    type="button"
                                    className="lt-page-slider-reset"
                                    onClick={() => setCustomStyle({ logoScale: LT_DEFAULT_CUSTOM_STYLE.logoScale })}
                                    title="Reset">
                                    Reset
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* ═══ Legacy form — no category (old-style presets) ═══ */
                      <>
                        {groupedVars.map(({ label, vars }) => (
                          <div key={label} className="lt-page-form-group">
                            <div className="lt-page-form-group-title">{label}</div>
                            {vars.map((v) => renderThemeVariableField(v))}
                          </div>
                        ))}

                        {theme.variables.length === 0 && (
                          <p style={{ fontSize: 12, color: "var(--text-disabled)", textAlign: "center", padding: 16 }}>
                            This template has no editable fields.
                          </p>
                        )}
                        {hasLogoVariable && (
                          <div className="lt-page-form-group">
                            <div className="lt-page-form-group-title">Branding</div>
                            <div className="lt-page-form-field">
                              <label className="lt-page-form-label" htmlFor="lt-logo-scale-slider-legacy">
                                Logo Size
                              </label>
                              <div className="lt-page-slider-row">
                                <input
                                  id="lt-logo-scale-slider-legacy"
                                  type="range"
                                  min="0.75"
                                  max="2.4"
                                  step="0.05"
                                  value={state.customStyles.logoScale}
                                  className="lt-customize-slider"
                                  onChange={(e) => setCustomStyle({ logoScale: parseFloat(e.target.value) })}
                                />
                                <span className="lt-page-slider-value">
                                  {Math.round(state.customStyles.logoScale * 100)}%
                                </span>
                              </div>
                              <div className="lt-page-slider-help">
                                <span>Increase or reduce the church logo size for this lower-third.</span>
                                {Math.abs(state.customStyles.logoScale - LT_DEFAULT_CUSTOM_STYLE.logoScale) > 0.001 && (
                                  <button
                                    type="button"
                                    className="lt-page-slider-reset"
                                    onClick={() => setCustomStyle({ logoScale: LT_DEFAULT_CUSTOM_STYLE.logoScale })}
                                    title="Reset">
                                    Reset
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className="lt-page-form-side">
                    {/* ── Graphic Theme selector (moved into side panel) ── */}
                    <div className="lt-page-theme-panel">
                      <div className="lt-page-theme-head">
                        <label className="lt-page-form-label" style={{ marginBottom: 0 }}>
                          Graphic Theme
                        </label>
                        <span className="lt-page-theme-meta">
                          {activeCategoryId
                            ? `${themePickerThemes.length} templates for ${activeCategory?.label}`
                            : "Current theme"}
                        </span>
                      </div>
                      <div
                        className="lt-page-theme-selector"
                        onClick={() => setThemeDropdownOpen((open) => !open)}
                      >
                        <div
                          className="lt-page-theme-preview-thumb"
                          style={{ background: `linear-gradient(135deg, ${theme.accentColor || "#4ADE80"} 0%, #111827 100%)` }}
                        >
                          <Icon name={theme.icon} size={20} />
                        </div>
                        <span className="lt-page-theme-name">{theme.name}</span>
                        <Icon name={themeDropdownOpen ? "arrow_drop_up" : "arrow_drop_down"} size={20} />
                      </div>
                      {themeDropdownOpen && (
                        <div className="lt-page-theme-dropdown">
                          {themePickerThemes.map((t) => {
                            const selected = theme?.id === t.id;
                            return (
                              <button
                                key={t.id}
                                className={`lt-page-theme-option${selected ? " active" : ""}`}
                                onClick={() => handleThemeSelectFromDropdown(t.id)}
                                title="Confirm">
                                <div
                                  className="lt-page-theme-option-thumb"
                                  style={{ background: `linear-gradient(135deg, ${t.accentColor || "#4ADE80"} 0%, #111827 100%)` }}
                                >
                                  <Icon name={t.icon} size={20} />
                                </div>
                                <div className="lt-page-theme-option-info">
                                  <span className="lt-page-theme-option-name">{t.name}</span>
                                  <span className="lt-page-theme-option-desc">{t.description}</span>
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

                    {churchBrandColorOptions.length > 0 && (
                      <div className="lt-duration-section">
                        <div className="lt-duration-header">
                          <h4>
                            <Icon name="palette" size={14} />
                            Church Brand
                          </h4>
                        </div>
                        <div className="lt-duration-row">
                          <label className="lt-duration-label">Accent</label>
                          <select
                            className="lt-duration-select"
                            value={churchBrandColorOptions.some((option) => option.value === state.customStyles.accentColor) ? state.customStyles.accentColor : ""}
                            onChange={(e) => applyChurchBrandAccent(e.target.value)}
                          >
                            <option value="">Theme default</option>
                            {churchBrandColorOptions.map((option) => (
                              <option key={`${option.label}-${option.value}`} value={option.value}>
                                {option.label} ({option.value})
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}

                    {/* ── Duration + Auto-Clear Controls ── */}
                    <div className="lt-duration-section">
                      <div className="lt-duration-header">
                        <h4>
                          <Icon name="timer" size={14} />
                          Duration &amp; Auto-Clear
                        </h4>
                        <label className="lt-duration-defaults-toggle">
                          <input
                            type="checkbox"
                            checked={durationConfig.useDefaults}
                            onChange={handleUseDefaultsToggle}
                          />
                          <span>Use Defaults</span>
                        </label>
                      </div>

                      {/* Duration — number input + chips */}
                      <div className="lt-duration-row">
                        <label className="lt-duration-label">Duration</label>
                        <div className="lt-duration-chips">
                          {LT_DURATION_CHIPS.map((s) => (
                            <button
                              key={s}
                              className={`lt-duration-chip${durationConfig.durationSeconds === s && !durationConfig.isPinned ? " lt-duration-chip--active" : ""}`}
                              onClick={() => handleDurationChange(s)}
                              disabled={durationConfig.useDefaults}
                              title={`${s}s`}
                            >
                              {s}s
                            </button>
                          ))}
                          <button
                            className={`lt-duration-chip lt-duration-chip--pin${durationConfig.isPinned ? " lt-duration-chip--active" : ""}`}
                            onClick={() => handleDurationChange(0)}
                            disabled={durationConfig.useDefaults}
                            title="Pin (infinite duration)"
                          >
                            <Icon name="all_inclusive" size={13} />
                          </button>
                          <input
                            type="number"
                            className="lt-duration-input"
                            value={durationConfig.isPinned ? "" : durationConfig.durationSeconds}
                            onChange={(e) => handleDurationChange(Math.max(1, parseInt(e.target.value) || 1))}
                            disabled={durationConfig.useDefaults || durationConfig.isPinned}
                            min={1}
                            max={300}
                            placeholder="∞"
                            title="Custom duration in seconds"
                          />
                        </div>
                      </div>

                      {/* Exit Style */}
                      <div className="lt-duration-row">
                        <label className="lt-duration-label">Exit</label>
                        <select
                          className="lt-duration-select"
                          value={durationConfig.exitStyle}
                          onChange={(e) => handleExitStyleChange(e.target.value as LTExitStyle)}
                          disabled={durationConfig.useDefaults}
                        >
                          {LT_EXIT_STYLES.map((s) => (
                            <option key={s} value={s}>{LT_EXIT_STYLE_LABELS[s]}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </main>

        {/* ==================================================================
             RIGHT SIDEBAR - OBS Controls
           ================================================================== */}
        <aside className="lt-page-sidebar-right">

          <div className="lt-page-send">
            <h4 style={{ marginBottom: 20, }}>
              {/* <Icon name="send" size={16} /> */}
              Push to OBS
            </h4>
            {/* OBS Connection Card */}
            {/* <OBSConnectionCard /> */}

            {/* Send to All */}

            {/* OBS Scenes — list all real scenes from OBS */}
            <div className="lt-page-send-section">
              <ObsScenesPanel
                title="OBS Scenes"
                contentLabel="lower third"
                description="These are your current scenes in OBS. Click Send LT on any specific scene."
                connected={obsService.isConnected}
                scenes={state.obsScenes}
                mainScene={serviceStore.sceneMapping.mainScene}
                activeScene={programScene}
                refreshing={state.isRefreshing}
                disabled={!theme || state.isSending}
                sendLabel="Push To OBS"
                onRefresh={async () => {
                  await refreshSources();
                  await refreshScenes();
                }}
                onSendToScene={async (sceneName, mode) => {
                  await handleSendToScene(sceneName, mode);
                }}
              />
            </div>


            <div style={{ borderTop: "1px solid var(--border)", margin: "20px 0" }} >



              <div className="lt-page-send-section">
                <button
                  className="lt-page-btn lt-page-btn--primary"
                  onClick={handleSendAll}
                  disabled={!theme || state.isSending || !obsService.isConnected}
                  title="Update">
                  {state.isSending ? (
                    <>
                      <span className="lt-spinner" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Icon name="broadcast_on_personal" size={16} />
                      Update In OBS
                    </>
                  )}
                </button>
                <p className="lt-page-send-hint">
                  Pushes current template &amp; content to all discovered LT browser sources in OBS.
                </p>
              </div>



            </div>

            {/* Visibility Toggle */}



            {/* Error */}
            {state.error && (
              <div className="lt-page-error">
                <Icon name="error" size={14} />
                {state.error}
              </div>
            )}

            {/* Copy Browser Source URL */}
            <div className="lt-page-send-section">
              <h4>
                <Icon name="link" size={16} />
                Browser Source URL
              </h4>
              <button
                className={`lt-page-btn lt-page-btn--secondary lt-page-copy-url-btn${urlCopied ? " is-copied" : ""}`}
                onClick={handleCopyUrl}
                disabled={!theme}
                title="Copy the browser source overlay URL to clipboard (⌘⇧C)"
              >
                <Icon name={urlCopied ? "check" : "content_copy"} size={14} />
                {urlCopied ? "Copied!" : "Copy Overlay URL"}
              </button>
              <p className="lt-page-send-hint">
                Copy the overlay URL to paste manually into an OBS Browser Source.
              </p>
            </div>

            {/* Shortcuts reference */}
            <div className="lt-shortcuts-card">
              <h4>
                <Icon name="keyboard" size={14} />
                Shortcuts
              </h4>
              <div className="lt-shortcut-row">
                <span><kbd className="lt-kbd">Cmd</kbd>+<kbd className="lt-kbd">Enter</kbd></span>
                <span>Update All Sources</span>
              </div>
              <div className="lt-shortcut-row">
                <span><kbd className="lt-kbd">Cmd</kbd>+<kbd className="lt-kbd">Shift</kbd>+<kbd className="lt-kbd">C</kbd></span>
                <span>Copy Overlay URL</span>
              </div>
              <div className="lt-shortcut-row">
                <span><kbd className="lt-kbd">Esc</kbd></span>
                <span>Clear All</span>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* ── Preset Picker Panel (replaces old Add Preset modal) ── */}
      {showPresetPicker && (
        <div className="lt-modal-backdrop" onClick={() => setShowPresetPicker(false)}>
          <div className="lt-modal lt-preset-picker-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="lt-modal-header">
              <h3>
                <Icon name="add_circle" size={18} style={{ color: "#C8102E" }} />
                Add New Preset
              </h3>
              <button className="lt-modal-close" onClick={() => setShowPresetPicker(false)} title="Close">
                <Icon name="close" size={20} />
              </button>
            </div>
            <div className="lt-modal-body" style={{ padding: "12px 16px 20px" }}>
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px" }}>
                Choose a preset type. Each comes with curated templates and a tailored content form.
              </p>
              <div className="lt-preset-picker-grid">
                {LT_PRESET_CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    className="lt-preset-picker-tile"
                    style={{ "--tile-color": cat.color } as React.CSSProperties}
                    onClick={() => handlePickCategory(cat.id)}
                    type="button"
                    title="lt-preset-picker-tile-label">
                    <div className="lt-preset-picker-tile-icon" style={{ background: cat.color }}>
                      <Icon name={cat.icon} size={22} style={{ color: "#fff" }} />
                    </div>
                    <div className="lt-preset-picker-tile-info">
                      <span className="lt-preset-picker-tile-label">{cat.label}</span>
                      <span className="lt-preset-picker-tile-desc">{cat.description}</span>
                    </div>
                    <Icon name="arrow_forward_ios" size={20} className="lt-preset-picker-tile-arrow" />
                  </button>
                ))}
              </div>

              {/* Divider + custom preset option */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "16px 0 8px" }}>
                <div style={{ flex: 1, height: 1, background: "var(--surface-raised)" }} />
                <span style={{ fontSize: 10, color: "var(--text-disabled)", textTransform: "uppercase", letterSpacing: "0.05em" }}>or</span>
                <div style={{ flex: 1, height: 1, background: "var(--surface-raised)" }} />
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  className="lt-page-form-input"
                  placeholder="Custom preset name…"
                  value={newPresetLabel}
                  onChange={(e) => { setNewPresetLabel(e.target.value); setPresetError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddPreset(); }}
                  style={{ flex: 1 }}
                />
                <button
                  className="lt-page-btn lt-page-btn--secondary"
                  style={{ width: "auto", padding: "6px 12px", fontSize: 11 }}
                  onClick={handleAddPreset}
                  disabled={!newPresetLabel.trim()}
                  title="Create">
                  Create
                </button>
              </div>
              {presetError && (
                <span style={{ fontSize: 11, color: "var(--error)", marginTop: 4, display: "block" }}>{presetError}</span>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default LowerThirdsModule;
