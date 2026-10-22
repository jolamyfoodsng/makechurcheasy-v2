"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import {
  Search,
  Shield,
  Crown,
  ArrowUpDown,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Eye,
  CreditCard,
  X,
  StopCircle,
  UserX,
  UserCheck,
  Trash2,
  RotateCcw,
  LogOut,
  ShieldOff,
  Play,
  Clock,
  Monitor as MonitorIcon,
  MoreHorizontal,
  Mail,
  Activity,
  Globe,
  Check,
  ChevronDown,
  RefreshCw,
  Download,
  Phone,
  FileSpreadsheet,
  Filter,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getPlanConfig, type PlanConfig } from "@/lib/planConfigService";
import type { ActivityScoreBreakdown } from "@/lib/userActivityScore";
import { countRetention, formatDaysSinceUse, RETENTION_ORDER, RETENTION_STYLE, type RetentionInfo, type RetentionStatus } from "@/lib/userRetention";
import {
  formatPlanCredits,
  getAdminManagedPlanAmount,
  getAdminManagedPlanCredits,
} from "@/lib/adminManagedSubscriptionForm";

type OsKey = "windows" | "macos" | "linux" | "unknown";
const OS_LABELS: Record<OsKey | "none", string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  unknown: "Unknown OS",
  none: "No desktop app",
};

function normalizeOs(value?: string | null): OsKey {
  const v = String(value || "").toLowerCase();
  if (v.startsWith("win")) return "windows";
  if (v.startsWith("mac") || v === "darwin" || v === "osx") return "macos";
  if (v.startsWith("linux")) return "linux";
  return "unknown";
}

/** Every OS the user has the desktop app on (empty = no desktop app seen). */
function userOsList(u: { appPlatform?: string; appPlatforms?: string[]; appVersion?: string; appVersions?: string[]; deviceCount?: number }): OsKey[] {
  const raw = (u.appPlatforms && u.appPlatforms.length > 0) ? u.appPlatforms : (u.appPlatform ? [u.appPlatform] : []);
  const list = Array.from(new Set(raw.map(normalizeOs)));
  if (list.length === 0 && ((u.deviceCount ?? 0) > 0 || u.appVersion || (u.appVersions?.length ?? 0) > 0)) return ["unknown"];
  return list;
}

function userVersionList(u: { appVersion?: string; appVersions?: string[] }): string[] {
  const raw = (u.appVersions && u.appVersions.length > 0) ? u.appVersions : (u.appVersion ? [u.appVersion] : []);
  return Array.from(new Set(raw.map((v) => String(v).trim().replace(/^v/i, "")).filter(Boolean)));
}

/** First app version that contains the MacBook fix; older versions get the update campaign. */
const UPDATE_CAMPAIGN_FIX_VERSION = "4.2.1";

function compareVersionsDesc(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

interface AdminUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  churchName: string;
  churchRole?: string;
  country?: string;
  deviceId?: string;
  deviceIds?: string[];
  deviceCount?: number;
  appVersion?: string;
  appPlatform?: string;
  appVersions?: string[];
  appPlatforms?: string[];
  role: string;
  accountStatus?: "active" | "suspended" | "deleted";
  credits: number;
  plan: string;
  billingCycle?: string | null;
  subscriptionStatus?: string | null;
  createdAt: string | null;
  lastLogin: string | null;
  /** Any sign of life: app launch, sign-in, update check, device ping. */
  lastOpened: string | null;
  /** Last real use: presenting, searching, importing, uploading or voice. */
  lastUsed: string | null;
  /** Real use in the last 30 days. */
  isActive: boolean;
  trial?: { active: boolean; expiresAt?: string } | null;
  ambassador?: {
    active: boolean;
    grantedAt?: string;
    expiresAt?: string;
    creditsGranted?: number;
    previousPlan?: string;
  } | null;
  adminTemporaryPlan?: {
    active: boolean;
    plan?: string;
    previousPlan?: string;
    returnPlan?: "free";
    grantedAt?: string;
    expiresAt?: string;
    durationDays?: number;
    reason?: string;
  } | null;
  adminManagedSubscription?: {
    active: boolean;
    plan?: string;
    billingCycle?: string;
    expiresAt?: string;
    amountCollected?: number;
    currency?: string;
    paymentReference?: string;
  } | null;
  subscriptionExpiresAt?: string | null;
  scheduledDowngradeAt?: string | null;
  reactivationOffer?: {
    status: string;
    offeredAt: string | null;
    grantedAt: string | null;
    expiresAt: string | null;
  } | null;
  zohoLists?: string[] | null;
  activationMilestones?: {
    devicePaired?: boolean;
    obsConnected?: boolean;
    firstPresentation?: boolean;
    firstPresentationScreenshotUrl?: string;
  } | null;
  usage?: {
    bibleSearches?: number;
    songsCreated?: number;
    mediaUploaded?: number;
    transcriptCount?: number;
    aiHoursUsed?: number;
  } | null;
  /** Is the user still with us: worked out from the last real use of the product (not just opening it). */
  retention?: RetentionInfo | null;
  activityScore?: {
    score: number;
    grade: ActivityScoreBreakdown["grade"];
    color: string;
    badgeBg: string;
    barColor: string;
    daily?: { score: number; grade: string; color: string; badgeBg: string };
    weekly?: { score: number; grade: string; color: string; badgeBg: string };
    monthly?: { score: number; grade: string; color: string; badgeBg: string };
  };
}

function getSubscriptionExpiringInfo(user: AdminUser): {
  isExpiringSoon: boolean;
  isExpired: boolean;
  daysLeft: number;
  text: string;
  badgeClass: string;
} | null {
  const expiresAt =
    user.subscriptionExpiresAt ||
    (user.adminManagedSubscription?.active ? user.adminManagedSubscription.expiresAt : null) ||
    (user.adminTemporaryPlan?.active ? user.adminTemporaryPlan.expiresAt : null) ||
    (user.plan === "free" && user.trial?.active ? user.trial.expiresAt : null) ||
    user.scheduledDowngradeAt;

  if (!expiresAt) return null;

  const date = new Date(expiresAt);
  const time = date.getTime();
  if (Number.isNaN(time) || time <= 0) return null;

  const now = Date.now();
  const diffMs = time - now;
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  const formattedDate = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  if (diffDays < 0) {
    const absDays = Math.abs(diffDays);
    return {
      isExpiringSoon: false,
      isExpired: true,
      daysLeft: diffDays,
      text: `Expired ${absDays === 1 ? "yesterday" : `${absDays}d ago`} (${formattedDate})`,
      badgeClass: "text-red-400 bg-red-950/40 border-red-800/50",
    };
  }

  if (diffDays === 0) {
    return {
      isExpiringSoon: true,
      isExpired: false,
      daysLeft: 0,
      text: `Expires today (${formattedDate})`,
      badgeClass: "text-amber-300 bg-amber-950/60 border-amber-700/60 font-semibold animate-pulse",
    };
  }

  if (diffDays === 1) {
    return {
      isExpiringSoon: true,
      isExpired: false,
      daysLeft: 1,
      text: `1 day left to expire (${formattedDate})`,
      badgeClass: "text-amber-300 bg-amber-950/50 border-amber-700/50 font-medium",
    };
  }

  if (diffDays <= 30) {
    return {
      isExpiringSoon: true,
      isExpired: false,
      daysLeft: diffDays,
      text: `${diffDays} days left to expire (${formattedDate})`,
      badgeClass: diffDays <= 7 ? "text-amber-300 bg-amber-950/50 border-amber-700/60 font-medium" : "text-amber-200/90 bg-amber-950/30 border-amber-800/40",
    };
  }

  const months = Math.floor(diffDays / 30);
  const remDays = diffDays % 30;
  const monthText = remDays > 0 ? `${months}m ${remDays}d left` : `${months} month${months > 1 ? "s" : ""} left`;

  return {
    isExpiringSoon: false,
    isExpired: false,
    daysLeft: diffDays,
    text: `${monthText} to expire (${formattedDate})`,
    badgeClass: "text-emerald-300 bg-emerald-950/30 border-emerald-800/40",
  };
}

type SortField = "name" | "email" | "country" | "plan" | "credits" | "createdAt" | "lastLogin" | "lastUsed" | "activityScore";
type ActivityFilter = "all" | "expiring" | "1d" | "3d" | "7d" | "14d" | "30d" | "inactive";
type SortDir = "asc" | "desc";
type AdminUserAction =
  | "suspend"
  | "unsuspend"
  | "delete"
  | "reset_credits"
  | "reset_devices"
  | "force_logout"
  | "make_admin"
  | "remove_admin";

interface ConfirmActionState {
  user: AdminUser;
  action: AdminUserAction;
  label: string;
  effects: string[];
}

