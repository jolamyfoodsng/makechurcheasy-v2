"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Coins,
  CreditCard,
  Gift,
  Loader2,
  ShieldCheck,
  Star,
  X,
} from "lucide-react";
import { useSubscription } from "@/lib/useSubscription";
import { useLocalizedPricing } from "@/lib/useLocalizedPricing";
import { Card, Badge } from "@/components/ui";
import { trackProductEvent } from "@/lib/productTracking";
import { requestCountrySelection } from "@/components/ProfileCompletionModal";

type BillingCycle = "monthly" | "yearly";
type PublicPlan = "free" | "basic" | "growth" | "pro";
type PaidPlan = Exclude<PublicPlan, "free">;
type PaymentMethod = "flutterwave" | "nowpayments";

/** What changing plan / billing cycle costs now, with the unused time of the current plan credited. */
type PlanChangeQuote = {
  eligible: boolean;
  reason?: string;
  currentPlan?: "basic" | "growth";
  currentCycle?: BillingCycle;
  newPlan: "basic" | "growth";
  newCycle: BillingCycle;
  currency: string;
  currencySymbol?: string;
  daysLeft: number;
  newPrice: number;
  creditValue: number;
  creditApplied: number;
  amountDue: number;
  coversAll: boolean;
  extraDays: number;
  newExpiresAt: string;
};

type EligibleSpecialOffer = {
  id: string;
  name: string;
  description: string;
  badgeText: string;
  ctaText: string;
  kind: "one_time" | "discounted_subscription";
  plan: PaidPlan;
  billingCycle: "monthly" | "yearly" | "lifetime";
  purchaseKind: "subscription" | "one_time";
  price: number;
  originalPrice: number;
  discountPercent: number | null;
  discountDurationMonths: number | null;
  discountAmount: number;
  currency: string;
  currencySymbol: string;
  endsAt: string | null;
  accountAgeDays: number | null;
};

const PLAN_NAMES: Record<PublicPlan, string> = {
  free: "Free",
  basic: "Basic",
  growth: "Growth",
  pro: "Pro",
};

// Features synchronized word-for-word from /pricing
const PLAN_COPY: Record<PublicPlan, { subtitle: string; badge?: string; inherits?: string; features: string[] }> = {
  free: {
    subtitle: "Explore the essentials for your next service.",
    features: [
      "Up to 10 songs, lyrics & media",
      "5 Bible versions",
      "30-minute speech-to-scripture trial",
      "Free EW / ProPresenter import",
    ],
  },
  basic: {
    subtitle: "A simpler setup for your weekly services.",
    features: [
      "Unlimited local songs, lyrics & media",
      "Unlimited lower thirds",
      "5 GB cloud storage",
      "All Bible versions",
      "Automatic OBS scenes & sources",
      "OBS Multistream (10 hrs/mo — no extra plugin needed)",
      "4 speech-to-scripture hours / month",
      "Free EW / ProPresenter import",
    ],
  },
  growth: {
    subtitle: "Keep your operators and content connected.",
    badge: "For growing teams",
    inherits: "Everything in Basic, plus:",
    features: [
      "OBS Multistream (20 hrs/mo — YouTube & Facebook together)",
      "20 GB cloud storage for songs, lyrics & media",
      "Cloud sync across operators",
      "Mobile control app",
      "Sermon notes export",
      "10 speech-to-scripture hours / month",
      "Priority support",
    ],
  },
  pro: {
    subtitle: "One connected workflow across your campuses.",
    badge: "Multi-Campus",
    inherits: "Everything in Growth, plus:",
    features: [
      "OBS Multistream (40 hrs/mo — multi-platform broadcasting)",
      "50 GB cloud storage",
      "Unlimited multi-campus content sync",
      "20 speech-to-scripture hours / month",
      "Full phone support & direct line",
      "Online remote laptop control — coming soon",
    ],
  },
};

function normalizePublicPlan(plan?: string | null): PublicPlan {
  const value = String(plan || "free").toLowerCase();
  if (value === "basic") return "basic";
  if (value === "growth") return "growth";
  if (value === "pro") return "pro";
  return "free";
}

