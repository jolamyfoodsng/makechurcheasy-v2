/**
 * DockMinistryTab.tsx — Ministry tab for the MakeChurchEazy Dock
 *
 * Sub-tabs:
 *   1. Lower Thirds — send/blank lower-third overlays via OBS
 *   2. Time — countdowns, timers, and clocks
 *   3. Tickers — push scrolling ticker announcements to OBS
 *
 * Uses dockObsClient for OBS communication (same WebSocket
 * connection shared across all dock tabs).
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { dockObsClient } from "../dockObsClient";
import { ensureObsConnected } from "../obsConnectionGuard";
import type { DockStagedItem } from "../dockTypes";
import type { DockPresentationOutputTarget } from "../dockPresentationTarget";
import { isPresentationLinkTarget } from "../dockPresentationTarget";
import Icon from "../DockIcon";
import { LT_ALL_THEMES } from "../../lowerthirds/themes";
import { loadDockGraphicsPolicy, loadDockLTFavorites, loadDockSavedGraphics, loadDockTickerFavorites } from "../dockThemeData";
import { BROADCAST_GRAPHICS_CATALOG_UPDATED_EVENT } from "../../services/broadcastGraphicsCatalog";
import { BROADCAST_GRAPHICS_UPDATED_EVENT, buildSavedGraphicTheme } from "../../services/broadcastGraphicsStorage";
import { FAVORITE_THEMES_UPDATED_EVENT } from "../../services/favoriteThemes";
import { dockClient } from "../../services/dockBridge";
import { trackGraphicUsage } from "../../services/tracking";
import type { LowerThirdTheme } from "../../lowerthirds/types";
import type { LTSize } from "../../lowerthirds/types";
import { applyTextCase, TEXT_CASE_CONVERSIONS } from "../../lowerthirds/textStyle";
import { LT_SIZE_FONT_SCALE, LT_SIZE_LABELS } from "../../lowerthirds/types";
import type { BibleTheme } from "../../bible/types";
import type { BibleThemeSettings } from "../../bible/types";
import type { TickerThemeColors } from "../../components/modules/tickerThemes";
import allThemesData from "../../../lower_thirds/all_themes.json";
import DockSceneRoutingControl from "../components/DockSceneRoutingControl";
import DockLowerThirdEditor from "./DockLowerThirdEditor";
import DockTimeTab from "./DockTimeTab";
import DockSearchableSelect from "../components/DockSearchableSelect";
import DockThemePreviewFrame from "../components/DockThemePreviewFrame";
import { buildThemePreviewHtml, obsPreviewSandbox, type BroadcastTheme } from "../../lowerthirds/broadcastPreviewHtml";
import { requireEntitlement, getDockPlan, showUpgradeModal, getDockEntitlementLimit, refreshDockPlanNow } from "../dockEntitlement";
import { getStoredLocalDevPlanOverride } from "../../services/localDevPlanOverride";
import { checkEntitlementSync } from "../../services/entitlementClient";
import { getUserScopedKey } from "../../services/userScopedStorage";
import { readNativeDockSetting, writeNativeDockSetting } from "../../services/localDockSettings";
import { copyEditorSlots, deleteEditorSlots } from "../../lowerthirds/contentSlots";
import {
  canAddLtTab,
  cloneLtTab,
  closeLtTab,
  createFirstLtTab,
  FIRST_LT_TAB_ID,
  ltTabEditorId,
  ltTabLimitForPlan,
  MINISTRY_LT_TABS_STORAGE_KEY,
  newLtTabId,
  parseLtTabs,
  updateLtTab,
  usableLtTabs,
  type MinistryLtTab,
} from "../ministryLtTabs";
import { getSettings } from "../../multiview/mvStore";
import { normalizeBrandColor } from "../../lowerthirds/runtimeBranding";
import { loadProjectionSettings, saveProjectionSettings } from "../dockProjectionSettings";
import { resolveOverlayAssetUrl } from "../../services/overlayUrl";
import { loadDockOutputFontFamily } from "../dockOutputTypography";
import {
  clearPresentationScreen,
  publishTickerToPresentation,
  publishGraphicToPresentation,
  clearGraphicFromPresentation,
} from "../../services/presentationPublish";
import {
  DEFAULT_DOCK_TICKER_THEME_OPTION,
  formatDockTickerMessages,
  getDockTickerThemeOptionsForFavorites,
  isDockTickerBlocked,
  setDockTickerAdminPolicy,
  renderDockTickerThemeHtml,
  probeHtmlTickerColors,
  resolveDockTickerDividerChar,
  resolveDockTickerThemeOption,
  type DockTickerDivider,
} from "../tickerThemeCatalog";
import {
  REMOTE_PRODUCTION_THEMES_UPDATED_EVENT,
  fetchRemoteProductionThemes,
  getCachedRemoteProductionThemes,
  mergeRemoteLowerThirdThemes,
  type RemoteProductionTheme,
} from "../../services/remoteProductionThemes";
import { loadDockSceneRoute, useDockSceneRoute } from "../dockSceneRouting";
import DockSceneRouteSendControl from "../components/DockSceneRouteSendControl";

const ALL_LT_THEMES: LowerThirdTheme[] = [
  ...LT_ALL_THEMES,
  ...((allThemesData.themes as unknown as LowerThirdTheme[]) || [])
    .map((t) => t)
    .filter(
      (t) => !LT_ALL_THEMES.some((lt) => lt.id === t.id),
    ),
];

// Tagged union: supports both LowerThirdTheme (HTML template) and BibleTheme (CSS overlay)
interface LTThemeEntry {
  kind: "lt";
  theme: LowerThirdTheme;
  label: string;
  /** A graphic the user saved in Broadcast Graphics → My Graphics. */
  custom?: boolean;
  /** Library template the theme was made from (for usage tracking). */
  templateId?: string;
}
interface BibleThemeEntry {
  kind: "bible";
  theme: BibleTheme;
  label: string;
}
type MixedLTThemeEntry = LTThemeEntry | BibleThemeEntry;

const MINISTRY_LT_SIZE_OPTIONS: LTSize[] = ["xs", "sm", "md", "lg"];
const DEFAULT_MINISTRY_LT_SIZE: LTSize = "sm";
const MINISTRY_BIBLE_LT_SIZE_PRESETS: Record<LTSize, string> = {
  xs: "smallest",
  sm: "small",
  md: "medium",
  lg: "bigger",
  xl: "big",
  "2xl": "bigger",
  "3xl": "biggest",
  x2: "biggest",
  x3: "biggest",
};

function resolveMinistryLtSize(value: unknown): LTSize {
  return MINISTRY_LT_SIZE_OPTIONS.includes(value as LTSize) ? (value as LTSize) : DEFAULT_MINISTRY_LT_SIZE;
}

interface TickerMessage {
  id: string;
  text: string;
  active: boolean;
}

type TickerColorOverrides = Partial<TickerThemeColors>;
type TickerColorKey = keyof TickerThemeColors;

interface TickerSettings {
  speed: number;
  position: "top" | "bottom";
  loop: boolean;
  themeId: string;
  heading: string;
  /** Pill tickers: heading text or the live time. */
  headingMode: "text" | "time";
  messageSpacing: number;
  divider: DockTickerDivider;
  colors: TickerColorOverrides;
}

interface TickerBranding {
  logoUrl: string;
  brandName: string;
  brandColor: string;
}

type BibleLtColorKey =
  | "fontColor"
  | "refFontColor"
  | "backgroundColor"
  | "boxBackground"
  | "referenceBackgroundColor";
type BibleLtColorOverrides = Partial<Pick<BibleThemeSettings, BibleLtColorKey>>;
type BibleLtColorOverrideMap = Record<string, BibleLtColorOverrides>;

interface Props {
  staged: DockStagedItem | null;
  onStage: (item: DockStagedItem | null) => void;
  presentationOutputTarget?: DockPresentationOutputTarget;
  hideTickerControls?: boolean;
  hideLowerThirdControls?: boolean;
}

const STORAGE_KEY = "dock-ticker-messages";
const SETTINGS_KEY = "dock-ticker-settings";
const BIBLE_LT_COLOR_OVERRIDES_KEY = "dock-bible-lt-color-overrides";
const MINISTRY_LT_SIZE_STORAGE_KEY = "dock-ministry-lower-third-size";
const MINISTRY_LT_THEME_STORAGE_KEY = "dock-ministry-lower-third-theme";
/** "shared": all tabs use one OBS source; "per-tab": each tab has its own (they can be on screen together). */
const MINISTRY_LT_SOURCE_MODE_KEY = "dock-ministry-lower-third-source-mode";
type LtSourceMode = "shared" | "per-tab";
const ltEntryKey = (entry: MixedLTThemeEntry) => `${entry.kind}:${entry.theme.id}:${entry.label}`;
const MAX_CHARS = 140;
const TICKER_HEIGHT = 80;
const TICKER_MESSAGE_SPACING_MAX = 100;
const TICKER_COLOR_POPOVER_WIDTH = 270;
const COLOR_INPUT_FALLBACK = "#4f46e5";
const TICKER_COLOR_INPUT_FALLBACKS: Record<TickerColorKey, string> = {
  accent: "#4f46e5",
  accentText: "#ffffff",
  barBg: "#0f172a",
  barText: "#ffffff",
  separator: "#f97316",
};
const TICKER_COLOR_CONTROLS: Array<{ key: TickerColorKey; label: string }> = [
  { key: "accent", label: "Heading background" },
  { key: "accentText", label: "Heading text" },
  { key: "barText", label: "Ticker text" },
  { key: "barBg", label: "Ticker background" },
  { key: "separator", label: "Separator" },
];
const TICKER_DIVIDER_OPTIONS: Array<{ value: DockTickerDivider; label: string; icon: string }> = [
  { value: "theme", label: "Theme default", icon: "palette" },
  { value: "none", label: "No divider", icon: "close" },
  { value: "dot", label: "Dot", icon: "fiber_manual_record" },
  { value: "line", label: "Line", icon: "remove" },
  { value: "diamond", label: "Diamond", icon: "diamond" },
  { value: "spark", label: "Spark", icon: "auto_awesome" },
];
const BIBLE_LT_COLOR_CONTROLS: Array<{ key: BibleLtColorKey; label: string; fallback: string }> = [
  { key: "fontColor", label: "Text", fallback: "#ffffff" },
  { key: "refFontColor", label: "Reference", fallback: "#f8fafc" },
  { key: "backgroundColor", label: "Screen background", fallback: "#000000" },
  { key: "boxBackground", label: "Lower-third bar", fallback: "#111827" },
  { key: "referenceBackgroundColor", label: "Reference badge", fallback: "#f97316" },
];
const EMPTY_BIBLE_LT_OVERRIDES: BibleLtColorOverrides = {};

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function loadMessages(): TickerMessage[] {
  try {
    const raw = localStorage.getItem(getUserScopedKey(STORAGE_KEY));
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function saveMessages(msgs: TickerMessage[]) {
  try { localStorage.setItem(getUserScopedKey(STORAGE_KEY), JSON.stringify(msgs)); } catch { /* ignore */ }
}

function sanitizeCssColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, 80);
  if (!trimmed) return undefined;
  if (/[;{}<>]/.test(trimmed)) return undefined;
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed)) return trimmed;
  if (/^rgba?\(\s*(?:\d{1,3}\s*,\s*){2}\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(trimmed)) return trimmed;
  if (/^hsla?\(\s*\d{1,3}(?:deg)?\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(trimmed)) return trimmed;
  return undefined;
}

function colorInputValue(value: unknown, fallback: string = COLOR_INPUT_FALLBACK): string {
  const color = sanitizeCssColor(value);
  if (!color) return fallback;
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (!hex) return fallback;
  if (hex.length === 3) {
    return `#${hex.split("").map((char) => char + char).join("")}`.toLowerCase();
  }
  return `#${hex}`.toLowerCase();
}

/**
 * Hex / rgb text field for a ticker colour. Keeps what you type in a local draft so a half-typed value
 * ("#47") isn't wiped, and only saves it once it is a valid colour. Clearing the field removes the override.
 */
function TickerColorTextInput({
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  // Follow outside changes (the colour swatch, Reset) while the field isn't being typed in.
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);
  const invalid = draft.trim() !== "" && !sanitizeCssColor(draft);
  return (
    <input
      type="text"
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        if (next.trim() === "" || sanitizeCssColor(next)) onCommit(next);
      }}
      onBlur={() => {
        setFocused(false);
        setDraft(value);
      }}
      placeholder={placeholder}
      spellCheck={false}
      aria-invalid={invalid || undefined}
      style={{
        minWidth: 0,
        height: 24,
        background: "var(--dock-surface, #111827)",
        border: `1px solid ${invalid ? "#ef4444" : "var(--dock-border, #334155)"}`,
        borderRadius: 3,
        color: "var(--dock-text, #f8fafc)",
        fontFamily: "inherit",
        fontSize: 10,
        padding: "0 6px",
      }}
    />
  );
}

function loadTickerColorOverrides(raw: unknown): TickerColorOverrides {
  if (!raw || typeof raw !== "object") return {};
  const source = raw as Record<string, unknown>;
  const next: TickerColorOverrides = {};
  for (const { key } of TICKER_COLOR_CONTROLS) {
    const color = sanitizeCssColor(source[key]);
    if (color) next[key] = color;
  }
  return next;
}

