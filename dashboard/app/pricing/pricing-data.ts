"use client";

import { useEffect, useState } from "react";
import { BookOpen, Building2, Layers, Monitor } from "lucide-react";

export interface AfricanCountryConfig {
  name: string;
  currency: string;
  symbol: string;
  basic: number;
  growth: number;
  pro: number;
}

export const AFRICAN_CURRENCIES: Record<string, AfricanCountryConfig> = {
  NG: { name: "Nigeria", currency: "NGN", symbol: "₦", basic: 2700, growth: 5500, pro: 12000 },
  GH: { name: "Ghana", currency: "GHS", symbol: "GH₵", basic: 60, growth: 120, pro: 230 },
  KE: { name: "Kenya", currency: "KES", symbol: "KSh ", basic: 500, growth: 1000, pro: 1900 },
  ZA: { name: "South Africa", currency: "ZAR", symbol: "R ", basic: 70, growth: 140, pro: 260 },
  UG: { name: "Uganda", currency: "UGX", symbol: "UGX ", basic: 15000, growth: 30000, pro: 56000 },
  TZ: { name: "Tanzania", currency: "TZS", symbol: "TSh ", basic: 12000, growth: 24000, pro: 45000 },
  RW: { name: "Rwanda", currency: "RWF", symbol: "FRw ", basic: 6000, growth: 12000, pro: 22500 },
  ZM: { name: "Zambia", currency: "ZMW", symbol: "ZK ", basic: 130, growth: 260, pro: 490 },
  CM: { name: "Cameroon", currency: "XAF", symbol: "FCFA ", basic: 3000, growth: 6000, pro: 11000 },
  CI: { name: "Côte d'Ivoire", currency: "XOF", symbol: "CFA ", basic: 3000, growth: 6000, pro: 11000 },
  SN: { name: "Senegal", currency: "XOF", symbol: "CFA ", basic: 3000, growth: 6000, pro: 11000 },
  BJ: { name: "Benin", currency: "XOF", symbol: "CFA ", basic: 3000, growth: 6000, pro: 11000 },
  BF: { name: "Burkina Faso", currency: "XOF", symbol: "CFA ", basic: 3000, growth: 6000, pro: 11000 },
  ML: { name: "Mali", currency: "XOF", symbol: "CFA ", basic: 3000, growth: 6000, pro: 11000 },
  TG: { name: "Togo", currency: "XOF", symbol: "CFA ", basic: 3000, growth: 6000, pro: 11000 },
  NE: { name: "Niger", currency: "XOF", symbol: "CFA ", basic: 3000, growth: 6000, pro: 11000 },
  GA: { name: "Gabon", currency: "XAF", symbol: "FCFA ", basic: 3000, growth: 6000, pro: 11000 },
  CG: { name: "Republic of the Congo", currency: "XAF", symbol: "FCFA ", basic: 3000, growth: 6000, pro: 11000 },
  CD: { name: "DR Congo", currency: "CDF", symbol: "FC ", basic: 8500, growth: 17000, pro: 32000 },
  TD: { name: "Chad", currency: "XAF", symbol: "FCFA ", basic: 3000, growth: 6000, pro: 11000 },
  CF: { name: "Central African Rep.", currency: "XAF", symbol: "FCFA ", basic: 3000, growth: 6000, pro: 11000 },
  GQ: { name: "Equatorial Guinea", currency: "XAF", symbol: "FCFA ", basic: 3000, growth: 6000, pro: 11000 },
  GW: { name: "Guinea-Bissau", currency: "XOF", symbol: "CFA ", basic: 3000, growth: 6000, pro: 11000 },
  EG: { name: "Egypt", currency: "EGP", symbol: "E£ ", basic: 240, growth: 480, pro: 900 },
  ET: { name: "Ethiopia", currency: "ETB", symbol: "Br ", basic: 600, growth: 1200, pro: 2250 },
  MW: { name: "Malawi", currency: "MWK", symbol: "MK ", basic: 8500, growth: 17000, pro: 32000 },
  SL: { name: "Sierra Leone", currency: "SLL", symbol: "Le ", basic: 110000, growth: 220000, pro: 410000 },
  LR: { name: "Liberia", currency: "LRD", symbol: "L$ ", basic: 600, growth: 1200, pro: 2250 },
  GM: { name: "The Gambia", currency: "GMD", symbol: "D ", basic: 200, growth: 400, pro: 750 },
  BW: { name: "Botswana", currency: "BWP", symbol: "P ", basic: 40, growth: 80, pro: 150 },
  NA: { name: "Namibia", currency: "NAD", symbol: "N$ ", basic: 70, growth: 140, pro: 260 },
  ZW: { name: "Zimbabwe", currency: "ZWG", symbol: "Z$ ", basic: 80, growth: 160, pro: 300 },
  MU: { name: "Mauritius", currency: "MUR", symbol: "Rs ", basic: 140, growth: 280, pro: 525 },
  MZ: { name: "Mozambique", currency: "MZN", symbol: "MT ", basic: 200, growth: 400, pro: 750 },
  AO: { name: "Angola", currency: "AOA", symbol: "Kz ", basic: 2700, growth: 5400, pro: 10000 },
  MG: { name: "Madagascar", currency: "MGA", symbol: "Ar ", basic: 14000, growth: 28000, pro: 52500 },
  MA: { name: "Morocco", currency: "MAD", symbol: "د.م. ", basic: 30, growth: 60, pro: 110 },
  DZ: { name: "Algeria", currency: "DZD", symbol: "دج ", basic: 400, growth: 800, pro: 1500 },
  TN: { name: "Tunisia", currency: "TND", symbol: "د.ت ", basic: 10, growth: 20, pro: 38 },
  LY: { name: "Libya", currency: "LYD", symbol: "ل.د ", basic: 15, growth: 30, pro: 56 },
  SD: { name: "Sudan", currency: "SDG", symbol: "ج.س. ", basic: 1800, growth: 3600, pro: 6750 },
  SS: { name: "South Sudan", currency: "SSP", symbol: "£ ", basic: 4000, growth: 8000, pro: 15000 },
  BI: { name: "Burundi", currency: "BIF", symbol: "FBu ", basic: 9000, growth: 18000, pro: 33500 },
  SO: { name: "Somalia", currency: "SOS", symbol: "Sh ", basic: 1700, growth: 3400, pro: 6400 },
  DJ: { name: "Djibouti", currency: "DJF", symbol: "Fdj ", basic: 530, growth: 1060, pro: 2000 },
  ER: { name: "Eritrea", currency: "ERN", symbol: "Nfk ", basic: 45, growth: 90, pro: 170 },
  SZ: { name: "Eswatini", currency: "SZL", symbol: "E ", basic: 70, growth: 140, pro: 260 },
  LS: { name: "Lesotho", currency: "LSL", symbol: "L ", basic: 70, growth: 140, pro: 260 },
  GN: { name: "Guinea", currency: "GNF", symbol: "FG ", basic: 26000, growth: 52000, pro: 97500 },
  CV: { name: "Cape Verde", currency: "CVE", symbol: "$", basic: 300, growth: 600, pro: 1100 },
  ST: { name: "São Tomé and Príncipe", currency: "STN", symbol: "Db ", basic: 70, growth: 140, pro: 260 },
  SC: { name: "Seychelles", currency: "SCR", symbol: "Rs ", basic: 45, growth: 90, pro: 170 },
  KM: { name: "Comoros", currency: "KMF", symbol: "CF ", basic: 1400, growth: 2800, pro: 5250 },
  MR: { name: "Mauritania", currency: "MRU", symbol: "UM ", basic: 120, growth: 240, pro: 450 },
};

