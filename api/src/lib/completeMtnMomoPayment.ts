import { ObjectId } from "mongodb";
import clientPromise from "@/lib/mongodb";
import {
  getPlanConfig,
  insertBillingTransaction,
  insertCreditTransaction,
  upsertSubscription,
} from "@/lib/db";
import { sendEmail, paymentReceiptEmail, subscriptionActivatedEmail } from "@/lib/emailTemplates";
import { notifySubscriptionActivated } from "@/lib/notifications";
import { discountFromPaymentMetadata, recordDiscountRedemption } from "@/lib/discounts";
import { markReferralPaidForUser } from "@/lib/referrals";
import { stopActiveTrialForPaidPlan } from "@/lib/trialRecords";
import { recordActivationEvent } from "@/lib/activation";
import { resetMonthlyIncludedSeconds } from "@/lib/transcriptionCredits";
import { CreditTransactionType, type BillingCycle, type PlanTier } from "@/types/schemas";

const VALID_PLANS: PlanTier[] = ["free", "basic", "growth"];

const PLAN_NAMES: Record<string, string> = {
  free: "Free",
  basic: "Basic",
  growth: "Growth",
};

export interface CompleteMtnMomoPaymentInput {
  providerReference: string;
  userId: string;
  email: string;
  amount: number;
  currency: string;
  metadata: Record<string, any>;
  /** Provider-specific labels used when the same provisioning flow is reused. */
  paymentProvider?: string;
  paymentMethod?: string;
  completionSource?: string;
}

function normalizePlan(plan: unknown): PlanTier | null {
  const normalized = String(plan || "").trim().toLowerCase();
  if (normalized === "pro") return "growth";
  return VALID_PLANS.includes(normalized as PlanTier) ? (normalized as PlanTier) : null;
}

function resolveBillingCycle(value: unknown): Extract<BillingCycle, "monthly" | "yearly" | "lifetime"> {
  return value === "yearly" || value === "lifetime" ? value : "monthly";
}

function buildResult(input: {
  plan: PlanTier;
  billingCycle: Extract<BillingCycle, "monthly" | "yearly" | "lifetime">;
  purchaseKind: "subscription" | "one_time";
  credits: number;
  country: string;
  currency: string;
  price: number;
  pricingVersion: number;
  expiresAt: string;
  trialDaysCarried: number;
  billingTransaction: Record<string, unknown>;
  subscription: unknown;
  duplicate?: boolean;
}) {
  return {
    success: true,
    type: "subscription",
    plan: input.plan,
    planName: PLAN_NAMES[input.plan] || input.plan,
    credits: input.credits,
    billingCycle: input.billingCycle,
    purchaseKind: input.purchaseKind,
    country: input.country,
    currency: input.currency,
    lockedPrice: input.price,
    pricingVersion: input.pricingVersion,
    expiresAt: input.expiresAt,
    trialDaysCarried: input.trialDaysCarried,
    subscription: input.subscription,
    billingTransaction: input.billingTransaction,
    reference: input.billingTransaction.reference,
    ...(input.duplicate ? { duplicate: true } : {}),
  };
}

