export const CANONICAL_PLAN_IDS = ["free", "basic", "growth"] as const;

export type CanonicalPlanId = (typeof CANONICAL_PLAN_IDS)[number];
export type PricingRegion = "NG" | "AFRICA" | "ROW";

export interface CanonicalPlanEntitlements {
  credits: number;
  maxSongs: number;
  maxImages: number;
  maxVideos: number;
  maxBibleVersions: number;
  maxTeams: number;
  maxDevices: number;
  maxMultiviewTemplates: number;
  tickers: boolean;
  multiview: boolean;
  remoteControl: boolean;
  mobileSupport: boolean;
  presentationMode: boolean;
  bulkImport: boolean;
  easyWorshipImport: boolean;
  propresenterImport: boolean;
  cloudSync: boolean;
  lowerThirds: boolean;
  /** Broadcast graphics (lower thirds) a church may add; -1 = unlimited. Defaults from `lowerThirds`. */
  maxLowerThirds?: number;
  /** Tickers a church may add; -1 = unlimited. Defaults from `tickers`. */
  maxTickerThemes?: number;
  translation?: boolean;
  speechToScripture?: boolean;
  sermonExport?: boolean;
  aiFeatures?: boolean;
  advancedAnalytics?: boolean;
  customReports?: boolean;
  apiAccess?: boolean;
  teamManagement?: boolean;
  campusManagement?: boolean;
  slideshow?: boolean;
  countdowns?: boolean;
  prioritySupport?: boolean;
  priorityFeatureRequests?: boolean;
  earlyAccessFeatures?: boolean;
}

export interface EffectivePlanUserLike {
  plan?: string | null;
  role?: string | null;
  trial?: {
    active?: boolean;
    status?: string | null;
    endsAt?: string | null;
  } | null;
  ambassador?: {
    active?: boolean;
  } | null;
  adminTemporaryPlan?: {
    active?: boolean;
    expiresAt?: string | null;
  } | null;
  adminManagedSubscription?: {
    active?: boolean;
    expiresAt?: string | null;
  } | null;
  subscriptionExpiresAt?: string | null;
}

export interface PlanPrice {
  monthly: number;
  yearly: number;
  introductoryMonthly?: number;
}

export interface RegionPricingProfile {
  currency: "NGN" | "USD";
  currencySymbol: string;
  plans: Record<Exclude<CanonicalPlanId, "free">, PlanPrice>;
}

export interface LegacyCompatibleEntitlements {
  songs: number;
  images: number;
  videos: number;
  themes: number;
  lowerThirds: number;
  devices: number;
  bibleVersions: number;
  multiviewTemplates: number;
  tickerThemes: number;
  themePresets: number;
  cloudStorageGB: number;
  multiview: boolean;
  tickers: boolean;
  massImport: boolean;
  easyWorshipImport: boolean;
  proPresenterImport: boolean;
  translation: boolean;
  speechToScripture: boolean;
  sermonExport: boolean;
  aiFeatures: boolean;
  cloudSync: boolean;
  advancedAnalytics: boolean;
  customReports: boolean;
  mobileControl: boolean;
  presentationMode: boolean;
  apiAccess: boolean;
  teamManagement: boolean;
  campusManagement: boolean;
  slideshow: boolean;
  countdowns: boolean;
}

export interface LegacyCompatiblePlanTierConfig {
  label: string;
  pricing: {
    NGN: { monthly: number; yearly: number };
    USD: { monthly: number; yearly: number };
  };
  paystack: {
    monthlyPlanCode: string;
    yearlyPlanCode: string;
  };
  credits: number;
  entitlements: LegacyCompatibleEntitlements;
}

