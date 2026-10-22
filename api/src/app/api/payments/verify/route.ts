/**
 * POST /api/payments/verify
 *
 * Verifies a Paystack transaction and fully provisions the account:
 *   1. Verify with Paystack API
 *   2. Resolve user (from metadata or email)
 *   3. Create BillingTransaction record
 *   4. Update user plan + credits + subscription links
 *   5. Create/Update Subscription record
 *   6. Send welcome email
 *
 * Body: { reference: string, planId: string, billingCycle?: "monthly" | "yearly" | "lifetime" }
 */

import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import {
  upsertSubscription,
  getPlanConfig,
  insertBillingTransaction,
  insertCreditTransaction,
} from "@/lib/db";
import { sendEmail, subscriptionActivatedEmail, paymentReceiptEmail } from "@/lib/emailTemplates";
import { notifySubscriptionActivated } from "@/lib/notifications";
import { rateLimit } from "@/lib/rateLimit";
import { discountFromPaymentMetadata, recordDiscountRedemption } from "@/lib/discounts";
import { markReferralPaidForUser } from "@/lib/referrals";
import { stopActiveTrialForPaidPlan } from "@/lib/trialRecords";
import { CreditTransactionType, type BillingCycle, type PlanTier } from "@/types/schemas";
import { ObjectId } from "mongodb";
import { recordActivationEvent } from "@/lib/activation";

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "";
const PAYSTACK_API = "https://api.paystack.co";

const limiter = rateLimit({ windowMs: 60_000, max: 20 });

const VALID_PLANS: PlanTier[] = ["free", "basic", "growth"];

/** Friendly plan names for emails and billing records */
const PLAN_NAMES: Record<string, string> = {
  free: "Free",
  basic: "Basic",
  growth: "Growth",
};

function normalizeVerifiedPlan(plan: unknown): PlanTier | null {
  const normalized = String(plan || "").trim().toLowerCase();
  if (normalized === "pro") return "growth";
  return VALID_PLANS.includes(normalized as PlanTier) ? (normalized as PlanTier) : null;
}

type VerifyPaymentBody = {
  reference?: string;
  planId?: string;
  billingCycle?: BillingCycle;
  offerId?: string;
};

type PaystackVerifyResponse = {
  status?: boolean;
  message?: string;
  data?: Record<string, any> & {
    status?: string;
    amount: number;
    currency?: string;
    reference?: string;
    paid_at?: string;
    channel?: string;
    authorization?: {
      authorization_code?: string;
      reusable?: boolean;
      signature?: string;
      last4?: string;
      card_type?: string;
      bank?: string;
      exp_month?: string;
      exp_year?: string;
      channel?: string;
    };
    customer?: {
      email?: string;
      customer_code?: string;
    };
    subscription?: {
      subscription_code?: string;
    };
    receipt_url?: string;
    email?: string;
    metadata?: Record<string, any>;
  };
};

function buildAuthorizationUpdate(
  data: NonNullable<PaystackVerifyResponse["data"]>,
  fallbackEmail?: string,
): Record<string, unknown> {
  const authorization = data.authorization;
  if (!authorization?.authorization_code || authorization.reusable !== true) {
    return {};
  }

  const cardLabel = [
    authorization.card_type,
    authorization.last4 ? `ending ${authorization.last4}` : "",
  ].filter(Boolean).join(" ");

  return {
    paystackAuthorizationCode: authorization.authorization_code,
    paystackAuthorizationEmail: data.customer?.email || data.email || fallbackEmail || "",
    paystackAuthorizationSignature: authorization.signature || "",
    paystackAuthorizationReusable: true,
    paymentMethodSummary: cardLabel || authorization.bank || authorization.channel || "Saved payment method",
  };
}

