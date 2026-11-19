/**
 * API client for the MakeChurchEazy backend.
 *
 * All requests use relative paths so they go through Next.js rewrites
 * (proxying to the backend), keeping cookies same-origin.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(
      body.error || `Request failed: ${res.status}`,
      res.status,
      typeof body.code === "string" ? body.code : undefined,
    );
  }

  return res.json();
}

// ─── User ────────────────────────────────────────────────────────────────────

export interface User {
  _id: string;
  name: string;
  email: string;
  avatar: string;
  churchName: string;
  churchProfileId?: string;
  devices?: string[];
  country: string;
  phone: string;
  jobTitle: string;
  language: string;
  timezone: string;
  role: string;
  plan: string;
  credits: number;
  appId: string;
  loginMethods: {
    email: boolean;
    google: boolean;
    microsoft: boolean;
  };
  passwordLastChanged: string | null;
  emailHistory?: { email: string; changedAt: string }[];
  createdAt: string;
  lastLogin: string;
  ambassador?: {
    active?: boolean;
    grantedBy?: string;
    grantedAt?: string;
    expiresAt?: string;
    creditsGranted?: number;
    previousPlan?: string;
    notes?: string;
  } | null;
}

export async function getUser(userId: string): Promise<User | null> {
  return request(`/api/user?userId=${userId}`);
}

export async function updateUser(
  userId: string,
  updates: Partial<Pick<User, "name" | "churchName" | "avatar" | "churchProfileId" | "devices" | "country" | "phone" | "jobTitle" | "language" | "timezone" | "loginMethods" | "passwordLastChanged">>
): Promise<void> {
  await request("/api/user", {
    method: "PATCH",
    body: JSON.stringify({ userId, ...updates }),
  });
}

export async function deleteUserAccount(userId: string): Promise<void> {
  await request(`/api/user?userId=${userId}`, { method: "DELETE" });
}

// ─── Referrals ──────────────────────────────────────────────────────────────

export interface ReferralUserSummary {
  id: string;
  name: string;
  email: string;
  churchName: string;
  plan: string;
}

export interface ReferralListItem {
  id: string;
  code: string;
  status: "signed_up" | "paid";
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  paidPlan: string | null;
  paidAmount: number | null;
  paidCurrency: string | null;
  paidBillingReference: string | null;
  /** When the referrer was paid their reward; null while still owed. */
  payoutPaidAt?: string | null;
  referredUser: ReferralUserSummary | null;
  referrerUser?: ReferralUserSummary | null;
}

export interface ReferralDashboardData {
  code: string;
  promptSkippedAt: string | null;
  referralRequired?: boolean;
  referredBy: {
    code: string;
    referrerUserId: string;
    referralId: string;
    appliedAt: string;
  } | null;
  stats: {
    totalSignups: number;
    paidSignups: number;
    pendingSignups: number;
    conversionRate: number;
  };
  referrals: ReferralListItem[];
}

export async function getReferrals(): Promise<ReferralDashboardData> {
  return request("/api/referrals");
}

