/**
 * CreditsPage.tsx — Dedicated AI Credits & Usage Dashboard
 *
 * Professional, native desktop interface for monitoring AI credit balances,
 * usage telemetry across church features, historical consumption, and an
 * interactive service estimator.
 *
 * All formulas use backend-backed entitlements:
 *   totalAvailable = planAllocation + adminGranted
 *   remainingCredits = Math.max(0, totalAvailable - totalConsumed)
 *   usagePct = (totalConsumed / totalAvailable) * 100
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Zap,
  ArrowUpRight,
  BarChart3,
  Clock,
  CreditCard,
  TrendingUp,
  Radio,
  Globe,
  FileText,
  AlertTriangle,
  RefreshCw,
  Crown,
  Coins,
  Calculator,
  Layers,
  CloudOff,
  CheckCircle2,
} from "../components/icons/NativeIcons";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  fetchCreditDetails,
  fetchCreditTransactions,
  onCreditChange,
  getPendingCount,
  type CreditDetails,
  type CreditTransaction,
} from "../services/credits";
import {
  getPlanConfig,
  getPlanLabel,
  formatCredits,
  type PlanConfig,
} from "../services/planConfig";
import { useAuth } from "../contexts/AuthContext";
import { getCachedSubscription } from "../services/subscriptionCache";
import { resolveIsAdmin } from "../services/verifiedLicense";
import {
  getEffectivePlan,
  getTrialDaysRemaining,
  getUserPlan,
  isInTrial,
} from "../services/licenseService";
import { getDeviceId, getDeviceSecret } from "../services/authService";
import { openDashboardSubscriptionPlans } from "../services/subscriptionNavigation";
import "./CreditsPage.css";

// ── Feature icon & label mapping ──────────────────────────────────────────

const FEATURE_ICONS: Record<string, typeof Zap> = {
  "Speech-to-Scripture": Radio,
  "Transcript Translation": Globe,
  "Live Translation": Globe,
  "Translation": Globe,
  "AI Sermon Summary": FileText,
  "AI Sermon Notes": FileText,
  "AI Sermon Points": Zap,
  "Worship Import": FileText,
};

function getFeatureIcon(name: string): typeof Zap {
  return FEATURE_ICONS[name] ?? Zap;
}

const FEATURE_LABELS: Record<string, string> = {
  transcription: "Speech-to-Scripture",
  speech_to_scripture: "Speech-to-Scripture",
  translation: "Live Translation",
  ai_generation: "AI Generation",
  ai_summary: "AI Sermon Summary",
  ai_sermon_notes: "AI Sermon Notes",
  ai_sermon_points: "AI Sermon Points",
  worship_import_ai: "Worship Import",
};

function getFeatureUsageLabel(tx: CreditTransaction): string {
  const feature = typeof tx.metadata?.feature === "string" ? tx.metadata.feature : "";
  return FEATURE_LABELS[feature || ""]
    ?? FEATURE_LABELS[tx.source || ""]
    ?? (tx.source || tx.type).replace(/_/g, " ");
}

// ── Usage timeline API ───────────────────────────────────────────────────

interface UsageDay {
  date: string;
  creditsUsed?: number;
  amount?: number;
}

const API_BASE = import.meta.env.VITE_AUTH_API_URL || "https://api.makechurcheazy.com";

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const deviceId = getDeviceId();
  const deviceSecret = getDeviceSecret();
  if (deviceId) headers["X-Device-Id"] = deviceId;
  if (deviceSecret) headers["X-Device-Secret"] = deviceSecret;
  return headers;
}

async function fetchUsageTimeline(days: number): Promise<UsageDay[]> {
  try {
    const res = await fetch(`${API_BASE}/api/credit-transactions/stats?days=${days}`, {
      headers: authHeaders(),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data.usage)) return [];
    return data.usage.map((day: UsageDay) => ({
      date: day.date,
      creditsUsed: Number(day.creditsUsed ?? day.amount ?? 0),
    }));
  } catch {
    return [];
  }
}

// ── Date formatting helpers ──────────────────────────────────────────────

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatChartDate(dateStr: string): string {
  if (!dateStr) return "";
  // If dateStr is already e.g. "Sep 24", return it directly without reparsing
  if (/^[A-Za-z]{3}\s+\d{1,2}/.test(dateStr.trim())) {
    return dateStr.trim();
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Transaction type display ─────────────────────────────────────────────

function getTransactionLabel(tx: CreditTransaction): string {
  if (tx.description) return tx.description;
  switch (tx.type) {
    case "usage": return "AI Usage";
    case "admin_grant": return "Admin credit grant";
    case "allocation": return "Monthly credit allocation";
    case "credit_pack_purchase": return "Credit pack purchase";
    case "refund": return "Credit refund";
    case "subscription_renewal": return "Subscription renewal";
    default: return tx.type.replace(/_/g, " ");
  }
}

function getTransactionIcon(tx: CreditTransaction): typeof Zap {
  if (tx.amount > 0) {
    if (tx.type === "admin_grant" || tx.type === "credit_pack_purchase") return CreditCard;
    return TrendingUp;
  }
  const source = tx.source?.toLowerCase() || "";
  if (source.includes("transcription") || source.includes("speech")) return Radio;
  if (source.includes("translation")) return Globe;
  if (source.includes("summary") || source.includes("notes") || source.includes("points")) return FileText;
  return Zap;
}

// ── Main component ───────────────────────────────────────────────────────

export default function CreditsPage() {
  const { user: authUser } = useAuth();
  const cachedSub = getCachedSubscription();

  // ── State ──
  const [creditDetails, setCreditDetails] = useState<CreditDetails | null>(null);
  const [planConfig, setPlanConfig] = useState<PlanConfig | null>(null);
  const [recentTransactions, setRecentTransactions] = useState<CreditTransaction[]>([]);
  const [usageTimeline, setUsageTimeline] = useState<UsageDay[]>([]);
  const [chartRange, setChartRange] = useState<7 | 30>(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);

  // ── Service Estimator State ──
  const [servicesPerMonth, setServicesPerMonth] = useState<number>(4);
  const [sermonMinutes, setSermonMinutes] = useState<number>(40);
  const [enableTranslation, setEnableTranslation] = useState<boolean>(false);
  const [enableNotes, setEnableNotes] = useState<boolean>(true);

  // ── Plan & License Resolution ──
  const actualPlan = getUserPlan(authUser);
  const effectivePlanTier = getEffectivePlan(authUser);
  const trialActive = isInTrial(authUser);
  const trialDaysLeft = getTrialDaysRemaining(authUser);

  // ── Exact Credit Calculations ──
  const planAllocation = creditDetails?.planAllocation ?? 0;
  const adminGranted = creditDetails?.adminGranted ?? 0;
  const totalConsumed = creditDetails?.totalConsumed ?? 0;
  const currentBalance = creditDetails?.credits ?? 0;
  const isUnlimited = currentBalance === -1 || creditDetails?.unlimited === true;
  const isAdmin = creditDetails?.isAdmin ?? resolveIsAdmin(authUser?.role);

  // Total available pool = planAllocation + adminGranted (or backend totalAvailable)
  const totalAvailable = useMemo(() => {
    if (isUnlimited) return -1;
    if (typeof creditDetails?.totalAvailable === "number" && creditDetails.totalAvailable >= 0) {
      return creditDetails.totalAvailable;
    }
    return Math.max(0, planAllocation + adminGranted);
  }, [isUnlimited, creditDetails?.totalAvailable, planAllocation, adminGranted]);

  // Actual cycle usage: all consumed credits
  const cycleUsed = useMemo(() => {
    if (isUnlimited) return 0;
    return Math.max(0, totalConsumed);
  }, [isUnlimited, totalConsumed]);

  // Accurate usage percentage based on total available pool
  const usagePct = useMemo(() => {
    if (isUnlimited || totalAvailable <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round((cycleUsed / totalAvailable) * 100)));
  }, [isUnlimited, totalAvailable, cycleUsed]);

  // Formatted Plan Label
  const planLabel = useMemo(() => {
    if (isAdmin) return "Admin (Full Access)";
    if (trialActive) return "Growth Trial";
    if (planConfig) return getPlanLabel(planConfig, actualPlan);
    return effectivePlanTier.charAt(0).toUpperCase() + effectivePlanTier.slice(1);
  }, [isAdmin, trialActive, planConfig, actualPlan, effectivePlanTier]);

  // Accurate renewal/reset label
  const renewalOrResetLabel = useMemo(() => {
    if (isUnlimited) return "Unlimited active";
    if (trialActive && trialDaysLeft > 0) {
      return `Trial ends in ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"}`;
    }
    const expiresAt = cachedSub?.payload?.expiresAt || (authUser as any)?.subscription?.current_period_end;
    if (expiresAt) {
      const d = new Date(expiresAt);
      if (!isNaN(d.getTime())) {
        return `Renews ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
      }
    }
    const d = new Date();
    d.setMonth(d.getMonth() + 1, 1);
    return `Resets ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  }, [isUnlimited, trialActive, trialDaysLeft, cachedSub, authUser]);

  // Low credit threshold: < 20% remaining
  const isLow = useMemo(() => {
    if (isUnlimited || isAdmin) return false;
    if (totalAvailable <= 0) return currentBalance <= 5;
    return (currentBalance / totalAvailable) < 0.2;
  }, [isUnlimited, isAdmin, currentBalance, totalAvailable]);

  const isZero = !isUnlimited && !isAdmin && currentBalance <= 0;

  // Credit costs table
  const creditCosts = useMemo(() => {
    if (!planConfig) return [];
    return planConfig.creditCosts;
  }, [planConfig]);

  // ── Aggregated feature usage with proportional shares ──
  const featureUsage = useMemo(() => {
    const map = new Map<string, { label: string; credits: number; count: number }>();
    for (const tx of recentTransactions) {
      if (tx.amount >= 0) continue; // deductions only
      const metadataFeature = typeof tx.metadata?.feature === "string" ? tx.metadata.feature : "";
      const key = metadataFeature || tx.source || tx.type;
      const existing = map.get(key) ?? { label: getFeatureUsageLabel(tx), credits: 0, count: 0 };
      existing.credits += Math.abs(tx.amount);
      existing.count += 1;
      map.set(key, existing);
    }
    const totalFeatureCredits = Array.from(map.values()).reduce((sum, f) => sum + f.credits, 0);
    return Array.from(map.entries())
      .map(([key, val]) => ({
        key,
        ...val,
        sharePct: totalFeatureCredits > 0 ? Math.min(100, Math.round((val.credits / totalFeatureCredits) * 100)) : 0,
      }))
      .sort((a, b) => b.credits - a.credits);
  }, [recentTransactions]);

  // ── Interactive Service Estimator Calculation ──
  const estimatedCredits = useMemo(() => {
    // Audio: 1 credit per minute
    const audioCreditsPerService = sermonMinutes * 1;
    // Live Translation: ~2000 words per sermon = 2000 / 150 ~= 14 credits
    const translationCreditsPerService = enableTranslation ? Math.ceil(2000 / 150) : 0;
    // AI Sermon notes + summary: 8 credits
    const notesCreditsPerService = enableNotes ? 8 : 0;

    const totalPerService = audioCreditsPerService + translationCreditsPerService + notesCreditsPerService;
    const monthlyTotal = totalPerService * servicesPerMonth;

    let recommendedPlan = "Free (25 credits)";
    if (monthlyTotal > 500) {
      recommendedPlan = "Growth + Credit Top-up";
    } else if (monthlyTotal > 100) {
      recommendedPlan = "Growth Plan (500 credits)";
    } else if (monthlyTotal > 25) {
      recommendedPlan = "Basic Plan (100 credits)";
    }

    return {
      monthlyTotal,
      audioCreditsPerService,
      translationCreditsPerService,
      notesCreditsPerService,
      recommendedPlan,
    };
  }, [servicesPerMonth, sermonMinutes, enableTranslation, enableNotes]);

  // ── Chart data ──
  const chartData = useMemo(() => {
    if (usageTimeline.length === 0) return [];
    return usageTimeline.map((day) => ({
      date: formatChartDate(day.date),
      credits: day.creditsUsed ?? day.amount ?? 0,
    }));
  }, [usageTimeline]);

  // ── Data fetching ──
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [details, config, txs, timeline] = await Promise.all([
        fetchCreditDetails(),
        getPlanConfig(),
        fetchCreditTransactions(100),
        fetchUsageTimeline(chartRange),
      ]);
      if (details) setCreditDetails(details);
      setPlanConfig(config);
      setRecentTransactions(txs);
      setUsageTimeline(timeline);
      setPendingSyncCount(getPendingCount());
    } catch {
      setError("Unable to load credit telemetry. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, [chartRange]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Refresh chart when range changes
  useEffect(() => {
    fetchUsageTimeline(chartRange).then(setUsageTimeline);
  }, [chartRange]);

  // Listen for live credit changes
  useEffect(() => {
    const unsub = onCreditChange((newBalance) => {
      setCreditDetails((prev) => {
        if (!prev) return prev;
        const diff = prev.credits - newBalance;
        const newConsumed = diff > 0 ? prev.totalConsumed + diff : prev.totalConsumed;
        return {
          ...prev,
          credits: newBalance,
          totalConsumed: newConsumed,
        };
      });
      setPendingSyncCount(getPendingCount());
      void Promise.all([
        fetchCreditTransactions(100),
        fetchUsageTimeline(chartRange),
      ]).then(([transactions, timeline]) => {
        setRecentTransactions(transactions);
        setUsageTimeline(timeline);
      });
    });
    return unsub;
  }, [chartRange]);

  // ── External CTAs ──
  const handleComparePlans = useCallback(() => {
    void openDashboardSubscriptionPlans();
  }, []);

  const handleTopUp = useCallback(() => {
    window.open("https://makechurcheazy.com/credits", "_blank", "noopener,noreferrer");
  }, []);

  const handleViewAll = useCallback(() => {
    window.open("https://makechurcheazy.com/billing/history?type=credits", "_blank", "noopener,noreferrer");
  }, []);

  if (error && !loading) {
    return (
      <div className="credits-page">
        <header className="credits-header">
          <div>
            <h1 className="credits-title">AI Credits & Usage</h1>
            <p className="credits-subtitle">Real-time balance, consumption telemetry, and plan limits.</p>
          </div>
        </header>
        <div className="credits-error-card">
          <AlertTriangle size={24} className="credits-error-icon" />
          <div className="credits-error-content">
            <h4>Failed to load credits</h4>
            <p>{error}</p>
          </div>
          <button className="credits-btn credits-btn--primary" onClick={loadData}>
            <RefreshCw size={14} /> Retry Sync
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="credits-page">
      {/* ── Native Desktop Header ── */}
      <header className="credits-header">
        <div className="credits-header-left">
          <div className="credits-title-row">
            <h1 className="credits-title">AI Credits & Telemetry</h1>
            <span className={`credits-plan-badge ${trialActive ? "credits-plan-badge--trial" : ""}`}>
              <Crown size={12} />
              {planLabel}
            </span>
            {pendingSyncCount > 0 && (
              <span className="credits-pending-badge" title={`${pendingSyncCount} transactions stored locally pending server sync`}>
                <CloudOff size={11} /> {pendingSyncCount} offline queued
              </span>
            )}
          </div>
          <p className="credits-subtitle">
            Monitors real-time credit consumption for Speech-to-Scripture, live translation, and sermon generation.
          </p>
        </div>

        <div className="credits-header-actions">
          <button
            className="credits-btn credits-btn--ghost"
            onClick={loadData}
            disabled={loading}
            title="Refresh balance and logs from server"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            <span>Sync</span>
          </button>
          <button
            className="credits-btn credits-btn--secondary"
            onClick={handleComparePlans}
            title="View plan tiers and allocations"
          >
            <Layers size={13} />
            <span>Compare Plans</span>
          </button>
          <button
            className="credits-btn credits-btn--primary"
            onClick={handleTopUp}
            title="Purchase additional credit pack"
          >
            <Zap size={13} />
            <span>Top Up Credits</span>
          </button>
        </div>
      </header>

      {/* ── Top Metrics Grid ── */}
      <section className="credits-metrics-grid" aria-label="Key credit metrics">
        {/* Metric 1: Current Balance */}
        <div className={`credits-metric-card ${isLow ? "credits-metric-card--warning" : ""} ${isZero ? "credits-metric-card--danger" : ""}`}>
          <div className="credits-metric-header">
            <span className="credits-metric-label">Remaining Balance</span>
            <div className="credits-metric-icon-wrap credits-metric-icon-wrap--accent">
              <Coins size={16} />
            </div>
          </div>
          <div className="credits-metric-value-row">
            <span className="credits-metric-number">
              {loading ? "..." : (isUnlimited ? "Unlimited" : formatCredits(currentBalance))}
            </span>
            {!isUnlimited && <span className="credits-metric-unit">credits</span>}
          </div>
          <div className="credits-metric-footer">
            {isUnlimited ? (
              <span className="credits-metric-subtext credits-metric-subtext--highlight">
                <CheckCircle2 size={12} /> Unlimited AI speech & translation
              </span>
            ) : (
              <span className="credits-metric-subtext">
                {adminGranted > 0
                  ? `${formatCredits(planAllocation)} plan + ${formatCredits(adminGranted)} top-up (${formatCredits(totalAvailable)} total)`
                  : `of ${formatCredits(totalAvailable)} total allocated this cycle`}
              </span>
            )}
          </div>
        </div>

        {/* Metric 2: Cycle Usage */}
        <div className="credits-metric-card">
          <div className="credits-metric-header">
            <span className="credits-metric-label">Used This Billing Cycle</span>
            <div className="credits-metric-icon-wrap">
              <TrendingUp size={16} />
            </div>
          </div>
          <div className="credits-metric-value-row">
            <span className="credits-metric-number">
              {loading ? "..." : (isUnlimited ? "—" : formatCredits(cycleUsed))}
            </span>
            {!isUnlimited && <span className="credits-metric-unit">credits consumed</span>}
          </div>
          <div className="credits-metric-footer">
            {!isUnlimited && totalAvailable > 0 ? (
              <div className="credits-progress-wrapper">
                <div className="credits-progress-track">
                  <div className="credits-progress-bar" style={{ width: `${usagePct}%` }} />
                </div>
                <div className="credits-progress-meta">
                  <span>{usagePct}% consumed</span>
                  <span>{renewalOrResetLabel}</span>
                </div>
              </div>
            ) : (
              <span className="credits-metric-subtext">{renewalOrResetLabel}</span>
            )}
          </div>
        </div>

        {/* Metric 3: Active Tier Status */}
        <div className="credits-metric-card">
          <div className="credits-metric-header">
            <span className="credits-metric-label">Production Tier</span>
            <div className="credits-metric-icon-wrap credits-metric-icon-wrap--gold">
              <Crown size={16} />
            </div>
          </div>
          <div className="credits-metric-value-row">
            <span className="credits-metric-number credits-metric-number--sm">{planLabel}</span>
          </div>
          <div className="credits-metric-footer credits-metric-footer--tier">
            {trialActive ? (
              <span className="credits-tier-trial-text">
                {trialDaysLeft > 0 ? `${trialDaysLeft} days remaining in trial` : "Trial expired"}
              </span>
            ) : (
              <span className="credits-metric-subtext">
                {actualPlan === "free" ? "25 monthly credits included" : "High-priority transcription pipeline"}
              </span>
            )}
            <button className="credits-inline-link" onClick={handleComparePlans}>
              Manage Tier <ArrowUpRight size={11} />
            </button>
          </div>
        </div>
      </section>

      {/* ── Main Two-Column Viewport ── */}
      <div className="credits-viewport-split">
        {/* Left Column: Breakdown + Estimator */}
        <div className="credits-column">
          {/* Feature Breakdown Card */}
          <div className="credits-card">
            <div className="credits-card-header">
              <div className="credits-card-title-group">
                <BarChart3 size={15} className="credits-card-title-icon" />
                <h3 className="credits-card-title">Consumption by AI Tool</h3>
              </div>
              <span className="credits-card-tag">{featureUsage.length} features tracked</span>
            </div>

            {featureUsage.length === 0 ? (
              <div className="credits-empty-state">
                <p>No feature deductions recorded yet.</p>
                <span className="credits-empty-sub">
                  Credits are automatically tracked whenever speech transcription, live translation, or sermon AI notes are generated.
                </span>
              </div>
            ) : (
              <div className="credits-feature-list">
                {featureUsage.map((feat) => {
                  const Icon = getFeatureIcon(feat.label);
                  return (
                    <div key={feat.key} className="credits-feature-item">
                      <div className="credits-feature-left">
                        <div className="credits-feature-icon-box">
                          <Icon size={14} />
                        </div>
                        <div className="credits-feature-meta">
                          <span className="credits-feature-name">{feat.label}</span>
                          <span className="credits-feature-count">{feat.count} execution{feat.count === 1 ? "" : "s"}</span>
                        </div>
                      </div>

                      <div className="credits-feature-right">
                        <div className="credits-feature-bar-container" title={`${feat.sharePct}% of all AI deductions`}>
                          <div className="credits-feature-bar-fill" style={{ width: `${feat.sharePct}%` }} />
                        </div>
                        <span className="credits-feature-value">-{feat.credits}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Interactive Church Usage Estimator */}
          <div className="credits-card credits-estimator-card">
            <div className="credits-card-header">
              <div className="credits-card-title-group">
                <Calculator size={15} className="credits-card-title-icon" />
                <h3 className="credits-card-title">Church Service Credit Estimator</h3>
              </div>
              <span className="credits-card-tag credits-card-tag--estimator">Interactive</span>
            </div>
            <p className="credits-card-desc">
              Calculate the exact credits needed for your church's weekly sermon audio and live translation schedule.
            </p>

            <div className="credits-estimator-controls">
              {/* Slider 1: Services per month */}
              <div className="credits-estimator-row">
                <div className="credits-estimator-label-group">
                  <label className="credits-estimator-label">Sunday Services / Month</label>
                  <span className="credits-estimator-sublabel">Services recorded or transcribed</span>
                </div>
                <div className="credits-estimator-stepper">
                  <button
                    type="button"
                    className="credits-stepper-btn"
                    onClick={() => setServicesPerMonth((s) => Math.max(1, s - 1))}
                  >
                    -
                  </button>
                  <span className="credits-stepper-val">{servicesPerMonth}</span>
                  <button
                    type="button"
                    className="credits-stepper-btn"
                    onClick={() => setServicesPerMonth((s) => Math.min(20, s + 1))}
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Slider 2: Average Sermon Length */}
              <div className="credits-estimator-row">
                <div className="credits-estimator-label-group">
                  <label className="credits-estimator-label">Average Sermon Duration</label>
                  <span className="credits-estimator-sublabel">1 credit per audio minute</span>
                </div>
                <div className="credits-estimator-slider-wrap">
                  <input
                    type="range"
                    min={15}
                    max={90}
                    step={5}
                    value={sermonMinutes}
                    onChange={(e) => setSermonMinutes(Number(e.target.value))}
                    className="credits-range-slider"
                  />
                  <span className="credits-slider-val">{sermonMinutes} min</span>
                </div>
              </div>

              {/* Toggle 1: Live Translation */}
              <div className="credits-estimator-toggle-row">
                <div className="credits-estimator-label-group">
                  <label className="credits-estimator-label">Live Multi-Language Translation</label>
                  <span className="credits-estimator-sublabel">~2,000 words per sermon (~14 credits)</span>
                </div>
                <label className="credits-switch">
                  <input
                    type="checkbox"
                    checked={enableTranslation}
                    onChange={(e) => setEnableTranslation(e.target.checked)}
                  />
                  <span className="credits-switch-slider" />
                </label>
              </div>

              {/* Toggle 2: AI Notes & Summary */}
              <div className="credits-estimator-toggle-row">
                <div className="credits-estimator-label-group">
                  <label className="credits-estimator-label">AI Notes, Points & Summary</label>
                  <span className="credits-estimator-sublabel">Instant bulletin & study notes (~8 credits)</span>
                </div>
                <label className="credits-switch">
                  <input
                    type="checkbox"
                    checked={enableNotes}
                    onChange={(e) => setEnableNotes(e.target.checked)}
                  />
                  <span className="credits-switch-slider" />
                </label>
              </div>
            </div>

            {/* Estimator Result Box */}
            <div className="credits-estimator-summary">
              <div className="credits-estimator-summary-left">
                <span className="credits-estimator-summary-title">Estimated Monthly Demand</span>
                <span className="credits-estimator-summary-val">{estimatedCredits.monthlyTotal} Credits</span>
              </div>
              <div className="credits-estimator-summary-right">
                <span className="credits-estimator-plan-badge">
                  {estimatedCredits.recommendedPlan}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Chart + Rate Card */}
        <div className="credits-column">
          {/* Usage Chart Card */}
          <div className="credits-card">
            <div className="credits-card-header">
              <div className="credits-card-title-group">
                <TrendingUp size={15} className="credits-card-title-icon" />
                <h3 className="credits-card-title">Daily Consumption History</h3>
              </div>
              <div className="credits-chart-range-pills">
                <button
                  type="button"
                  className={`credits-chart-pill ${chartRange === 7 ? "active" : ""}`}
                  onClick={() => setChartRange(7)}
                >
                  7 Days
                </button>
                <button
                  type="button"
                  className={`credits-chart-pill ${chartRange === 30 ? "active" : ""}`}
                  onClick={() => setChartRange(30)}
                >
                  30 Days
                </button>
              </div>
            </div>

            {chartData.length === 0 || chartData.every((d) => d.credits === 0) ? (
              <div className="credits-empty-chart">
                <BarChart3 size={32} className="credits-empty-icon" />
                <p>No credit deductions in this window.</p>
                <span className="credits-empty-sub">Daily usage will populate as live services stream and transcribe.</span>
              </div>
            ) : (
              <div className="credits-chart-container">
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={chartData} barCategoryGap="22%">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 13, fill: "var(--text-muted)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 13, fill: "var(--text-muted)" }}
                      axisLine={false}
                      tickLine={false}
                      width={32}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--surface)",
                        border: "1px solid var(--border-strong)",
                        borderRadius: "8px",
                        fontSize: "14px",
                        boxShadow: "0 10px 25px rgba(0, 0, 0, 0.5)",
                        color: "var(--text-primary)",
                      }}
                      formatter={((value: any) => [`${value} credits`, "Used"]) as any}
                    />
                    <Bar
                      dataKey="credits"
                      fill="var(--primary)"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Official Rate Reference Card */}
          <div className="credits-card">
            <div className="credits-card-header">
              <div className="credits-card-title-group">
                <Zap size={15} className="credits-card-title-icon" />
                <h3 className="credits-card-title">Official AI Consumption Rates</h3>
              </div>
            </div>
            <div className="credits-rate-table">
              {(creditCosts.length > 0 ? creditCosts : [
                { name: "Speech-to-Scripture", cost: 1, unit: "1 min audio" },
                { name: "Live Translation", cost: 1, unit: "150 words" },
                { name: "AI Sermon Summary", cost: 5, unit: "full sermon" },
                { name: "AI Sermon Notes", cost: 5, unit: "bulletin export" },
                { name: "AI Sermon Points", cost: 3, unit: "key takeaways" },
              ]).map((cost) => (
                <div key={cost.name} className="credits-rate-row">
                  <div className="credits-rate-info">
                    <span className="credits-rate-name">{cost.name}</span>
                    <span className="credits-rate-unit">per {cost.unit}</span>
                  </div>
                  <span className="credits-rate-pill">
                    {cost.cost} credit{cost.cost !== 1 ? "s" : ""}
                  </span>
                </div>
              ))}
            </div>
            <div className="credits-free-notice">
              <CheckCircle2 size={13} className="credits-free-icon" />
              <span>
                OBS scene projection, Scripture searching, offline worship lyrics, and lower-thirds are 100% free and never consume credits.
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom Section: Transaction Audit Ledger ── */}
      <section className="credits-card credits-ledger-card">
        <div className="credits-card-header">
          <div className="credits-card-title-group">
            <Clock size={15} className="credits-card-title-icon" />
            <h3 className="credits-card-title">Audit Ledger & Transaction History</h3>
          </div>
          {recentTransactions.length > 0 && (
            <button className="credits-view-all-btn" onClick={handleViewAll}>
              Full Billing History <ArrowUpRight size={12} />
            </button>
          )}
        </div>

        {recentTransactions.length === 0 ? (
          <div className="credits-empty-state">
            <Clock size={28} className="credits-empty-icon" />
            <p>No transactions found in this account.</p>
            <span className="credits-empty-sub">
              Deductions, plan allocations, and admin credit grants will appear here chronologically.
            </span>
          </div>
        ) : (
          <div className="credits-ledger-table-wrap">
            <table className="credits-ledger-table">
              <thead>
                <tr>
                  <th>Activity / Feature</th>
                  <th>Transaction Type</th>
                  <th>Timestamp</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {recentTransactions.slice(0, 10).map((tx) => {
                  const Icon = getTransactionIcon(tx);
                  const isDeduction = tx.amount < 0;
                  return (
                    <tr key={tx._id || tx.createdAt}>
                      <td>
                        <div className="credits-ledger-activity">
                          <div className={`credits-ledger-icon-box ${isDeduction ? "deduction" : "credit"}`}>
                            <Icon size={13} />
                          </div>
                          <span className="credits-ledger-title" title={tx.description || getTransactionLabel(tx)}>
                            {getTransactionLabel(tx)}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className="credits-type-badge">
                          {tx.type.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="credits-ledger-time">
                        {formatRelativeDate(tx.createdAt)}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <span className={`credits-ledger-amount ${isDeduction ? "deduction" : "credit"}`}>
                          {tx.amount > 0 ? "+" : ""}{tx.amount}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