function formatOfferAmount(amount: number, currency: string, symbol: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${symbol}${amount.toLocaleString()}`;
  }
}

function getLocalPaymentMethods(countryCode?: string, currency?: string) {
  const country = String(countryCode || "").toUpperCase();
  const code = String(currency || "").toUpperCase();
  if (country === "NG" || code === "NGN") return "Cards, Bank Transfer, USSD";
  if (country === "GH" || code === "GHS") return "Cards, Bank Transfer, Mobile Money (MTN, Telecel, AirtelTigo)";
  if (country === "KE" || code === "KES") return "Cards, Bank Transfer, M-Pesa";
  if (country === "ZA" || code === "ZAR") return "Cards & Instant EFT";
  if (country === "EG" || code === "EGP") return "Cards & Fawry";
  if (country === "ET" || code === "ETB") return "Cards & Amole Money";
  if (country === "RW" || code === "RWF") return "Cards & Mobile Money (MTN, M-Pesa)";
  if (country === "UG" || code === "UGX") return "Cards, Bank Transfer, Mobile Money (MTN, Airtel)";
  if (country === "TZ" || code === "TZS") return "Cards, Bank Transfer, Mobile Money";
  if (country === "ZM" || code === "ZMW") return "Cards, Bank Transfer, M-Pesa";
  if (country === "CM" || code === "XAF") return "Cards & Mobile Money (MTN, Orange)";
  if (country === "CI" || code === "XOF") return "Cards & Mobile Money (Orange, Wave, MTN)";
  if (country === "SN" || code === "XOF") return "Cards & Mobile Money (Orange, Wave)";
  if (country === "GB" || code === "GBP") return "Cards, Apple Pay & Google Pay";
  if (country === "CA" || code === "CAD") return "Cards, Apple Pay & Google Pay";
  if (country === "US") return "Cards, Apple Pay & Google Pay";
  if (code === "EUR") return "Cards & SEPA Transfer";
  if (code === "USD") return "International Cards (USD)";
  return "Cards & local bank transfer";
}

export default function ComparePlansPage() {
  const pricing = useLocalizedPricing();
  const { plan: currentPlan, isOnTrial, trialDaysLeft, subscription } = useSubscription();
  const [billing, setBilling] = useState<BillingCycle>("monthly");
  const [promoCode, setPromoCode] = useState("");
  const [upgradingState, setUpgradingState] = useState<{
    plan: PaidPlan;
    method: PaymentMethod;
  } | null>(null);
  const [offerCheckout, setOfferCheckout] = useState<{
    offerId: string;
    method: PaymentMethod;
  } | null>(null);
  const [offers, setOffers] = useState<EligibleSpecialOffer[]>([]);
  const [offersLoading, setOffersLoading] = useState(true);
  const [error, setError] = useState("");
  const [quotes, setQuotes] = useState<Record<string, PlanChangeQuote | null>>({});
  const [nowPaymentsEnabled, setNowPaymentsEnabled] = useState(false);
  const [nowPaymentsConfigLoaded, setNowPaymentsConfigLoaded] = useState(false);
  const [flutterwaveEnabled, setFlutterwaveEnabled] = useState(false);
  const [flutterwaveConfigLoaded, setFlutterwaveConfigLoaded] = useState(false);
  const [validatedDiscount, setValidatedDiscount] = useState<{
    code: string;
    percentOff: number;
    durationMonths: number;
    discountAmount: number;
    finalAmount: number;
    originalAmount: number;
  } | null>(null);
  const [discountChecking, setDiscountChecking] = useState(false);
  const [discountError, setDiscountError] = useState("");

  const currentPlanKey = normalizePublicPlan(currentPlan);
  const plans: PaidPlan[] = ["basic", "growth", "pro"];
  const currentCycle: BillingCycle = subscription?.billingCycle === "yearly" ? "yearly" : "monthly";
  const hasPaidPlan = !isOnTrial && (currentPlanKey === "basic" || currentPlanKey === "growth");

  // With a paid plan, ask what each change costs: the days left on it are credited.
  useEffect(() => {
    if (!hasPaidPlan) return;
    let cancelled = false;
    for (const plan of ["basic", "growth"] as const) {
      const key = `${plan}:${billing}`;
      fetch(`/api/payments/plan-change/quote?plan=${plan}&billingCycle=${billing}`, { credentials: "include", cache: "no-store" })
        .then(async (res) => (res.ok ? ((await res.json()) as PlanChangeQuote) : null))
        .catch(() => null)
        .then((quote) => {
          if (!cancelled) setQuotes((current) => ({ ...current, [key]: quote }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [hasPaidPlan, billing, currentPlanKey, currentCycle]);
  const isNigerian = pricing.pricing?.country?.toUpperCase() === "NG";
  const localMethods = getLocalPaymentMethods(pricing.pricing?.country, pricing.pricing?.currency);

  const flutterwaveReady = flutterwaveConfigLoaded && flutterwaveEnabled;
  const nowPaymentsReady = nowPaymentsConfigLoaded && nowPaymentsEnabled;
  const isAnyUpgrading = Boolean(upgradingState || offerCheckout);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("promo") || params.get("code") || params.get("discount") || "";
    if (code) setPromoCode(code.toUpperCase().replace(/[^A-Z0-9_-]/g, ""));
    const urlBilling = params.get("billing");
    if (urlBilling === "monthly" || urlBilling === "yearly") {
      setBilling(urlBilling);
    }
  }, []);

  useEffect(() => {
    if (!promoCode.trim()) {
      setValidatedDiscount(null);
      setDiscountError("");
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setDiscountChecking(true);
      setDiscountError("");
      try {
        const res = await fetch("/api/discounts/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            code: promoCode.trim(),
            plan: "growth",
            billingCycle: billing,
          }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setDiscountError(data.error || "Invalid discount code");
          setValidatedDiscount(null);
        } else if (data.discount) {
          setValidatedDiscount(data.discount);
          setDiscountError("");
        }
      } catch {
        if (!cancelled) {
          setDiscountError("Could not validate discount code");
          setValidatedDiscount(null);
        }
      } finally {
        if (!cancelled) setDiscountChecking(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [promoCode, billing]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/payments/flutterwave/config", { credentials: "include", cache: "no-store" })
      .then(async (res) => (res.ok ? res.json() : { enabled: false }))
      .then((data) => {
        if (cancelled) return;
        setFlutterwaveEnabled(data?.enabled === true);
        setFlutterwaveConfigLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setFlutterwaveEnabled(false);
        setFlutterwaveConfigLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    trackProductEvent("paywall_viewed", {
      surface: "subscription_plans",
      currentPlan: currentPlanKey,
      isOnTrial,
    });
  }, [currentPlanKey, isOnTrial]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/payments/nowpayments/config", { credentials: "include", cache: "no-store" })
      .then(async (res) => (res.ok ? res.json() : { enabled: false }))
      .then((data) => {
        if (cancelled) return;
        setNowPaymentsEnabled(data?.enabled === true);
        setNowPaymentsConfigLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setNowPaymentsEnabled(false);
        setNowPaymentsConfigLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const initializePayment = async (body: Record<string, unknown>) => {
    let promptedForCountry = false;

    while (true) {
      const res = await fetch("/api/payments/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok || data?.code !== "COUNTRY_REQUIRED" || promptedForCountry) {
        return { res, data };
      }

      promptedForCountry = true;
      setError("");
      await requestCountrySelection();
    }
  };

  const startNowPaymentsPayment = async (payload: {
    plan: PaidPlan;
    billingCycle: EligibleSpecialOffer["billingCycle"] | BillingCycle;
    offerId?: string;
  }) => {
    const { res, data } = await initializePayment({
      paymentMethod: "nowpayments",
      plan: payload.plan,
      billingCycle: payload.billingCycle,
      ...(payload.offerId ? { offerId: payload.offerId } : {}),
      ...(promoCode.trim() ? { discountCode: promoCode.trim() } : {}),
    });
    if (!res.ok || !data.authorization_url || data.paymentMethod !== "nowpayments") {
      throw new Error(data.error || "Could not start crypto checkout");
    }
    try {
      localStorage.setItem(
        "mce_pending_payment",
        JSON.stringify({
          type: "subscription",
          paymentMethod: "nowpayments",
          reference: data.reference,
          planId: data.plan || payload.plan,
          billingCycle: data.billingCycle || payload.billingCycle,
          offerId: payload.offerId,
          purchaseKind: data.purchaseKind,
        }),
      );
    } catch {
      // Best effort only.
    }
    window.location.href = data.authorization_url;
  };

  const startFlutterwavePayment = async (payload: {
    plan: PaidPlan;
    billingCycle: EligibleSpecialOffer["billingCycle"] | BillingCycle;
    offerId?: string;
  }) => {
    const { res, data } = await initializePayment({
      paymentMethod: "flutterwave",
      plan: payload.plan,
      billingCycle: payload.billingCycle,
      ...(payload.offerId ? { offerId: payload.offerId } : {}),
      ...(promoCode.trim() ? { discountCode: promoCode.trim() } : {}),
    });
    if (!res.ok || !data.authorization_url || data.paymentMethod !== "flutterwave") {
      throw new Error(data.error || "Could not start Flutterwave checkout");
    }
    try {
      localStorage.setItem(
        "mce_pending_payment",
        JSON.stringify({
          type: "subscription",
          paymentMethod: "flutterwave",
          reference: data.reference,
          planId: data.plan || payload.plan,
          billingCycle: data.billingCycle || payload.billingCycle,
          offerId: payload.offerId,
          purchaseKind: data.purchaseKind,
        }),
      );
    } catch {
      // Best effort only.
    }
    window.location.href = data.authorization_url;
  };

  useEffect(() => {
    let cancelled = false;
    async function loadOffers() {
      try {
        const res = await fetch("/api/special-offers/eligible", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setOffers(Array.isArray(data.offers) ? data.offers : []);
      } catch {
        // Normal pricing still works if offers cannot load.
      } finally {
        if (!cancelled) setOffersLoading(false);
      }
    }
    loadOffers();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleUpgrade = async (plan: PaidPlan, paymentMethod: PaymentMethod) => {
    setError("");
    setUpgradingState({ plan, method: paymentMethod });
    trackProductEvent("checkout_started", {
      plan,
      billingCycle: billing,
      paymentMethod,
      surface: "subscription_plans",
    });
    try {
      if (paymentMethod === "nowpayments") {
        await startNowPaymentsPayment({ plan, billingCycle: billing });
        return;
      }
      await startFlutterwavePayment({ plan, billingCycle: billing });
    } catch (e) {
      trackProductEvent("payment_failed", {
        plan,
        billingCycle: billing,
        paymentMethod,
        surface: "subscription_plans",
      });
      setError(e instanceof Error ? e.message : "Failed to start payment");
      setUpgradingState(null);
    }
  };

  /** The credit covers the new plan: nothing to pay, the server switches the plan now. */
  const handleCreditSwitch = async (plan: PaidPlan, quote: PlanChangeQuote) => {
    const label = PLAN_NAMES[plan];
    const sure = window.confirm(
      `Switch to ${label} now? Your unused ${PLAN_NAMES[currentPlanKey]} time covers it, so there is nothing to pay. ` +
      `${label} features start immediately and any ${PLAN_NAMES[currentPlanKey]}-only features stop.`,
    );
    if (!sure) return;
    setError("");
    setUpgradingState({ plan, method: "flutterwave" });
    try {
      const { res, data } = await initializePayment({
        paymentMethod: "flutterwave",
        plan,
        billingCycle: quote.newCycle,
      });
      if (!res.ok || data?.switched !== true) {
        throw new Error(data?.error || "Could not switch your plan");
      }
      trackProductEvent("plan_changed_with_credit", { plan, billingCycle: quote.newCycle, surface: "subscription_plans" });
      window.location.assign("/subscription?switched=1");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not switch your plan");
      setUpgradingState(null);
    }
  };

  const handleOfferCheckout = async (offer: EligibleSpecialOffer, paymentMethod: PaymentMethod) => {
    setError("");
    setOfferCheckout({ offerId: offer.id, method: paymentMethod });
    trackProductEvent("checkout_started", {
      plan: offer.plan,
      billingCycle: offer.billingCycle,
      paymentMethod,
      offerId: offer.id,
      surface: "special_offer",
    });
    try {
      if (paymentMethod === "nowpayments") {
        await startNowPaymentsPayment({ plan: offer.plan, billingCycle: offer.billingCycle, offerId: offer.id });
        return;
      }
      await startFlutterwavePayment({ plan: offer.plan, billingCycle: offer.billingCycle, offerId: offer.id });
    } catch (e) {
      trackProductEvent("payment_failed", {
        plan: offer.plan,
        billingCycle: offer.billingCycle,
        paymentMethod,
        offerId: offer.id,
        surface: "special_offer",
      });
      setError(e instanceof Error ? e.message : "Failed to start payment");
      setOfferCheckout(null);
    }
  };

  if (pricing.loading) {
    return (
      <div className="flex w-full items-center justify-center px-6 py-24">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 p-6 pb-20 md:p-8">
      {/* Top Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-extrabold tracking-tight text-slate-900">Compare Plans</h1>
          <p className="text-sm text-slate-500">
            Choose the plan that fits your church media team.{" "}
            <Link href="/subscription" className="font-semibold text-[#0238E9] hover:underline">
              Your plan &amp; billing
            </Link>
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:items-end">
          <label className="flex h-10 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-600 shadow-2xs">
            <span className="mr-2 text-xs font-bold uppercase tracking-wider text-slate-400">Code</span>
            <input
              value={promoCode}
              onChange={(event) => setPromoCode(event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))}
              placeholder="DISCOUNT"
              className="w-28 bg-transparent text-sm font-semibold uppercase text-slate-900 outline-none placeholder:text-slate-300"
            />
          </label>
          <div className="flex items-center gap-2.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Billing:</span>
            <div className="flex rounded-xl bg-slate-100 p-1">
              {(["monthly", "yearly"] as BillingCycle[]).map((cycle) => (
                <button
                  key={cycle}
                  onClick={() => setBilling(cycle)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold capitalize transition-all ${
                    billing === cycle
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-500 hover:text-slate-900"
                  }`}
                  type="button"
                >
                  {cycle}
                  {cycle === "yearly" && (
                    <span className="ml-1 text-[10px] font-extrabold text-emerald-600">Save 2mo</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {validatedDiscount && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50/90 px-4 py-3 text-sm text-emerald-900 shadow-2xs">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white font-extrabold text-xs shadow-xs">
              %
            </span>
            <div>
              <p className="font-bold text-emerald-950">
                Promo Code Applied: <span className="font-mono bg-emerald-100 px-1.5 py-0.5 rounded text-emerald-800">{validatedDiscount.code}</span> ({validatedDiscount.percentOff}% off)
              </p>
              <p className="text-xs text-emerald-700 mt-0.5">
                Enjoy {validatedDiscount.percentOff}% off for {validatedDiscount.durationMonths} month{validatedDiscount.durationMonths > 1 ? "s" : ""}. The discount is automatically applied to your checkout below.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setPromoCode("");
              setValidatedDiscount(null);
            }}
            className="text-xs text-emerald-700 hover:text-emerald-950 font-semibold underline shrink-0 px-2 py-1"
          >
            Remove
          </button>
        </div>
      )}

      {discountError && promoCode && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-800">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" /> {discountError}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          <X className="h-4 w-4" /> {error}
        </div>
      )}

      {/* Special Offers Section */}
      {!offersLoading && offers.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Available Offers</h2>
            <p className="mt-1 text-sm text-slate-500">
              These offers are based on your account history and may not be available later.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {offers.map((offer) => {
              const original = offer.originalPrice > offer.price ? offer.originalPrice : 0;
              const billingLabel = offer.purchaseKind === "one_time"
                ? "one-time payment"
                : offer.billingCycle === "yearly"
                  ? "first yearly payment"
                  : "first monthly payment";
              return (
                <Card key={offer.id} padding="lg" className="border-blue-200 bg-blue-50/40">
                  <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <Badge variant="info" size="sm">
                          <Gift className="mr-1 h-3 w-3" />
                          {offer.badgeText}
                        </Badge>
                        {offer.discountPercent ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                            {offer.discountPercent}% off
                          </span>
                        ) : null}
                      </div>
                      <h3 className="text-xl font-bold text-slate-900">{offer.name}</h3>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{offer.description}</p>
                      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs font-medium text-slate-500">
                        <span>{PLAN_NAMES[offer.plan]} access</span>
                        {offer.accountAgeDays != null && (
                          <span>{Math.floor(offer.accountAgeDays / 30)} months with MakeChurchEazy</span>
                        )}
                        {offer.endsAt && (
                          <span className="inline-flex items-center gap-1">
                            <Clock3 className="h-3.5 w-3.5" />
                            Ends {new Date(offer.endsAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0 rounded-xl border border-slate-200 bg-white p-4 md:w-64 space-y-2.5 shadow-2xs">
                      <div className="mb-2">
                        {original ? (
                          <p className="text-sm font-semibold text-slate-400 line-through">
                            {formatOfferAmount(original, offer.currency, offer.currencySymbol)}
                          </p>
                        ) : null}
                        <p className="text-3xl font-extrabold text-slate-900">
                          {formatOfferAmount(offer.price, offer.currency, offer.currencySymbol)}
                        </p>
                        <p className="mt-1 text-xs font-medium text-slate-500">{billingLabel}</p>
                      </div>

                      {/* Cash / Card Option */}
                      <button
                        type="button"
                        disabled={isAnyUpgrading || !flutterwaveReady}
                        onClick={() => handleOfferCheckout(offer, "flutterwave")}
                        className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#0238E9] hover:bg-[#012CAE] px-3 py-2.5 text-xs font-bold text-white shadow-2xs transition-colors disabled:opacity-50"
                      >
                        {offerCheckout?.offerId === offer.id && offerCheckout.method === "flutterwave" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CreditCard className="h-3.5 w-3.5 shrink-0" />
                        )}
                        <span>Pay with Cash / Card</span>
                      </button>

                      {/* Crypto Option */}
                      <button
                        type="button"
                        disabled={isAnyUpgrading || !nowPaymentsReady}
                        onClick={() => handleOfferCheckout(offer, "nowpayments")}
                        className="w-full flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors disabled:opacity-50"
                      >
                        {offerCheckout?.offerId === offer.id && offerCheckout.method === "nowpayments" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-600" />
                        ) : (
                          <Coins className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                        )}
                        <span>Pay with Crypto</span>
                      </button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {/* Plans Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {plans.map((planKey) => {
          const isCurrent = currentPlanKey === planKey;
          const isPaidCurrent = !isOnTrial && isCurrent;
          // Same plan on the same billing cycle: nothing to change. Another cycle (monthly/yearly) or
          // another plan, up or down, is a change with credit for the unused time.
          const isSamePlanAndCycle = isPaidCurrent && billing === currentCycle;
          const changeQuote = hasPaidPlan && !isSamePlanAndCycle && (planKey === "basic" || planKey === "growth")
            ? quotes[`${planKey}:${billing}`]
            : null;
          const quoteLoading = hasPaidPlan && !isSamePlanAndCycle && (planKey === "basic" || planKey === "growth") && quotes[`${planKey}:${billing}`] === undefined;
          const creditQuote = changeQuote?.eligible ? changeQuote : null;
          const isBlockedByHigherPlan = !isOnTrial && currentPlanKey === "pro" && (planKey === "basic" || planKey === "growth");
          const isGrowth = planKey === "growth";
          const isPro = planKey === "pro";
          const price = pricing.getPlanPrice(planKey, billing);
          // Pro is sold by contact until it has a price: no price, no pay buttons.
          const contactOnly = !pricing.hasPlanPrice(planKey);
          const monthlyEquivalent = billing === "yearly" ? price / 12 : price;
          const paidPeriodDays = billing === "yearly" ? 365 : 30;
          const nextPaymentInDays = paidPeriodDays + trialDaysLeft;
          const introPrice = billing === "monthly" ? pricing.getIntroPrice(planKey) : undefined;
          const isDiscountApplicable = Boolean(validatedDiscount);
          const discountedPrice = isDiscountApplicable && validatedDiscount
            ? Math.max(1, Math.round(price * (100 - validatedDiscount.percentOff)) / 100)
            : price;
          const discountedMonthlyEquivalent = billing === "yearly" ? discountedPrice / 12 : discountedPrice;

          const planCopy = PLAN_COPY[planKey];
          const isUpgradingThisPlanCash = upgradingState?.plan === planKey && upgradingState.method === "flutterwave";
          const isUpgradingThisPlanCrypto = upgradingState?.plan === planKey && upgradingState.method === "nowpayments";

          return (
            <div
              key={planKey}
              className={`relative flex min-h-[500px] flex-col justify-between rounded-2xl bg-white p-7 transition-all ${
                isGrowth
                  ? "border-2 border-[#0238E9] shadow-[0_4px_24px_-2px_rgba(2,56,233,0.14)]"
                  : "border border-slate-200 shadow-2xs hover:border-slate-300 hover:shadow-xs"
              }`}
            >
              <div>
                {/* Growth Recommended Badge */}
                {isGrowth && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EFF6FF] border border-[#BFDBFE] px-3.5 py-0.5 text-xs font-bold text-[#0238E9] shadow-xs whitespace-nowrap">
                      <Star className="h-3 w-3 fill-[#0238E9] text-[#0238E9]" /> For growing teams
                    </span>
                  </div>
                )}

                {/* Pro Multi-Campus Badge */}
                {isPro && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 px-3 py-0.5 text-xs font-bold text-slate-700 shadow-2xs whitespace-nowrap">
                      Multi-Campus
                    </span>
                  </div>
                )}

                {/* Current Plan Badge */}
                {(isCurrent || (isOnTrial && isGrowth)) && (
                  <div className="absolute right-4 top-4">
                    <Badge variant={isOnTrial && isGrowth ? "warning" : "success"} size="sm">
                      {isOnTrial && isGrowth ? "Growth Trial" : "Current Plan"}
                    </Badge>
                  </div>
                )}

                {/* Plan Header */}
                <div className="mb-4">
                  <h3 className="text-2xl font-extrabold tracking-tight text-slate-900">{PLAN_NAMES[planKey]}</h3>
                  <p className="mt-1 text-sm text-slate-500 leading-snug">{planCopy.subtitle}</p>
                </div>

                {/* Price Display */}
                <div className="mb-6">
                  {contactOnly ? (
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-3xl font-black text-slate-900 tracking-tight">Let&apos;s talk</span>
                    </div>
                  ) : (
                  <div className="flex items-baseline gap-1.5">
                    {isDiscountApplicable ? (
                      <>
                        <span className="text-xl font-bold text-slate-400 line-through">
                          {pricing.formatPrice(monthlyEquivalent)}
                        </span>
                        <span className="text-4xl font-extrabold text-emerald-600">
                          {pricing.formatPrice(discountedMonthlyEquivalent)}
                        </span>
                        <span className="text-sm font-medium text-slate-500">
                          /month
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-4xl font-black text-slate-900 tracking-tight">
                          {pricing.formatPrice(monthlyEquivalent)}
                        </span>
                        <span className="text-sm font-medium text-slate-500">
                          /month
                        </span>
                      </>
                    )}
                  </div>

                  )}

                  {contactOnly ? (
                    <p className="mt-1 text-xs text-slate-500 font-medium">Pricing for multi-campus teams</p>
                  ) : isDiscountApplicable && validatedDiscount ? (
                    <p className="mt-1 text-xs font-semibold text-emerald-600">
                      🎉 {validatedDiscount.percentOff}% off for {validatedDiscount.durationMonths} month{validatedDiscount.durationMonths > 1 ? "s" : ""}
                    </p>
                  ) : billing === "yearly" ? (
                    <p className="mt-1 text-xs text-slate-500 font-medium">
                      {pricing.formatPrice(price)} billed annually
                    </p>
                  ) : null}

                  {!contactOnly && !isDiscountApplicable && introPrice && introPrice < price && (
                    <p className="mt-1 text-xs font-semibold text-emerald-600">
                      {pricing.formatPrice(introPrice)} first month
                    </p>
                  )}
                </div>

                {/* Feature Highlights from /pricing */}
                <div className="mb-8 space-y-2.5">
                  {"inherits" in planCopy && planCopy.inherits && (
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                      {planCopy.inherits}
                    </p>
                  )}
                  {planCopy.features.map((feature) => (
                    <FeatureLine key={feature} label={feature} />
                  ))}
                </div>
              </div>

              {/* Action Buttons: Pay with Cash / Pay with Crypto */}
              <div className="pt-5 border-t border-slate-100 space-y-2.5">
                {contactOnly && !isPaidCurrent ? (
                  <a
                    href="mailto:support@makechurcheazy.com?subject=MakeChurchEazy%20Pro%20plan"
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0238E9] px-4 py-3 text-sm font-bold text-white shadow-xs transition-all hover:bg-[#012CAE]"
                  >
                    Contact us about Pro
                  </a>
                ) : isSamePlanAndCycle ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 text-center">
                    <span className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-800">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      Current Plan
                    </span>
                  </div>
                ) : isBlockedByHigherPlan ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-center">
                    <span className="text-xs font-semibold text-slate-500">
                      Included in Your Active Plan
                    </span>
                  </div>
                ) : creditQuote?.coversAll ? (
                  <>
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-xs leading-5 text-emerald-900">
                      <p className="font-bold">Nothing to pay</p>
                      <p>
                        Your {creditQuote.daysLeft} unused days on {PLAN_NAMES[currentPlanKey]} are worth{" "}
                        {pricing.formatPrice(creditQuote.creditValue)}, which covers {PLAN_NAMES[planKey]}.
                        {creditQuote.extraDays > 0 ? ` The rest adds ${creditQuote.extraDays} extra days.` : ""}{" "}
                        {PLAN_NAMES[planKey]} runs until {new Date(creditQuote.newExpiresAt).toLocaleDateString()}.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={isAnyUpgrading}
                      onClick={() => void handleCreditSwitch(planKey, creditQuote)}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0238E9] px-4 py-3 text-sm font-bold text-white shadow-xs transition-all hover:bg-[#012CAE] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {upgradingState?.plan === planKey ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      <span>{upgradingState?.plan === planKey ? "Switching..." : `Switch to ${PLAN_NAMES[planKey]} now`}</span>
                    </button>
                  </>
                ) : (
                  <>
                    {creditQuote && (
                      <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-xs leading-5 text-blue-950">
                        <p className="font-bold">Pay {pricing.formatPrice(creditQuote.amountDue)} today</p>
                        <p>
                          {pricing.formatPrice(creditQuote.newPrice)} minus {pricing.formatPrice(creditQuote.creditValue)} credit
                          for your {creditQuote.daysLeft} unused days on {PLAN_NAMES[currentPlanKey]}.
                        </p>
                      </div>
                    )}
                    {quoteLoading && (
                      <p className="text-center text-[11px] font-medium text-slate-400">Working out your credit…</p>
                    )}
                    {/* Primary Button: Pay with Cash / Card */}
                    <div>
                      <button
                        type="button"
                        disabled={isAnyUpgrading || !flutterwaveReady || quoteLoading}
                        onClick={() => handleUpgrade(planKey, "flutterwave")}
                        className="w-full flex items-center justify-center gap-2 rounded-xl py-3 px-4 text-sm font-bold text-white shadow-xs transition-all bg-[#0238E9] hover:bg-[#012CAE] active:bg-[#012596] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                      >
                        {isUpgradingThisPlanCash ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin text-white" />
                            <span>Processing...</span>
                          </>
                        ) : (
                          <>
                            <CreditCard className="h-4 w-4 shrink-0" />
                            <span>{creditQuote ? `Pay ${pricing.formatPrice(creditQuote.amountDue)} with Cash / Card` : "Pay with Cash / Card"}</span>
                          </>
                        )}
                      </button>
                      <p className="mt-1 text-center text-[11px] text-slate-400 font-medium">
                        {isNigerian ? "Cards, Bank Transfer, USSD" : localMethods} · Flutterwave
                      </p>
                    </div>

                    {/* Secondary Button: Pay with Crypto (not for plan changes with credit) */}
                    {!creditQuote && (
                    <div>
                      <button
                        type="button"
                        disabled={isAnyUpgrading || !nowPaymentsReady || quoteLoading}
                        onClick={() => handleUpgrade(planKey, "nowpayments")}
                        className="w-full flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 px-4 text-sm font-semibold text-slate-700 shadow-2xs transition-all hover:bg-slate-50 hover:border-slate-300 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                      >
                        {isUpgradingThisPlanCrypto ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin text-slate-600" />
                            <span>Connecting Crypto...</span>
                          </>
                        ) : (
                          <>
                            <Coins className="h-4 w-4 shrink-0 text-amber-500" />
                            <span>Pay with Crypto</span>
                          </>
                        )}
                      </button>
                      <p className="mt-1 text-center text-[11px] text-slate-400 font-medium">
                        BTC, ETH, USDT & more · NOWPayments
                      </p>
                    </div>
                    )}

                    <div className="pt-1 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                      <span>Instant activation · Secure checkout</span>
                    </div>
                  </>
                )}

                {isOnTrial && trialDaysLeft > 0 && !isPaidCurrent && (
                  <p className="mt-2 text-center text-[11px] leading-4 text-slate-500">
                    Your {trialDaysLeft} trial days will be added to your subscription.
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Feature Comparison Table Synchronized from /pricing */}
      <section className="pt-8">
        <div className="mb-4">
          <h2 className="text-xl font-extrabold tracking-tight text-slate-900">Feature Comparison</h2>
          <p className="text-sm text-slate-500">
            Compare all features and capabilities side-by-side.
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80">
                  <th scope="col" className="px-5 py-3.5 text-xs font-bold uppercase tracking-wider text-slate-500">
                    Feature
                  </th>
                  <th scope="col" className="px-5 py-3.5 text-center text-xs font-bold uppercase tracking-wider text-slate-700">
                    Basic
                  </th>
                  <th scope="col" className="bg-[#EFF6FF]/70 px-5 py-3.5 text-center text-xs font-bold uppercase tracking-wider text-[#0238E9]">
                    Growth
                  </th>
                  <th scope="col" className="px-5 py-3.5 text-center text-xs font-bold uppercase tracking-wider text-slate-700">
                    Pro
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                <CompareRow
                  label="Monthly Pricing"
                  basic={pricing.formatPrice(pricing.getPlanPrice("basic", "monthly")) + "/mo"}
                  growth={pricing.formatPrice(pricing.getPlanPrice("growth", "monthly")) + "/mo"}
                  pro={pricing.hasPlanPrice("pro") ? pricing.formatPrice(pricing.getPlanPrice("pro", "monthly")) + "/mo" : "Contact us"}
                />
                <CompareRow
                  label="Songs, Lyrics & Media"
                  basic="Unlimited (Local)"
                  growth="Unlimited (Local + Cloud)"
                  pro="Unlimited (Multi-Campus Sync)"
                />
                <CompareRow
                  label="Lower Thirds"
                  basic="Unlimited"
                  growth="Unlimited"
                  pro="Unlimited"
                />
                <CompareRow
                  label="Cloud Storage"
                  basic="5 GB"
                  growth="20 GB"
                  pro="50 GB"
                />
                <CompareRow
                  label="OBS Multistream"
                  basic="10 Hours/mo"
                  growth="20 Hours/mo"
                  pro="40 Hours/mo"
                />
                <CompareRow
                  label="Bible Versions"
                  basic="Unlimited All"
                  growth="Unlimited All"
                  pro="Unlimited All"
                />
                <CompareRow
                  label="Auto OBS Scene & Source Creation"
                  basic={true}
                  growth={true}
                  pro={true}
                />
                <CompareRow
                  label="Speech-to-Scripture Hours"
                  basic="4 Hours/mo"
                  growth="10 Hours/mo"
                  pro="20 Hours/mo"
                />
                <CompareRow
                  label="Speech-to-Scripture Top-Ups"
                  basic="Included"
                  growth="Included"
                  pro="Included"
                />
                <CompareRow
                  label="Cloud Sync Across Operators"
                  basic={false}
                  growth={true}
                  pro="Multi-Campus"
                />
                <CompareRow
                  label="Mobile Control App"
                  basic={false}
                  growth={true}
                  pro={true}
                />
                <CompareRow
                  label="Sermon Notes Export"
                  basic={false}
                  growth={true}
                  pro={true}
                />
                <CompareRow
                  label="Support Channel"
                  basic="Standard Email"
                  growth="Priority Support"
                  pro="Full Phone & Direct Line"
                />
                <CompareRow
                  label="Online Remote Laptop Control"
                  basic={false}
                  growth={false}
                  pro="Coming Soon"
                />
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function FeatureLine({ label }: { label: string }) {
  return (
    <div className="flex items-start gap-2.5 text-sm text-slate-600">
      <CheckCircle2
        className="mt-0.5 h-4 w-4 shrink-0 text-[#0238E9]"
      />
      <span>{label}</span>
    </div>
  );
}

function CompareRow({
  label,
  basic,
  growth,
  pro,
}: {
  label: string;
  basic: string | boolean;
  growth: string | boolean;
  pro: string | boolean;
}) {
  return (
    <tr className="hover:bg-slate-50/60 transition-colors">
      <td className="px-5 py-3.5 text-sm font-medium text-slate-800">{label}</td>
      <CompareCell value={basic} />
      <CompareCell value={growth} highlighted="growth" />
      <CompareCell value={pro} />
    </tr>
  );
}

function CompareCell({
  value,
  highlighted,
}: {
  value: string | boolean;
  highlighted?: "growth";
}) {
  const bgClass =
    highlighted === "growth"
      ? "bg-[#EFF6FF]/40"
      : "";
  const textClass =
    highlighted === "growth"
      ? "text-[#0238E9] font-bold"
      : "text-slate-600";

  if (typeof value === "boolean") {
    return (
      <td className={`px-5 py-3.5 text-center ${bgClass}`}>
        {value ? (
          <CheckCircle2 className={`mx-auto h-4 w-4 ${highlighted === "growth" ? "text-[#0238E9]" : "text-emerald-500"}`} />
        ) : (
          <span className="text-slate-300 font-bold">-</span>
        )}
      </td>
    );
  }

  return (
    <td className={`px-5 py-3.5 text-center text-sm font-medium ${bgClass} ${textClass}`}>
      {value}
    </td>
  );
}
