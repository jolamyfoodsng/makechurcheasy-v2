import { Camera, X, ImagePlus, RotateCcw } from "../../components/icons/NativeIcons";
/**
 * DockLowerThirdEditor.tsx — Full-featured lower-third editor for the Dock
 *
 * Dynamically generates all controls from the selected theme's JSON definition.
 * Sections: Preview, Content (variable controls), Appearance, Position,
 * Animation, Animation Presets, Theme Inspector.
 */

import TextStyleControls from "../../components/TextStyleControls";
import { textStyleCapabilityFor, textStyleKey } from "../../lowerthirds/textStyle";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { isDockTabVisible } from "../dockTabVisibility";

/** The Ctrl or Cmd key, spelled the way this computer's keyboard does. */
const PRIMARY_KEY_LABEL = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(`${navigator.platform} ${navigator.userAgent}`) ? "⌘" : "Ctrl";
import type { ContentSlot, SlotState } from "../../lowerthirds/contentSlots";
import {
  deleteSlot,
  loadSlots,
  loadActiveSlotIndex,
  saveActiveSlotIndex,
  renameSlot,
  resolveSlotState,
  saveSlot,
} from "../../lowerthirds/contentSlots";
import { buildOverlayUrl } from "../../lowerthirds/lowerThirdObsService";
import { isLogoVariable, resolveOverlayAssetUrl } from "../../lowerthirds/runtimeBranding";
import { isSpeakerTheme } from "../../lowerthirds/speakerThemeUtils";
import type {
  LTAnimationIn,
  LTCustomStyle,
  LTExitStyle,
  LTFontSize,
  LTPosition,
  LTSize,
  LowerThirdTheme,
} from "../../lowerthirds/types";
import {
  LT_DEFAULT_CUSTOM_STYLE,
} from "../../lowerthirds/types";
import type { SpeakerProfileSetting } from "../../multiview/mvStore";
import { MV_SETTINGS_UPDATED_EVENT } from "../../multiview/mvStore";
import {
  MINISTRY_DATA_UPDATED_EVENT,
  buildSpeakerRoleMap,
  ensureMinistryData,
  getMinistryData,
  getMinistryHistory,
  refreshChurchInfo,
  refreshMinistry,
} from "../../services/ministryStore";
import { describeField } from "../../lowerthirds/fieldGuide";
import { looksLikeLongTextField } from "../../lowerthirds/graphicPackages";
import type { ChurchThemeLike } from "../../lowerthirds/churchDefaults";
import { applyChurchDefaults, churchAwareDefaults, sameValues } from "../../lowerthirds/churchDefaults";
import { getSafeFileName, saveToDisk } from "../dockUploadService";
import GivingBankFields, { hasGivingBankFields, isGivingBankFieldKey } from "../components/GivingBankFields";
import Icon from "../DockIcon";
import DockMotionControls from "./DockMotionControls";
import { PER_KEY, isCycleTheme } from "../../lowerthirds/cycleSet";
import DockGraphicPreviewModal from "../components/DockGraphicPreviewModal";
import DockSceneRouteSendControl from "../components/DockSceneRouteSendControl";
import type { DockSceneRoute } from "../dockSceneRouting";
import { fitPopover } from "../useKeepInViewport";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const SPEAKER_FIRST_TIME_KEY = "ocs-dock-lt-speaker-hint-seen";
const LT_APPEARANCE_PANEL_ID = "dock-lt-appearance-panel";

interface DockLTEditorProps {
  theme: LowerThirdTheme;
  themes: LowerThirdTheme[];
  onSelectTheme: (themeId: string) => void;
  onSend: (url: string, options?: { bypassSceneRoute?: boolean }) => void | Promise<void>;
  onBlank: (url: string) => void;
  onAnimateOut?: (url: string) => void;
  sending: boolean;
  size?: LTSize;
  /** Content-slot storage id; each Dock tab has its own. */
  editorId?: string;
  /** Set to a function that saves the current editor state to its slot right away. */
  flushRef?: { current: (() => void) | null };
  /** Optional scene routing for this module. */
  sceneRoute?: DockSceneRoute | null;
  /** Callback to update scene routing (e.g. disable when requested from send menu). */
  onUpdateSceneRoute?: (patch: Partial<DockSceneRoute>) => void;
}

type LTAppearanceColorKey = "bgColor" | "textColor" | "infoColor" | "accentColor";

const LT_APPEARANCE_COLOR_CONTROLS: Array<{ key: LTAppearanceColorKey; label: string; fallback: string }> = [
  { key: "bgColor", label: "Background", fallback: "#111827" },
  { key: "textColor", label: "Primary Text", fallback: "#ffffff" },
  { key: "infoColor", label: "Supporting Text", fallback: "#94a3b8" },
  { key: "accentColor", label: "Accent", fallback: "#4f46e5" },
];

function sanitizeLtColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, 80);
  if (!trimmed || /[;{}<>]/.test(trimmed)) return undefined;
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed)) return trimmed;
  if (/^rgba?\(\s*(?:\d{1,3}\s*,\s*){2}\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(trimmed)) return trimmed;
  if (/^hsla?\(\s*\d{1,3}(?:deg)?\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(trimmed)) return trimmed;
  return undefined;
}

function ltColorInputValue(value: unknown, fallback: string): string {
  const color = sanitizeLtColor(value);
  const hex = color?.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (!hex) return fallback;
  if (hex.length === 3) return `#${hex.split("").map((char) => char + char).join("")}`.toLowerCase();
  return `#${hex}`.toLowerCase();
}

function getLtAppearanceColor(styles: LTCustomStyle, key: LTAppearanceColorKey): string {
  if (key === "bgColor") return styles.bgColor || styles.bgColor1 || styles.bgColor2 || "";
  if (key === "textColor") return styles.textColor || styles.nameColor || "";
  if (key === "infoColor") return styles.infoColor || "";
  return styles.accentColor || styles.borderColor1 || styles.borderColor2 || "";
}

function withLtAppearanceColor(styles: LTCustomStyle, key: LTAppearanceColorKey, value: string): LTCustomStyle {
  const color = sanitizeLtColor(value) ?? "";
  if (key === "bgColor") {
    return {
      ...styles,
      bgColor: color,
      bgColor1: color,
      bgColor2: color,
    };
  }
  if (key === "textColor") {
    return {
      ...styles,
      textColor: color,
      nameColor: color,
    };
  }
  if (key === "infoColor") {
    return {
      ...styles,
      infoColor: color,
    };
  }
  return {
    ...styles,
    accentColor: color,
    borderColor1: color,
    borderColor2: color,
  };
}

function withoutLtAppearanceColors(styles: LTCustomStyle): LTCustomStyle {
  return {
    ...styles,
    bgColor: "",
    bgColor1: "",
    bgColor2: "",
    textColor: "",
    nameColor: "",
    infoColor: "",
    accentColor: "",
    borderColor1: "",
    borderColor2: "",
  };
}

// Motion straps (public/kinetic) are bare animated text: no box, so no background.
// Their look is set through theme variables (kxColor, kxSpeed, kxScale, kxAutoOut).
function isKineticTheme(theme: LowerThirdTheme): boolean {
  return typeof theme.html === "string" && theme.html.includes("kx-root");
}

// Church graphics (public/kinetic/church-lower-thirds.js) carry many differently-shaped
// fields (giving lines, links, timers), so each field is shown with its own label.
function isGraphicsTheme(theme: LowerThirdTheme): boolean {
  return Array.isArray(theme.tags) && theme.tags.includes("Graphics");
}

const dockFieldLabelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 10,
  fontWeight: 600,
  color: "var(--dock-text)",
  margin: "2px 0 3px",
};

const dockFieldHeadStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 6,
  margin: "2px 0 3px",
};

const dockFieldHintStyle: React.CSSProperties = {
  fontSize: 9,
  lineHeight: 1.3,
  color: "var(--dock-text-dim)",
  margin: "2px 0 0",
};

const dockFieldResetStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  padding: 0,
  fontSize: 9,
  fontFamily: "inherit",
  color: "var(--dock-accent, var(--primary))",
  cursor: "pointer",
  textDecoration: "underline",
  flexShrink: 0,
};

/** Fill variables that older saved slots don't have yet with the theme defaults. */
/** A "text" field that only ever holds a number (seconds, a count): it gets no case / size / weight chips. */
function isNumericField(v: { key: string; label?: string; defaultValue?: string }, fallback?: string): boolean {
  const def = String(v.defaultValue ?? fallback ?? "").trim();
  if (def !== "" && /^\d+(\.\d+)?$/.test(def)) return true;
  return /\b(seconds?|secs?|minutes?|duration|delay)\b/i.test(v.label ?? "");
}

function withThemeDefaults(theme: LowerThirdTheme, values: Record<string, string>): Record<string, string> {
  const merged = { ...values };
  for (const v of theme.variables) {
    if (merged[v.key] === undefined) merged[v.key] = v.defaultValue ?? "";
  }
  return merged;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Unable to read image."));
    reader.readAsDataURL(file);
  });
}

