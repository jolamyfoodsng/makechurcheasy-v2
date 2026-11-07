/**
 * BroadcastGraphicsPage.tsx
 *
 * Broadcast Graphics Suite for Make Church Eazy.
 * Provides live church livestream graphics: speaker lower thirds, giving details,
 * welcome banners, announcements, subscriptions, tickers, and countdowns.
 *
 * Integrates directly with the OBS Dock without requiring operators to manually
 * create scenes or browser sources in OBS Studio.
 */

import GivingBankFields, { hasGivingBankFields, isGivingBankFieldKey } from "../dock/components/GivingBankFields";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { looksLikeLongTextField } from "../lowerthirds/graphicPackages";
import { graphicAddedAt, isNewGraphic, splitNewGraphics } from "../lowerthirds/graphicCategory";
import { createPortal } from "react-dom";
import {
  MonitorPlay,
  Play,
  RotateCcw,
  FolderOpen,
  HelpCircle,
  Plus,
  Search,
  X,
  Star,
  MoreVertical,
  Check,
  Edit2,
  Copy,
  Trash2,
  Tv,
  Palette,
  Eye,
  Sliders,
  LayoutGrid,
  ArrowRight,
  Radio,
  Info,
} from "../components/icons/NativeIcons";
import "./BroadcastGraphicsPage.css";
import { useAuth } from "../contexts/AuthContext";
import { getEffectivePlan } from "../services/licenseService";
import { checkEntitlementSync } from "../services/entitlementClient";
import { openDashboardSubscriptionPlans } from "../services/subscriptionNavigation";
import PlanLimitModal from "../components/PlanLimitModal";
import ModalDialog from "../components/ModalDialog";
import { trackGraphicUsage } from "../services/tracking";

import { KINETIC_LOWER_THIRD_THEMES } from "../lowerthirds/kineticThemes";
import LazyPreviewFrame from "../components/LazyPreviewFrame";
import { describeField } from "../lowerthirds/fieldGuide";
import {
  applyChurchDefaults,
  churchAwareDefaults,
  type ChurchThemeLike,
} from "../lowerthirds/churchDefaults";
import { getMinistryData, getMinistryHistory, refreshMinistry } from "../services/ministryStore";
import { defaultTickerThemes, type TickerTheme } from "../data/tickerThemes";
import {
  TICKER_THEMES as DOCK_TICKER_THEMES,
  type TickerThemeConfig,
} from "../components/modules/tickerThemes";
import {
  fetchRemoteProductionThemes,
  getCachedRemoteProductionThemes,
  remoteThemeToLowerThird,
  remoteThemeToPermanentTickerTheme,
  remoteThemeToTickerConfig,
  REMOTE_PRODUCTION_THEMES_UPDATED_EVENT,
  type RemoteProductionTheme,
} from "../services/remoteProductionThemes";
import {
  getObsFavorites,
  setObsFavorite,
  getTickerFavorites,
  setTickerFavorite,
  hydrateFavoriteThemes,
  FAVORITE_THEMES_UPDATED_EVENT,
} from "../services/favoriteThemes";
import {
  loadSavedBroadcastGraphics,
  syncSavedGraphicsToDock,
  saveBroadcastGraphic,
  offloadImageToDisk,
  offloadSavedGraphicImages,
  hydrateSavedBroadcastGraphics,
  updateBroadcastGraphic,
  deleteBroadcastGraphic,
  duplicateBroadcastGraphic,
  toggleGraphicObsAvailability,
  BROADCAST_GRAPHICS_UPDATED_EVENT,
  type SavedBroadcastGraphic,
} from "../services/broadcastGraphicsStorage";
import {
  BROADCAST_GRAPHICS_CATALOG_UPDATED_EVENT,
  describeGraphicTiers,
  getBroadcastGraphicsCatalog,
  getGraphicAvailability,
  getPackageThemes,
  getPackageTickers,
  refreshBroadcastGraphicsCatalog,
  startBroadcastGraphicsCatalog,
  type BroadcastGraphicsCatalog,
  type GraphicAvailability,
} from "../services/broadcastGraphicsCatalog";
import {
  buildThemePreviewHtml,
  buildTickerPreviewHtml,
  buildDockTickerPreviewHtml,
  isKineticObsTheme,
  obsPreviewSandbox,
  type BroadcastTheme,
} from "../lowerthirds/broadcastPreviewHtml";
import TextStyleControls from "../components/TextStyleControls";
import { textStyleCapabilityFor, textStyleKey } from "../lowerthirds/textStyle";

// ── Types ──────────────────────────────────────────────────────────────────

type MainTab = "library" | "my-graphics" | "tickers";

export type GraphicCategory = SavedBroadcastGraphic["category"];
export type CategoryFilter = "all" | GraphicCategory;

type SortOption = "mixed" | "newest" | "oldest" | "name-asc" | "name-desc";

/** Small seeded random generator, so the mixed order stays put while the page is open. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * "All" view: mix the library so it doesn't open on a wall of one kind (e.g. 25 speaker
 * straps). Each category is shuffled, then categories take turns (speaker, giving, quote,
 * welcome, …) in a shuffled order, so every kind shows up near the top.
 */
function mixAcrossCategories<T>(items: T[], categoryOf: (item: T) => string, seed: number): T[] {
  const rand = seededRandom(seed);
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = categoryOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  const queues = shuffled([...groups.values()], rand).map((group) => shuffled(group, rand));
  const out: T[] = [];
  while (queues.some((q) => q.length)) {
    for (const q of queues) {
      const next = q.shift();
      if (next !== undefined) out.push(next);
    }
  }
  return out;
}

interface DockTickerPreview {
  id: string;
  name: string;
  description: string;
  accentColor: string;
  source: "dock" | "permanent" | "remote";
  dockTheme?: TickerThemeConfig;
  permanentTheme?: TickerTheme;
}

// Every category a graphic can be filed under. The library only shows the pills that
// have graphics in them (see visibleCategoryTabs), so empty categories never appear.
const CATEGORY_TABS: { key: CategoryFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "speaker", label: "Speaker" },
  { key: "service", label: "Service" },
  { key: "welcome", label: "Welcome" },
  { key: "giving", label: "Giving" },
  { key: "subscribe", label: "Subscribe" },
  { key: "announcements", label: "Announcements" },
  { key: "countdown", label: "Countdown" },
  { key: "social", label: "Social Media" },
  { key: "branding", label: "Logo & Branding" },
  { key: "scripture", label: "Scripture" },
  { key: "quotes", label: "Quotes" },
  { key: "others", label: "Others" },
];

const CATEGORY_KEYS = new Set<string>(CATEGORY_TABS.map((c) => c.key).filter((k) => k !== "all"));

function getTemplateCategory(theme: BroadcastTheme): GraphicCategory {
  // Graphics that name their own library category (e.g. the Sunday graphics) use it as-is.
  const own = String((theme as { graphicCategory?: string }).graphicCategory || "").toLowerCase();
  if (CATEGORY_KEYS.has(own)) return own as GraphicCategory;
  const tags = (theme.tags || []).map((t) => t.toLowerCase());
  const id = theme.id.toLowerCase();
  const name = theme.name.toLowerCase();

  if (tags.includes("speaker") || theme.category === "speaker") return "speaker";
  if (
    tags.includes("welcome") ||
    name.includes("welcome") ||
    id.includes("join") ||
    id.includes("guest") ||
    id.includes("connect")
  )
    return "welcome";
  if (
    tags.includes("giving") ||
    name.includes("giving") ||
    id.includes("give") ||
    id.includes("tithe") ||
    id.includes("offering")
  )
    return "giving";
  if (tags.includes("subscribe") || id.includes("sub-") || id.includes("subscribe"))
    return "subscribe";
  if (
    tags.includes("announcement") ||
    name.includes("announcement") ||
    id.includes("service-times") ||
    id.includes("kids-checkin") ||
    id.includes("event") ||
    id.includes("baptism")
  )
    return "announcements";
  if (tags.includes("countdown") || name.includes("countdown") || id.includes("countdown"))
    return "countdown";
  if (
    tags.includes("social") ||
    name.includes("social") ||
    id.includes("handle") ||
    id.includes("website")
  )
    return "social";
  if (tags.includes("scripture") || theme.category === "bible" || id.includes("prayer"))
    return "scripture";
  if (tags.includes("quote") || name.includes("quote") || id.includes("quote"))
    return "quotes";
  return "others";
}

/** Read an uploaded logo / picture as a data URL, downscaled so saved graphics stay light. */
function readImageForGraphic(file: File, maxSide = 600): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Unable to read image."));
    reader.onload = () => {
      const src = String(reader.result || "");
      if (file.type === "image/svg+xml") { void offloadImageToDisk(src).then(resolve); return; }
      const img = new Image();
      img.onerror = () => reject(new Error("Unable to load image."));
      img.onload = () => {
        const k = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * k));
        canvas.height = Math.max(1, Math.round(img.height * k));
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(src); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        void offloadImageToDisk(canvas.toDataURL("image/png")).then(resolve);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * A pop-up pinned to the centre of the screen. It is rendered straight into <body>
 * with its positioning set inline, so no page layout, transform or scroll position
 * can move it. While open, nothing behind it scrolls; Esc or a click on the
 * dimmed backdrop closes it.
 */