export async function POST(req: NextRequest) {
  try {
    const rateResult = limiter.check(req);
    if (!rateResult.ok) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    if (!PAYSTACK_SECRET_KEY) {
      return NextResponse.json(
        { error: "Paystack not configured" },
        { status: 500 }
      );
    }

    const body = (await req.json()) as VerifyPaymentBody;
    const { reference, planId, billingCycle: bodyBillingCycle, offerId: bodyOfferId } = body;

    if (!reference) {
      return NextResponse.json(
        { error: "Missing required field: reference" },
        { status: 400 }
      );
    }

    // ── 1. Verify the transaction with Paystack ────────────────────────────

    const res = await fetch(`${PAYSTACK_API}/transaction/verify/${reference}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
    });

    const result = (await res.json()) as PaystackVerifyResponse;

    if (!result.status || result.data?.status !== "success") {
      console.error(
        "[Paystack Verify]",
        result.message || result.data?.status || "Verification failed"
      );
      return NextResponse.json(
        {
          error: result.message || "Payment verification failed",
          status: result.data?.status || "failed",
        },
        { status: 402 }
      );
    }

    const txData = result.data;
    const metadata = txData.metadata || {};
    const appliedDiscount = discountFromPaymentMetadata(metadata);
    const email = txData.customer?.email || txData.email;

    // ── 2. Resolve user ─────────────────────────────────────────────────────

    const client = await clientPromise;
    const db = client.db();

    const userId = metadata.user_id || metadata.userId;
    let targetUserId: string | null = userId || null;

    if (!targetUserId && email) {
      const user = await db.collection("users").findOne(
        { email },
        { collation: { locale: "en", strength: 2 } }
      );
      if (user) targetUserId = user._id.toString();
    }

    if (!targetUserId) {
      console.warn(`[Paystack Verify] No user found for email: ${email}`);
      return NextResponse.json(
        { error: "Could not associate payment with a user" },
        { status: 400 }
      );
    }

    // Resolve plan: prefer explicit planId, fall back to metadata
    const resolvedPlanId = planId || metadata.plan || "";
    const rawBillingCycle = String(bodyBillingCycle || metadata.billingCycle || "monthly");
    const billingCycle: BillingCycle =
      rawBillingCycle === "yearly" || rawBillingCycle === "lifetime"
        ? rawBillingCycle
        : "monthly";
    const purchaseKind: "subscription" | "one_time" =
      metadata.purchaseKind === "one_time" || metadata.oneTimeOffer === true || billingCycle === "lifetime"
        ? "one_time"
        : "subscription";
    const oneTimeOfferId = String(metadata.offerId || bodyOfferId || "").trim() || null;
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

    if (!resolvedPlanId) {
      return NextResponse.json(
        { error: "Missing required field: planId" },
        { status: 400 }
      );
    }

    // Validate plan
    const plan = normalizeVerifiedPlan(resolvedPlanId);
    if (!plan) {
      return NextResponse.json(
        { error: `Unknown plan: ${resolvedPlanId}` },
        { status: 400 }
      );
    }

    // Check for duplicate verification (idempotency)
    const existingBilling = await db
      .collection("billing_transactions")
      .findOne({ paystackReference: reference });
    if (existingBilling) {
      await markReferralPaidForUser(targetUserId, {
        plan: existingBilling.plan || plan,
        amount: existingBilling.amount ?? null,
        currency: existingBilling.currency || txData.currency || "NGN",
        paystackReference: reference,
        billingTransactionId: existingBilling._id?.toString() || null,
        paidAt: existingBilling.paidAt || existingBilling.createdAt || new Date().toISOString(),
      });
      console.warn(`[Paystack Verify] Duplicate reference: ${reference}`);
      return NextResponse.json({
        success: true,
        plan,
        subscription: null,
        billingTransaction: existingBilling,
        reference,
        duplicate: true,
      });
    }

    // ── 3. Create Billing Transaction ───────────────────────────────────────

    const now = new Date();
    const periodMs = billingCycle === "yearly" ? 365 : 30;
    const expiresAt = billingCycle === "lifetime"
      ? "9999-12-31T23:59:59.999Z"
      : new Date(now.getTime() + periodMs * 24 * 60 * 60 * 1000).toISOString();

    const billingTransaction = await insertBillingTransaction({
      userId: targetUserId,
      plan,
      planName: PLAN_NAMES[plan] || plan,
      amount: txData.amount / 100, // Paystack sends kobo/cents
      subtotal: appliedDiscount?.originalAmount || offerOriginalPrice || txData.amount / 100,
      discount: appliedDiscount?.discountAmount || offerDiscountAmount || 0,
      discountCode: appliedDiscount?.code || null,
      discountPercent: appliedDiscount?.percentOff || offerDiscountPercent || null,
      discountDurationMonths: appliedDiscount?.durationMonths || offerDiscountDurationMonths || null,
      currency: txData.currency || "NGN",
      paymentProvider: "paystack",
      paystackReference: reference,
      type: "subscription_purchase",
      status: "success",
      billingCycle,
      purchaseKind,
      oneTimeOfferId,
      oneTimeOfferName,
      offerOriginalPrice,
      offerAppliedPrice,
      receiptUrl: txData.receipt_url || undefined,
      expiresAt,
      paidAt: now.toISOString(),
      createdAt: now.toISOString(),
    });

    console.log(`[Paystack Verify] Billing transaction created: ${billingTransaction._id}`);

    await markReferralPaidForUser(targetUserId, {
      plan,
      amount: txData.amount / 100,
      currency: txData.currency || "NGN",
      paystackReference: reference,
      billingTransactionId: billingTransaction._id?.toString() || null,
      paidAt: now.toISOString(),
    });

    // ── 4. Update User Document ─────────────────────────────────────────────

    const planConfig = await getPlanConfig();
    const planCredits = planConfig.plans[plan]?.credits ?? 0;

    // Read the user's current plan BEFORE updating (needed for upgrade detection)
    let prevPlan: string = "free";
    try {
      const userBefore = await db
        .collection("users")
        .findOne({ _id: new ObjectId(targetUserId) }, { projection: { plan: 1 } });
      if (userBefore?.plan) prevPlan = userBefore.plan;
    } catch { /* use default */ }

    const userUpdate: Record<string, unknown> = {
      plan,
      credits: planCredits,
      currentSubscriptionId: billingTransaction._id?.toString() || "",
      lastPaymentId: billingTransaction._id?.toString() || "",
      subscriptionExpiresAt: expiresAt,
    };

    // Try updating by ObjectId first, fall back to email
    let userUpdated = false;
    try {
      const result = await db
        .collection("users")
        .updateOne({ _id: new ObjectId(targetUserId) }, { $set: userUpdate, $unset: { scheduledDowngradeAt: "" } });
      userUpdated = result.modifiedCount > 0;
    } catch {
      // Not a valid ObjectId — skip
    }

    if (!userUpdated && email) {
      await db
        .collection("users")
        .updateOne({ email }, { $set: userUpdate, $unset: { scheduledDowngradeAt: "" } });
    }

    await stopActiveTrialForPaidPlan(targetUserId, "system:paystack-verify");

    console.log(`[Paystack Verify] User ${targetUserId} updated: plan=${plan}, credits=${planCredits}`);

    // ── 4b. Record credit allocation transaction ────────────────────────────

    // Determine event type by comparing with previous plan
    const isSamePlan = prevPlan === plan;

    let txSource: string;
    let txDescription: string;
    if (isSamePlan) {
      txSource = "monthly_renewal";
      txDescription = `${PLAN_NAMES[plan] || plan} ${billingCycle} Renewal`;
    } else if (prevPlan === "free") {
      txSource = "subscription_activation";
      txDescription = `${PLAN_NAMES[plan] || plan} Plan Activated — ${billingCycle} Credit Allocation`;
    } else {
      const prevIdx = VALID_PLANS.indexOf(prevPlan as PlanTier);
      const newIdx = VALID_PLANS.indexOf(plan);
      if (newIdx > prevIdx) {
        txSource = "plan_upgrade";
        txDescription = `Plan Upgrade: ${PLAN_NAMES[prevPlan] || prevPlan} → ${PLAN_NAMES[plan] || plan}`;
      } else {
        txSource = "plan_downgrade";
        txDescription = `Plan Downgrade: ${PLAN_NAMES[prevPlan] || prevPlan} → ${PLAN_NAMES[plan] || plan}`;
      }
    }

    await insertCreditTransaction({
      userId: targetUserId,
      type: CreditTransactionType.ALLOCATION,
      source: txSource as any,
      amount: planCredits,
      balanceAfter: planCredits,
      description: txDescription,
      metadata: {
        plan,
        previousPlan: prevPlan,
        billingCycle,
        purchaseKind,
        oneTimeOfferId: oneTimeOfferId || undefined,
        oneTimeOfferName: oneTimeOfferName || undefined,
        paystackReference: reference,
        billingTransactionId: billingTransaction._id?.toString(),
        discountCode: appliedDiscount?.code,
        discountPercent: appliedDiscount?.percentOff,
      },
      createdAt: now.toISOString(),
    });

    // ── 5. Create / Update Subscription ─────────────────────────────────────

    const periodStart = now.toISOString();

    // Extract country pricing from metadata (set during initialize)
    const subCountry = metadata.country || "NG";
    const subCurrency = metadata.currency || txData.currency || "NGN";
    const subCurrencySymbol = metadata.currencySymbol || "₦";
    const subPrice = metadata.price || txData.amount / 100;
    const subOriginalPrice = appliedDiscount?.originalAmount || Number(metadata.originalPrice || subPrice);
    const subPricingVersion = metadata.pricingVersion || 1;

    const subscription = await upsertSubscription(targetUserId, {
      plan,
      status: "active",
      billingCycle,
      price: txData.amount / 100,
      currency: txData.currency || "NGN",
      startDate: periodStart,
      currentPeriodStart: periodStart,
      currentPeriodEnd: expiresAt,
      nextBillingDate: expiresAt,
      autoRenew: purchaseKind !== "one_time" && billingCycle !== "lifetime",
      purchaseKind,
      oneTimeOfferId,
      oneTimeOfferName,
      offerOriginalPrice,
      offerAppliedPrice,
      paystackSubscriptionCode: purchaseKind === "one_time" || billingCycle === "lifetime"
        ? undefined
        : txData.subscription?.subscription_code || undefined,
      paystackCustomerCode: txData.customer?.customer_code || undefined,
      ...buildAuthorizationUpdate(txData, email),
      planVersion: planConfig.version,
      entitlements: planConfig.plans[plan]?.entitlements,
      // Country-based pricing lock (prevents VPN abuse)
      subscriptionCountry: subCountry,
      subscriptionCurrency: subCurrency,
      subscriptionCurrencySymbol: subCurrencySymbol,
      lockedPrice: subPrice,
      pricingVersion: subPricingVersion,
      discountCode: appliedDiscount?.code || null,
      discountPercent: appliedDiscount?.percentOff || offerDiscountPercent || null,
      discountDurationMonths: appliedDiscount?.durationMonths || offerDiscountDurationMonths || null,
      discountMonthsRemaining: appliedDiscount?.monthsRemainingAfterCheckout ?? offerDiscountMonthsRemaining ?? null,
      undiscountedPrice: appliedDiscount ? subOriginalPrice : offerOriginalPrice,
      initialDiscountAmount: appliedDiscount?.discountAmount || offerDiscountAmount,
    });

    console.log(`[Paystack Verify] Subscription upserted: ${subscription._id} → ${plan}`);
    await recordDiscountRedemption({
      discount: appliedDiscount,
      userId: targetUserId,
      paystackReference: reference,
      plan,
      billingCycle,
    });

    void recordActivationEvent(targetUserId, "payment_completed", {
      paymentMethod: "paystack",
      plan,
      billingCycle,
      purchaseKind,
      reference,
    }, now).catch(() => { });

    // Notify about subscription activation (fire and forget)
    notifySubscriptionActivated(targetUserId, PLAN_NAMES[plan] || plan).catch(() => { });

    // ── 6. Send Welcome Email ───────────────────────────────────────────────

    // Fetch user name for the email
    let userName = "there";
    try {
      const userDoc = await db
        .collection("users")
        .findOne({ _id: new ObjectId(targetUserId) });
      if (userDoc?.name) userName = userDoc.name;
    } catch {
      // Use default name
    }

    const emailAddr = email || "";
    if (emailAddr) {
      const emailOpts = subscriptionActivatedEmail({
        userName,
        userEmail: emailAddr,
        planName: PLAN_NAMES[plan] || plan,
        billingCycle,
        credits: planCredits,
        expiresAt,
        amountPaid: `${subCurrency} ${subPrice}`,
      });
      // Fire and forget — don't block the response
      sendEmail(emailOpts).catch((err) =>
        console.error("[Paystack Verify] Failed to send welcome email:", err)
      );

      // Send receipt email (fire and forget)
      sendEmail(
        paymentReceiptEmail({
          userName,
          userEmail: emailAddr,
          planName: PLAN_NAMES[plan] || plan,
          amount: `${subCurrency} ${subPrice}`,
          billingCycle,
          paidAt: now.toISOString(),
          receiptNumber: reference,
        })
      ).catch(() => { });
    }

    // ── 7. Return full provisioning result ──────────────────────────────────

    return NextResponse.json({
      success: true,
      plan,
      planName: PLAN_NAMES[plan] || plan,
      credits: planCredits,
      expiresAt,
      billingCycle,
      purchaseKind,
      oneTimeOfferId,
      oneTimeOfferName,
      country: subCountry,
      currency: subCurrency,
      lockedPrice: subPrice,
      pricingVersion: subPricingVersion,
      discount: appliedDiscount,
      subscription,
      billingTransaction: {
        _id: billingTransaction._id,
        reference,
        amount: subPrice,
        subtotal: appliedDiscount?.originalAmount || subPrice,
        discount: appliedDiscount?.discountAmount || 0,
        currency: subCurrency,
        plan: PLAN_NAMES[plan] || plan,
        billingCycle,
        purchaseKind,
        oneTimeOfferId,
        oneTimeOfferName,
        paidAt: now.toISOString(),
        expiresAt,
      },
      reference,
    });
  } catch (error) {
    console.error("[Paystack Verify] Error:", error);
    return NextResponse.json(
      { error: "Verification failed" },
      { status: 500 }
    );
  }
}