function loadBibleLtColorOverrides(): BibleLtColorOverrideMap {
  try {
    const raw = readNativeDockSetting<unknown>(BIBLE_LT_COLOR_OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>;
    const next: BibleLtColorOverrideMap = {};
    for (const [themeId, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") continue;
      const source = value as Record<string, unknown>;
      const overrides: BibleLtColorOverrides = {};
      for (const { key } of BIBLE_LT_COLOR_CONTROLS) {
        const color = sanitizeCssColor(source[key]);
        if (color) overrides[key] = color;
      }
      if (Object.keys(overrides).length > 0) next[themeId] = overrides;
    }
    return next;
  } catch {
    return {};
  }
}

function saveBibleLtColorOverrides(value: BibleLtColorOverrideMap) {
  writeNativeDockSetting(BIBLE_LT_COLOR_OVERRIDES_KEY, value);
}

function loadMinistryLtSize(): LTSize {
  const saved = readNativeDockSetting<unknown>(MINISTRY_LT_SIZE_STORAGE_KEY);
  if (MINISTRY_LT_SIZE_OPTIONS.includes(saved as LTSize)) return saved as LTSize;
  return resolveMinistryLtSize(getSettings().defaultSpeakerSize);
}

function loadSettings(): TickerSettings {
  const defaultTheme = DEFAULT_DOCK_TICKER_THEME_OPTION;
  try {
    const raw = readNativeDockSetting<unknown>(SETTINGS_KEY);
    if (raw) {
      const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as Partial<TickerSettings>;
      const parsedTheme = resolveDockTickerThemeOption(parsed.themeId) ?? defaultTheme;
      return {
        speed: typeof parsed.speed === "number" ? parsed.speed : 50,
        position: parsed.position === "top" ? "top" : "bottom",
        loop: typeof parsed.loop === "boolean" ? parsed.loop : true,
        themeId: parsedTheme?.id ?? "",
        heading: typeof parsed.heading === "string" && parsed.heading.trim()
          ? parsed.heading.slice(0, 20)
          : parsedTheme?.defaultHeading ?? "LIVE",
        headingMode: parsed.headingMode === "time" ? "time" : "text",
        messageSpacing: typeof parsed.messageSpacing === "number"
          ? Math.max(0, Math.min(TICKER_MESSAGE_SPACING_MAX, Math.round(parsed.messageSpacing)))
          : 0,
        divider: TICKER_DIVIDER_OPTIONS.some((option) => option.value === parsed.divider)
          ? parsed.divider as DockTickerDivider
          : "theme",
        colors: loadTickerColorOverrides(parsed.colors),
      };
    }
  } catch { /* ignore */ }
  return {
    speed: 50,
    position: "bottom",
    loop: true,
    themeId: defaultTheme?.id ?? "",
    heading: defaultTheme?.defaultHeading ?? "LIVE",
    headingMode: "text",
    messageSpacing: 0,
    divider: "theme",
    colors: {},
  };
}

function saveSettings(s: TickerSettings) {
  writeNativeDockSetting(SETTINGS_KEY, s);
}

function loadInitialTickerBranding(): TickerBranding {
  const settings = getSettings();
  return {
    logoUrl: resolveOverlayAssetUrl(settings.brandLogoPath),
    brandName: settings.churchName || "MakeChurchEazy",
    brandColor: settings.brandColor || "#6A34DE",
  };
}

type MinistrySubTab = "ticker" | "lower-thirds" | "time";

const MINISTRY_TAB_KEY = "dock-ministry-active-tab";

function loadMinistryTab(): MinistrySubTab {
  try {
    const raw = readNativeDockSetting<unknown>(MINISTRY_TAB_KEY);
    if (raw === "ticker" || raw === "lower-thirds" || raw === "time") return raw;
    // Keep the former Countdowns tab selected after upgrading to Time.
    if (raw === "countdowns") return "time";
  } catch { /* ignore */ }
  return "ticker";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DockMinistryTab({
  staged: _staged,
  onStage: _onStage,
  presentationOutputTarget = "obs",
  hideTickerControls = false,
  hideLowerThirdControls = false,
}: Props) {
  const { t } = useTranslation();
  const presentationLinkMode = isPresentationLinkTarget(presentationOutputTarget);
  const showTickerTab = !hideTickerControls;
  const showLowerThirdTab = !hideLowerThirdControls;
  const [subTab, setSubTab] = useState<MinistrySubTab>(loadMinistryTab);
  const [messages, setMessages] = useState<TickerMessage[]>(loadMessages);
  const [newText, setNewText] = useState("");
  const [settings, setSettings] = useState<TickerSettings>(loadSettings);
  const [running, setRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [obsConnected, setObsConnected] = useState(dockObsClient.isConnected);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [dockPlan, setDockPlan] = useState<string>(() => getDockPlan());
  const tickerEntitlement = checkEntitlementSync("tickers", dockPlan);
  const lowerThirdEntitlement = checkEntitlementSync("lowerThirds", dockPlan);
  const timeEntitlement = checkEntitlementSync("countdowns", dockPlan);
  // Keep locked tabs visible so Free and Basic users can see what is available
  // after upgrading. The content and actions remain guarded below.
  const showTimeTab = true;
  const [tickerSceneRoute, updateTickerSceneRoute] = useDockSceneRoute("ticker");
  const [lowerThirdSceneRoute, updateLowerThirdSceneRoute] = useDockSceneRoute("lower-third");
  const hasTickerSceneRoute = tickerSceneRoute.enabled && tickerSceneRoute.targets.length > 0;
  const hasLowerThirdSceneRoute = lowerThirdSceneRoute.enabled && lowerThirdSceneRoute.targets.length > 0;
  const [tickerFavIds, setTickerFavIds] = useState<Set<string>>(new Set());
  const [tickerPolicyVersion, setTickerPolicyVersion] = useState(0);
  const [remoteProductionThemes, setRemoteProductionThemes] = useState<RemoteProductionTheme[]>(() => getCachedRemoteProductionThemes());
  const [tickerBranding, setTickerBranding] = useState<TickerBranding>(loadInitialTickerBranding);
  const [tickerColorPopoverOpen, setTickerColorPopoverOpen] = useState(false);
  const [tickerColorPopoverPosition, setTickerColorPopoverPosition] = useState({ top: 0, left: 0 });
  const [bibleLtColorOverrides, setBibleLtColorOverrides] = useState<BibleLtColorOverrideMap>(loadBibleLtColorOverrides);

  // Lower-thirds state — mixed LowerThirdTheme + BibleTheme entries
  const [ltFavorites, setLtFavorites] = useState<MixedLTThemeEntry[]>([]);
  const [ltSelectedIdx, setLtSelectedIdx] = useState(0);
  const [ltSending, setLtSending] = useState(false);
  const [ltFeedback, setLtFeedback] = useState<string | null>(null);
  const [ltFeedbackTone, setLtFeedbackTone] = useState<"success" | "error">("success");
  // Lower-third tabs: each keeps its own theme, size and content slots.
  const [ltTabsState, setLtTabsState] = useState<{ tabs: MinistryLtTab[]; activeId: string }>(() => (
    parseLtTabs(readNativeDockSetting(MINISTRY_LT_TABS_STORAGE_KEY))
    ?? { tabs: [createFirstLtTab(null)], activeId: FIRST_LT_TAB_ID }
  ));
  const ltTabsTouchedRef = useRef(false);
  const ltEditorFlushRef = useRef<(() => void) | null>(null);
  // Tabs that have a lower third on screen. With one shared OBS source that is at most one.
  const [liveLtTabIds, setLiveLtTabIds] = useState<string[]>([]);
  // One shared OBS source (Show swaps: the old one plays out, then the new one in) or a source per tab.
  const [ltSourceMode, setLtSourceModeState] = useState<LtSourceMode>(() => (
    readNativeDockSetting(MINISTRY_LT_SOURCE_MODE_KEY) === "per-tab" ? "per-tab" : "shared"
  ));
  const ltPerTab = ltSourceMode === "per-tab";
  const ltPerTabRef = useRef(ltPerTab);
  ltPerTabRef.current = ltPerTab;
  dockObsClient.setLowerThirdPerTabSources(ltPerTab);
  // BibleTheme lower-third text input (used when a BibleTheme is selected)
  const [bibleLtText, setBibleLtText] = useState("");

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const tickerColorPopoverRef = useRef<HTMLDivElement | null>(null);
  const tickerColorPopoverPanelRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);
  const availableLtThemes = useMemo(
    () => mergeRemoteLowerThirdThemes(ALL_LT_THEMES, remoteProductionThemes),
    [remoteProductionThemes],
  );

  const updateTickerColorPopoverPosition = useCallback(() => {
    const anchor = tickerColorPopoverRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const viewportWidth = window.innerWidth || 320;
    const viewportHeight = window.innerHeight || 480;
    const left = Math.max(
      margin,
      Math.min(rect.right - TICKER_COLOR_POPOVER_WIDTH, viewportWidth - TICKER_COLOR_POPOVER_WIDTH - margin),
    );
    const estimatedHeight = 224;
    const top = rect.bottom + estimatedHeight + margin > viewportHeight
      ? Math.max(margin, rect.top - estimatedHeight - 4)
      : rect.bottom + 4;
    setTickerColorPopoverPosition({ top, left });
  }, []);

  // Persist
  useEffect(() => { saveMessages(messages); }, [messages]);
  useEffect(() => { saveSettings(settings); }, [settings]);
  useEffect(() => { saveBibleLtColorOverrides(bibleLtColorOverrides); }, [bibleLtColorOverrides]);
  useEffect(() => { writeNativeDockSetting(MINISTRY_TAB_KEY, subTab); }, [subTab]);
  useEffect(() => {
    const tabHidden =
      (subTab === "ticker" && !showTickerTab) ||
      (subTab === "lower-thirds" && !showLowerThirdTab) ||
      (subTab === "time" && !showTimeTab);
    if (!tabHidden) return;
    const fallback = showTickerTab
      ? "ticker"
      : showLowerThirdTab
        ? "lower-thirds"
        : showTimeTab
          ? "time"
          : null;
    if (fallback && fallback !== subTab) setSubTab(fallback);
  }, [showTimeTab, showLowerThirdTab, showTickerTab, subTab]);

  useEffect(() => {
    if (!tickerColorPopoverOpen) return;
    updateTickerColorPopoverPosition();
    const closeOnPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (tickerColorPopoverRef.current?.contains(target)) return;
      if (tickerColorPopoverPanelRef.current?.contains(target)) return;
      setTickerColorPopoverOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTickerColorPopoverOpen(false);
    };
    const reposition = () => updateTickerColorPopoverPosition();
    document.addEventListener("mousedown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [tickerColorPopoverOpen, updateTickerColorPopoverPosition]);

  // OBS connection
  useEffect(() => {
    mountedRef.current = true;
    const unsub = dockObsClient.onStatusChange((status) => {
      if (mountedRef.current) setObsConnected(status === "connected");
    });
    if (mountedRef.current) setObsConnected(dockObsClient.isConnected);
    return () => { mountedRef.current = false; unsub(); };
  }, []);

  // Whenever a locked tab is showing, re-check the plan right away. A plan that was
  // still syncing when the dock opened must not keep the tab locked for a minute.
  const activeTabLocked =
    (subTab === "ticker" && !tickerEntitlement.allowed) ||
    (subTab === "lower-thirds" && !lowerThirdEntitlement.allowed) ||
    (subTab === "time" && !timeEntitlement.allowed);
  useEffect(() => {
    if (!activeTabLocked) return;
    let cancelled = false;
    void refreshDockPlanNow().then((plan) => {
      if (!cancelled && mountedRef.current) setDockPlan(plan);
    });
    return () => { cancelled = true; };
  }, [subTab, activeTabLocked]);

  // Saved lower-third tabs are cut to the plan's limit, so check the plan as soon as the
  // Dock opens. A stale cached "free" plan must not hide tabs that were saved earlier.
  useEffect(() => {
    let cancelled = false;
    void refreshDockPlanNow().then((plan) => {
      if (!cancelled && mountedRef.current) setDockPlan(plan);
    });
    return () => { cancelled = true; };
  }, []);

  // Refresh dock plan every 30s (matches DockAuthGate polling)
  useEffect(() => {
    const id = setInterval(() => {
      if (mountedRef.current) setDockPlan(getDockPlan());
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const localBranding = loadInitialTickerBranding();
    fetch(`/uploads/dock-branding.json?_=${Date.now()}`, { cache: "no-store" })
      .then((res) => res.ok ? res.json() : null)
      .then((branding: unknown) => {
        if (cancelled || !branding || typeof branding !== "object") return;
        const data = branding as Record<string, unknown>;
        const logoFileName = typeof data.brandLogoFileName === "string" ? data.brandLogoFileName.trim() : "";
        const brandLogoPath = typeof data.brandLogoPath === "string" ? data.brandLogoPath.trim() : "";
        const logoUrl = logoFileName
          ? resolveOverlayAssetUrl(`/uploads/${encodeURIComponent(logoFileName)}`)
          : resolveOverlayAssetUrl(brandLogoPath || localBranding.logoUrl);
        setTickerBranding({
          logoUrl,
          brandName: typeof data.churchName === "string" && data.churchName.trim()
            ? data.churchName.trim()
            : localBranding.brandName,
          brandColor: typeof data.brandColor === "string" && data.brandColor.trim()
            ? data.brandColor.trim()
            : localBranding.brandColor,
        });
      })
      .catch(() => { });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const syncCachedRemoteThemes = () => setRemoteProductionThemes(getCachedRemoteProductionThemes());
    syncCachedRemoteThemes();
    void fetchRemoteProductionThemes().then((themes) => {
      if (mountedRef.current) setRemoteProductionThemes(themes);
    });
    window.addEventListener(REMOTE_PRODUCTION_THEMES_UPDATED_EVENT, syncCachedRemoteThemes);
    return () => window.removeEventListener(REMOTE_PRODUCTION_THEMES_UPDATED_EVENT, syncCachedRemoteThemes);
  }, []);

  // Free-plan enforcement is read-only. Never delete or rewrite an existing
  // OBS source when a user downgrades; the shared Dock OBS mutation policy
  // blocks all scene/source writes for Free users.

  // Clear feedback after 3s
  useEffect(() => {
    if (!success && !error) return;
    const t = setTimeout(() => { if (mountedRef.current) { setSuccess(null); setError(null); } }, 3000);
    return () => clearTimeout(t);
  }, [success, error]);

  // Clear LT feedback after 3s
  useEffect(() => {
    if (!ltFeedback) return;
    const t = setTimeout(() => { if (mountedRef.current) setLtFeedback(null); }, 3000);
    return () => clearTimeout(t);
  }, [ltFeedback]);

  const refreshLtFavorites = useCallback(async () => {
    try {
      const [ltIdSet, savedGraphics, policy] = await Promise.all([
        loadDockLTFavorites().catch(() => new Set<string>()),
        loadDockSavedGraphics().catch(() => []),
        loadDockGraphicsPolicy().catch(() => ({ blocked: new Set<string>(), packageThemes: [] as LowerThirdTheme[], packageTickers: [] })),
      ]);
      const entries: MixedLTThemeEntry[] = [];
      // Admin-published graphics join the bundled ones; paused / hidden / other-plan ones are left out.
      const pool = [
        ...availableLtThemes,
        ...policy.packageThemes.filter((p) => !availableLtThemes.some((t) => t.id === p.id)),
      ].filter((t) => !policy.blocked.has(t.id));

      // Custom graphics saved in Broadcast Graphics ("Save & add to OBS") come first,
      // each under its own name with its saved text and colours.
      for (const saved of savedGraphics) {
        if (policy.blocked.has(saved.templateId)) continue;
        const template = pool.find((t) => t.id === saved.templateId);
        const theme = template ? buildSavedGraphicTheme(saved, template) : saved.theme;
        if (!theme) continue;
        entries.push({ kind: "lt", theme, label: theme.name, custom: true, templateId: saved.templateId });
      }

      // LowerThirdTheme favorites — only show themes favorited/added to OBS
      const ltThemes = pool.filter((t) => ltIdSet.has(t.id));
      for (const t of ltThemes) {
        entries.push({ kind: "lt", theme: t, label: t.name });
      }

      // Plan limit (Free = 3 by default, set in Admin → Plan Config). A church that
      // has more from a trial or earlier plan keeps only the first ones in the Dock.
      const ltLimit = getDockEntitlementLimit("lowerThirds");
      // Nothing has been added to OBS yet: offer the first few themes so the THEME list is a real,
      // working choice instead of a greyed-out box.
      if (entries.length === 0) {
        const starterCount = ltLimit >= 0 && Number.isFinite(ltLimit) ? Math.max(ltLimit, 1) : 12;
        for (const t of pool.slice(0, starterCount)) entries.push({ kind: "lt", theme: t, label: t.name });
      }
      setLtFavorites(ltLimit >= 0 && Number.isFinite(ltLimit) ? entries.slice(0, ltLimit) : entries);
    } catch (err) {
      console.warn("[DockMinistry] Failed to load LT favorites:", err);
      setLtFavorites([]);
    }
  }, [availableLtThemes]);

  const refreshTickerFavorites = useCallback(async () => {
    try {
      const [allFavIds, policy] = await Promise.all([
        loadDockTickerFavorites(),
        loadDockGraphicsPolicy().catch(() => null),
      ]);
      // Admin → Broadcast Graphics → Tickers: uploaded tickers join the list; paused,
      // hidden and other-plan tickers are left out.
      if (policy) setDockTickerAdminPolicy({ blocked: policy.blocked, packageTickers: policy.packageTickers });
      const tickerLimit = getDockEntitlementLimit("tickerThemes");
      const usableFavIds = [...allFavIds].filter((id) => !isDockTickerBlocked(id));
      const favIds = tickerLimit >= 0 && Number.isFinite(tickerLimit)
        ? new Set(usableFavIds.slice(0, tickerLimit))
        : new Set(usableFavIds);
      setTickerFavIds(favIds);
      setTickerPolicyVersion((v) => v + 1);
      const available = getDockTickerThemeOptionsForFavorites(favIds, remoteProductionThemes, tickerLimit);
      setSettings((current) => {
        const currentTheme = available.find((option) => option.id === current.themeId);
        if (currentTheme) return current;
        const fallback = available[0];
        return fallback
          ? { ...current, themeId: fallback.id, heading: fallback.defaultHeading }
          : current;
      });
    } catch {
      // Keep the current ticker theme list if favorites cannot be read.
    }
  }, [remoteProductionThemes]);

  // Load favorite LT themes (both LowerThirdTheme and BibleTheme lower-thirds)
  useEffect(() => {
    void refreshLtFavorites();
  }, [refreshLtFavorites]);

  // Load ticker favorites
  useEffect(() => {
    void refreshTickerFavorites();
  }, [refreshTickerFavorites]);

  useEffect(() => {
    const refreshAll = () => {
      void refreshLtFavorites();
      void refreshTickerFavorites();
    };
    window.addEventListener(FAVORITE_THEMES_UPDATED_EVENT, refreshAll);
    window.addEventListener(BROADCAST_GRAPHICS_UPDATED_EVENT, refreshAll);
    window.addEventListener(BROADCAST_GRAPHICS_CATALOG_UPDATED_EVENT, refreshAll);
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key.includes("ocs-fav-") || event.key.includes("mce-saved-broadcast-graphics") || event.key.includes("mce-broadcast-graphics-catalog")) {
        refreshAll();
      }
    };
    window.addEventListener("storage", onStorage);
    const unsubscribe = dockClient.onState((msg) => {
      if (msg.type === "state:favorite-themes-updated") {
        refreshAll();
      }
    });
    return () => {
      window.removeEventListener(FAVORITE_THEMES_UPDATED_EVENT, refreshAll);
      window.removeEventListener(BROADCAST_GRAPHICS_UPDATED_EVENT, refreshAll);
      window.removeEventListener(BROADCAST_GRAPHICS_CATALOG_UPDATED_EVENT, refreshAll);
      window.removeEventListener("storage", onStorage);
      unsubscribe();
    };
  }, [refreshLtFavorites, refreshTickerFavorites]);

  // tickerPolicyVersion re-renders the list after the admin ticker policy is applied.
  void tickerPolicyVersion;
  const effectiveThemeList = getDockTickerThemeOptionsForFavorites(
    tickerFavIds,
    remoteProductionThemes,
    getDockEntitlementLimit("tickerThemes"),
  );
  const selectedTickerTheme =
    effectiveThemeList.find((option) => option.id === settings.themeId) ??
    effectiveThemeList[0] ??
    DEFAULT_DOCK_TICKER_THEME_OPTION;
  const activeMessages = messages.filter((m) => m.active);

  const tickerColors: TickerThemeColors | undefined = (() => {
    if (!selectedTickerTheme) return undefined;
    const brandColor = normalizeBrandColor(tickerBranding.brandColor);
    const baseColors: TickerThemeColors = selectedTickerTheme.source === "dock" || selectedTickerTheme.source === "remote"
      ? {
        ...selectedTickerTheme.theme.defaultColors,
        accent: brandColor,
        separator: brandColor,
      }
      // HTML/package tickers keep their own CSS colours; only the user's picked colours override them.
      : ({} as TickerThemeColors);
    return {
      ...baseColors,
      ...loadTickerColorOverrides(settings.colors),
    };
  })();
  // Read the colours an HTML ticker really shows (only while the picker is open) so the swatches match it.
  const [probedTickerColors, setProbedTickerColors] = useState<{ themeId: string; colors: Partial<TickerThemeColors> } | null>(null);
  useEffect(() => {
    if (!tickerColorPopoverOpen || !selectedTickerTheme) return;
    if (selectedTickerTheme.source === "dock" || selectedTickerTheme.source === "remote") return;
    let cancelled = false;
    const themeId = selectedTickerTheme.id;
    void probeHtmlTickerColors(selectedTickerTheme).then((colors) => {
      if (!cancelled) setProbedTickerColors({ themeId, colors });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerColorPopoverOpen, selectedTickerTheme?.id, selectedTickerTheme?.source]);
  // What the picker shows for colours the user hasn't changed: the colours the ticker really uses.
  // (HTML tickers keep their own CSS, so `tickerColors` is empty for them until something is overridden.)
  const tickerPickerDefaults: Record<TickerColorKey, string> = {
    ...TICKER_COLOR_INPUT_FALLBACKS,
    ...(selectedTickerTheme?.source === "permanent" || selectedTickerTheme?.source === "remote-template"
      ? Object.fromEntries(Object.entries(selectedTickerTheme.theme.colors ?? {}).filter(([, v]) => !!v))
      : {}),
    ...(probedTickerColors?.themeId === selectedTickerTheme?.id ? probedTickerColors.colors : {}),
    ...(tickerColors ?? {}),
  };
  // HTML tickers have no divider of their own, so the separator colour only shows once a divider is chosen.
  const tickerSeparatorNeedsDivider =
    (selectedTickerTheme?.source === "permanent" || selectedTickerTheme?.source === "remote-template")
    && (settings.divider === "theme" || settings.divider === "none");
  const tickerBrandLogoUrl = selectedTickerTheme?.source === "dock" || selectedTickerTheme?.source === "remote"
    ? tickerBranding.logoUrl
    : "";
  const tickerBrandName = tickerBranding.brandName || "MakeChurchEazy";
  const obsFontFamily = loadDockOutputFontFamily();

  const ltTabLimit = ltTabLimitForPlan(dockPlan);
  const ltTabs = usableLtTabs(ltTabsState.tabs, ltTabLimit);
  const activeLtTab = ltTabs.find((tab) => tab.id === ltTabsState.activeId) ?? ltTabs[0];
  const activeLtTabIdRef = useRef(activeLtTab.id);
  activeLtTabIdRef.current = activeLtTab.id;
  // Is the open tab's lower third on screen? (With one shared source: is any tab's?)
  const ltLive = ltPerTab ? liveLtTabIds.includes(activeLtTab.id) : liveLtTabIds.length > 0;
  const setLtLive = useCallback((on: boolean) => {
    const id = activeLtTabIdRef.current;
    setLiveLtTabIds((current) => {
      if (!ltPerTabRef.current) return on ? [id] : [];
      const others = current.filter((x) => x !== id);
      return on ? [...others, id] : others;
    });
  }, []);
  /** The OBS source the open tab sends to. */
  const activeLtSource = () => dockObsClient.lowerThirdSourceForTab(activeLtTabIdRef.current, activeLtTabIdRef.current === FIRST_LT_TAB_ID);
  const setLtSourceMode = useCallback((mode: LtSourceMode) => {
    setLtSourceModeState(mode);
    void writeNativeDockSetting(MINISTRY_LT_SOURCE_MODE_KEY, mode);
    // What is on screen stays where it is; the next Show uses the new choice.
    setLiveLtTabIds([]);
  }, []);
  const ltSize: LTSize = activeLtTab.size ?? loadMinistryLtSize();
  const commitLtTabs = useCallback((next: { tabs: MinistryLtTab[]; activeId: string }) => {
    ltTabsTouchedRef.current = true;
    setLtTabsState(next);
    void writeNativeDockSetting(MINISTRY_LT_TABS_STORAGE_KEY, next);
  }, []);
  const setLtSize = useCallback((size: LTSize) => {
    setLtTabsState((current) => {
      const next = { ...current, tabs: updateLtTab(current.tabs, activeLtTabIdRef.current, { size }) };
      ltTabsTouchedRef.current = true;
      void writeNativeDockSetting(MINISTRY_LT_TABS_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const fallbackLtTheme = (availableLtThemes[0] ?? ALL_LT_THEMES[0]) as LowerThirdTheme;
  const ltSelectedEntry = ltFavorites[ltSelectedIdx] ?? ltFavorites[0] ?? { kind: "lt" as const, theme: fallbackLtTheme, label: fallbackLtTheme?.name ?? "Speaker" };
  // Motion straps (public/kinetic) have their own Size slider, so the SM/LG/XL row is hidden for them.
  const isMotionLtEntry = ltSelectedEntry.kind === "lt"
    && typeof ltSelectedEntry.theme.html === "string"
    && ltSelectedEntry.theme.html.includes("kx-root");
  const selectedBibleLtSettings = ltSelectedEntry.kind === "bible"
    ? (ltSelectedEntry.theme.variants?.lowerThird?.settings ?? ltSelectedEntry.theme.settings)
    : null;
  const selectedBibleLtOverrides = ltSelectedEntry.kind === "bible"
    ? (bibleLtColorOverrides[ltSelectedEntry.theme.id] ?? EMPTY_BIBLE_LT_OVERRIDES)
    : EMPTY_BIBLE_LT_OVERRIDES;
  const selectedBibleLtEffectiveSettings = useMemo<Record<string, unknown> | null>(
    () => selectedBibleLtSettings
      ? {
        ...(selectedBibleLtSettings as unknown as Record<string, unknown>),
        ...selectedBibleLtOverrides,
        lowerThirdSize: MINISTRY_BIBLE_LT_SIZE_PRESETS[ltSize],
        ...(Number(selectedBibleLtSettings.fontSize) > 0
          ? { fontSize: Math.max(1, Math.round(Number(selectedBibleLtSettings.fontSize) * (LT_SIZE_FONT_SCALE[ltSize] ?? 1))) }
          : {}),
        ...(Number(selectedBibleLtSettings.refFontSize) > 0
          ? { refFontSize: Math.max(1, Math.round(Number(selectedBibleLtSettings.refFontSize) * (LT_SIZE_FONT_SCALE[ltSize] ?? 1))) }
          : {}),
      }
      : null,
    [selectedBibleLtSettings, selectedBibleLtOverrides, ltSize],
  );
  const selectedBibleLtAnimationDuration = selectedBibleLtEffectiveSettings
    ? Number(selectedBibleLtEffectiveSettings.animationDuration) || 800
    : 800;

  // Reset selected index when favorites change
  // The chosen theme is remembered, so it is still selected after a reload.
  // Each tab remembers its theme. Saved tabs may arrive after the first render (the
  // Dock settings load in the background), so adopt them until the operator changes a tab.
  useEffect(() => {
    if (ltTabsTouchedRef.current) return;
    const stored = parseLtTabs(readNativeDockSetting(MINISTRY_LT_TABS_STORAGE_KEY));
    if (stored) {
      setLtTabsState(stored);
      return;
    }
    const legacy = readNativeDockSetting<string>(MINISTRY_LT_THEME_STORAGE_KEY);
    if (typeof legacy === "string") {
      setLtTabsState((current) => ({ ...current, tabs: updateLtTab(current.tabs, FIRST_LT_TAB_ID, { themeKey: legacy }) }));
    }
  }, [ltFavorites]);

  useEffect(() => {
    const key = activeLtTab.themeKey;
    const idx = key ? ltFavorites.findIndex((entry) => ltEntryKey(entry) === key) : -1;
    setLtSelectedIdx(idx >= 0 ? idx : 0);
  }, [ltFavorites, activeLtTab.themeKey]);

  const handleSelectLtTheme = useCallback((entryIdx: number) => {
    if (entryIdx >= 0 && entryIdx < ltFavorites.length) {
      const themeKey = ltEntryKey(ltFavorites[entryIdx]);
      setLtSelectedIdx(entryIdx);
      commitLtTabs({ ...ltTabsState, tabs: updateLtTab(ltTabsState.tabs, activeLtTab.id, { themeKey }) });
      // The first tab also keeps the older single-theme setting current.
      if (activeLtTab.id === FIRST_LT_TAB_ID) void writeNativeDockSetting(MINISTRY_LT_THEME_STORAGE_KEY, themeKey);
    }
  }, [ltFavorites, ltTabsState, activeLtTab.id, commitLtTabs]);

  const handleSwitchLtTab = useCallback((id: string) => {
    if (id === activeLtTab.id) return;
    commitLtTabs({ ...ltTabsState, activeId: id });
  }, [activeLtTab.id, ltTabsState, commitLtTabs]);

  // + clones the open tab: same theme, size and content (all slots), then opens the copy.
  const handleAddLtTab = useCallback(() => {
    if (!canAddLtTab(ltTabs.length, ltTabLimit)) return;
    ltEditorFlushRef.current?.();
    const id = newLtTabId(ltTabsState.tabs);
    const selected = ltFavorites[ltSelectedIdx];
    const themeKey = selected ? ltEntryKey(selected) : activeLtTab.themeKey;
    if (selected?.kind === "lt") {
      copyEditorSlots(selected.theme.id, ltTabEditorId(activeLtTab), ltTabEditorId({ id }));
    }
    const withKey = updateLtTab(ltTabsState.tabs, activeLtTab.id, { themeKey, size: ltSize });
    commitLtTabs({ tabs: cloneLtTab(withKey, activeLtTab.id, id), activeId: id });
  }, [ltTabs.length, ltTabLimit, ltTabsState, ltFavorites, ltSelectedIdx, activeLtTab, ltSize, commitLtTabs]);

  const handleCloseLtTab = useCallback((id: string) => {
    const next = closeLtTab(ltTabsState.tabs, id, activeLtTab.id);
    if (next.tabs === ltTabsState.tabs) return;
    // After the closing editor has unmounted (it saves once more on the way out).
    if (id !== FIRST_LT_TAB_ID) window.setTimeout(() => deleteEditorSlots(ltTabEditorId({ id })), 0);
    if (liveLtTabIds.includes(id)) {
      // A tab with its own source takes its lower third off with it.
      if (ltPerTab && id !== FIRST_LT_TAB_ID) {
        void dockObsClient.animateLowerThirdOverlayUrlOut("", 900, { sourceName: dockObsClient.lowerThirdSourceForTab(id, false) }).catch(() => { });
      }
      setLiveLtTabIds((current) => current.filter((x) => x !== id));
    }
    commitLtTabs(next);
  }, [ltTabsState.tabs, activeLtTab.id, liveLtTabIds, ltPerTab, commitLtTabs]);

  const setTickerColorOverride = useCallback((key: TickerColorKey, value: string) => {
    setSettings((current) => {
      const nextColors = { ...(current.colors ?? {}) };
      const color = sanitizeCssColor(value);
      if (color) {
        nextColors[key] = color;
      } else {
        delete nextColors[key];
      }
      return { ...current, colors: nextColors };
    });
  }, []);

  const setBibleLtColorOverride = useCallback((themeId: string, key: BibleLtColorKey, value: string) => {
    setBibleLtColorOverrides((current) => {
      const themeOverrides = { ...(current[themeId] ?? {}) };
      const color = sanitizeCssColor(value);
      if (color) {
        themeOverrides[key] = color;
      } else {
        delete themeOverrides[key];
      }
      const next = { ...current };
      if (Object.keys(themeOverrides).length > 0) {
        next[themeId] = themeOverrides;
      } else {
        delete next[themeId];
      }
      return next;
    });
  }, []);

  // ── Add message ──
  const handleAdd = useCallback(async () => {
    if (!(await requireEntitlement("tickers", 0))) return;
    const text = newText.trim();
    if (!text) return;
    if (text.length > MAX_CHARS) return;
    setMessages((prev) => [...prev, { id: genId(), text, active: true }]);
    setNewText("");
    textareaRef.current?.focus();
  }, [newText]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAdd();
    }
  }, [handleAdd]);

  // ── Toggle message active ──
  const handleToggleMessage = useCallback((id: string) => {
    setMessages((prev) => prev.map((m) => m.id === id ? { ...m, active: !m.active } : m));
  }, []);

  // ── Delete message ──
  const handleDelete = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  // ── Edit message ──
  const handleStartEdit = useCallback((id: string, text: string) => {
    setEditingId(id);
    setEditText(text);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingId) return;
    const text = editText.trim();
    if (!text || text.length > MAX_CHARS) return;
    setMessages((prev) => prev.map((m) => m.id === editingId ? { ...m, text } : m));
    setEditingId(null);
    setEditText("");
  }, [editingId, editText]);

  // ── Push ticker to OBS ──
  const handlePush = useCallback(async () => {
    if (!(await requireEntitlement("tickers", 0))) return;
    if (activeMessages.length === 0) {
      setError(t("ministry.addAtLeastOne"));
      return;
    }
    if (!selectedTickerTheme) return;
    setSending(true);
    setError(null);
    setSuccess(null);
    try {
      if (presentationLinkMode) {
        await publishTickerToPresentation({
          text: formatDockTickerMessages(
            activeMessages.map((m) => m.text),
            settings.divider,
            settings.messageSpacing,
          ),
          divider: resolveDockTickerDividerChar(settings.divider),
          messageSpacing: settings.messageSpacing,
          position: settings.position,
          speed: settings.speed,
          textColor: tickerColors?.barText,
          backgroundColor: tickerColors?.barBg,
          fontFamily: obsFontFamily,
          paused: false,
        });
        setRunning(true);
        setIsPaused(false);
        setSuccess(t("ministry.tickerLive"));
        return;
      }

      await ensureObsConnected();
      const html = renderDockTickerThemeHtml({
        option: selectedTickerTheme,
        heading: settings.heading,
        headingMode: settings.headingMode,
        messages: activeMessages.map((m) => m.text),
        speed: settings.speed,
        position: settings.position,
        loop: settings.loop,
        paused: false,
        colors: tickerColors,
        fontFamily: obsFontFamily,
        brandLogoUrl: tickerBrandLogoUrl,
        brandName: tickerBrandName,
        divider: settings.divider,
        messageSpacing: settings.messageSpacing,
      });

      const video = await dockObsClient.call("GetVideoSettings") as { baseWidth: number; baseHeight: number };
      const canvasW = video.baseWidth;
      const canvasH = video.baseHeight;
      const dataUrl = "data:text/html;charset=utf-8," + encodeURIComponent(html);
      const presentationSceneName = "MCE Presentation";
      const scenes = await dockObsClient.call("GetSceneList") as { scenes: Array<{ sceneName: string }> };
      const targets = hasTickerSceneRoute
        ? [
          ...tickerSceneRoute.targets.map((target) => ({
            sceneName: target.sceneName,
            sourceName: dockObsClient.getSceneRouteSourceName("ticker", target.sceneName),
          })),
          ...(tickerSceneRoute.syncPresentation
            ? [{ sceneName: presentationSceneName, sourceName: "MCE Ticker" }]
            : []),
        ]
        : [{ sceneName: presentationSceneName, sourceName: "MCE Ticker" }];

      for (const { sceneName: targetScene, sourceName } of targets) {
        const sceneExists = scenes.scenes.some((scene) => scene.sceneName === targetScene);
        if (!sceneExists) {
          if (targetScene !== presentationSceneName) {
            throw new Error(`The selected OBS scene “${targetScene}” is no longer available.`);
          }
          await dockObsClient.call("CreateScene", { sceneName: targetScene });
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        const inputs = await dockObsClient.call("GetInputList") as { inputs: Array<{ inputName: string }> };
        const inputExists = inputs.inputs.some((input) => input.inputName === sourceName);
        let sceneItemId: number;
        if (inputExists) {
          await dockObsClient.call("SetInputSettings", {
            inputName: sourceName,
            inputSettings: { url: dataUrl, width: canvasW, height: TICKER_HEIGHT, shutdown: false, restart_when_active: false },
          });
          const items = await dockObsClient.call("GetSceneItemList", { sceneName: targetScene }) as { sceneItems: Array<{ sourceName: string; sceneItemId: number }> };
          const existing = items.sceneItems.find((item) => item.sourceName === sourceName);
          if (existing) {
            sceneItemId = existing.sceneItemId;
            await dockObsClient.call("SetSceneItemEnabled", { sceneName: targetScene, sceneItemId, sceneItemEnabled: true });
          } else {
            const created = await dockObsClient.call("CreateSceneItem", { sceneName: targetScene, sourceName, sceneItemEnabled: true }) as { sceneItemId: number };
            sceneItemId = created.sceneItemId;
          }
        } else {
          const created = await dockObsClient.call("CreateInput", {
            sceneName: targetScene,
            inputName: sourceName,
            inputKind: "browser_source",
            inputSettings: { url: dataUrl, width: canvasW, height: TICKER_HEIGHT, css: "", shutdown: false, restart_when_active: false },
            sceneItemEnabled: true,
          }) as { sceneItemId: number };
          sceneItemId = created.sceneItemId;
        }

        const posY = settings.position === "top" ? 0 : canvasH - TICKER_HEIGHT;
        await dockObsClient.call("SetSceneItemTransform", {
          sceneName: targetScene,
          sceneItemId,
          sceneItemTransform: {
            positionX: 0,
            positionY: posY,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            boundsType: "OBS_BOUNDS_STRETCH",
            boundsWidth: canvasW,
            boundsHeight: TICKER_HEIGHT,
            boundsAlignment: 0,
            cropLeft: 0,
            cropTop: 0,
            cropRight: 0,
            cropBottom: 0,
          },
        });
        await dockObsClient.ensureTickerAboveSource(targetScene, sourceName).catch(() => { });
        if (targetScene === presentationSceneName) {
          await dockObsClient.syncLowerThirdTickerClearance(targetScene).catch(() => { });
        }
      }

      const projectionSettings = loadProjectionSettings();
      if (projectionSettings.tickerLayerPriority !== "ticker-above") {
        saveProjectionSettings({
          ...projectionSettings,
          tickerLayerPriority: "ticker-above",
        });
      }

      if (targets.some((target) => target.sceneName === presentationSceneName)) {
        await dockObsClient.applyProjectionSettings({ allowSceneMutation: true }).catch(() => { });
      }

      setRunning(true);
      setIsPaused(false);
      setSuccess(t("ministry.tickerLive"));
    } catch (err) {
      console.warn("[DockMinistry] Push failed:", err);
      setError(err instanceof Error ? err.message : t("ministry.pushFailed"));
    } finally {
      setSending(false);
    }
  }, [activeMessages, hasTickerSceneRoute, obsFontFamily, presentationLinkMode, selectedTickerTheme, settings, t, tickerBrandLogoUrl, tickerBrandName, tickerColors, tickerSceneRoute.targets, tickerSceneRoute.syncPresentation]);

  // ── Live sync: while the ticker is on air, setting changes update OBS right away ──
  const handlePushRef = useRef(handlePush);
  handlePushRef.current = handlePush;
  const liveSyncKeyRef = useRef("");
  const liveSyncPositionRef = useRef(settings.position);
  const liveSyncKey = JSON.stringify([
    selectedTickerTheme?.id,
    settings.heading,
    settings.headingMode,
    settings.speed,
    settings.messageSpacing,
    settings.divider,
    settings.loop,
    settings.position,
    tickerColors,
    obsFontFamily,
    activeMessages.map((m) => m.text),
  ]);
  useEffect(() => {
    if (!running || !selectedTickerTheme || activeMessages.length === 0) {
      liveSyncKeyRef.current = liveSyncKey;
      liveSyncPositionRef.current = settings.position;
      return;
    }
    if (liveSyncKeyRef.current === liveSyncKey) return;
    const timer = window.setTimeout(async () => {
      liveSyncKeyRef.current = liveSyncKey;
      try {
        if (presentationLinkMode || liveSyncPositionRef.current !== settings.position) {
          // Position changes need the OBS transform updated, so run a full push.
          liveSyncPositionRef.current = settings.position;
          await handlePushRef.current();
          return;
        }
        const html = renderDockTickerThemeHtml({
          option: selectedTickerTheme,
          heading: settings.heading,
          headingMode: settings.headingMode,
          messages: activeMessages.map((m) => m.text),
          speed: settings.speed,
          position: settings.position,
          loop: settings.loop,
          paused: isPaused,
          colors: tickerColors,
          fontFamily: obsFontFamily,
          brandLogoUrl: tickerBrandLogoUrl,
          brandName: tickerBrandName,
          divider: settings.divider,
          messageSpacing: settings.messageSpacing,
        });
        const video = await dockObsClient.call("GetVideoSettings") as { baseWidth: number; baseHeight: number };
        const dataUrl = "data:text/html;charset=utf-8," + encodeURIComponent(html);
        const sourceNames = hasTickerSceneRoute
          ? [
            ...tickerSceneRoute.targets.map((target) => dockObsClient.getSceneRouteSourceName("ticker", target.sceneName)),
            ...(tickerSceneRoute.syncPresentation ? ["MCE Ticker"] : []),
          ]
          : ["MCE Ticker"];
        await Promise.all(sourceNames.map((inputName) =>
          dockObsClient.call("SetInputSettings", {
            inputName,
            inputSettings: { url: dataUrl, width: video.baseWidth, height: TICKER_HEIGHT },
          }),
        ));
      } catch (err) {
        console.warn("[DockMinistry] Live ticker sync failed:", err);
      }
    }, 300);
    return () => window.clearTimeout(timer);
    // liveSyncKey covers every value that changes the ticker output.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSyncKey, running]);

  // ── Pause ticker (stops scroll in OBS) ──
  const handlePause = useCallback(async () => {
    if (!selectedTickerTheme) return;
    setSending(true);
    setError(null);
    setSuccess(null);
    try {
      if (presentationLinkMode) {
        await publishTickerToPresentation({
          text: formatDockTickerMessages(
            activeMessages.map((m) => m.text),
            settings.divider,
            settings.messageSpacing,
          ),
          divider: resolveDockTickerDividerChar(settings.divider),
          messageSpacing: settings.messageSpacing,
          position: settings.position,
          speed: settings.speed,
          textColor: tickerColors?.barText,
          backgroundColor: tickerColors?.barBg,
          fontFamily: obsFontFamily,
          paused: !isPaused,
        });
        setIsPaused((p) => !p);
        setSuccess(isPaused ? t("ministry.resumed") : t("ministry.paused"));
        return;
      }

      const html = renderDockTickerThemeHtml({
        option: selectedTickerTheme,
        heading: settings.heading,
        headingMode: settings.headingMode,
        messages: activeMessages.map((m) => m.text),
        speed: settings.speed,
        position: settings.position,
        loop: settings.loop,
        paused: !isPaused,
        colors: tickerColors,
        fontFamily: obsFontFamily,
        brandLogoUrl: tickerBrandLogoUrl,
        brandName: tickerBrandName,
        divider: settings.divider,
        messageSpacing: settings.messageSpacing,
      });
      const video = await dockObsClient.call("GetVideoSettings") as { baseWidth: number; baseHeight: number };
      const dataUrl = "data:text/html;charset=utf-8," + encodeURIComponent(html);
      const sourceNames = hasTickerSceneRoute
        ? [
          ...tickerSceneRoute.targets.map((target) => dockObsClient.getSceneRouteSourceName("ticker", target.sceneName)),
          ...(tickerSceneRoute.syncPresentation ? ["MCE Ticker"] : []),
        ]
        : ["MCE Ticker"];
      await Promise.all(sourceNames.map((inputName) =>
        dockObsClient.call("SetInputSettings", {
          inputName,
          inputSettings: { url: dataUrl, width: video.baseWidth, height: TICKER_HEIGHT },
        }),
      ));
      setIsPaused((p) => !p);
      setSuccess(isPaused ? t("ministry.resumed") : t("ministry.paused"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ministry.pauseFailed"));
    } finally {
      setSending(false);
    }
  }, [activeMessages, hasTickerSceneRoute, isPaused, obsFontFamily, presentationLinkMode, selectedTickerTheme, settings, t, tickerBrandLogoUrl, tickerBrandName, tickerColors, tickerSceneRoute.targets, tickerSceneRoute.syncPresentation]);

  // ── Clear ticker (hide in OBS) ──
  const handleClear = useCallback(async () => {
    setSending(true);
    setError(null);
    setSuccess(null);
    try {
      if (presentationLinkMode) {
        await clearPresentationScreen();
        setRunning(false);
        setIsPaused(false);
        setSuccess(t("ministry.tickerCleared"));
        return;
      }

      if (hasTickerSceneRoute) {
        await Promise.all(tickerSceneRoute.targets.map((target) => (
          dockObsClient.clearSceneRouteSource("ticker", target.sceneName)
        )));
        if (!tickerSceneRoute.syncPresentation) {
          setRunning(false);
          setIsPaused(false);
          setSuccess(t("ministry.tickerCleared"));
          return;
        }
      }

      // Turn off MCE Ticker wherever it lives — MCE Presentation + current program scene
      const scenesToCheck = new Set<string>();
      scenesToCheck.add("MCE Presentation");
      try {
        const cur = await dockObsClient.call("GetCurrentProgramScene") as { currentProgramSceneName: string };
        scenesToCheck.add(cur.currentProgramSceneName);
      } catch { /* ignore */ }

      for (const sceneName of scenesToCheck) {
        const items = await dockObsClient.call("GetSceneItemList", { sceneName }) as {
          sceneItems: Array<{ sourceName: string; sceneItemId: number }>;
        };
        const tickerItem = items.sceneItems.find((i) => i.sourceName === "MCE Ticker");
        if (tickerItem) {
          await dockObsClient.call("SetSceneItemEnabled", {
            sceneName,
            sceneItemId: tickerItem.sceneItemId,
            sceneItemEnabled: false,
          });
        }
      }
      await dockObsClient.syncLowerThirdTickerClearance("MCE Presentation").catch(() => { });

      setRunning(false);
      setIsPaused(false);
      setSuccess(t("ministry.tickerCleared"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ministry.clearFailed"));
    } finally {
      setSending(false);
    }
  }, [hasTickerSceneRoute, presentationLinkMode, t, tickerSceneRoute.targets, tickerSceneRoute.syncPresentation]);

  // The latest success message for the sub-tab being shown (shown as an icon only).
  const successNotice: string | null =
    subTab === "ticker"
      ? success
      : subTab === "lower-thirds" && ltFeedback && ltFeedbackTone === "success"
        ? ltFeedback
        : null;

  return (
    <div className="dock-mv-tab">
      {/* ── Header ── */}


      {/* ── Sub-Tab Switcher ── */}
      {/* Locked tabs still open their tab. The locked panel inside explains the plan and has the Upgrade button, so a tab click never jumps out to the website. */}
      <div className="dock-ministry-tabs">
        {showTickerTab && (
          <button
            type="button"
            className={`dock-ministry-tab${subTab === "ticker" ? " dock-ministry-tab--active" : ""}`}
            onClick={() => setSubTab("ticker")}
            aria-label={t("ministry.ticker")}
            title={t("ministry.ticker")}>
            <Icon name="campaign" size={12} />
            <span>{t("ministry.tickerShort", "Ticker")}</span>
          </button>
        )}
        {showLowerThirdTab && (
          <button
            type="button"
            className={`dock-ministry-tab${subTab === "lower-thirds" ? " dock-ministry-tab--active" : ""}`}
            onClick={() => setSubTab("lower-thirds")}
            aria-label={t("ministry.lowerThirds")}
            title={t("ministry.lowerThirds")}>
            <Icon name="subtitles" size={12} />
            <span>{t("ministry.lowerThirdsShort", "Lower-Third")}</span>
          </button>
        )}
        {showTimeTab && (
          <button
            type="button"
            className={`dock-ministry-tab${subTab === "time" ? " dock-ministry-tab--active" : ""}`}
            onClick={() => setSubTab("time")}
            aria-label={t("ministry.time", "Time")}
            title={t("ministry.time", "Time")}>
            <Icon name="schedule" size={12} />
            <span>{t("ministry.timeShort", "Time")}</span>
          </button>
        )}
        <span className="dock-ministry-tabs__end">
          {/* Success notice: just an icon in a slot that is always reserved, so it never moves the page or covers a button. */}
          <span
            className="dock-ministry-status"
            role="status"
            aria-live="polite"
            aria-label={successNotice || undefined}
            title={successNotice || undefined}
          >
            {successNotice && <Icon name="check_circle" size={16} />}
          </span>
          {subTab === "ticker" && tickerEntitlement.allowed && (
            <DockSceneRoutingControl
              module="ticker"
              route={tickerSceneRoute}
              onRouteChange={updateTickerSceneRoute}
              disabled={presentationLinkMode}
              title={t("sceneRouting.tickerOutput", "Ticker output")}
            />
          )}
          {subTab === "lower-thirds" && lowerThirdEntitlement.allowed && (
            <DockSceneRoutingControl
              module="lower-third"
              route={lowerThirdSceneRoute}
              onRouteChange={updateLowerThirdSceneRoute}
              disabled={presentationLinkMode}
              title={t("sceneRouting.lowerThirdOutput", "Lower-third output")}
            />
          )}
        </span>
      </div>

      {/* ── Ticker Tab ── */}
      {showTickerTab && subTab === "ticker" && !tickerEntitlement.allowed && (
        <div style={{ padding: "24px 16px", textAlign: "center" }}>
          <Icon name="lock" size={32} />
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
            {t("upgrade.tickerRequired", "Ticker requires Growth plan")}
          </div>
          <div style={{ fontSize: 11, color: "var(--dock-text-dim)", marginBottom: 16, lineHeight: 1.5 }}>
            {t("upgrade.tickerDescription", "Live-updating scripture, prayer points, and announcements for your congregation.")}
          </div>
          <button
            type="button"
            className="dock-btn dock-btn--primary dock-btn--sm dock-upgrade-plan-btn"
            onClick={() => showUpgradeModal(t("upgrade.tickerRequiredMessage", "Upgrade to Growth to enable the Ticker feature."))}
          >
            <Icon name="upgrade" size={14} />
            <span>{t("upgrade.upgradePlan", "Upgrade Plan")}</span>
          </button>
        </div>
      )}
      {showTickerTab && subTab === "ticker" && tickerEntitlement.allowed && (
        <>
          {/* Feedback */}
          {error && (
            <div className="dock-mv-tab__feedback dock-mv-tab__feedback--toast dock-mv-tab__feedback--error">
              <Icon name="error" size={14} />
              <span>{error}</span>
              <button type="button" className="dock-mv-tab__feedback-close" onClick={() => setError(null)} title={t("common.close")}>
                <Icon name="close" size={12} />
              </button>
            </div>
          )}

          <div className="dock-mv-tab__list dock-mv-tab__list--ticker">
            {/* Theme Picker */}
            <div className="dock-mv-tab__section dock-mv-tab__section--ticker-theme">
              <div style={{ padding: "4px 0" }}>
                <DockSearchableSelect
                  ariaLabel={t("ministry.theme")}
                  storageKey="mce-dock-ticker-theme-select"
                  value={selectedTickerTheme?.id ?? ""}
                  options={effectiveThemeList.map((tpl) => ({ id: tpl.id, label: tpl.name }))}
                  canPreview={(id) => effectiveThemeList.some((tpl) => tpl.id === id)}
                  renderPreview={(id, replayKey) => {
                    const option = effectiveThemeList.find((tpl) => tpl.id === id);
                    if (!option) return null;
                    const html = renderDockTickerThemeHtml({
                      option,
                      heading: option.defaultHeading,
                      messages: ["Sunday Service 9:00 AM", "Midweek Prayer Wednesday 6:30 PM"],
                      speed: settings.speed,
                      position: "bottom",
                      loop: true,
                      divider: settings.divider,
                      messageSpacing: settings.messageSpacing,
                    });
                    return <DockThemePreviewFrame key={replayKey} html={html} sandbox="allow-scripts" title={`Preview of ${option.name}`} />;
                  }}
                  onChange={(id) => {
                    const nextTheme = resolveDockTickerThemeOption(id, remoteProductionThemes);
                    setSettings((s) => ({
                      ...s,
                      themeId: id,
                      heading: nextTheme?.defaultHeading ?? s.heading,
                      colors: {},
                    }));
                  }}
                />
              </div>
            </div>

            {/* Settings */}
            <div className="dock-mv-tab__section dock-mv-tab__section--ticker-settings">
              <div className="dock-mv-tab__section-label" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>{t("ministry.settings")}</span>
                {running && (
                  <span
                    title="Changes are sent to OBS as you make them"
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9, fontWeight: 700, color: "#22c55e", textTransform: "none" }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e" }} />
                    Live sync on
                  </span>
                )}
              </div>
              <div style={{ padding: "4px 0", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <label style={{ fontSize: 10, color: "var(--dock-text-dim)", flex: "0 0 50px" }}>{t("ministry.heading")}</label>
                  <div
                    ref={tickerColorPopoverRef}
                    style={{
                      position: "relative",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      flex: 1,
                      minWidth: 0,
                      zIndex: tickerColorPopoverOpen ? 1000 : "auto",
                    }}
                  >
                    <input
                      type="text"
                      value={settings.heading}
                      onChange={(e) => setSettings((s) => ({ ...s, heading: e.target.value.slice(0, 20) }))}
                      placeholder={t("ministry.typeHeading")}
                      maxLength={20}
                      style={{
                        minHeight: '30px',
                        flex: 1,
                        minWidth: 0,
                        background: "var(--dock-surface)",
                        border: "1px solid var(--dock-border)",
                        borderRadius: 3,
                        padding: "3px 6px",
                        fontSize: 11,
                        color: "var(--dock-text)",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setTickerColorPopoverOpen((open) => {
                          const next = !open;
                          if (next) {
                            updateTickerColorPopoverPosition();
                            requestAnimationFrame(updateTickerColorPopoverPosition);
                          }
                          return next;
                        });
                      }}
                      title={t("ministry.colors", "Colors")}
                      aria-label={t("ministry.colors", "Colors")}
                      style={{
                        width: 30,
                        height: 30,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        borderRadius: 3,
                        border: "1px solid var(--dock-border)",
                        background: tickerColorPopoverOpen ? "var(--dock-accent)" : "var(--dock-surface)",
                        color: tickerColorPopoverOpen ? "#fff" : "var(--dock-text)",
                        cursor: "pointer",
                      }}
                    >
                      <Icon name="palette" size={15} />
                    </button>
                  </div>
                </div>
                {selectedTickerTheme?.source === "permanent" && selectedTickerTheme.theme.headingTime && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <label style={{ fontSize: 10, color: "var(--dock-text-dim)", flex: "0 0 50px" }}>Shows</label>
                    <div role="group" aria-label="Heading shows" style={{ display: "flex", flex: 1, minWidth: 0 }}>
                      {([["text", "Heading text"], ["time", "Live time"]] as const).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={settings.headingMode === value}
                          onClick={() => setSettings((s) => ({ ...s, headingMode: value }))}
                          style={{
                            flex: 1,
                            minHeight: 28,
                            border: "1px solid var(--dock-border)",
                            borderRadius: value === "text" ? "3px 0 0 3px" : "0 3px 3px 0",
                            marginLeft: value === "time" ? -1 : 0,
                            background: settings.headingMode === value ? "var(--dock-accent)" : "var(--dock-surface)",
                            color: settings.headingMode === value ? "#fff" : "var(--dock-text)",
                            fontSize: 11,
                            cursor: "pointer",
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {([
                  {
                    key: "speed" as const,
                    label: t("ministry.speed"),
                    min: 1,
                    max: 100,
                    value: settings.speed,
                    display: settings.speed <= 33 ? "Slow" : settings.speed <= 66 ? "Medium" : "Fast",
                    hints: ["Slow", "Fast"],
                  },
                  {
                    key: "messageSpacing" as const,
                    label: "Space",
                    min: 0,
                    max: TICKER_MESSAGE_SPACING_MAX,
                    value: settings.messageSpacing,
                    display: `${settings.messageSpacing}px`,
                    hints: ["Tight", "Wide"],
                  },
                ]).map((control) => (
                  <div key={control.key} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <label style={{ fontSize: 10, fontWeight: 600, color: "var(--dock-text-dim)" }}>{control.label}</label>
                      <span style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: "var(--dock-text)",
                        background: "var(--dock-surface)",
                        border: "1px solid var(--dock-border)",
                        borderRadius: 999,
                        padding: "1px 8px",
                      }}>{control.display}</span>
                    </div>
                    <input
                      type="range"
                      min={control.min}
                      max={control.max}
                      value={control.value}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        setSettings((s) => ({ ...s, [control.key]: value }));
                      }}
                      aria-label={control.label}
                      style={{ width: "100%", accentColor: "var(--dock-accent)" }}
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "var(--dock-text-dim)" }}>
                      <span>{control.hints[0]}</span>
                      <span>{control.hints[1]}</span>
                    </div>
                  </div>
                ))}
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 20 }}>
                  <div style={{ display: "block", alignItems: "center", gap: 6 }}>
                    <label style={{ fontSize: 10, display: "block", color: "var(--dock-text-dim)", minWidth: 50, }}>{t("ministry.position")}</label>
                    <div className="dock-console-segmented dock-console-segmented--compact">
                      <button
                        type="button"
                        className={`dock-console-segmented__item${settings.position === "top" ? " dock-console-segmented__item--active" : ""}`}
                        onClick={() => setSettings((s) => ({ ...s, position: "top" }))}
                        title={t("ministry.top")}>
                        {t("ministry.top")}
                      </button>
                      <button
                        type="button"
                        className={`dock-console-segmented__item${settings.position === "bottom" ? " dock-console-segmented__item--active" : ""}`}
                        onClick={() => setSettings((s) => ({ ...s, position: "bottom" }))}
                        title={t("ministry.bottom")}>
                        {t("ministry.bottom")}
                      </button>
                    </div>
                  </div>
                  <div style={{ display: "block", alignItems: "center", gap: 6, }}>
                    <label style={{ display: "block", fontSize: 10, color: "var(--dock-text-dim)" }}>{t("ministry.loop")}</label>
                    <div className="dock-console-segmented dock-console-segmented--compact">
                      <button
                        type="button"
                        className={`dock-console-segmented__item${!settings.loop ? " dock-console-segmented__item--active" : ""}`}
                        onClick={() => setSettings((s) => ({ ...s, loop: false }))}
                        title={t("ministry.once")}>
                        {t("ministry.once")}
                      </button>
                      <button
                        type="button"
                        className={`dock-console-segmented__item${settings.loop ? " dock-console-segmented__item--active" : ""}`}
                        onClick={() => setSettings((s) => ({ ...s, loop: true }))}
                        title={t("ministry.looping")}>
                        {t("ministry.looping")}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Compose */}
            <div className="dock-mv-tab__section dock-mv-tab__section--ticker-messages">
              <div className="dock-mv-tab__section-label">{t("ministry.messages")}</div>
              {/* <div className="dock-mv-tab__section-desc">{t("ministry.messagesDesc")}</div> */}
              <div style={{ padding: "4px 0" }}>
                <div style={{ display: "flex", gap: 4, alignItems: "flex-end" }}>
                  <textarea
                    ref={textareaRef}
                    value={newText}
                    onChange={(e) => setNewText(e.target.value.slice(0, MAX_CHARS))}
                    onKeyDown={handleKeyDown}
                    placeholder={t("ministry.typeMessage")}
                    rows={4}
                    style={{
                      flex: 1,
                      minHeight: '80px',
                      background: "var(--dock-surface)",
                      border: "1px solid var(--dock-border)",
                      borderRadius: 3,
                      padding: "4px 6px",
                      fontSize: 11,
                      color: "var(--dock-text)",
                      resize: "none",
                      fontFamily: "inherit",
                    }}
                  />
                  <button
                    type="button"
                    className="dock-btn dock-btn--accent dock-btn--sm"
                    onClick={handleAdd}
                    disabled={!newText.trim()}
                    style={{ height: 30, whiteSpace: "nowrap" }}
                    title={t("common.add")}>
                    {t("ministry.addMessage", "Add Message")}
                    <Icon name="add" size={14} />
                  </button>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginTop: 4 }}>
                  <div className="dock-console-segmented dock-console-segmented--compact" role="group" aria-label={t("ministry.textCase", "Text case")}>
                    {TEXT_CASE_CONVERSIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className="dock-console-segmented__item"
                        onClick={() => setNewText((text) => applyTextCase(text, opt.value).slice(0, MAX_CHARS))}
                        disabled={!newText.trim()}
                        title={opt.hint}
                        aria-label={opt.hint}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <span style={{ fontSize: 9, color: "var(--dock-text-dim)" }}>
                    {newText.length}/{MAX_CHARS}
                  </span>
                </div>
              </div>

              {/* Message list */}
              <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 200, overflowY: "auto" }}>
                {messages.length === 0 && (
                  <div style={{ fontSize: 11, color: "var(--dock-text-dim)", padding: "8px 0", textAlign: "center" }}>
                    {t("ministry.noMessages")}
                  </div>
                )}
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "3px 4px",
                      borderRadius: 3,
                      background: msg.active ? "var(--dock-surface)" : "transparent",
                      opacity: msg.active ? 1 : 0.5,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => handleToggleMessage(msg.id)}
                      title={msg.active ? t("ministry.deactivate") : t("ministry.activate")}
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 3,
                        border: `1.5px solid ${msg.active ? "var(--dock-accent)" : "var(--dock-border)"}`,
                        background: msg.active ? "var(--dock-accent)" : "transparent",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 0,
                        flexShrink: 0,
                      }}
                    >
                      {msg.active && <Icon name="check" size={9} style={{ color: "#fff" }} />}

                    </button>

                    {editingId === msg.id ? (
                      <input
                        type="text"
                        value={editText}
                        onChange={(e) => setEditText(e.target.value.slice(0, MAX_CHARS))}
                        onKeyDown={(e) => { if (e.key === "Enter") handleSaveEdit(); if (e.key === "Escape") { setEditingId(null); setEditText(""); } }}
                        onBlur={handleSaveEdit}
                        autoFocus
                        style={{
                          flex: 1,
                          background: "var(--dock-surface)",
                          border: "1px solid var(--dock-accent)",
                          borderRadius: 3,
                          padding: "1px 4px",
                          fontSize: 11,
                          color: "var(--dock-text)",
                          fontFamily: "inherit",
                        }}
                      />
                    ) : (
                      <span
                        style={{ flex: 1, fontSize: 11, color: "var(--dock-text)", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        onDoubleClick={() => handleStartEdit(msg.id, msg.text)}
                        title={t("ministry.doubleClickToEdit")}
                      >
                        {msg.text}
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => handleStartEdit(msg.id, msg.text)}
                      title={t("ministry.doubleClickToEdit")}
                      style={{
                        width: 16,
                        height: 16,
                        border: "none",
                        background: "transparent",
                        color: "var(--dock-text-dim)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 0,
                        flexShrink: 0,
                      }}
                    >
                      <Icon name="edit" size={10} />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDelete(msg.id)}
                      title={t("common.delete")}
                      style={{
                        width: 16,
                        height: 16,
                        border: "none",
                        background: "transparent",
                        color: "var(--dock-text-dim)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 0,
                        flexShrink: 0,
                      }}
                    >
                      <Icon name="close" size={10} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Live Control */}
            <div className="dock-mv-tab__section dock-mv-tab__section--ticker-live">
              <div style={{ display: "flex", gap: 6, padding: "4px 0" }}>
                {/* Send to OBS — always shown */}
                <button
                  type="button"
                  className={`dock-btn dock-btn--sm ${sending ? "dock-btn--loading" : "dock-btn--primary"}`}
                  onClick={handlePush}
                  disabled={sending || activeMessages.length === 0 || (!obsConnected && !presentationLinkMode)}
                  style={{ flex: 1 }}
                  title={t("common.sendToObs", "Send to OBS")}>
                  <Icon name="play_arrow" size={14} />
                  <span>{t("common.sendToObs", "Send to OBS")}</span>
                </button>

                {/* Pause / Resume — only when running */}
                {running && (
                  <button
                    type="button"
                    className={`dock-btn dock-btn--sm ${sending ? "dock-btn--loading" : "dock-btn--secondary"}`}
                    onClick={handlePause}
                    disabled={sending}
                    title={isPaused ? t("ministry.resume") : t("ministry.pause")}>
                    <Icon name={isPaused ? "play_arrow" : "pause"} size={14} />
                    <span>{isPaused ? t("ministry.resume") : t("ministry.pause")}</span>
                  </button>
                )}

                {/* Clear — only when running */}
                {running && (
                  <button
                    type="button"
                    className={`dock-btn dock-btn--sm ${sending ? "dock-btn--loading" : "dock-btn--danger"}`}
                    onClick={handleClear}
                    disabled={sending}
                    title={t("common.clear")}>
                    <Icon name="visibility_off" size={14} />
                    <span>{t("common.clear")}</span>
                  </button>
                )}
              </div>
              {!obsConnected && !presentationLinkMode && (
                <div style={{ fontSize: 10, color: "var(--dock-red)", textAlign: "center" }}>
                  {t("ministry.connectToObs")}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Lower Thirds Tab ── */}
      {showLowerThirdTab && subTab === "lower-thirds" && !lowerThirdEntitlement.allowed && (
        <div style={{ padding: "24px 16px", textAlign: "center" }}>
          <Icon name="lock" size={32} />
          <div style={{ fontSize: 13, fontWeight: 700, margin: "12px 0 8px" }}>
            {t("upgrade.lowerThirdRequired", "Lower Thirds require Growth plan")}
          </div>
          <div style={{ fontSize: 11, color: "var(--dock-text-dim)", marginBottom: 16, lineHeight: 1.5 }}>
            {t("upgrade.lowerThirdDescription", "Show speaker names, scripture, and announcements over your broadcast.")}
          </div>
          <button
            type="button"
            className="dock-btn dock-btn--primary dock-btn--sm dock-upgrade-plan-btn"
            onClick={() => showUpgradeModal(t("upgrade.lowerThirdRequiredMessage", "Upgrade to Growth to enable Lower Thirds."))}
          >
            <Icon name="upgrade" size={14} />
            <span>{t("upgrade.upgradePlan", "Upgrade Plan")}</span>
          </button>
        </div>
      )}
      {showLowerThirdTab && subTab === "lower-thirds" && lowerThirdEntitlement.allowed && (
        <>
          {/* LT Feedback */}
          {ltFeedback && ltFeedbackTone === "error" && (
            <div className="dock-mv-tab__feedback dock-mv-tab__feedback--toast dock-mv-tab__feedback--error">
              <Icon name="error" size={14} />
              <span>{ltFeedback}</span>
              <button type="button" className="dock-mv-tab__feedback-close" onClick={() => setLtFeedback(null)} title={t("common.close")}>
                <Icon name="close" size={12} />
              </button>
            </div>
          )}

          <div className="dock-mv-tab__list">
            {/* Tabs: keep several lower thirds ready; + clones the open one. */}
            <div className="dock-lt-tabs" role="tablist" aria-label={t("ministry.ltTabs", "Lower-third tabs")}>
              <div className="dock-lt-tabs__strip">
                {ltTabs.map((tab, i) => {
                  const active = tab.id === activeLtTab.id;
                  const entry = tab.themeKey ? ltFavorites.find((e) => ltEntryKey(e) === tab.themeKey) : undefined;
                  const label = t("ministry.ltTabLabel", { n: i + 1, defaultValue: "Tab {{n}}" });
                  return (
                    <div
                      key={tab.id}
                      role="tab"
                      aria-selected={active}
                      tabIndex={0}
                      className={`dock-lt-tabs__tab${active ? " dock-lt-tabs__tab--active" : ""}`}
                      title={entry ? `${label} · ${entry.label}` : label}
                      onClick={() => handleSwitchLtTab(tab.id)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSwitchLtTab(tab.id); } }}
                      onAuxClick={(e) => { if (e.button === 1 && ltTabs.length > 1) handleCloseLtTab(tab.id); }}
                    >
                      {liveLtTabIds.includes(tab.id) && <span className="dock-lt-tabs__live" aria-label={t("ministry.live", "Live")} />}
                      <span className="dock-lt-tabs__label">{label}</span>
                      {ltTabs.length > 1 && (
                        <button
                          type="button"
                          className="dock-lt-tabs__close"
                          onClick={(e) => { e.stopPropagation(); handleCloseLtTab(tab.id); }}
                          title={t("ministry.closeTab", "Close tab")}
                          aria-label={t("ministry.closeTab", "Close tab")}>
                          <Icon name="close" size={10} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                className="dock-lt-tabs__add"
                onClick={handleAddLtTab}
                disabled={!canAddLtTab(ltTabs.length, ltTabLimit)}
                title={
                  ltTabLimit === 1
                    ? t("ministry.ltTabsUpgrade", "Upgrade to Basic to open more lower-third tabs")
                    : canAddLtTab(ltTabs.length, ltTabLimit)
                      ? t("ministry.ltTabAdd", "New tab (copy of this one)")
                      : t("ministry.ltTabsLimit", { n: ltTabLimit, defaultValue: "Your plan allows {{n}} tabs" })
                }
                aria-label={t("ministry.ltTabAdd", "New tab (copy of this one)")}>
                <Icon name="add" size={14} />
              </button>
            </div>
            {ltTabLimit !== 1 && (
              <div className="dock-lt-source-mode" role="radiogroup" aria-label={t("ministry.ltSourceMode", "How tabs go to OBS")}>
                <span className="dock-lt-source-mode__label">{t("ministry.ltSourceModeLabel", "In OBS")}</span>
                <button
                  type="button"
                  role="radio"
                  aria-checked={!ltPerTab}
                  className={!ltPerTab ? "is-on" : ""}
                  onClick={() => setLtSourceMode("shared")}
                  title={t("ministry.ltSourceSharedHint", "All tabs use one OBS source. Show plays out what is on screen, then plays the new one in.")}>
                  {t("ministry.ltSourceShared", "One source")}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={ltPerTab}
                  className={ltPerTab ? "is-on" : ""}
                  onClick={() => setLtSourceMode("per-tab")}
                  title={t("ministry.ltSourcePerTabHint", "Each tab gets its own OBS source, so several lower thirds can be on screen together.")}>
                  {t("ministry.ltSourcePerTab", "Source per tab")}
                </button>
              </div>
            )}

            {/* Theme Picker */}
            <div className="dock-mv-tab__section" style={{ marginBottom: 6 }}>
              <div className="dock-mv-tab__section-label" style={{ paddingBottom: 3 }}>{t("ministry.theme")}</div>
              <div style={{ padding: "4px 0" }}>
                {ltFavorites.length > 0 ? (
                  <DockSearchableSelect
                    compact
                    ariaLabel={t("ministry.theme")}
                    storageKey="mce-dock-lt-theme-select"
                    value={ltEntryKey(ltFavorites[ltSelectedIdx] ?? ltFavorites[0])}
                    options={ltFavorites.map((entry) => {
                      const isCustom = entry.kind === "bible" || (entry.kind === "lt" && Boolean(entry.custom));
                      return {
                        id: ltEntryKey(entry),
                        label: entry.label,
                        badge: isCustom ? t("ministry.custom") : undefined,
                        group: isCustom ? "Your themes" : /^motion\b/i.test(entry.label) ? "Motion" : "More themes",
                      };
                    })}
                    canPreview={(key) => ltFavorites.some((entry) => entry.kind === "lt" && ltEntryKey(entry) === key)}
                    renderPreview={(key, replayKey) => {
                      const entry = ltFavorites.find((e) => ltEntryKey(e) === key);
                      if (!entry || entry.kind !== "lt") return null;
                      const broadcastTheme = entry.theme as unknown as BroadcastTheme;
                      return (
                        <DockThemePreviewFrame
                          key={replayKey}
                          html={buildThemePreviewHtml(broadcastTheme, { backdrop: "#1c2230" })}
                          sandbox={obsPreviewSandbox(broadcastTheme)}
                          title={`Preview of ${entry.label}`}
                        />
                      );
                    }}
                    onChange={(key) => {
                      const idx = ltFavorites.findIndex((entry) => ltEntryKey(entry) === key);
                      if (idx >= 0) handleSelectLtTheme(idx);
                    }}
                  />
                ) : (
                  <div style={{
                    width: "100%",
                    background: "var(--dock-surface)",
                    border: "1px solid var(--dock-border)",
                    borderRadius: 3,
                    padding: "4px 6px",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--dock-text-dim)",
                    fontFamily: "inherit",
                    opacity: 0.8,
                  }}>
                    {ltSelectedEntry?.label ?? t("ministry.speaker")}
                  </div>
                )}
              </div>
            </div>

            {/* Size Multiplier (Motion straps use the Size slider in their own settings) */}
            {!isMotionLtEntry && (
            <div className="dock-mv-tab__section">
              <div className="dock-mv-tab__section-label">{t("ministry.size")}</div>
              {/* <div className="dock-mv-tab__section-desc">{t("ministry.sizeDesc")}</div> */}
              <div style={{ padding: "4px 0", display: "flex", gap: 4 }}>
                {MINISTRY_LT_SIZE_OPTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setLtSize(s);
                      writeNativeDockSetting(MINISTRY_LT_SIZE_STORAGE_KEY, s);
                    }}
                    style={{
                      flex: 1,
                      padding: "4px 0",
                      fontSize: 11,
                      fontWeight: 600,
                      fontFamily: "inherit",
                      borderRadius: 3,
                      border: `1px solid ${ltSize === s ? "var(--dock-accent)" : "var(--dock-border)"}`,
                      background: ltSize === s ? "var(--dock-accent)" : "transparent",
                      color: ltSize === s ? "#fff" : "var(--dock-text-dim)",
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    {LT_SIZE_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>
            )}

            {/* Render editor based on selected theme type */}
            {ltSelectedEntry?.kind === "lt" ? (
              <DockLowerThirdEditor
                key={activeLtTab.id}
                editorId={ltTabEditorId(activeLtTab)}
                flushRef={ltEditorFlushRef}
                theme={ltSelectedEntry.theme}
                themes={ltFavorites.filter((e) => e.kind === "lt").map((e) => (e as LTThemeEntry).theme)}
                onSelectTheme={(themeId) => {
                  const idx = ltFavorites.findIndex((e) => e.kind === "lt" && (e as LTThemeEntry).theme.id === themeId);
                  if (idx >= 0) setLtSelectedIdx(idx);
                }}
                sending={ltSending}
                size={ltSize}
                sceneRoute={lowerThirdSceneRoute}
                onUpdateSceneRoute={updateLowerThirdSceneRoute}
                onSend={async (url, options) => {
                  if (!(await requireEntitlement("lowerThirds", 0))) return;
                  setLtSending(true);
                  setLtFeedback(null);
                  try {
                    if (presentationLinkMode) {
                      // Free plan / presentation link: the graphic plays over the
                      // link's Browser Source; nothing is created in OBS.
                      const ltEntry = ltSelectedEntry?.kind === "lt" ? (ltSelectedEntry as LTThemeEntry) : null;
                      await publishGraphicToPresentation(url, ltEntry?.theme?.id);
                      setLtLive(true);
                      setLtFeedbackTone("success");
                      setLtFeedback(t("ministry.lowerThirdLive"));
                      if (ltEntry) trackGraphicUsage("shown", ltEntry.templateId || ltEntry.theme?.id, ltEntry.theme?.name);
                      return;
                    }
                    await ensureObsConnected();
                    // Keep the OBS browser viewport stable. The selected
                    // size is rendered by lower-third-overlay.html so it
                    // also works when the live source is reused.
                    const sourceSize = {
                      sourceWidth: 1920,
                      sourceHeight: 1080,
                    };
                    const ltSourceOptions = { ...sourceSize, sourceName: activeLtSource() };
                    const currentRoute = loadDockSceneRoute("lower-third");
                    const useSceneRoute = !options?.bypassSceneRoute && currentRoute.enabled && currentRoute.targets.length > 0;
                    if (useSceneRoute) {
                      await Promise.all(currentRoute.targets.map((target) => (
                        dockObsClient.pushLowerThirdOverlayUrlToScene(url, target.sceneName, sourceSize)
                      )));
                      if (currentRoute.syncPresentation) {
                        // Something already on this source plays out first, then the new one comes in.
                        if (ltLive || await dockObsClient.isLowerThirdSourceShowing(ltSourceOptions.sourceName)) {
                          const exitDuration = ((ltSelectedEntry?.theme as LowerThirdTheme)?.exitAnimation?.duration ?? 800) + 100;
                          await dockObsClient.replaceLiveLowerThirdOverlayUrl(url, ltSourceOptions, exitDuration);
                        } else {
                          await dockObsClient.pushLowerThirdOverlayUrl(url, ltSourceOptions);
                        }
                      }
                    } else {
                      if (options?.bypassSceneRoute && currentRoute.targets.length > 0) {
                        await Promise.allSettled(currentRoute.targets.map((target) => (
                          dockObsClient.clearSceneRouteSource("lower-third", target.sceneName)
                        )));
                      }
                      // Something already on this source (from any tab, or left from before the
                      // Dock reloaded) plays out first, then the new one comes in.
                      if (ltLive || await dockObsClient.isLowerThirdSourceShowing(ltSourceOptions.sourceName)) {
                        const exitDuration = ((ltSelectedEntry?.theme as LowerThirdTheme)?.exitAnimation?.duration ?? 800) + 100;
                        await dockObsClient.replaceLiveLowerThirdOverlayUrl(url, ltSourceOptions, exitDuration);
                      } else {
                        await dockObsClient.pushLowerThirdOverlayUrl(url, ltSourceOptions);
                      }
                    }
                    setLtLive(true);
                    setLtFeedbackTone("success");
                    setLtFeedback(options?.bypassSceneRoute ? t("ministry.routingDisabledSent", "Scene routing disabled. Sent to OBS") : t("ministry.lowerThirdLive"));
                    if (ltSelectedEntry?.kind === "lt") {
                      const ltEntry = ltSelectedEntry as LTThemeEntry;
                      trackGraphicUsage("shown", ltEntry.templateId || ltEntry.theme?.id, ltEntry.theme?.name);
                    }
                  } catch (err) {
                    setLtFeedbackTone("error");
                    setLtFeedback(err instanceof Error ? err.message : t("ministry.sendFailed"));
                  } finally {
                    setLtSending(false);
                  }
                }}
                onBlank={async (url) => {
                  setLtSending(true);
                  setLtFeedback(null);
                  try {
                    const exitDuration = ((ltSelectedEntry?.theme as LowerThirdTheme)?.exitAnimation?.duration ?? 800) + 100;
                    if (presentationLinkMode) {
                      // Play the exit on the presentation link, then remove the graphic.
                      await publishGraphicToPresentation(url);
                      await new Promise((resolve) => setTimeout(resolve, exitDuration));
                      await clearGraphicFromPresentation();
                      setLtLive(false);
                      setLtFeedbackTone("success");
                      setLtFeedback(t("ministry.lowerThirdCleared"));
                      return;
                    }
                    await ensureObsConnected();
                    if (hasLowerThirdSceneRoute) {
                      await Promise.all(lowerThirdSceneRoute.targets.map((target) => (
                        dockObsClient.pushLowerThirdOverlayUrlToScene(url, target.sceneName)
                      )));
                      await new Promise((resolve) => setTimeout(resolve, exitDuration));
                      await Promise.all(lowerThirdSceneRoute.targets.map((target) => (
                        dockObsClient.clearSceneRouteSource("lower-third", target.sceneName)
                      )));
                      if (lowerThirdSceneRoute.syncPresentation) {
                        await dockObsClient.animateLowerThirdOverlayUrlOut(url, exitDuration, { sourceName: activeLtSource() });
                      }
                    } else {
                      await dockObsClient.animateLowerThirdOverlayUrlOut(url, exitDuration, { sourceName: activeLtSource() });
                    }
                    setLtLive(false);
                    setLtFeedbackTone("success");
                    setLtFeedback(t("ministry.lowerThirdCleared"));
                  } catch (err) {
                    setLtFeedbackTone("error");
                    setLtFeedback(err instanceof Error ? err.message : t("ministry.blankFailed"));
                  } finally {
                    setLtSending(false);
                  }
                }}
                onAnimateOut={async (url) => {
                  setLtSending(true);
                  setLtFeedback(null);
                  try {
                    const exitDuration = ((ltSelectedEntry?.theme as LowerThirdTheme)?.exitAnimation?.duration ?? 800) + 100;
                    if (presentationLinkMode) {
                      // Play the exit on the presentation link, then remove the graphic.
                      await publishGraphicToPresentation(url);
                      await new Promise((resolve) => setTimeout(resolve, exitDuration));
                      await clearGraphicFromPresentation();
                      setLtLive(false);
                      setLtFeedbackTone("success");
                      setLtFeedback(t("ministry.lowerThirdAnimatedOut"));
                      return;
                    }
                    await ensureObsConnected();
                    if (hasLowerThirdSceneRoute) {
                      await Promise.all(lowerThirdSceneRoute.targets.map((target) => (
                        dockObsClient.pushLowerThirdOverlayUrlToScene(url, target.sceneName)
                      )));
                      await new Promise((resolve) => setTimeout(resolve, exitDuration));
                      await Promise.all(lowerThirdSceneRoute.targets.map((target) => (
                        dockObsClient.clearSceneRouteSource("lower-third", target.sceneName)
                      )));
                      if (lowerThirdSceneRoute.syncPresentation) {
                        await dockObsClient.animateLowerThirdOverlayUrlOut(url, exitDuration, { sourceName: activeLtSource() });
                      }
                    } else {
                      await dockObsClient.animateLowerThirdOverlayUrlOut(url, exitDuration, { sourceName: activeLtSource() });
                    }
                    setLtLive(false);
                    setLtFeedbackTone("success");
                    setLtFeedback(t("ministry.lowerThirdAnimatedOut"));
                  } catch (err) {
                    setLtFeedbackTone("error");
                    setLtFeedback(err instanceof Error ? err.message : t("ministry.animateOutFailed"));
                  } finally {
                    setLtSending(false);
                  }
                }}
              />
            ) : ltSelectedEntry?.kind === "bible" ? (
              /* BibleTheme lower-third: simple text input + send via pushBible */
              <div className="dock-mv-tab__section">
                <div className="dock-mv-tab__section-label">{t("ministry.content")}</div>
                <div className="dock-mv-tab__section-desc">{t("ministry.contentDesc")}</div>
                <div style={{ padding: "4px 0", display: "flex", flexDirection: "column", gap: 8 }}>
                  <textarea
                    value={bibleLtText}
                    onChange={(e) => setBibleLtText(e.target.value)}
                    placeholder={t("ministry.typeText")}
                    rows={3}
                    style={{
                      width: "100%",
                      background: "var(--dock-surface)",
                      border: "1px solid var(--dock-border)",
                      borderRadius: 3,
                      padding: "4px 6px",
                      fontSize: 11,
                      color: "var(--dock-text)",
                      resize: "none",
                      fontFamily: "inherit",
                    }}
                  />
                </div>

                {/* BibleTheme preview note */}
                <div style={{ fontSize: 9, color: "var(--dock-text-dim)", marginTop: 4 }}>
                  {t("ministry.usingCustomTheme")} {ltSelectedEntry.theme.name}
                </div>

                {selectedBibleLtSettings && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: 8,
                      border: "1px solid var(--dock-border)",
                      borderRadius: 4,
                      background: "var(--dock-surface)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 7 }}>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 800, color: "var(--dock-text)", textTransform: "uppercase", letterSpacing: 0.3 }}>
                          {t("lowerThird.appearance", "Appearance")}
                        </div>
                        <div style={{ fontSize: 9, color: "var(--dock-text-dim)", marginTop: 2 }}>
                          {t("lowerThird.appearanceDesc", "Adjust colors for this lower-third theme.")}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (ltSelectedEntry.kind === "bible") {
                            setBibleLtColorOverrides((current) => {
                              const next = { ...current };
                              delete next[ltSelectedEntry.theme.id];
                              return next;
                            });
                          }
                        }}
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
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                      {BIBLE_LT_COLOR_CONTROLS.map((control) => {
                        const explicitColor = selectedBibleLtOverrides[control.key] ?? "";
                        const baseColor = String(selectedBibleLtSettings[control.key] || control.fallback);
                        const effectiveColor = sanitizeCssColor(explicitColor) ?? sanitizeCssColor(baseColor) ?? control.fallback;
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
                              value={colorInputValue(explicitColor || effectiveColor, control.fallback)}
                              onChange={(event) => setBibleLtColorOverride(ltSelectedEntry.theme.id, control.key, event.target.value)}
                              title={t(`lowerThird.color.${control.key}`, control.label)}
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
                  </div>
                )}

                {/* Action buttons */}
                <div style={{ display: "flex", gap: 6, padding: "6px 0" }}>
                  <DockSceneRouteSendControl
                    route={lowerThirdSceneRoute}
                    onRouteChange={updateLowerThirdSceneRoute}
                    onSend={async (options) => {
                      if (!bibleLtText.trim() || ltSelectedEntry?.kind !== "bible") return;
                      setLtSending(true);
                      setLtFeedback(null);
                      try {
                        await ensureObsConnected();
                        const bibleLowerThirdData = {
                          book: "",
                          chapter: 0,
                          verse: 0,
                          verseRange: "",
                          referenceLabel: "",
                          displayReferenceLabel: "",
                          translation: "",
                          verseText: bibleLtText.trim(),
                          overlayMode: "lower-third",
                          bibleThemeSettings: selectedBibleLtEffectiveSettings,
                        } as const;
                        const currentRoute = loadDockSceneRoute("lower-third");
                        const useSceneRoute = !options?.bypassSceneRoute && currentRoute.enabled && currentRoute.targets.length > 0;
                        if (useSceneRoute) {
                          await Promise.all(currentRoute.targets.map((target) => (
                            dockObsClient.pushBibleToScene(bibleLowerThirdData, target.sceneName, "lower-third")
                          )));
                          if (currentRoute.syncPresentation) {
                            await dockObsClient.pushBible(bibleLowerThirdData);
                          }
                        } else {
                          if (options?.bypassSceneRoute && currentRoute.targets.length > 0) {
                            await Promise.allSettled(currentRoute.targets.map((target) => (
                              dockObsClient.clearSceneRouteSource("lower-third", target.sceneName)
                            )));
                          }
                          await dockObsClient.pushBible(bibleLowerThirdData);
                        }
                        setLtLive(true);
                          setLtFeedbackTone("success");
                        setLtFeedback(options?.bypassSceneRoute ? t("ministry.routingDisabledSent", "Scene routing disabled. Sent to OBS") : t("ministry.lowerThirdLive"));
                      } catch (err) {
                        setLtFeedbackTone("error");
                        setLtFeedback(err instanceof Error ? err.message : t("ministry.sendFailed"));
                      } finally {
                        setLtSending(false);
                      }
                    }}
                    sending={ltSending}
                    disabled={ltSending || !bibleLtText.trim() || !obsConnected}
                    style={{ flex: 1 }}
                  />
                  {ltLive && (
                    <button
                      type="button"
                      className={`dock-btn dock-btn--sm ${ltSending ? "dock-btn--loading" : ""}`}
                      disabled={ltSending || !obsConnected}
                      onClick={async () => {
                        setLtSending(true);
                        setLtFeedback(null);
                        try {
                          await ensureObsConnected();
                          const bibleLowerThirdData = {
                            book: "",
                            chapter: 0,
                            verse: 0,
                            verseRange: "",
                            referenceLabel: "",
                            displayReferenceLabel: "",
                            translation: "",
                            verseText: "",
                            overlayMode: "lower-third",
                            bibleThemeSettings: selectedBibleLtEffectiveSettings,
                          } as const;
                          if (hasLowerThirdSceneRoute) {
                            await Promise.all(lowerThirdSceneRoute.targets.map((target) => (
                              dockObsClient.pushBibleToScene(bibleLowerThirdData, target.sceneName, "lower-third")
                            )));
                            if (lowerThirdSceneRoute.syncPresentation) {
                              await dockObsClient.pushBible(bibleLowerThirdData);
                            }
                          } else {
                            await dockObsClient.pushBible(bibleLowerThirdData);
                          }
                          // Wait for exit animation (use theme's animation duration), then disable the source
                          const animDuration = selectedBibleLtAnimationDuration;
                          await new Promise((r) => setTimeout(r, animDuration + 100));
                          if (hasLowerThirdSceneRoute) {
                            await Promise.all(lowerThirdSceneRoute.targets.map((target) => (
                              dockObsClient.clearSceneRouteSource("lower-third", target.sceneName)
                            )));
                            if (lowerThirdSceneRoute.syncPresentation) await dockObsClient.clearBible();
                          } else {
                            await dockObsClient.clearBible();
                          }
                          setLtLive(false);
                          setLtFeedbackTone("success");
                          setLtFeedback(t("ministry.lowerThirdAnimatedOut"));
                        } catch (err) {
                          setLtFeedbackTone("error");
                          setLtFeedback(err instanceof Error ? err.message : t("ministry.animateOutFailed"));
                        } finally {
                          setLtSending(false);
                        }
                      }}
                      style={{
                        flex: 1,
                        background: "transparent",
                        border: "1px solid var(--dock-border)",
                        color: "var(--dock-text-dim)",
                      }}
                    >
                      <Icon name="animation" size={14} />
                      <span>{t("ministry.animateOut")}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className={`dock-btn dock-btn--sm ${ltSending ? "dock-btn--loading" : ""}`}
                    disabled={ltSending || !obsConnected}
                    onClick={async () => {
                      setLtSending(true);
                      setLtFeedback(null);
                      try {
                        await ensureObsConnected();
                        const bibleLowerThirdData = {
                          book: "",
                          chapter: 0,
                          verse: 0,
                          verseRange: "",
                          referenceLabel: "",
                          displayReferenceLabel: "",
                          translation: "",
                          verseText: "",
                          overlayMode: "lower-third",
                          bibleThemeSettings: selectedBibleLtEffectiveSettings,
                        } as const;
                        if (hasLowerThirdSceneRoute) {
                          await Promise.all(lowerThirdSceneRoute.targets.map((target) => (
                            dockObsClient.pushBibleToScene(bibleLowerThirdData, target.sceneName, "lower-third")
                          )));
                          if (lowerThirdSceneRoute.syncPresentation) {
                            await dockObsClient.pushBible(bibleLowerThirdData);
                          }
                        } else {
                          await dockObsClient.pushBible(bibleLowerThirdData);
                        }
                        // Wait for exit animation (use theme's animation duration), then disable the source
                        const animDuration = selectedBibleLtAnimationDuration;
                        await new Promise((r) => setTimeout(r, animDuration + 100));
                        if (hasLowerThirdSceneRoute) {
                          await Promise.all(lowerThirdSceneRoute.targets.map((target) => (
                            dockObsClient.clearSceneRouteSource("lower-third", target.sceneName)
                          )));
                          if (lowerThirdSceneRoute.syncPresentation) await dockObsClient.clearBible();
                        } else {
                          await dockObsClient.clearBible();
                        }
                        setLtLive(false);
                        setLtFeedbackTone("success");
                        setLtFeedback(t("ministry.lowerThirdCleared"));
                      } catch (err) {
                        setLtFeedbackTone("error");
                        setLtFeedback(err instanceof Error ? err.message : t("ministry.blankFailed"));
                      } finally {
                        setLtSending(false);
                      }
                    }}
                    style={{
                      flex: 1,
                      background: "transparent",
                      border: "1px solid var(--dock-border)",
                      color: "var(--dock-text-dim)",
                    }}
                  >
                    <Icon name="visibility_off" size={14} />
                    <span>{t("ministry.blank")}</span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </>
      )}

      {/* ── Time Tab ── */}
      {showTimeTab && subTab === "time" && !timeEntitlement.allowed && (
        <div style={{ padding: "24px 16px", textAlign: "center" }}>
          <Icon name="lock" size={32} />
          <div style={{ fontSize: 13, fontWeight: 700, margin: "12px 0 8px" }}>
            {t("upgrade.timeRequired", "Time tools require Growth plan")}
          </div>
          <div style={{ fontSize: 11, color: "var(--dock-text-dim)", marginBottom: 16, lineHeight: 1.5 }}>
            {t("upgrade.timeDescription", "Keep your services on time with countdowns, timers, and clocks.")}
          </div>
          {import.meta.env.DEV && (
            <div style={{ fontSize: 10, color: "var(--dock-text-dim)", opacity: 0.7, marginBottom: 12 }}>
              {`dev: dock plan = ${dockPlan} · local plan override = ${getStoredLocalDevPlanOverride() ?? "none"}`}
            </div>
          )}
          <button
            type="button"
            className="dock-btn dock-btn--primary dock-btn--sm dock-upgrade-plan-btn"
            onClick={() => showUpgradeModal(t("upgrade.timeRequiredMessage", "Upgrade to Growth to enable Time tools."))}
          >
            <Icon name="upgrade" size={14} />
            <span>{t("upgrade.upgradePlan", "Upgrade Plan")}</span>
          </button>
        </div>
      )}
      {showTimeTab && subTab === "time" && timeEntitlement.allowed && (
        <DockTimeTab presentationOutputTarget={presentationOutputTarget} />
      )}

      {tickerColorPopoverOpen && tickerColors && createPortal(
        <div
          ref={tickerColorPopoverPanelRef}
          role="dialog"
          aria-label={t("ministry.tickerColors", "Ticker colors")}
          style={{
            position: "fixed",
            top: tickerColorPopoverPosition.top,
            left: tickerColorPopoverPosition.left,
            zIndex: 10000,
            width: TICKER_COLOR_POPOVER_WIDTH,
            padding: 10,
            background: "var(--dock-surface-alt, #1f2937)",
            border: "1px solid var(--dock-border, #334155)",
            borderRadius: 4,
            boxShadow: "0 18px 50px rgba(0,0,0,0.36)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: "var(--dock-text, #f8fafc)", textTransform: "uppercase", letterSpacing: 0.3 }}>
              {t("ministry.tickerColors", "Ticker colors")}
            </span>
            <button
              type="button"
              onClick={() => setSettings((s) => ({ ...s, colors: {} }))}
              style={{
                border: "1px solid var(--dock-border, #334155)",
                borderRadius: 3,
                background: "var(--dock-surface, #111827)",
                color: "var(--dock-text-dim, #cbd5e1)",
                cursor: "pointer",
                fontSize: 10,
                padding: "2px 6px",
              }}
            >
              {t("common.reset", "Reset")}
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {TICKER_COLOR_CONTROLS.map(({ key, label }) => {
              const explicitColor = settings.colors?.[key] ?? "";
              const effectiveColor = sanitizeCssColor(explicitColor) ?? tickerPickerDefaults[key];
              const needsDivider = key === "separator" && tickerSeparatorNeedsDivider;
              return (
                <label
                  key={key}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "92px 28px 1fr",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 10,
                    color: "var(--dock-text-dim, #cbd5e1)",
                    opacity: needsDivider ? 0.55 : 1,
                  }}
                  title={needsDivider ? t("ministry.tickerColor.separatorHint", "Choose a divider (Dot, Line, Diamond or Spark) to use this colour.") : undefined}
                >
                  <span>{t(`ministry.tickerColor.${key}`, label)}</span>
                  <input
                    type="color"
                    value={colorInputValue(explicitColor || effectiveColor, TICKER_COLOR_INPUT_FALLBACKS[key])}
                    onChange={(e) => setTickerColorOverride(key, e.target.value)}
                    title={t(`ministry.tickerColor.${key}`, label)}
                    style={{
                      width: 28,
                      height: 24,
                      border: "1px solid var(--dock-border, #334155)",
                      borderRadius: 3,
                      background: "transparent",
                      padding: 0,
                      cursor: "pointer",
                    }}
                  />
                  <TickerColorTextInput
                    value={explicitColor}
                    placeholder={effectiveColor}
                    onCommit={(next) => setTickerColorOverride(key, next)}
                  />
                </label>
              );
            })}
          </div>
        </div>,
        document.body,
      )}

    </div>
  );
}
