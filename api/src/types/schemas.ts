import { ObjectId } from "mongodb";

// ─── Country ───────────────────────────────────────────────────────────────

export interface Country {
  _id?: ObjectId;
  name: string;
  iso2: string;
  iso3: string;
  flag: string;
  region: string;
  subregion: string;
}

// ─── Church Profile ──────────────────────────────────────────────────────────

export interface ChurchBranding {
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontFamily: string;
  faviconUrl: string;
}

export interface ChurchPresentationDefaults {
  defaultTranslation: string;
  lowerThirdStyle: string;
  theme: string;
  language: string;
}

export interface ChurchSocialMedia {
  facebook: string;
  instagram: string;
  youtube: string;
  twitter: string;
  tiktok: string;
  /** Also shown as icons in the lower-third graphics. */
  whatsapp?: string;
  telegram?: string;
  threads?: string;
}

export interface ChurchProfile {
  _id?: ObjectId;
  userId: string;
  churchName: string;
  tagline: string;
  website: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country: string;
  timezone: string;
  churchSize: string;
  branding: ChurchBranding;
  presentationDefaults: ChurchPresentationDefaults;
  speakers: { name: string; role: string; imageUrl?: string; isMain?: boolean }[];
  socialMedia: ChurchSocialMedia;
  createdAt: string;
  updatedAt: string;
}

// ─── Subscription ────────────────────────────────────────────────────────────

export type PlanTier = "free" | "basic" | "growth";
export type BillingCycle = "monthly" | "yearly" | "lifetime" | "gift_3m" | "gift_6m" | "gift_12m";
export type DiscountBillingCycle = Extract<BillingCycle, "monthly" | "yearly" | "lifetime">;
export type SubscriptionStatus = "active" | "cancelled" | "past_due" | "trialing";

