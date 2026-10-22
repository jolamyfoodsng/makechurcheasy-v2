/**
 * GET /api/cron/subscription-lifecycle
 *
 * Runs daily to manage the subscription lifecycle:
 * 1. Process scheduled plan changes (downgrades at period end)
 * 2. Expire grace periods (past_due → Free after GRACE_PERIOD_DAYS)
 * 3. Reconcile paid plans and expire stale access
 * 4. Send renewal reminders (7-day, 2-day and 1-day) and expiry emails
 *
 * Protected by CRON_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import {
  getPlanConfig,
  insertCreditTransaction,
  insertBillingTransaction,
  upsertSubscription,
} from "@/lib/db";
import {
  sendEmail,
  subscriptionCancelledEmail,
  subscriptionExpiringSoonEmail,
  subscriptionExpiredEmail,
  paymentReceiptEmail,
  paymentFailedEmail,
  subscriptionRenewedEmail,
  subscriptionGracePeriodReminderEmail,
} from "@/lib/emailTemplates";
import {
  notifySubscriptionCancelled,
  notifyPaymentFailed,
  notifySubscriptionRenewed,
  notifyGracePeriodActive,
} from "@/lib/notifications";
import { CreditTransactionType, type PlanTier } from "@/types/schemas";
import { ObjectId } from "mongodb";
import crypto from "node:crypto";
import {
  getSubscriptionLifecycleWindow,
  hasProtectedAccess,
  isLifetimeSubscription,
  normalizePaidPlan,
  subscriptionDaysLeft,
  toSubscriptionExpiryKey,
} from "@/lib/subscriptionLifecycle";
import { resetMonthlyIncludedSeconds } from "@/lib/transcriptionCredits";

const CRON_SECRET = process.env.CRON_SECRET || "";
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "";
const PAYSTACK_API = "https://api.paystack.co";
const GRACE_PERIOD_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function verifyAuth(req: NextRequest): boolean {
  if (!CRON_SECRET) return false;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${CRON_SECRET}`;
}

const PLAN_ORDER: PlanTier[] = ["free", "basic", "growth"];

function objectIdFor(value: unknown): ObjectId | null {
  const raw = String(value || "");
  return ObjectId.isValid(raw) ? new ObjectId(raw) : null;
}

function planRank(plan: unknown): number {
  const normalized = normalizePaidPlan(plan) || "free";
  return PLAN_ORDER.indexOf(normalized);
}

function isActiveSubscriptionStatus(status: unknown): boolean {
  return status === "active" || status === "cancelled" || status === "trialing" || status === "past_due";
}

type PaystackChargeAuthorizationResponse = {
  status?: boolean;
  message?: string;
  data?: {
    status?: string;
    reference?: string;
    amount?: number;
    currency?: string;
    paid_at?: string;
    receipt_url?: string;
    gateway_response?: string;
    authorization?: {
      authorization_code?: string;
      reusable?: boolean;
      signature?: string;
      last4?: string;
      card_type?: string;
      bank?: string;
      channel?: string;
    };
    customer?: {
      email?: string;
      customer_code?: string;
    };
  };
};

function planName(plan: string): string {
  return plan === "growth" ? "Growth" : plan === "basic" ? "Basic" : "Free";
}

function asPlanTier(value: unknown): PlanTier {
  const normalized = String(value || "free").trim().toLowerCase();
  if (normalized === "basic" || normalized === "growth") return normalized;
  return "free";
}

function positiveNumber(value: unknown): number | null {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function addBillingPeriod(from: Date, cycle: string): string {
  const next = new Date(from);
  if (cycle === "yearly") {
    next.setFullYear(next.getFullYear() + 1);
  } else {
    next.setMonth(next.getMonth() + 1);
  }
  return next.toISOString();
}

function renewalPricing(sub: Record<string, any>) {
  const subtotal =
    positiveNumber(sub.undiscountedPrice) ||
    positiveNumber(sub.lockedPrice) ||
    positiveNumber(sub.price) ||
    0;
  const remainingDiscountMonths = Math.max(0, Math.floor(Number(sub.discountMonthsRemaining || 0)));
  const percentOff = Math.max(0, Math.min(95, Number(sub.discountPercent || 0)));
  const useDiscount = sub.billingCycle === "monthly" && remainingDiscountMonths > 0 && percentOff > 0;
  const discount = useDiscount ? roundMoney((subtotal * percentOff) / 100) : 0;
  const amount = Math.max(1, roundMoney(subtotal - discount));

  return {
    amount,
    subtotal,
    discount,
    discountCode: useDiscount ? sub.discountCode || null : null,
    discountPercent: useDiscount ? percentOff : null,
    discountMonthsRemaining: useDiscount ? remainingDiscountMonths - 1 : remainingDiscountMonths,
  };
}

function buildAuthorizationUpdate(
  data: PaystackChargeAuthorizationResponse["data"] | undefined,
  fallbackEmail: string,
): Record<string, unknown> {
  const authorization = data?.authorization;
  if (!authorization?.authorization_code || authorization.reusable !== true) return {};

  const cardLabel = [
    authorization.card_type,
    authorization.last4 ? `ending ${authorization.last4}` : "",
  ].filter(Boolean).join(" ");

  return {
    paystackAuthorizationCode: authorization.authorization_code,
    paystackAuthorizationEmail: data?.customer?.email || fallbackEmail,
    paystackAuthorizationSignature: authorization.signature || "",
    paystackAuthorizationReusable: true,
    paymentMethodSummary: cardLabel || authorization.bank || authorization.channel || "Saved payment method",
  };
}

async function chargeSavedAuthorization({
  authorizationCode,
  email,
  amount,
  currency,
  reference,
  metadata,
}: {
  authorizationCode: string;
  email: string;
  amount: number;
  currency: string;
  reference: string;
  metadata: Record<string, unknown>;
}): Promise<PaystackChargeAuthorizationResponse> {
  const response = await fetch(`${PAYSTACK_API}/transaction/charge_authorization`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      authorization_code: authorizationCode,
      email,
      amount: Math.round(amount * 100),
      currency,
      reference,
      metadata,
    }),
  });

  const result = (await response.json()) as PaystackChargeAuthorizationResponse;
  if (!response.ok || !result.status || result.data?.status !== "success") {
    const reason = result.data?.gateway_response || result.message || "Payment could not be completed";
    throw new Error(reason);
  }
  return result;
}

async function markPastDue({
  db,
  sub,
  user,
  reason,
  reference,
  amount,
  currency,
  nowISO,
}: {
  db: any;
  sub: Record<string, any>;
  user: Record<string, any>;
  reason: string;
  reference: string;
  amount: number;
  currency: string;
  nowISO: string;
}) {
  const plan = asPlanTier(sub.plan);
  const graceEndsAt = new Date(Date.now() + GRACE_PERIOD_DAYS * DAY_MS).toISOString();
  const retryCount = Math.max(0, Number(sub.retryCount || 0)) + 1;

  const existingFailure = await db.collection("billing_transactions").findOne({ paystackReference: reference });
  if (!existingFailure) {
    await insertBillingTransaction({
      userId: sub.userId,
      plan,
      planName: planName(plan),
      amount,
      currency,
      paymentProvider: "paystack",
      paystackReference: reference,
      type: "subscription_renewal",
      status: "failed",
      billingCycle: sub.billingCycle === "yearly" ? "yearly" : "monthly",
      failureReason: reason,
      failureCode: reason,
      expiresAt: graceEndsAt,
      paidAt: nowISO,
      createdAt: nowISO,
    } as any);
  }

  await db.collection("subscriptions").updateOne(
    { _id: sub._id },
    {
      $set: {
        status: "past_due",
        paymentFailedAt: nowISO,
        gracePeriodEndsAt: graceEndsAt,
        retryCount,
        nextRetryAt: new Date(Date.now() + DAY_MS).toISOString(),
        updatedAt: nowISO,
      },
    },
  );

  await db.collection("users").updateOne(
    { _id: new ObjectId(sub.userId) },
    {
      $set: {
        plan,
        previousPaidPlan: plan,
        subscriptionExpiresAt: graceEndsAt,
      },
    },
  );

  if (user.email) {
    await sendEmail(paymentFailedEmail({
      userName: user.name || "there",
      userEmail: user.email,
      planName: planName(plan),
      gracePeriodEndsAt: graceEndsAt,
    })).catch(() => {});
  }
  notifyPaymentFailed(sub.userId, planName(plan)).catch(() => {});

  return graceEndsAt;
}

export async function GET(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, Record<string, number>> = {};
  const now = new Date();
  const nowISO = now.toISOString();

  try {
    const client = await clientPromise;
    const db = client.db();

    // ── 1. Process auto-renewal charges and failed-payment retries ───────────
    const dueRenewals = await db
      .collection("subscriptions")
      .find({
        autoRenew: true,
        plan: { $in: ["basic", "growth"] },
        billingCycle: { $in: ["monthly", "yearly"] },
        $or: [
          {
            status: "active",
            $or: [
              { nextBillingDate: { $lte: nowISO } },
              { nextBillingDate: { $exists: false }, currentPeriodEnd: { $lte: nowISO } },
              { nextBillingDate: "", currentPeriodEnd: { $lte: nowISO } },
            ],
          },
          {
            status: "past_due",
            gracePeriodEndsAt: { $gt: nowISO },
            $or: [
              { nextRetryAt: { $lte: nowISO } },
              { nextRetryAt: { $exists: false } },
              { nextRetryAt: "" },
            ],
            $and: [
              {
                $or: [
                  { retryCount: { $exists: false } },
                  { retryCount: { $lt: 3 } },
                ],
              },
            ],
          },
        ],
      })
      .limit(100)
      .toArray();

    let renewalsProcessed = 0;
    let renewalsCharged = 0;
    let renewalFailures = 0;
    let renewalsSkipped = 0;

    if (!PAYSTACK_SECRET_KEY) {
      renewalsSkipped = dueRenewals.length;
    } else {
      const planConfig = await getPlanConfig();

      for (const sub of dueRenewals) {
        renewalsProcessed++;

        if (!ObjectId.isValid(sub.userId)) {
          renewalsSkipped++;
          continue;
        }

        const user = await db.collection("users").findOne({ _id: new ObjectId(sub.userId) });
        if (!user?.email) {
          renewalsSkipped++;
          continue;
        }

        const plan = asPlanTier(sub.plan);
        if (plan === "free") {
          renewalsSkipped++;
          continue;
        }

        if (sub.paystackSubscriptionCode) {
          renewalsSkipped++;
          continue;
        }

        const pricing = renewalPricing(sub);
        const currency = sub.subscriptionCurrency || sub.currency || "USD";
        const reference = `rn_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
        const authorizationCode = String(sub.paystackAuthorizationCode || "");
        const authorizationEmail = String(sub.paystackAuthorizationEmail || user.email || "");

        if (!pricing.amount || pricing.amount <= 0) {
          await markPastDue({
            db,
            sub,
            user,
            reason: "Invalid renewal amount",
            reference,
            amount: pricing.amount || 0,
            currency,
            nowISO,
          });
          renewalFailures++;
          continue;
        }

        if (!authorizationCode || !authorizationEmail) {
          await markPastDue({
            db,
            sub,
            user,
            reason: "No reusable payment authorization is saved for this subscription",
            reference,
            amount: pricing.amount,
            currency,
            nowISO,
          });
          renewalFailures++;
          continue;
        }

        try {
          const charge = await chargeSavedAuthorization({
            authorizationCode,
            email: authorizationEmail,
            amount: pricing.amount,
            currency,
            reference,
            metadata: {
              userId: sub.userId,
              plan,
              billingCycle: sub.billingCycle,
              subscriptionId: sub._id?.toString(),
              renewal: true,
              retryCount: sub.retryCount || 0,
              discountCode: pricing.discountCode || undefined,
              discountPercent: pricing.discountPercent || undefined,
              discountMonthsRemaining: pricing.discountMonthsRemaining,
            },
          });

          const currentPeriodEndMs = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).getTime() : 0;
          const nextPeriodBase = Number.isFinite(currentPeriodEndMs) && currentPeriodEndMs > now.getTime()
            ? new Date(currentPeriodEndMs)
            : now;
          const nextPeriodEnd = addBillingPeriod(nextPeriodBase, sub.billingCycle);
          const planCredits = planConfig.plans[plan]?.credits ?? 0;

          const billingTx = await insertBillingTransaction({
            userId: sub.userId,
            plan,
            planName: planName(plan),
            amount: pricing.amount,
            subtotal: pricing.subtotal,
            discount: pricing.discount,
            discountCode: pricing.discountCode,
            discountPercent: pricing.discountPercent,
            discountDurationMonths: sub.discountDurationMonths || null,
            currency,
            paymentProvider: "paystack",
            paystackReference: charge.data?.reference || reference,
            type: "subscription_renewal",
            status: "success",
            billingCycle: sub.billingCycle === "yearly" ? "yearly" : "monthly",
            receiptUrl: charge.data?.receipt_url || undefined,
            expiresAt: nextPeriodEnd,
            paidAt: charge.data?.paid_at || nowISO,
            createdAt: nowISO,
          } as any);

          await db.collection("users").updateOne(
            { _id: new ObjectId(sub.userId) },
            {
              $set: {
                plan,
                credits: planCredits,
                previousPaidPlan: plan,
                currentSubscriptionId: billingTx._id?.toString() || "",
                lastPaymentId: billingTx._id?.toString() || "",
                subscriptionExpiresAt: nextPeriodEnd,
              },
              $unset: { scheduledDowngradeAt: "" },
            },
          );

          await upsertSubscription(sub.userId, {
            plan,
            status: "active",
            billingCycle: sub.billingCycle === "yearly" ? "yearly" : "monthly",
            price: pricing.amount,
            currency,
            startDate: sub.startDate || nowISO,
            currentPeriodStart: nowISO,
            currentPeriodEnd: nextPeriodEnd,
            nextBillingDate: nextPeriodEnd,
            autoRenew: true,
            paystackSubscriptionCode: sub.paystackSubscriptionCode || undefined,
            paystackCustomerCode: charge.data?.customer?.customer_code || sub.paystackCustomerCode || undefined,
            ...buildAuthorizationUpdate(charge.data, authorizationEmail),
            paymentFailedAt: null as unknown as string,
            gracePeriodEndsAt: null as unknown as string,
            retryCount: 0,
            nextRetryAt: null as unknown as string,
            planVersion: planConfig.version,
            entitlements: planConfig.plans[plan]?.entitlements,
            subscriptionCountry: sub.subscriptionCountry,
            subscriptionCurrency: currency,
            subscriptionCurrencySymbol: sub.subscriptionCurrencySymbol,
            lockedPrice: pricing.subtotal || pricing.amount,
            pricingVersion: sub.pricingVersion,
            discountCode: sub.discountCode || null,
            discountPercent: sub.discountPercent || null,
            discountDurationMonths: sub.discountDurationMonths || null,
            discountMonthsRemaining: pricing.discountMonthsRemaining,
            undiscountedPrice: pricing.subtotal || null,
            initialDiscountAmount: sub.initialDiscountAmount || null,
          } as any);

          await insertCreditTransaction({
            userId: sub.userId,
            type: CreditTransactionType.ALLOCATION,
            source: "monthly_renewal",
            amount: planCredits,
            balanceAfter: planCredits,
            description: `${planName(plan)} ${sub.billingCycle} renewal — credit allocation`,
            metadata: {
              plan,
              billingCycle: sub.billingCycle,
              paystackReference: charge.data?.reference || reference,
              billingTransactionId: billingTx._id?.toString(),
              discountCode: pricing.discountCode || undefined,
              discountPercent: pricing.discountPercent || undefined,
              via: "subscription-lifecycle-cron",
            },
            createdAt: nowISO,
          });

          try {
            await resetMonthlyIncludedSeconds(sub.userId, plan);
          } catch (resetErr) {
            console.warn("[subscription-lifecycle] Failed to reset transcription balance:", resetErr);
          }

          await sendEmail(subscriptionRenewedEmail({
            userName: user.name || "there",
            userEmail: user.email,
            planName: planName(plan),
            expiresAt: nextPeriodEnd,
            amountPaid: `${currency} ${pricing.amount}`,
          })).catch(() => {});

          await sendEmail(paymentReceiptEmail({
            userName: user.name || "there",
            userEmail: user.email,
            planName: planName(plan),
            amount: `${currency} ${pricing.amount}`,
            billingCycle: sub.billingCycle,
            paidAt: charge.data?.paid_at || nowISO,
            receiptNumber: charge.data?.reference || reference,
          })).catch(() => {});

          notifySubscriptionRenewed(sub.userId, planName(plan)).catch(() => {});
          renewalsCharged++;
        } catch (error) {
          const reason = error instanceof Error ? error.message : "Payment could not be completed";
          await markPastDue({
            db,
            sub,
            user,
            reason,
            reference,
            amount: pricing.amount,
            currency,
            nowISO,
          });
          renewalFailures++;
        }
      }
    }

    results.renewals = {
      processed: renewalsProcessed,
      charged: renewalsCharged,
      failed: renewalFailures,
      skipped: renewalsSkipped,
    };

    // ── 2. Process scheduled plan changes ─────────────────────────────────────
    const pendingChanges = await db
      .collection("subscriptions")
      .find({
        pendingChangeType: { $in: ["downgrade", "cancel"] },
        pendingChangeEffectiveAt: { $lte: nowISO },
        status: "active",
      })
      .toArray();

    let changesProcessed = 0;
    for (const sub of pendingChanges) {
      const planConfig = await getPlanConfig();
      const freeCredits = planConfig.plans.free?.credits ?? 50;

      if (sub.pendingChangeType === "cancel") {
        // User requested cancellation → move to cancelled, fall back to Free
        await db.collection("users").updateOne(
          { _id: new (await import("mongodb")).ObjectId(sub.userId) },
          { $set: { plan: "free", credits: freeCredits }, $unset: { scheduledDowngradeAt: "" } },
        );
        await upsertSubscription(sub.userId, {
          pendingPlan: null as unknown as PlanTier,
          pendingChangeType: null as unknown as string,
          pendingChangeEffectiveAt: null as unknown as string,
          status: "cancelled",
          plan: "free" as PlanTier,
        });
      } else {
        // Scheduled downgrade → move to target plan
        const targetPlan = (sub.pendingPlan || "free") as PlanTier;
        const targetCredits = planConfig.plans[targetPlan]?.credits ?? freeCredits;

        await db.collection("users").updateOne(
          { _id: new (await import("mongodb")).ObjectId(sub.userId) },
          { $set: { plan: targetPlan, credits: targetCredits }, $unset: { scheduledDowngradeAt: "" } },
        );
        await upsertSubscription(sub.userId, {
          plan: targetPlan,
          pendingPlan: null as unknown as PlanTier,
          pendingChangeType: null as unknown as string,
          pendingChangeEffectiveAt: null as unknown as string,
          status: "active",
        });
        await insertCreditTransaction({
          userId: sub.userId,
          type: "allocation",
          source: "plan_downgrade",
          amount: targetCredits,
          balanceAfter: targetCredits,
          description: `Plan downgraded to ${targetPlan} — credit reset`,
          createdAt: nowISO,
        } as any);

        try {
          await resetMonthlyIncludedSeconds(sub.userId, targetPlan);
        } catch (resetErr) {
          console.warn("[subscription-lifecycle] Failed to reset transcription balance:", resetErr);
        }

        // Notify
        const user = await db.collection("users").findOne({ _id: new (await import("mongodb")).ObjectId(sub.userId) });
        if (user?.email) {
          sendEmail(subscriptionCancelledEmail({
            userName: user.name || "there",
            userEmail: user.email,
            planName: targetPlan,
            expiresAt: sub.currentPeriodEnd || nowISO,
          }))
            .catch(() => {});
        }
        notifySubscriptionCancelled(sub.userId, targetPlan).catch(() => {});
      }
      changesProcessed++;
    }
    results.scheduledChanges = { processed: changesProcessed };

    // ── 2. Expire grace periods ───────────────────────────────────────────────
    const expiredGraces = await db
      .collection("subscriptions")
      .find({
        status: "past_due",
        gracePeriodEndsAt: { $lte: nowISO },
      })
      .toArray();

    let gracesExpired = 0;
    for (const sub of expiredGraces) {
      const planConfig = await getPlanConfig();
      const freeCredits = planConfig.plans.free?.credits ?? 50;

      // Fall back to Free — never auto-downgrade to another paid plan
      await db.collection("users").updateOne(
        { _id: new (await import("mongodb")).ObjectId(sub.userId) },
        {
          $set: {
            plan: "free",
            credits: freeCredits,
            previousPaidPlan: sub.plan,
          },
          $unset: { scheduledDowngradeAt: "", currentSubscriptionId: "", subscriptionExpiresAt: "" },
        },
      );

      await upsertSubscription(sub.userId, {
        status: "cancelled",
        plan: "free" as PlanTier,
        gracePeriodEndsAt: null as unknown as string,
        paymentFailedAt: null as unknown as string,
        retryCount: 0,
      });

      const user = await db.collection("users").findOne({ _id: new (await import("mongodb")).ObjectId(sub.userId) });
      if (user?.email) {
        sendEmail(subscriptionCancelledEmail({
          userName: user.name || "there",
          userEmail: user.email,
          planName: "Free",
          expiresAt: nowISO,
        }))
          .catch(() => {});
      }
      notifySubscriptionCancelled(sub.userId, "Free").catch(() => {});
      gracesExpired++;
    }
    results.graceExpiries = { processed: gracesExpired };

    // ── 3. Reconcile paid plans and expire stale access ────────────────────────
    // The user document drives entitlements, so keep it aligned with the latest
    // paid subscription record before the dashboard or desktop reads it.
    const lifecyclePlanConfig = await getPlanConfig();
    const freeCredits = lifecyclePlanConfig.plans.free?.credits ?? 50;
    const lifecycleSubscriptions = await db
      .collection("subscriptions")
      .find({ plan: { $in: ["basic", "growth", "pro"] } })
      .limit(1000)
      .toArray();

    const lifecycleUserIds = new Set<string>();
    let plansReconciled = 0;
    let plansUpgraded = 0;
    let plansDowngraded = 0;
    let subscriptionsExpired = 0;
    let expiredEmailsSent = 0;
    let expiryEmailRetries = 0;

    const expirePaidAccess = async ({
      user,
      userId,
      paidPlan,
      expiresAt,
      subscription,
    }: {
      user: Record<string, any>;
      userId: string;
      paidPlan: "basic" | "growth";
      expiresAt: string;
      subscription?: Record<string, any> | null;
    }) => {
      const userObjectId = objectIdFor(userId);
      if (!userObjectId) return false;

      const previousPlan = normalizePaidPlan(user.plan) || paidPlan;
      const lifecycle = user.subscriptionLifecycle || {};
      const alreadySent = lifecycle.expiredEmailSentFor === expiresAt;
      const alreadyExpired = user.plan === "free" && lifecycle.expiredFor === expiresAt;

      await db.collection("users").updateOne(
        { _id: userObjectId },
        {
          $set: {
            plan: "free",
            credits: freeCredits,
            previousPaidPlan: previousPlan,
            "subscriptionLifecycle.expiredFor": expiresAt,
            "subscriptionLifecycle.expiredPlan": paidPlan,
          },
          $unset: {
            scheduledDowngradeAt: "",
            currentSubscriptionId: "",
            subscriptionExpiresAt: "",
          },
        },
      );

      if (subscription) {
        await upsertSubscription(userId, {
          plan: "free",
          status: "cancelled",
          autoRenew: false,
          cancelledAt: nowISO,
          lifecycleExpiredFor: expiresAt,
          ...(alreadySent ? { lifecycleExpiredEmailSentFor: expiresAt } : {}),
        } as any);
      }

      let emailSent = alreadySent;
      if (!alreadySent && user.email) {
        try {
          emailSent = await sendEmail(subscriptionExpiredEmail({
            userName: user.name || "there",
            userEmail: user.email,
            planName: planName(paidPlan),
            expiredAt: expiresAt,
          }));
        } catch (error) {
          console.error(`[Subscription Lifecycle] Expiry email failed for ${user.email}:`, error);
          emailSent = false;
        }
      }

      await db.collection("users").updateOne(
        { _id: userObjectId },
        emailSent
          ? {
            $set: { "subscriptionLifecycle.expiredEmailSentFor": expiresAt },
            $unset: { "subscriptionLifecycle.expiredEmailPendingFor": "" },
          }
          : { $set: { "subscriptionLifecycle.expiredEmailPendingFor": expiresAt } },
      );

      if (emailSent && !alreadySent) expiredEmailsSent++;
      if (!emailSent && user.email) expiryEmailRetries++;
      if (!alreadyExpired) {
        await insertCreditTransaction({
          userId,
          type: CreditTransactionType.ALLOCATION,
          source: "subscription_expired",
          amount: freeCredits,
          balanceAfter: freeCredits,
          description: `${planName(paidPlan)} Subscription Expired — Downgraded to Free`,
          metadata: { previousPlan, expiresAt },
          createdAt: nowISO,
        } as any);
        notifySubscriptionCancelled(userId, planName(paidPlan)).catch(() => {});
        subscriptionsExpired++;
      }
      return true;
    };

    for (const sub of lifecycleSubscriptions) {
      const userId = String(sub.userId || "");
      const userObjectId = objectIdFor(userId);
      const paidPlan = normalizePaidPlan(sub.plan);
      if (!userId || !userObjectId || !paidPlan) continue;
      lifecycleUserIds.add(userId);

      const user = await db.collection("users").findOne({ _id: userObjectId });
      if (!user || hasProtectedAccess(user, sub) || !isActiveSubscriptionStatus(sub.status)) continue;

      const lifetime = isLifetimeSubscription(sub);
      const effectiveExpiry = sub.status === "past_due" && sub.gracePeriodEndsAt
        ? sub.gracePeriodEndsAt
        : sub.currentPeriodEnd;
      const expiryKey = toSubscriptionExpiryKey(effectiveExpiry);
      const lifecycleWindow = lifetime ? null : getSubscriptionLifecycleWindow(effectiveExpiry, now.getTime());

      if (lifecycleWindow === "expired" && expiryKey) {
        if (sub.status !== "past_due") {
          // Grant 1-week (7-day) grace period. DO NOT IMMEDIATELY CANCEL.
          const gracePeriodEndsAt = new Date(now.getTime() + GRACE_PERIOD_DAYS * DAY_MS).toISOString();
          await db.collection("subscriptions").updateOne(
            { _id: sub._id },
            {
              $set: {
                status: "past_due",
                gracePeriodStartedAt: nowISO,
                gracePeriodEndsAt,
                "graceReminders.day1SentAt": nowISO,
                updatedAt: nowISO,
              },
            },
          );

          await db.collection("users").updateOne(
            { _id: userObjectId },
            {
              $set: {
                previousPaidPlan: paidPlan,
                subscriptionExpiresAt: gracePeriodEndsAt,
              },
            },
          );

          if (user.email) {
            sendEmail(
              subscriptionGracePeriodReminderEmail({
                userName: user.name || "there",
                userEmail: user.email,
                planName: planName(paidPlan),
                gracePeriodEndsAt,
                dayNumber: 1,
              })
            ).catch((err) => console.error("[Subscription Lifecycle] Grace Day 1 email failed:", err));
          }
          notifyGracePeriodActive(userId, planName(paidPlan), GRACE_PERIOD_DAYS).catch(() => {});
          continue;
        }

        // If status is past_due, only expire if grace period has actually ended
        const graceEndMs = sub.gracePeriodEndsAt ? new Date(sub.gracePeriodEndsAt).getTime() : 0;
        if (graceEndMs > now.getTime()) {
          // Still within 7-day grace period!
          continue;
        }

        await expirePaidAccess({
          user,
          userId,
          paidPlan,
          expiresAt: expiryKey,
          subscription: sub,
        });
        continue;
      }

      if (sub.status !== "active" && sub.status !== "cancelled" && sub.status !== "trialing" && sub.status !== "past_due") {
        continue;
      }

      const currentPlan = normalizePaidPlan(user.plan) || "free";
      const setFields: Record<string, unknown> = {};
      const unsetFields: Record<string, ""> = {};
      if (currentPlan !== paidPlan) {
        setFields.plan = paidPlan;
        setFields.credits = lifecyclePlanConfig.plans[paidPlan]?.credits ?? 0;
        plansReconciled++;
        if (planRank(paidPlan) > planRank(currentPlan)) plansUpgraded++;
        else plansDowngraded++;
      }

      if (sub._id) setFields.currentSubscriptionId = sub._id.toString();
      if (lifetime || !expiryKey) {
        unsetFields.subscriptionExpiresAt = "";
      } else {
        setFields.subscriptionExpiresAt = expiryKey;
      }
      if (user.subscriptionLifecycle?.expiredEmailPendingFor) {
        unsetFields["subscriptionLifecycle.expiredEmailPendingFor"] = "";
      }

      if (Object.keys(setFields).length || Object.keys(unsetFields).length) {
        await db.collection("users").updateOne(
          { _id: userObjectId },
          {
            ...(Object.keys(setFields).length ? { $set: setFields } : {}),
            ...(Object.keys(unsetFields).length ? { $unset: unsetFields } : {}),
          },
        );
      }
    }

    // Repair paid users whose subscription document is missing or no longer
    // contains the period end. This covers the stale dashboard state shown by
    // users who still have a paid plan and an expired user-level expiry date.
    const stalePaidUsers = await db
      .collection("users")
      .find({
        plan: { $in: ["basic", "growth", "pro"] },
        subscriptionExpiresAt: { $exists: true, $nin: [null, ""] },
      })
      .limit(1000)
      .toArray();

    for (const user of stalePaidUsers) {
      const userId = user._id.toString();
      if (lifecycleUserIds.has(userId) || hasProtectedAccess(user)) continue;
      const expiryKey = toSubscriptionExpiryKey(user.subscriptionExpiresAt);
      if (!expiryKey || getSubscriptionLifecycleWindow(expiryKey, now.getTime()) !== "expired") continue;
      const paidPlan = normalizePaidPlan(user.plan);
      if (!paidPlan) continue;
      await expirePaidAccess({ user, userId, paidPlan, expiresAt: expiryKey });
    }

    // Retry only failed expiry emails; the marker is tied to the exact period
    // end so a later renewal starts a fresh lifecycle.
    const pendingExpiryEmails = await db
      .collection("users")
      .find({
        plan: "free",
        "subscriptionLifecycle.expiredEmailPendingFor": { $exists: true, $nin: [null, ""] },
      })
      .limit(1000)
      .toArray();
    for (const user of pendingExpiryEmails) {
      if (!user.email || hasProtectedAccess(user)) continue;
      const expiryKey = toSubscriptionExpiryKey(user.subscriptionLifecycle?.expiredEmailPendingFor);
      const paidPlan = normalizePaidPlan(user.subscriptionLifecycle?.expiredPlan) || "basic";
      if (!expiryKey) continue;
      try {
        const sent = await sendEmail(subscriptionExpiredEmail({
          userName: user.name || "there",
          userEmail: user.email,
          planName: planName(paidPlan),
          expiredAt: expiryKey,
        }));
        if (sent) {
          await db.collection("users").updateOne(
            { _id: user._id },
            {
              $set: { "subscriptionLifecycle.expiredEmailSentFor": expiryKey },
              $unset: { "subscriptionLifecycle.expiredEmailPendingFor": "" },
            },
          );
          expiredEmailsSent++;
        }
      } catch (error) {
        console.error(`[Subscription Lifecycle] Expiry email retry failed for ${user.email}:`, error);
      }
    }

    results.planReconciliation = {
      processed: lifecycleSubscriptions.length,
      reconciled: plansReconciled,
      upgraded: plansUpgraded,
      downgraded: plansDowngraded,
      expired: subscriptionsExpired,
      expiryEmailsSent: expiredEmailsSent,
      expiryEmailRetries,
    };

    // ── 4. Send 7-day, 2-day and 1-day expiry reminders ──────────────────────────────
    const reminderCandidates = await db
      .collection("subscriptions")
      .find({
        plan: { $in: ["basic", "growth", "pro"] },
        status: { $in: ["active", "cancelled", "trialing"] },
        currentPeriodEnd: { $exists: true, $nin: [null, ""] },
      })
      .limit(1000)
      .toArray();

    let remindersSent = 0;
    for (const sub of reminderCandidates) {
      if (isLifetimeSubscription(sub)) continue;
      const userId = String(sub.userId || "");
      const userObjectId = objectIdFor(userId);
      const paidPlan = normalizePaidPlan(sub.plan);
      const expiryKey = toSubscriptionExpiryKey(sub.currentPeriodEnd);
      if (!userObjectId || !paidPlan || !expiryKey) continue;
      const user = await db.collection("users").findOne({ _id: userObjectId });
      if (!user || !user.email || hasProtectedAccess(user, sub)) continue;

      const lifecycleWindow = getSubscriptionLifecycleWindow(sub.currentPeriodEnd, now.getTime());
      if (lifecycleWindow !== "seven-day" && lifecycleWindow !== "two-day" && lifecycleWindow !== "one-day") continue;

      const markerField = lifecycleWindow === "one-day"
        ? "lifecycleReminder1For"
        : lifecycleWindow === "two-day"
          ? "lifecycleReminder2For"
          : "lifecycleReminder7For";
      if (sub[markerField] === expiryKey) continue;

      const daysLeft = subscriptionDaysLeft(sub.currentPeriodEnd, now.getTime());
      if (!daysLeft || daysLeft <= 0) continue;
      const sent = await sendEmail(subscriptionExpiringSoonEmail({
        userName: user.name || "there",
        userEmail: user.email,
        planName: planName(paidPlan),
        expiresAt: expiryKey,
        daysLeft: Math.max(1, daysLeft),
      })).catch((error) => {
        console.error(`[Subscription Lifecycle] Reminder email failed for ${user.email}:`, error);
        return false;
      });
      if (!sent) continue;

      await db.collection("subscriptions").updateOne(
        { _id: sub._id },
        { $set: { [markerField]: expiryKey } },
      );
      remindersSent++;
    }
    results.expiryReminders = { processed: remindersSent };

    // ── 5. Send Grace Period Reminders (Day 1, Day 2, Day 5) ─────────────────
    const graceCandidates = await db
      .collection("subscriptions")
      .find({
        plan: { $in: ["basic", "growth", "pro"] },
        status: "past_due",
        gracePeriodEndsAt: { $gt: nowISO },
      })
      .limit(1000)
      .toArray();

    let graceRemindersSent = 0;
    for (const sub of graceCandidates) {
      if (isLifetimeSubscription(sub)) continue;
      const userId = String(sub.userId || "");
      const userObjectId = objectIdFor(userId);
      const paidPlan = normalizePaidPlan(sub.plan);
      if (!userObjectId || !paidPlan || !sub.gracePeriodEndsAt) continue;

      const user = await db.collection("users").findOne({ _id: userObjectId });
      if (!user || !user.email || hasProtectedAccess(user, sub)) continue;

      const graceEndMs = new Date(sub.gracePeriodEndsAt).getTime();
      const daysRemaining = Math.max(1, Math.ceil((graceEndMs - now.getTime()) / DAY_MS));
      const reminders = sub.graceReminders || {};

      // Day 1: 6-7 days remaining
      if (!reminders.day1SentAt && daysRemaining >= 6) {
        const sent = await sendEmail(
          subscriptionGracePeriodReminderEmail({
            userName: user.name || "there",
            userEmail: user.email,
            planName: planName(paidPlan),
            gracePeriodEndsAt: sub.gracePeriodEndsAt,
            dayNumber: 1,
          })
        ).catch(() => false);

        if (sent) {
          await db.collection("subscriptions").updateOne(
            { _id: sub._id },
            { $set: { "graceReminders.day1SentAt": nowISO } }
          );
          notifyGracePeriodActive(userId, planName(paidPlan), daysRemaining).catch(() => {});
          graceRemindersSent++;
        }
      }
      // Day 2: 4-5 days remaining
      else if (!reminders.day2SentAt && daysRemaining <= 5 && daysRemaining > 2) {
        const sent = await sendEmail(
          subscriptionGracePeriodReminderEmail({
            userName: user.name || "there",
            userEmail: user.email,
            planName: planName(paidPlan),
            gracePeriodEndsAt: sub.gracePeriodEndsAt,
            dayNumber: 2,
          })
        ).catch(() => false);

        if (sent) {
          await db.collection("subscriptions").updateOne(
            { _id: sub._id },
            { $set: { "graceReminders.day2SentAt": nowISO } }
          );
          notifyGracePeriodActive(userId, planName(paidPlan), daysRemaining).catch(() => {});
          graceRemindersSent++;
        }
      }
      // Day 5: 1-2 days remaining
      else if (!reminders.day5SentAt && daysRemaining <= 2) {
        const sent = await sendEmail(
          subscriptionGracePeriodReminderEmail({
            userName: user.name || "there",
            userEmail: user.email,
            planName: planName(paidPlan),
            gracePeriodEndsAt: sub.gracePeriodEndsAt,
            dayNumber: 5,
          })
        ).catch(() => false);

        if (sent) {
          await db.collection("subscriptions").updateOne(
            { _id: sub._id },
            { $set: { "graceReminders.day5SentAt": nowISO } }
          );
          notifyGracePeriodActive(userId, planName(paidPlan), daysRemaining).catch(() => {});
          graceRemindersSent++;
        }
      }
    }
    results.graceReminders = { processed: graceRemindersSent };

    return NextResponse.json({ ok: true, results });
  } catch (error) {
    console.error("[Subscription Lifecycle] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