export interface ResolvedMarketPricing {
  countryCode: string;
  countryName: string;
  currency: string;
  currencySymbol: string;
  prices: [number, number, number, number]; // [Free, Basic, Growth, Pro]
  isAfrican: boolean;
  region: "nigeria" | "africa" | "global";
}

export function getPricingForCountry(countryCode?: string | null): ResolvedMarketPricing {
  const code = (countryCode || "NG").toUpperCase().trim();

  if (code === "NG") {
    return {
      countryCode: "NG",
      countryName: "Nigeria",
      currency: "NGN",
      currencySymbol: "₦",
      prices: [0, 2700, 5500, 12000],
      isAfrican: true,
      region: "nigeria",
    };
  }

  const african = AFRICAN_CURRENCIES[code];
  if (african) {
    return {
      countryCode: code,
      countryName: african.name,
      currency: african.currency,
      currencySymbol: african.symbol,
      prices: [0, african.basic, african.growth, african.pro],
      isAfrican: true,
      region: "africa",
    };
  }

  return {
    countryCode: code || "US",
    countryName: "Global",
    currency: "USD",
    currencySymbol: "$",
    prices: [0, 7, 12, 20],
    isAfrican: false,
    region: "global",
  };
}

export const PRICING_PLANS = [
  {
    id: "free",
    name: "Free",
    icon: BookOpen,
    audience: "Explore the essentials for your next service.",
    cta: "Start free",
    href: "/signup",
    highlights: [
      "Up to 10 songs, lyrics & media",
      "5 Bible versions",
      "30-minute speech-to-scripture trial",
      "Free EW / ProPresenter import",
    ],
  },
  {
    id: "basic",
    name: "Basic",
    icon: Monitor,
    audience: "A simpler setup for your weekly services.",
    cta: "Get started with Basic",
    href: "/signup?callbackUrl=%2Fsubscription%2Fplans",
    highlights: [
      "Unlimited local songs, lyrics & media",
      "Unlimited lower thirds",
      "5 GB cloud storage",
      "All Bible versions",
      "Automatic OBS scenes & sources",
      "OBS Multistream (10 hrs/mo — no extra plugin needed)",
      "4 speech-to-scripture hours / month",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    icon: Layers,
    badge: "For growing teams",
    audience: "Keep your operators and content connected.",
    cta: "Get started with Growth",
    href: "/signup?callbackUrl=%2Fsubscription%2Fplans",
    inherits: "Everything in Basic, plus:",
    highlights: [
      "OBS Multistream (20 hrs/mo — YouTube & Facebook together)",
      "20 GB cloud storage for songs, lyrics & media",
      "Cloud sync across operators",
      "Mobile control app",
      "Sermon notes export",
      "10 speech-to-scripture hours / month",
      "Priority support",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tag: "Multi-Campus",
    icon: Building2,
    audience: "One connected workflow across your campuses.",
    cta: "Talk to us about Pro",
    href: "/contact",
    inherits: "Everything in Growth, plus:",
    highlights: [
      "OBS Multistream (40 hrs/mo — multi-platform broadcasting)",
      "50 GB cloud storage",
      "Unlimited multi-campus content sync",
      "20 speech-to-scripture hours / month",
      "Full phone support & direct line",
      "Online remote laptop control — coming soon",
    ],
  },
] as const;

export type ComparisonRow = { label: string; values: readonly (string | boolean)[] };

export const PRICING_FAQS = [
  {
    question: "Do I need an extra plugin to multistream with OBS?",
    answer: "No. With MakeChurchEazy, you don't need any third-party OBS plugins or extra encoder software. You can multistream to YouTube, Facebook, and multiple platforms at the same time directly on OBS with the app. Basic includes 10 hours per month, Growth includes 20 hours per month, and Pro includes 40 hours.",
  },
  {
    question: "Can I start with the Free plan?",
    answer: "Yes. Free includes up to 10 songs, lyrics and media items, 5 Bible versions, and a 30-minute speech-to-scripture trial. OBS scenes and sources are set up manually on Free.",
  },
  {
    question: "Which plans create my OBS scenes and sources?",
    answer: "Basic, Growth and Pro include automatic scene and source creation. Choose the content you want to present and MakeChurchEazy handles the OBS setup for its presentation workflow.",
  },
  {
    question: "What happens when I need more speech-to-scripture hours?",
    answer: "Basic includes 4 hours per month, Growth includes 10, and Pro includes 20. Hour top-ups are available on all paid plans when you need extra time.",
  },
  {
    question: "Can I bring content from EasyWorship or ProPresenter?",
    answer: "Yes. One-click EasyWorship and ProPresenter import is free on every plan, including Free.",
  },
  {
    question: "Is online remote laptop control available now?",
    answer: "Online remote laptop control is coming soon for Pro. It is separate from the mobile control app, which is included with Growth and Pro.",
  },
];

export function usePricingData(initialCountryCode?: string | null) {
  const [pricing, setPricing] = useState<ResolvedMarketPricing>(() =>
    getPricingForCountry(initialCountryCode)
  );

  useEffect(() => {
    let cancelled = false;

    async function detect() {
      try {
        const res = await fetch("/api/pricing/country", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data) return;

        const code = (data.countryCode || "").toUpperCase();
        if (code) {
          setPricing(getPricingForCountry(code));
        }
      } catch {
        // Fallback already safely in place
      }
    }

    detect();
    return () => {
      cancelled = true;
    };
  }, []);

  const formatPrice = (index: number) => {
    const val = pricing.prices[index] ?? 0;
    return `${pricing.currencySymbol}${val.toLocaleString("en-US")}`;
  };

  const comparisonRows: ComparisonRow[] = [
    {
      label: `Monthly Pricing (${pricing.currency})`,
      values: [
        formatPrice(0),
        `${formatPrice(1)}/mo`,
        `${formatPrice(2)}/mo`,
        `${formatPrice(3)}/mo`,
      ],
    },
    { label: "Songs, Lyrics & Media", values: ["Up to 10", "Unlimited (Local)", "Unlimited (Local + Cloud)", "Unlimited (Multi-Campus Sync)"] },
    { label: "Bible Versions", values: ["5 Versions", "Unlimited All", "Unlimited All", "Unlimited All"] },
    { label: "Lower Thirds", values: ["Limited", "Unlimited", "Unlimited", "Unlimited"] },
    { label: "Cloud Storage", values: [false, "5 GB", "20 GB", "50 GB"] },
    { label: "Auto Scene / Source Creation", values: ["Manual only", "Automatic", "Automatic", "Automatic"] },
    { label: "OBS Multistreaming (No Extra Plugins)", values: ["1 destination", "10 Hours/mo", "20 Hours/mo", "40 Hours/mo"] },
    { label: "Speech-to-Scripture Hours", values: ["30 min trial", "4 Hours/mo", "10 Hours/mo", "20 Hours/mo"] },
    { label: "Hour Top-Ups", values: [false, true, true, true] },
    { label: "Cloud Sync Across Operators", values: [false, false, true, "Multi-Campus"] },
    { label: "Mobile Control App", values: [false, false, true, true] },
    { label: "Sermon Notes Export", values: [false, false, true, true] },
    { label: "Support Channel", values: ["Community", "Standard Email", "Priority Support", "Full Phone & Direct Line"] },
    { label: "Online Remote Laptop Control", values: [false, false, false, "Coming Soon"] },
  ];

  return {
    pricing,
    formatPrice,
    comparisonRows,
    plans: PRICING_PLANS,
    faqs: PRICING_FAQS,
  };
}
