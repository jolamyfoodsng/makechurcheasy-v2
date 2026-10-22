"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Brain,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  FileAudio,
  Info,
  Languages,
  Loader2,
  Lock,
  Mic,
  RefreshCw,
  Settings,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import {
  getCreditTransactions,
  getCreditUsageByDay,
  getTranscriptionBalance,
  getTranscriptionPackages,
  createTranscriptionTopup,
  verifyTranscriptionTopup,
  type CreditTransaction,
  type TranscriptionBalanceSummary,
  type TopupPackage,
  type TopupPricingResult,
} from "@/lib/api";
import { useSubscription } from "@/lib/useSubscription";
import { getUserId } from "@/lib/userId";
import { getAmbassadorInfo } from "@/lib/ambassadorUtils";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { CardSkeleton, TableSkeleton } from "@/components/ui";

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

function formatShortDate(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "NGN",
      minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

const formatNumber = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });

function activityLabel(txn: CreditTransaction): string {
  if (txn.source === "transcription") return "Live transcription";
  if (txn.source === "translation") return "Live translation";
  return txn.description?.slice(0, 60) || "Credit activity";
}

const RANGES = [
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
] as const;

export default function Credits() {
  const {
    planLabel,
    subscription,
    mongoUser,
    maxCredits,
    isUnlimited: subIsUnlimited,
    loading: subLoading,
  } = useSubscription();

  const ambassadorInfo = getAmbassadorInfo(mongoUser?.ambassador, mongoUser?.role);

  const [recentTransactions, setRecentTransactions] = useState<CreditTransaction[]>([]);
  const [chartData, setChartData] = useState<{ date: string; usage: number }[]>([]);
  const [rangeDays, setRangeDays] = useState<number>(7);
  const [transcriptionBalance, setTranscriptionBalance] = useState<TranscriptionBalanceSummary | null>(null);
  const [topupPricing, setTopupPricing] = useState<TopupPricingResult | null>(null);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [purchaseError, setPurchaseError] = useState("");
  const [purchasingPackId, setPurchasingPackId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [topupSuccessMessage, setTopupSuccessMessage] = useState("");
  const [isVerifyingTopup, setIsVerifyingTopup] = useState(false);

  // Top-ups are charged in the subscription's currency, so that is the currency shown.
  const currency = subscription?.currency || "NGN";
  const isUnlimited = subIsUnlimited || Boolean(transcriptionBalance?.unlimited);

  const fallbackCredits = mongoUser?.credits ?? 0;
  const totalAvailableCredits = transcriptionBalance ? transcriptionBalance.totalAvailableCredits : (mongoUser?.totalAvailable ?? maxCredits);
  const totalAvailableHours = transcriptionBalance ? transcriptionBalance.totalAvailableHours : Math.round((fallbackCredits / 60) * 100) / 100;
  const includedHours = transcriptionBalance ? transcriptionBalance.includedHours : Math.round((Math.min(fallbackCredits, maxCredits) / 60) * 100) / 100;
  const purchasedHours = transcriptionBalance ? transcriptionBalance.purchasedHours : 0;

  // Initial data + return from the payment page
  useEffect(() => {
    const userId = getUserId();
    if (!userId) {
      setLoading(false);
      return;
    }

    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const isTopupSuccess = params.get("topup") === "success";
      const reference = params.get("reference") || params.get("tx_ref");
      const transactionId = params.get("transaction_id") || undefined;
      if (isTopupSuccess && reference) {
        setIsVerifyingTopup(true);
        verifyTranscriptionTopup(reference, transactionId)
          .then((res) => {
            if (res.success) {
              setTopupSuccessMessage(
                res.alreadyProcessed
                  ? "Your top-up was already confirmed and added to your balance."
                  : "Top-up confirmed. Your hours have been added.",
              );
              if (res.balance) setTranscriptionBalance(res.balance);
            } else {
              setPurchaseError("We couldn't confirm the payment. Contact support if you were charged.");
            }
          })
          .catch((err) => setPurchaseError(err instanceof Error ? err.message : "Failed to verify top-up"))
          .finally(() => {
            setIsVerifyingTopup(false);
            window.history.replaceState({}, document.title, window.location.pathname);
          });
      }
    }

    Promise.all([
      getCreditTransactions(userId, { limit: 5 }),
      getTranscriptionBalance().catch(() => null),
      getTranscriptionPackages(currency).catch(() => null),
    ])
      .then(([txns, balanceData, packagesData]) => {
        setRecentTransactions(txns.transactions || []);
        if (balanceData) setTranscriptionBalance(balanceData);
        if (packagesData) setTopupPricing(packagesData);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [currency]);

  // Usage chart: refetched when the range changes.
  useEffect(() => {
    const userId = getUserId();
    if (!userId) return;
    let cancelled = false;
    getCreditUsageByDay(userId, rangeDays)
      .then((usage) => {
        if (!cancelled) setChartData(usage.usage.map((d) => ({ date: formatShortDate(d.date), usage: d.amount })));
      })
      .catch(() => { if (!cancelled) setChartData([]); });
    return () => { cancelled = true; };
  }, [rangeDays]);

  const packages: TopupPackage[] = useMemo(() => topupPricing?.packages ?? [], [topupPricing]);
  const selectedPack = packages.find((pack) => pack.id === selectedPackId)
    ?? packages.find((pack) => pack.badge === "Popular")
    ?? packages[0];

  const handleBuyCredits = async (pack: TopupPackage) => {
    setPurchaseError("");
    setPurchasingPackId(pack.id);
    try {
      const returnUrl = typeof window !== "undefined" ? `${window.location.origin}/credits?topup=success` : undefined;
      const data = await createTranscriptionTopup(pack.id, returnUrl);
      if (!data.authorization_url) throw new Error("Could not start checkout");
      try {
        localStorage.setItem("mce_pending_payment", JSON.stringify({ type: "transcription_topup", reference: data.reference, packId: pack.id }));
      } catch {
        /* best effort */
      }
      window.location.href = data.authorization_url;
    } catch (error) {
      setPurchaseError(error instanceof Error ? error.message : "Could not start checkout");
      setPurchasingPackId(null);
    }
  };

  if (subLoading || loading) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-6 p-6 pb-16 md:p-8">
        <CardSkeleton />
        <CardSkeleton />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><CardSkeleton /><CardSkeleton /></div>
        <TableSkeleton rows={3} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-6 pb-16 md:p-8">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Credits &amp; transcription</h1>
          <p className="mt-1 text-sm text-slate-500">Track your balance, understand usage, and top up when you need to.</p>
        </div>
        <Link
          href="/subscription"
          className="inline-flex items-center gap-2 self-start rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
        >
          <CreditCard className="h-4 w-4" /> View plan
        </Link>
      </div>

      {topupSuccessMessage && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          <span className="flex items-center gap-2.5"><CheckCircle2 className="h-5 w-5 text-emerald-600" />{topupSuccessMessage}</span>
          <button onClick={() => setTopupSuccessMessage("")} className="text-xs font-bold text-emerald-700 hover:text-emerald-900">Dismiss</button>
        </div>
      )}
      {isVerifyingTopup && (
        <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" /> Confirming your top-up payment...
        </div>
      )}

      {/* Balance */}
      <section className="rounded-xl border border-slate-200 border-l-4 border-l-[#0238E9] bg-white shadow-2xs">
        <div className="grid grid-cols-1 divide-y divide-slate-100 md:grid-cols-[1.3fr_1fr_1fr] md:divide-x md:divide-y-0">
          <div className="p-6">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Available balance</p>
              <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-semibold text-[#0238E9]">
                {ambassadorInfo.isAmbassador ? "Ambassador grant" : `${planLabel} plan`}
              </span>
            </div>
            {isUnlimited ? (
              <p className="mt-2 text-5xl font-extrabold tracking-tight text-slate-900">Unlimited</p>
            ) : (
              <>
                <p className="mt-2 text-slate-900">
                  <span className="text-5xl font-extrabold tracking-tight">{formatNumber(totalAvailableHours)}</span>{" "}
                  <span className="text-3xl text-slate-500">hours</span>
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-600">{formatNumber(totalAvailableCredits)} credits</p>
              </>
            )}
          </div>
          <div className="p-6">
            <p className="text-sm text-slate-600">Plan balance</p>
            <p className="mt-2 text-3xl font-extrabold text-slate-900">{isUnlimited ? "∞" : `${formatNumber(includedHours)} hrs`}</p>
            <p className="mt-1 text-sm text-slate-500">Resets monthly · Used first</p>
          </div>
          <div className="p-6">
            <p className="text-sm text-slate-600">Purchased credits</p>
            <p className="mt-2 text-3xl font-extrabold text-slate-900">{formatNumber(purchasedHours)} hrs</p>
            <p className="mt-1 text-sm text-slate-500">Never expires · Used after plan credits</p>
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-slate-100 px-6 py-3 text-sm text-slate-500">
          <Info className="h-4 w-4 shrink-0" />
          For live transcription: 1 credit = 1 minute. Charged by the second.
        </div>
        {ambassadorInfo.isAmbassador && (
          <div className="flex items-start gap-2.5 border-t border-slate-100 px-6 py-3 text-sm text-purple-900">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-purple-600" />
            You have a {ambassadorInfo.tenureLabel} ambassador grant with Growth features ({ambassadorInfo.remainingLabel}).
          </div>
        )}
      </section>

      {/* Top up */}
      <section id="buy-credits" className="scroll-mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-2xs">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <BarChart3 className="mt-0.5 h-5 w-5 text-slate-700" />
            <div>
              <h2 className="text-xl font-bold text-slate-900">Top up credits</h2>
              <p className="text-sm text-slate-500">Purchased credits roll over and never expire.</p>
            </div>
          </div>
          <span
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800"
            title="Top-ups are charged in your subscription's currency"
          >
            {topupPricing?.currency || currency}
          </span>
        </div>

        {purchaseError && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" /> {purchaseError}
          </div>
        )}

        {packages.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
            Top-up prices could not be loaded. Refresh the page to try again.
          </p>
        ) : (
          <>
            <div role="radiogroup" aria-label="Top-up amount" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {packages.map((pack) => {
                const selected = selectedPack?.id === pack.id;
                return (
                  <button
                    key={pack.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setSelectedPackId(pack.id)}
                    className={`flex items-start gap-3 rounded-lg border p-4 text-left transition-colors ${
                      selected ? "border-[#0238E9] bg-blue-50/60 ring-1 ring-[#0238E9]" : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${selected ? "border-[#0238E9]" : "border-slate-300"}`}>
                      {selected && <span className="h-2.5 w-2.5 rounded-full bg-[#0238E9]" />}
                    </span>
                    <span>
                      <span className="block text-base font-semibold text-slate-900">{pack.hours} {pack.hours === 1 ? "hour" : "hours"}</span>
                      <span className="block text-sm text-slate-500">{pack.credits.toLocaleString()} credits</span>
                      <span className="mt-1 block text-xl font-bold text-slate-900">{formatCurrency(pack.price, pack.currency)}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {selectedPack && (
              <div className="mt-5 flex flex-col justify-between gap-4 border-t border-slate-100 pt-5 sm:flex-row sm:items-center">
                <div>
                  <p className="text-base font-bold text-slate-900">
                    {selectedPack.hours} {selectedPack.hours === 1 ? "hour" : "hours"} · {selectedPack.credits.toLocaleString()} credits
                  </p>
                  <p className="text-sm text-slate-500">One-time payment</p>
                </div>
                <div className="flex flex-col items-stretch gap-1.5 sm:flex-row sm:items-center sm:gap-6">
                  <span className="text-2xl font-extrabold text-slate-900">{formatCurrency(selectedPack.price, selectedPack.currency)}</span>
                  <div className="flex flex-col items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void handleBuyCredits(selectedPack)}
                      disabled={!!purchasingPackId || isVerifyingTopup}
                      className="inline-flex min-w-[220px] items-center justify-center gap-2 rounded-lg bg-[#0238E9] px-5 py-3 text-sm font-semibold text-white hover:bg-[#012CAE] disabled:opacity-50"
                    >
                      {purchasingPackId ? <><Loader2 className="h-4 w-4 animate-spin" /> Redirecting...</> : <>Continue to checkout <ArrowRight className="h-4 w-4" /></>}
                    </button>
                    <span className="flex items-center gap-1 text-xs text-slate-500"><Lock className="h-3 w-3" /> Secure checkout with Flutterwave</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Usage chart */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-2xs">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2.5 text-xl font-bold text-slate-900"><BarChart3 className="h-5 w-5" /> Credit usage</h2>
            <label className="relative inline-flex items-center">
              <Calendar className="pointer-events-none absolute left-3 h-4 w-4 text-slate-500" />
              <select
                value={rangeDays}
                onChange={(e) => setRangeDays(Number(e.target.value))}
                className="appearance-none rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-8 text-sm font-medium text-slate-800"
                aria-label="Usage period"
              >
                {RANGES.map((range) => <option key={range.days} value={range.days}>{range.label}</option>)}
              </select>
            </label>
          </div>
          {chartData.some((d) => d.usage > 0) ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis axisLine={false} tickLine={false} allowDecimals={false} tick={{ fill: "#64748b", fontSize: 11 }} label={{ value: "Credits", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 11 }} />
                  <Tooltip cursor={{ fill: "rgba(2,56,233,0.06)" }} formatter={(value) => [`${value} credits`, "Used"]} />
                  <Bar dataKey="usage" fill="#0238E9" radius={[3, 3, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-56 flex-col items-center justify-center text-center text-sm text-slate-500">
              <FileAudio className="mb-2 h-6 w-6 text-slate-400" />
              No credits used in this period.
            </div>
          )}
        </section>

        {/* How credits are used */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-2xs">
          <h2 className="mb-4 flex items-center gap-2.5 text-xl font-bold text-slate-900"><Settings className="h-5 w-5" /> How credits are used</h2>
          <ul className="divide-y divide-slate-100">
            <RateRow icon={<Mic className="h-5 w-5 text-[#0238E9]" />} title="Speech-to-Scripture" detail="Live speech recognition & scripture detection" rate="1 credit / min" />
            <RateRow icon={<Languages className="h-5 w-5 text-[#0238E9]" />} title="Live Translation" detail="Multilingual captions & translation" rate="1 credit / min" />
            <RateRow icon={<Brain className="h-5 w-5 text-[#0238E9]" />} title="AI Sermon Summaries" detail="Sermon summaries & study points" rate="5 credits / run" />
          </ul>
          <p className="mt-3 flex items-center gap-2 text-sm text-slate-500"><Info className="h-4 w-4" /> Live audio is billed by the second.</p>
        </section>
      </div>

      {/* Recent activity */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-2xs">
        <div className="flex items-center justify-between px-6 py-4">
          <h2 className="flex items-center gap-2.5 text-xl font-bold text-slate-900"><Clock className="h-5 w-5" /> Recent activity</h2>
          <Link href="/credits/history" className="inline-flex items-center gap-1 text-sm font-semibold text-[#0238E9] hover:underline">
            View full history <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        {recentTransactions.length === 0 ? (
          <p className="border-t border-slate-100 px-6 py-8 text-center text-sm text-slate-500">No credit activity yet. It appears here as you use AI features.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-slate-100 bg-slate-50 text-left text-xs font-medium text-slate-500">
                <th className="px-6 py-2 font-medium">Activity</th>
                <th className="px-6 py-2 font-medium">Date</th>
                <th className="px-6 py-2 text-right font-medium">Credits</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recentTransactions.map((txn, i) => (
                <tr key={txn._id || i}>
                  <td className="px-6 py-2.5">
                    <span className="flex items-center gap-2.5 text-slate-800">
                      {txn.amount > 0 ? <RefreshCw className="h-4 w-4 text-emerald-600" /> : <Mic className="h-4 w-4 text-purple-500" />}
                      {activityLabel(txn)}
                    </span>
                  </td>
                  <td className="px-6 py-2.5 text-slate-600">{formatDate(txn.createdAt)}</td>
                  <td className={`px-6 py-2.5 text-right font-medium ${txn.amount > 0 ? "text-emerald-700" : "text-slate-800"}`}>
                    {txn.amount > 0 ? "+" : ""}{formatNumber(txn.amount)} {Math.abs(txn.amount) === 1 ? "credit" : "credits"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function RateRow({ icon, title, detail, rate }: { icon: React.ReactNode; title: string; detail: string; rate: string }) {
  return (
    <li className="flex items-center gap-3 py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-slate-900">{title}</span>
        <span className="block text-sm text-slate-500">{detail}</span>
      </span>
      <span className="shrink-0 text-sm font-semibold text-slate-900">{rate}</span>
    </li>
  );
}