export interface Subscription {
  _id?: ObjectId;
  userId: string;
  plan: PlanTier;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  purchaseKind?: "subscription" | "one_time";
  oneTimeOfferId?: string | null;
  oneTimeOfferName?: string | null;
  offerOriginalPrice?: number | null;
  offerAppliedPrice?: number | null;
  price: number;
  currency: string;
  startDate: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  nextBillingDate: string;
  autoRenew: boolean;
  cancelledAt?: string;
  cancelAtPeriodEnd?: boolean;
  paymentProvider?: string;
  adminManaged?: boolean;
  managedByAdminId?: string;
  adminPaymentReference?: string;
  adminPaymentNote?: string;
  lastAdminPaymentAt?: string;
  paystackSubscriptionCode?: string;
  paystackCustomerCode?: string;
  paystackAuthorizationCode?: string;
  paystackAuthorizationEmail?: string;
  paystackAuthorizationSignature?: string;
  paystackAuthorizationReusable?: boolean;
  paymentMethodSummary?: string;
  /** Entitlement snapshot: plan config version at activation time. */
  planVersion?: number;
  /** Entitlement snapshot: frozen entitlements at activation time. */
  entitlements?: PlanEntitlements;
  // ── Country-based pricing lock ──
  /** Country code at time of subscription creation (prevents VPN abuse). */
  subscriptionCountry?: string;
  /** Currency code at time of subscription creation. */
  subscriptionCurrency?: string;
  /** Currency symbol at time of subscription creation. */
  subscriptionCurrencySymbol?: string;
  /** Price at time of subscription creation (locked, not recalculated). */
  lockedPrice?: number;
  /** Pricing version at time of subscription creation. */
  pricingVersion?: number;
  /** Discount code applied at checkout, if any. */
  discountCode?: string | null;
  /** Discount percentage applied at checkout, if any. */
  discountPercent?: number | null;
  /** Total number of months this discount is meant to run. */
  discountDurationMonths?: number | null;
  /** Remaining discounted monthly renewals after the initial checkout charge. */
  discountMonthsRemaining?: number | null;
  /** Original plan price before discount at checkout. */
  undiscountedPrice?: number | null;
  /** Discount amount taken off the initial checkout charge. */
  initialDiscountAmount?: number | null;
  // ── Scheduled plan changes ──
  /** Target plan for scheduled downgrade/change. */
  pendingPlan?: PlanTier;
  /** Type of scheduled change: "downgrade" | "upgrade" | "cancel". */
  pendingChangeType?: string;
  /** When the scheduled change should take effect (end of current period). */
  pendingChangeEffectiveAt?: string;
  // ── Failed payment / grace period ──
  /** Last payment failure timestamp. */
  paymentFailedAt?: string;
  /** When the grace period expires (after which account falls back to Free). */
  gracePeriodEndsAt?: string;
  /** Number of payment retries attempted during the current grace period. */
  retryCount?: number;
  /** When to attempt the next automatic payment retry. */
  nextRetryAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── User Usage Tracking ─────────────────────────────────────────────────────

/**
 * Tracks per-user resource counts for entitlement enforcement.
 * Synced from the desktop app's IndexedDB and used by the server
 * for the /api/user/entitlements endpoint.
 */
export interface UserUsage {
  _id?: ObjectId;
  userId: string;
  /** Number of songs created */
  songs: number;
  /** Number of images uploaded */
  images: number;
  /** Number of videos uploaded */
  videos: number;
  /** Number of custom themes created */
  themes: number;
  /** Number of lower-third themes created */
  lowerThirds: number;
  /** Number of registered devices */
  devices: number;
  /** Number of installed Bible versions */
  bibleVersions: number;
  /** ISO timestamp of last sync from desktop app */
  lastSyncedAt: string;
  createdAt: string;
  updatedAt: string;
}

export enum CreditTransactionType {
  USAGE = "usage",
  ADMIN_GRANT = "admin_grant",
  REFUND = "refund",
  BONUS = "bonus",
  REVOCATION = "revocation",
  ALLOCATION = "allocation",
}

/** @deprecated Use CreditTransactionType enum instead. Kept for backward compat during migration. */
export type TransactionType = CreditTransactionType | "purchase" | "renewal" | "allocation";

export type TransactionSource =
  | "translation"
  | "transcription"
  | "ai_generation"
  | "subscription_renewal"
  | "credit_pack_purchase"
  | "admin_adjustment"
  | "refund"
  | "subscription_activation"
  | "monthly_renewal"
  | "plan_upgrade"
  | "plan_downgrade"
  | "trial_activation"
  | "trial_expired"
  | "subscription_expired"
  | "ambassador_grant"
  | "ambassador_expired";

export interface CreditTransactionMetadata {
  /** Feature that consumed/granted credits (e.g. "translation", "speech_to_scripture", "ai_summary") */
  feature?: string;
  /** Target language for translation transactions */
  language?: string;
  /** Duration in minutes for time-based features */
  minutes?: number;
  /** Word count for translation transactions */
  words?: number;
  /** Traces back to specific job (e.g. "transcript-456", "translation-job-123") */
  sourceId?: string;
  /** Admin who performed the action */
  adminId?: string;
  /** Actor that created this transaction: "system" | "admin:abc123" | "billing" | "migration" */
  createdBy?: string;
  /** Human-readable reason for the transaction */
  reason?: string;
  /** Client-generated unique ID for idempotent offline sync */
  transactionId?: string;
  /** Whether this transaction was synced from an offline operation */
  offlineSync?: boolean;
  /** Previous credits balance before this transaction (informational) */
  previousCredits?: number;
  /** Granted credits related to ambassador/promotional actions */
  creditsGranted?: number;
  /** Previous plan before a system allocation/downgrade. */
  previousPlan?: string;
  /** New plan related to a billing/allocation transaction. */
  plan?: string;
  /** Billing cycle related to a billing/allocation transaction. */
  billingCycle?: string;
  /** Whether access came from a recurring subscription or one-time purchase. */
  purchaseKind?: "subscription" | "one_time";
  /** Admin-configured one-time/special offer id related to the billing transaction. */
  oneTimeOfferId?: string;
  /** Admin-configured one-time/special offer name related to the billing transaction. */
  oneTimeOfferName?: string;
  /** Paystack reference related to a billing transaction. */
  paystackReference?: string;
  /** Provider-neutral reference related to the billing transaction. */
  providerReference?: string;
  /** Paystack subscription code related to a billing transaction. */
  paystackSubscriptionCode?: string;
  /** Discount code applied to the billing transaction. */
  discountCode?: string;
  /** Discount percentage applied to the billing transaction. */
  discountPercent?: number;
  /** Billing transaction record ID. */
  billingTransactionId?: string;
  /** Internal pipeline that created this transaction. */
  via?: string;
  /** Related expiry timestamp for trial/subscription allocation changes. */
  expiresAt?: string;
  /** Related sermon ID (for AI feature transactions) */
  sermonId?: string;
}

export interface CreditTransaction {
  _id?: ObjectId;
  userId: string;
  type: CreditTransactionType;
  source: TransactionSource;
  amount: number;
  /** Informational only — current balance is always calculated dynamically. */
  balanceAfter?: number;
  description: string;
  metadata?: CreditTransactionMetadata;
  createdAt: string;
}

// ─── Security Session ────────────────────────────────────────────────────────

export type DevicePlatform = "desktop" | "mobile" | "tablet" | "web";

export interface SecuritySession {
  _id?: ObjectId;
  userId: string;
  sessionId: string;
  deviceName: string;
  devicePlatform: DevicePlatform;
  deviceOs: string;
  browser?: string;
  ipAddress: string;
  location: string;
  lastActive: string;
  createdAt: string;
  isCurrent: boolean;
}

// ─── Ambassador Access ──────────────────────────────────────────────────────

export interface AmbassadorAccess {
  active: boolean;
  grantedBy: string;
  grantedAt: string;
  expiresAt: string;
  creditsGranted: number;
  previousPlan: PlanTier;
  notes?: string;
}

export interface AdminTemporaryPlan {
  active: boolean;
  plan: PlanTier;
  previousPlan: PlanTier;
  returnPlan: "free";
  grantedBy: string;
  grantedAt: string;
  startedAt: string;
  expiresAt: string;
  durationDays: number;
  reason?: string;
  emailSentAt?: string;
  endedAt?: string;
  endedBy?: string;
  endedReason?: "expired" | "ended_by_admin" | "paid_plan_activated" | "grant_failed" | "converted_to_admin_subscription";
  expiredAt?: string;
  campaignKey?: string;
  offerId?: string;
}

export interface AdminManagedSubscription {
  active: boolean;
  plan: PlanTier;
  billingCycle: BillingCycle;
  startedBy: string;
  startedAt: string;
  renewedAt?: string;
  expiresAt: string;
  amountCollected?: number;
  currency?: string;
  paymentReference?: string;
  note?: string;
  emailSentAt?: string;
  endedAt?: string;
  endedBy?: string;
  endedReason?: string;
}

// ─── Extended User Fields ────────────────────────────────────────────────────

export interface UserProfile {
  _id?: ObjectId;
  name: string;
  email: string;
  password?: string;
  avatar: string;
  provider: "credentials" | "oauth";
  appId: string;
  churchName: string;
  churchProfileId?: string;
  devices?: string[];
  creditTransactions?: string[];
  country: string;
  signupCountry?: string;
  signupCity?: string;
  signupIp?: string;
  lastLoginCountry?: string;
  lastLoginCity?: string;
  lastLoginIp?: string;
  lastLoginTimezone?: string;
  locationHistory?: Array<{
    country: string;
    city?: string;
    timezone?: string;
    ip?: string;
    timestamp: string;
  }>;
  phone: string;
  jobTitle: string;
  language: string;
  timezone: string;
  role: string;
  plan: PlanTier;
  /** @deprecated Credits are now calculated dynamically from plan config + transactions. */
  credits?: number;
  isActive: boolean;
  tokenVersion: number;
  loginMethods: {
    email: boolean;
    google: boolean;
    microsoft: boolean;
  };
  twoFactorEnabled: boolean;
  twoFactorSecret: string | null;
  twoFactorRecoveryCodes: string[];
  emailChangedAt?: string;
  nextEmailChangeAt?: string;
  pendingEmail?: string;
  emailChangeToken?: string;
  emailChangeTokenExpires?: string;
  emailHistory?: { email: string; changedAt: string }[];
  /** Reference to the user's trial record in the `trials` collection. */
  trialId?: string | null;
  trial?: {
    /** @deprecated Use `status` instead. Kept for backward compatibility during migration. */
    active?: boolean;
    status?: "active" | "expired" | "stopped" | "cancelled";
    startedAt?: string | null;
    endsAt?: string | null;
    durationDays?: number | null;
    extendedDays?: number;
    extensionCount?: number;
    stoppedAt?: string | null;
    stoppedReason?: string | null;
    restartedAt?: string | null;
    grantedBy?: string | null;
    lastModifiedBy?: string | null;
    welcomeShown?: boolean;
  } | null;
  ambassador?: AmbassadorAccess | null;
  adminTemporaryPlan?: AdminTemporaryPlan | null;
  adminManagedSubscription?: AdminManagedSubscription | null;
  referralCode?: string;
  referredBy?: {
    code: string;
    referrerUserId: string;
    referralId: string;
    appliedAt: string;
  } | null;
  referralPromptSkippedAt?: string | null;
  /** New Google accounts that arrived without a referral code must enter one before using the dashboard. */
  referralRequired?: boolean;
  onboardingCompleted?: boolean;
  /** Guided onboarding milestones — downloadedStudio is set server-side by downloads API */
  onboarding?: {
    downloadedStudio?: boolean;
    pairedFirstDevice?: boolean;
    completedWelcome?: boolean;
    activationStartedAt?: string | null;
    activationCompletedAt?: string | null;
  };
  // Activation milestones for trial email personalization
  activationMilestones?: {
    appDownloaded?: boolean;
    devicePaired?: boolean;
    obsConnected?: boolean;
    firstPresentation?: boolean;
    firstUse?: boolean;
    firstSpeechToScripture?: boolean;
    firstTranslation?: boolean;
  };
  trialExperiment?: TrialExperimentAssignment | null;
  activationSurvey?: {
    reason?: ActivationSurveyReason | null;
    detail?: string | null;
    submittedAt?: string | null;
    dismissedAt?: string | null;
  } | null;
  createdAt: string;
  lastLogin: string;
  signupDate?: string;
  lastActive?: string;
}

// ─── Referrals ──────────────────────────────────────────────────────────────

export type ReferralStatus = "signed_up" | "paid";

export interface ReferralRecord {
  _id?: ObjectId;
  code: string;
  referrerUserId: string;
  referredUserId: string;
  status: ReferralStatus;
  paidAt?: string | null;
  paidPlan?: PlanTier | string | null;
  paidAmount?: number | null;
  paidCurrency?: string | null;
  paidBillingReference?: string | null;
  paidBillingTransactionId?: string | null;
  /**
   * When the team sent the referrer their reward for this referral. A paid referral without it
   * is still owed, and shows in the daily Telegram payout digest.
   */
  payoutPaidAt?: string | null;
  /** Admin user id that marked the payout as sent. */
  payoutPaidBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Credit Usage Daily Stats ────────────────────────────────────────────────

export interface CreditUsageDay {
  date: string;
  amount: number;
}

// ─── Plan Configuration (DB-backed, v2) ─────────────────────────────────────

/**
 * Entitlements define what a plan tier can access.
 * -1 = Unlimited. 0 = Blocked. Positive number = hard cap.
 * Booleans: true = allowed, false = blocked.
 *
 * MUST stay structurally identical to src/services/planConfigTypes.ts PlanEntitlements.
 */
export interface PlanEntitlements {
  // Numeric resource limits (-1 = unlimited)
  /** Max songs */
  songs: number;
  /** Max images */
  images: number;
  /** Max videos */
  videos: number;
  /** Max themes */
  themes: number;
  /** Max lower-third themes */
  lowerThirds: number;
  /** Max devices */
  devices: number;
  /** Max Bible versions */
  bibleVersions: number;
  /** Max multiview templates */
  multiviewTemplates: number;
  /** Max ticker themes */
  tickerThemes: number;
  /** Max theme presets */
  themePresets: number;
  /** Max cloud storage in GB */
  cloudStorageGB: number;