function loadInitialSlotState(themeId: string, slotIndex: number, theme: LowerThirdTheme, editorId = "default"): SlotState {
  try {
    const slots = loadSlots(themeId, editorId);
    const saved = slots[slotIndex];
    if (saved) return resolveSlotState(saved);
  } catch { /* ignore */ }
  const defaults: Record<string, string> = {};
  for (const v of theme.variables) {
    defaults[v.key] = v.defaultValue ?? "";
  }
  return {
    variableValues: defaults,
    customStyles: { ...LT_DEFAULT_CUSTOM_STYLE },
    // Graphics saved in Broadcast Graphics start where the user placed them.
    position: (theme as LowerThirdTheme & { defaultPosition?: LTPosition }).defaultPosition || "bottom-left",
    animationIn: (theme.animation?.name as LTAnimationIn) || "slide-left",
    exitStyle: "fade",
  };
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function DockLowerThirdEditor({
  theme,
  themes: _themes,
  onSelectTheme: _onSelectTheme,
  onSend,
  onBlank: _onBlank,
  onAnimateOut,
  sending,
  size = "xl",
  editorId = "default",
  flushRef,
  sceneRoute,
  onUpdateSceneRoute,
}: DockLTEditorProps) {
  const { t } = useTranslation();

  const [activeSlotIndex, setActiveSlotIndex] = useState<number>(() => {
    return loadActiveSlotIndex(theme.id, editorId);
  });
  const [slots, setSlots] = useState<(ContentSlot | null)[]>(() => loadSlots(theme.id, editorId));

  const initialSlotState = useMemo(() => {
    const activeIdx = loadActiveSlotIndex(theme.id, editorId);
    return loadInitialSlotState(theme.id, activeIdx, theme, editorId);
  }, [theme]);

  // ── Preview modal ──
  const [showPreview, setShowPreview] = useState(false);
  const layoutRef = useRef<HTMLDivElement | null>(null);

  // ── Variable values ──
  const [variableValues, setVariableValues] = useState<Record<string, string>>(() => initialSlotState.variableValues);

  // ── Custom style overrides ──
  const [customStyles, setCustomStyles] = useState<LTCustomStyle>(() => initialSlotState.customStyles);

  // ── Position ──
  const [position, setPosition] = useState<LTPosition>(() => initialSlotState.position);

  // ── Animation ──
  const [animationIn, setAnimationIn] = useState<LTAnimationIn>(() => initialSlotState.animationIn);
  const [exitStyle, setExitStyle] = useState<LTExitStyle>(() => initialSlotState.exitStyle);

  // ── Preview zoom (persisted) ──
  // Currently unused — will be wired to UI controls in a follow-up

  // ── Speaker theme detection & ministry data ──
  const isCurrentThemeSpeaker = useMemo(() => isSpeakerTheme(theme), [theme]);

  // ── Logo variable detection ──
  const hasLogoVariable = useMemo(
    () => theme.variables.some(
      (v) => v.type === "image"
        || v.key.toLowerCase().includes("logo")
        || (v.label ?? "").toLowerCase().includes("logo"),
    ),
    [theme],
  );

  // ── Image variable (for interactive picker) ──
  // Matches type:"image" variables, OR type:"text" variables whose key/label contains "logo"
  // The giving board has a logo per bank (handled by its bank rows); the picture picker is for the church logo.
  const isGivingBoard = useMemo(() => hasGivingBankFields(theme.variables.map((v) => v.key)), [theme]);
  const imageVariable = useMemo(
    () => (isGivingBoard ? theme.variables.find((v) => v.key === "logo") : undefined)
      ?? theme.variables.find((v) => !(isGivingBoard && isGivingBankFieldKey(v.key)) && (v.type === "image"
      || ((v.key.toLowerCase().includes("logo") || (v.label ?? "").toLowerCase().includes("logo")) && v.type === "text"))) ?? null,
    [theme, isGivingBoard],
  );
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const imagePreviewUrlRef = useRef<string | null>(null);
  const imageUploadIdRef = useRef(0);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageHovered, setImageHovered] = useState(false);
  const [imageDragOver, setImageDragOver] = useState(false);

  const clearImagePreview = useCallback(() => {
    const previous = imagePreviewUrlRef.current;
    if (previous) URL.revokeObjectURL(previous);
    imagePreviewUrlRef.current = null;
    setImagePreviewUrl(null);
  }, []);

  const handleImageFileSelect = useCallback(async (file: File) => {
    if (!imageVariable) return;
    if (!file.type.startsWith("image/")) return;
    const uploadId = ++imageUploadIdRef.current;
    clearImagePreview();
    const previewUrl = URL.createObjectURL(file);
    imagePreviewUrlRef.current = previewUrl;
    setImagePreviewUrl(previewUrl);
    setImageUploading(true);

    try {
      // Blob URLs only live for the current browser session. Save the image
      // first, then persist a stable uploads URL in the content slot so a
      // refreshed Dock can restore the logo.
      const safeName = `lt_logo_${Date.now()}_${getSafeFileName(file.name)}`;
      const savedPath = await saveToDisk(file, safeName);
      if (uploadId !== imageUploadIdRef.current) return;
      const persistedUrl = resolveOverlayAssetUrl(savedPath);
      if (!persistedUrl || persistedUrl.startsWith("blob:")) {
        throw new Error("A persistent image URL was not returned.");
      }
      setVariableValues((prev) => ({ ...prev, [imageVariable.key]: persistedUrl }));
    } catch (err) {
      if (uploadId !== imageUploadIdRef.current) return;
      // Keep the editor usable in a browser without the local upload API.
      // The data URL is durable in the existing content-slot storage, unlike
      // the object URL used only for the temporary preview.
      try {
        const dataUrl = await readFileAsDataUrl(file);
        if (uploadId === imageUploadIdRef.current) {
          setVariableValues((prev) => ({ ...prev, [imageVariable.key]: dataUrl }));
        }
      } catch (fallbackErr) {
        console.warn("[LowerThirdEditor] Could not persist selected image:", err, fallbackErr);
      }
    } finally {
      if (uploadId === imageUploadIdRef.current) {
        setImageUploading(false);
        clearImagePreview();
      }
    }
  }, [clearImagePreview, imageVariable]);

  const handleImageFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleImageFileSelect(file);
    e.target.value = "";
  }, [handleImageFileSelect]);

  const handleImageDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setImageDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleImageFileSelect(file);
  }, [handleImageFileSelect]);

  const handleImageRemove = useCallback(() => {
    if (!imageVariable) return;
    imageUploadIdRef.current += 1;
    setImageUploading(false);
    clearImagePreview();
    // For text-type logo variables, reset to the theme's default URL; otherwise clear
    setVariableValues((prev) => ({
      ...prev,
      [imageVariable.key]: imageVariable.type === "text" ? (imageVariable.defaultValue ?? "") : "",
    }));
  }, [clearImagePreview, imageVariable]);

  // Older slots may contain a session-only blob URL from before uploads were
  // persisted. It cannot be recovered after refresh, so fall back cleanly to
  // the theme default/global branding instead of showing a broken image.
  useEffect(() => {
    if (!imageVariable) return;
    setVariableValues((prev) => {
      const current = prev[imageVariable.key];
      if (typeof current !== "string" || !current.startsWith("blob:")) return prev;
      return {
        ...prev,
        [imageVariable.key]: imageVariable.type === "text" ? (imageVariable.defaultValue ?? "") : "",
      };
    });
  }, [imageVariable]);

  useEffect(() => () => {
    imageUploadIdRef.current += 1;
    const previous = imagePreviewUrlRef.current;
    if (previous) URL.revokeObjectURL(previous);
    imagePreviewUrlRef.current = null;
  }, []);

  const [speakers, setSpeakers] = useState<SpeakerProfileSetting[]>([]);
  const [selectedSpeakerIdx, setSelectedSpeakerIdx] = useState<number | null>(null);
  const [showSpeakerHint, setShowSpeakerHint] = useState(() => {
    if (!isCurrentThemeSpeaker) return false;
    try { return localStorage.getItem(SPEAKER_FIRST_TIME_KEY) !== "1"; } catch { return false; }
  });

  // Load ministry data when theme changes (localStorage first, then API fallback)
  useEffect(() => {
    if (!isCurrentThemeSpeaker) {
      setSelectedSpeakerIdx(null);
      return;
    }
    refreshMinistry();
    const ministry = getMinistryData();
    const list = ministry.speakers.map((s) => ({
      name: s.name.trim(),
      role: (s.role || "").trim(),
      imageUrl: (s.imageUrl || "").trim(),
      isMain: s.isMain,
    }));
    setSpeakers(list);

    // Don't auto-select — user picks manually
    if (list.length === 0) {
      // localStorage empty — try fetching from the API (OBS dock context)
      ensureMinistryData().then((fetched) => {
        if (!fetched) return;
        const fresh = getMinistryData();
        const freshList = fresh.speakers.map((s) => ({
          name: s.name.trim(),
          role: (s.role || "").trim(),
          imageUrl: (s.imageUrl || "").trim(),
          isMain: s.isMain,
        }));
        setSpeakers(freshList);
      });
    }
  }, [theme.id, isCurrentThemeSpeaker]);

  // Listen for ministry settings changes
  useEffect(() => {
    if (!isCurrentThemeSpeaker) return;
    const handler = () => {
      refreshMinistry();
      const ministry = getMinistryData();
      const list = ministry.speakers.map((s) => ({
        name: s.name.trim(),
        role: (s.role || "").trim(),
        imageUrl: (s.imageUrl || "").trim(),
        isMain: s.isMain,
      }));
      setSpeakers(list);
    };
    window.addEventListener(MV_SETTINGS_UPDATED_EVENT, handler);
    return () => window.removeEventListener(MV_SETTINGS_UPDATED_EVENT, handler);
  }, [isCurrentThemeSpeaker]);

  // Auto-populate name/title variables when speaker is selected
  useEffect(() => {
    if (!isCurrentThemeSpeaker || selectedSpeakerIdx === null) return;
    const sp = speakers[selectedSpeakerIdx];
    if (!sp) return;

    const roleMap = buildSpeakerRoleMap();
    const resolvedRole = sp.role || roleMap.get(sp.name.trim().toLowerCase()) || "";
    const ministry = getMinistryData();
    const churchName = ministry.churchName || "";
    const resolvedSpeakerImage = sp.imageUrl ? resolveOverlayAssetUrl(sp.imageUrl) : "";

    setVariableValues((prev) => {
      const next = { ...prev };
      for (const v of theme.variables) {
        const key = v.key.toLowerCase();
        const label = (v.label || "").toLowerCase();
        const hint = `${key} ${label}`;
        const logoField = isLogoVariable(v);

        const isSpeakerImageField =
          !logoField && (
            String(v.type || "").toLowerCase() === "image"
            || key === "image"
            || hint.includes("photo")
            || hint.includes("avatar")
            || hint.includes("picture")
          );

        // Name fields: exact key matches + label/hint heuristics
        const isNameField =
          !isSpeakerImageField && (
            key === "name" || key === "fullname" || key === "firstname" || key === "lastname"
            || hint.includes("name") || hint.includes("speaker") || hint.includes("pastor")
          );

        // Title/role fields: exact key matches + label/hint heuristics
        const isTitleField =
          !isSpeakerImageField && (
            key === "title" || key === "role" || key === "position" || key === "subtitle"
            || hint.includes("title") || hint.includes("role") || hint.includes("position")
          );

        // Ministry/church fields
        const isChurchField =
          !isSpeakerImageField && (
            key === "ministry" || key === "church" || key === "organization"
            || hint.includes("ministry") || hint.includes("church")
          );

        if (isNameField && (key === "firstname" || key === "lastname")) {
          // Separate first/last fields (Motion straps): split the speaker's name.
          const parts = sp.name.trim().split(/\s+/);
          next[v.key] = key === "firstname" ? (parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0] || "") : (parts.length > 1 ? parts[parts.length - 1] : "");
        } else if (isNameField) {
          next[v.key] = sp.name;
        } else if (isTitleField) {
          const combined = [resolvedRole, churchName].filter(Boolean).join(", ");
          next[v.key] = combined || resolvedRole || v.defaultValue || "";
        } else if (isChurchField) {
          next[v.key] = churchName || v.defaultValue || "";
        } else if (isSpeakerImageField) {
          next[v.key] = resolvedSpeakerImage || v.defaultValue || "";
        }
      }
      return next;
    });
  }, [selectedSpeakerIdx, speakers, theme, isCurrentThemeSpeaker]);

  const dismissSpeakerHint = useCallback(() => {
    try { localStorage.setItem(SPEAKER_FIRST_TIME_KEY, "1"); } catch { /* ignore */ }
    setShowSpeakerHint(false);
  }, []);

  // ── Reset state when theme changes ──
  const prevThemeId = useRef(theme.id);
  useEffect(() => {
    if (prevThemeId.current !== theme.id) {
      // Flush pending auto-save for the OLD theme before switching
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
        if (!isSavingRef.current && activeSlotIndex !== null) {
          const fullState: SlotState = {
            variableValues: { ...latestRef.current.variableValues },
            customStyles: { ...latestRef.current.customStyles },
            position: latestRef.current.position,
            animationIn: latestRef.current.animationIn,
            exitStyle: latestRef.current.exitStyle,
          };
          saveSlot(prevThemeId.current, editorId, activeSlotIndex, latestRef.current.variableValues, theme, fullState);
        }
      }
      prevThemeId.current = theme.id;
      const targetSlotIdx = loadActiveSlotIndex(theme.id, editorId);
      const newSlots = loadSlots(theme.id, editorId);
      setSlots(newSlots);
      setActiveSlotIndex(targetSlotIdx);
      const slotState = loadInitialSlotState(theme.id, targetSlotIdx, theme, editorId);
      setVariableValues({ ...slotState.variableValues });
      setCustomStyles({ ...slotState.customStyles });
      setPosition(slotState.position);
      setAnimationIn(slotState.animationIn);
      setExitStyle(slotState.exitStyle);
      skipAutoSaveRef.current = true;
      setCardsOpen(true);
    }
  }, [theme, activeSlotIndex]);

  // ── Church details (church name, pastor, website, phone, socials …) saved on the website ──
  const [ministryTick, setMinistryTick] = useState(0);
  useEffect(() => {
    // The desktop app tells us when its copy changed (MV_SETTINGS_UPDATED_EVENT).
    const bump = () => {
      refreshMinistry();
      setMinistryTick((n) => n + 1);
    };
    // The OBS dock keeps no copy, so it asks the web, and says so when something changed.
    const reread = () => setMinistryTick((n) => n + 1);
    const refreshFromWeb = (force = false) => {
      refreshChurchInfo({ force }).catch(() => { /* keep the text that is already there */ });
    };
    const onFocus = () => refreshFromWeb();
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshFromWeb();
    };
    window.addEventListener(MV_SETTINGS_UPDATED_EVENT, bump);
    window.addEventListener(MINISTRY_DATA_UPDATED_EVENT, reread);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    refreshFromWeb(true);
    // A change saved on the website reaches an open dock within a few minutes.
    const timer = window.setInterval(() => refreshFromWeb(), 5 * 60 * 1000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(MV_SETTINGS_UPDATED_EVENT, bump);
      window.removeEventListener(MINISTRY_DATA_UPDATED_EVENT, reread);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  /** What "Reset" brings a box back to: the church's own details where known, otherwise the design's placeholder. */
  const themeDefaultValues = useMemo(
    () => churchAwareDefaults(theme as unknown as ChurchThemeLike, getMinistryData()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme, ministryTick],
  );

  // Fill the church's details into boxes that still show the design's placeholder, or
  // still hold what the profile said before it changed. Anything the person has typed
  // is left alone. Runs again when the profile changes and when another saved slot is opened.
  useEffect(() => {
    const ministry = getMinistryData();
    const history = getMinistryHistory();
    setVariableValues((prev) => {
      const next = applyChurchDefaults(theme as unknown as ChurchThemeLike, prev, ministry, { history, keepCleared: true });
      return sameValues(prev, next) ? prev : next;
    });
  }, [theme, ministryTick, activeSlotIndex]);

  // ── Cards accordion state ──
  const [cardsOpen, setCardsOpen] = useState(true);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const kineticTheme = useMemo(() => isKineticTheme(theme), [theme]);
  const graphicsTheme = useMemo(() => isGraphicsTheme(theme), [theme]);

  const skipAutoSaveRef = useRef(true);
  const isSavingRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Context menu state ──
  const [contextMenu, setContextMenu] = useState<{ slotIndex: number; x: number; y: number } | null>(null);
  const [renamingSlotIndex, setRenamingSlotIndex] = useState<number | null>(null);
  const [renamingSlotName, setRenamingSlotName] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  const reloadSlots = useCallback(() => {
    setSlots(loadSlots(theme.id, editorId));
  }, [theme.id]);

  // Keep a ref with the latest state so saves always write fresh data
  const latestRef = useRef({ variableValues, customStyles, position, animationIn, exitStyle, activeSlotIndex, theme });
  latestRef.current = { variableValues, customStyles, position, animationIn, exitStyle, activeSlotIndex, theme };

  // ── Slot handlers ──
  const handleRecallSlot = useCallback((slot: ContentSlot) => {
    const resolved = resolveSlotState(slot);
    setVariableValues({ ...resolved.variableValues });
    setCustomStyles({ ...resolved.customStyles });
    setPosition(resolved.position);
    setAnimationIn(resolved.animationIn);
    setExitStyle(resolved.exitStyle);
    setActiveSlotIndex(slot.index);
    saveActiveSlotIndex(theme.id, editorId, slot.index);

    // Auto-match speaker from resolved slot values
    const speakerName = Object.entries(resolved.variableValues).find(([k]) => {
      const lk = k.toLowerCase();
      return lk === "name" || lk === "fullname" || lk === "speaker" || lk === "pastor";
    })?.[1]?.trim()?.toLowerCase();
    const matchIdx = speakerName ? speakers.findIndex((s) => s.name.trim().toLowerCase() === speakerName) : -1;
    setSelectedSpeakerIdx(matchIdx !== -1 ? matchIdx : null);
  }, [theme.id, speakers]);

  const handleDeleteSlot = useCallback((index: number) => {
    deleteSlot(theme.id, editorId, index);
    reloadSlots();
  }, [theme.id, reloadSlots]);

  const handleRenameSlot = useCallback((index: number) => {
    renameSlot(theme.id, editorId, index, renamingSlotName);
    reloadSlots();
    setRenamingSlotIndex(null);
    setRenamingSlotName("");
  }, [theme.id, renamingSlotName, reloadSlots]);

  // Debounced auto-save whenever editor state changes
  useEffect(() => {
    if (skipAutoSaveRef.current) {
      skipAutoSaveRef.current = false;
      return;
    }
    if (activeSlotIndex === null) return;

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(() => {
      if (isSavingRef.current) return;
      const { variableValues, customStyles, position, animationIn, exitStyle, activeSlotIndex: currentSlotIdx, theme: currentTheme } = latestRef.current;
      if (currentSlotIdx === null) return;
      try {
        const fullState: SlotState = {
          variableValues: { ...variableValues },
          customStyles: { ...customStyles },
          position,
          animationIn,
          exitStyle,
        };
        saveSlot(currentTheme.id, editorId, currentSlotIdx, variableValues, currentTheme, fullState);
        setSlots(loadSlots(currentTheme.id, editorId));
      } catch (err) {
        console.warn("[AutoSave] saveSlot failed:", err);
      }
    }, 350);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [variableValues, customStyles, position, animationIn, exitStyle, activeSlotIndex, theme]);

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        const { variableValues, customStyles, position, animationIn, exitStyle, activeSlotIndex: currentSlotIdx, theme: currentTheme } = latestRef.current;
        if (currentSlotIdx !== null) {
          try {
            const fullState: SlotState = {
              variableValues: { ...variableValues },
              customStyles: { ...customStyles },
              position,
              animationIn,
              exitStyle,
            };
            saveSlot(currentTheme.id, editorId, currentSlotIdx, variableValues, currentTheme, fullState);
          } catch { /* ignore */ }
        }
      }
    };
  }, []);

  // Lets the Dock save this tab right before it clones it.
  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      const { variableValues, customStyles, position, animationIn, exitStyle, activeSlotIndex: currentSlotIdx, theme: currentTheme } = latestRef.current;
      if (currentSlotIdx === null) return;
      try {
        saveSlot(currentTheme.id, editorId, currentSlotIdx, variableValues, currentTheme, {
          variableValues: { ...variableValues },
          customStyles: { ...customStyles },
          position,
          animationIn,
          exitStyle,
        });
        saveActiveSlotIndex(currentTheme.id, editorId, currentSlotIdx);
      } catch { /* ignore */ }
    };
    return () => {
      flushRef.current = null;
    };
  }, [flushRef, editorId]);

  // ── Context menu open (right-click or left-click empty slot) ──
  const openContextMenu = useCallback((slotIndex: number, x: number, y: number) => {
    setContextMenu({ slotIndex, x, y });
    setRenamingSlotIndex(null);
    setRenamingSlotName("");
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
    setRenamingSlotIndex(null);
    setRenamingSlotName("");
  }, []);

  // ── Slot click: flush current slot, then load clicked slot's data (or defaults for empty) ──
  const selectSlot = useCallback((index: number, slot: ContentSlot | null) => {
    // No-op: choosing the already-active slot does nothing
    if (activeSlotIndex === index) return;

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    // Flush: synchronously save current slot before switching
    if (activeSlotIndex !== null) {
      isSavingRef.current = true;
      const fullState: SlotState = {
        variableValues: { ...latestRef.current.variableValues },
        customStyles: { ...latestRef.current.customStyles },
        position: latestRef.current.position,
        animationIn: latestRef.current.animationIn,
        exitStyle: latestRef.current.exitStyle,
      };
      saveSlot(theme.id, editorId, activeSlotIndex, latestRef.current.variableValues, theme, fullState);
      isSavingRef.current = false;
    }

    saveActiveSlotIndex(theme.id, editorId, index);
    setActiveSlotIndex(index);
    const freshSlots = loadSlots(theme.id, editorId);
    setSlots(freshSlots);
    skipAutoSaveRef.current = true;

    const targetSlot = freshSlots[index] || slot;
    if (targetSlot) {
      // Filled slot: load its saved data into the editor
      handleRecallSlot(targetSlot);
    } else {
      // Empty slot: select it with default values
      const init: Record<string, string> = {};
      for (const v of theme.variables) {
        init[v.key] = v.defaultValue ?? "";
      }
      setVariableValues(init);
      setCustomStyles({ ...LT_DEFAULT_CUSTOM_STYLE });
      setPosition("bottom-left");
      setAnimationIn((theme.animation?.name as LTAnimationIn) || "slide-left");
      setExitStyle("fade");
      setSelectedSpeakerIdx(null);
    }
  }, [activeSlotIndex, theme, handleRecallSlot]);

  const handleSlotClick = useCallback((index: number, slot: ContentSlot | null, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    selectSlot(index, slot);
  }, [selectSlot]);

  // ── Slot right-click: always open menu ──
  const handleSlotContextMenu = useCallback((e: React.MouseEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openContextMenu(index, rect.right + 4, rect.top);
  }, [openContextMenu]);

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (renamingSlotIndex !== null && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingSlotIndex]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        closeContextMenu();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [contextMenu, closeContextMenu]);

  // Close context menu on Escape
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeContextMenu();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [contextMenu, closeContextMenu]);

  // ── Send / Blank handlers ──
  const handleSend = useCallback((options?: { bypassSceneRoute?: boolean }) => {
    const overlayExitStyle = exitStyle === "fade" ? undefined : exitStyle;
    const url = buildOverlayUrl(
      theme,
      withThemeDefaults(theme, variableValues),
      true,
      false,
      kineticTheme ? "lg" : size,
      customStyles,
      undefined as LTFontSize | undefined,
      position,
      undefined,
      undefined,
      animationIn,
      overlayExitStyle,
    );
    onSend(url, options);
  }, [theme, variableValues, customStyles, position, animationIn, exitStyle, size, onSend, kineticTheme]);

  const handleAnimateOut = useCallback(() => {
    if (!onAnimateOut) return;
    const overlayExitStyle = exitStyle === "fade" ? undefined : exitStyle;
    const url = buildOverlayUrl(
      theme,
      withThemeDefaults(theme, variableValues),
      false,
      true,
      kineticTheme ? "lg" : size,
      customStyles,
      undefined as LTFontSize | undefined,
      position,
      undefined,
      undefined,
      animationIn,
      overlayExitStyle,
    );
    onAnimateOut(url);
  }, [theme, variableValues, customStyles, position, animationIn, exitStyle, size, onAnimateOut, kineticTheme]);

  // ── Keyboard shortcuts (only while this editor is on screen) ──
  //   1 to 7 ........................ pick a saved slot (same as clicking its number)
  //   P ............................. open Preview
  //   Ctrl/Cmd + Enter .............. Send to OBS
  //   Ctrl/Cmd + Shift + Enter ...... Animate Out
  // The digits and P are ignored while typing in a field. The two on-air actions need Ctrl/Cmd so they are never
  // hit by accident, and they work from inside a text field. The dock's own Ctrl/Cmd + 1 to 6 tab keys, Ctrl/Cmd + F
  // and Alt + Shift + K/T// are taken before this runs, so none of these clash with them.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (!isDockTabVisible(layoutRef.current)) return;
      if (showPreview || contextMenu || document.querySelector('[aria-modal="true"]')) return;

      const primary = event.metaKey || event.ctrlKey;
      if (primary && event.key === "Enter") {
        if (event.altKey) return;
        event.preventDefault();
        if (sending) return;
        if (event.shiftKey) {
          if (onAnimateOut) handleAnimateOut();
        } else {
          // Press the real Send button, so a routed scene still asks the same question as a click does.
          layoutRef.current?.querySelector<HTMLButtonElement>(".dock-lt-send-btn")?.click();
        }
        return;
      }

      if (primary || event.altKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;

      if (/^[1-7]$/.test(event.key)) {
        const index = Number(event.key) - 1;
        if (index < slots.length) {
          event.preventDefault();
          selectSlot(index, slots[index]);
        }
        return;
      }
      if (event.key.toLowerCase() === "p") {
        event.preventDefault();
        setShowPreview(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showPreview, contextMenu, sending, slots, selectSlot, onAnimateOut, handleAnimateOut]);

  return (
    <div className="dock-lt-editor-layout" ref={layoutRef}>
      {/* ── Preview (fixed top) ── */}


      {/* ── Scrollable settings ── */}
      <div className="dock-lt-editor-layout__scroll">
        {isCurrentThemeSpeaker && showSpeakerHint && speakers.length > 0 && (
          <div style={{
            background: "var(--dock-accent-soft)",
            border: "1px solid var(--dock-accent-soft-border)",
            borderRadius: 3,
            padding: "6px 8px",
            marginBottom: 6,
            fontSize: 10,
            color: "var(--dock-text-dim)",
            lineHeight: 1.4,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <span style={{ flex: 1 }}>
                {t("lowerThird.speakerDetected")}
              </span>
              <button
                type="button"
                onClick={dismissSpeakerHint}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--dock-text-dim)",
                  cursor: "pointer",
                  padding: 0,
                  fontSize: 12,
                  lineHeight: 1,
                  flexShrink: 0,
                }}
                title={t("common.close")}>
                <Icon name="close" size={12} />
              </button>
            </div>
          </div>
        )}

        {/* ── Speaker Quick Select (only for speaker themes; Motion straps show it in DockMotionControls) ── */}
        {isCurrentThemeSpeaker && !kineticTheme && speakers.length > 0 && (
          <div style={{ padding: "0 0 6px" }}>
            <label style={{ fontSize: 10, color: "var(--dock-text-dim)", display: "block", marginBottom: 4 }}>
              {t("lowerThird.speaker")}
            </label>
            {speakers.length > 0 ? (
              <select
                value={selectedSpeakerIdx ?? ""}
                onChange={(e) => {
                  const idx = Number(e.target.value);
                  setSelectedSpeakerIdx(Number.isNaN(idx) ? null : idx);
                }}
                style={{
                  width: "100%",
                  background: "var(--dock-surface)",
                  border: "1px solid var(--dock-border)",
                  borderRadius: 3,
                  padding: "4px 6px",
                  fontSize: 11,
                  color: "var(--dock-text)",
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                <option value="">—</option>
                {speakers.map((sp, i) => (
                  <option key={`${sp.name}-${i}`} value={i}>
                    {sp.name}{sp.isMain ? " ★" : ""}{sp.role ? ` — ${sp.role}` : ""}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        )}

        {/* ── Lower Third Customization Card ── */}
        <div className="dock-lt-config-content">
          {/* Accordion Header */}


          {/* Hidable Content */}
          <div className={`dock-lt-hidable${cardsOpen ? " dock-lt-hidable--open" : ""}`}>
            {/* Grid Container */}


            {/* First Edit Container: Logo + Textfields */}
            <div
              className={`dock-lt-first-edit${hasLogoVariable ? "" : " dock-lt-first-edit--no-logo"}`}
              // Graphics have many fields: picture on its own full-width row, fields below at full width.
              style={graphicsTheme ? { display: "flex", flexDirection: "column", alignItems: "stretch", gap: 8 } : undefined}
            >
              {hasLogoVariable && imageVariable && (
                <>
                  <input
                    ref={imageFileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={handleImageFileInput}
                  />
                  <div
                    className={`dock-lt-logo-container dock-lt-image-picker${imageDragOver ? " dock-lt-image-picker--dragover" : ""}`}
                    onClick={() => imageFileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setImageDragOver(true); }}
                    onDragLeave={() => setImageDragOver(false)}
                    onDrop={handleImageDrop}
                    onMouseEnter={() => setImageHovered(true)}
                    onMouseLeave={() => setImageHovered(false)}
                    aria-busy={imageUploading}
                    style={graphicsTheme ? { width: "100%", minWidth: 0, height: 76, flex: "none", aspectRatio: "auto" } : undefined}
                  >
                    {(imagePreviewUrl || variableValues[imageVariable.key]) ? (
                      <>
                        <img
                          src={imagePreviewUrl || variableValues[imageVariable.key]}
                          alt=""
                          style={graphicsTheme ? { width: "100%", height: "100%", objectFit: "contain" } : undefined}
                        />
                        {imageHovered && (
                          <div className="dock-lt-image-picker-overlay">
                            <button
                              type="button"
                              className="dock-lt-image-picker-action"
                              onClick={(e) => { e.stopPropagation(); imageFileInputRef.current?.click(); }}
                            >
                              <Camera size={14} />
                              <span>{t("common.change", "Change")}</span>
                            </button>
                            <button
                              type="button"
                              className="dock-lt-image-picker-action dock-lt-image-picker-action--remove"
                              onClick={(e) => { e.stopPropagation(); handleImageRemove(); }}
                            >
                              <X size={14} />
                              <span>{t("common.remove", "Remove")}</span>
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="dock-lt-image-picker-empty">
                        <ImagePlus size={20} color="var(--dock-text-dim)" />
                        <span className="dock-lt-image-picker-empty-text">{t("lowerThird.dropImageOrClick", "Drop image or click")}</span>
                      </div>
                    )}
                  </div>
                </>
              )}
              <div className="dock-lt-textfields" style={graphicsTheme ? { width: "100%", minWidth: 0 } : undefined}>
                {isGivingBoard && (
                  <GivingBankFields
                    values={variableValues}
                    defaults={themeDefaultValues}
                    onChange={(patch) => setVariableValues((prev) => ({ ...prev, ...patch }))}
                  />
                )}
                {/* Dynamic fields from theme variables (text/list types, excluding image/logo variables) */}
                {theme.variables
                  .filter((v) => {
                    if (v.type !== "text" && v.type !== "list") return false;
                    // The giving board's bank, number and logo fields are the bank rows above.
                    if (isGivingBoard && isGivingBankFieldKey(v.key)) return false;
                    // Skip variables managed by the image picker
                    const key = v.key.toLowerCase();
                    const label = (v.label ?? "").toLowerCase();
                    if (key.includes("logo") || key.includes("image") || label.includes("logo") || label.includes("image")) return false;
                    // "Seconds per platform" is timing, not text: it sits with Cycles and Speed in the motion controls.
                    if (v.key === PER_KEY && isCycleTheme(theme)) return false;
                    return true;
                  })
                  .map((v, idx) => {
                    void idx;
                    // Multi-pick list with known options (e.g. social icons): toggle chips, kept as a comma list.
                    if (v.type === "list" && Array.isArray(v.options) && v.options.length) {
                      const picked = String(variableValues[v.key] ?? "").split(/[\s,]+/).filter(Boolean);
                      return (
                        <div className="dock-lt-field-row" key={v.key} style={{ display: "block" }}>
                          <label style={dockFieldLabelStyle}>{(v.label || v.key).replace(/\s*\(comma list\)/i, "")}</label>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {v.options.map((opt) => {
                              const on = picked.includes(opt.value);
                              return (
                                <button
                                  key={opt.value}
                                  type="button"
                                  onClick={() => {
                                    const next = on ? picked.filter((p) => p !== opt.value) : [...picked, opt.value];
                                    setVariableValues((prev) => ({ ...prev, [v.key]: next.join(",") }));
                                  }}
                                  style={{
                                    padding: "3px 8px",
                                    borderRadius: 999,
                                    fontSize: 10,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    border: `1px solid ${on ? "var(--dock-accent, var(--primary))" : "var(--dock-border)"}`,
                                    background: on ? "color-mix(in srgb, var(--dock-accent, var(--primary)) 22%, transparent)" : "transparent",
                                    color: on ? "var(--dock-text)" : "var(--dock-text-dim)",
                                  }}
                                >
                                  {opt.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }
                    const guide = describeField(v);
                    const resetTo = themeDefaultValues[v.key] ?? "";
                    const canReset = (variableValues[v.key] ?? "") !== resetTo;
                    return (
                      <div className="dock-lt-field-row" key={v.key} style={{ display: "block" }}>
                        <div style={dockFieldHeadStyle}>
                          <label style={{ ...dockFieldLabelStyle, margin: 0 }} htmlFor={`dock-lt-field-${v.key}`} title={guide.hint || undefined}>
                            {guide.heading}
                          </label>
                          {canReset && (
                            <button
                              type="button"
                              style={dockFieldResetStyle}
                              title="Put this box back to its default text"
                              onClick={() => setVariableValues((prev) => ({ ...prev, [v.key]: resetTo }))}
                            >
                              Reset
                            </button>
                          )}
                        </div>
                        {(v.multiline
                          || looksLikeLongTextField(v.key, v.label || "")
                          || (variableValues[v.key] ?? "").length > 60) ? (
                          <textarea
                            id={`dock-lt-field-${v.key}`}
                            className="dock-lt-field-input"
                            rows={6}
                            style={{ width: "100%", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit", lineHeight: 1.45, minHeight: 130 }}
                            value={variableValues[v.key] ?? ""}
                            onChange={(e) => setVariableValues((prev) => ({ ...prev, [v.key]: e.target.value }))}
                            placeholder={guide.heading}
                          />
                        ) : (
                          <input
                            id={`dock-lt-field-${v.key}`}
                            className="dock-lt-field-input"
                            type="text"
                            style={{ width: "100%", boxSizing: "border-box" }}
                            value={variableValues[v.key] ?? ""}
                            onChange={(e) => setVariableValues((prev) => ({ ...prev, [v.key]: e.target.value }))}
                            placeholder={guide.heading}
                          />
                        )}
                        {/* Case / size / weight make no sense on a number such as "Seconds per platform". */}
                        {isNumericField(v, themeDefaultValues[v.key]) ? null : (
                          <TextStyleControls
                            compact
                            value={variableValues[textStyleKey(v.key)]}
                            capability={textStyleCapabilityFor(theme)}
                            onChange={(next) => setVariableValues((prev) => ({ ...prev, [textStyleKey(v.key)]: next }))}
                          />
                        )}
                        {guide.hint ? <div style={dockFieldHintStyle}>{guide.hint}</div> : null}
                      </div>
                    );
                  })}
                {/* Select-type variables as dropdowns (skip internal animation controls) */}
                {theme.variables
                  .filter((v) => v.type === "select" && v.key !== "state" && v.key !== "animMode")
                  .map((v) => (
                    <div className="dock-lt-field-row" key={v.key} style={graphicsTheme ? { display: "block" } : undefined}>
                      {graphicsTheme && (
                        <label style={dockFieldLabelStyle} htmlFor={`dock-lt-field-${v.key}`}>{v.label || v.key}</label>
                      )}
                      <select
                        id={`dock-lt-field-${v.key}`}
                        className="dock-lt-field-input"
                        style={graphicsTheme ? { width: "100%", boxSizing: "border-box" } : undefined}
                        value={variableValues[v.key] ?? ""}
                        onChange={(e) => setVariableValues((prev) => ({ ...prev, [v.key]: e.target.value }))}
                      >
                        {!graphicsTheme && <option value="">{v.label || v.key}</option>}
                        {(v.options ?? []).map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                {/* Number-type variables */}
                {theme.variables
                  .filter((v) => v.type === "number" && !v.key.startsWith("kx"))
                  .map((v) => (
                    <div className="dock-lt-field-row" key={v.key}>
                      <input
                        className="dock-lt-field-input"
                        type="number"
                        value={variableValues[v.key] ?? ""}
                        onChange={(e) => setVariableValues((prev) => ({ ...prev, [v.key]: e.target.value }))}
                        placeholder={v.label || v.key}
                      />
                    </div>
                  ))}
              </div>
            </div>

            {kineticTheme ? (
              <DockMotionControls
                theme={theme}
                speakers={speakers}
                selectedSpeakerIdx={selectedSpeakerIdx}
                onSelectSpeaker={setSelectedSpeakerIdx}
                values={variableValues}
                onValueChange={(key, value) => setVariableValues((prev) => ({ ...prev, [key]: value }))}
                position={position}
                onPositionChange={setPosition}
              />
            ) : (
            <div
              style={{
                marginTop: 6,
                padding: 8,
                border: "1px solid var(--dock-border)",
                borderRadius: 4,
                background: "var(--dock-surface)",
              }}
            >
              <div style={{ display: "flex", alignItems: "stretch", justifyContent: "space-between", gap: 8, marginBottom: appearanceOpen ? 7 : 0 }}>
                <button
                  type="button"
                  aria-expanded={appearanceOpen}
                  aria-controls={LT_APPEARANCE_PANEL_ID}
                  onClick={() => setAppearanceOpen((open) => !open)}
                  style={{
                    display: "flex",
                    flex: 1,
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    minWidth: 0,
                    padding: 0,
                    border: 0,
                    background: "transparent",
                    color: "inherit",
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: "var(--dock-text)", textTransform: "uppercase", letterSpacing: 0.3 }}>
                      {t("lowerThird.appearance", "Appearance")}
                    </div>
                    <div style={{ fontSize: 9, color: "var(--dock-text-dim)", marginTop: 2 }}>
                      {t("lowerThird.appearanceDesc", "Adjust the live lower-third colors.")}
                    </div>
                  </div>
                  <Icon name={appearanceOpen ? "expand_less" : "expand_more"} size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setCustomStyles((prev) => withoutLtAppearanceColors(prev))}
                  style={{
                    border: "1px solid var(--dock-border)",
                    borderRadius: 3,
                    background: "var(--dock-input-bg)",
                    color: "var(--dock-text-dim)",
                    cursor: "pointer",
                    fontSize: 10,
                    padding: "2px 6px",
                    flexShrink: 0,
                  }}
                >
                  {t("common.reset", "Reset")}
                </button>
              </div>
              {appearanceOpen && (
                <div
                  id={LT_APPEARANCE_PANEL_ID}
                  role="region"
                  aria-label={t("lowerThird.appearance", "Appearance")}
                  style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}
                >
                  {LT_APPEARANCE_COLOR_CONTROLS.map((control) => {
                    const explicitColor = getLtAppearanceColor(customStyles, control.key);
                    const baseColor = control.key === "accentColor" ? theme.accentColor : control.fallback;
                    const effectiveColor = sanitizeLtColor(explicitColor) ?? sanitizeLtColor(baseColor) ?? control.fallback;
                    return (
                      <label
                        key={control.key}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 26px",
                          alignItems: "center",
                          gap: 5,
                          minWidth: 0,
                        }}
                      >
                        <span style={{ fontSize: 9, color: "var(--dock-text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {t(`lowerThird.color.${control.key}`, control.label)}
                        </span>
                        <input
                          type="color"
                          value={ltColorInputValue(explicitColor || effectiveColor, control.fallback)}
                          onChange={(event) => setCustomStyles((prev) => withLtAppearanceColor(prev, control.key, event.target.value))}
                          title={control.label}
                          style={{
                            width: 26,
                            height: 22,
                            border: "1px solid var(--dock-border)",
                            borderRadius: 3,
                            background: "transparent",
                            padding: 0,
                            cursor: "pointer",
                          }}
                        />
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
            )}

          </div>
        </div>







      </div>{/* /scroll */}

      {/* ── Action Buttons (fixed bottom) ── */}
      <div className="dock-lt-editor-layout__bar">
            {/* Saved slots + Reset all: kept in the pinned bar so they are always reachable */}
            <div className="dock-lt-panel-bottom dock-lt-panel-bottom--in-bar">
              <button
                type="button"
                onClick={() => {
                  if (autoSaveTimerRef.current) {
                    clearTimeout(autoSaveTimerRef.current);
                    autoSaveTimerRef.current = null;
                  }
                  setVariableValues({ ...themeDefaultValues });
                  setCustomStyles({ ...LT_DEFAULT_CUSTOM_STYLE });
                  setPosition("bottom-left");
                  setAnimationIn((theme.animation?.name as LTAnimationIn) || "slide-left");
                  setExitStyle("fade");
                  setSelectedSpeakerIdx(null);
                  if (activeSlotIndex !== null) {
                    deleteSlot(theme.id, editorId, activeSlotIndex);
                    reloadSlots();
                  }
                }}
                style={{
                  background: "var(--dock-input-bg)",
                  border: "1px solid var(--dock-border)",
                  borderRadius: 3,
                  color: "var(--dock-text-dim)",
                  cursor: "pointer",
                  padding: "2px 6px",
                  fontSize: 10,
                  fontFamily: "inherit",
                }}
              >
                <RotateCcw size={12} style={{ marginRight: 2 }} />
                Reset all
              </button>

              <ul className="dock-lt-memory-slots">
                {slots.map((slot, idx) => (
                  <li
                    key={idx}
                    className={`dock-lt-slot${activeSlotIndex === idx ? " dock-lt-slot--active" : ""}${slot ? " dock-lt-slot--filled" : " dock-lt-slot--empty"}`}
                    title={`${slot?.label ? `${slot.label} · ` : ""}Press ${idx + 1}`}
                    onClick={(e) => handleSlotClick(idx, slot, e)}
                    onContextMenu={(e) => handleSlotContextMenu(e, idx)}
                  >
                    {idx + 1}
                  </li>
                ))}
              </ul>


            </div>
        <button
          type="button"
          className="dock-btn dock-btn--sm dock-lt-preview-btn"
          onClick={() => setShowPreview(true)}
          title="Preview this lower third with your text and styles (nothing is sent to OBS) · P"
        >
          <Icon name="visibility" size={14} />
          <span>Preview</span>
        </button>
        <DockSceneRouteSendControl
          route={sceneRoute}
          onRouteChange={onUpdateSceneRoute}
          onSend={handleSend}
          sending={sending}
          disabled={sending}
          className="dock-btn dock-btn--sm dock-btn--primary dock-lt-send-btn"
          shortcutHint={`${PRIMARY_KEY_LABEL}+Enter`}
          style={{ flex: 1 }}
        />
        {onAnimateOut && (
          <button
            type="button"
            className={`dock-btn dock-btn--sm ${sending ? "dock-btn--loading" : ""}`}
            onClick={handleAnimateOut}
            disabled={sending}
            title={`${t("lowerThird.animateOut")} · ${PRIMARY_KEY_LABEL}+Shift+Enter`}>
            <Icon name="animation" size={14} />
            <span>{t("lowerThird.animateOut")}</span>
          </button>
        )}
      </div>

      {showPreview && (
        <DockGraphicPreviewModal
          theme={theme}
          values={variableValues}
          onClose={() => setShowPreview(false)}
          onSend={sending ? undefined : handleSend}
        />
      )}

      {/* ── Slot Context Menu ── */}
      {contextMenu && (
        <div
          ref={(el) => { contextMenuRef.current = el; fitPopover(el); }}
          className="dock-lt-slot-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {renamingSlotIndex === contextMenu.slotIndex ? (
            /* ── Inline rename mode ── */
            <div className="dock-lt-slot-context-rename">
              <input
                ref={renameInputRef}
                className="dock-lt-slot-rename-input"
                type="text"
                value={renamingSlotName}
                onChange={(e) => setRenamingSlotName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameSlot(contextMenu.slotIndex);
                  if (e.key === "Escape") closeContextMenu();
                }}
                placeholder={t("lowerThird.slotRenamePlaceholder")}
                maxLength={30}
              />
              <div className="dock-lt-slot-rename-actions">
                <button
                  className="dock-lt-slot-context-item"
                  onClick={() => handleRenameSlot(contextMenu.slotIndex)}
                >
                  <Icon name="check" size={14} />
                  {t("common.confirm")}
                </button>
                <button
                  className="dock-lt-slot-context-item"
                  onClick={closeContextMenu}
                >
                  <Icon name="close" size={14} />
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          ) : (
            /* ── Normal menu ── */
            <>
              {slots[contextMenu.slotIndex] && (
                <button
                  className="dock-lt-slot-context-item"
                  onClick={() => {
                    handleRecallSlot(slots[contextMenu.slotIndex]!);
                    closeContextMenu();
                  }}
                >
                  <Icon name="open_in_new" size={14} />
                  {t("lowerThird.slotLoad")}
                </button>
              )}
              {slots[contextMenu.slotIndex] && (
                <button
                  className="dock-lt-slot-context-item"
                  onClick={() => {
                    setRenamingSlotIndex(contextMenu.slotIndex);
                    setRenamingSlotName(slots[contextMenu.slotIndex]?.label ?? "");
                  }}
                >
                  <Icon name="edit" size={14} />
                  {t("lowerThird.slotRename")}
                </button>
              )}
              {slots[contextMenu.slotIndex] && (
                <button
                  className="dock-lt-slot-context-item dock-lt-slot-context-item--danger"
                  onClick={() => {
                    handleDeleteSlot(contextMenu.slotIndex);
                    closeContextMenu();
                  }}
                >
                  <Icon name="delete" size={14} />
                  {t("lowerThird.slotClear")}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
