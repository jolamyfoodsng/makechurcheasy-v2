/**
 * Reads the same country pricing used by checkout.
 *
 * The server is the source of truth. It uses the authenticated user's saved
 * country, then applies the configured country/region fallback rules. This
 * keeps the amount shown here identical to the amount sent to a provider.
 */
import { useCallback, useEffect, useState } from "react";
import type { ResolvedPricing } from "./pricing/pricing";
import { useAuth } from "@/contexts/AuthContext";

interface UseLocalizedPricingResult {
  pricing: ResolvedPricing | null;
  loading: boolean;
  error: string | null;
  getPlanPrice: (plan: "basic" | "growth" | "pro", cycle: "monthly" | "yearly") => number;
  getIntroPrice: (plan: "basic" | "growth" | "pro") => number | undefined;
  /** True when the server has a real price for this plan (Pro usually has none: it is sold by contact). */
  hasPlanPrice: (plan: "basic" | "growth" | "pro") => boolean;
  formatPrice: (amount: number) => string;
  rawCurrency: string;
}

export function useLocalizedPricing(): UseLocalizedPricingResult {
  const { mongoUser } = useAuth();
  const [pricing, setPricing] = useState<ResolvedPricing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function resolve() {
      try {
        const response = await fetch("/api/pricing/country", {
          credentials: "include",
          cache: "no-store",
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.plans || !data?.currency) {
          throw new Error("Could not load country pricing");
        }

        // The plans page defaults to Flutterwave. The API resolves this
        // server-side so unsupported countries display and pay in USD instead
        // of showing a local currency Flutterwave cannot process.
        const resolvedData = data.flutterwave || data;
        const basic = resolvedData.plans.basic || {};
        const growth = resolvedData.plans.growth || {};
        const pro = resolvedData.plans.pro || {};
        const region = resolvedData.region === "nigeria" || resolvedData.region === "africa" || resolvedData.region === "global"
          ? resolvedData.region
          : "global";

        const resolved: ResolvedPricing = {
          region,
          currency: String(resolvedData.currency).toUpperCase(),
          currencySymbol: typeof resolvedData.currencySymbol === "string" ? resolvedData.currencySymbol : undefined,
          prices: {
            basic: Number(basic.monthly) || 0,
            growth: Number(growth.monthly) || 0,
            // Pro is sold by contacting us: no price here means no price shown (never a made-up one).
            pro: Number(pro.monthly) || 0,
          },
          yearlyPrices: {
            basic: Number(basic.yearly) || 0,
            growth: Number(growth.yearly) || 0,
            pro: Number(pro.yearly) || 0,
          },
          introPrices: {
            basic: Number.isFinite(Number(basic.introductoryMonthly)) ? Number(basic.introductoryMonthly) : undefined,
            growth: Number.isFinite(Number(growth.introductoryMonthly)) ? Number(growth.introductoryMonthly) : undefined,
            pro: Number.isFinite(Number(pro.introductoryMonthly)) ? Number(pro.introductoryMonthly) : undefined,
          },
          country: typeof resolvedData.countryCode === "string" ? resolvedData.countryCode : undefined,
          countryName: typeof resolvedData.countryName === "string" ? resolvedData.countryName : undefined,
          converted: false,
        };

        if (!cancelled) setPricing(resolved);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load pricing");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    resolve();
    return () => {
      cancelled = true;
    };
  }, [mongoUser?._id, mongoUser?.country]);

  const getPlanPrice = useCallback(
    (plan: "basic" | "growth" | "pro", cycle: "monthly" | "yearly"): number => {
      if (!pricing) return 0;
      if (cycle === "yearly" && pricing.yearlyPrices?.[plan] != null) {
        return pricing.yearlyPrices[plan];
      }
      return pricing.prices[plan] || 0;
    },
    [pricing],
  );

  const hasPlanPrice = useCallback(
    (plan: "basic" | "growth" | "pro"): boolean => (pricing?.prices[plan] ?? 0) > 0,
    [pricing],
  );

  const getIntroPrice = useCallback(
    (plan: "basic" | "growth" | "pro"): number | undefined => pricing?.introPrices[plan],
    [pricing],
  );

  const formatPrice = useCallback(
    (amount: number): string => {
      if (!pricing) return "...";
      const formatted = amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
      return pricing.currencySymbol
        ? `${pricing.currencySymbol}${formatted}`
        : `${formatted} ${pricing.currency}`;
    },
    [pricing],
  );

  return {
    pricing,
    loading,
    error,
    getPlanPrice,
    getIntroPrice,
    hasPlanPrice,
    formatPrice,
    rawCurrency: pricing?.currency || "USD",
  };
}
