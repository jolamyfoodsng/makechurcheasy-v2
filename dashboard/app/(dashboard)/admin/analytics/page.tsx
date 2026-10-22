"use client";

import { UsageAnalyticsSection } from "@/components/admin/UsageAnalytics";
import { useEffect, useState } from "react";
import {
  TrendingUp,
  Users,
  Church,
  Globe,
  CreditCard,
  Award,
  BookOpen,
  Music,
  Monitor,
  FileText,
  ChevronDown,
  ChevronRight,
  Zap,
  BarChart3,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { getCountryDisplayName } from "@/lib/countryDisplay";

// ── Types ────────────────────────────────────────────────────────────────────

interface BusinessAnalytics {
  overview: {
    totalUsers: number;
    activeUsers: number;
    paidSubscribers: number;
    ambassadors: number;
    totalChurches: number;
    countriesRepresented: number;
    conversionRate: number;
  };
  countryDistribution: { country: string; count: number; percentage: number }[];
  countryCoverage: {
    represented: number;
    supported: number;
    percentage: number;
    usersWithoutCountry: number;
  };
  genderDistribution: { gender: string; count: number; percentage: number }[];
  churchSizeDistribution: { range: string; count: number; percentage: number }[];
  dataHealth: {
    usersWithoutCountry: number;
    usersWithoutGender: number;
    usersWithCountry: number;
    usersWithGender: number;
    churchProfiles: number;
  };
  church: { total: number; newThisMonth: number; growth: number };
  ambassadors: { active: number; expired: number; expiringSoon: number };
  subscriptions: {
    plan: string;
    tier: string;
    count: number;
  }[];
  credits: {
    totalConsumed: number;
    totalGranted: number;
    totalRefunded: number;
    transactionCount: number;
  };
  content: {
    totalSongs: number;
    totalMedia: number;
    totalThemes: number;
    totalTranscripts: number;
  };
  userGrowthChart: { month: string; count: number }[];
  churchGrowthChart: { month: string; count: number }[];
}

type PaymentProviderStatus =
  | "connected"
  | "partial"
  | "not_configured"
  | "test_mode"
  | "unauthorized"
  | "unavailable";

interface GatewayPayments {
  periodDays: number;
  historyStart: string;
  updatedAt: string;
  providers: Record<"flutterwave" | "paystack", {
    status: PaymentProviderStatus;
    successfulTransactions: number;
  }>;
  currencies: Array<{
    currency: string;
    transactionCount: number;
    amount: number;
    settledTransactionCount: number;
    settledAmount: number | null;
    byProvider: Record<"flutterwave" | "paystack", { transactionCount: number; amount: number }>;
    settlementByProvider: Record<"flutterwave" | "paystack", { transactionCount: number; amount: number | null }>;
    monthly: Array<{ month: string; transactionCount: number; amount: number; settledTransactionCount: number; settledAmount: number | null }>;
  }>;
}

interface ProductAnalytics {
  featureUsage: {
    bibleSearches: number;
    worshipPresentations: number;
    mediaPresentations: number;
    voiceSessions: number;
    transcriptViews: number;
    themesCreated: number;
  };
  signupChart: { date: string; signups: number }[];
  revenueChart: { date: string; revenue: number }[];
  retentionData: { date: string; value: number }[];
  bibleAnalytics: {
    mostUsedVersions: { name: string; count: number }[];
    totalBibleSessions: number;
  };
  worshipAnalytics: {
    songsCreated: number;
    songsImported: number;
    totalWorshipSlides: number;
  };
  mediaAnalytics: {
    imagesUploaded: number;
    mediaPresentations: number;
  };
  transcriptAnalytics: {
    totalTranscripts: number;
    exportsGenerated: number;
    translationsGenerated: number;
  };
}

interface AnalyticsResponse {
  business: BusinessAnalytics;
  product: ProductAnalytics;
  payments: GatewayPayments;
}

// ── Reusable sub-components ──────────────────────────────────────────────────

function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-2xl bg-gray-800 ${className ?? ""}`}
    />
  );
}

function SectionHeader({
  icon: Icon,
  iconColor,
  title,
  description,
}: {
  icon: React.ElementType;
  iconColor: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div
        className={`w-9 h-9 rounded-xl flex items-center justify-center ${iconColor}`}
      >
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <h2 className="text-base font-semibold text-slate-50">{title}</h2>
        {description && (
          <p className="text-[11px] text-slate-500 mt-0.5">{description}</p>
        )}
      </div>
    </div>
  );
}

function OverviewCard({
  icon: Icon,
  iconColor,
  label,
  value,
}: {
  icon: React.ElementType;
  iconColor: string;
  label: string;
  value: number | undefined;
}) {
  return (
    <div className="rounded-2xl bg-gray-900 border border-slate-700 p-5 transition-colors hover:border-slate-600">
      <div className="flex items-center gap-2 mb-3">
        <div
          className={`w-8 h-8 rounded-xl flex items-center justify-center ${iconColor}`}
        >
          <Icon className="w-4 h-4" />
        </div>
        <span className="text-[11px] text-slate-400 uppercase tracking-wide font-medium">
          {label}
        </span>
      </div>
      <p className="text-2xl font-bold text-slate-50 tracking-tight">
        {value != null ? value.toLocaleString() : "—"}
      </p>
    </div>
  );
}

function ChartCard({
  title,
  children,
  loading,
}: {
  title: string;
  children: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="rounded-2xl bg-gray-900 border border-slate-700 p-6">
      <h3 className="text-base font-semibold text-slate-50 mb-4">{title}</h3>
      {loading ? <SkeletonBlock className="h-[280px]" /> : children}
    </div>
  );
}

function BarChartSimple({
  data,
  dataKey,
  labelKey,
  height = 280,
  barColor = "#818CF8",
}: {
  data?: { [key: string]: string | number }[];
  dataKey: string;
  labelKey: string;
  height?: number;
  barColor?: string;
}) {
  const chartData = data ?? [];

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis
          dataKey={labelKey}
          stroke="#64748B"
          fontSize={11}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          stroke="#64748B"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#1F2937",
            border: "1px solid #334155",
            borderRadius: "12px",
            color: "#F8FAFC",
            fontSize: "13px",
          }}
          labelStyle={{ color: "#94A3B8" }}
          cursor={{ fill: "rgba(129,140,248,0.08)" }}
        />
        <Bar dataKey={dataKey} radius={[6, 6, 0, 0]} maxBarSize={32}>
          {chartData.map((_, i) => (
            <Cell key={i} fill={barColor} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function FeatureBar({
  icon,
  label,
  value,
  max,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  max: number;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 bg-gray-800 rounded-xl flex items-center justify-center text-slate-400 shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-slate-400 font-medium">{label}</span>
          <span className="text-xs font-bold text-slate-50">
            {value.toLocaleString()}
          </span>
        </div>
        <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-500 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-slate-400">{label}</span>
      <span className="text-xs font-bold text-slate-50">{value}</span>
    </div>
  );
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatPercent(value: unknown): string {
  const percent = toFiniteNumber(value);
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}

function DistributionPanel({
  title,
  subtitle,
  items,
  emptyLabel,
  barClassName = "bg-indigo-500",
}: {
  title: string;
  subtitle?: string;
  items: { label: string; count?: number | null; percentage?: number | null }[];
  emptyLabel: string;
  barClassName?: string;
}) {
  return (
    <div className="rounded-2xl bg-gray-900 border border-slate-700 p-6">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-slate-50">{title}</h3>
        {subtitle && <p className="text-[11px] text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-8">{emptyLabel}</p>
      ) : (
        <div className="space-y-3">
          {items.slice(0, 10).map((item) => {
            const count = toFiniteNumber(item.count);
            const percentage = toFiniteNumber(item.percentage);

            return (
              <div key={item.label} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-300 truncate">{item.label}</span>
                  <span className="text-xs font-semibold text-slate-50 shrink-0">
                    {count.toLocaleString()} · {formatPercent(percentage)}
                  </span>
                </div>
                <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${barClassName}`}
                    style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-12 h-12 rounded-2xl bg-gray-800 flex items-center justify-center mb-4">
        <Icon className="w-6 h-6 text-slate-500" />
      </div>
      <p className="text-sm font-medium text-slate-400">{title}</p>
      <p className="text-xs text-slate-500 mt-1 max-w-[260px]">
        {description}
      </p>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AdminAnalyticsPage() {
  const t = useTranslations();
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState(30);
  const [productOpen, setProductOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError("");
    fetch(`/api/admin/analytics?period=${period}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Analytics request failed with ${r.status}`))))
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load analytics"))
      .finally(() => setLoading(false));
  }, [period]);

  const biz = data?.business;
  const prod = data?.product;
  const payments = data?.payments;
  const hasData = biz != null;

  const formatPaymentAmount = (amount: number, currency: string) => {
    const currencyDigits = new Intl.NumberFormat("en", { style: "currency", currency })
      .resolvedOptions().maximumFractionDigits ?? 2;
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      maximumFractionDigits: Math.max(2, currencyDigits),
    }).format(amount);
  };

  const providerStatusLabel: Record<PaymentProviderStatus, string> = {
    connected: "Connected",
    partial: "History limit reached",
    not_configured: "Not configured",
    test_mode: "Test key ignored",
    unauthorized: "Key rejected",
    unavailable: "Unavailable",
  };

  const providerStatuses = payments ? [
    ["Flutterwave", payments.providers.flutterwave],
    ["Paystack", payments.providers.paystack],
  ] as const : [];
  const hasGatewayData = providerStatuses.some(([, provider]) =>
    provider.status === "connected" || provider.status === "partial",
  );

  const featureUsage = prod?.featureUsage;
  const featureMax = featureUsage
    ? Math.max(
      featureUsage.bibleSearches || 1,
      featureUsage.worshipPresentations || 1,
      featureUsage.mediaPresentations || 1,
      featureUsage.transcriptViews || 1,
      featureUsage.themesCreated || 1,
    )
    : 1;

  const hasBusinessData =
    biz &&
    (biz.overview.totalUsers > 0 ||
      biz.overview.totalChurches > 0 ||
      biz.overview.paidSubscribers > 0 ||
      (payments?.currencies.length ?? 0) > 0);

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1400px] mx-auto">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-50">
            {t("admin.analytics.title")}
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            {t("admin.analytics.description")}
          </p>
        </div>
        <select
          value={period}
          onChange={(e) => setPeriod(parseInt(e.target.value))}
          className="h-11 px-3 rounded-xl border border-slate-700 text-sm bg-gray-800 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-colors"
        >
          <option value={7}>{t("admin.analytics.last7Days")}</option>
          <option value={30}>{t("admin.analytics.last30Days")}</option>
          <option value={90}>{t("admin.analytics.last90Days")}</option>
        </select>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      {/* ── App usage: pages opened and buttons clicked, by person ──── */}
      <UsageAnalyticsSection />

      {/* ── Empty State ────────────────────────────────────────────── */}
      {!loading && !error && !hasBusinessData && (
        <EmptyState
          icon={BarChart3}
          title={t("admin.analytics.noData")}
          description={t("admin.analytics.noDataDescription")}
        />
      )}

      {/* ═══════════════════════════════════════════════════════════════
          BUSINESS ANALYTICS
          ═══════════════════════════════════════════════════════════════ */}
      {hasBusinessData && (
        <>
          <SectionHeader
            icon={TrendingUp}
            iconColor="bg-indigo-500/15 text-indigo-400"
            title={t("admin.analytics.businessAnalytics")}
            description={t("admin.analytics.businessDescription")}
          />

          {/* ── Overview Cards (6-up) ──────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <SkeletonBlock key={i} className="min-h-[110px]" />
              ))
            ) : (
              <>
                <OverviewCard
                  icon={Users}
                  iconColor="bg-indigo-500/15 text-indigo-400"
                  label={t("admin.analytics.totalUsers")}
                  value={biz?.overview?.totalUsers}
                />
                <OverviewCard
                  icon={Church}
                  iconColor="bg-emerald-500/15 text-emerald-400"
                  label={t("admin.analytics.totalChurches")}
                  value={biz?.overview?.totalChurches}
                />
                <OverviewCard
                  icon={Globe}
                  iconColor="bg-cyan-500/15 text-cyan-400"
                  label={t("admin.analytics.countries")}
                  value={biz?.overview?.countriesRepresented}
                />
                <OverviewCard
                  icon={CreditCard}
                  iconColor="bg-amber-500/15 text-amber-400"
                  label={t("admin.analytics.paidSubscribers")}
                  value={biz?.overview?.paidSubscribers}
                />
                <OverviewCard
                  icon={Award}
                  iconColor="bg-rose-500/15 text-rose-400"
                  label={t("admin.analytics.ambassadors")}
                  value={biz?.overview?.ambassadors}
                />
              </>
            )}
          </div>

          {/* ── KPI Row ────────────────────────────────────────────── */}
          {!loading && biz && (
            <div className="grid grid-cols-2 md:grid-cols-2 gap-4">
              <div className="rounded-2xl bg-gray-900 border border-slate-700 p-4">
                <p className="text-[11px] text-slate-500 uppercase tracking-wide font-medium">
                  {t("admin.analytics.activeUsers30d")}
                </p>
                <p className="text-xl font-bold text-slate-50 mt-1">
                  {biz.overview.activeUsers.toLocaleString()}
                </p>
              </div>
              <div className="rounded-2xl bg-gray-900 border border-slate-700 p-4">
                <p className="text-[11px] text-slate-500 uppercase tracking-wide font-medium">
                  {t("admin.analytics.conversionRate")}
                </p>
                <p className="text-xl font-bold text-slate-50 mt-1">
                  {biz.overview.conversionRate}%
                </p>
              </div>
            </div>
          )}

          {/* ── Growth Charts ──────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ChartCard
              title={t("admin.analytics.userGrowth")}
              loading={loading}
            >
              <BarChartSimple
                data={biz?.userGrowthChart}
                dataKey="count"
                labelKey="month"
              />
            </ChartCard>
            <ChartCard
              title={t("admin.analytics.churchGrowth")}
              loading={loading}
            >
              <BarChartSimple
                data={biz?.churchGrowthChart}
                dataKey="count"
                labelKey="month"
                barColor="#34D399"
              />
            </ChartCard>
          </div>

          {/* ── Gateway Payments ───────────────────────────────────── */}
          <section className="space-y-4">
            <div className="rounded-2xl bg-gray-900 border border-slate-700 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-50">Successful payment amounts</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Successful transaction amounts in the last {payments?.periodDays ?? period} days. Totals stay separate by currency.
                  </p>
                </div>
                {payments?.updatedAt && (
                  <span className="text-[11px] text-slate-500">
                    Updated {new Date(payments.updatedAt).toLocaleString()}
                  </span>
                )}
              </div>
              {loading ? (
                <SkeletonBlock className="h-[100px]" />
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                    {providerStatuses.map(([name, provider]) => (
                      <div key={name} className="flex items-center justify-between rounded-xl bg-gray-800/70 px-4 py-3">
                        <span className="text-sm text-slate-300">{name}</span>
                        <span className={`text-xs font-medium ${provider.status === "connected" ? "text-emerald-400" : provider.status === "partial" ? "text-amber-300" : "text-slate-400"}`}>
                          {providerStatusLabel[provider.status]} · {provider.successfulTransactions.toLocaleString()} successful in 12 months
                        </span>
                      </div>
                    ))}
                  </div>
                  {payments?.currencies.length ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                      {payments.currencies.map((summary) => (
                        <div key={summary.currency} className="rounded-xl border border-slate-700 bg-gray-800/40 p-4">
                          <p className="text-xs text-slate-400">{summary.currency} · {summary.transactionCount} payments</p>
                          <p className="text-xl font-bold text-emerald-400 mt-1">
                            {formatPaymentAmount(summary.amount, summary.currency)}
                          </p>
                          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-slate-500">
                            <span>Flutterwave {formatPaymentAmount(summary.byProvider.flutterwave.amount, summary.currency)}</span>
                            <span>Paystack {formatPaymentAmount(summary.byProvider.paystack.amount, summary.currency)}</span>
                          </div>
                          {summary.settledTransactionCount > 0 && (
                            <p className="text-[11px] text-slate-400 mt-2">
                              Flutterwave net settlement reported: {formatPaymentAmount(summary.settlementByProvider.flutterwave.amount ?? 0, summary.currency)} ({summary.settlementByProvider.flutterwave.transactionCount} transactions)
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-xl bg-gray-800/60 px-4 py-3 text-sm text-slate-400">
                      {hasGatewayData ? "No successful payments were found for this period." : "Live payment data is unavailable until a valid live key is configured for each provider."}
                    </p>
                  )}
                  <p className="text-[11px] text-slate-500 mt-4">
                    Amounts use each gateway's transaction amount field. Settlement values are shown separately when reported; refunds and chargebacks are not subtracted.
                  </p>
                </>
              )}
            </div>

            {payments?.currencies.filter((summary) => summary.monthly.some((month) => month.amount > 0)).map((summary) => (
              <ChartCard key={summary.currency} title={`${summary.currency} transaction amounts · last 12 months`} loading={loading}>
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={summary.monthly}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis
                      dataKey="month"
                      stroke="#64748B"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => new Date(`${value}-01T00:00:00`).toLocaleDateString("en", { month: "short", year: "2-digit" })}
                    />
                    <YAxis
                      stroke="#64748B"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => formatPaymentAmount(Number(value), summary.currency)}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#1F2937", border: "1px solid #334155", borderRadius: "12px", color: "#F8FAFC", fontSize: "13px" }}
                      labelStyle={{ color: "#94A3B8" }}
                      labelFormatter={(value) => new Date(`${value}-01T00:00:00`).toLocaleDateString("en", { month: "long", year: "numeric" })}
                      formatter={(value) => [formatPaymentAmount(Number(value), summary.currency), "Successful payments"]}
                    />
                    <defs>
                      <linearGradient id={`paymentGrad-${summary.currency}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#34D399" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#34D399" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="amount" stroke="#34D399" strokeWidth={2.5} fill={`url(#paymentGrad-${summary.currency})`} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>
            ))}
          </section>

          {/* ── Demographics ───────────────────────────────────────── */}
          {loading ? (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <SkeletonBlock className="h-[280px]" />
              <SkeletonBlock className="h-[280px]" />
              <SkeletonBlock className="h-[280px]" />
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <DistributionPanel
                title={t("admin.analytics.countryDistribution")}
                subtitle={`${biz?.countryCoverage?.represented?.toLocaleString() ?? "—"} of ${biz?.countryCoverage?.supported?.toLocaleString() ?? "—"} supported countries · ${biz?.countryCoverage?.percentage != null ? formatPercent(biz.countryCoverage.percentage) : "—"} coverage`}
                items={biz?.countryDistribution?.map((c) => ({
                  label: getCountryDisplayName(c.country),
                  count: c.count,
                  percentage: c.percentage,
                })) ?? []}
                emptyLabel="No country data yet"
                barClassName="bg-cyan-500"
              />
              <DistributionPanel
                title="Gender breakdown"
                subtitle={`${biz?.dataHealth?.usersWithGender?.toLocaleString() ?? "—"} known · ${biz?.dataHealth?.usersWithoutGender?.toLocaleString() ?? "—"} unknown`}
                items={biz?.genderDistribution?.map((g) => ({
                  label: g.gender,
                  count: g.count,
                  percentage: g.percentage,
                })) ?? []}
                emptyLabel="No gender data yet"
                barClassName="bg-violet-500"
              />
              <DistributionPanel
                title="Church size"
                subtitle={`${biz?.dataHealth?.churchProfiles?.toLocaleString() ?? "—"} church profiles contributing data`}
                items={biz?.churchSizeDistribution?.map((s) => ({
                  label: s.range,
                  count: s.count,
                  percentage: s.percentage,
                })) ?? []}
                emptyLabel="No church size data yet"
                barClassName="bg-emerald-500"
              />
            </div>
          )}

          {/* ── Church / Ambassador / Subscription Analytics ────────── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Church */}
            <div className="rounded-2xl bg-gray-900 border border-slate-700 p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/15 flex items-center justify-center">
                  <Church className="w-4 h-4 text-emerald-400" />
                </div>
                <span className="text-sm font-semibold text-slate-50">
                  {t("admin.analytics.churchAnalytics")}
                </span>
              </div>
              {loading ? (
                <SkeletonBlock className="h-[80px]" />
              ) : (
                <div className="space-y-2.5">
                  <InfoRow
                    label={t("admin.analytics.totalChurches")}
                    value={String(biz?.church?.total ?? "—")}
                  />
                  <InfoRow
                    label={t("admin.analytics.newThisMonth")}
                    value={String(biz?.church?.newThisMonth ?? "—")}
                  />
                  <InfoRow
                    label={t("admin.analytics.growth")}
                    value={biz?.church?.growth != null ? `${biz.church.growth >= 0 ? "+" : ""}${biz.church.growth}%` : "—"}
                  />
                </div>
              )}
            </div>

            {/* Ambassadors */}
            <div className="rounded-2xl bg-gray-900 border border-slate-700 p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-xl bg-amber-500/15 flex items-center justify-center">
                  <Award className="w-4 h-4 text-amber-400" />
                </div>
                <span className="text-sm font-semibold text-slate-50">
                  {t("admin.analytics.ambassadorAnalytics")}
                </span>
              </div>
              {loading ? (
                <SkeletonBlock className="h-[80px]" />
              ) : (
                <div className="space-y-2.5">
                  <InfoRow
                    label={t("admin.analytics.active")}
                    value={String(biz?.ambassadors?.active ?? "—")}
                  />
                  <InfoRow
                    label={t("admin.analytics.expired")}
                    value={String(biz?.ambassadors?.expired ?? "—")}
                  />
                  <InfoRow
                    label={t("admin.analytics.expiringSoon")}
                    value={String(biz?.ambassadors?.expiringSoon ?? "—")}
                  />
                </div>
              )}
            </div>

            {/* Subscriptions */}
            <div className="rounded-2xl bg-gray-900 border border-slate-700 p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-xl bg-violet-500/15 flex items-center justify-center">
                  <CreditCard className="w-4 h-4 text-violet-400" />
                </div>
                <span className="text-sm font-semibold text-slate-50">
                  {t("admin.analytics.subscriptionAnalytics")}
                </span>
              </div>
              {loading ? (
                <SkeletonBlock className="h-[80px]" />
              ) : (
                <div className="space-y-2.5">
                  {biz?.subscriptions?.map((s) => (
                    <InfoRow
                      key={s.tier}
                      label={s.plan}
                      value={String(s.count)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Credits + Content ──────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Credits */}
            <div className="rounded-2xl bg-gray-900 border border-slate-700 p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/15 flex items-center justify-center">
                  <Zap className="w-4 h-4 text-cyan-400" />
                </div>
                <span className="text-sm font-semibold text-slate-50">
                  {t("admin.analytics.creditAnalytics")}
                </span>
              </div>
              {loading ? (
                <SkeletonBlock className="h-[80px]" />
              ) : (
                <div className="space-y-2.5">
                  <InfoRow
                    label={t("admin.analytics.totalConsumed")}
                    value={String(biz?.credits?.totalConsumed ?? "—")}
                  />
                  <InfoRow
                    label={t("admin.analytics.totalGranted")}
                    value={String(biz?.credits?.totalGranted ?? "—")}
                  />
                  <InfoRow
                    label={t("admin.analytics.totalRefunded")}
                    value={String(biz?.credits?.totalRefunded ?? "—")}
                  />
                  <InfoRow
                    label={t("admin.analytics.totalTransactions")}
                    value={String(biz?.credits?.transactionCount ?? "—")}
                  />
                </div>
              )}
            </div>

            {/* Content */}
            <div className="rounded-2xl bg-gray-900 border border-slate-700 p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-xl bg-rose-500/15 flex items-center justify-center">
                  <FileText className="w-4 h-4 text-rose-400" />
                </div>
                <span className="text-sm font-semibold text-slate-50">
                  {t("admin.analytics.contentAnalytics")}
                </span>
              </div>
              {loading ? (
                <SkeletonBlock className="h-[80px]" />
              ) : (
                <div className="space-y-2.5">
                  <InfoRow
                    label={t("admin.analytics.totalSongs")}
                    value={String(biz?.content?.totalSongs ?? "—")}
                  />
                  <InfoRow
                    label={t("admin.analytics.totalMedia")}
                    value={String(biz?.content?.totalMedia ?? "—")}
                  />
                  <InfoRow
                    label={t("admin.analytics.totalThemes")}
                    value={String(biz?.content?.totalThemes ?? "—")}
                  />
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          PRODUCT ANALYTICS (Collapsible)
          ═══════════════════════════════════════════════════════════════ */}
      <button
        onClick={() => setProductOpen(!productOpen)}
        className="w-full flex items-center justify-between p-4 rounded-2xl bg-gray-900 border border-slate-700 hover:border-slate-600 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 flex items-center justify-center">
            <BarChart3 className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-left">
            <p className="text-base font-semibold text-slate-50">
              {t("admin.analytics.productAnalytics")}
            </p>
            <p className="text-[11px] text-slate-500">
              {t("admin.analytics.productDescription")}
            </p>
          </div>
        </div>
        {productOpen ? (
          <ChevronDown className="w-5 h-5 text-slate-400" />
        ) : (
          <ChevronRight className="w-5 h-5 text-slate-400" />
        )}
      </button>

      {productOpen && prod && (
        <div className="space-y-4">
          {/* ── Signup Chart ───────────────────────────────────────── */}
          <ChartCard title={t("admin.analytics.dailySignups")} loading={loading}>
            <BarChartSimple
              data={prod.signupChart}
              dataKey="signups"
              labelKey="date"
            />
          </ChartCard>

          {/* ── Retention ──────────────────────────────────────────── */}
          {prod.retentionData.length > 0 && (
            <ChartCard
              title={t("admin.analytics.weeklyRetention")}
              loading={loading}
            >
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={prod.retentionData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="date"
                    stroke="#64748B"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => {
                      const d = new Date(v);
                      return `${d.getMonth() + 1}/${d.getDate()}`;
                    }}
                  />
                  <YAxis
                    stroke="#64748B"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1F2937",
                      border: "1px solid #334155",
                      borderRadius: "12px",
                      color: "#F8FAFC",
                      fontSize: "13px",
                    }}
                    labelStyle={{ color: "#94A3B8" }}
                    formatter={(v) => [`${Number(v)}%`, "Retention"]}
                  />
                  <defs>
                    <linearGradient id="retGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#34D399" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#34D399" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="#34D399"
                    strokeWidth={2.5}
                    fill="url(#retGrad)"
                    dot={false}
                    activeDot={{
                      r: 5,
                      fill: "#34D399",
                      stroke: "#0F172A",
                      strokeWidth: 2,
                    }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          )}

          {/* ── Feature Usage + Breakdown ──────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Feature Usage */}
            <div className="rounded-2xl bg-gray-900 border border-slate-700 p-6">
              <h3 className="text-base font-semibold text-slate-50 mb-5">
                {t("admin.analytics.featureUsage")}
              </h3>
              {loading ? (
                <SkeletonBlock className="h-[280px]" />
              ) : (
                <div className="space-y-4">
                  <FeatureBar
                    icon={<BookOpen className="w-4 h-4" />}
                    label={t("admin.analytics.bibleSearches")}
                    value={featureUsage?.bibleSearches ?? 0}
                    max={featureMax}
                  />
                  <FeatureBar
                    icon={<Music className="w-4 h-4" />}
                    label={t("admin.analytics.worshipPresentations")}
                    value={featureUsage?.worshipPresentations ?? 0}
                    max={featureMax}
                  />
                  <FeatureBar
                    icon={<Monitor className="w-4 h-4" />}
                    label={t("admin.analytics.mediaPresentations")}
                    value={featureUsage?.mediaPresentations ?? 0}
                    max={featureMax}
                  />
                  <FeatureBar
                    icon={<FileText className="w-4 h-4" />}
                    label={t("admin.analytics.transcriptViews")}
                    value={featureUsage?.transcriptViews ?? 0}
                    max={featureMax}
                  />
                  <FeatureBar
                    icon={<TrendingUp className="w-4 h-4" />}
                    label={t("admin.analytics.themesCreated")}
                    value={featureUsage?.themesCreated ?? 0}
                    max={featureMax}
                  />
                </div>
              )}
            </div>

            {/* Breakdown */}
            <div className="rounded-2xl bg-gray-900 border border-slate-700 p-6">
              <h3 className="text-base font-semibold text-slate-50 mb-5">
                {t("admin.analytics.breakdown")}
              </h3>
              {loading ? (
                <SkeletonBlock className="h-[280px]" />
              ) : (
                <div className="space-y-5">
                  <div>
                    <p className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold mb-2.5">
                      {t("admin.analytics.bibleAnalytics")}
                    </p>
                    <div className="space-y-1.5">
                      <InfoRow
                        label={t("admin.analytics.totalSessions")}
                        value={String(
                          prod?.bibleAnalytics?.totalBibleSessions ?? 0,
                        )}
                      />
                      {(prod?.bibleAnalytics?.mostUsedVersions || [])
                        .slice(0, 3)
                        .map((v) => (
                          <InfoRow
                            key={v.name}
                            label={v.name}
                            value={String(v.count)}
                          />
                        ))}
                    </div>
                  </div>
                  <div className="border-t border-slate-700/50 pt-4">
                    <p className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold mb-2.5">
                      {t("admin.analytics.worship")}
                    </p>
                    <div className="space-y-1.5">
                      <InfoRow
                        label={t("admin.analytics.songsCreated")}
                        value={String(
                          prod?.worshipAnalytics?.songsCreated ?? 0,
                        )}
                      />
                      <InfoRow
                        label={t("admin.analytics.songsImported")}
                        value={String(
                          prod?.worshipAnalytics?.songsImported ?? 0,
                        )}
                      />
                      <InfoRow
                        label={t("admin.analytics.totalSlidesPresented")}
                        value={String(
                          prod?.worshipAnalytics?.totalWorshipSlides ?? 0,
                        )}
                      />
                    </div>
                  </div>
                  <div className="border-t border-slate-700/50 pt-4">
                    <p className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold mb-2.5">
                      {t("admin.analytics.media")}
                    </p>
                    <div className="space-y-1.5">
                      <InfoRow
                        label={t("admin.analytics.imagesUploaded")}
                        value={String(
                          prod?.mediaAnalytics?.imagesUploaded ?? 0,
                        )}
                      />
                      <InfoRow
                        label={t("admin.analytics.mediaPresentations")}
                        value={String(
                          prod?.mediaAnalytics?.mediaPresentations ?? 0,
                        )}
                      />
                    </div>
                  </div>
                  <div className="border-t border-slate-700/50 pt-4">
                    <p className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold mb-2.5">
                      {t("admin.analytics.transcripts")}
                    </p>
                    <div className="space-y-1.5">
                      <InfoRow
                        label={t("admin.analytics.totalTranscripts")}
                        value={String(
                          prod?.transcriptAnalytics?.totalTranscripts ?? 0,
                        )}
                      />
                      <InfoRow
                        label={t("admin.analytics.exports")}
                        value={String(
                          prod?.transcriptAnalytics?.exportsGenerated ?? 0,
                        )}
                      />
                      <InfoRow
                        label={t("admin.analytics.translations")}
                        value={String(
                          prod?.transcriptAnalytics?.translationsGenerated ?? 0,
                        )}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