export async function completeMtnMomoPayment(input: CompleteMtnMomoPaymentInput) {
  const client = await clientPromise;
  const db = client.db();
  const metadata = input.metadata || {};
  const paymentProvider = input.paymentProvider || "mtn_momo";
  const paymentMethod = input.paymentMethod || "MTN MoMo";
  const completionSource = input.completionSource || "system:mtn-momo-status";
  const plan = normalizePlan(metadata.plan);
  if (!plan) throw new Error(`Unknown plan: ${String(metadata.plan || "")}`);

  const billingCycle = resolveBillingCycle(metadata.billingCycle);
  const purchaseKind: "subscription" | "one_time" =
    metadata.purchaseKind === "one_time" || metadata.oneTimeOffer === true || billingCycle === "lifetime"
      ? "one_time"
      : "subscription";
  // Payment metadata is locked at initialization. If a legacy transaction is
  // missing it, prefer the provider callback value and use neutral defaults;
  // never silently turn an unrelated provider transaction into GH/GHS.
  const country = String(metadata.country || "US").toUpperCase();
  const currency = String(input.currency || metadata.currency || "USD").toUpperCase();
  const price = Number(metadata.price || input.amount);
  const pricingVersion = Number(metadata.pricingVersion || 1);
  const appliedDiscount = discountFromPaymentMetadata(metadata);
  // Unused time on the previous plan that was taken off this purchase (plan change / monthly-yearly switch).
  const creditApplied = Math.max(0, Number(metadata.creditApplied) || 0);
  const creditUnusedDays = Math.max(0, Math.floor(Number(metadata.creditUnusedDays) || 0));
  const oneTimeOfferId = String(metadata.offerId || "").trim() || null;
  const oneTimeOfferName = String(metadata.offerName || "").trim() || null;
  const offerOriginalPrice = Number(metadata.offerOriginalPrice ?? metadata.originalPrice ?? 0) || null;
  const offerAppliedPrice = Number(metadata.offerAppliedPrice ?? metadata.price ?? 0) || null;
  const offerDiscountPercent = Number(metadata.offerDiscountPercent ?? 0) || null;
  const offerDiscountDurationMonths = Number(metadata.offerDiscountDurationMonths ?? 0) || null;
  const offerDiscountAmount = Number(metadata.offerDiscountAmount ?? 0) || null;
  const offerDiscountMonthsRemaining =
    purchaseKind === "subscription" && billingCycle === "monthly" && offerDiscountPercent && offerDiscountDurationMonths
      ? Math.max(0, Math.floor(offerDiscountDurationMonths) - 1)
      : null;

  const planConfig = await getPlanConfig();
  const planCredits = planConfig.plans[plan]?.credits ?? 0;

  const existingBilling = await db.collection("billing_transactions").findOne({
    paymentProvider,
    providerReference: input.providerReference,
    status: "success",
  });
  if (existingBilling) {
    const subscription = await db.collection("subscriptions").findOne(
      { userId: input.userId },
      { sort: { createdAt: -1 } },
    );
    return buildResult({
      plan,
      billingCycle,
      purchaseKind,
      credits: planCredits,
      country,
      currency,
      price,
      pricingVersion,
      expiresAt: String(existingBilling.expiresAt || ""),
      trialDaysCarried: Math.max(0, Math.floor(Number(existingBilling.trialDaysCarried) || 0)),
      subscription,
      billingTransaction: {
        _id: existingBilling._id,
        reference: input.providerReference,
        amount: existingBilling.amount,
        currency: existingBilling.currency,
        paidAt: existingBilling.paidAt,
        expiresAt: existingBilling.expiresAt,
      },
      duplicate: true,
    });
  }

  const now = new Date();
  const trialDaysCarried = purchaseKind === "subscription"
    ? Math.max(0, Math.floor(Number(metadata.trialDaysCarried) || 0))
    : 0;
  const paidPeriodDays = billingCycle === "yearly" ? 365 : 30;
  const expiresAt = billingCycle === "lifetime"
    ? "9999-12-31T23:59:59.999Z"
    : new Date(now.getTime() + (paidPeriodDays + trialDaysCarried) * 24 * 60 * 60 * 1000).toISOString();

  const billingTransaction = await insertBillingTransaction({
    userId: input.userId,
    plan,
    planName: PLAN_NAMES[plan] || plan,
    amount: input.amount,
    subtotal: appliedDiscount?.originalAmount || offerOriginalPrice || (creditApplied > 0 ? input.amount + creditApplied : input.amount),
    discount: appliedDiscount?.discountAmount || offerDiscountAmount || 0,
    discountCode: appliedDiscount?.code || null,
    discountPercent: appliedDiscount?.percentOff || offerDiscountPercent || null,
    discountDurationMonths: appliedDiscount?.durationMonths || offerDiscountDurationMonths || null,
    currency,
    paymentProvider,
    providerReference: input.providerReference,
    paymentMethod,
    type: "subscription_purchase",
    status: "success",
    billingCycle,
    purchaseKind,
    oneTimeOfferId,
    oneTimeOfferName,
    offerOriginalPrice,
    offerAppliedPrice,
    expiresAt,
    trialDaysCarried,
    ...(creditApplied > 0 ? { creditApplied, creditUnusedDays } : {}),
    paidAt: now.toISOString(),
    createdAt: now.toISOString(),
  });

  // A plan switch paid entirely by credit is not a payment: it must not count towards a referral reward.
  if (input.amount > 0) await markReferralPaidForUser(input.userId, {
    plan,
    amount: input.amount,
    currency,
    paystackReference: input.providerReference,
    billingTransactionId: billingTransaction._id?.toString() || null,
    paidAt: now.toISOString(),
  });

  let previousPlan = "free";
  try {
    const userBefore = await db.collection("users").findOne(
      { _id: new ObjectId(input.userId) },
      { projection: { plan: 1 } },
    );
    if (userBefore?.plan) previousPlan = String(userBefore.plan);
  } catch {
    // Keep the safe default for legacy non-ObjectId user identifiers.
  }

  const userUpdate = {
    plan,
    credits: planCredits,
    currentSubscriptionId: billingTransaction._id?.toString() || "",
    lastPaymentId: billingTransaction._id?.toString() || "",
    subscriptionExpiresAt: expiresAt,
  };
  let userUpdated = false;
  try {
    const result = await db.collection("users").updateOne(
      { _id: new ObjectId(input.userId) },
      { $set: userUpdate, $unset: { scheduledDowngradeAt: "" } },
    );
    userUpdated = result.modifiedCount > 0;
  } catch {
    // Fall back to the email lookup below.
  }
  if (!userUpdated && input.email) {
    await db.collection("users").updateOne({ email: input.email }, { $set: userUpdate, $unset: { scheduledDowngradeAt: "" } });
  }

  await stopActiveTrialForPaidPlan(input.userId, completionSource);

  const previousIndex = VALID_PLANS.indexOf(previousPlan as PlanTier);
  const planIndex = VALID_PLANS.indexOf(plan);
  const source = previousPlan === plan
    ? "monthly_renewal"
    : previousPlan === "free"
      ? "subscription_activation"
      : planIndex > previousIndex
        ? "plan_upgrade"
        : "plan_downgrade";
  const description = previousPlan === plan
    ? `${PLAN_NAMES[plan] || plan} ${billingCycle} Renewal`
    : previousPlan === "free"
      ? `${PLAN_NAMES[plan] || plan} Plan Activated — ${billingCycle} Credit Allocation`
      : source === "plan_upgrade"
        ? `Plan Upgrade: ${PLAN_NAMES[previousPlan] || previousPlan} → ${PLAN_NAMES[plan] || plan}`
        : `Plan Downgrade: ${PLAN_NAMES[previousPlan] || previousPlan} → ${PLAN_NAMES[plan] || plan}`;

  await insertCreditTransaction({
    userId: input.userId,
    type: CreditTransactionType.ALLOCATION,
    source: source as any,
    amount: planCredits,
    balanceAfter: planCredits,
    description,
    metadata: {
      plan,
      previousPlan,
      billingCycle,
      purchaseKind,
      providerReference: input.providerReference,
      trialDaysCarried,
      billingTransactionId: billingTransaction._id?.toString(),
      discountCode: appliedDiscount?.code,
      discountPercent: appliedDiscount?.percentOff,
      via: paymentProvider,
    },
    createdAt: now.toISOString(),
  });

  // Reset monthly included transcription seconds (preserves purchasedSeconds)
  try {
    await resetMonthlyIncludedSeconds(input.userId, plan);
  } catch (resetErr) {
    console.warn("[completeMtnMomoPayment] Failed to reset transcription balance:", resetErr);
  }

  const subscription = await upsertSubscription(input.userId, {
    plan,
    status: "active",
    billingCycle,
    price: input.amount,
    currency,
    startDate: now.toISOString(),
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: expiresAt,
    nextBillingDate: expiresAt,
    // RequestToPay is a one-off charge. Do not claim automatic renewal.
    autoRenew: false,
    purchaseKind,
    oneTimeOfferId,
    oneTimeOfferName,
    offerOriginalPrice,
    offerAppliedPrice,
    paymentProvider,
    paymentMethodSummary: paymentMethod,
    planVersion: planConfig.version,
    entitlements: planConfig.plans[plan]?.entitlements,
    subscriptionCountry: country,
    subscriptionCurrency: currency,
    subscriptionCurrencySymbol: String(metadata.currencySymbol || currency),
    lockedPrice: price,
    pricingVersion,
    discountCode: appliedDiscount?.code || null,
    discountPercent: appliedDiscount?.percentOff || offerDiscountPercent || null,
    discountDurationMonths: appliedDiscount?.durationMonths || offerDiscountDurationMonths || null,
    discountMonthsRemaining: appliedDiscount?.monthsRemainingAfterCheckout ?? offerDiscountMonthsRemaining ?? null,
    undiscountedPrice: appliedDiscount ? appliedDiscount.originalAmount : offerOriginalPrice,
    initialDiscountAmount: appliedDiscount?.discountAmount || offerDiscountAmount,
  });

  await recordDiscountRedemption({
    discount: appliedDiscount,
    userId: input.userId,
    paystackReference: input.providerReference,
    plan,
    billingCycle,
  });
  void recordActivationEvent(input.userId, "payment_completed", {
    paymentMethod: paymentProvider,
    plan,
    billingCycle,
    purchaseKind,
    reference: input.providerReference,
  }, now).catch(() => { });
  notifySubscriptionActivated(input.userId, PLAN_NAMES[plan] || plan).catch(() => { });

  let userName = "there";
  try {
    const userDoc = await db.collection("users").findOne({ _id: new ObjectId(input.userId) });
    if (userDoc?.name) userName = String(userDoc.name);
  } catch {
    // Use the default name for legacy identifiers.
  }
  if (input.email) {
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:4000").replace(/\/$/, "");
    const invoiceUrl = billingTransaction._id
      ? `${appUrl}/billing/transactions/${billingTransaction._id.toString()}`
      : undefined;
    const emailResults = await Promise.allSettled([
      sendEmail(subscriptionActivatedEmail({
        userName,
        userEmail: input.email,
        planName: PLAN_NAMES[plan] || plan,
        billingCycle,
        credits: planCredits,
        expiresAt,
        amountPaid: `${currency} ${creditApplied > 0 ? input.amount : price}`,
      })),
      // No receipt when nothing was charged (a switch paid entirely by credit).
      input.amount > 0
        ? sendEmail(paymentReceiptEmail({
          userName,
          userEmail: input.email,
          planName: PLAN_NAMES[plan] || plan,
          amount: `${currency} ${creditApplied > 0 ? input.amount : price}`,
          billingCycle,
          paidAt: now.toISOString(),
          receiptNumber: input.providerReference,
          invoiceUrl,
        }))
        : Promise.resolve(),
    ]);
    for (const [index, result] of emailResults.entries()) {
      if (result.status === "rejected") {
        console.error(`[${paymentMethod}] ${index === 0 ? "Welcome" : "Receipt"} email failed:`, result.reason);
      }
    }
  }

  return buildResult({
    plan,
    billingCycle,
    purchaseKind,
    credits: planCredits,
    country,
    currency,
    price,
    pricingVersion,
    expiresAt,
    trialDaysCarried,
    subscription,
    billingTransaction: {
      _id: billingTransaction._id,
      reference: input.providerReference,
      amount: price,
      subtotal: appliedDiscount?.originalAmount || price,
      discount: appliedDiscount?.discountAmount || 0,
      currency,
      plan: PLAN_NAMES[plan] || plan,
      billingCycle,
      purchaseKind,
      paidAt: now.toISOString(),
      expiresAt,
      trialDaysCarried,
    },
  });
}

/**
 * NOWPayments uses the same entitlement and receipt path as MTN MoMo, but
 * keeps its provider identity separate in billing records and subscriptions.
 */
export async function completeNowPaymentsPayment(input: CompleteMtnMomoPaymentInput) {
  return completeMtnMomoPayment({
    ...input,
    paymentProvider: "nowpayments",
    paymentMethod: "NOWPayments",
    completionSource: "system:nowpayments",
  });
}

/**
 * Flutterwave uses the same idempotent entitlement and receipt path as the
 * other one-time checkout providers, while keeping its provider identity in
 * billing records and subscriptions.
 */
export async function completeFlutterwavePayment(input: CompleteMtnMomoPaymentInput) {
  return completeMtnMomoPayment({
    ...input,
    paymentProvider: "flutterwave",
    paymentMethod: "Flutterwave",
    completionSource: "system:flutterwave",
  });
}