function ScreenModal({ onClose, label, children }: { onClose: () => void; label: string; children: ReactNode }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    // The app scrolls inside its layout container, not the window, so lock every
    // scrolling container around this page (and the window), then put them back on close.
    const locked: Array<[HTMLElement, string]> = [];
    const lock = (el: HTMLElement) => {
      if (locked.some(([node]) => node === el)) return;
      locked.push([el, el.style.overflow]);
      el.style.overflow = "hidden";
    };
    let node = document.querySelector<HTMLElement>(".broadcast-graphics-page");
    while (node) {
      if (/(auto|scroll|overlay)/.test(getComputedStyle(node).overflowY)) lock(node);
      node = node.parentElement;
    }
    lock(document.documentElement);
    lock(document.body);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => {
      for (const [el, overflow] of locked) el.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  // Mouse wheel / trackpad / touch over the dark backdrop never scrolls anything;
  // scrolling inside the pop-up itself still works.
  const backdropRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = backdropRef.current;
    if (!el) return;
    const block = (e: Event) => { if (e.target === el) e.preventDefault(); };
    el.addEventListener("wheel", block, { passive: false });
    el.addEventListener("touchmove", block, { passive: false });
    return () => {
      el.removeEventListener("wheel", block);
      el.removeEventListener("touchmove", block);
    };
  }, []);
  return createPortal(
    <div
      ref={backdropRef}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={() => onCloseRef.current()}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 2147483000,
        background: "rgba(3, 7, 18, 0.78)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        boxSizing: "border-box",
        color: "var(--text-primary)",
        overscrollBehavior: "contain",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

export default function BroadcastGraphicsPage() {
  // Navigation & filter state
  const [activeTab, setActiveTab] = useState<MainTab>("library");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>("all");
  const [sortBy, setSortBy] = useState<SortOption>("mixed");
  // New mix each time the page opens; stable while it stays open (favouriting won't reshuffle).
  const [mixSeed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const [isBannerDismissed, setIsBannerDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("mce-broadcast-banner-dismissed") === "true";
    } catch {
      return false;
    }
  });

  // Modal states
  const [showHowModal, setShowHowModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  // Saved graphic waiting for the person to confirm deletion (native confirm() isn't available in the app).
  const [deleteGraphicTarget, setDeleteGraphicTarget] = useState<{ id: string; name: string } | null>(null);
  const [previewGraphic, setPreviewGraphic] = useState<{
    theme: BroadcastTheme;
    customVars?: Record<string, string>;
    name: string;
    isSaved?: boolean;
    savedId?: string;
  } | null>(null);

  const [editorState, setEditorState] = useState<{
    template: BroadcastTheme;
    savedId?: string;
    name: string;
    category: GraphicCategory;
    displayType: "lower-third" | "fullscreen" | "overlay";
    variables: Record<string, string>;
    accentColor: string;
    backgroundColor: string;
    fontScale: number;
    position: string;
    speed: string;
  } | null>(null);

  const [previewTicker, setPreviewTicker] = useState<DockTickerPreview | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Data collections
  const [remoteProductionThemes, setRemoteProductionThemes] = useState<RemoteProductionTheme[]>(
    () => getCachedRemoteProductionThemes(),
  );
  const [savedGraphics, setSavedGraphics] = useState<SavedBroadcastGraphic[]>(() =>
    loadSavedBroadcastGraphics(),
  );
  const [obsFavorites, setObsFavorites] = useState<Set<string>>(() => getObsFavorites());
  const [tickerFavorites, setTickerFavorites] = useState<Set<string>>(() => getTickerFavorites());

  const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // Sync favorites & saved storage
  const reloadData = useCallback(() => {
    setSavedGraphics(loadSavedBroadcastGraphics());
    setObsFavorites(getObsFavorites());
    setTickerFavorites(getTickerFavorites());
  }, []);

  useEffect(() => {
    void hydrateFavoriteThemes().then(reloadData);
  }, [reloadData]);

  useEffect(() => {
    window.addEventListener(FAVORITE_THEMES_UPDATED_EVENT, reloadData);
    window.addEventListener(BROADCAST_GRAPHICS_UPDATED_EVENT, reloadData);
    window.addEventListener("storage", reloadData);
    return () => {
      window.removeEventListener(FAVORITE_THEMES_UPDATED_EVENT, reloadData);
      window.removeEventListener(BROADCAST_GRAPHICS_UPDATED_EVENT, reloadData);
      window.removeEventListener("storage", reloadData);
    };
  }, [reloadData]);

  useEffect(() => {
    const syncRemote = () => setRemoteProductionThemes(getCachedRemoteProductionThemes());
    void fetchRemoteProductionThemes().then(setRemoteProductionThemes);
    window.addEventListener(REMOTE_PRODUCTION_THEMES_UPDATED_EVENT, syncRemote);
    return () => window.removeEventListener(REMOTE_PRODUCTION_THEMES_UPDATED_EVENT, syncRemote);
  }, []);

  // Admin catalog: what is listed, paused, or limited to a plan (kept for offline use).
  const [graphicsCatalog, setGraphicsCatalog] = useState<BroadcastGraphicsCatalog | null>(() => getBroadcastGraphicsCatalog());
  useEffect(() => {
    startBroadcastGraphicsCatalog();
    const sync = () => setGraphicsCatalog(getBroadcastGraphicsCatalog());
    void refreshBroadcastGraphicsCatalog().then(sync);
    window.addEventListener(BROADCAST_GRAPHICS_CATALOG_UPDATED_EVENT, sync);
    return () => window.removeEventListener(BROADCAST_GRAPHICS_CATALOG_UPDATED_EVENT, sync);
  }, []);
  /** Admin catalog view only (paused / limited to a plan). The plan allowance is layered on top below. */
  const catalogAvailabilityOf = useCallback(
    (themeId: string): GraphicAvailability => getGraphicAvailability(themeId, graphicsCatalog),
    [graphicsCatalog],
  );

  // Dismiss banner handler
  const handleDismissBanner = useCallback(() => {
    setIsBannerDismissed(true);
    try {
      localStorage.setItem("mce-broadcast-banner-dismissed", "true");
    } catch {
      // ignore
    }
  }, []);

  // Combine built-in templates
  const allTemplates: BroadcastTheme[] = useMemo(() => {
    const remoteLowerThirds = remoteProductionThemes
      .map(remoteThemeToLowerThird)
      .filter((t): t is NonNullable<typeof t> => t !== null) as unknown as BroadcastTheme[];

    const kineticThemes = KINETIC_LOWER_THIRD_THEMES as unknown as BroadcastTheme[];
    // Graphics published from Admin → Broadcast Graphics (no app update needed).
    const packageThemes = getPackageThemes(graphicsCatalog) as unknown as BroadcastTheme[];
    const map = new Map<string, BroadcastTheme>();
    for (const theme of kineticThemes) map.set(theme.id, theme);
    for (const theme of remoteLowerThirds) map.set(theme.id, theme);
    for (const theme of packageThemes) map.set(theme.id, theme);
    return [...map.values()].filter(
      (theme) =>
        theme.id !== "lt-sub-05-sub-7" &&
        theme.id !== "lt-sub-02-sub-2" &&
        theme.id !== "lt-ch-text-give" &&
        getGraphicAvailability(theme.id, graphicsCatalog).visible,
    );
  }, [remoteProductionThemes, graphicsCatalog]);

  // ── Plan limits: graphics and tickers a church may keep (Free = 3 each, set in Admin → Plan Config) ──
  const { user: authUser } = useAuth();
  const effectivePlan = authUser ? getEffectivePlan(authUser) : "free";
  const [upgradePrompt, setUpgradePrompt] = useState<{ message: string; feature: string; requiredPlan?: string } | null>(null);

  // ── Plan allowance: the first N graphics of the library are open, the rest are locked ──
  // N is the plan's broadcast-graphics limit (Free 3, Basic 15, Growth unlimited). The order is the
  // library's own order (not the shuffled grid), so the same graphics stay open for everyone on a plan.
  // Anything already added to OBS stays usable, so a church that downgrades never loses a live graphic.
  const graphicsPlanLimit = checkEntitlementSync("lowerThirds", effectivePlan, 0).limit;
  const planLockedIds = useMemo(() => {
    const locked = new Set<string>();
    if (graphicsPlanLimit < 0) return locked;
    const keep = new Set<string>(obsFavorites);
    for (const graphic of savedGraphics) if (graphic.isAddedToObs) keep.add(graphic.templateId);
    allTemplates.forEach((template, index) => {
      if (index >= graphicsPlanLimit && !keep.has(template.id)) locked.add(template.id);
    });
    return locked;
  }, [allTemplates, graphicsPlanLimit, obsFavorites, savedGraphics]);

  const availabilityOf = useCallback(
    (themeId: string): GraphicAvailability & { planLocked?: boolean } => {
      const base = catalogAvailabilityOf(themeId);
      if (base.usable && planLockedIds.has(themeId)) {
        return { ...base, usable: false, reason: "locked", planLocked: true };
      }
      return base;
    },
    [catalogAvailabilityOf, planLockedIds],
  );

  /** Graphics counted against the plan: library graphics added to OBS + saved graphics. */
  const graphicsUsed = useMemo(() => {
    const visibleFavorites = [...obsFavorites].filter((id) => availabilityOf(id).visible).length;
    return visibleFavorites + savedGraphics.filter((g) => availabilityOf(g.templateId).visible).length;
  }, [availabilityOf, obsFavorites, savedGraphics]);
  const tickersUsed = [...tickerFavorites].filter((id) => availabilityOf(id).visible).length;
  const graphicsLimit = checkEntitlementSync("lowerThirds", effectivePlan, graphicsUsed);
  const tickersLimit = checkEntitlementSync("tickerThemes", effectivePlan, tickersUsed);
  const tickersFeature = checkEntitlementSync("tickers", effectivePlan);

  /** Returns true when one more graphic / ticker fits the plan; otherwise opens the upgrade prompt. */
  const ensureRoomFor = useCallback(
    (kind: "graphic" | "ticker"): boolean => {
      if (kind === "ticker" && !tickersFeature.allowed) {
        setUpgradePrompt({ feature: "tickers", requiredPlan: tickersFeature.requiredPlan, message: tickersFeature.reason || "Upgrade your plan to use tickers." });
        return false;
      }
      const result = kind === "graphic" ? graphicsLimit : tickersLimit;
      if (result.allowed) return true;
      const noun = kind === "graphic" ? "broadcast graphics" : "tickers";
      setUpgradePrompt({
        feature: kind === "graphic" ? "lowerThirds" : "tickerThemes",
        requiredPlan: result.requiredPlan,
        message: result.limit === 0
          ? `Your plan doesn't include ${noun}. Subscribe to add them to OBS.`
          : `Your plan includes up to ${result.limit} ${noun} (you have ${result.current}). Remove one or subscribe to add more.`,
      });
      return false;
    },
    [graphicsLimit, tickersFeature, tickersLimit],
  );

  /** Shows why a graphic (or ticker) can't be used and returns false; true when it can. */
  const ensureUsable = useCallback(
    (themeId: string, noun: "graphic" | "ticker" = "graphic"): boolean => {
      const availability = availabilityOf(themeId);
      if (availability.usable) return true;
      if (availability.planLocked) {
        const next = checkEntitlementSync("lowerThirds", effectivePlan, graphicsPlanLimit);
        setUpgradePrompt({
          feature: "lowerThirds",
          requiredPlan: next.requiredPlan || "basic",
          message: `Your plan includes the first ${graphicsPlanLimit} broadcast graphics. Upgrade to unlock this one and the rest of the library.`,
        });
        return false;
      }
      showToast(
        availability.reason === "paused"
          ? `This ${noun} is paused for now. Please pick another one.`
          : `This ${noun} is available to ${describeGraphicTiers(availability.tiers).toLowerCase()}. Upgrade your plan to use it.`,
        "error",
      );
      return false;
    },
    [availabilityOf, effectivePlan, graphicsPlanLimit, showToast],
  );

  // Combine tickers
  const allTickers: DockTickerPreview[] = useMemo(() => {
    const dockTickers: DockTickerPreview[] = DOCK_TICKER_THEMES.map((dt) => ({
      id: dt.id,
      name: dt.name,
      description: dt.description,
      accentColor: dt.defaultColors.accent,
      source: "dock" as const,
      dockTheme: dt,
    }));
    const permanentTickers: DockTickerPreview[] = defaultTickerThemes.map((pt) => ({
      id: pt.id,
      name: pt.name,
      description: pt.description,
      accentColor: pt.accentColor,
      source: "permanent" as const,
      permanentTheme: pt,
    }));
    const remoteTickers: DockTickerPreview[] = [];
    for (const remoteTheme of remoteProductionThemes) {
      const permanentTheme = remoteThemeToPermanentTickerTheme(remoteTheme);
      if (permanentTheme) {
        remoteTickers.push({
          id: permanentTheme.id,
          name: permanentTheme.name,
          description: permanentTheme.description,
          accentColor: permanentTheme.accentColor,
          source: "remote" as const,
          permanentTheme,
        });
        continue;
      }
      const theme = remoteThemeToTickerConfig(remoteTheme);
      if (!theme) continue;
      remoteTickers.push({
        id: theme.id,
        name: theme.name,
        description: theme.description,
        accentColor: theme.defaultColors.accent,
        source: "remote" as const,
        dockTheme: theme,
      });
    }
    // Tickers uploaded in Admin → Broadcast Graphics → Tickers (no app update needed).
    const packageTickers: DockTickerPreview[] = getPackageTickers(graphicsCatalog).map((pt) => ({
      id: pt.id,
      name: pt.name,
      description: pt.description,
      accentColor: pt.accentColor,
      source: "permanent" as const,
      permanentTheme: pt,
    }));
    const map = new Map<string, DockTickerPreview>();
    for (const t of [...packageTickers, ...dockTickers, ...permanentTickers, ...remoteTickers]) {
      map.set(t.id, t);
    }
    // Tickers the admin made unavailable are not listed.
    return [...map.values()].filter((t) => availabilityOf(t.id).visible);
  }, [availabilityOf, graphicsCatalog, remoteProductionThemes]);

  // Filtered and sorted templates
  const filteredTemplates = useMemo(() => {
    let list = [...allTemplates];

    if (selectedCategory !== "all") {
      list = list.filter((t) => getTemplateCategory(t) === selectedCategory);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((t) => {
        const nameMatch = t.name.toLowerCase().includes(q);
        const descMatch = t.description?.toLowerCase().includes(q) ?? false;
        const tagMatch = t.tags?.some((tag) => tag.toLowerCase().includes(q)) ?? false;
        const newMatch = "new".startsWith(q) && isNewGraphic(t);
        return nameMatch || descMatch || tagMatch || newMatch;
      });
    }

    if (sortBy === "name-asc" || sortBy === "name-desc") {
      list.sort((a, b) => (sortBy === "name-asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)));
    } else if (sortBy === "newest" || sortBy === "oldest") {
      // Graphics with a date (the newest additions) by date; the rest keep the library order.
      const dated = list.map((t, i) => ({ t, i, at: graphicAddedAt(t) }));
      dated.sort((a, b) => (b.at - a.at) || (a.i - b.i));
      list = dated.map((d) => d.t);
      if (sortBy === "oldest") list.reverse();
    } else {
      // Mixed (default): graphics added recently come first, in "All" and in every category,
      // then the rest of the library. In "All" each group is mixed across categories.
      const { fresh, rest } = splitNewGraphics(list, (t) => t);
      list =
        selectedCategory === "all" && !searchQuery.trim()
          ? [...mixAcrossCategories(fresh, getTemplateCategory, mixSeed), ...mixAcrossCategories(rest, getTemplateCategory, mixSeed)]
          : [...fresh, ...rest];
    }

    // Plan-locked graphics go to the end (stable), so the open ones are the first in the grid.
    if (planLockedIds.size > 0) {
      list = [...list.filter((t) => !planLockedIds.has(t.id)), ...list.filter((t) => planLockedIds.has(t.id))];
    }

    return list;
  }, [allTemplates, selectedCategory, searchQuery, sortBy, mixSeed, planLockedIds]);

  const visibleSavedGraphics = useMemo(
    () => savedGraphics.filter((graphic) => availabilityOf(graphic.templateId).visible),
    [availabilityOf, savedGraphics],
  );

  // Category pills: "All" plus only the categories that have something in them on this tab.
  const visibleCategoryTabs = useMemo(() => {
    const used = new Set<string>(
      activeTab === "my-graphics"
        ? visibleSavedGraphics.map((g) => g.category)
        : allTemplates.map((t) => getTemplateCategory(t)),
    );
    return CATEGORY_TABS.filter((c) => c.key === "all" || used.has(c.key));
  }, [activeTab, allTemplates, visibleSavedGraphics]);

  // A category that has emptied (or does not exist on this tab) falls back to "All".
  useEffect(() => {
    if (!visibleCategoryTabs.some((c) => c.key === selectedCategory)) setSelectedCategory("all");
  }, [visibleCategoryTabs, selectedCategory]);

  // Filtered and sorted saved graphics
  const filteredSavedGraphics = useMemo(() => {
    let list = [...visibleSavedGraphics];

    if (selectedCategory !== "all") {
      list = list.filter((g) => g.category === selectedCategory);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((g) => {
        const nameMatch = g.name.toLowerCase().includes(q);
        const varMatch = Object.values(g.variables).some((v) => v.toLowerCase().includes(q));
        return nameMatch || varMatch;
      });
    }

    list.sort((a, b) => {
      if (sortBy === "name-asc") return a.name.localeCompare(b.name);
      if (sortBy === "name-desc") return b.name.localeCompare(a.name);
      if (sortBy === "oldest")
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
    });

    return list;
  }, [visibleSavedGraphics, selectedCategory, searchQuery, sortBy]);

  // Filtered tickers
  const filteredTickers = useMemo(() => {
    let list = [...allTickers];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
    }
    return list;
  }, [allTickers, searchQuery]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleToggleTemplateObs = useCallback(
    (templateId: string) => {
      const willAdd = !obsFavorites.has(templateId);
      if (willAdd && !ensureUsable(templateId)) return;
      if (willAdd && !ensureRoomFor("graphic")) return;
      const next = setObsFavorite(templateId, willAdd);
      setObsFavorites(next);
      const tpl = allTemplates.find((t) => t.id === templateId);
      if (willAdd) trackGraphicUsage("added_to_obs", templateId, tpl?.name);
      showToast(
        willAdd
          ? `"${tpl?.name || "Template"}" added to OBS Dock`
          : `"${tpl?.name || "Template"}" removed from OBS Dock`,
      );
    },
    [allTemplates, ensureRoomFor, ensureUsable, obsFavorites, showToast],
  );

  const handleToggleSavedObs = useCallback(
    (graphicId: string) => {
      const graphic = savedGraphics.find((g) => g.id === graphicId);
      if (graphic && !graphic.isAddedToObs && !ensureUsable(graphic.templateId)) return;
      const nextState = toggleGraphicObsAvailability(graphicId);
      if (nextState && graphic) trackGraphicUsage("added_to_obs", graphic.templateId, graphic.name);
      reloadData();
      showToast(
        nextState ? "Graphic added to OBS Dock" : "Graphic removed from OBS Dock",
      );
    },
    [ensureUsable, reloadData, savedGraphics, showToast],
  );

  const handleDuplicateSaved = useCallback(
    (graphicId: string) => {
      if (!ensureRoomFor("graphic")) return;
      const copy = duplicateBroadcastGraphic(graphicId);
      if (copy) {
        reloadData();
        showToast(`Duplicated as "${copy.name}"`);
      }
    },
    [ensureRoomFor, reloadData, showToast],
  );

  const handleDeleteSaved = useCallback(
    (graphicId: string) => {
      const item = savedGraphics.find((g) => g.id === graphicId);
      setDeleteGraphicTarget({ id: graphicId, name: item?.name || "this graphic" });
    },
    [savedGraphics],
  );

  const confirmDeleteSaved = useCallback(() => {
    if (!deleteGraphicTarget) return;
    deleteBroadcastGraphic(deleteGraphicTarget.id);
    setDeleteGraphicTarget(null);
    reloadData();
    showToast("Graphic deleted");
  }, [deleteGraphicTarget, reloadData, showToast]);

  const handleToggleTickerObs = useCallback(
    (tickerId: string) => {
      const willAdd = !tickerFavorites.has(tickerId);
      if (willAdd && !ensureUsable(tickerId, "ticker")) return;
      if (willAdd && !ensureRoomFor("ticker")) return;
      const next = setTickerFavorite(tickerId, willAdd);
      setTickerFavorites(next);
      showToast(willAdd ? "Ticker added to OBS Dock" : "Ticker removed from OBS Dock");
    },
    [ensureRoomFor, ensureUsable, showToast, tickerFavorites],
  );

  // Open editor from template
  const handleOpenCustomize = useCallback(
    (template: BroadcastTheme) => {
      if (!ensureUsable(template.id)) return;
      const initialVars: Record<string, string> = {};
      if (template.variables) {
        for (const v of template.variables) {
          const varDef = v as Record<string, unknown>;
          if (typeof varDef.key === "string") {
            initialVars[varDef.key] = String(varDef.defaultValue ?? "");
          }
        }
      }

      // Fill in the church's own details (church name, main pastor) from the church profile.
      refreshMinistry();
      const filledVars = applyChurchDefaults(
        template as unknown as ChurchThemeLike,
        initialVars,
        getMinistryData(),
      );

      setEditorState({
        template,
        name: template.name,
        category: getTemplateCategory(template),
        displayType: "lower-third",
        variables: filledVars,
        accentColor: template.accentColor || "#5b5cf6",
        backgroundColor: "transparent",
        fontScale: 1,
        position: "bottom-left",
        speed: "normal",
      });
    },
    [ensureUsable],
  );

  // Fill the church name, main pastor, website, phone, email, address and social icons from the church profile, replacing whatever is typed.
  const handleUseChurchInfo = useCallback(() => {
    refreshMinistry();
    const ministry = getMinistryData();
    const hasAnyChurchInfo = Boolean(
      ministry.churchName.trim() ||
      ministry.mainPastorName.trim() ||
      (ministry.website ?? "").trim() ||
      (ministry.phone ?? "").trim() ||
      (ministry.email ?? "").trim() ||
      (ministry.address ?? "").trim() ||
      Object.keys(ministry.socials ?? {}).length > 0,
    );
    if (!hasAnyChurchInfo) {
      showToast(
        "Your church profile is empty. Fill it in at makechurcheazy.com/church-profile, then try again.",
        "error",
      );
      return;
    }
    setEditorState((prev) =>
      prev
        ? {
            ...prev,
            variables: applyChurchDefaults(
              prev.template as unknown as ChurchThemeLike,
              prev.variables,
              ministry,
              { onlyUntouched: false },
            ),
          }
        : prev,
    );
  }, [showToast]);

  // Put every text box back to its original text (your church details where known).
  const handleResetAllText = useCallback(() => {
    refreshMinistry();
    setEditorState((prev) => {
      if (!prev) return prev;
      const defaults = churchAwareDefaults(prev.template as unknown as ChurchThemeLike, getMinistryData());
      const next: Record<string, string> = { ...prev.variables };
      for (const v of prev.template.variables ?? []) {
        const def = v as unknown as Record<string, unknown>;
        const key = typeof def.key === "string" ? def.key : "";
        if (!key || key.startsWith("kx")) continue;
        const boxType = String(def.type || "text");
        if (boxType !== "text" && boxType !== "list") continue;
        next[key] = defaults[key] ?? String(def.defaultValue ?? "");
      }
      return { ...prev, variables: next };
    });
  }, []);

  // Open editor from existing saved graphic
  const handleOpenEditSaved = useCallback(
    (saved: SavedBroadcastGraphic) => {
      const template =
        allTemplates.find((t) => t.id === saved.templateId) || allTemplates[0];

      setEditorState({
        template,
        savedId: saved.id,
        name: saved.name,
        category: saved.category,
        displayType: saved.displayType,
        // Boxes that still hold what the church profile said before it changed follow the new profile.
        variables: applyChurchDefaults(
          template as unknown as ChurchThemeLike,
          { ...saved.variables },
          getMinistryData(),
          { history: getMinistryHistory(), keepCleared: true },
        ),
        accentColor: saved.design?.accentColor || template.accentColor || "#5b5cf6",
        backgroundColor: saved.design?.bgColor || "transparent",
        fontScale: saved.design?.fontSizeScale || 1,
        position: saved.animation?.position || "bottom-left",
        speed: saved.animation?.speed || "normal",
      });
    },
    [allTemplates],
  );

  // Save graphic from editor
  const handleSaveEditor = useCallback(
    (addToObs: boolean) => {
      if (!editorState) return;
      if (addToObs && !ensureUsable(editorState.template.id)) return;
      // A new saved graphic counts against the plan (Save and Save & Add to OBS).
      if (!editorState.savedId && !ensureRoomFor("graphic")) return;

      const payload = {
        name: editorState.name.trim() || editorState.template.name,
        templateId: editorState.template.id,
        category: editorState.category,
        displayType: editorState.displayType,
        variables: editorState.variables,
        design: {
          accentColor: editorState.accentColor,
          bgColor: editorState.backgroundColor,
          fontSizeScale: editorState.fontScale,
        },
        animation: {
          position: editorState.position,
          speed: editorState.speed,
        },
        isAddedToObs: addToObs,
      };

      // Count "added to OBS" only when the graphic was not already in the Dock.
      const wasInDock = editorState.savedId
        ? Boolean(savedGraphics.find((g) => g.id === editorState.savedId)?.isAddedToObs)
        : false;
      if (addToObs && !wasInDock) {
        trackGraphicUsage("added_to_obs", editorState.template.id, editorState.template.name);
      }

      try {
      if (editorState.savedId) {
        updateBroadcastGraphic(editorState.savedId, payload);
        showToast(
          addToObs
            ? `Updated "${payload.name}" & synced to OBS Dock`
            : `Saved "${payload.name}" to My Graphics`,
        );
      } else {
        saveBroadcastGraphic(payload);
        showToast(
          addToObs
            ? `Created "${payload.name}" & synced to OBS Dock`
            : `Saved "${payload.name}" to My Graphics`,
        );
      }

      } catch (err) {
        showToast((err as Error)?.message || "Could not save the graphic.", "error");
        return;
      }

      setEditorState(null);
      reloadData();
      if (activeTab !== "my-graphics") {
        setActiveTab("my-graphics");
      }
    },
    [activeTab, editorState, ensureRoomFor, ensureUsable, reloadData, savedGraphics, showToast],
  );

  // Close menus on outside click
  useEffect(() => {
    const handleDocClick = () => setActiveMenuId(null);
    document.addEventListener("click", handleDocClick);
    return () => document.removeEventListener("click", handleDocClick);
  }, []);

  // Graphics saved before the Dock sync existed are pushed to the Dock once on open.
  useEffect(() => {
    // Pictures stored inside saved graphics fill browser storage; move them to files once.
    void hydrateSavedBroadcastGraphics()
      .then(() => offloadSavedGraphicImages())
      .then(() => reloadData());
    void syncSavedGraphicsToDock();
  }, [reloadData]);


  return (
    <div className="broadcast-graphics-page">
      <div className="broadcast-graphics-container">
        {/* Full preview — centred pop-up, fixed on screen. */}
        {previewGraphic && (
          <ScreenModal label="Graphic preview" onClose={() => setPreviewGraphic(null)}>
          <section
            className="bg-how-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 880, maxHeight: "100%", overflowY: "auto" }}
          >
              <div className="bg-modal-header">
                <div>
                  <h3 className="bg-modal-header__title">{previewGraphic.name}</h3>
                </div>
                <button
                  className="bg-modal-close-btn"
                  onClick={() => setPreviewGraphic(null)}
                >
                  <X size={18} />
                </button>
              </div>

              <div style={{ padding: "16px 24px 20px", background: "#070d18" }}>
                <div
                  style={{
                    aspectRatio: "16 / 9",
                    width: "min(100%, calc(50vh * 16 / 9))",
                    margin: "0 auto",
                    borderRadius: 8,
                    overflow: "hidden",
                    border: "1px solid #293650",
                    position: "relative",
                  }}
                >
                  <iframe
                    id="bg-preview-iframe"
                    style={{ width: "100%", height: "100%", border: "none" }}
                    srcDoc={buildThemePreviewHtml(previewGraphic.theme, {
                      hover: false,
                      loop: false,
                      customVariables: previewGraphic.customVars,
                    })}
                    sandbox={obsPreviewSandbox(previewGraphic.theme)}
                    title={previewGraphic.name}
                  />
                </div>
                {isKineticObsTheme(previewGraphic.theme) && (
                  <div className="bg-preview-anim">
                    <div className="bg-preview-anim__buttons">
                      <button
                        className="bg-btn bg-btn--primary"
                        onClick={() => {
                          const iframe = document.getElementById(
                            "bg-preview-iframe",
                          ) as HTMLIFrameElement;
                          iframe?.contentWindow?.postMessage({ type: "mce-kx-in" }, "*");
                        }}
                      >
                        <Play size={14} />
                        <span>Animate In</span>
                      </button>

                      <button
                        className="bg-btn bg-btn--secondary"
                        onClick={() => {
                          const iframe = document.getElementById(
                            "bg-preview-iframe",
                          ) as HTMLIFrameElement;
                          iframe?.contentWindow?.postMessage({ type: "mce-kx-out" }, "*");
                        }}
                      >
                        <RotateCcw size={14} />
                        <span>Animate Out</span>
                      </button>
                    </div>
                    <p className="bg-preview-anim__hint">
                      Press Animate In to bring the graphic on screen, then Animate Out to take it off.
                    </p>
                  </div>
                )}
              </div>

              <div className="bg-modal-footer">

                <button
                  className="bg-btn bg-btn--secondary"
                  onClick={() => {
                    handleOpenCustomize(previewGraphic.theme);
                    setPreviewGraphic(null);
                  }}
                >
                  <Sliders size={14} />
                  <span>Customize</span>
                </button>

                <button
                  className="bg-btn bg-btn--primary"
                  onClick={() => {
                    if (previewGraphic.isSaved && previewGraphic.savedId) {
                      handleToggleSavedObs(previewGraphic.savedId);
                    } else {
                      handleToggleTemplateObs(previewGraphic.theme.id);
                    }
                    setPreviewGraphic(null);
                  }}
                >
                  <Tv size={14} />
                  <span>
                    {(previewGraphic.isSaved && previewGraphic.savedId
                      ? savedGraphics.find((g) => g.id === previewGraphic.savedId)?.isAddedToObs
                      : obsFavorites.has(previewGraphic.theme.id))
                      ? "Remove from OBS"
                      : "Add to OBS Dock"}
                  </span>
                </button>
              </div>
          </section>
          </ScreenModal>
        )}
        {deleteGraphicTarget && (
          <ModalDialog
            tone="danger"
            icon={<Trash2 size={26} />}
            title="Delete this graphic?"
            onClose={() => setDeleteGraphicTarget(null)}
            actions={[
              { label: "Cancel", onClick: () => setDeleteGraphicTarget(null), variant: "ghost", autoFocus: true },
              { label: "Delete graphic", onClick: confirmDeleteSaved, variant: "danger" },
            ]}
          >
            Are you sure you want to delete &ldquo;{deleteGraphicTarget.name}&rdquo;?
          </ModalDialog>
        )}
        {upgradePrompt && (
          <PlanLimitModal
            open
            onClose={() => setUpgradePrompt(null)}
            title={
              upgradePrompt.feature === "lowerThirds"
                ? "Broadcast graphics limit reached"
                : upgradePrompt.feature === "tickerThemes"
                  ? "Ticker limit reached"
                  : "Upgrade to use tickers"
            }
            requiredPlan={upgradePrompt.requiredPlan || "basic"}
            message={upgradePrompt.message}
            reason={`${upgradePrompt.feature}_limit`}
          />
        )}
        {/* ── 1. Page Header ── */}
        <header className="bg-header">
          <div className="bg-header__info">
            <h1 className="bg-header__title">
              <MonitorPlay size={28} color="var(--accent-blue)" />
              Broadcast Graphics
            </h1>
            <p className="bg-header__description">
              Create and manage professional graphics for your livestream. Lower thirds, speaker
              introductions, welcome messages, giving details, announcements and more.
            </p>
          </div>

          <div className="bg-header__actions">
            <button
              className="bg-btn bg-btn--secondary"
              onClick={() => setShowHowModal(true)}
              title="How it works?"
            >
              <HelpCircle size={17} />
              <span>How it works?</span>
            </button>

            <button
              className="bg-btn bg-btn--primary"
              onClick={() => setShowCreateModal(true)}
              title="Create Graphic"
            >
              <Plus size={18} />
              <span>+ Create Graphic</span>
            </button>
          </div>
        </header>

        {(() => {
          const isTickers = activeTab === "tickers";
          const result = isTickers ? tickersLimit : graphicsLimit;
          const locked = isTickers && !tickersFeature.allowed;
          if (!locked && (result.limit < 0 || result.limit === Infinity)) return null;
          const used = isTickers ? tickersUsed : graphicsUsed;
          const atLimit = locked || used >= result.limit;
          const noun = isTickers ? "tickers" : "graphics";
          return (
            <div className={`bg-plan-banner ${atLimit ? "bg-plan-banner--full" : ""}`} role="status">
              <span>
                {locked
                  ? "Tickers aren't included in your plan."
                  : atLimit
                    ? `You've used all ${result.limit} ${noun} on your plan.`
                    : `Your plan includes ${result.limit} ${noun}: ${used} of ${result.limit} used.`}
                {atLimit ? " Subscribe to add more." : ""}
              </span>
              <button
                type="button"
                className="bg-plan-banner__cta"
                onClick={() => void openDashboardSubscriptionPlans()}
              >
                Upgrade
              </button>
            </div>
          );
        })()}

        {/* ── 2. Main Navigation Tabs ── */}
        <nav className="bg-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === "library"}
            className={`bg-tab ${activeTab === "library" ? "bg-tab--active" : ""}`}
            onClick={() => setActiveTab("library")}
          >
            <LayoutGrid size={18} />
            <span>Template Library</span>
            <span className="bg-tab__badge">{allTemplates.length}</span>
          </button>

          <button
            role="tab"
            aria-selected={activeTab === "my-graphics"}
            className={`bg-tab ${activeTab === "my-graphics" ? "bg-tab--active" : ""}`}
            onClick={() => setActiveTab("my-graphics")}
          >
            <FolderOpen size={18} />
            <span>My Graphics</span>
            <span className="bg-tab__badge">{visibleSavedGraphics.length}</span>
          </button>

          <button
            role="tab"
            aria-selected={activeTab === "tickers"}
            className={`bg-tab ${activeTab === "tickers" ? "bg-tab--active" : ""}`}
            onClick={() => setActiveTab("tickers")}
          >
            <Radio size={18} />
            <span>Tickers</span>
            <span className="bg-tab__badge">{allTickers.length}</span>
          </button>
        </nav>

        {/* ── 3. Search, Sort & Category Filter Bar ── */}
        <div className="bg-toolbar">
          <div className="bg-toolbar__top">
            <div className="bg-search-box">
              <Search size={16} className="bg-search-box__icon" />
              <input
                type="text"
                className="bg-search-box__input"
                placeholder={
                  activeTab === "tickers" ? "Search tickers..." : "Search graphics..."
                }
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  className="bg-search-box__clear"
                  onClick={() => setSearchQuery("")}
                  title="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {activeTab !== "tickers" && (
              <select
                className="bg-sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                aria-label="Sort graphics"
              >
                <option value="mixed">Mixed</option>
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="name-asc">Name A–Z</option>
                <option value="name-desc">Name Z–A</option>
              </select>
            )}
          </div>

          {activeTab !== "tickers" && (
            <div className="bg-categories">
              {visibleCategoryTabs.map((cat) => (
                <button
                  key={cat.key}
                  className={`bg-category-pill ${
                    selectedCategory === cat.key ? "bg-category-pill--active" : ""
                  }`}
                  onClick={() => setSelectedCategory(cat.key)}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── 4. Promotional Banner (Dismissible) ── */}
        {!isBannerDismissed && (
          <aside className="bg-promo-banner">
            <div className="bg-promo-banner__visuals">
              <div className="bg-promo-banner__card-mock bg-promo-banner__card-mock--1">
                <div className="bg-promo-banner__card-mock-title">NOW MINISTERING</div>
                <div className="bg-promo-banner__card-mock-subtitle">Senior Pastor</div>
              </div>
              <div className="bg-promo-banner__card-mock bg-promo-banner__card-mock--2">
                <div className="bg-promo-banner__card-mock-title">GIVING DETAILS</div>
                <div className="bg-promo-banner__card-mock-subtitle">Direct Bank Transfer</div>
              </div>
            </div>

            <div className="bg-promo-banner__content">
              <div className="bg-promo-banner__eyebrow">
                PROFESSIONAL GRAPHICS FOR YOUR CHURCH
              </div>
              <h3 className="bg-promo-banner__heading">
                Beautiful ready-to-use designs for your church livestream.
              </h3>
              <ul className="bg-promo-banner__features">
                <li className="bg-promo-banner__feature-item">
                  <span className="icon">✓</span> Speaker lower thirds & introductions
                </li>
                <li className="bg-promo-banner__feature-item">
                  <span className="icon">✓</span> Giving, bank details & tithe graphics
                </li>
                <li className="bg-promo-banner__feature-item">
                  <span className="icon">✓</span> Social media overlays & subscribe prompts
                </li>
                <li className="bg-promo-banner__feature-item">
                  <span className="icon">✓</span> Zero OBS setup — one click to display
                </li>
              </ul>
            </div>

            <button
              className="bg-promo-banner__dismiss"
              onClick={handleDismissBanner}
              title="Dismiss banner"
              aria-label="Dismiss banner"
            >
              <X size={16} />
            </button>
          </aside>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
           TAB 1: TEMPLATE LIBRARY
           ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === "library" && (
          <main>
            {filteredTemplates.length === 0 ? (
              <div className="bg-empty-state">
                <div className="bg-empty-state__icon-wrap">
                  <Search size={28} />
                </div>
                <h3 className="bg-empty-state__title">No templates found</h3>
                <p className="bg-empty-state__description">
                  Try adjusting your search query or choosing another category filter.
                </p>
                <button
                  className="bg-btn bg-btn--ghost"
                  onClick={() => {
                    setSearchQuery("");
                    setSelectedCategory("all");
                  }}
                >
                  Clear Filters
                </button>
              </div>
            ) : (
              <div className="bg-grid">
                {filteredTemplates.map((template) => {
                  const isFav = obsFavorites.has(template.id);
                  const cat = getTemplateCategory(template);
                  const availability = availabilityOf(template.id);
                  const isPaused = availability.reason === "paused";

                  return (
                    <article
                      key={template.id}
                      className={`bg-card ${isFav ? "bg-card--added" : ""}`}
                    >
                      {/* 16:9 Canvas Stage */}
                      <div className="bg-card__stage-container">
                        {isFav && !isPaused && <span className="bg-card__obs-badge">IN OBS</span>}
                        {!availability.usable && (
                          <span
                            className="bg-card__obs-badge"
                            style={{ left: "auto", right: 44, background: availability.reason === "paused" ? "#475569" : "#b45309" }}
                            title={availability.reason === "paused" ? "Paused by Make Church Eazy" : availability.planLocked ? "Upgrade your plan to unlock" : `For ${describeGraphicTiers(availability.tiers).toLowerCase()}`}
                          >
                            {availability.reason === "paused" ? "PAUSED" : "LOCKED"}
                          </span>
                        )}

                        {!isPaused && <button
                          className={`bg-card__star-btn ${
                            isFav ? "bg-card__star-btn--active" : ""
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleTemplateObs(template.id);
                          }}
                          title={isFav ? "Remove from OBS Dock" : "Add to OBS Dock"}
                          aria-label={isFav ? "Remove from OBS Dock" : "Add to OBS Dock"}
                        >
                          <Star size={16} fill={isFav ? "#fbbf24" : "none"} />
                        </button>}

                        <LazyPreviewFrame
                          className="bg-card__iframe"
                          cacheKey={template.id}
                          buildHtml={() => buildThemePreviewHtml(template, { hover: true })}
                          sandbox={obsPreviewSandbox(template)}
                          title={template.name}
                        />

                        {!isPaused && <div className="bg-card__overlay">
                          <button
                            className="bg-card__play-btn"
                            onClick={() =>
                              setPreviewGraphic({
                                theme: template,
                                name: template.name,
                              })
                            }
                            title="Play Preview"
                          >
                            <Play size={20} fill="#ffffff" />
                          </button>
                        </div>}
                      </div>

                      {/* Card Info */}
                      <div className="bg-card__body">
                        <div className="bg-card__header-row">
                          <div className="bg-card__title-area">
                            <h4 className="bg-card__name" title={template.name}>
                              {template.name}
                            </h4>
                            <div className="bg-card__meta-tags">
                              {isNewGraphic(template) && <span className="bg-card__tag bg-card__tag--new">New</span>}
                              <span className="bg-card__tag bg-card__tag--category">{cat}</span>
                              <span className="bg-card__tag">Lower Third</span>
                            </div>
                          </div>
                        </div>

                        {/* Card Actions */}
                        {!isPaused && <div className="bg-card__actions">
                          <button
                            className="bg-card__btn-preview"
                            onClick={() =>
                              setPreviewGraphic({
                                theme: template,
                                name: template.name,
                              })
                            }
                            title="Preview graphic"
                          >
                            <Eye size={14} />
                            <span>Preview</span>
                          </button>

                          <button
                            className="bg-card__btn-customize"
                            onClick={() => handleOpenCustomize(template)}
                            title="Customize and use this template"
                          >
                            <Sliders size={14} />
                            <span>Customize</span>
                          </button>

                          <div style={{ position: "relative" }}>
                            <button
                              className="bg-card__menu-trigger"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveMenuId(
                                  activeMenuId === template.id ? null : template.id,
                                );
                              }}
                              title="More options"
                            >
                              <MoreVertical size={16} />
                            </button>

                            {activeMenuId === template.id && (
                              <div
                                className="bg-menu-dropdown"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  className="bg-menu-item"
                                  onClick={() => {
                                    handleToggleTemplateObs(template.id);
                                    setActiveMenuId(null);
                                  }}
                                >
                                  <Tv size={14} />
                                  <span>{isFav ? "Remove from OBS" : "Add to OBS Dock"}</span>
                                </button>

                                <button
                                  className="bg-menu-item"
                                  onClick={() => {
                                    handleOpenCustomize(template);
                                    setActiveMenuId(null);
                                  }}
                                >
                                  <Edit2 size={14} />
                                  <span>Customize & Use</span>
                                </button>

                                <button
                                  className="bg-menu-item"
                                  onClick={() => {
                                    setPreviewGraphic({
                                      theme: template,
                                      name: template.name,
                                    });
                                    setActiveMenuId(null);
                                  }}
                                >
                                  <Eye size={14} />
                                  <span>Full Preview</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </main>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
           TAB 2: MY GRAPHICS
           ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === "my-graphics" && (
          <main>
            {savedGraphics.length === 0 ? (
              <div className="bg-empty-state">
                <div className="bg-empty-state__icon-wrap">
                  <MonitorPlay size={32} />
                </div>
                <h3 className="bg-empty-state__title">No saved broadcast graphics yet</h3>
                <p className="bg-empty-state__description">
                  Customize ready-made speaker introductions, giving details, and welcome banners
                  to recall instantly during your livestream.
                </p>
                <button
                  className="bg-btn bg-btn--primary"
                  onClick={() => setActiveTab("library")}
                >
                  <ArrowRight size={16} />
                  <span>Browse Template Library</span>
                </button>
              </div>
            ) : filteredSavedGraphics.length === 0 ? (
              <div className="bg-empty-state">
                <div className="bg-empty-state__icon-wrap">
                  <Search size={28} />
                </div>
                <h3 className="bg-empty-state__title">
                  {visibleSavedGraphics.length > 0 ? "No matching graphics" : "No saved graphics available"}
                </h3>
                <p className="bg-empty-state__description">
                  {visibleSavedGraphics.length > 0
                    ? "Try adjusting your search query or filter to find your saved graphic."
                    : "Unavailable graphics are removed from this list. Browse the library for graphics you can use."}
                </p>
              </div>
            ) : (
              <div className="bg-grid">
                {filteredSavedGraphics.map((graphic) => {
                  const template = allTemplates.find((t) => t.id === graphic.templateId);
                  if (!template) return null;
                  const savedAvailability = availabilityOf(graphic.templateId);
                  const isPaused = savedAvailability.reason === "paused";

                  return (
                    <article
                      key={graphic.id}
                      className={`bg-card ${graphic.isAddedToObs ? "bg-card--added" : ""}`}
                    >
                      {/* 16:9 Canvas Stage */}
                      <div className="bg-card__stage-container">
                        {graphic.isAddedToObs && !isPaused && (
                          <span className="bg-card__obs-badge">IN OBS</span>
                        )}
                        {!savedAvailability.usable && (
                          <span
                            className="bg-card__obs-badge"
                            style={{ left: "auto", right: 44, background: savedAvailability.reason === "locked" ? "#b45309" : "#475569" }}
                            title={savedAvailability.reason === "locked"
                              ? (savedAvailability.planLocked ? "Upgrade your plan to unlock" : `For ${describeGraphicTiers(savedAvailability.tiers).toLowerCase()}`)
                              : "Not available right now"}
                          >
                            {savedAvailability.reason === "locked" ? "LOCKED" : savedAvailability.visible ? "PAUSED" : "UNAVAILABLE"}
                          </span>
                        )}

                        {!isPaused && <button
                          className={`bg-card__star-btn ${
                            graphic.isAddedToObs ? "bg-card__star-btn--active" : ""
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleSavedObs(graphic.id);
                          }}
                          title={
                            graphic.isAddedToObs
                              ? "Remove from OBS Dock"
                              : "Add to OBS Dock"
                          }
                        >
                          <Star size={16} fill={graphic.isAddedToObs ? "#fbbf24" : "none"} />
                        </button>}

                        <LazyPreviewFrame
                          className="bg-card__iframe"
                          cacheKey={JSON.stringify([graphic.id, graphic.variables, graphic.design?.bgColor])}
                          buildHtml={() => buildThemePreviewHtml(template, {
                            hover: true,
                            customVariables: graphic.variables,
                            backdrop:
                              graphic.design?.bgColor === "transparent"
                                ? undefined
                                : graphic.design?.bgColor,
                          })}
                          sandbox={obsPreviewSandbox(template)}
                          title={graphic.name}
                        />

                        {!isPaused && <div className="bg-card__overlay">
                          <button
                            className="bg-card__play-btn"
                            onClick={() =>
                              setPreviewGraphic({
                                theme: template,
                                customVars: graphic.variables,
                                name: graphic.name,
                                isSaved: true,
                                savedId: graphic.id,
                              })
                            }
                            title="Play Preview"
                          >
                            <Play size={20} fill="#ffffff" />
                          </button>
                        </div>}
                      </div>

                      {/* Card Info */}
                      <div className="bg-card__body">
                        <div className="bg-card__header-row">
                          <div className="bg-card__title-area">
                            <h4 className="bg-card__name" title={graphic.name}>
                              {graphic.name}
                            </h4>
                            <div className="bg-card__meta-tags">
                              <span className="bg-card__tag bg-card__tag--category">
                                {graphic.category}
                              </span>
                              <span className="bg-card__tag">{template.name}</span>
                            </div>
                          </div>
                        </div>

                        {/* Card Actions */}
                        {!isPaused && <div className="bg-card__actions">
                          <button
                            className="bg-card__btn-preview"
                            onClick={() =>
                              setPreviewGraphic({
                                theme: template,
                                customVars: graphic.variables,
                                name: graphic.name,
                                isSaved: true,
                                savedId: graphic.id,
                              })
                            }
                            title="Preview graphic"
                          >
                            <Eye size={14} />
                            <span>Preview</span>
                          </button>

                          <button
                            className="bg-card__btn-customize"
                            onClick={() => handleOpenEditSaved(graphic)}
                            title="Edit graphic"
                          >
                            <Edit2 size={14} />
                            <span>Edit</span>
                          </button>

                          <div style={{ position: "relative" }}>
                            <button
                              className="bg-card__menu-trigger"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveMenuId(
                                  activeMenuId === graphic.id ? null : graphic.id,
                                );
                              }}
                              title="More options"
                            >
                              <MoreVertical size={16} />
                            </button>

                            {activeMenuId === graphic.id && (
                              <div
                                className="bg-menu-dropdown"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  className="bg-menu-item"
                                  onClick={() => {
                                    handleToggleSavedObs(graphic.id);
                                    setActiveMenuId(null);
                                  }}
                                >
                                  <Tv size={14} />
                                  <span>
                                    {graphic.isAddedToObs
                                      ? "Remove from OBS"
                                      : "Add to OBS Dock"}
                                  </span>
                                </button>

                                <button
                                  className="bg-menu-item"
                                  onClick={() => {
                                    handleDuplicateSaved(graphic.id);
                                    setActiveMenuId(null);
                                  }}
                                >
                                  <Copy size={14} />
                                  <span>Duplicate</span>
                                </button>

                                <button
                                  className="bg-menu-item bg-menu-item--danger"
                                  onClick={() => {
                                    handleDeleteSaved(graphic.id);
                                    setActiveMenuId(null);
                                  }}
                                >
                                  <Trash2 size={14} />
                                  <span>Delete</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </main>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
           TAB 3: TICKERS
           ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === "tickers" && (
          <main>
            {filteredTickers.length === 0 ? (
              <div className="bg-empty-state">
                <div className="bg-empty-state__icon-wrap">
                  <Search size={28} />
                </div>
                <h3 className="bg-empty-state__title">No tickers found</h3>
                <p className="bg-empty-state__description">
                  Try adjusting your search query.
                </p>
              </div>
            ) : (
              <div className="bg-grid">
                {filteredTickers.map((ticker) => {
                  const isFav = tickerFavorites.has(ticker.id);
                  const tickerAvailability = availabilityOf(ticker.id);
                  const tickerPaused = tickerAvailability.reason === "paused";

                  return (
                    <article
                      key={ticker.id}
                      className={`bg-card ${isFav && !tickerPaused ? "bg-card--added" : ""}`}
                      style={tickerPaused ? { opacity: 0.6 } : undefined}
                    >
                      <div className="bg-card__stage-container">
                        {isFav && !tickerPaused && <span className="bg-card__obs-badge">IN OBS</span>}
                        {!tickerAvailability.usable && (
                          <span
                            className="bg-card__obs-badge"
                            style={{ left: "auto", right: 44, background: tickerPaused ? "#475569" : "#b45309" }}
                            title={tickerPaused ? "Paused by Make Church Eazy" : `For ${describeGraphicTiers(tickerAvailability.tiers).toLowerCase()}`}
                          >
                            {tickerPaused ? "PAUSED" : "LOCKED"}
                          </span>
                        )}

                        {!tickerPaused && <button
                          className={`bg-card__star-btn ${
                            isFav ? "bg-card__star-btn--active" : ""
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleTickerObs(ticker.id);
                          }}
                          title={isFav ? "Remove from OBS Dock" : "Add to OBS Dock"}
                        >
                          <Star size={16} fill={isFav ? "#fbbf24" : "none"} />
                        </button>}

                        <LazyPreviewFrame
                          className="bg-card__iframe"
                          cacheKey={ticker.id}
                          buildHtml={() =>
                            (ticker.source === "dock" || ticker.source === "remote") &&
                            ticker.dockTheme
                              ? buildDockTickerPreviewHtml(ticker.dockTheme, [
                                  "Welcome to church! We're glad you're here.",
                                  "Sunday Service: 10:00 AM",
                                  "Follow us online @MakeChurchEazy",
                                ])
                              : ticker.permanentTheme
                              ? buildTickerPreviewHtml(ticker.permanentTheme)
                              : ""
                          }
                          sandbox="allow-same-origin allow-scripts"
                          title={ticker.name}
                        />
                      </div>

                      <div className="bg-card__body">
                        <div className="bg-card__header-row">
                          <div className="bg-card__title-area">
                            <h4 className="bg-card__name">{ticker.name}</h4>
                            <div className="bg-card__meta-tags">
                              <span className="bg-card__tag bg-card__tag--category">
                                Scrolling Ticker
                              </span>
                              {ticker.permanentTheme && (
                                <span className="bg-card__tag">
                                  {ticker.permanentTheme.speed} Speed
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {!tickerPaused && <div className="bg-card__actions">
                          <button
                            className="bg-card__btn-preview"
                            onClick={() => setPreviewTicker(ticker)}
                          >
                            <Eye size={14} />
                            <span>Preview</span>
                          </button>

                          <button
                            className={`bg-card__btn-customize ${
                              isFav ? "bg-btn--ghost" : ""
                            }`}
                            onClick={() => handleToggleTickerObs(ticker.id)}
                          >
                            <Tv size={14} />
                            <span>{isFav ? "Remove from OBS" : "Add to OBS"}</span>
                          </button>
                        </div>}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </main>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
           MODAL 1: HOW IT WORKS
           ══════════════════════════════════════════════════════════════════════ */}
        {showHowModal && (
          <div className="bg-modal-overlay" onClick={() => setShowHowModal(false)}>
            <div className="bg-how-modal" onClick={(e) => e.stopPropagation()}>
              <div className="bg-modal-header">
                <h3 className="bg-modal-header__title">How Broadcast Graphics Works</h3>
                <button
                  className="bg-modal-close-btn"
                  onClick={() => setShowHowModal(false)}
                >
                  <X size={18} />
                </button>
              </div>

              <div className="bg-how-modal__body">
                <div className="bg-how-step">
                  <div className="bg-how-step__number">1</div>
                  <div className="bg-how-step__content">
                    <h4>Choose a ready-made template or create a graphic</h4>
                    <p>
                      Browse speaker lower thirds, welcome graphics, bank giving info, and
                      announcements designed specifically for church livestreams.
                    </p>
                  </div>
                </div>

                <div className="bg-how-step">
                  <div className="bg-how-step__number">2</div>
                  <div className="bg-how-step__content">
                    <h4>Customize the text, colors, and layout</h4>
                    <p>
                      Enter your minister names, title, bank account details, and colors with a
                      live 16:9 preview studio.
                    </p>
                  </div>
                </div>

                <div className="bg-how-step">
                  <div className="bg-how-step__number">3</div>
                  <div className="bg-how-step__content">
                    <h4>Save and add to your OBS Dock</h4>
                    <p>
                      Click "Save & Add to OBS". The graphic is instantly stored and synced
                      directly to your Dock controls.
                    </p>
                  </div>
                </div>

                <div className="bg-how-step">
                  <div className="bg-how-step__number">4</div>
                  <div className="bg-how-step__content">
                    <h4>Show it from the OBS Dock</h4>
                    <p>
                      In OBS, open the <strong>Make Church Eazy Dock</strong> →{" "}
                      <strong>Ministry</strong> tab → choose <strong>Lower Thirds</strong> or{" "}
                      <strong>Ticker</strong>. Refresh the Dock (right-click it → <strong>Refresh</strong>)
                      so your new graphic appears, select it, then click <strong>Send</strong> to
                      show it live with a smooth animated entrance.
                    </p>
                  </div>
                </div>

                <div className="bg-how-callout">
                  ✨ <strong>Zero OBS Scene Setup Required:</strong> Make Church Eazy handles all
                  the rendering automatically. You don't have to manually configure OBS scenes or
                  add multiple browser sources.
                </div>
              </div>

              <div className="bg-modal-footer">
                <button
                  className="bg-btn bg-btn--primary"
                  onClick={() => setShowHowModal(false)}
                >
                  Got it
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
           MODAL 2: CREATE GRAPHIC (TEMPLATE PICKER)
           ══════════════════════════════════════════════════════════════════════ */}
        {showCreateModal && (
          <div className="bg-modal-overlay" onClick={() => setShowCreateModal(false)}>
            <div
              className="bg-how-modal"
              style={{ maxWidth: 840 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-modal-header">
                <div>
                  <h3 className="bg-modal-header__title">Choose a Template to Start</h3>
                  <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                    Select a broadcast template to customize for your church
                  </span>
                </div>
                <button
                  className="bg-modal-close-btn"
                  onClick={() => setShowCreateModal(false)}
                >
                  <X size={18} />
                </button>
              </div>

              <div className="bg-how-modal__body">
                <div className="bg-template-picker-grid">
                  {allTemplates.slice(0, 12).map((tpl) => (
                    <div
                      key={tpl.id}
                      className="bg-template-picker-card"
                      onClick={() => {
                        setShowCreateModal(false);
                        handleOpenCustomize(tpl);
                      }}
                    >
                      <div className="bg-template-picker-card__thumb">
                        <LazyPreviewFrame
                          cacheKey={tpl.id}
                          buildHtml={() => buildThemePreviewHtml(tpl, { hover: true })}
                          sandbox={obsPreviewSandbox(tpl)}
                          title={tpl.name}
                        />
                      </div>
                      <span className="bg-template-picker-card__name">{tpl.name}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-modal-footer">
                <button
                  className="bg-btn bg-btn--secondary"
                  onClick={() => {
                    setShowCreateModal(false);
                    if (allTemplates[0]) handleOpenCustomize(allTemplates[0]);
                  }}
                >
                  Start with Default Lower Third
                </button>
                <button
                  className="bg-btn bg-btn--primary"
                  onClick={() => {
                    setShowCreateModal(false);
                    setActiveTab("library");
                  }}
                >
                  Browse All {allTemplates.length} Templates
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
           MODAL 3: FULL PREVIEW (CANVAS & CONTROLS)
           ══════════════════════════════════════════════════════════════════════ */}
        {/* ══════════════════════════════════════════════════════════════════════
           MODAL 4: STUDIO EDITOR (CUSTOMIZE & USE)
           ══════════════════════════════════════════════════════════════════════ */}
        {editorState && (
          <ScreenModal label="Customize graphic" onClose={() => setEditorState(null)}>
            <div className="bg-editor-modal" style={{ maxHeight: "100%" }} onClick={(e) => e.stopPropagation()}>
              <div className="bg-modal-header">
                <div>
                  <h3 className="bg-modal-header__title">
                    {editorState.savedId ? "Edit Graphic" : "Customize & Use Graphic"}
                  </h3>
                  <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                    Base Template: {editorState.template.name}
                  </span>
                </div>
                <button
                  className="bg-modal-close-btn"
                  onClick={() => setEditorState(null)}
                >
                  <X size={18} />
                </button>
              </div>

              <div className="bg-editor-modal__body">
                {/* Left: Configuration Form */}
                <div className="bg-editor-left">
                  <div className="bg-form-group">
                    <label className="bg-form-group__label">Graphic Name</label>
                    <input
                      type="text"
                      className="bg-form-group__input"
                      value={editorState.name}
                      onChange={(e) =>
                        setEditorState({ ...editorState, name: e.target.value })
                      }
                      placeholder="e.g. Sunday Speaker Intro"
                    />
                  </div>

                  {/* Category comes from the template (shown on the card), so it is not edited here. */}

                  {/* Content Variables Form */}
                  <div className="bg-editor-section-title">
                    <Edit2 size={14} />
                    <span>Content & Text</span>
                    <span className="bg-editor-section-actions">
                      <button
                        type="button"
                        className="bg-field-reset"
                        onClick={handleUseChurchInfo}
                        title="Fill in your church name and pastor from your church profile"
                      >
                        Use my church info
                      </button>
                      <button
                        type="button"
                        className="bg-field-reset"
                        onClick={handleResetAllText}
                        title="Put all the original text back"
                      >
                        Reset all
                      </button>
                    </span>
                  </div>

                  {hasGivingBankFields((editorState.template.variables ?? []).map((v) => String((v as Record<string, unknown>).key))) && (
                    <GivingBankFields
                      variant="app"
                      values={editorState.variables}
                      defaults={Object.fromEntries(
                        (editorState.template.variables ?? []).map((v) => [String((v as Record<string, unknown>).key), String((v as Record<string, unknown>).defaultValue ?? "")]),
                      )}
                      onChange={(patch) =>
                        setEditorState((prev) => (prev ? { ...prev, variables: { ...prev.variables, ...patch } } : prev))
                      }
                    />
                  )}

                  {editorState.template.variables &&
                    editorState.template.variables.map((v) => {
                      const varDef = v as Record<string, unknown>;
                      const key = String(varDef.key);
                      // The giving board's bank, number and logo fields are the bank rows above.
                      if (isGivingBankFieldKey(key) && hasGivingBankFields((editorState.template.variables ?? []).map((x) => String((x as Record<string, unknown>).key)))) return null;
                      const label = String(varDef.label || key);
                      const type = String(varDef.type || "text");
                      const currentVal = editorState.variables[key] ?? "";
                      const options = Array.isArray(varDef.options)
                        ? (varDef.options as { label: string; value: string }[])
                        : [];
                      const setVar = (value: string) =>
                        setEditorState((prev) =>
                          prev ? { ...prev, variables: { ...prev.variables, [key]: value } } : prev,
                        );

                      // Look settings (speed, size, hold, loop) live in the Dock; colours have their own section.
                      if (key.startsWith("kx") || type === "color") return null;

                      if (type === "select" && options.length) {
                        return (
                          <div key={key} className="bg-form-group">
                            <label className="bg-form-group__label">{label}</label>
                            <select
                              className="bg-form-group__select"
                              value={currentVal}
                              onChange={(e) => setVar(e.target.value)}
                            >
                              {options.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </div>
                        );
                      }

                      if (type === "list" && options.length) {
                        // Multi-pick (e.g. social icons): stored as a comma list, in the order picked.
                        const picked = currentVal.split(/[\s,]+/).filter(Boolean);
                        const toggle = (value: string) => {
                          const next = picked.includes(value)
                            ? picked.filter((p) => p !== value)
                            : [...picked, value];
                          setVar(next.join(","));
                        };
                        return (
                          <div key={key} className="bg-form-group">
                            <label className="bg-form-group__label">{label.replace(/\s*\(comma list\)/i, "")}</label>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {options.map((o) => {
                                const on = picked.includes(o.value);
                                return (
                                  <button
                                    key={o.value}
                                    type="button"
                                    onClick={() => toggle(o.value)}
                                    style={{
                                      padding: "5px 10px",
                                      borderRadius: 999,
                                      fontSize: 12,
                                      fontWeight: 600,
                                      cursor: "pointer",
                                      border: `1px solid ${on ? "var(--primary)" : "var(--border)"}`,
                                      background: on ? "var(--primary-soft)" : "transparent",
                                      color: on ? "var(--text-primary)" : "var(--text-secondary)",
                                    }}
                                  >
                                    {on ? `${picked.indexOf(o.value) + 1}. ` : ""}
                                    {o.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      }

                      if (type === "image") {
                        return (
                          <div key={key} className="bg-form-group">
                            <label className="bg-form-group__label">{label}</label>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <div
                                style={{
                                  width: 96,
                                  height: 48,
                                  borderRadius: 6,
                                  border: "1px solid var(--border)",
                                  display: "grid",
                                  placeItems: "center",
                                  overflow: "hidden",
                                  fontSize: 11,
                                  color: "var(--text-secondary)",
                                  background: "repeating-conic-gradient(#232733 0 25%, #191c25 0 50%) 0 0/12px 12px",
                                }}
                              >
                                {currentVal ? (
                                  <img src={currentVal} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                                ) : (
                                  "Church logo"
                                )}
                              </div>
                              <label className="bg-btn bg-btn--ghost" style={{ cursor: "pointer" }}>
                                Upload
                                <input
                                  type="file"
                                  accept="image/*"
                                  hidden
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    e.target.value = "";
                                    if (file) void readImageForGraphic(file).then(setVar).catch(() => showToast("Could not read that image", "error"));
                                  }}
                                />
                              </label>
                              {currentVal && (
                                <button type="button" className="bg-btn bg-btn--ghost" onClick={() => setVar("")}>
                                  Remove
                                </button>
                              )}
                            </div>
                            <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                              Leave empty to use your church logo from Settings (or the placeholder text).
                            </span>
                          </div>
                        );
                      }

                      const fieldGuide = describeField({ key, label, type });
                      const defaultVal =
                        churchAwareDefaults(editorState.template as unknown as ChurchThemeLike, getMinistryData())[key] ??
                        String(varDef.defaultValue ?? "");
                      return (
                        <div key={key} className="bg-form-group">
                          <div className="bg-field-head">
                            <label className="bg-form-group__label" htmlFor={`bg-field-${key}`}>
                              {fieldGuide.heading}
                            </label>
                            {currentVal !== defaultVal && (
                              <button
                                type="button"
                                className="bg-field-reset"
                                onClick={() => setVar(defaultVal)}
                                title="Put the original text back"
                              >
                                <RotateCcw size={11} />
                                <span>Reset</span>
                              </button>
                            )}
                          </div>
                          {fieldGuide.hint && <span className="bg-form-group__hint">{fieldGuide.hint}</span>}
                          {(varDef.multiline === true
                            || looksLikeLongTextField(key, String(varDef.label || ""))
                            || String(currentVal || "").length > 60) ? (
                            <textarea
                              id={`bg-field-${key}`}
                              className="bg-form-group__input"
                              rows={6}
                              style={{ resize: "vertical", fontFamily: "inherit", lineHeight: 1.45, minHeight: 130, height: "auto" }}
                              value={currentVal}
                              placeholder={String(varDef.placeholder || "")}
                              onChange={(e) => setVar(e.target.value)}
                            />
                          ) : (
                            <input
                              id={`bg-field-${key}`}
                              type="text"
                              className="bg-form-group__input"
                              value={currentVal}
                              placeholder={String(varDef.placeholder || "")}
                              onChange={(e) => setVar(e.target.value)}
                            />
                          )}
                          <TextStyleControls
                            value={editorState.variables[textStyleKey(key)]}
                            capability={textStyleCapabilityFor(editorState.template)}
                            onChange={(next) =>
                              setEditorState((prev) =>
                                prev ? { ...prev, variables: { ...prev.variables, [textStyleKey(key)]: next } } : prev,
                              )
                            }
                          />
                        </div>
                      );
                    })}

                  {/* Design & Typography */}
                  <div className="bg-editor-section-title">
                    <Palette size={14} />
                    <span>Design & Colors</span>
                  </div>

                  {(editorState.template.variables || [])
                    .map((v) => v as Record<string, unknown>)
                    .filter((v) => v.type === "color" && v.key !== "kxColor")
                    .map((v) => {
                      const key = String(v.key);
                      const value = editorState.variables[key] || String(v.defaultValue || "#000000");
                      const setVar = (val: string) =>
                        setEditorState((prev) =>
                          prev ? { ...prev, variables: { ...prev.variables, [key]: val } } : prev,
                        );
                      return (
                        <div key={key} className="bg-form-group">
                          <label className="bg-form-group__label">{String(v.label || key)}</label>
                          <div className="bg-color-picker-row">
                            <input
                              type="color"
                              className="bg-color-input"
                              value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"}
                              onChange={(e) => setVar(e.target.value)}
                            />
                            <input
                              type="text"
                              className="bg-form-group__input"
                              style={{ width: 120 }}
                              value={value}
                              onChange={(e) => setVar(e.target.value)}
                            />
                          </div>
                        </div>
                      );
                    })}

                  {(editorState.template.variables || []).some(
                    (v) => (v as Record<string, unknown>).key === "kxColor",
                  ) && (
                  <div className="bg-form-group">
                    <label className="bg-form-group__label">Accent Color</label>
                    <div className="bg-color-picker-row">
                      <input
                        type="color"
                        className="bg-color-input"
                        value={editorState.accentColor}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEditorState({
                            ...editorState,
                            accentColor: val,
                            variables: {
                              ...editorState.variables,
                              kxColor: val,
                            },
                          });
                        }}
                      />
                      <input
                        type="text"
                        className="bg-form-group__input"
                        style={{ width: 120 }}
                        value={editorState.accentColor}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEditorState({
                            ...editorState,
                            accentColor: val,
                            variables: {
                              ...editorState.variables,
                              kxColor: val,
                            },
                          });
                        }}
                      />
                    </div>
                  </div>
                  )}

                  {/* Animation & Placement */}
                  <div className="bg-editor-section-title">
                    <Sliders size={14} />
                    <span>Position & Animation</span>
                  </div>

                  <div className="bg-form-group">
                    <label className="bg-form-group__label">Screen Position</label>
                    <select
                      className="bg-form-group__select"
                      value={editorState.position}
                      onChange={(e) =>
                        setEditorState({ ...editorState, position: e.target.value })
                      }
                    >
                      <option value="bottom-left">Bottom Left</option>
                      <option value="bottom-center">Bottom Center</option>
                      <option value="bottom-right">Bottom Right</option>
                      <option value="top-left">Top Left</option>
                      <option value="top-right">Top Right</option>
                    </select>
                  </div>
                </div>

                {/* Right: Live 16:9 Canvas Preview */}
                <div className="bg-editor-right">
                  <div className="bg-editor-preview-stage">
                    <iframe
                      id="bg-editor-live-iframe"
                      srcDoc={buildThemePreviewHtml(editorState.template, {
                        hover: false,
                        customVariables: editorState.variables,
                        backdrop:
                          editorState.backgroundColor === "transparent"
                            ? undefined
                            : editorState.backgroundColor,
                      })}
                      sandbox={obsPreviewSandbox(editorState.template)}
                      title="Live Graphic Studio Preview"
                    />
                  </div>

                  <div className="bg-editor-preview-controls">
                    <button
                      className="bg-btn bg-btn--secondary"
                      onClick={() => {
                        const iframe = document.getElementById(
                          "bg-editor-live-iframe",
                        ) as HTMLIFrameElement;
                        iframe?.contentWindow?.postMessage({ type: "mce-kx-in" }, "*");
                      }}
                    >
                      <Play size={14} />
                      <span>Animate In</span>
                    </button>

                    <button
                      className="bg-btn bg-btn--secondary"
                      onClick={() => {
                        const iframe = document.getElementById(
                          "bg-editor-live-iframe",
                        ) as HTMLIFrameElement;
                        iframe?.contentWindow?.postMessage({ type: "mce-kx-out" }, "*");
                      }}
                    >
                      <RotateCcw size={14} />
                      <span>Animate Out</span>
                    </button>
                  </div>

                  {/* How to show this graphic live once it is in OBS. */}
                  <div className="app-banner bg-obs-howto" role="note">
                    <div className="app-banner__content">
                      <Info size={16} />
                      <div className="bg-obs-howto__text">
                        <strong className="bg-obs-howto__title">How to use it in OBS</strong>
                        <ol className="bg-obs-howto__steps">
                          <li>Click <strong>Save &amp; Add to OBS</strong> below.</li>
                          <li>In OBS, open the <strong>Make Church Eazy</strong> Dock and go to the <strong>Ministry</strong> tab, then <strong>Lower Thirds</strong>.</li>
                          <li>Find <strong>{editorState.name.trim() || editorState.template.name}</strong> in the list (type its name to search). If it isn't there yet, right-click the Dock and choose <strong>Refresh</strong>.</li>
                          <li>Select it, then click <strong>Send</strong> to show it live. Click <strong>Blank</strong> to take it off, or let it leave by itself after its hold time.</li>
                        </ol>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Editor Footer */}
              <div className="bg-modal-footer">
                <button
                  className="bg-btn bg-btn--ghost"
                  onClick={() => setEditorState(null)}
                >
                  Cancel
                </button>

                <button
                  className="bg-btn bg-btn--secondary"
                  onClick={() => handleSaveEditor(false)}
                >
                  Save to My Graphics
                </button>

                <button
                  className="bg-btn bg-btn--primary"
                  onClick={() => handleSaveEditor(true)}
                >
                  <Tv size={16} />
                  <span>Save & Add to OBS</span>
                </button>
              </div>
            </div>
          </ScreenModal>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
           MODAL 5: TICKER PREVIEW
           ══════════════════════════════════════════════════════════════════════ */}
        {previewTicker && (
          <div className="bg-modal-overlay" onClick={() => setPreviewTicker(null)}>
            <div
              className="bg-how-modal"
              style={{ maxWidth: 880 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-modal-header">
                <div>
                  <h3 className="bg-modal-header__title">{previewTicker.name}</h3>
                  <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                    Marquee Ticker Preview
                  </span>
                </div>
                <button
                  className="bg-modal-close-btn"
                  onClick={() => setPreviewTicker(null)}
                >
                  <X size={18} />
                </button>
              </div>

              <div style={{ padding: 24, background: "#070d18" }}>
                <div
                  style={{
                    height: 120,
                    width: "100%",
                    borderRadius: 8,
                    overflow: "hidden",
                    border: "1px solid #293650",
                  }}
                >
                  <iframe
                    style={{ width: "100%", height: "100%", border: "none" }}
                    srcDoc={
                      (previewTicker.source === "dock" || previewTicker.source === "remote") &&
                      previewTicker.dockTheme
                        ? buildDockTickerPreviewHtml(previewTicker.dockTheme, [
                            "Welcome to church! We're glad you're here.",
                            "Sunday Service: 10:00 AM",
                            "Follow us online @MakeChurchEazy",
                          ])
                        : previewTicker.permanentTheme
                        ? buildTickerPreviewHtml(previewTicker.permanentTheme)
                        : ""
                    }
                    sandbox="allow-same-origin allow-scripts"
                    title={previewTicker.name}
                  />
                </div>
              </div>

              <div className="bg-modal-footer">
                <button
                  className={`bg-btn ${
                    tickerFavorites.has(previewTicker.id)
                      ? "bg-btn--ghost"
                      : "bg-btn--primary"
                  }`}
                  onClick={() => {
                    handleToggleTickerObs(previewTicker.id);
                    setPreviewTicker(null);
                  }}
                >
                  <Tv size={16} />
                  <span>
                    {tickerFavorites.has(previewTicker.id)
                      ? "Remove from OBS"
                      : "Add to OBS"}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
           TOAST NOTIFICATIONS
           ══════════════════════════════════════════════════════════════════════ */}
        {toast && (
          <div
            style={{
              position: "fixed",
              bottom: 24,
              right: 24,
              zIndex: 10001,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 16px",
              borderRadius: 8,
              background: "var(--surface)",
              border: toast.type === "success" ? "1px solid var(--success)" : "1px solid var(--error)",
              color: "var(--text-primary)",
              fontSize: 13,
              fontWeight: 500,
              boxShadow: "0 4px 20px rgba(0,0,0,0.45)",
            }}
          >
            <Check size={16} color={toast.type === "success" ? "var(--success)" : "var(--error)"} />
            <span>{toast.message}</span>
          </div>
        )}
      </div>
    </div>
  );
}