export async function applyReferralCode(code: string): Promise<{ success: boolean; alreadyApplied: boolean }> {
  return request("/api/referrals", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function dismissReferralPrompt(): Promise<{ success: boolean; skippedAt: string }> {
  return request("/api/referrals", {
    method: "POST",
    body: JSON.stringify({ action: "dismiss" }),
  });
}

export interface AdminReferralOverview {
  stats: {
    totalSignups: number;
    paidSignups: number;
    pendingSignups: number;
    referrers: number;
    /** Paid referrals whose referrer has not been paid out yet. */
    payoutsOwed?: number;
    conversionRate: number;
  };
  referrals: ReferralListItem[];
}

export async function getAdminReferrals(limit = 500): Promise<AdminReferralOverview> {
  return request(`/api/admin/referrals?limit=${limit}`);
}

export async function setAdminReferralPayoutSent(
  referralId: string,
  payoutSent: boolean,
): Promise<{ success: boolean; referralId: string; payoutPaidAt: string | null }> {
  return request("/api/admin/referrals", {
    method: "PATCH",
    body: JSON.stringify({ referralId, payoutSent }),
  });
}

export async function getAdminUserReferrals(userId: string): Promise<ReferralDashboardData & { referredByDetails?: ReferralListItem["referredUser"] | null }> {
  return request(`/api/admin/users/${encodeURIComponent(userId)}/referrals`);
}

// ─── Devices ─────────────────────────────────────────────────────────────────

export interface Device {
  id: string;
  deviceId: string;
  deviceName: string;
  lastSeen: string;
  createdAt: string;
}

export async function getDevices(): Promise<Device[]> {
  return request("/api/devices");
}

export async function deleteDevice(deviceId: string): Promise<void> {
  return request("/api/devices", {
    method: "DELETE",
    body: JSON.stringify({ deviceId }),
  });
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

export interface ChurchSpeaker {
  name: string;
  role: string;
  imageUrl?: string;
  isMain?: boolean;
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
  _id?: string;
  userId: string;
  churchName: string;
  tagline: string;
  website: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  timezone: string;
  churchSize: string;
  branding: ChurchBranding;
  presentationDefaults: ChurchPresentationDefaults;
  speakers: ChurchSpeaker[];
  socialMedia: ChurchSocialMedia;
  createdAt: string;
  updatedAt: string;
}

export async function getChurchProfile(userId: string): Promise<ChurchProfile | null> {
  return request(`/api/church-profile?userId=${userId}`);
}

export async function updateChurchProfile(
  userId: string,
  updates: Partial<ChurchProfile>
): Promise<ChurchProfile> {
  return request("/api/church-profile", {
    method: "PUT",
    body: JSON.stringify({ userId, ...updates }),
  });
}

// ─── Countries ──────────────────────────────────────────────────────────────

export interface Country {
  _id?: string;
  name: string;
  iso2: string;
  iso3: string;
  flag: string;
  region: string;
  subregion: string;
}

export async function getCountries(): Promise<Country[]> {
  return request("/api/countries");
}

// ─── Subscription ────────────────────────────────────────────────────────────

export interface Subscription {
  _id?: string;
  userId: string;
  plan: string;
  status: string;
  billingCycle: string;
  purchaseKind?: "subscription" | "one_time";
  oneTimeOfferId?: string | null;
  oneTimeOfferName?: string | null;
  offerOriginalPrice?: number | null;
  offerAppliedPrice?: number | null;
  price: number;
  currency: string;
  discountCode?: string | null;
  discountPercent?: number | null;
  discountDurationMonths?: number | null;
  discountMonthsRemaining?: number | null;
  undiscountedPrice?: number | null;
  initialDiscountAmount?: number | null;
  startDate: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  nextBillingDate: string;
  autoRenew: boolean;
  cancelledAt?: string;
  cancelAtPeriodEnd?: boolean;
  pendingPlan?: string;
  pendingChangeType?: string;
  pendingChangeEffectiveAt?: string;
  paymentFailedAt?: string;
  gracePeriodEndsAt?: string;
  retryCount?: number;
  nextRetryAt?: string;
  paymentProvider?: string;
  previousPlan?: string;
  createdAt: string;
  updatedAt: string;
}

export async function getSubscription(userId: string): Promise<Subscription | null> {
  return request(`/api/subscriptions?userId=${userId}`);
}

// ─── User Usage ──────────────────────────────────────────────────────────────

export interface UserUsage {
  userId: string;
  songs: number;
  images: number;
  videos: number;
  themes: number;
  lowerThirds: number;
  devices: number;
  bibleVersions: number;
  lastSyncedAt: string | null;
}

export async function getUserUsage(userId: string): Promise<UserUsage> {
  return request(`/api/user/usage?userId=${userId}`);
}

// ─── Credit Transactions ─────────────────────────────────────────────────────

export interface CreditTransaction {
  _id?: string;
  userId: string;
  type: string;
  source: string;
  amount: number;
  balanceAfter: number;
  description: string;
  createdAt: string;
}

export interface CreditTransactionsResponse {
  transactions: CreditTransaction[];
  total: number;
  limit: number;
  skip: number;
}

export async function getCreditTransactions(
  userId: string,
  options: { limit?: number; skip?: number; type?: string } = {}
): Promise<CreditTransactionsResponse> {
  const params = new URLSearchParams({ userId });
  if (options.limit) params.set("limit", String(options.limit));
  if (options.skip) params.set("skip", String(options.skip));
  if (options.type) params.set("type", options.type);
  return request(`/api/credit-transactions?${params}`);
}

export async function getCreditUsageByDay(
  userId: string,
  days: number = 7
): Promise<{ usage: { date: string; amount: number }[] }> {
  return request(`/api/credit-transactions/stats?userId=${userId}&days=${days}`);
}

export async function deductCredits(
  userId: string,
  amount: number,
  source: string,
  description: string,
  metadata?: Record<string, unknown>
): Promise<{ credits: number; deducted: number }> {
  return request("/api/credit-transactions/deduct", {
    method: "POST",
    body: JSON.stringify({ userId, amount, source, description, metadata }),
  });
}

// ─── Billing Transactions ───────────────────────────────────────────────────

export interface BillingTransaction {
  _id?: string;
  userId: string;
  plan: string;
  amount: number;
  currency: string;
  paymentProvider: string;
  paystackReference?: string;
  providerReference?: string;
  type: "subscription_purchase" | "subscription_renewal" | "plan_upgrade" | "credit_purchase" | "refund";
  status: "pending" | "success" | "failed" | "refunded";
  subtotal?: number;
  discount?: number;
  discountCode?: string | null;
  discountPercent?: number | null;
  discountDurationMonths?: number | null;
  receiptUrl?: string;
  paidAt: string;
  createdAt: string;
  billingCycle?: "monthly" | "yearly" | "lifetime" | "one_time";
  purchaseKind?: "subscription" | "one_time";
  oneTimeOfferId?: string | null;
  oneTimeOfferName?: string | null;
  offerOriginalPrice?: number | null;
  offerAppliedPrice?: number | null;
}

export interface BillingTransactionsResponse {
  transactions: BillingTransaction[];
  total: number;
  limit: number;
  skip: number;
}

export async function getBillingTransactions(
  userId: string,
  options: { limit?: number; skip?: number } = {}
): Promise<BillingTransactionsResponse> {
  const params = new URLSearchParams({ userId });
  if (options.limit) params.set("limit", String(options.limit));
  if (options.skip) params.set("skip", String(options.skip));
  return request(`/api/billing-transactions?${params}`);
}

// ─── Transaction Detail ───────────────────────────────────────────────────────

export interface TransactionDetail {
  _id: string;
  category: "billing" | "ai_usage" | "credit";
  reference: string;
  type: string;
  status: string;
  title: string;
  description: string;
  amount: number;
  currency?: string;
  isCredit?: boolean;
  subtotal?: number;
  discount?: number;
  discountCode?: string | null;
  discountPercent?: number | null;
  discountDurationMonths?: number | null;
  tax?: number;
  total?: number;
  paymentMethod?: string | null;
  paymentProvider?: string;
  providerReference?: string;
  plan?: string;
  planName?: string;
  billingCycle?: string;
  billingPeriodStart?: string | null;
  billingPeriodEnd?: string | null;
  nextBillingDate?: string | null;
  autoRenew?: boolean;
  failureCode?: string | null;
  failureReason?: string | null;
  creditChange?: number;
  balanceBefore?: number | null;
  balanceAfter?: number | null;
  feature?: string | null;
  usageQuantity?: number | null;
  usageUnit?: string;
  duration?: string | null;
  creditCosts?: { feature: string; creditsPerMinute: number; creditsPerUnit: number }[] | null;
  receiptUrl?: string | null;
  paidAt?: string | null;
  createdAt: string;
  userId?: string;
}

export async function getTransactionDetail(
  transactionId: string,
): Promise<TransactionDetail> {
  return request(`/api/billing/transactions/${transactionId}`);
}

export interface RetryPaymentResponse {
  authorization_url: string;
  access_code: string;
  reference: string;
  amount: number;
  currency: string;
  currencySymbol: string;
  price: number;
}

export async function retryPayment(
  transactionId: string,
): Promise<RetryPaymentResponse> {
  return request("/api/payments/retry", {
    method: "POST",
    body: JSON.stringify({ transactionId }),
  });
}

// ─── Security Sessions ───────────────────────────────────────────────────────

export interface SecuritySession {
  _id?: string;
  userId: string;
  sessionId: string;
  deviceName: string;
  devicePlatform: string;
  deviceOs: string;
  browser: string;
  ipAddress: string;
  location: string;
  lastActive: string;
  createdAt: string;
  isCurrent: boolean;
}

export async function getSecuritySessions(userId: string): Promise<SecuritySession[]> {
  return request(`/api/sessions?userId=${userId}`);
}

export async function terminateOtherSessions(
  userId: string,
  currentSessionId: string
): Promise<{ deletedCount: number }> {
  return request("/api/sessions/terminate-others", {
    method: "POST",
    body: JSON.stringify({ userId, currentSessionId }),
  });
}

export async function deleteSecuritySession(sessionId: string): Promise<{ success: boolean }> {
  return request("/api/sessions", {
    method: "DELETE",
    body: JSON.stringify({ sessionId }),
  });
}

export async function registerSession(session: {
  sessionId: string;
  deviceName: string;
  devicePlatform: string;
  deviceOs: string;
  browser?: string;
  ipAddress?: string;
  location?: string;
}): Promise<SecuritySession> {
  return request("/api/sessions", {
    method: "POST",
    body: JSON.stringify(session),
  });
}

// ─── Email Change ───────────────────────────────────────────────────────────

export interface EmailCooldownStatus {
  email: string;
  emailChangedAt: string | null;
  nextEmailChangeAt: string | null;
  pendingEmail: string | null;
  emailChangeTokenExpires: string | null;
  inCooldown: boolean;
}

export async function getEmailCooldownStatus(): Promise<EmailCooldownStatus> {
  return request("/api/auth/change-email");
}

export async function requestEmailChange(
  newEmail: string
): Promise<{ success: boolean; message: string }> {
  return request("/api/auth/change-email", {
    method: "POST",
    body: JSON.stringify({ newEmail }),
  });
}

export async function confirmEmailChange(
  token: string
): Promise<{ success: boolean; message: string; nextEmailChangeAt: string }> {
  return request("/api/auth/confirm-email-change", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export async function sendVerificationEmail(email?: string): Promise<{ success: boolean; message: string }> {
  return request("/api/auth/send-verification", {
    method: "POST",
    body: email ? JSON.stringify({ email }) : undefined,
  });
}

export async function verifyEmailCode(
  email: string,
  code: string
): Promise<{ success: boolean; message: string }> {
  return request("/api/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
}

export async function sendPasswordResetEmail(
  email: string
): Promise<{ success: boolean; message: string }> {
  return request("/api/auth/send-password-reset", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function changePassword(
  newPassword: string
): Promise<{ success: boolean }> {
  return request("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ newPassword }),
  });
}

// ─── Pairing ─────────────────────────────────────────────────────────────────

export function normalizePairingCode(raw: string): string {
  return raw.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function formatPairingCodeForDisplay(raw: string): string {
  const normalized = normalizePairingCode(raw);
  return normalized.length > 4
    ? `${normalized.slice(0, 4)}-${normalized.slice(4, 8)}`
    : normalized;
}

export async function createPairingCode(
  deviceName: string = "MakeChurchEazy",
  ttlSeconds?: number,
): Promise<{ code: string; expiresAt: string }> {
  const result = await request<{ code: string; expiresAt: string }>("/api/pairing/create", {
    method: "POST",
    body: JSON.stringify({ deviceName, ttlSeconds }),
  });
  return { ...result, code: normalizePairingCode(result.code) };
}

export async function authorizePairingCode(
  code: string
): Promise<{ success: boolean }> {
  return request("/api/pairing/authorize", {
    method: "POST",
    body: JSON.stringify({ code: normalizePairingCode(code) }),
  });
}

export async function rejectPairingCode(
  code: string
): Promise<{ success: boolean }> {
  return request("/api/pairing/reject", {
    method: "POST",
    body: JSON.stringify({ code: normalizePairingCode(code) }),
  });
}

export async function resendVerificationEmail(): Promise<{ success: boolean; alreadyVerified?: boolean; message?: string }> {
  return request("/api/pairing/resend-verification", {
    method: "POST",
  });
}

export async function checkVerificationStatus(
  code: string
): Promise<{ verified: boolean }> {
  return request("/api/pairing/check-verification", {
    method: "POST",
    body: JSON.stringify({ code: normalizePairingCode(code) }),
  });
}

// ─── Downloads ───────────────────────────────────────────────────────────────

export async function recordDownload(
  userId: string,
  downloadedVersion: string
): Promise<void> {
  await request("/api/downloads", {
    method: "POST",
    body: JSON.stringify({ userId, downloadedVersion }),
  });
}

// ─── Two-Factor Authentication ──────────────────────────────────────────────

export async function setup2FA(): Promise<{ secret: string; otpauthUrl: string; qrCode?: string }> {
  return request("/api/auth/2fa/setup", { method: "POST" });
}

export async function verify2FA(
  token: string,
  secret?: string
): Promise<{ success: boolean; recoveryCodes?: string[] }> {
  return request("/api/auth/2fa/verify", {
    method: "POST",
    body: JSON.stringify({ token, secret }),
  });
}

export async function get2FAStatus(): Promise<{ enabled: boolean }> {
  return request("/api/auth/2fa/status");
}

export async function disable2FA(token: string): Promise<{ success: boolean }> {
  return request("/api/auth/2fa/disable", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

// ─── Transcripts ─────────────────────────────────────────────────────────────

export interface TranscriptRecord {
  id: string;
  title: string;
  church: string;
  language: string;
  durationSeconds: number;
  transcriptText: string;
  sourceType: string;
  scriptures: { id: string; transcriptId: string; reference: string; verseText: string; confidence: number }[];
  translations: { id: string; transcriptId: string; language: string; translatedText: string; createdAt: string }[];
  createdAt: string;
  updatedAt: string;
}

export async function getTranscripts(): Promise<TranscriptRecord[]> {
  const data = await request<{ transcripts: TranscriptRecord[] }>("/api/transcripts");
  return data.transcripts || [];
}

export async function saveTranscript(transcript: TranscriptRecord): Promise<{ success: boolean }> {
  return request("/api/transcripts", {
    method: "POST",
    body: JSON.stringify({ transcript }),
  });
}

export async function deleteTranscript(id: string): Promise<{ success: boolean }> {
  return request(`/api/transcripts?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// ─── Custom Themes ───────────────────────────────────────────────────────────

export interface CustomThemeRecord {
  themeId: string;
  name: string;
  description?: string;
  source: string;
  templateType: string;
  category?: string;
  categories?: string[];
  settings: Record<string, unknown>;
  preview?: string;
  hidden?: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function getCustomThemes(): Promise<CustomThemeRecord[]> {
  const data = await request<{ themes: CustomThemeRecord[] }>("/api/themes");
  return data.themes || [];
}

export async function saveCustomTheme(theme: CustomThemeRecord): Promise<{ success: boolean }> {
  return request("/api/themes", {
    method: "POST",
    body: JSON.stringify({ theme }),
  });
}

export async function deleteCustomTheme(themeId: string): Promise<{ success: boolean }> {
  return request(`/api/themes?themeId=${encodeURIComponent(themeId)}`, {
    method: "DELETE",
  });
}

// ─── Transcription Credits & Top-ups ──────────────────────────────────────────

export interface TranscriptionBalanceSummary {
  userId: string;
  includedSeconds: number;
  purchasedSeconds: number;
  totalAvailableSeconds: number;
  includedCredits: number;
  purchasedCredits: number;
  totalAvailableCredits: number;
  includedHours: number;
  purchasedHours: number;
  totalAvailableHours: number;
  effectivePlan: string;
  isAdmin: boolean;
  unlimited: boolean;
  lastResetAt: string;
  nextResetAt?: string | null;
  formattedRemaining: string;
}

export interface TopupPackage {
  id: string;
  hours: number;
  credits: number;
  seconds: number;
  price: number;
  currency: string;
  pricePerHour: number;
  pricePerCredit: number;
  badge?: string;
  description: string;
}

export interface TopupPricingResult {
  currency: string;
  usdRate: number;
  providerCostPerHourUSD: number;
  profitPerHourNGN: number;
  sellingPricePerHour: number;
  packages: TopupPackage[];
}

export async function getTranscriptionBalance(): Promise<TranscriptionBalanceSummary> {
  return request<TranscriptionBalanceSummary>("/api/transcription/balance");
}

export async function getTranscriptionPackages(currency?: string): Promise<TopupPricingResult> {
  const query = currency ? `?currency=${encodeURIComponent(currency)}` : "";
  return request<TopupPricingResult>(`/api/transcription/packages${query}`);
}

export async function createTranscriptionTopup(
  packId: string,
  returnUrl?: string
): Promise<{ authorization_url: string; reference: string }> {
  return request<{ authorization_url: string; reference: string }>("/api/transcription/topup", {
    method: "POST",
    body: JSON.stringify({ packId, returnUrl }),
  });
}

export async function verifyTranscriptionTopup(
  reference: string,
  transactionId?: string
): Promise<{ success: boolean; balance: TranscriptionBalanceSummary; alreadyProcessed?: boolean }> {
  return request<{ success: boolean; balance: TranscriptionBalanceSummary; alreadyProcessed?: boolean }>(
    "/api/transcription/topup/verify",
    {
      method: "POST",
      body: JSON.stringify({ reference, transactionId }),
    }
  );
}

// ─── Admin Transcription Pricing & Balance Adjustments ────────────────────────

export interface AdminTranscriptionPricingResponse {
  transcriptionPricing: {
    providerCostPerHourUSD: number;
    profitPerHourNGN: number;
    freeDailyMinutes: number;
    freeWeeklyMinutes: number;
    sellingPricePerHourNGN?: number;
    sellingPricePerHourUSD?: number;
    tierPackages: Array<{
      id: string;
      hours: number;
      badge?: string;
      description: string;
      customPriceNGN?: number;
      customPriceUSD?: number;
    }>;
    planIncludedHours: {
      free: number;
      trial: number;
      basic: number;
      growth: number;
      pro: number;
      ambassador?: number;
    };
  };
  usdRate: number;
  pricingPreviewNGN: TopupPricingResult;
  pricingPreviewUSD: TopupPricingResult;
}

export async function getAdminTranscriptionPricing(): Promise<AdminTranscriptionPricingResponse> {
  return request<AdminTranscriptionPricingResponse>("/api/admin/transcription-pricing");
}

export async function updateAdminTranscriptionPricing(
  data: Partial<AdminTranscriptionPricingResponse["transcriptionPricing"]>
): Promise<{
  success: boolean;
  transcriptionPricing: AdminTranscriptionPricingResponse["transcriptionPricing"];
  pricingPreviewNGN: TopupPricingResult;
  pricingPreviewUSD: TopupPricingResult;
  balanceSync?: { matched: number; reset: number; failed: number };
}> {
  return request("/api/admin/transcription-pricing", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function getAdminUserCredits(
  userId: string
): Promise<{
  credits: number;
  transcriptionBalance: TranscriptionBalanceSummary;
  recentTransactions: Array<{
    _id?: string;
    type: string;
    source: string;
    seconds: number;
    credits: number;
    description: string;
    createdAt: string;
  }>;
}> {
  return request(`/api/admin/users/${encodeURIComponent(userId)}/credits`);
}

export async function adminAdjustUserCredits(
  userId: string,
  params: {
    amount: number;
    unit?: "hours" | "credits" | "seconds";
    action?: "increase" | "decrease" | "set";
    target?: "purchased" | "included" | "auto";
    reason?: string;
  }
): Promise<{
  success: boolean;
  credits: number;
  transcriptionBalance: TranscriptionBalanceSummary;
  adjustedHours: number;
  adjustedCredits: number;
  action: "increase" | "decrease" | "set";
  message: string;
}> {
  return request(`/api/admin/users/${encodeURIComponent(userId)}/credits`, {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/** Public check used on signup: does this referral code exist? (Never says who owns it.) */
export async function validateReferralCode(code: string): Promise<{ valid: boolean; code: string; error?: string }> {
  const res = await fetch(`/api/referrals/validate?code=${encodeURIComponent(code)}`, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  // Anything but a clean answer (rate limit, server error) means "couldn't check", not "invalid".
  if (!res.ok) {
    throw new ApiError(body.error || `Request failed: ${res.status}`, res.status);
  }
  return { valid: Boolean(body.valid), code: String(body.code || code), error: typeof body.error === "string" ? body.error : undefined };
}