function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded-2xl bg-gray-800 ${className ?? ""}`} />
  );
}

function formatLastActive(timestamp: string | null | undefined): {
  text: string;
  full: string;
  tone: "recent" | "warm" | "cool" | "muted";
} {
  if (!timestamp) return { text: "Never", full: "No recorded activity", tone: "muted" };
  const date = new Date(timestamp);
  const time = date.getTime();
  if (Number.isNaN(time) || time <= 0) return { text: "Never", full: "No recorded activity", tone: "muted" };

  const now = Date.now();
  const diffMs = Math.max(0, now - time);
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  const full = date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  if (diffSec < 60) return { text: "Just now", full, tone: "recent" };
  if (diffMin < 60) return { text: `${diffMin}m ago`, full, tone: "recent" };
  if (diffHr < 24) return { text: `${diffHr}h ago`, full, tone: "recent" };
  if (diffDays === 1) return { text: "Yesterday", full, tone: "warm" };
  if (diffDays <= 3) return { text: `${diffDays}d ago`, full, tone: "warm" };
  if (diffDays <= 7) return { text: `${diffDays}d ago`, full, tone: "cool" };
  if (diffDays <= 30) return { text: `${diffDays}d ago`, full, tone: "muted" };

  return {
    text: date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
    full,
    tone: "muted",
  };
}

const COMMON_COUNTRY_NAME_TO_CODE: Record<string, string> = {
  nigeria: "NG",
  ghana: "GH",
  kenya: "KE",
  uganda: "UG",
  "south africa": "ZA",
  ethiopia: "ET",
  rwanda: "RW",
  tanzania: "TZ",
  zambia: "ZM",
  zimbabwe: "ZW",
  namibia: "NA",
  botswana: "BW",
  malawi: "MW",
  cameroon: "CM",
  liberia: "LR",
  "sierra leone": "SL",
  kiribati: "KI",
  "united states": "US",
  usa: "US",
  "united kingdom": "GB",
  uk: "GB",
  canada: "CA",
  australia: "AU",
  india: "IN",
  philippines: "PH",
  brazil: "BR",
  germany: "DE",
  france: "FR",
  egypt: "EG",
  benin: "BJ",
  togo: "TG",
  "cote d'ivoire": "CI",
  "ivory coast": "CI",
  senegal: "SN",
  gambia: "GM",
};

function getCountryFlagEmoji(countryCode?: string | null): string {
  if (!countryCode || countryCode.trim().length !== 2) return "";
  const code = countryCode.trim().toUpperCase();
  const codePoints = [...code].map((c) => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

interface NormalizedCountry {
  code: string;
  name: string;
  flag: string;
}

function normalizeCountry(raw?: string | null): NormalizedCountry {
  if (!raw || !raw.trim()) {
    return { code: "UNKNOWN", name: "Unspecified", flag: "🌐" };
  }
  const clean = raw.trim();
  let code = "";
  if (clean.length === 2) {
    code = clean.toUpperCase();
  } else {
    const lookup = COMMON_COUNTRY_NAME_TO_CODE[clean.toLowerCase()];
    if (lookup) {
      code = lookup;
    }
  }

  if (code && code.length === 2) {
    const flag = getCountryFlagEmoji(code);
    try {
      const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
      const name = regionNames.of(code) || clean;
      return { code, name, flag };
    } catch {
      return { code, name: clean, flag };
    }
  }

  return { code: clean.toUpperCase(), name: clean, flag: "🌐" };
}

function getCountryDisplayName(countryCode?: string | null): string {
  const norm = normalizeCountry(countryCode);
  if (norm.code === "UNKNOWN") return "";
  return norm.flag ? `${norm.flag} ${norm.name}` : norm.name;
}

function formatCreatedDate(timestamp: string | null | undefined): { text: string; full: string } {
  if (!timestamp) return { text: "—", full: "Unknown" };
  const date = new Date(timestamp);
  const time = date.getTime();
  if (Number.isNaN(time) || time <= 0) return { text: "—", full: "Unknown" };

  const full = date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const now = Date.now();
  const diffMs = Math.max(0, now - time);
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffMin < 1) return { text: "Just now", full };
  if (diffMin < 60) return { text: `${diffMin}m ago`, full };
  if (diffHr < 24) return { text: `${diffHr}h ago`, full };
  if (diffDays === 1) return { text: "Yesterday", full };
  if (diffDays <= 6) return { text: `${diffDays} days ago`, full };
  if (diffDays <= 13) return { text: "Last week", full };
  if (diffDays <= 27) return { text: `${Math.floor(diffDays / 7)} weeks ago`, full };

  // If older than a few weeks / a month, show the date with the relative info
  return { text: full, full };
}


export default function AdminUsersPage() {
  const t = useTranslations();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [countryDropdownOpen, setCountryDropdownOpen] = useState(false);
  const [countrySearchQuery, setCountrySearchQuery] = useState("");
  const countryDropdownRef = useRef<HTMLDivElement>(null);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [contactFilter, setContactFilter] = useState<"all" | "has_phone" | "phone_only" | "email_only" | "both">("all");
  const [billingCycleFilter, setBillingCycleFilter] = useState<"all" | "monthly" | "yearly" | "lifetime">("all");
  const [osFilter, setOsFilter] = useState<"all" | OsKey | "none">("all");
  const [versionFilter, setVersionFilter] = useState<string>("all");
  const [retentionFilter, setRetentionFilter] = useState<RetentionStatus | "attention" | "all">("all");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);

  // Modal states
  const [showGrantCredits, setShowGrantCredits] = useState<string | null>(null);
  const [creditsAmount, setCreditsAmount] = useState("");
  const [grantingCredits, setGrantingCredits] = useState(false);

  const [showChangePlan, setShowChangePlan] = useState<string | null>(null);
  const [newPlan, setNewPlan] = useState("free");
  const [changingPlan, setChangingPlan] = useState(false);
  const [subscriptionBillingCycle, setSubscriptionBillingCycle] = useState("monthly");
  const [subscriptionAmount, setSubscriptionAmount] = useState("");
  const [subscriptionCurrency, setSubscriptionCurrency] = useState("NGN");
  const [subscriptionReference, setSubscriptionReference] = useState("");
  const [subscriptionNote, setSubscriptionNote] = useState("");
  const [notifySubscriptionUser, setNotifySubscriptionUser] = useState(true);
  const [planConfig, setPlanConfig] = useState<PlanConfig | null>(null);

  const [showTemporaryPlan, setShowTemporaryPlan] = useState<string | null>(null);
  const [temporaryPlan, setTemporaryPlan] = useState("growth");
  const [temporaryDurationDays, setTemporaryDurationDays] = useState("30");
  const [temporaryReason, setTemporaryReason] = useState("");
  const [savingTemporaryPlan, setSavingTemporaryPlan] = useState(false);
  const [showEndTemporaryPlan, setShowEndTemporaryPlan] = useState<string | null>(null);
  const [endingTemporaryPlan, setEndingTemporaryPlan] = useState(false);

  const [showAmbassador, setShowAmbassador] = useState<string | null>(null);
  const [ambassadorDuration, setAmbassadorDuration] = useState("6");
  const [ambassadorCredits, setAmbassadorCredits] = useState("");
  const [defaultAmbassadorCredits, setDefaultAmbassadorCredits] = useState<number | null>(null);
  const [ambassadorNotes, setAmbassadorNotes] = useState("");
  const [grantingAmbassador, setGrantingAmbassador] = useState(false);
  const [showRevokeAmbassador, setShowRevokeAmbassador] = useState<string | null>(null);
  const [revokingAmbassador, setRevokingAmbassador] = useState(false);

  const [showCancelTrial, setShowCancelTrial] = useState<string | null>(null);
  const [cancellingTrial, setCancellingTrial] = useState(false);
  const [showGrantTrial, setShowGrantTrial] = useState<string | null>(null);
  const [trialDuration, setTrialDuration] = useState("14");
  const [grantingTrial, setGrantingTrial] = useState(false);
  const [showExtendTrial, setShowExtendTrial] = useState<string | null>(null);
  const [extendTrialDays, setExtendTrialDays] = useState("30");
  const [extendingTrial, setExtendingTrial] = useState(false);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmActionState | null>(null);

  const [actionMsg, setActionMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [zohoSyncing, setZohoSyncing] = useState(false);

  const fetchUsers = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const res = await fetch("/api/admin/users", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
        if (isRefresh) {
          setActionMsg({ type: "success", text: "User list refreshed successfully." });
          setTimeout(() => setActionMsg(null), 3000);
        }
      } else {
        if (isRefresh) {
          setActionMsg({ type: "error", text: "Failed to refresh user list." });
          setTimeout(() => setActionMsg(null), 3000);
        }
      }
    } catch {
      if (isRefresh) {
        setActionMsg({ type: "error", text: "Failed to refresh user list." });
        setTimeout(() => setActionMsg(null), 3000);
      }
    } finally {
      if (isRefresh) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchUsers(false);

    fetch("/api/admin/platform-settings", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data) => {
        const credits = data?.ambassador?.creditsPerAmbassador;
        if (typeof credits === "number" && credits > 0) {
          setDefaultAmbassadorCredits(credits);
        }
        const configuredTrialDays = Number(data?.trial?.defaultDurationDays);
        if (Number.isInteger(configuredTrialDays) && configuredTrialDays > 0) {
          setTrialDuration(String(configuredTrialDays));
        }
      })
      .catch(() => { });

    fetch("/api/admin/plan-config", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data) => setPlanConfig(data))
      .catch(() => {
        getPlanConfig()
          .then((data) => setPlanConfig(data))
          .catch(() => { });
      });
  }, []);

  useEffect(() => {
    if (!showChangePlan) return;
    setSubscriptionAmount(
      getAdminManagedPlanAmount(
        planConfig,
        newPlan,
        subscriptionBillingCycle,
        subscriptionCurrency,
      ),
    );
  }, [newPlan, planConfig, showChangePlan, subscriptionBillingCycle, subscriptionCurrency]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (countryDropdownRef.current && !countryDropdownRef.current.contains(e.target as Node)) {
        setCountryDropdownOpen(false);
      }
    }
    if (countryDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [countryDropdownOpen]);

  const countryOptions = useMemo(() => {
    const map = new Map<string, { code: string; name: string; flag: string; count: number }>();

    for (const u of users) {
      const norm = normalizeCountry(u.country);
      const existing = map.get(norm.code);
      if (existing) {
        existing.count++;
      } else {
        map.set(norm.code, {
          code: norm.code,
          name: norm.name,
          flag: norm.flag,
          count: 1,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      if (a.code === "UNKNOWN") return 1;
      if (b.code === "UNKNOWN") return -1;
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });
  }, [users]);

  const displayedCountryOptions = useMemo(() => {
    if (!countrySearchQuery.trim()) return countryOptions;
    const q = countrySearchQuery.trim().toLowerCase();
    return countryOptions.filter(
      (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
    );
  }, [countryOptions, countrySearchQuery]);

  function toggleCountry(code: string) {
    setSelectedCountries((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  }

  const activityCounts = useMemo(() => {
    const counts = {
      all: users.length,
      expiring: 0,
      "1d": 0,
      "3d": 0,
      "7d": 0,
      "14d": 0,
      "30d": 0,
      inactive: 0,
    };
    const now = Date.now();
    for (const u of users) {
      const expInfo = getSubscriptionExpiringInfo(u);
      if (expInfo && !expInfo.isExpired && expInfo.daysLeft <= 30) {
        counts.expiring++;
      }

      const ts = u.lastUsed;
      const time = ts ? new Date(ts).getTime() : NaN;
      if (Number.isFinite(time) && time > 0) {
        const diffDays = (now - time) / (24 * 60 * 60 * 1000);
        if (diffDays <= 1) counts["1d"]++;
        if (diffDays <= 3) counts["3d"]++;
        if (diffDays <= 7) counts["7d"]++;
        if (diffDays <= 14) counts["14d"]++;
        if (diffDays <= 30) counts["30d"]++;
        else counts.inactive++;
      } else {
        counts.inactive++;
      }
    }
    return counts;
  }, [users]);

  const retentionCounts = useMemo(() => countRetention(users), [users]);

  // Counts for the OS and app-version dropdowns.
  const osCounts = useMemo(() => {
    const counts: Record<OsKey | "none", number> = { windows: 0, macos: 0, linux: 0, unknown: 0, none: 0 };
    for (const u of users) {
      const list = userOsList(u);
      if (list.length === 0) counts.none += 1;
      for (const os of list) counts[os] += 1;
    }
    return counts;
  }, [users]);

  const versionOptions = useMemo(() => {
    const counts = new Map<string, number>();
    let none = 0;
    for (const u of users) {
      const list = userVersionList(u);
      if (list.length === 0) none += 1;
      for (const v of list) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const versions = Array.from(counts.entries())
      .sort((a, b) => compareVersionsDesc(a[0], b[0]))
      .map(([version, count]) => ({ version, count }));
    return { versions, none };
  }, [users]);

  const filtered = useMemo(() => {
    let result = users;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          (u.phone || "").toLowerCase().includes(q) ||
          u.churchName.toLowerCase().includes(q) ||
          (u.churchRole || "").toLowerCase().includes(q) ||
          (u.country || "").toLowerCase().includes(q) ||
          (u.plan || "").toLowerCase().includes(q) ||
          (u.billingCycle || "").toLowerCase().includes(q) ||
          (u.deviceId || "").toLowerCase().includes(q) ||
          (u.deviceIds || []).some((deviceId) => deviceId.toLowerCase().includes(q))
      );
    }

    if (selectedCountries.length > 0) {
      result = result.filter((u) => {
        const norm = normalizeCountry(u.country);
        return selectedCountries.includes(norm.code);
      });
    }

    // Contact info filter (e.g. phone only, email only, has phone, both)
    if (contactFilter !== "all") {
      result = result.filter((u) => {
        const hasPhone = Boolean(u.phone && u.phone.trim().length >= 4);
        const hasRealEmail = Boolean(
          u.email &&
          u.email.includes("@") &&
          !u.email.endsWith("@placeholder.makechurcheazy.com") &&
          !u.email.endsWith("@phone.makechurcheazy.com") &&
          !u.email.endsWith("@placeholder.local")
        );

        if (contactFilter === "has_phone") return hasPhone;
        if (contactFilter === "phone_only") return hasPhone && !hasRealEmail;
        if (contactFilter === "email_only") return hasRealEmail && !hasPhone;
        if (contactFilter === "both") return hasPhone && hasRealEmail;
        return true;
      });
    }

    // Desktop OS filter (any of the user's devices)
    if (osFilter !== "all") {
      result = result.filter((u) => {
        const list = userOsList(u);
        return osFilter === "none" ? list.length === 0 : list.includes(osFilter);
      });
    }

    // Desktop app version filter (any of the user's devices)
    if (versionFilter !== "all") {
      result = result.filter((u) => {
        const list = userVersionList(u);
        if (versionFilter === "__none") return list.length === 0;
        if (versionFilter === "__before_fix") {
          // Highest version on any of the user's computers is below the MacBook fix (4.2.1).
          if (list.length === 0) return false;
          const best = [...list].sort(compareVersionsDesc)[0];
          return compareVersionsDesc(best, UPDATE_CAMPAIGN_FIX_VERSION) > 0;
        }
        if (versionFilter === "__outdated") {
          const latest = versionOptions.versions[0]?.version;
          return Boolean(latest) && list.length > 0 && !list.includes(latest!);
        }
        return list.includes(versionFilter);
      });
    }

    // "Still with us" filter: by the last time they really used the product.
    if (retentionFilter !== "all") {
      result = result.filter((u) => (retentionFilter === "attention"
        ? Boolean(u.retention?.needsAttention)
        : u.retention?.status === retentionFilter));
    }

    // Billing cycle filter (e.g. monthly, yearly, lifetime)
    if (billingCycleFilter !== "all") {
      result = result.filter((u) => {
        const cycle = (
          u.billingCycle ||
          u.adminManagedSubscription?.billingCycle ||
          (u.plan !== "free" ? "monthly" : "")
        ).toLowerCase();

        if (billingCycleFilter === "monthly") return cycle === "monthly";
        if (billingCycleFilter === "yearly") return cycle === "yearly";
        if (billingCycleFilter === "lifetime") return cycle === "lifetime" || cycle === "one_time";
        return true;
      });
    }

    if (filter === "active") result = result.filter((u) => u.isActive);
    else if (filter === "inactive") result = result.filter((u) => !u.isActive);
    else if (filter === "paid") result = result.filter((u) => u.plan !== "free");
    else if (filter === "free") result = result.filter((u) => u.plan === "free");
    else if (filter === "trial") result = result.filter((u) => u.plan === "free" && u.trial?.active);
    else if (filter === "expiring") {
      result = result.filter((u) => {
        const exp = getSubscriptionExpiringInfo(u);
        return Boolean(exp && !exp.isExpired && exp.daysLeft <= 30);
      });
    }
    else if (filter === "expiring_7d") {
      result = result.filter((u) => {
        const exp = getSubscriptionExpiringInfo(u);
        return Boolean(exp && !exp.isExpired && exp.daysLeft <= 7);
      });
    }
    else if (filter === "ambassador") result = result.filter((u) => u.ambassador?.active);
    else if (filter === "temporary") result = result.filter((u) => u.adminTemporaryPlan?.active);
    else if (filter === "admin") result = result.filter((u) => u.role === "admin");
    else if (filter === "suspended") result = result.filter((u) => u.accountStatus === "suspended");

    // Activity window filter
    if (activityFilter !== "all") {
      const now = Date.now();
      result = result.filter((u) => {
        if (activityFilter === "expiring") {
          const exp = getSubscriptionExpiringInfo(u);
          return Boolean(exp && !exp.isExpired && exp.daysLeft <= 30);
        }

        const ts = u.lastUsed;
        const time = ts ? new Date(ts).getTime() : NaN;
        const hasTime = Number.isFinite(time) && time > 0;
        const diffDays = hasTime ? (now - time) / (24 * 60 * 60 * 1000) : Infinity;

        if (activityFilter === "1d") return diffDays <= 1;
        if (activityFilter === "3d") return diffDays <= 3;
        if (activityFilter === "7d") return diffDays <= 7;
        if (activityFilter === "14d") return diffDays <= 14;
        if (activityFilter === "30d") return diffDays <= 30;
        if (activityFilter === "inactive") return !hasTime || diffDays > 30;
        return true;
      });
    }

    result.sort((a, b) => {
      let av: string | number = "";
      let bv: string | number = "";
      if (sortField === "name") { av = a.name; bv = b.name; }
      else if (sortField === "email") { av = a.email; bv = b.email; }
      else if (sortField === "country") {
        av = normalizeCountry(a.country).name;
        bv = normalizeCountry(b.country).name;
      }
      else if (sortField === "plan") { av = a.plan; bv = b.plan; }
      else if (sortField === "credits") { av = a.credits; bv = b.credits; }
      else if (sortField === "createdAt") { av = a.createdAt || ""; bv = b.createdAt || ""; }
      else if (sortField === "lastLogin") { av = a.lastLogin || ""; bv = b.lastLogin || ""; }
      else if (sortField === "lastUsed") {
        av = a.lastUsed || "";
        bv = b.lastUsed || "";
      }
      else if (sortField === "activityScore") {
        av = typeof a.activityScore?.score === "number" ? a.activityScore.score : -1;
        bv = typeof b.activityScore?.score === "number" ? b.activityScore.score : -1;
      }
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });

    return result;
  }, [users, search, filter, selectedCountries, contactFilter, billingCycleFilter, osFilter, versionFilter, versionOptions, activityFilter, retentionFilter, sortField, sortDir]);

  function handleExportCsv() {
    if (filtered.length === 0) {
      setActionMsg({ type: "error", text: "No users to export with current filters." });
      setTimeout(() => setActionMsg(null), 3000);
      return;
    }
    setExportingCsv(true);
    try {
      const headers = [
        "User ID",
        "Name",
        "Email",
        "Phone Number",
        "Church Name",
        "Church Role",
        "Country",
        "Plan",
        "Billing Cycle",
        "Account Status",
        "Activity Status (30d)",
        "Daily Activity %",
        "Weekly Activity %",
        "Monthly Activity %",
        "Overall Activity Score",
        "Activity Grade",
        "Subscription Expiry Date",
        "Expiry / Grace Status",
        "Bible Searches",
        "Songs Created",
        "Media Uploaded",
        "Transcripts Created",
        "Signup Date",
        "Last Used At",
        "Last Opened At",
        "Last Login At",
        "Desktop OS",
        "App Version",
      ];

      const rows = filtered.map((u) => {
        const expInfo = getSubscriptionExpiringInfo(u);
        const expText = expInfo ? expInfo.text : (u.subscriptionExpiresAt ? new Date(u.subscriptionExpiresAt).toLocaleDateString() : "");
        const dScore = u.activityScore?.daily?.score ?? 0;
        const wScore = u.activityScore?.weekly?.score ?? 0;
        const mScore = u.activityScore?.monthly?.score ?? 0;
        const oScore = u.activityScore?.score ?? 0;
        const oGrade = u.activityScore?.grade ?? "E";

        return [
          u.id,
          u.name || "",
          u.email || "",
          u.phone || "",
          u.churchName || "",
          u.churchRole || "",
          u.country || "",
          u.plan || "free",
          u.billingCycle || (u.plan !== "free" ? "monthly" : "none"),
          u.accountStatus || "active",
          u.isActive ? "Active" : "Inactive",
          `${dScore}%`,
          `${wScore}%`,
          `${mScore}%`,
          oScore,
          oGrade,
          u.subscriptionExpiresAt ? new Date(u.subscriptionExpiresAt).toISOString() : "",
          expText,
          u.usage?.bibleSearches || 0,
          u.usage?.songsCreated || 0,
          u.usage?.mediaUploaded || 0,
          u.usage?.transcriptCount || 0,
          u.createdAt || "",
          u.lastUsed || "",
          u.lastOpened || "",
          u.lastLogin || "",
          userOsList(u).map((os) => OS_LABELS[os]).join(" / ") || OS_LABELS.none,
          userVersionList(u).join(" / "),
        ];
      });

      const csvContent = [
        headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(","),
        ...rows.map((row) =>
          row
            .map((val) => {
              const str = String(val ?? "").replace(/"/g, '""');
              return `"${str}"`;
            })
            .join(",")
        ),
      ].join("\r\n");

      const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const dateStr = new Date().toISOString().slice(0, 10);
      const filterSuffix = filter !== "all" ? `-${filter}` : "";
      const contactSuffix = contactFilter !== "all" ? `-${contactFilter}` : "";
      const cycleSuffix =
        (billingCycleFilter !== "all" ? `-${billingCycleFilter}` : "")
        + (osFilter !== "all" ? `-${osFilter}` : "")
        + (versionFilter !== "all" ? `-v${versionFilter.replace(/^__/, "")}` : "");
      link.href = url;
      link.download = `makechurcheasy-users${filterSuffix}${contactSuffix}${cycleSuffix}-${dateStr}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setActionMsg({
        type: "success",
        text: `Exported ${filtered.length} users to CSV successfully!`,
      });
      setTimeout(() => setActionMsg(null), 4000);
    } catch (err: any) {
      setActionMsg({
        type: "error",
        text: `Failed to export CSV: ${err?.message || "Unknown error"}`,
      });
      setTimeout(() => setActionMsg(null), 4000);
    } finally {
      setExportingCsv(false);
    }
  }

  const totalPages = Math.ceil(filtered.length / perPage);
  const paged = filtered.slice((page - 1) * perPage, page * perPage);
  const selectedSubscriptionCredits = getAdminManagedPlanCredits(planConfig, newPlan);
  const revokeAmbassadorUser = showRevokeAmbassador
    ? users.find((u) => u.id === showRevokeAmbassador) ?? null
    : null;

  useEffect(() => { setPage(1); }, [search, filter, activityFilter, selectedCountries, osFilter, versionFilter, retentionFilter, contactFilter, billingCycleFilter, perPage]);

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("asc"); }
  }

  function flash(type: "success" | "error", text: string) {
    setActionMsg({ type, text });
    setTimeout(() => setActionMsg(null), 3000);
  }

  async function handleGrantCredits(userId: string) {
    const amount = parseFloat(creditsAmount);
    if (!amount || amount <= 0) return;
    setGrantingCredits(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/credits`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed");
      const data = await res.json();
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, credits: data.credits } : u));
      flash("success", t('admin.users.flash.grantedCredits', { amount }));
      setShowGrantCredits(null);
      setCreditsAmount("");
    } catch (err: any) {
      flash("error", err?.message || t('admin.users.errors.grantCreditsFailed'));
    } finally {
      setGrantingCredits(false);
    }
  }

  async function handleChangePlan(userId: string) {
    setChangingPlan(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/plan`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: newPlan,
          billingCycle: subscriptionBillingCycle,
          amountPaid: subscriptionAmount || undefined,
          currency: subscriptionCurrency || "NGN",
          paymentReference: subscriptionReference || undefined,
          note: subscriptionNote || undefined,
          notifyUser: notifySubscriptionUser,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed");
      const data = await res.json();
      setUsers((prev) => prev.map((u) => u.id === userId ? {
        ...u,
        plan: data.plan || newPlan,
        ...(data.credits !== undefined ? { credits: data.credits } : {}),
        adminManagedSubscription: data.adminManagedSubscription,
        subscriptionExpiresAt: data.subscriptionExpiresAt,
        scheduledDowngradeAt: data.scheduledDowngradeAt,
        ...(data.trial !== undefined ? { trial: data.trial } : {}),
        ...(data.plan !== "free" ? { adminTemporaryPlan: { ...(u.adminTemporaryPlan || {}), active: false } } : {}),
      } : u));
      flash("success", data.emailSent ? t('admin.users.flash.planChangedEmail', { plan: data.plan || newPlan }) : t('admin.users.flash.planChanged', { plan: data.plan || newPlan }));
      setShowChangePlan(null);
      setSubscriptionAmount("");
      setSubscriptionReference("");
      setSubscriptionNote("");
    } catch (err: any) {
      flash("error", err?.message || t('admin.users.errors.changePlanFailed'));
    } finally {
      setChangingPlan(false);
    }
  }

  async function handleSaveTemporaryPlan(userId: string) {
    const durationDays = parseInt(temporaryDurationDays, 10);
    if (!temporaryPlan || !durationDays || durationDays <= 0) return;
    setSavingTemporaryPlan(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/temporary-plan`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: temporaryPlan,
          durationDays,
          reason: temporaryReason || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed");
      const data = await res.json();
      setUsers((prev) => prev.map((u) => u.id === userId ? {
        ...u,
        plan: data.plan,
        ...(data.credits !== undefined ? { credits: data.credits } : {}),
        adminTemporaryPlan: data.adminTemporaryPlan,
      } : u));
      flash("success", data.emailSent ? t('admin.users.flash.temporaryPlanSavedEmail') : t('admin.users.flash.temporaryPlanSaved'));
      setShowTemporaryPlan(null);
      setTemporaryReason("");
    } catch (err: any) {
      flash("error", err?.message || t('admin.users.errors.temporaryPlanFailed'));
    } finally {
      setSavingTemporaryPlan(false);
    }
  }

  async function handleEndTemporaryPlan(userId: string) {
    setEndingTemporaryPlan(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/temporary-plan`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed");
      const data = await res.json();
      setUsers((prev) => prev.map((u) => u.id === userId ? {
        ...u,
        plan: "free",
        ...(data.credits !== undefined ? { credits: data.credits } : {}),
        adminTemporaryPlan: data.adminTemporaryPlan,
      } : u));
      flash("success", t('admin.users.flash.temporaryPlanEnded'));
      setShowEndTemporaryPlan(null);
    } catch (err: any) {
      flash("error", err?.message || t('admin.users.errors.temporaryPlanEndFailed'));
    } finally {
      setEndingTemporaryPlan(false);
    }
  }

  async function handleGrantAmbassador(userId: string) {
    setGrantingAmbassador(true);
    try {
      const parsedCredits = ambassadorCredits ? parseInt(ambassadorCredits) : undefined;
      const res = await fetch(`/api/admin/users/${userId}/ambassador`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          durationMonths: parseInt(ambassadorDuration),
          ...(parsedCredits && parsedCredits > 0 ? { credits: parsedCredits } : {}),
          notes: ambassadorNotes || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed");
      const data = await res.json();
      setUsers((prev) => prev.map((u) => u.id === userId ? {
        ...u,
        plan: "growth",
        credits: data.ambassador?.creditsGranted ?? u.credits,
        ambassador: data.ambassador,
      } : u));
      flash("success", t('admin.users.flash.ambassadorGranted'));
      setShowAmbassador(null);
    } catch (err: any) {
      flash("error", err?.message || t('admin.users.errors.ambassadorGrantFailed'));
    } finally {
      setGrantingAmbassador(false);
    }
  }

  async function handleRevokeAmbassador(userId: string) {
    setRevokingAmbassador(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/ambassador`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed");
      const data = await res.json();
      setUsers((prev) => prev.map((u) => u.id === userId ? {
        ...u,
        plan: data.revertedPlan,
        ...(data.credits !== undefined ? { credits: data.credits } : {}),
        ambassador: { ...(u.ambassador || {}), active: false },
      } : u));
      flash("success", t('admin.users.flash.ambassadorRevoked', { plan: data.revertedPlan }));
      setShowRevokeAmbassador(null);
    } catch (err: any) {
      flash("error", err?.message || t('admin.users.errors.ambassadorRevokeFailed'));
    } finally {
      setRevokingAmbassador(false);
    }
  }

  async function handleCancelTrial(userId: string) {
    setCancellingTrial(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/trial`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed");
      const data = await res.json();
      setUsers((prev) => prev.map((u) => u.id === userId ? {
        ...u,
        plan: "free",
        ...(data.credits !== undefined ? { credits: data.credits } : {}),
        trial: { ...(u.trial || {}), active: false },
      } : u));
      flash("success", t('admin.users.flash.trialCancelled'));
      setShowCancelTrial(null);
    } catch (err: any) {
      flash("error", err?.message || t('admin.users.errors.cancelTrialFailed'));
    } finally {
      setCancellingTrial(false);
    }
  }

  async function handleGrantTrial(userId: string) {
    setGrantingTrial(true);
    try {
      const days = parseInt(trialDuration, 10);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        throw new Error("Trial duration must be between 1 and 365 days");
      }
      const res = await fetch(`/api/admin/users/${userId}/trial`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", days }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed");
      const data = await res.json();
      setUsers((prev) => prev.map((u) => u.id === userId ? {
        ...u,
        plan: "growth",
        trial: data.trial,
      } : u));
      flash("success", `Trial granted for ${days} days`);
      setShowGrantTrial(null);
    } catch (err: any) {
      flash("error", err?.message || "Failed to grant trial");
    } finally {
      setGrantingTrial(false);
    }
  }

  async function handleExtendTrial(userId: string) {
    setExtendingTrial(true);
    try {
      const days = parseInt(extendTrialDays, 10);
      if (!days || days <= 0) throw new Error("Days must be a positive number");
      const res = await fetch(`/api/admin/users/${userId}/trial`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "extend", days }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed");
      const data = await res.json();
      setUsers((prev) => prev.map((u) => u.id === userId ? {
        ...u,
        trial: data.trial,
      } : u));
      flash("success", `Trial extended by ${days} days`);
      setShowExtendTrial(null);
    } catch (err: any) {
      flash("error", err?.message || "Failed to extend trial");
    } finally {
      setExtendingTrial(false);
    }
  }

  async function runAdminAction(
    user: AdminUser,
    action: AdminUserAction,
    label: string,
  ) {
    setRunningAction(`${user.id}:${action}`);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/actions`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: label }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Action failed");

      setUsers((prev) => {
        if (action === "delete") return prev.filter((u) => u.id !== user.id);
        return prev.map((u) => {
          if (u.id !== user.id) return u;
          if (action === "suspend") return { ...u, accountStatus: "suspended" };
          if (action === "unsuspend") return { ...u, accountStatus: "active" };
          if (action === "make_admin") return { ...u, role: "admin" };
          if (action === "remove_admin") return { ...u, role: "user" };
          if (action === "reset_credits" && typeof data.credits === "number") return { ...u, credits: data.credits };
          if (action === "reset_devices") return { ...u, deviceIds: [] };
          return u;
        });
      });
      flash("success", `${label} completed`);
    } catch (err: any) {
      flash("error", err?.message || `${label} failed`);
    } finally {
      setRunningAction(null);
    }
  }

  function openAdminAction(user: AdminUser, action: AdminUserAction, label: string) {
    const destructiveEffects: Partial<Record<AdminUserAction, string[]>> = {
      suspend: [
        "Suspend account access immediately",
        "Send a suspension email",
        "Create a dashboard notification and modal",
        "Record an audit log entry",
      ],
      delete: [
        "Disable the account immediately",
        "Send the final account deletion email",
        "Remove the user from the active admin list",
        "Record an audit log entry",
      ],
      reset_credits: [
        "Reset the user's admin-granted credits",
        "Send a credit reset email",
        "Create a dashboard notification and modal",
        "Record an audit log entry",
      ],
      remove_admin: [
        "Remove administrator access",
        "Send an administrator access removal email",
        "Create a dashboard notification and modal",
        "Record an audit log entry",
      ],
      reset_devices: [
        "Remove all connected devices",
        "Send a device reset email",
        "Create a dashboard notification and modal",
        "Record an audit log entry",
      ],
      force_logout: [
        "End all active sessions",
        "Send a security email",
        "Create a dashboard notification and modal",
        "Record an audit log entry",
      ],
    };

    const effects = destructiveEffects[action];
    if (effects) {
      setConfirmAction({ user, action, label, effects });
      return;
    }

    void runAdminAction(user, action, label);
  }

  function planBadge(plan: string) {
    const colors: Record<string, string> = {
      free: "bg-gray-800 text-slate-400",
      basic: "bg-sky-900/50 text-sky-300 border border-sky-700/50",
      growth: "bg-amber-900/50 text-amber-300 border border-amber-700/50",
      ambassador: "bg-purple-900/50 text-purple-300 border border-purple-700/50",
      unlimited: "bg-yellow-900/50 text-yellow-300 border border-yellow-700/50",
    };
    return colors[plan] || colors.free;
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 text-slate-600" />;
    return <ArrowUpDown className={`w-3 h-3 ${sortDir === "asc" ? "text-indigo-400" : "text-indigo-400 rotate-180"}`} />;
  }

  if (loading) {
    return (
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <SkeletonBlock className="h-8 w-48 mb-2" />
          <SkeletonBlock className="h-4 w-32" />
        </div>
        <SkeletonBlock className="h-11 w-full mb-4" />
        <SkeletonBlock className="h-[480px] w-full" />
      </div>
    );
  }

  return (
    <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-50">{t('admin.users.title')}</h1>
          <p className="text-sm text-slate-400 mt-1">{t('admin.users.totalUsers', { count: users.length })}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={exportingCsv || filtered.length === 0}
            title="Download filtered user list as CSV"
            className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold rounded-xl border border-emerald-700/60 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/60 hover:border-emerald-600 hover:text-emerald-100 transition shadow-sm disabled:opacity-50 cursor-pointer"
          >
            {exportingCsv ? (
              <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
            ) : (
              <Download className="w-4 h-4 text-emerald-400" />
            )}
            <span>Export CSV ({filtered.length})</span>
          </button>

          <button
            type="button"
            disabled={zohoSyncing}
            title="Pull contacts from Zoho Campaigns and tag matching users"
            onClick={async () => {
              setZohoSyncing(true);
              try {
                const res = await fetch("/api/admin/contacts/sync", { method: "POST", credentials: "include" });
                const body = await res.json().catch(() => ({}));
                const r = body.result;
                if (r?.status === "completed") {
                  setActionMsg({ type: "success", text: `Zoho sync done: ${r.contacts} contacts, ${r.matchedUsers} matched to users, ${r.filledPhones} phones filled in.` });
                  await fetchUsers(true);
                } else {
                  setActionMsg({ type: "error", text: r?.errorCode === "no_lists_found" ? "Zoho returned no lists. Check the Zoho token's READ permission." : body.error || "Zoho sync failed." });
                }
              } catch {
                setActionMsg({ type: "error", text: "Could not reach the server." });
              } finally {
                setZohoSyncing(false);
              }
            }}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold rounded-xl border border-sky-700/60 bg-sky-950/40 text-sky-300 hover:bg-sky-900/60 hover:text-sky-100 transition shadow-sm disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${zohoSyncing ? "animate-spin" : ""}`} />
            <span>{zohoSyncing ? "Syncing Zoho..." : "Sync from Zoho"}</span>
          </button>

          <button
            type="button"
            onClick={() => fetchUsers(true)}
            disabled={refreshing || loading}
            title="Refresh user list"
            className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-xl border border-slate-700 bg-gray-900 text-slate-200 hover:bg-gray-800 hover:border-slate-600 hover:text-white transition shadow-sm disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 text-slate-400 ${refreshing ? "animate-spin text-indigo-400" : ""}`} />
            <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
          </button>
        </div>
      </div>

      {actionMsg && (
        <div className={`mb-4 px-4 py-2.5 rounded-xl text-sm flex items-center gap-2 ${actionMsg.type === "success" ? "bg-emerald-900/40 text-emerald-300 border border-emerald-700/50" : "bg-red-900/40 text-red-300 border border-red-700/50"
          }`}>
          {actionMsg.text}
        </div>
      )}

      {/* Activity Cohort Filter Pills */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-indigo-400" />
            Used the product in
          </span>
          {activityFilter !== "all" && (
            <button
              onClick={() => setActivityFilter("all")}
              className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
            >
              Reset to all
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1.5 scrollbar-thin">
          {[
            { id: "all", label: "All Users", count: activityCounts.all },
            { id: "expiring", label: "Expiring Subs (≤30d)", count: activityCounts.expiring, alert: true },
            { id: "1d", label: "Past 24h", count: activityCounts["1d"], live: true },
            { id: "3d", label: "Past 3 Days", count: activityCounts["3d"] },
            { id: "7d", label: "Past 7 Days", count: activityCounts["7d"] },
            { id: "14d", label: "Past 14 Days", count: activityCounts["14d"] },
            { id: "30d", label: "Past 30 Days", count: activityCounts["30d"] },
            { id: "inactive", label: "Not used in 30d", count: activityCounts.inactive },
          ].map((item) => {
            const isActive = activityFilter === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActivityFilter(item.id as ActivityFilter)}
                className={`group flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all ${
                  isActive
                    ? item.alert
                      ? "bg-amber-600 text-white shadow-lg shadow-amber-600/25 ring-1 ring-amber-400/50"
                      : "bg-indigo-600 text-white shadow-lg shadow-indigo-600/25 ring-1 ring-indigo-400/50"
                    : item.alert && item.count > 0
                      ? "bg-amber-950/40 text-amber-300 hover:bg-amber-900/50 border border-amber-800/60"
                      : "bg-gray-900 text-slate-300 hover:bg-gray-800 hover:text-slate-100 border border-slate-800"
                }`}
              >
                {item.live && (
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                )}
                {item.alert && <Clock className="w-3 h-3 text-amber-400 shrink-0" />}
                <span>{item.label}</span>
                <span
                  className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                    isActive
                      ? "bg-white/20 text-white"
                      : "bg-slate-800 text-slate-400 group-hover:bg-slate-700 group-hover:text-slate-300"
                  }`}
                >
                  {item.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder={t('admin.users.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-11 pl-9 pr-3 rounded-xl border border-slate-700 text-sm bg-gray-900 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-colors"
          />
        </div>

        {/* Country Filter Selector */}
        <div className="relative" ref={countryDropdownRef}>
          <button
            type="button"
            onClick={() => setCountryDropdownOpen((prev) => !prev)}
            className={`h-11 px-3.5 rounded-xl border text-sm flex items-center justify-between gap-2.5 transition-all whitespace-nowrap min-w-[170px] ${
              selectedCountries.length > 0
                ? "bg-indigo-600/15 border-indigo-500/50 text-indigo-300 font-semibold shadow-sm"
                : "bg-gray-900 border-slate-700 text-slate-300 hover:text-slate-100 hover:border-slate-600"
            }`}
          >
            <div className="flex items-center gap-2 truncate">
              <Globe className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="truncate">
                {selectedCountries.length === 0
                  ? "All Countries"
                  : selectedCountries.length === 1
                    ? (() => {
                        const c = countryOptions.find((opt) => opt.code === selectedCountries[0]);
                        return c ? `${c.flag ? `${c.flag} ` : ""}${c.name}` : "1 Country";
                      })()
                    : `${selectedCountries.length} Countries`}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {selectedCountries.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-indigo-500/30 text-indigo-200">
                  {countryOptions
                    .filter((c) => selectedCountries.includes(c.code))
                    .reduce((sum, c) => sum + c.count, 0)}
                </span>
              )}
              <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-150 ${countryDropdownOpen ? "rotate-180" : ""}`} />
            </div>
          </button>

          {countryDropdownOpen && (
            <div className="absolute right-0 sm:left-0 sm:right-auto mt-2 w-72 rounded-2xl border border-slate-700 bg-gray-900 p-2 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-100">
              {countryOptions.length > 5 && (
                <div className="relative mb-2 px-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search countries..."
                    value={countrySearchQuery}
                    onChange={(e) => setCountrySearchQuery(e.target.value)}
                    className="w-full h-8 pl-8 pr-2.5 rounded-lg border border-slate-800 text-xs bg-gray-950 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                    autoFocus
                  />
                </div>
              )}

              {/* All countries option / Clear */}
              <button
                type="button"
                onClick={() => {
                  setSelectedCountries([]);
                  setCountryDropdownOpen(false);
                }}
                className={`w-full px-2.5 py-2 rounded-xl text-xs flex items-center justify-between transition-colors ${
                  selectedCountries.length === 0
                    ? "bg-indigo-600 text-white font-semibold"
                    : "text-slate-300 hover:bg-gray-800"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span>🌍</span>
                  <span>All Countries</span>
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${selectedCountries.length === 0 ? "bg-white/20 text-white" : "bg-slate-800 text-slate-400"}`}>
                  {users.length}
                </span>
              </button>

              <div className="my-1 border-t border-slate-800" />

              {/* Scrollable list of signed-up countries */}
              <div className="max-h-60 overflow-y-auto space-y-0.5 pr-1">
                {displayedCountryOptions.map((c) => {
                  const isChecked = selectedCountries.includes(c.code);
                  return (
                    <button
                      key={c.code}
                      type="button"
                      onClick={() => toggleCountry(c.code)}
                      className={`w-full px-2.5 py-1.5 rounded-xl text-xs flex items-center justify-between transition-colors ${
                        isChecked
                          ? "bg-indigo-600/20 text-indigo-200 font-semibold"
                          : "text-slate-300 hover:bg-gray-800 hover:text-slate-100"
                      }`}
                    >
                      <span className="flex items-center gap-2 truncate pr-2">
                        <span className="text-sm shrink-0">{c.flag || "🌐"}</span>
                        <span className="truncate">{c.name}</span>
                      </span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-bold">
                          {c.count}
                        </span>
                        {isChecked && (
                          <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                        )}
                      </span>
                    </button>
                  );
                })}
                {displayedCountryOptions.length === 0 && (
                  <p className="text-center py-3 text-xs text-slate-500">No countries match "{countrySearchQuery}"</p>
                )}
              </div>

              {selectedCountries.length > 0 && (
                <div className="mt-2 pt-2 border-t border-slate-800 flex justify-between items-center px-1">
                  <span className="text-[11px] text-slate-400">
                    {selectedCountries.length} selected
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedCountries([])}
                    className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300"
                  >
                    Clear all
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Plan & Status Filter */}
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-11 px-3 rounded-xl border border-slate-700 text-sm bg-gray-900 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-colors"
        >
          <option value="all">{t('admin.users.filters.all')}</option>
          <option value="expiring">⚡ Subscriptions Expiring (≤30d)</option>
          <option value="expiring_7d">⚠️ Subscriptions Expiring (≤7d)</option>
          <option value="active">{t('admin.users.filters.active')}</option>
          <option value="inactive">{t('admin.users.filters.inactive')}</option>
          <option value="paid">{t('admin.users.filters.paid')}</option>
          <option value="free">{t('admin.users.filters.free')}</option>
          <option value="trial">{t('admin.users.filters.trial')}</option>
          <option value="ambassador">{t('admin.users.filters.ambassadors')}</option>
          <option value="temporary">{t('admin.users.filters.temporary')}</option>
          <option value="admin">{t('admin.users.filters.admins')}</option>
          <option value="suspended">Suspended</option>
        </select>

        {/* Contact Info Filter */}
        <select
          value={contactFilter}
          onChange={(e) => setContactFilter(e.target.value as any)}
          title="Filter by contact details"
          className={`h-11 px-3 rounded-xl border text-sm bg-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition-colors ${
            contactFilter !== "all"
              ? "border-emerald-500/60 text-emerald-300 font-semibold bg-emerald-950/20"
              : "border-slate-700 text-slate-100 focus:border-indigo-500"
          }`}
        >
          <option value="all">📞 All Contacts</option>
          <option value="has_phone">📞 Has Phone Number</option>
          <option value="phone_only">📱 Phone Only (No Email)</option>
          <option value="email_only">✉️ Email Only (No Phone)</option>
          <option value="both">✨ Has Both Email & Phone</option>
        </select>

        {/* Billing Cycle Filter */}
        <select
          value={billingCycleFilter}
          onChange={(e) => setBillingCycleFilter(e.target.value as any)}
          title="Filter by billing cycle"
          className={`h-11 px-3 rounded-xl border text-sm bg-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition-colors ${
            billingCycleFilter !== "all"
              ? "border-sky-500/60 text-sky-300 font-semibold bg-sky-950/20"
              : "border-slate-700 text-slate-100 focus:border-indigo-500"
          }`}
        >
          <option value="all">💳 All Billing Cycles</option>
          <option value="monthly">📅 Monthly Billing</option>
          <option value="yearly">📆 Yearly Billing</option>
          <option value="lifetime">♾️ Lifetime / One-Time</option>
        </select>

        {/* Desktop OS Filter */}
        <select
          value={osFilter}
          onChange={(e) => setOsFilter(e.target.value as typeof osFilter)}
          title="Filter by the operating system the desktop app runs on"
          className={`h-11 px-3 rounded-xl border text-sm bg-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition-colors ${
            osFilter !== "all"
              ? "border-violet-500/60 text-violet-300 font-semibold bg-violet-950/20"
              : "border-slate-700 text-slate-100 focus:border-indigo-500"
          }`}
        >
          <option value="all">💻 All Operating Systems</option>
          <option value="windows">Windows ({osCounts.windows})</option>
          <option value="macos">macOS ({osCounts.macos})</option>
          <option value="linux">Linux ({osCounts.linux})</option>
          <option value="unknown">Unknown OS ({osCounts.unknown})</option>
          <option value="none">No desktop app ({osCounts.none})</option>
        </select>

        {/* Desktop App Version Filter */}
        <select
          value={versionFilter}
          onChange={(e) => setVersionFilter(e.target.value)}
          title="Filter by desktop app version"
          className={`h-11 px-3 rounded-xl border text-sm bg-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition-colors ${
            versionFilter !== "all"
              ? "border-amber-500/60 text-amber-300 font-semibold bg-amber-950/20"
              : "border-slate-700 text-slate-100 focus:border-indigo-500"
          }`}
        >
          <option value="all">🏷️ All App Versions</option>
          <option value="__before_fix">Below v{UPDATE_CAMPAIGN_FIX_VERSION} (MacBook fix)</option>
          {versionOptions.versions.length > 0 && (
            <option value="__outdated">⚠️ Not on latest (v{versionOptions.versions[0].version})</option>
          )}
          {versionOptions.versions.map(({ version, count }) => (
            <option key={version} value={version}>v{version} ({count})</option>
          ))}
          <option value="__none">No app version ({versionOptions.none})</option>
        </select>
      </div>

      {/* Are the users still with us? Counted from the last time each one really used the product. */}
      <div className="mb-4 rounded-xl border border-slate-800 bg-gray-900/60 p-3" aria-label="Are users still with us">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
          <span className="text-[11px] uppercase tracking-wide font-semibold text-slate-400">Still with us?</span>
          <span className="text-[11px] text-slate-500">
            Counted from the last real use (presenting, searching, songs, uploads), not from opening the app.
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {RETENTION_ORDER.map((status) => {
            const style = RETENTION_STYLE[status];
            const on = retentionFilter === status;
            return (
              <button
                key={status}
                type="button"
                onClick={() => setRetentionFilter(on ? "all" : status)}
                aria-pressed={on}
                title={`${style.hint}. Click to ${on ? "show everyone" : "show only these"}.`}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${style.badge} ${on ? "ring-2 ring-indigo-400/60" : "opacity-90 hover:opacity-100"}`}
              >
                <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                {style.label}
                <span className="font-mono">{retentionCounts[status]}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setRetentionFilter(retentionFilter === "attention" ? "all" : "attention")}
            aria-pressed={retentionFilter === "attention"}
            title="Slipping and at risk: people who used it before and have gone quiet. A good moment to reach out."
            className={`inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-gray-800 ${retentionFilter === "attention" ? "ring-2 ring-indigo-400/60" : ""}`}
          >
            Needs a nudge
            <span className="font-mono">{retentionCounts.slipping + retentionCounts["at-risk"]}</span>
          </button>
        </div>
      </div>

      {/* Active Country Filter Chips */}
      {selectedCountries.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-4 text-xs">
          <span className="text-slate-400 text-[11px] uppercase tracking-wide font-semibold">Filtered by country:</span>
          {selectedCountries.map((code) => {
            const c = countryOptions.find((opt) => opt.code === code);
            if (!c) return null;
            return (
              <span
                key={code}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-200 font-medium"
              >
                <span>{c.flag}</span>
                <span>{c.name}</span>
                <span className="text-[10px] text-indigo-300/70 font-mono">({c.count})</span>
                <button
                  type="button"
                  onClick={() => toggleCountry(code)}
                  className="hover:text-white p-0.5 rounded transition-colors"
                  title="Remove country filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })}
          <button
            type="button"
            onClick={() => setSelectedCountries([])}
            className="text-xs text-slate-400 hover:text-slate-200 underline underline-offset-2 ml-1"
          >
            Clear country filter
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-gray-900 border border-slate-700 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700/50">
                <th className="text-left px-4 py-3 font-semibold text-slate-400 text-xs uppercase tracking-wide">
                  <button onClick={() => toggleSort("name")} className="flex items-center gap-1 hover:text-slate-200 transition-colors">
                    {t('admin.users.tableHeaders.user')} <SortIcon field="name" />
                  </button>
                </th>
                <th className="text-left px-4 py-3 font-semibold text-slate-400 text-xs uppercase tracking-wide hidden lg:table-cell">{t('admin.users.tableHeaders.status')}</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-400 text-xs uppercase tracking-wide">
                  <button onClick={() => toggleSort("activityScore")} className="flex items-center gap-1 hover:text-slate-200 transition-colors">
                    Activity <SortIcon field="activityScore" />
                  </button>
                </th>
                <th className="text-left px-4 py-3 font-semibold text-slate-400 text-xs uppercase tracking-wide hidden md:table-cell">
                  <button onClick={() => toggleSort("lastUsed")} className="flex items-center gap-1 hover:text-slate-200 transition-colors" title="Last used = presented, searched, imported, uploaded or used voice. Opened = the app was running (launch, sign-in, update check).">
                    Last Used <SortIcon field="lastUsed" />
                  </button>
                </th>
                <th className="text-left px-4 py-3 font-semibold text-slate-400 text-xs uppercase tracking-wide hidden xl:table-cell">
                  <button onClick={() => toggleSort("createdAt")} className="flex items-center gap-1 hover:text-slate-200 transition-colors">
                    {t('admin.users.tableHeaders.created')} <SortIcon field="createdAt" />
                  </button>
                </th>
                <th className="text-right px-4 py-3 font-semibold text-slate-400 text-xs uppercase tracking-wide">{t('admin.users.tableHeaders.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((user) => (
                <tr key={user.id} className="border-b border-slate-800/60 hover:bg-gray-800/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-indigo-500/20 rounded-full flex items-center justify-center text-indigo-400 text-xs font-bold shrink-0">
                        {user.name?.charAt(0)?.toUpperCase() || "?"}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="font-medium text-slate-100 truncate">{user.name || t('common.unnamed')}</p>
                          {user.reactivationOffer && (
                            <span
                              title={user.reactivationOffer.status === "granted"
                                ? `Returned after an inactive period; free Growth month claimed${user.reactivationOffer.expiresAt ? ` through ${new Date(user.reactivationOffer.expiresAt).toLocaleDateString()}` : ""}.`
                                : "Returning user selected for the free Growth month reactivation offer."}
                              className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${user.reactivationOffer.status === "granted"
                                ? "border-emerald-700/60 bg-emerald-900/30 text-emerald-300"
                                : "border-violet-700/60 bg-violet-900/30 text-violet-300"}`}
                            >
                              {user.reactivationOffer.status === "granted" ? "Reactivated" : "Returning"}
                            </span>
                          )}
                          {user.zohoLists && (
                            <span
                              title={user.zohoLists.length ? `Zoho Campaigns lists: ${user.zohoLists.join(", ")}` : "In Zoho Campaigns"}
                              className="inline-flex shrink-0 items-center rounded-full border border-sky-700/60 bg-sky-900/30 px-1.5 py-0.5 text-[9px] font-semibold text-sky-300"
                            >
                              In Zoho
                            </span>
                          )}
                          {user.role === "admin" && <Shield className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
                          {user.ambassador?.active && <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                        </div>
                        <div className="flex items-center flex-wrap gap-x-2 text-xs text-slate-500">
                          <span className="truncate">{user.email}</span>
                          {user.phone && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-mono shrink-0">
                              <Phone className="w-3 h-3 text-emerald-500/80" />
                              {user.phone}
                            </span>
                          )}
                        </div>
                        {/* Third line: Country, Church, and Plan */}
                        <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-0.5 text-[11px] text-slate-400">
                          {user.country && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const code = normalizeCountry(user.country).code;
                                setSelectedCountries([code]);
                              }}
                              className="text-[11px] text-slate-400 hover:text-indigo-300 hover:underline font-medium tracking-tight shrink-0 transition-colors"
                              title={`Filter by ${getCountryDisplayName(user.country)}`}
                            >
                              {getCountryDisplayName(user.country)}
                            </button>
                          )}
                          {user.churchName && (
                            <>
                              {user.country && <span className="text-slate-600 text-[10px]">•</span>}
                              <span className="text-slate-500 truncate max-w-[140px]" title={user.churchName}>{user.churchName}</span>
                            </>
                          )}
                          {(user.country || user.churchName) && <span className="text-slate-600 text-[10px]">/</span>}
                          <span className={`inline-flex px-1.5 py-0.2 rounded text-[10px] font-semibold uppercase tracking-wider ${planBadge(user.plan)}`}>
                            {user.plan}
                          </span>
                          {user.billingCycle && user.plan !== "free" && (
                            <span className="inline-flex px-1.5 py-0.2 rounded text-[10px] font-medium capitalize text-slate-300 bg-slate-800 border border-slate-700">
                              {user.billingCycle}
                            </span>
                          )}
                          {(userOsList(user).length > 0 || userVersionList(user).length > 0) && (
                            <span
                              className="inline-flex px-1.5 py-0.2 rounded text-[10px] font-medium text-slate-300 bg-slate-800 border border-slate-700"
                              title="Desktop app (latest device)"
                            >
                              {[
                                user.appPlatform ? OS_LABELS[normalizeOs(user.appPlatform)] : userOsList(user).map((os) => OS_LABELS[os]).join("/"),
                                user.appVersion ? `v${String(user.appVersion).replace(/^v/i, "")}` : "",
                              ].filter(Boolean).join(" · ")}
                            </span>
                          )}
                        </div>
                        {/* Subtitle text showing days, months left to expire */}
                        {(() => {
                          const expInfo = getSubscriptionExpiringInfo(user);
                          if (!expInfo) return null;
                          return (
                            <div className="mt-1 flex items-center gap-1.5">
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${expInfo.badgeClass}`}>
                                <Clock className="w-3 h-3 shrink-0" />
                                {expInfo.text}
                              </span>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${user.isActive ? "bg-emerald-400" : "bg-slate-600"}`} />
                      <span className="text-xs text-slate-400">{user.isActive ? t('admin.users.active') : t('admin.users.inactive')}</span>
                      {user.plan === "free" && user.trial?.active && (
                        <span className="ml-1 inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-900/50 text-amber-300 border border-amber-700/50">
                          {t('admin.users.trial')}
                        </span>
                      )}
                      {user.accountStatus === "suspended" && (
                        <span className="ml-1 inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-900/50 text-red-300 border border-red-700/50">
                          Suspended
                        </span>
                      )}
                      {user.adminTemporaryPlan?.active && (
                        <span className="ml-1 inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-900/50 text-indigo-300 border border-indigo-700/50">
                          {t('admin.users.temporaryPlan.badge')}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {(() => {
                      // Only the real-usage scores from the server. The old lifetime-milestone formula is no longer
                      // used as a stand-in: it scored someone who presented once, months ago, as active today.
                      const multi = user.activityScore?.daily && user.activityScore?.weekly && user.activityScore?.monthly
                        ? {
                            daily: user.activityScore.daily,
                            weekly: user.activityScore.weekly,
                            monthly: user.activityScore.monthly,
                          }
                        : null;
                      if (!multi) {
                        return (
                          <span className="text-[11px] text-slate-500" title="Usage data could not be loaded for this user">
                            No usage data
                          </span>
                        );
                      }
                      return (
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1 flex-wrap">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono border ${multi.daily.badgeBg}`}
                              title={`Daily (Past 24h): ${multi.daily.score}% - ${multi.daily.grade}`}
                            >
                              D:{multi.daily.score}%
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono border ${multi.weekly.badgeBg}`}
                              title={`Weekly (Past 7d): ${multi.weekly.score}% - ${multi.weekly.grade}`}
                            >
                              W:{multi.weekly.score}%
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono border ${multi.monthly.badgeBg}`}
                              title={`Monthly (Past 30d): ${multi.monthly.score}% - ${multi.monthly.grade}`}
                            >
                              M:{multi.monthly.score}%
                            </span>
                          </div>
                          <span className={`text-[10px] font-medium ${multi.monthly.color}`}>
                            {multi.monthly.grade}
                          </span>
                          {user.retention && (
                            <span
                              className={`inline-flex w-fit items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${RETENTION_STYLE[user.retention.status].badge}`}
                              title={`${RETENTION_STYLE[user.retention.status].hint}. ${formatDaysSinceUse(user.retention)}.`}
                            >
                              <span className={`h-1.5 w-1.5 rounded-full ${RETENTION_STYLE[user.retention.status].dot}`} />
                              {RETENTION_STYLE[user.retention.status].label}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {(() => {
                      const usedInfo = formatLastActive(user.lastUsed);
                      const openedInfo = formatLastActive(user.lastOpened || user.lastLogin);
                      return (
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5" title={user.lastUsed ? `Last used: ${usedInfo.full}` : "Has never presented, searched, imported, uploaded or used voice"}>
                            {usedInfo.tone === "recent" && (
                              <span className="relative flex h-1.5 w-1.5 shrink-0">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                              </span>
                            )}
                            <span
                              className={`text-xs ${
                                usedInfo.tone === "recent"
                                  ? "text-emerald-300 font-semibold"
                                  : usedInfo.tone === "warm"
                                  ? "text-amber-300 font-medium"
                                  : usedInfo.tone === "cool"
                                  ? "text-sky-300 font-medium"
                                  : "text-slate-500"
                              }`}
                            >
                              {user.lastUsed ? usedInfo.text : "Never used"}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-500" title={`Last opened (launch, sign-in, update check): ${openedInfo.full}`}>
                            Opened {openedInfo.text === "Never" ? "never" : /ago$|^Just now$|^Yesterday$/.test(openedInfo.text) ? openedInfo.text.toLowerCase() : openedInfo.text}
                          </span>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 hidden xl:table-cell">
                    {(() => {
                      const createdInfo = formatCreatedDate(user.createdAt);
                      return (
                        <div className="flex flex-col" title={createdInfo.full}>
                          <span className="text-xs font-medium text-slate-300">
                            {createdInfo.text}
                          </span>
                          {createdInfo.text !== createdInfo.full && createdInfo.full !== "Unknown" && (
                            <span className="text-[10px] text-slate-500">
                              {createdInfo.full}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={"/admin/users/" + user.id}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/20"
                      >
                        <Eye className="h-4 w-4" /> View profile
                      </Link>
                      <details className="relative">
                        <summary className="flex h-9 cursor-pointer list-none items-center gap-1 rounded-lg border border-slate-700 px-2.5 text-xs font-medium text-slate-300 hover:bg-gray-800 [&::-webkit-details-marker]:hidden">
                          <MoreHorizontal className="h-4 w-4" /> Actions
                        </summary>
                        <div className="absolute right-0 z-30 mt-2 max-h-[70vh] w-56 overflow-y-auto rounded-xl border border-slate-700 bg-gray-900 p-1.5 shadow-2xl">
                          <button type="button" onClick={() => { setShowGrantCredits(user.id); setCreditsAmount(""); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-slate-300 hover:bg-gray-800">Grant credits</button>
                          <button type="button" onClick={() => { setShowChangePlan(user.id); setNewPlan(user.plan === "free" ? "growth" : user.plan); setSubscriptionBillingCycle(user.adminManagedSubscription?.billingCycle || "monthly"); setSubscriptionAmount(""); setSubscriptionCurrency(user.adminManagedSubscription?.currency || "NGN"); setSubscriptionReference(""); setSubscriptionNote(""); setNotifySubscriptionUser(true); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-slate-300 hover:bg-gray-800">Change plan</button>
                          {!(user.plan === "free" && user.trial?.active) && <button type="button" onClick={() => { setShowGrantTrial(user.id); setTrialDuration("14"); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-slate-300 hover:bg-gray-800">Grant trial</button>}
                          <button type="button" onClick={() => { if (user.adminTemporaryPlan?.active) { setShowEndTemporaryPlan(user.id); return; } setShowTemporaryPlan(user.id); setTemporaryPlan(user.plan === "free" ? "growth" : "free"); setTemporaryDurationDays("30"); setTemporaryReason(""); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-slate-300 hover:bg-gray-800">{user.adminTemporaryPlan?.active ? "End temporary plan" : "Set temporary plan"}</button>
                          <button type="button" onClick={() => { if (user.ambassador?.active) setShowRevokeAmbassador(user.id); else { setShowAmbassador(user.id); setAmbassadorDuration("6"); setAmbassadorCredits(""); setAmbassadorNotes(""); } }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-slate-300 hover:bg-gray-800">{user.ambassador?.active ? "Revoke ambassador" : "Grant ambassador"}</button>
                          {user.plan === "free" && user.trial?.active && <>
                            <button type="button" onClick={() => { setShowExtendTrial(user.id); setExtendTrialDays("30"); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-slate-300 hover:bg-gray-800">Extend trial</button>
                            <button type="button" onClick={() => setShowCancelTrial(user.id)} className="w-full rounded-lg px-3 py-2 text-left text-xs text-red-300 hover:bg-red-950/40">Cancel trial</button>
                          </>}
                          <div className="my-1 border-t border-slate-800" />
                          <Link href={"/admin/users/" + user.id} className="block rounded-lg px-3 py-2 text-xs font-medium text-indigo-300 hover:bg-indigo-500/10">Access and account controls</Link>
                        </div>
                      </details>
                    </div>
                  </td>
                </tr>
              ))}
              {paged.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-500">
                    {t('admin.users.noUsersFound')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-slate-700/50">
          <p className="text-xs text-slate-500">
            Showing {filtered.length === 0 ? 0 : (page - 1) * perPage + 1}–{Math.min(page * perPage, filtered.length)} of {filtered.length}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <label htmlFor="admin-users-per-page" className="flex items-center gap-2 text-xs text-slate-400">
              Rows per page
              <select
                id="admin-users-per-page"
                aria-label="Rows per page"
                value={perPage}
                onChange={(event) => setPerPage(Number(event.target.value))}
                className="h-8 rounded-lg border border-slate-700 bg-gray-900 px-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  aria-label="Previous page"
                  className="p-1.5 rounded-xl text-slate-500 hover:text-slate-200 hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs text-slate-400 px-2">{page} / {totalPages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  aria-label="Next page"
                  className="p-1.5 rounded-xl text-slate-500 hover:text-slate-200 hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {confirmAction && (
        <Modal onClose={() => setConfirmAction(null)} title={confirmAction.label}>
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-700 bg-gray-800/60 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">User</p>
              <p className="mt-1 text-sm font-medium text-slate-100">{confirmAction.user.name || t('common.unnamed')}</p>
              <p className="text-xs text-slate-400 mt-0.5">{confirmAction.user.email}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200 mb-2">This action will:</p>
              <ul className="space-y-2">
                {confirmAction.effects.map((effect) => (
                  <li key={effect} className="text-sm text-slate-400 flex items-start gap-2">
                    <span className="mt-1 w-1.5 h-1.5 rounded-full bg-slate-500 shrink-0" />
                    <span>{effect}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmAction(null)}
                className="px-5 py-2.5 text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-gray-800 rounded-xl transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => {
                  const payload = confirmAction;
                  setConfirmAction(null);
                  void runAdminAction(payload.user, payload.action, payload.label);
                }}
                disabled={runningAction === `${confirmAction.user.id}:${confirmAction.action}`}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl disabled:opacity-50 transition-colors"
              >
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Grant Credits Modal */}
      {showGrantCredits && (
        <Modal onClose={() => setShowGrantCredits(null)} title={t('admin.users.grantCredits.title')}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('admin.users.grantCredits.amountLabel')}</label>
              <input
                type="number"
                min="1"
                value={creditsAmount}
                onChange={(e) => setCreditsAmount(e.target.value)}
                placeholder={t('admin.users.grantCredits.amountPlaceholder')}
                className="w-full h-11 px-3 rounded-xl border border-slate-700 text-sm bg-gray-800 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-colors"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowGrantCredits(null)} className="px-5 py-2.5 text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-gray-800 rounded-xl transition-colors">
                {t('common.cancel')}
              </button>
              <button
                onClick={() => handleGrantCredits(showGrantCredits)}
                disabled={!creditsAmount || parseFloat(creditsAmount) <= 0 || grantingCredits}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl disabled:opacity-50 transition-colors"
              >
                {grantingCredits ? t('admin.users.grantCredits.granting') : t('admin.users.grantCredits.button')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Change Plan Modal */}
      {showChangePlan && (
        <Modal onClose={() => setShowChangePlan(null)} title={t('admin.users.changePlan.title')}>
          <div className="space-y-4">
            <p className="text-xs text-slate-400">
              {t('admin.users.changePlan.description')}
            </p>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('admin.users.changePlan.newPlan')}</label>
              <select
                value={newPlan}
                onChange={(e) => setNewPlan(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-slate-700 text-sm bg-gray-800 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-colors"
              >
                <option value="free">Free</option>
                <option value="basic">Basic</option>
                <option value="growth">Growth</option>
              </select>
            </div>
            {newPlan !== "free" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('admin.users.changePlan.billingCycle')}</label>
                    <select
                      value={subscriptionBillingCycle}
                      onChange={(e) => setSubscriptionBillingCycle(e.target.value)}
                      className="w-full h-11 px-3 rounded-xl border border-slate-700 text-sm bg-gray-800 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-colors"
                    >
                      <option value="monthly">{t('admin.users.changePlan.monthly')}</option>
                      <option value="yearly">{t('admin.users.changePlan.yearly')}</option>
                      <optgroup label="Gift">
                        <option value="gift_3m">Gift — 3 months</option>
                        <option value="gift_6m">Gift — 6 months</option>
                        <option value="gift_12m">Gift — 12 months</option>
                      </optgroup>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('admin.users.changePlan.currency')}</label>
                    <input
                      value={subscriptionCurrency}
                      onChange={(e) => setSubscriptionCurrency(e.target.value.toUpperCase())}
                      className="w-full h-11 px-3 rounded-xl border border-slate-700 text-sm bg-gray-800 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-colors"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('admin.users.changePlan.amount')}</label>
                    <input
                      type="number"
                      min="0"
                      value={subscriptionAmount}
                      onChange={(e) => setSubscriptionAmount(e.target.value)}
                      placeholder={t('admin.users.changePlan.amountPlaceholder')}
                      className="w-full h-11 px-3 rounded-xl border border-slate-700 text-sm bg-gray-800 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('common.credits')}</label>
                    <input
                      value={formatPlanCredits(selectedSubscriptionCredits)}
                      readOnly
                      className="w-full h-11 px-3 rounded-xl border border-slate-700 text-sm bg-gray-800/60 text-slate-100 focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('admin.users.changePlan.reference')}</label>
                  <input
                    value={subscriptionReference}
                    onChange={(e) => setSubscriptionReference(e.target.value)}
                    placeholder={t('admin.users.changePlan.referencePlaceholder')}
                    className="w-full h-11 px-3 rounded-xl border border-slate-700 text-sm bg-gray-800 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('admin.users.changePlan.note')}</label>
                  <input
                    value={subscriptionNote}
                    onChange={(e) => setSubscriptionNote(e.target.value)}
                    placeholder={t('admin.users.changePlan.notePlaceholder')}
                    className="w-full h-11 px-3 rounded-xl border border-slate-700 text-sm bg-gray-800 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-colors"
                  />
                </div>
              </>
            )}
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={notifySubscriptionUser}
                onChange={(e) => setNotifySubscriptionUser(e.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-gray-800 text-indigo-600 focus:ring-indigo-500"
              />
              {t('admin.users.changePlan.notifyUser')}
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowChangePlan(null)} className="px-5 py-2.5 text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-gray-800 rounded-xl transition-colors">
                {t('common.cancel')}
              </button>
              <button
                onClick={() => handleChangePlan(showChangePlan)}
                disabled={changingPlan}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl disabled:opacity-50 transition-colors"
              >
                {changingPlan ? t('admin.users.changePlan.changing') : t('admin.users.changePlan.button')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Temporary Plan Modal */}
      {showTemporaryPlan && (
        <Modal onClose={() => setShowTemporaryPlan(null)} title={t('admin.users.temporaryPlan.title')}>
          <div className="space-y-4">
            <p className="text-xs text-slate-400">
              {t('admin.users.temporaryPlan.description')}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('admin.users.temporaryPlan.plan')}</label>
                <select
                  value={temporaryPlan}
                  onChange={(e) => setTemporaryPlan(e.target.value)}
                  className="w-full h-11 px-3 rounded-xl border border-slate-700 text-sm bg-gray-800 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-colors"
                >
                  <option value="free">Free</option>
                  <option value="basic">Basic</option>
                  <option value="growth">Growth</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('admin.users.temporaryPlan.duration')}</label>
                <input
                  type="number"
                  min="1"
                  max="3650"
                  value={temporaryDurationDays}
                  onChange={(e) => setTemporaryDurationDays(e.target.value)}
                  className="w-full h-11 px-3 rounded-xl border border-slate-700 text-sm bg-gray-800 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-colors"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('admin.users.temporaryPlan.reason')}</label>
              <textarea
                value={temporaryReason}
                onChange={(e) => setTemporaryReason(e.target.value)}
                placeholder={t('admin.users.temporaryPlan.reasonPlaceholder')}
                rows={2}
                className="w-full px-3 py-2 rounded-xl border border-slate-700 text-sm bg-gray-800 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 resize-y transition-colors"
              />
            </div>
            <p className="text-xs text-slate-500">
              {t('admin.users.temporaryPlan.returnNotice')}
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowTemporaryPlan(null)} className="px-5 py-2.5 text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-gray-800 rounded-xl transition-colors">
                {t('common.cancel')}
              </button>
              <button
                onClick={() => handleSaveTemporaryPlan(showTemporaryPlan)}
                disabled={savingTemporaryPlan || !temporaryDurationDays || parseInt(temporaryDurationDays) <= 0}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl disabled:opacity-50 transition-colors"
              >
                {savingTemporaryPlan ? t('admin.users.temporaryPlan.saving') : t('admin.users.temporaryPlan.button')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* End Temporary Plan Modal */}
      {showEndTemporaryPlan && (
        <Modal onClose={() => setShowEndTemporaryPlan(null)} title={t('admin.users.temporaryPlan.endTitle')}>
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              {t('admin.users.temporaryPlan.endDescription')}
            </p>
            <p className="text-xs text-slate-500">
              {t('admin.users.temporaryPlan.endWarning')}
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowEndTemporaryPlan(null)} className="px-5 py-2.5 text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-gray-800 rounded-xl transition-colors">
                {t('common.cancel')}
              </button>
              <button
                onClick={() => handleEndTemporaryPlan(showEndTemporaryPlan)}
                disabled={endingTemporaryPlan}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl disabled:opacity-50 transition-colors"
              >
                {endingTemporaryPlan ? t('admin.users.temporaryPlan.ending') : t('admin.users.temporaryPlan.endButton')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Grant Ambassador Modal */}
      {showAmbassador && (
        <Modal onClose={() => setShowAmbassador(null)} title={t('admin.users.ambassador.title')}>
          <div className="space-y-4">
            <p className="text-xs text-slate-400">
              {t('admin.users.ambassador.description')}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('admin.users.ambassador.duration')}</label>
                <select
                  value={ambassadorDuration}
                  onChange={(e) => setAmbassadorDuration(e.target.value)}
                  className="w-full h-11 px-3 rounded-xl border border-slate-700 text-sm bg-gray-800 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-colors"
                >
                  <option value="1">{t('admin.users.ambassador.oneMonth')}</option>
                  <option value="3">{t('admin.users.ambassador.threeMonths')}</option>
                  <option value="6">{t('admin.users.ambassador.sixMonths')}</option>
                  <option value="12">{t('admin.users.ambassador.twelveMonths')}</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('admin.users.ambassador.credits')}</label>
                <input
                  type="number"
                  min="1"
                  value={ambassadorCredits}
                  onChange={(e) => setAmbassadorCredits(e.target.value)}
                  placeholder={defaultAmbassadorCredits ? String(defaultAmbassadorCredits) : ""}
                  className="w-full h-11 px-3 rounded-xl border border-slate-700 text-sm bg-gray-800 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-colors"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">{t('admin.users.ambassador.notes')}</label>
              <textarea
                value={ambassadorNotes}
                onChange={(e) => setAmbassadorNotes(e.target.value)}
                placeholder={t('admin.users.ambassador.notesPlaceholder')}
                rows={2}
                className="w-full px-3 py-2 rounded-xl border border-slate-700 text-sm bg-gray-800 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 resize-y transition-colors"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowAmbassador(null)} className="px-5 py-2.5 text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-gray-800 rounded-xl transition-colors">
                {t('common.cancel')}
              </button>
              <button
                onClick={() => handleGrantAmbassador(showAmbassador)}
                disabled={grantingAmbassador || (ambassadorCredits !== "" && parseInt(ambassadorCredits) <= 0)}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-xl disabled:opacity-50 transition-colors"
              >
                {grantingAmbassador ? t('admin.users.ambassador.granting') : t('admin.users.ambassador.button')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Revoke Ambassador Modal */}
      {showRevokeAmbassador && revokeAmbassadorUser && (
        <Modal onClose={() => !revokingAmbassador && setShowRevokeAmbassador(null)} title={t('admin.users.actions.revokeAmbassador')}>
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-700 bg-gray-800/60 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">User</p>
              <p className="mt-1 text-sm font-medium text-slate-100">{revokeAmbassadorUser.name || t('common.unnamed')}</p>
              <p className="text-xs text-slate-400 mt-0.5">{revokeAmbassadorUser.email}</p>
            </div>
            <p className="text-sm text-slate-300">
              Are you sure you want to revoke ambassador access for this user?
            </p>
            <p className="text-xs text-slate-500">
              This will remove the ambassador badge, return the account to the server-selected previous plan, and update their credits from the revoke result.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowRevokeAmbassador(null)}
                disabled={revokingAmbassador}
                className="px-5 py-2.5 text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-gray-800 rounded-xl disabled:opacity-50 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => handleRevokeAmbassador(showRevokeAmbassador)}
                disabled={revokingAmbassador}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl disabled:opacity-50 transition-colors"
              >
                {revokingAmbassador ? "Revoking..." : t('admin.users.actions.revokeAmbassador')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Cancel Trial Modal */}
      {showCancelTrial && (
        <Modal onClose={() => setShowCancelTrial(null)} title={t('admin.users.cancelTrial.title')}>
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              {t('admin.users.cancelTrial.description')}
            </p>
            <p className="text-xs text-slate-500">
              {t('admin.users.cancelTrial.warning')}
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCancelTrial(null)} className="px-5 py-2.5 text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-gray-800 rounded-xl transition-colors">
                {t('common.cancel')}
              </button>
              <button
                onClick={() => handleCancelTrial(showCancelTrial)}
                disabled={cancellingTrial}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl disabled:opacity-50 transition-colors"
              >
                {cancellingTrial ? t('admin.users.cancelTrial.cancelling') : t('admin.users.cancelTrial.button')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showGrantTrial && (
        <Modal onClose={() => setShowGrantTrial(null)} title="Grant Trial">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Duration (days)</label>
              <input
                type="number"
                min={1}
                max={365}
                step={1}
                value={trialDuration}
                onChange={(e) => setTrialDuration(e.target.value)}
                autoFocus
                className="w-full h-11 px-3 rounded-xl border border-slate-700 text-sm bg-gray-800 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-colors"
              />
              <div className="flex flex-wrap gap-2 mt-2">
                {[7, 14, 20, 30].map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setTrialDuration(String(days))}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${trialDuration === String(days)
                      ? "border-indigo-500 bg-indigo-500/15 text-indigo-300"
                      : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200"
                      }`}
                  >
                    {days} days
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-2">
                This is an explicit admin grant. Signing in again will not restart the trial automatically.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowGrantTrial(null)} className="px-5 py-2.5 text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-gray-800 rounded-xl transition-colors">
                {t('common.cancel')}
              </button>
              <button
                onClick={() => handleGrantTrial(showGrantTrial)}
                disabled={grantingTrial}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl disabled:opacity-50 transition-colors"
              >
                {grantingTrial ? "Granting..." : "Grant Trial"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showExtendTrial && (
        <Modal onClose={() => setShowExtendTrial(null)} title="Extend Trial">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Extend by (days)</label>
              <input
                type="number"
                min={1}
                value={extendTrialDays}
                onChange={(e) => setExtendTrialDays(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-slate-700 text-sm bg-gray-800 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-colors"
                autoFocus
              />
              <p className="text-xs text-slate-500 mt-1.5">Enter any positive number of days to add to the current trial.</p>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowExtendTrial(null)} className="px-5 py-2.5 text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-gray-800 rounded-xl transition-colors">
                {t('common.cancel')}
              </button>
              <button
                onClick={() => handleExtendTrial(showExtendTrial)}
                disabled={extendingTrial || !extendTrialDays || parseInt(extendTrialDays) <= 0}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-xl disabled:opacity-50 transition-colors"
              >
                {extendingTrial ? "Extending..." : "Extend Trial"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
          <h3 className="text-sm font-semibold text-slate-50">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-xl text-slate-500 hover:text-slate-200 hover:bg-gray-800 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}