export interface LegacyCompatibleSpecialOffer {
  id: string;
  enabled: boolean;
  name: string;
  description: string;
  badgeText?: string;
  ctaText?: string;
  kind: "one_time" | "discounted_subscription";
  plan: Exclude<CanonicalPlanId, "free">;
  billingCycle: "monthly" | "yearly" | "lifetime";
  price: {
    NGN?: number;
    USD?: number;
    [currency: string]: number | undefined;
  };
  discountPercent?: number | null;
  discountDurationMonths?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  eligibility?: {
    minAccountAgeDays?: number | null;
    maxAccountAgeDays?: number | null;
    allowedPlans?: string[];
    eligibleUserIds?: string[];
    eligibleEmails?: string[];
    includeTrialUsers?: boolean;
    excludeActivePaidUsers?: boolean;
  };
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface LegacyCompatiblePlanConfig {
  version: number;
  plans: Record<string, LegacyCompatiblePlanTierConfig>;
  creditCosts: Array<{
    name: string;
    cost: number;
    unit: string;
    description: string;
  }>;
  translationWordsPerCredit: number;
  trial: {
    durationDays: number;
    enabled: boolean;
  };
  pricingPlans: Array<{
    id: string;
    name: string;
    target: string;
    iconName: string;
    styles: {
      iconBg: string;
      iconColor: string;
      border: string;
      button: string;
      buttonHover: string;
      popular?: boolean;
      popularBadgeBg?: string;
      checkColor: string;
    };
    pricing: {
      NGN: {
        monthly: string;
        originalMonthly?: string;
        yearly: string;
        originalYearly?: string;
      };
      USD: {
        monthly: string;
        originalMonthly?: string;
        yearly: string;
        originalYearly?: string;
      };
    };
    features: Array<{ text: string; prefixHighlight?: string }>;
    buttonText: string;
    paystackPlanCode?: string;
    paystackAmount?: {
      NGN: number;
      USD: number;
    };
  }>;
  featureBanners: Array<{
    id: string;
    title: string;
    description: string;
    iconName: string;
    bg: string;
    color: string;
  }>;
  specialOffers?: LegacyCompatibleSpecialOffer[];
  updatedAt: string;
}

export type LegacyCompatibleFeatureKey = keyof LegacyCompatibleEntitlements;
export type CanonicalBooleanEntitlementKey = {
  [K in keyof CanonicalPlanEntitlements]: CanonicalPlanEntitlements[K] extends boolean | undefined ? K : never;
}[keyof CanonicalPlanEntitlements];
export type CanonicalLimitEntitlementKey = {
  [K in keyof CanonicalPlanEntitlements]: CanonicalPlanEntitlements[K] extends number ? K : never;
}[keyof CanonicalPlanEntitlements];

export const PLAN_ENTITLEMENTS: Record<CanonicalPlanId, CanonicalPlanEntitlements> = {
  free: {
    credits: 50,
    maxSongs: 5,
    maxImages: 10,
    maxVideos: 5,
    maxBibleVersions: 5,
    maxTeams: 3,
    maxDevices: 1,
    maxMultiviewTemplates: 0,
    tickers: false,
    maxLowerThirds: 3,
    maxTickerThemes: 3,
    multiview: false,
    remoteControl: false,
    mobileSupport: false,
    presentationMode: false,
    bulkImport: false,
    easyWorshipImport: false,
    propresenterImport: false,
    cloudSync: false,
    lowerThirds: false,
    translation: false,
    speechToScripture: true,
    sermonExport: false,
    aiFeatures: false,
    advancedAnalytics: false,
    customReports: false,
    apiAccess: false,
    teamManagement: false,
    campusManagement: false,
    slideshow: false,
    countdowns: false,
  },
  basic: {
    credits: 240, // 4 hours included (60 credits/hr)
    maxSongs: -1,
    maxImages: -1,
    maxVideos: -1,
    maxBibleVersions: -1,
    maxTeams: 5,
    maxDevices: 3,
    maxMultiviewTemplates: 5,
    tickers: true,
    maxLowerThirds: -1,
    maxTickerThemes: -1,
    multiview: true,
    remoteControl: false,
    mobileSupport: false,
    presentationMode: false,
    bulkImport: true,
    easyWorshipImport: true,
    propresenterImport: true,
    cloudSync: false,
    lowerThirds: false,
    translation: false,
    speechToScripture: true,
    sermonExport: false,
    aiFeatures: false,
    advancedAnalytics: false,
    customReports: false,
    apiAccess: false,
    teamManagement: false,
    campusManagement: false,
    slideshow: true,
    countdowns: false,
  },
  growth: {
    credits: 600, // 10 hours included (60 credits/hr)
    maxSongs: -1,
    maxImages: -1,
    maxVideos: -1,
    maxBibleVersions: -1,
    maxTeams: 20,
    maxDevices: 10,
    maxMultiviewTemplates: -1,
    tickers: true,
    multiview: true,
    remoteControl: true,
    mobileSupport: true,
    presentationMode: true,
    bulkImport: true,
    easyWorshipImport: true,
    propresenterImport: true,
    cloudSync: true,
    lowerThirds: true,
    prioritySupport: true,
    priorityFeatureRequests: true,
    earlyAccessFeatures: true,
    translation: true,
    speechToScripture: true,
    sermonExport: true,
    aiFeatures: true,
    advancedAnalytics: true,
    customReports: true,
    apiAccess: true,
    teamManagement: true,
    campusManagement: true,
    slideshow: true,
    countdowns: true,
  },
};

export const REGION_PRICING: Record<PricingRegion, RegionPricingProfile> = {
  NG: {
    currency: "NGN",
    currencySymbol: "₦",
    plans: {
      basic: { monthly: 2700, yearly: 27540 },
      growth: { monthly: 5500, yearly: 56100 },
    },
  },
  AFRICA: {
    currency: "USD",
    currencySymbol: "$",
    plans: {
      basic: { monthly: 4, yearly: 30 },
      growth: { monthly: 8, yearly: 61.2 },
    },
  },
  ROW: {
    currency: "USD",
    currencySymbol: "$",
    plans: {
      basic: { monthly: 7, yearly: 71.4 },
      growth: { monthly: 12, yearly: 122.4 },
    },
  },
};

const LEGACY_PLAN_ALIASES: Record<string, CanonicalPlanId> = {
  pro: "growth",
  starter: "growth",
  trial: "growth",
  ambassador: "growth",
  unlimited: "growth",
  admin: "growth",
};

const AFRICAN_COUNTRIES = new Set([
  "DZ", "AO", "BJ", "BW", "BF", "BI", "CM", "CV", "CF", "TD", "KM", "CG",
  "CD", "CI", "DJ", "EG", "GQ", "ER", "SZ", "ET", "GA", "GM", "GH", "GN",
  "GW", "KE", "LS", "LR", "LY", "MG", "MW", "ML", "MR", "MU", "YT", "MA",
  "MZ", "NA", "NE", "NG", "RE", "RW", "SH", "ST", "SN", "SC", "SL", "SO",
  "ZA", "SS", "SD", "TZ", "TG", "TN", "UG", "EH", "ZM", "ZW",
]);

function normalizeBooleanFlag(value: unknown): boolean {
  return value === true;
}

function isExpiredAdminTemporaryPlan(
  user: EffectivePlanUserLike | null | undefined,
  nowMs: number,
): boolean {
  const temp = user?.adminTemporaryPlan;
  if (!normalizeBooleanFlag(temp?.active)) return false;
  if (!temp?.expiresAt) return false;
  const expiresAtMs = new Date(temp.expiresAt).getTime();
  return Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
}

function isExpiredAdminManagedSubscription(
  user: EffectivePlanUserLike | null | undefined,
  nowMs: number,
): boolean {
  const managed = user?.adminManagedSubscription;
  const expiresAt = managed?.expiresAt || user?.subscriptionExpiresAt;
  if (!normalizeBooleanFlag(managed?.active)) return false;
  if (!expiresAt) return false;
  const expiresAtMs = new Date(expiresAt).getTime();
  return Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
}

export function normalizePlanId(plan?: string | null): CanonicalPlanId {
  const normalized = String(plan || "free").trim().toLowerCase();
  if ((CANONICAL_PLAN_IDS as readonly string[]).includes(normalized)) {
    return normalized as CanonicalPlanId;
  }
  return LEGACY_PLAN_ALIASES[normalized] || "free";
}

export function isActiveTrial(
  user: EffectivePlanUserLike | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  const trial = user?.trial;
  if (!trial?.endsAt) return false;

  const endsAtMs = new Date(trial.endsAt).getTime();
  if (!Number.isFinite(endsAtMs) || endsAtMs <= nowMs) return false;

  if (trial.status) {
    return String(trial.status).toLowerCase() === "active";
  }

  return normalizeBooleanFlag(trial.active);
}

export function getEffectivePlan(
  user: EffectivePlanUserLike | null | undefined,
  nowMs: number = Date.now(),
): CanonicalPlanId {
  if (!user) return "free";
  if (String(user.role || "").toLowerCase() === "admin") return "growth";
  if (isExpiredAdminTemporaryPlan(user, nowMs)) return "free";
  if (isExpiredAdminManagedSubscription(user, nowMs)) return "free";
  if (normalizeBooleanFlag(user.ambassador?.active)) return "growth";
  const storedPlan = normalizePlanId(user.plan);
  if (storedPlan !== "free") return storedPlan;
  if (isActiveTrial(user, nowMs)) return "growth";
  return "free";
}

export function getCanonicalEntitlementsForUser(
  user: EffectivePlanUserLike | null | undefined,
  nowMs: number = Date.now(),
): CanonicalPlanEntitlements {
  return PLAN_ENTITLEMENTS[getEffectivePlan(user, nowMs)];
}

export function isUnlimitedLimit(value: number): boolean {
  return value === -1;
}

export function getPricingRegion(countryCode?: string | null): PricingRegion {
  const code = String(countryCode || "NG").trim().toUpperCase();
  if (code === "NG") return "NG";
  if (AFRICAN_COUNTRIES.has(code)) return "AFRICA";
  return "ROW";
}

export function resolveRegionPricing(countryCode?: string | null): {
  countryCode: string;
  region: PricingRegion;
  currency: "NGN" | "USD";
  currencySymbol: string;
  plans: RegionPricingProfile["plans"];
  pricingVersion: number;
} {
  const normalizedCountryCode = String(countryCode || "NG").trim().toUpperCase() || "NG";
  const region = getPricingRegion(normalizedCountryCode);
  const profile = REGION_PRICING[region];

  return {
    countryCode: normalizedCountryCode,
    region,
    currency: profile.currency,
    currencySymbol: profile.currencySymbol,
    plans: profile.plans,
    pricingVersion: 2,
  };
}

function formatPrice(amount: number, symbol: string): string {
  return `${symbol}${amount.toLocaleString("en-US")}`;
}

export function toLegacyCompatibleEntitlements(
  planId: CanonicalPlanId,
  entitlements: CanonicalPlanEntitlements,
): LegacyCompatibleEntitlements {
  const isPaid = planId !== "free";

  return {
    songs: entitlements.maxSongs,
    images: entitlements.maxImages,
    videos: entitlements.maxVideos,
    themes: planId === "free" ? 2 : isPaid ? -1 : 10,
    lowerThirds: entitlements.maxLowerThirds ?? (entitlements.lowerThirds ? -1 : 0),
    devices: entitlements.maxDevices,
    bibleVersions: entitlements.maxBibleVersions,
    multiviewTemplates: entitlements.maxMultiviewTemplates,
    tickerThemes: entitlements.maxTickerThemes ?? (entitlements.tickers ? -1 : 0),
    themePresets: entitlements.lowerThirds ? -1 : 0,
    cloudStorageGB: entitlements.cloudSync ? 200 : 0,
    multiview: entitlements.multiview,
    tickers: entitlements.tickers,
    massImport: entitlements.bulkImport,
    easyWorshipImport: entitlements.easyWorshipImport,
    proPresenterImport: entitlements.propresenterImport,
    translation: entitlements.translation ?? (planId === "growth"),
    speechToScripture: entitlements.speechToScripture ?? isPaid,
    sermonExport: entitlements.sermonExport ?? (planId === "growth"),
    aiFeatures: entitlements.aiFeatures ?? (planId === "growth"),
    cloudSync: entitlements.cloudSync,
    advancedAnalytics: entitlements.advancedAnalytics ?? (planId === "growth"),
    customReports: entitlements.customReports ?? (planId === "growth"),
    mobileControl: entitlements.mobileSupport || entitlements.remoteControl,
    presentationMode: entitlements.presentationMode,
    apiAccess: entitlements.apiAccess ?? (planId === "growth"),
    teamManagement: entitlements.teamManagement ?? (entitlements.maxTeams > 0),
    campusManagement: entitlements.campusManagement ?? (planId === "growth"),
    slideshow: entitlements.slideshow ?? (planId !== "free"),
    countdowns: entitlements.countdowns ?? (planId !== "free"),
  };
}

export function getLegacyCompatibleEntitlementsForPlan(
  planId: CanonicalPlanId,
): LegacyCompatibleEntitlements {
  return toLegacyCompatibleEntitlements(planId, PLAN_ENTITLEMENTS[planId]);
}

export function getLegacyCompatibleEntitlementsForUser(
  user: EffectivePlanUserLike | null | undefined,
  nowMs: number = Date.now(),
): LegacyCompatibleEntitlements {
  return getLegacyCompatibleEntitlementsForPlan(getEffectivePlan(user, nowMs));
}

export function getLegacyFeatureValue(
  planId: CanonicalPlanId,
  feature: LegacyCompatibleFeatureKey,
): LegacyCompatibleEntitlements[LegacyCompatibleFeatureKey] {
  return getLegacyCompatibleEntitlementsForPlan(planId)[feature];
}

export function findRequiredPlanForLegacyFeature(
  feature: LegacyCompatibleFeatureKey,
  currentCount: number = 0,
): CanonicalPlanId {
  for (const planId of CANONICAL_PLAN_IDS) {
    const value = getLegacyFeatureValue(planId, feature);
    if (typeof value === "boolean" ? value : value === -1 || currentCount < value) {
      return planId;
    }
  }
  return "growth";
}

export function findRequiredPlanForCanonicalFeature(
  feature: CanonicalBooleanEntitlementKey | CanonicalLimitEntitlementKey,
): CanonicalPlanId {
  const featureKey = feature as keyof CanonicalPlanEntitlements;
  for (const planId of CANONICAL_PLAN_IDS) {
    const value = PLAN_ENTITLEMENTS[planId][featureKey];
    if (typeof value === "boolean" ? value : value !== 0) {
      return planId;
    }
  }
  return "growth";
}

function buildTierConfig(
  planId: CanonicalPlanId,
  label: string,
  paystackCodes: { monthlyPlanCode: string; yearlyPlanCode: string },
): LegacyCompatiblePlanTierConfig {
  const zeroPricing = { monthly: 0, yearly: 0 };
  const canonicalEntitlements = PLAN_ENTITLEMENTS[planId];

  if (planId === "free") {
    return {
      label,
      pricing: { NGN: zeroPricing, USD: zeroPricing },
      paystack: paystackCodes,
      credits: canonicalEntitlements.credits,
      entitlements: toLegacyCompatibleEntitlements(planId, canonicalEntitlements),
    };
  }

  const ngPricing = REGION_PRICING.NG.plans[planId];
  const usdPricing = REGION_PRICING.ROW.plans[planId];

  return {
    label,
    pricing: {
      NGN: { monthly: ngPricing.monthly, yearly: ngPricing.yearly },
      USD: { monthly: usdPricing.monthly, yearly: usdPricing.yearly },
    },
    paystack: paystackCodes,
    credits: canonicalEntitlements.credits,
    entitlements: toLegacyCompatibleEntitlements(planId, canonicalEntitlements),
  };
}

export function buildLegacyCompatiblePlanConfig(options?: {
  updatedAt?: string;
  trialDurationDays?: number;
  trialEnabled?: boolean;
}): LegacyCompatiblePlanConfig {
  const updatedAt = options?.updatedAt || new Date().toISOString();
  const trialDurationDays = options?.trialDurationDays ?? 30;
  const trialEnabled = options?.trialEnabled ?? true;

  const freeTier = buildTierConfig("free", "Free", { monthlyPlanCode: "", yearlyPlanCode: "" });
  const basicTier = buildTierConfig("basic", "Basic", {
    monthlyPlanCode: "mce_basic_monthly",
    yearlyPlanCode: "mce_basic_yearly",
  });
  const growthTier = buildTierConfig("growth", "Growth", {
    monthlyPlanCode: "mce_growth_monthly",
    yearlyPlanCode: "mce_growth_yearly",
  });

  return {
    version: 7,
    plans: {
      free: freeTier,
      trial: {
        ...growthTier,
        label: "Growth Trial",
        pricing: {
          NGN: { monthly: 0, yearly: 0 },
          USD: { monthly: 0, yearly: 0 },
        },
        paystack: { monthlyPlanCode: "", yearlyPlanCode: "" },
      },
      basic: basicTier,
      growth: growthTier,
      ambassador: {
        ...growthTier,
        label: "Ambassador",
      },
      unlimited: {
        ...growthTier,
        label: "Unlimited",
        credits: -1,
      },
    },
    creditCosts: [
      {
        name: "Speech-to-Scripture",
        cost: 1,
        unit: "per minute",
        description: "Automatically transcribe live audio and detect scripture references.",
      },
      {
        name: "Live Translation",
        cost: 2,
        unit: "per minute",
        description: "Translate live speech into another language.",
      },
      {
        name: "AI Summary",
        cost: 5,
        unit: "flat",
        description: "Generate a sermon summary.",
      },
    ],
    translationWordsPerCredit: 150,
    trial: {
      durationDays: trialDurationDays,
      enabled: trialEnabled,
    },
    pricingPlans: [
      {
        id: "basic",
        name: "Basic",
        target: "For small and medium churches",
        iconName: "leaf",
        styles: {
          iconBg: "bg-emerald-50",
          iconColor: "text-emerald-600",
          border: "border-emerald-200",
          button: "bg-emerald-600 text-white",
          buttonHover: "hover:bg-emerald-700",
          checkColor: "text-emerald-600",
        },
        pricing: {
          NGN: {
            monthly: formatPrice(REGION_PRICING.NG.plans.basic.introductoryMonthly || REGION_PRICING.NG.plans.basic.monthly, "₦"),
            originalMonthly: formatPrice(REGION_PRICING.NG.plans.basic.monthly, "₦"),
            yearly: formatPrice(REGION_PRICING.NG.plans.basic.yearly, "₦"),
          },
          USD: {
            monthly: formatPrice(REGION_PRICING.ROW.plans.basic.monthly, "$"),
            yearly: formatPrice(REGION_PRICING.ROW.plans.basic.yearly, "$"),
          },
        },
        features: [
          { text: "Unlimited songs, lyrics, and media (Local)" },
          { text: "Unlimited Bible versions and 3 devices" },
          { text: "Automatic scene and source creation" },
          { text: "OBS Multistream (10 hrs/mo — no extra plugin needed)" },
          { text: "Speech-to-Scripture with 4 hours included + Top-up" },
          { text: "1-click EasyWorship, ProPresenter, and OpenLP import" },
        ],
        buttonText: "Get Basic",
        paystackPlanCode: "mce_basic_monthly",
        paystackAmount: { NGN: REGION_PRICING.NG.plans.basic.monthly * 100, USD: REGION_PRICING.ROW.plans.basic.monthly * 100 },
      },
      {
        id: "growth",
        name: "Growth",
        target: "For growing churches and media departments",
        iconName: "chart",
        styles: {
          iconBg: "bg-blue-50",
          iconColor: "text-blue-600",
          border: "border-blue-300 border-2",
          button: "bg-blue-600 text-white",
          buttonHover: "hover:bg-blue-700",
          popular: true,
          popularBadgeBg: "bg-blue-600",
          checkColor: "text-blue-600",
        },
        pricing: {
          NGN: {
            monthly: formatPrice(REGION_PRICING.NG.plans.growth.introductoryMonthly || REGION_PRICING.NG.plans.growth.monthly, "₦"),
            originalMonthly: formatPrice(REGION_PRICING.NG.plans.growth.monthly, "₦"),
            yearly: formatPrice(REGION_PRICING.NG.plans.growth.yearly, "₦"),
          },
          USD: {
            monthly: formatPrice(REGION_PRICING.ROW.plans.growth.monthly, "$"),
            yearly: formatPrice(REGION_PRICING.ROW.plans.growth.yearly, "$"),
          },
        },
        features: [
          { text: "Unlimited songs, images, videos, and Bible versions" },
          { text: "OBS Multistream (20 hrs/mo — no extra plugin needed)" },
          { text: "Cloud Sync across operators & media laptops" },
          { text: "Mobile Control App & Remote OBS presentation" },
          { text: "Lower Thirds, Tickers, and Sermon Notes Export" },
          { text: "Speech-to-Scripture with 10 hours max included + Top-up" },
        ],
        buttonText: "Get Growth",
        paystackPlanCode: "mce_growth_monthly",
        paystackAmount: { NGN: REGION_PRICING.NG.plans.growth.monthly * 100, USD: REGION_PRICING.ROW.plans.growth.monthly * 100 },
      },
    ],
    featureBanners: [
      {
        id: "control",
        title: "Control Every Screen",
        description: "Run worship, Bible, lower thirds, and multiview from one entitlement engine.",
        iconName: "monitor",
        bg: "bg-blue-50",
        color: "text-blue-600",
      },
      {
        id: "sync",
        title: "Stay In Sync",
        description: "Cloud Sync and remote control unlock only when the effective plan allows them.",
        iconName: "smartphone",
        bg: "bg-emerald-50",
        color: "text-emerald-600",
      },
      {
        id: "import",
        title: "Import Faster",
        description: "Bulk import and presentation migration tools are gated centrally instead of in the UI.",
        iconName: "clock",
        bg: "bg-amber-50",
        color: "text-amber-600",
      },
    ],
    specialOffers: [],
    updatedAt,
  };
}