  // Boolean feature gates
  /** Can use multiview */
  multiview: boolean;
  /** Can use tickers */
  tickers: boolean;
  /** Can use mass import */
  massImport: boolean;
  /** Can use EasyWorship import */
  easyWorshipImport: boolean;
  /** Can use ProPresenter import */
  proPresenterImport: boolean;
  /** Can use translation */
  translation: boolean;
  /** Can use speech-to-scripture */
  speechToScripture: boolean;
  /** Can use sermon export */
  sermonExport: boolean;
  /** Can use AI features */
  aiFeatures: boolean;
  /** Can use cloud sync */
  cloudSync: boolean;
  /** Can use advanced analytics */
  advancedAnalytics: boolean;
  /** Can use custom reports */
  customReports: boolean;
  /** Can use mobile control */
  mobileControl: boolean;
  /** Can use API access */
  apiAccess: boolean;
  /** Can use team management */
  teamManagement: boolean;
  /** Can use multi-campus management */
  campusManagement: boolean;
  /** Can use slideshow */
  slideshow: boolean;
  /** Can use countdowns */
  countdowns: boolean;
}

/** Per-currency pricing. NGN amounts in whole naira. USD amounts in dollars. */
export interface PlanPricing {
  NGN: { monthly: number; yearly: number };
  USD: { monthly: number; yearly: number };
}

/** Paystack subscription plan codes for automated billing. */
export interface PaystackConfig {
  monthlyPlanCode: string;
  yearlyPlanCode: string;
}

export interface PlanTierConfig {
  /** Display label */
  label: string;
  /** Multi-currency pricing */
  pricing: PlanPricing;
  /** Paystack subscription plan codes */
  paystack: PaystackConfig;
  /** Monthly credit allocation. -1 = Unlimited. */
  credits: number;
  /** Plan entitlements — resource limits and feature flags */
  entitlements: PlanEntitlements;
}

export interface CreditCostConfig {
  name: string;
  cost: number;
  unit: string;
  description: string;
}

export interface PlanTrialConfig {
  /** Default trial duration in days */
  durationDays: number;
  /** Whether trial is globally enabled */
  enabled: boolean;
}

// ─── Trial System ──────────────────────────────────────────────────────────

export type TrialStatus = "active" | "expired" | "stopped" | "cancelled";

export type TrialExperimentVariant = "control" | "activated_7d" | "beta";

export interface TrialExperimentAssignment {
  experimentId: string;
  variant: TrialExperimentVariant;
  durationDays: number;
  activationRequired: boolean;
  betaCohort?: boolean;
  assignedAt: string;
  activatedAt?: string | null;
}

export interface TrialExperimentSettings {
  _id?: ObjectId;
  enabled: boolean;
  enabledAt?: string | null;
  activatedTrialDurationDays: number;
  controlTrialDurationDays: number;
  betaTrialDurationDays: number;
  activatedVariantAllocationPercent: number;
  updatedAt: string;
}

export type ActivationSurveyReason =
  | "could_not_connect"
  | "did_not_understand"
  | "did_not_need_it_yet"
  | "missing_feature"
  | "technical_problem"
  | "already_use_something_else"
  | "still_testing"
  | "other";

export interface ActivationFeedback {
  _id?: ObjectId;
  userId: string;
  reason: ActivationSurveyReason;
  detail?: string | null;
  source: "dashboard" | "email" | "admin";
  createdAt: string;
}

/** Trial record stored in the `trials` collection — single source of truth. */
export interface TrialRecord {
  _id?: ObjectId;
  userId: string;
  status: TrialStatus;
  startedAt: string;
  endsAt: string;
  durationDays: number;
  extendedDays: number;
  extensionCount: number;
  stoppedAt: string | null;
  stoppedReason: string | null;
  restartedAt: string | null;
  grantedBy: string | null;
  lastModifiedBy: string | null;
  welcomeShown: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TrialSettings {
  _id?: ObjectId;
  enableForNewUsers: boolean;
  enableForExistingUsers: boolean;
  defaultDurationDays: number;
  sendExtensionEmails: boolean;
  sendRestartEmails: boolean;
  sendStopEmails: boolean;
  updatedAt: string;
}

export interface TrialAuditLog {
  _id?: ObjectId;
  userId: string;
  action: "started" | "extended" | "restarted" | "stopped" | "expired" | "reactivated";
  performedBy: string;
  previousExpiry?: string;
  newExpiry?: string;
  notes?: string;
  createdAt: string;
}

export interface TrialNotification {
  _id?: ObjectId;
  userId: string;
  type: "trial_started" | "trial_extended" | "trial_restarted" | "trial_stopped" | "trial_expired";
  sent: boolean;
  createdAt: string;
  sentAt?: string;
}

export interface PlanConfigPricing {
  NGN: { monthly: string; originalMonthly?: string; yearly: string; originalYearly?: string };
  USD: { monthly: string; originalMonthly?: string; yearly: string; originalYearly?: string };
}

export interface PlanConfigPricingStyles {
  iconBg: string;
  iconColor: string;
  border: string;
  button: string;
  buttonHover: string;
  popular?: boolean;
  popularBadgeBg?: string;
  checkColor: string;
}

export interface PlanConfigPricingFeature {
  text: string;
  prefixHighlight?: string;
}

export interface PlanConfigPricingPlan {
  id: string;
  name: string;
  target: string;
  iconName: string;
  styles: PlanConfigPricingStyles;
  pricing: PlanConfigPricing;
  features: PlanConfigPricingFeature[];
  buttonText: string;
  paystackPlanCode?: string;
  paystackAmount?: { NGN: number; USD: number };
}

export interface PlanConfigFeatureBanner {
  id: string;
  title: string;
  description: string;
  iconName: string;
  bg: string;
  color: string;
}

export interface PlanConfigSpecialOffer {
  id: string;
  enabled: boolean;
  name: string;
  description: string;
  badgeText?: string;
  ctaText?: string;
  kind: "one_time" | "discounted_subscription";
  plan: Exclude<PlanTier, "free">;
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

export interface PlanConfig {
  _id?: ObjectId;
  /** Single-document collection keyed as "default" */
  _docId?: string;
  /** Schema version. Used for migration. */
  version: number;
  plans: Record<string, PlanTierConfig>;
  creditCosts: CreditCostConfig[];
  translationWordsPerCredit: number;
  /** Trial configuration — duration, enable/disable, etc. */
  trial: PlanTrialConfig;
  /** Pricing card configs for the subscription plans page */
  pricingPlans?: PlanConfigPricingPlan[];
  /** Feature banners for the subscription plans page */
  featureBanners?: PlanConfigFeatureBanner[];
  /** Admin-managed conditional and one-time pricing offers. */
  specialOffers?: PlanConfigSpecialOffer[];
  updatedAt: string;
}

// ─── AI Generation (Growth+ feature) ────────────────────────────────────────

export interface SermonSummary {
  _id?: ObjectId;
  userId: string;
  sermonId: string;
  title: string;
  summary: string;
  keyScriptures: string[];
  mainTakeaways: string[];
  creditsUsed: number;
  createdAt: string;
}

export interface SermonNote {
  _id?: ObjectId;
  userId: string;
  sermonId: string;
  sections: { heading: string; content: string }[];
  creditsUsed: number;
  createdAt: string;
}

export interface SermonPoint {
  _id?: ObjectId;
  userId: string;
  sermonId: string;
  points: { title: string; explanation: string; scriptures: string[] }[];
  creditsUsed: number;
  createdAt: string;
}

// ─── Cloud Sync (Growth+ feature) ───────────────────────────────────────────

export interface SyncJob {
  _id?: ObjectId;
  userId: string;
  type: "backup" | "restore";
  status: "pending" | "uploading" | "completed" | "failed";
  /** Byte size of the backup payload */
  sizeBytes: number;
  /** Number of records included */
  recordCount: number;
  /** Which data categories were included */
  categories: string[];
  /** Error message if failed */
  error?: string;
  createdAt: string;
  completedAt?: string;
}

// ─── Analytics Events (Growth+ feature) ─────────────────────────────────────

export interface AnalyticsEvent {
  _id?: ObjectId;
  userId: string;
  event: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

// ─── User Storage (Growth+ feature) ─────────────────────────────────────────

export interface UserStorage {
  _id?: ObjectId;
  userId: string;
  usedBytes: number;
  quotaBytes: number;
  lastUpdated: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Reserved Emails ────────────────────────────────────────────────────────

/**
 * Permanently reserves previously-owned email addresses after an email change.
 * Prevents account takeover, email recycling attacks, and login collisions.
 */
export interface ReservedEmail {
  _id?: ObjectId;
  userId: string;
  email: string;
  reservedAt: string;
  reason: "email_change" | "account_merge" | "admin_action";
}

// ─── Transcripts ─────────────────────────────────────────────────────────────

export interface TranscriptScripture {
  id: string;
  transcriptId: string;
  reference: string;
  verseText: string;
  confidence: number;
}

export interface TranscriptTranslation {
  id: string;
  transcriptId: string;
  language: string;
  translatedText: string;
  createdAt: string;
}

export interface TranscriptDoc {
  _id?: ObjectId;
  ownerId: ObjectId;
  id: string;              // client-generated UUID
  title: string;
  church: string;
  language: string;
  durationSeconds: number;
  transcriptText: string;
  sourceType: "imported-audio" | "imported-video" | "uploaded" | "transcription";
  scriptures: TranscriptScripture[];
  translations: TranscriptTranslation[];
  createdAt: string;
  updatedAt: string;
}

// ─── App Settings (forced update / version gate) ────────────────────────────

export interface AppSettings {
  _id?: ObjectId;
  latestVersion: string;
  minimumSupportedVersion: string;
  forceUpdatesEnabled: boolean;
  emergencyLock: boolean;
  emergencyLockDelay: number; // hours: 0 = immediate, 24/48/72 = delayed
  gracePeriodHours: number;
  updateMessage: string;
  emergencyLockMessage: string;
  windowsDownloadUrl: string;
  macDownloadUrl: string;
  linuxDownloadUrl: string;
  releaseNotesUrl: string;
  policyPublishedAt: string;
  emergencyLockEnabledAt: string | null;
  emergencyLockEffectiveAt: string | null;
  updatedAt: string;
}

// ─── Custom Themes ───────────────────────────────────────────────────────────

export interface CustomThemeDoc {
  _id?: ObjectId;
  ownerId: ObjectId;
  themeId: string;         // client-generated UUID (BibleTheme.id)
  name: string;
  description?: string;
  source: "custom";
  templateType: string;
  category?: string;
  categories?: string[];
  settings: Record<string, unknown>;  // BibleThemeSettings — kept generic to avoid circular deps
  preview?: string;
  hidden?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── In-App Announcements ───────────────────────────────────────────────────

export type AnnouncementSurface = "dashboard" | "desktop";
export type AnnouncementTone = "info" | "success" | "warning" | "offer" | "upgrade";
export type AnnouncementStatus = "draft" | "scheduled" | "active" | "paused" | "archived";
export type AnnouncementAudience =
  | "all_users"
  | "free_users"
  | "paid_users"
  | "trial_users"
  | "basic_users"
  | "growth_users"
  | "ambassador_users"
  | "just_subscribed"
  | "cancelled_users"
  | "expired_trials"
  | "inactive_7d"
  | "inactive_30d"
  | "never_opened_app"
  | "reactivation_offer_users"
  | "personal_offer_users";

export type AnnouncementLayout = "standard" | "promo" | "image_only" | "custom";
export type AnnouncementButtonStyle = "primary" | "secondary" | "link";

export interface AnnouncementButton {
  id: string;
  label: string;
  url: string;
  style: AnnouncementButtonStyle;
}

export interface Announcement {
  _id?: ObjectId;
  title: string;
  message: string;
  /** Explicit layout. Missing on older announcements, which clients detect from tone and tags. */
  layout?: AnnouncementLayout;
  /** Extra action buttons (max 4). The first one is mirrored into ctaLabel/ctaUrl for older apps. */
  buttons?: AnnouncementButton[];
  /** Custom HTML/CSS shown in a sandboxed frame (no scripts). */
  bodyHtml?: string | null;
  tone: AnnouncementTone;
  status: AnnouncementStatus;
  surfaces: AnnouncementSurface[];
  audience: AnnouncementAudience;
  tags: string[];
  targetUserIds?: string[];
  targetEmails?: string[];
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  imageUrl?: string | null;
  offerCode?: string | null;
  offerDiscountPercent?: number | null;
  offerDurationMonths?: number | null;
  offerMaxRedemptions?: number | null;
  offerRedemptionCount?: number;
  offerApplicablePlans?: PlanTier[];
  offerApplicableBillingCycles?: DiscountBillingCycle[];
  /**
   * Set on the pop-up templates of the win-back offer ladders. Only users who
   * hold a live offer for this ladder rung see it (audience personal_offer_users).
   */
  personalOffer?: { ladderId: string; rungId: string } | null;
  priority: number;
  publishAt: string;
  expiresAt?: string | null;
  deliverySpacingMinutes: number;
  maxShowsPerUser: number;
  createdBy: string;
  updatedBy?: string | null;
  metrics: {
    shown: number;
    dismissed: number;
    clicked: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface AnnouncementDelivery {
  _id?: ObjectId;
  announcementId: string;
  userId: string;
  surface: AnnouncementSurface;
  showCount?: number;
  shownAt: string;
  dismissedAt?: string | null;
  clickedAt?: string | null;
  /** Survives the delivery being shown again, so click history is not lost. */
  firstClickedAt?: string | null;
  lastClickedAt?: string | null;
  clickCount?: number;
  clickedButtonId?: string | null;
  createdAt: string;
  updatedAt: string;
}
