"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Brain,
  Calendar,
  CheckCircle2,
  Clock,
  Cloud,
  CreditCard,
  Image as ImageIcon,
  Infinity as InfinityIcon,
  Loader2,
  Minus,
  Monitor,
  Music,
  Palette,
  RefreshCw,
  Settings,
  Type,
  Users,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useSubscription } from "@/lib/useSubscription";
import { getDevices } from "@/lib/api";
import { CardSkeleton } from "@/components/ui";
import type { PlanEntitlements } from "@/lib/planConfigService";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

/** "gift_3m" → 3 */
function giftMonths(cycle?: string): number | null {
  const match = /^gift_(\d+)m$/.exec(String(cycle || ""));
  return match ? Number(match[1]) : null;
}

function paymentMethodLabel(provider?: string, cycle?: string): string {
  if (giftMonths(cycle) || /admin/i.test(String(provider || ""))) return "Collected by admin";
  switch (provider) {
    case "flutterwave": return "Card / bank (Flutterwave)";
    case "nowpayments": return "Crypto (NOWPayments)";
    case "mtn_momo": return "MTN MoMo";
    case "paystack": return "Card (Paystack)";
    case "plan_credit": return "Credit for unused time";
    default: return provider ? provider : "Not available";
  }
}

export default function SubscriptionPage() {
  const {
    plan,
    planLabel,
    planTier,
    subscription,
    mongoUser,
    maxCredits,
    isUnlimited,
    isFreePlan,
    isOnTrial,
    trialEndsAt,
    loading: subLoading,
  } = useSubscription();

  const [cancellingChange, setCancellingChange] = useState(false);
  const [connectedDevices, setConnectedDevices] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDevices()
      .then((list) => { if (!cancelled) setConnectedDevices(Array.isArray(list) ? list.length : 0); })
      .catch(() => { if (!cancelled) setConnectedDevices(null); });
    return () => { cancelled = true; };
  }, []);

  const entitlements = planTier?.entitlements as PlanEntitlements | undefined;
  const creditsLeft = Math.max(0, mongoUser?.credits ?? 0);
  const creditsUsed = isUnlimited ? 0 : Math.max(0, maxCredits - creditsLeft);
  const usedPercent = !isUnlimited && maxCredits > 0 ? Math.min(100, Math.round((creditsUsed / maxCredits) * 100)) : 0;
  const currency = subscription?.currency || "USD";
  const cycle = subscription?.billingCycle;
  const gift = giftMonths(cycle);
  const isActive = subscription?.status === "active" || (!isFreePlan && !subscription);
  const isCancelling = subscription?.status === "cancelled";
  const isPastDue = subscription?.status === "past_due";
  const isOneTimePurchase = subscription?.purchaseKind === "one_time" || cycle === "lifetime";
  const renewalDate = isOneTimePurchase ? null : subscription?.nextBillingDate || subscription?.currentPeriodEnd;

  const statusLabel = isOnTrial ? "Trial" : isPastDue ? "Past due" : isCancelling ? "Cancels" : isFreePlan ? "Free" : isActive ? "Active" : "Inactive";
  const statusClass = isOnTrial || isCancelling
    ? "border-amber-200 bg-amber-50 text-amber-700"
    : isPastDue
      ? "border-red-200 bg-red-50 text-red-700"
      : isActive && !isFreePlan
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-slate-200 bg-slate-50 text-slate-600";

  const planTerm = isOnTrial
    ? "Free trial"
    : isFreePlan
      ? "Free"
      : gift
        ? `${gift}-month gift`
        : isOneTimePurchase
          ? "One-time purchase"
          : cycle === "yearly"
            ? "Yearly"
            : cycle === "monthly"
              ? "Monthly"
              : "Not available";
  const planSubtitle = isOnTrial ? "Free trial" : isFreePlan ? "Free plan" : gift ? `${gift}-month gift plan` : `${planTerm} plan`;

  const currentCharge = isFreePlan
    ? "Free"
    : subscription?.price && subscription.price > 0
      ? isOneTimePurchase
        ? `${formatCurrency(subscription.price, currency)} one-time`
        : `${formatCurrency(subscription.price, currency)}/${cycle === "yearly" ? "yr" : "mo"}`
      : "Not available";

  const deviceLimit = entitlements?.devices ?? 1;
  const cloudGb = entitlements?.cloudStorageGB ?? 0;

  if (subLoading) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-6 p-6 pb-16 md:p-8">
        <CardSkeleton />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3"><CardSkeleton /><CardSkeleton /><CardSkeleton /></div>
        <CardSkeleton />
      </div>
    );
  }

  const presentation: Array<[string, boolean]> = [
    ["Bible & Scripture", true],
    ["Worship Lyrics", true],
    ["Media", true],
    ["Tickers", Boolean(entitlements?.tickers)],
    ["Countdowns", Boolean(entitlements?.countdowns)],
    ["Multiview", Boolean(entitlements?.multiview)],
  ];
  const aiTools: Array<[string, boolean]> = [
    ["AI Model Access", Boolean(entitlements?.aiFeatures)],
    ["Speech-to-Scripture", Boolean(entitlements?.speechToScripture)],
    ["Live Translation", Boolean(entitlements?.translation)],
    ["Sermon Export", Boolean(entitlements?.sermonExport)],
  ];
  const teamWorkflow: Array<[string, boolean]> = [
    ["Cloud Sync", Boolean(entitlements?.cloudSync)],
    ["Advanced Imports", Boolean(entitlements?.massImport)],
    ["EasyWorship Import", Boolean(entitlements?.easyWorshipImport)],
    ["ProPresenter Import", Boolean(entitlements?.proPresenterImport)],
    ["Android Scene Controller", Boolean(entitlements?.mobileControl)],
    ["API Access", Boolean(entitlements?.apiAccess)],
    ["Team Management", Boolean(entitlements?.teamManagement)],
    ["Campus Management", Boolean(entitlements?.campusManagement)],
  ];
  const allFeatures = [...presentation, ...aiTools, ...teamWorkflow];
  const includedCount = allFeatures.filter(([, on]) => on).length;

  const tools: Array<{ label: string; icon: typeof Music; value: number | undefined }> = [
    { label: "Songs", icon: Music, value: entitlements?.songs },
    { label: "Images & videos", icon: ImageIcon, value: entitlements?.images },
    { label: "Themes", icon: Palette, value: entitlements?.themes },
    { label: "Lower thirds", icon: Type, value: entitlements?.lowerThirds },
    { label: "Bible versions", icon: BookOpen, value: entitlements?.bibleVersions },
  ];
  const allToolsUnlimited = tools.every((tool) => tool.value === -1);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-6 pb-16 md:p-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Your subscription</h1>
        <p className="mt-1 text-sm text-slate-500">Your plan, usage and billing at a glance.</p>
      </div>

      {/* Past-due banner */}
      {isPastDue && (
        <div className="flex flex-col justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-semibold text-amber-900">Payment failed</p>
              <p className="text-xs text-amber-800">
                We couldn&apos;t process your {formatCurrency(subscription?.price ?? 0, currency)} {planLabel} renewal.
                {subscription?.gracePeriodEndsAt && <> {planLabel} stays available until {formatDate(subscription.gracePeriodEndsAt)}.</>}
              </p>
            </div>
          </div>
          <Link href="/billing" className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100">
            <RefreshCw className="h-4 w-4" /> Retry payment
          </Link>
        </div>
      )}

      {/* Scheduled change banner */}
      {subscription?.pendingPlan &&
        subscription?.pendingChangeType &&
        subscription.pendingPlan.toLowerCase() !== (plan || "").toLowerCase() && (
        <div className="flex flex-col justify-between gap-4 rounded-xl border border-blue-200 bg-blue-50 p-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <Calendar className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
            <p className="text-sm text-blue-900">
              Your plan changes to <strong className="capitalize">{subscription.pendingPlan}</strong>
              {subscription.pendingChangeEffectiveAt && <> on {formatDate(subscription.pendingChangeEffectiveAt)}</>}.
              Your current plan stays active until then.
            </p>
          </div>
          <button
            disabled={cancellingChange}
            onClick={async () => {
              setCancellingChange(true);
              try {
                const res = await fetch("/api/subscriptions", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "cancelPendingChange" }),
                });
                if (res.ok) window.location.reload();
                else setCancellingChange(false);
              } catch {
                setCancellingChange(false);
              }
            }}
            className="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-blue-700 hover:underline disabled:opacity-50"
          >
            {cancellingChange && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {cancellingChange ? "Cancelling..." : "Cancel scheduled change"}
          </button>
        </div>
      )}

      {/* Current plan */}
      <section className="flex flex-col justify-between gap-5 rounded-xl border border-slate-200 border-l-4 border-l-[#0238E9] bg-white p-6 shadow-2xs sm:flex-row sm:items-center">
        <div className="flex items-start gap-5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#0238E9]">
            {isOnTrial ? <Clock className="h-7 w-7" /> : isFreePlan ? <Zap className="h-7 w-7" /> : <CreditCard className="h-7 w-7" />}
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Current plan</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-3">
              <h2 className="text-3xl font-extrabold tracking-tight text-slate-900">{planLabel}</h2>
              <span className={`rounded-full border px-3 py-0.5 text-sm font-semibold ${statusClass}`}>{statusLabel}</span>
            </div>
            <p className="mt-1 text-base text-slate-700">{planSubtitle}</p>
            {isOnTrial && trialEndsAt ? (
              <p className="mt-1 text-sm text-amber-700">Trial ends {formatDate(trialEndsAt.toISOString())}</p>
            ) : renewalDate && !isFreePlan ? (
              <p className="mt-1 text-sm text-slate-500">{isCancelling ? "Ends" : gift ? "Ends" : "Renews"} {formatDate(renewalDate)}</p>
            ) : null}
          </div>
        </div>
        <Link
          href="/subscription/plans"
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[#0238E9] px-5 py-3 text-sm font-semibold text-white shadow-xs hover:bg-[#012CAE]"
        >
          <ArrowUp className="h-4 w-4" /> {isFreePlan || isOnTrial ? "Choose a plan" : "Change plan"}
        </Link>
      </section>

      {/* Usage */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard icon={<Zap className="h-5 w-5 text-amber-500" />} iconBg="bg-amber-50" title="AI credits">
          {isUnlimited ? (
            <p className="text-3xl font-extrabold text-slate-900">Unlimited</p>
          ) : (
            <>
              <p className="text-slate-900">
                <span className="text-3xl font-extrabold">{creditsLeft.toLocaleString()}</span>{" "}
                <span className="text-base text-slate-600">remaining</span>
              </p>
              <div className="mt-2 flex justify-between text-xs text-slate-500">
                <span>{creditsUsed.toLocaleString()} of {maxCredits.toLocaleString()} used this month</span>
                <span>{usedPercent}% used</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-[#0238E9]" style={{ width: `${Math.max(usedPercent, usedPercent > 0 ? 3 : 0)}%` }} />
              </div>
            </>
          )}
          <CardLink href="/credits">View usage</CardLink>
        </StatCard>

        <StatCard icon={<Monitor className="h-5 w-5 text-[#0238E9]" />} iconBg="bg-blue-50" title="Devices">
          <p className="text-slate-900">
            <span className="text-3xl font-extrabold">
              {connectedDevices ?? "—"} / {deviceLimit === -1 ? "∞" : deviceLimit}
            </span>{" "}
            <span className="text-base text-slate-600">connected</span>
          </p>
          {deviceLimit > 0 && deviceLimit <= 20 && (
            <div className="mt-3 flex gap-1.5" aria-hidden="true">
              {Array.from({ length: deviceLimit }, (_, i) => (
                <span key={i} className={`h-3.5 flex-1 rounded ${i < (connectedDevices ?? 0) ? "bg-[#0238E9]" : "bg-slate-200"}`} />
              ))}
            </div>
          )}
          <CardLink href="/devices">Manage devices</CardLink>
        </StatCard>

        <StatCard icon={<Cloud className="h-5 w-5 text-[#0238E9]" />} iconBg="bg-blue-50" title="Cloud storage">
          <p className="text-3xl font-extrabold text-slate-900">
            {cloudGb === -1 ? "Unlimited" : cloudGb > 0 ? `${cloudGb} GB` : "Not included"}
          </p>
          <p className="text-base text-slate-600">{cloudGb !== 0 ? "included in your plan" : "upgrade to store media in the cloud"}</p>
          <p className="mt-auto pt-4 text-xs text-slate-500">Plan allowance</p>
        </StatCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_400px]">
        {/* Included features */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-2xs">
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-bold text-slate-900">Included with {planLabel}</h2>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-0.5 text-sm font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              {includedCount === allFeatures.length ? "All included" : `${includedCount} of ${allFeatures.length} included`}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-slate-100">
            <FeatureGroup icon={<Monitor className="h-5 w-5 text-[#0238E9]" />} iconBg="bg-blue-50" title="Presentation" items={presentation} first />
            <FeatureGroup icon={<Brain className="h-5 w-5 text-violet-600" />} iconBg="bg-violet-50" title="AI & sermon tools" items={aiTools} />
            <FeatureGroup icon={<Users className="h-5 w-5 text-emerald-600" />} iconBg="bg-emerald-50" title="Team & workflow" items={teamWorkflow} />
          </div>
        </section>

        {/* Billing details */}
        <section className="rounded-xl border border-slate-200 bg-white shadow-2xs">
          <div className="flex items-center gap-2.5 border-b border-slate-100 px-6 py-4">
            <CreditCard className="h-5 w-5 text-[#0238E9]" />
            <h2 className="text-xl font-bold text-slate-900">Billing details</h2>
          </div>
          <DetailRow label="Current charge" value={currentCharge} />
          <DetailRow label="Next payment" value={isFreePlan ? "None" : gift || isOneTimePurchase ? "No renewal" : renewalDate ? formatDate(renewalDate) : "Not available"} />
          <DetailRow label="Plan term" value={planTerm} />
          <DetailRow label="Payment method" value={isFreePlan ? "None" : paymentMethodLabel(subscription?.paymentProvider, cycle)} />
          <div className="px-6 pb-6 pt-3">
            <Link
              href="/billing"
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              <Settings className="h-4 w-4" /> Manage billing
            </Link>
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_400px]">
        {/* Creative tools */}
        <section className="rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-2xs">
          <h2 className="mb-2 text-xl font-bold text-slate-900">{allToolsUnlimited ? "Unlimited creative tools" : "Creative tools"}</h2>
          <ul className="divide-y divide-slate-100">
            {tools.map(({ label, icon: Icon, value }) => (
              <li key={label} className="flex items-center justify-between py-2">
                <span className="flex items-center gap-3 text-sm text-slate-700">
                  <Icon className="h-5 w-5 text-slate-700" /> {label}
                </span>
                <span className="flex items-center gap-2 text-sm text-slate-600">
                  {value === -1 ? (
                    <><InfinityIcon className="h-5 w-5 text-[#0238E9]" /> Unlimited</>
                  ) : value == null ? (
                    "—"
                  ) : (
                    `Up to ${value.toLocaleString()}`
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Recent activity */}
        <section className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-2xs">
          <div className="flex items-center gap-2.5 px-6 pt-5">
            <Clock className="h-5 w-5 text-[#0238E9]" />
            <h2 className="text-xl font-bold text-slate-900">Recent activity</h2>
          </div>
          <ul className="space-y-3 px-6 py-4">
            {subscription?.previousPlan && (
              <ActivityItem title="Plan changed" detail={`${subscription.previousPlan} → ${planLabel}`} date={subscription.updatedAt ? formatDate(subscription.updatedAt) : ""} />
            )}
            {subscription?.currentPeriodStart ? (
              <ActivityItem title="Subscription activated" detail={`${planLabel} plan`} date={formatDate(subscription.currentPeriodStart)} />
            ) : (
              !subscription?.previousPlan && <li className="text-sm text-slate-500">No recent activity</li>
            )}
          </ul>
          <div className="mt-auto flex items-center justify-between border-t border-slate-100 px-6 py-4 text-sm">
            <span className="text-slate-600">Need help with your plan?</span>
            <Link href="/support" className="inline-flex items-center gap-1 font-semibold text-[#0238E9] hover:underline">
              Contact support <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function StatCard({ icon, iconBg, title, children }: { icon: React.ReactNode; iconBg: string; title: string; children: React.ReactNode }) {
  return (
    <section className="flex gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-2xs">
      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${iconBg}`}>{icon}</div>
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        {children}
      </div>
    </section>
  );
}

function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="mt-auto inline-flex items-center gap-1.5 pt-4 text-sm font-semibold text-[#0238E9] hover:underline">
      {children} <ArrowRight className="h-4 w-4" />
    </Link>
  );
}

function FeatureGroup({ icon, iconBg, title, items, first }: { icon: React.ReactNode; iconBg: string; title: string; items: Array<[string, boolean]>; first?: boolean }) {
  return (
    <div className={first ? "sm:pr-6" : "sm:px-6"}>
      <div className="mb-3 flex items-center gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconBg}`}>{icon}</span>
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      </div>
      <ul className="space-y-1.5">
        {items.map(([label, included]) => (
          <li key={label} className={`flex items-center gap-2.5 text-sm ${included ? "text-slate-700" : "text-slate-400"}`}>
            {included ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <Minus className="h-4 w-4 shrink-0 text-slate-300" />}
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 px-6 py-3.5 text-sm">
      <span className="text-slate-600">{label}</span>
      <span className="text-right font-semibold text-slate-900">{value}</span>
    </div>
  );
}

function ActivityItem({ title, detail, date }: { title: string; detail: string; date: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-1.5 h-3 w-3 shrink-0 rounded-full bg-emerald-500" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="text-sm capitalize text-slate-500">{detail}</p>
      </div>
      <span className="shrink-0 text-sm text-slate-500">{date}</span>
    </li>
  );
}
