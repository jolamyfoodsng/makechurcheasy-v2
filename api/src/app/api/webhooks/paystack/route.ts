/**
 * POST /api/webhooks/paystack
 *
 * Handles Paystack payment webhooks.
 * Verifies the webhook signature and updates the user's plan + credits.
 *
 * Events handled:
 * - charge.success: Payment successful → provision account + send email
 * - subscription.create: New subscription created
 * - subscription.disable: Cancel a specific subscription (not ALL)
 * - charge.failed: One-off charge declined → team Telegram alert
 * - invoice.payment_failed: Payment failed → notify user
 *
 * The desktop app picks up changes on its next 5-min sync cycle.
 */

import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import {
  upsertSubscription,
  getPlanConfig,
  insertBillingTransaction,
  insertCreditTransaction,
} from "@/lib/db";
import {
  sendEmail,
  subscriptionActivatedEmail,
  subscriptionCancelledEmail,
  paymentFailedEmail,
  subscriptionRenewedEmail,
  paymentReceiptEmail,
} from "@/lib/emailTemplates";
import {
  notifySubscriptionActivated,
  notifySubscriptionRenewed,
  notifySubscriptionCancelled,
  notifyPaymentFailed,
} from "@/lib/notifications";
import { getPlatformSettings } from "@/lib/platformSettings";
import { discountFromPaymentMetadata, recordDiscountRedemption } from "@/lib/discounts";
import { markReferralPaidForUser } from "@/lib/referrals";
import { stopActiveTrialForPaidPlan } from "@/lib/trialRecords";
import {
  addPurchasedTranscriptionSeconds,
  resetMonthlyIncludedSeconds,
} from "@/lib/transcriptionCredits";
import { reportPaymentToTelegram } from "@/lib/paymentTelegramNotifications";
import { CreditTransactionType, type PlanTier, type TransactionSource } from "@/types/schemas";
import { ObjectId } from "mongodb";
import crypto from "node:crypto";

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "";

const VALID_PLANS: PlanTier[] = ["free", "basic", "growth"];

const PLAN_NAMES: Record<string, string> = {
  free: "Free",
  basic: "Basic",
  growth: "Growth",
};

function verifyPaystackSignature(req: NextRequest, body: string): boolean {
  if (!PAYSTACK_SECRET_KEY) {
    console.error("[Paystack Webhook] FATAL: PAYSTACK_SECRET_KEY not configured — rejecting webhook");
    return false;
  }

  const signature = req.headers.get("x-paystack-signature");
  if (!signature) return false;

  const hmac = crypto.createHmac("sha512", PAYSTACK_SECRET_KEY);
  hmac.update(body);
  const digest = hmac.digest("hex");

  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

/** Resolve plan from Paystack event data */
function resolvePlan(data: Record<string, unknown>): PlanTier {
  const metadata = (data.metadata || {}) as Record<string, unknown>;

  // Try metadata.plan first (what we set in the inline popup)
  if (metadata.plan && typeof metadata.plan === "string") {
    const p = metadata.plan.toLowerCase();
    if (p === "pro") return "growth";
    if (VALID_PLANS.includes(p as PlanTier)) return p as PlanTier;
  }

  // Try data.plan (Paystack subscription plan name/code)
  const dataPlan = data.plan as string | undefined;
  if (dataPlan) {
    const lower = dataPlan.toLowerCase();
    if (lower.includes("pro")) return "growth";
    for (const tier of VALID_PLANS) {
      if (lower.includes(tier)) return tier;
    }
  }

  return "free";
}

function buildAuthorizationUpdate(data: Record<string, any>, fallbackEmail?: string): Record<string, unknown> {
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
    const rawBody = await req.text();

    if (!verifyPaystackSignature(req, rawBody)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const event = JSON.parse(rawBody);
    const eventType = event.event as string;
    const data = event.data;

    if (!data) {
      return NextResponse.json({ received: true });
    }

    const client = await clientPromise;
    const db = client.db();

    switch (eventType) {
      // ── charge.success ───────────────────────────────────────────────────
      case "charge.success": {
        const metadata = (data.metadata || {}) as Record<string, unknown>;
        const email = (data.customer?.email || data.email) as string | undefined;
        const userId = (metadata.user_id || metadata.userId) as string | undefined;
        const subCode =
          (data.subscription?.subscription_code ||
            data.subscription_code ||
            (typeof data.subscription === "string" ? data.subscription : undefined)) as string | undefined;

        let targetUserId: string | null = userId || null;

        // Resolve user
        if (!targetUserId && email) {
          const user = await db.collection("users").findOne(
            { email },
            { collation: { locale: "en", strength: 2 } }
          );
          if (user) targetUserId = user._id.toString();
        }

        if (!targetUserId) {
          console.warn("[Paystack Webhook] No user found for charge.success");
          break;
        }

        // Handle transcription credit top-ups
        if (metadata.type === "transcription_topup") {
          const seconds = Number(metadata.seconds) || (Number(metadata.hours) * 3600) || (Number(metadata.credits) * 60) || 0;
          const amountPaid = (Number(data.amount) || 0) / 100;
          const currency = data.currency || "NGN";
          const reference = data.reference || `wh_${Date.now()}`;
          // Paystack retries webhooks, and the verify route may already have credited this reference.
          const alreadyCredited = data.reference
            ? await db.collection("transcription_transactions").findOne({
              requestId: reference,
              type: "credit_purchase",
            })
            : null;
          if (alreadyCredited) {
            console.log(`[Paystack Webhook] Duplicate top-up, skipping: ${reference}`);
            break;
          }
          if (seconds > 0) {
            await addPurchasedTranscriptionSeconds({
              userId: targetUserId,
              seconds,
              amountPaid,
              currency,
              reference,
              packId: metadata.packId as string,
              description: `Paystack top-up: ${seconds / 3600}h (${seconds / 60} credits)`,
            });
            console.log(`[Paystack Webhook] Credited ${seconds}s top-up to user ${targetUserId}`);
            reportPaymentToTelegram({
              outcome: "success",
              provider: "paystack",
              reference,
              userId: targetUserId,
              email,
              purchase: "credits",
              credits: Math.round(seconds / 60),
              amount: amountPaid,
              currency,
              source: "Paystack webhook",
            });
          }
          break;
        }

        const plan = resolvePlan(data);
        if (plan === "free") {
          console.warn("[Paystack Webhook] Could not determine plan from charge");
          break;
        }

        const rawBillingCycle = String(metadata.billingCycle || metadata.billing_cycle || "monthly");
        const billingCycle: "monthly" | "yearly" | "lifetime" =
          rawBillingCycle === "yearly" || rawBillingCycle === "lifetime" ? rawBillingCycle : "monthly";
        const purchaseKind: "subscription" | "one_time" =
          metadata.purchaseKind === "one_time" || metadata.oneTimeOffer === true || billingCycle === "lifetime"
            ? "one_time"
            : "subscription";
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
        const appliedDiscount = discountFromPaymentMetadata(metadata);
        const planConfig = await getPlanConfig();
        const planCredits = planConfig.plans[plan]?.credits ?? 0;

        const now = new Date();
        const periodMs = billingCycle === "yearly" ? 365 : 30;
        const expiresAt = billingCycle === "lifetime"
          ? "9999-12-31T23:59:59.999Z"
          : new Date(now.getTime() + periodMs * 24 * 60 * 60 * 1000).toISOString();
        const periodStart = now.toISOString();

        // Check for duplicate (idempotency)
        const reference = data.reference || data.id?.toString();
        const billingReference = reference || `wh_${Date.now()}`;
        if (reference) {
          const existing = await db
            .collection("billing_transactions")
            .findOne({ paystackReference: reference });
          if (existing) {
            await markReferralPaidForUser(targetUserId, {
              plan: existing.plan || plan,
              amount: existing.amount ?? null,
              currency: existing.currency || data.currency || "NGN",
              paystackReference: reference,
              billingTransactionId: existing._id?.toString() || null,
              paidAt: existing.paidAt || existing.createdAt || new Date().toISOString(),
            });
            console.log(`[Paystack Webhook] Duplicate charge, skipping: ${reference}`);
            break;
          }
        }

        // Create billing transaction
        const billingTx = await insertBillingTransaction({
          userId: targetUserId,
          plan,
          planName: PLAN_NAMES[plan] || plan,
          amount: data.amount / 100,
          subtotal: appliedDiscount?.originalAmount || offerOriginalPrice || data.amount / 100,
          discount: appliedDiscount?.discountAmount || offerDiscountAmount || 0,
          discountCode: appliedDiscount?.code || null,
          discountPercent: appliedDiscount?.percentOff || offerDiscountPercent || null,
          discountDurationMonths: appliedDiscount?.durationMonths || offerDiscountDurationMonths || null,
          currency: data.currency || "NGN",
          paymentProvider: "paystack",
          paystackReference: billingReference,
          type: "subscription_purchase",
          status: "success",
          billingCycle,
          purchaseKind,
          oneTimeOfferId,
          oneTimeOfferName,
          offerOriginalPrice,
          offerAppliedPrice,
          receiptUrl: data.receipt_url || undefined,
          expiresAt,
          paidAt: now.toISOString(),
          createdAt: now.toISOString(),
        });

        await markReferralPaidForUser(targetUserId, {
          plan,
          amount: data.amount / 100,
          currency: data.currency || "NGN",
          paystackReference: billingReference,
          billingTransactionId: billingTx._id?.toString() || null,
          paidAt: now.toISOString(),
        });

        // Read user's current plan BEFORE updating (for upgrade detection)
        let prevPlan: string = "free";
        try {
          const userBefore = await db
            .collection("users")
            .findOne({ _id: new ObjectId(targetUserId) }, { projection: { plan: 1 } });
          if (userBefore?.plan) prevPlan = userBefore.plan;
        } catch { /* use default */ }

        const hadActiveSubscription = await db.collection("subscriptions").findOne({
          userId: targetUserId,
          status: "active",
        });

        // Update user
        const userUpdate: Record<string, unknown> = {
          plan,
          credits: planCredits,
          currentSubscriptionId: billingTx._id?.toString() || "",
          lastPaymentId: billingTx._id?.toString() || "",
          subscriptionExpiresAt: expiresAt,
        };

        try {
          await db
            .collection("users")
            .updateOne({ _id: new ObjectId(targetUserId) }, { $set: userUpdate });
        } catch {
          if (email) {
            await db.collection("users").updateOne({ email }, { $set: userUpdate });
          }
        }

        await stopActiveTrialForPaidPlan(targetUserId, "system:paystack-webhook");

        // Upsert subscription — clear grace period on successful recovery
        await upsertSubscription(targetUserId, {
          plan,
          status: "active",
          billingCycle: billingCycle as "monthly" | "yearly",
          price: data.amount / 100,
          currency: data.currency || "NGN",
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
          paystackSubscriptionCode: purchaseKind === "one_time" || billingCycle === "lifetime" ? undefined : subCode || undefined,
          paystackCustomerCode: data.customer?.customer_code || undefined,
          ...buildAuthorizationUpdate(data, email),
          paymentFailedAt: null as unknown as string,
          gracePeriodEndsAt: null as unknown as string,
          retryCount: 0,
          planVersion: planConfig.version,
          entitlements: planConfig.plans[plan]?.entitlements,
          discountCode: appliedDiscount?.code || null,
          discountPercent: appliedDiscount?.percentOff || offerDiscountPercent || null,
          discountDurationMonths: appliedDiscount?.durationMonths || offerDiscountDurationMonths || null,
          discountMonthsRemaining: appliedDiscount?.monthsRemainingAfterCheckout ?? offerDiscountMonthsRemaining ?? null,
          undiscountedPrice: appliedDiscount?.originalAmount || offerOriginalPrice,
          initialDiscountAmount: appliedDiscount?.discountAmount || offerDiscountAmount,
        });
        await recordDiscountRedemption({
          discount: appliedDiscount,
          userId: targetUserId,
          paystackReference: billingReference,
          plan,
          billingCycle,
        });

        // Record credit allocation transaction
        const isSamePlan = prevPlan === plan;

        let whTxSource: TransactionSource;
        let whTxDescription: string;
        if (isSamePlan) {
          whTxSource = "monthly_renewal";
          whTxDescription = `${PLAN_NAMES[plan] || plan} ${billingCycle} Renewal`;
        } else if (prevPlan === "free") {
          whTxSource = "subscription_activation";
          whTxDescription = `${PLAN_NAMES[plan] || plan} Plan Activated — ${billingCycle} Credit Allocation`;
        } else {
          const prevIdx = VALID_PLANS.indexOf(prevPlan as PlanTier);
          const newIdx = VALID_PLANS.indexOf(plan);
          if (newIdx > prevIdx) {
            whTxSource = "plan_upgrade";
            whTxDescription = `Plan Upgrade: ${PLAN_NAMES[prevPlan] || prevPlan} → ${PLAN_NAMES[plan] || plan}`;
          } else {
            whTxSource = "plan_downgrade";
            whTxDescription = `Plan Downgrade: ${PLAN_NAMES[prevPlan] || prevPlan} → ${PLAN_NAMES[plan] || plan}`;
          }
        }

        await insertCreditTransaction({
          userId: targetUserId,
          type: CreditTransactionType.ALLOCATION,
          source: whTxSource,
          amount: planCredits,
          balanceAfter: planCredits,
          description: whTxDescription,
          metadata: {
            plan,
            previousPlan: prevPlan,
            billingCycle,
            purchaseKind,
            oneTimeOfferId: oneTimeOfferId || undefined,
            oneTimeOfferName: oneTimeOfferName || undefined,
            paystackReference: billingReference,
            billingTransactionId: billingTx._id?.toString(),
            via: "webhook",
            discountCode: appliedDiscount?.code,
            discountPercent: appliedDiscount?.percentOff,
          },
          createdAt: now.toISOString(),
        });

        // Reset monthly included transcription seconds (preserves purchasedSeconds)
        try {
          await resetMonthlyIncludedSeconds(targetUserId, plan);
        } catch (resetErr) {
          console.warn("[Paystack Webhook] Failed to reset transcription balance:", resetErr);
        }

        // Resolve user name for emails
        let userName = "there";
        try {
          const u = await db.collection("users").findOne({ _id: new ObjectId(targetUserId) });
          if (u?.name) userName = u.name;
        } catch { /* default */ }

        // Send email — activation for new subscribers, renewal for existing
        if (email) {
          // Check if user already had an active subscription (renewal vs first purchase)
          const isRenewal = hadActiveSubscription && hadActiveSubscription.plan === plan;

          const emailPayload = {
            userName,
            userEmail: email,
            planName: PLAN_NAMES[plan] || plan,
            billingCycle,
            credits: planCredits,
            expiresAt,
            amountPaid: `${data.currency || "NGN"} ${data.amount / 100}`,
          };

          sendEmail(
            isRenewal
              ? subscriptionRenewedEmail(emailPayload)
              : subscriptionActivatedEmail(emailPayload)
          ).catch((err) =>
            console.error(`[Paystack Webhook] ${isRenewal ? "Renewal" : "Welcome"} email failed:`, err)
          );
        }

        // Create in-app notification
        if (hadActiveSubscription && hadActiveSubscription.plan === plan) {
          notifySubscriptionRenewed(targetUserId, PLAN_NAMES[plan] || plan).catch(() => { });
        } else {
          notifySubscriptionActivated(targetUserId, PLAN_NAMES[plan] || plan).catch(() => { });
        }

        // Send receipt email (fire and forget)
        if (email) {
          sendEmail(
            paymentReceiptEmail({
              userName,
              userEmail: email,
              planName: PLAN_NAMES[plan] || plan,
              amount: `${data.currency || "NGN"} ${data.amount / 100}`,
              billingCycle,
              paidAt: now.toISOString(),
              receiptNumber: reference || `rcpt_${Date.now()}`,
            })
          ).catch(() => { });
        }

        reportPaymentToTelegram({
          outcome: "success",
          provider: "paystack",
          reference: billingReference,
          userId: targetUserId,
          email,
          plan,
          billingCycle,
          credits: planCredits,
          amount: data.amount / 100,
          currency: data.currency || "NGN",
          source: "Paystack webhook",
          occurredAt: now,
        });
        console.log(`[Paystack Webhook] Charge success: user ${targetUserId} → plan ${plan}`);
        break;
      }

      // ── subscription.create ──────────────────────────────────────────────
      case "subscription.create": {
        const sub = data.subscription;
        const customer = data.customer;
        const email = customer?.email;

        if (!email) break;

        const user = await db.collection("users").findOne(
          { email },
          { collation: { locale: "en", strength: 2 } }
        );
        if (!user) {
          console.warn(`[Paystack Webhook] No user for subscription.create: ${email}`);
          break;
        }

        const billingCycle = sub?.interval === "yearly" ? "yearly" : "monthly";

        // Determine plan from subscription plan name
        let plan: PlanTier = "free";
        if (sub?.plan?.name) {
          const name = sub.plan.name.toLowerCase();
          for (const tier of VALID_PLANS) {
            if (name.includes(tier)) { plan = tier; break; }
          }
        }

        if (plan === "free") break;

        const planConfig = await getPlanConfig();
        const planCredits = planConfig.plans[plan]?.credits ?? 0;
        const periodMs = billingCycle === "yearly" ? 365 : 30;
        const now = new Date();
        const expiresAt = new Date(now.getTime() + periodMs * 24 * 60 * 60 * 1000).toISOString();

        await upsertSubscription(user._id.toString(), {
          plan,
          status: "active",
          billingCycle,
          price: (sub.amount || 0) / 100,
          currency: sub.currency || "NGN",
          startDate: new Date((sub.createdAt || Date.now() / 1000) * 1000).toISOString(),
          currentPeriodStart: now.toISOString(),
          currentPeriodEnd: expiresAt,
          nextBillingDate: expiresAt,
          autoRenew: true,
          paystackSubscriptionCode: sub.subscription_code || undefined,
          paystackCustomerCode: customer.customer_code || undefined,
          planVersion: planConfig.version,
          entitlements: planConfig.plans[plan]?.entitlements,
        });

        await markReferralPaidForUser(user._id.toString(), {
          plan,
          amount: (sub.amount || 0) / 100,
          currency: sub.currency || "NGN",
          paystackReference: sub.subscription_code || null,
          billingTransactionId: null,
          paidAt: now.toISOString(),
        });

        // Read prev plan before updating user
        const subPrevPlan = (user.plan as string) || "free";

        // Update user
        await db.collection("users").updateOne(
          { _id: user._id },
          { $set: { plan, credits: planCredits, subscriptionExpiresAt: expiresAt } }
        );
        await stopActiveTrialForPaidPlan(user._id.toString(), "system:paystack-subscription-create");

        // Record credit allocation transaction
        const subIsSamePlan = subPrevPlan === plan;
        let subTxSource: TransactionSource;
        let subTxDescription: string;
        if (subIsSamePlan) {
          subTxSource = "monthly_renewal";
          subTxDescription = `${PLAN_NAMES[plan] || plan} ${billingCycle} Renewal`;
        } else if (subPrevPlan === "free") {
          subTxSource = "subscription_activation";
          subTxDescription = `${PLAN_NAMES[plan] || plan} Plan Activated — ${billingCycle} Credit Allocation`;
        } else {
          subTxSource = "subscription_activation";
          subTxDescription = `${PLAN_NAMES[plan] || plan} Plan Activated — ${billingCycle} Credit Allocation`;
        }

        await insertCreditTransaction({
          userId: user._id.toString(),
          type: CreditTransactionType.ALLOCATION,
          source: subTxSource,
          amount: planCredits,
          balanceAfter: planCredits,
          description: subTxDescription,
          metadata: {
            plan,
            previousPlan: subPrevPlan,
            billingCycle,
            paystackSubscriptionCode: sub.subscription_code,
            via: "webhook",
          },
          createdAt: now.toISOString(),
        });

        // Reset monthly included transcription seconds (preserves purchasedSeconds)
        try {
          await resetMonthlyIncludedSeconds(user._id.toString(), plan);
        } catch (resetErr) {
          console.warn("[Paystack Webhook] Failed to reset transcription balance:", resetErr);
        }

        console.log(`[Paystack Webhook] Subscription created: ${user._id} → ${plan}`);
        break;
      }

      // ── subscription.disable ─────────────────────────────────────────────
      // BUG FIX: Only cancel the specific subscription by subscription_code,
      // not ALL subscriptions globally.
      case "subscription.disable": {
        const sub = data.subscription;
        const subCode = sub?.subscription_code;

        if (!subCode) {
          console.warn("[Paystack Webhook] subscription.disable: no subscription_code");
          break;
        }

        const now = new Date().toISOString();

        // Cancel only the subscription matching this subscription_code
        const result = await db.collection("subscriptions").updateOne(
          { paystackSubscriptionCode: subCode },
          {
            $set: {
              status: "cancelled",
              cancelledAt: now,
              autoRenew: false,
              updatedAt: now,
            },
          }
        );

        if (result.matchedCount === 0) {
          // Fallback: try matching by paystackCustomerCode if subscription_code wasn't stored
          const customerCode = data.customer?.customer_code;
          if (customerCode) {
            await db.collection("subscriptions").updateOne(
              { paystackCustomerCode: customerCode, status: "active" },
              {
                $set: {
                  status: "cancelled",
                  cancelledAt: now,
                  autoRenew: false,
                  updatedAt: now,
                },
              }
            );
          }
        }

        // Find the user who owns this subscription to send email and downgrade plan
        const cancelledSub = await db.collection("subscriptions").findOne({
          $or: [
            { paystackSubscriptionCode: subCode },
            { paystackCustomerCode: data.customer?.customer_code },
          ],
        });

        if (cancelledSub) {
          const ownerId = cancelledSub.userId;

          // Do NOT downgrade immediately — preserve access until currentPeriodEnd.
          // The daily cron job (trial-check) will process the actual downgrade
          // after the subscription period expires.
          await db.collection("users").updateOne(
            { _id: new ObjectId(ownerId) },
            {
              $set: {
                currentSubscriptionId: "",
                scheduledDowngradeAt: cancelledSub.currentPeriodEnd || now,
              },
            }
          );

          // Send cancellation email
          let userName = "there";
          let userEmail = "";
          try {
            const u = await db.collection("users").findOne({ _id: new ObjectId(ownerId) });
            if (u?.name) userName = u.name;
            if (u?.email) userEmail = u.email;
          } catch { /* default */ }

          if (userEmail) {
            sendEmail(
              subscriptionCancelledEmail({
                userName,
                userEmail,
                planName: PLAN_NAMES[cancelledSub.plan] || cancelledSub.plan,
                expiresAt: cancelledSub.currentPeriodEnd || now,
              })
            ).catch((err) =>
              console.error("[Paystack Webhook] Cancel email failed:", err)
            );
          }

          // Create in-app notification
          notifySubscriptionCancelled(ownerId, PLAN_NAMES[cancelledSub.plan] || cancelledSub.plan).catch(() => { });
        }

        console.log(`[Paystack Webhook] Subscription disabled: ${subCode}`);
        break;
      }

      // ── charge.failed ────────────────────────────────────────────────────
      // A one-off charge was declined. Nothing is provisioned, so this only
      // alerts the team; the user retries from checkout.
      case "charge.failed": {
        const metadata = (data.metadata || {}) as Record<string, any>;
        const isTopup = metadata.type === "transcription_topup";
        const seconds = Number(metadata.seconds) || (Number(metadata.hours) * 3600) || (Number(metadata.credits) * 60) || 0;
        reportPaymentToTelegram({
          outcome: "failed",
          provider: "paystack",
          reference: String(data.reference || data.id || ""),
          userId: metadata.user_id || metadata.userId || null,
          email: data.customer?.email || data.email,
          ...(isTopup
            ? { purchase: "credits" as const, credits: seconds ? Math.round(seconds / 60) : null }
            : {
              plan: metadata.plan ? String(metadata.plan) : null,
              billingCycle: metadata.billingCycle || metadata.billing_cycle || null,
            }),
          amount: typeof data.amount === "number" ? data.amount / 100 : null,
          currency: data.currency || "NGN",
          failureReason: data.gateway_response || data.message || "Charge failed",
          source: "Paystack webhook",
        });
        break;
      }

      // ── invoice.payment_failed ───────────────────────────────────────────
      case "invoice.payment_failed": {
        const email = data.customer?.email;
        const sub = data.subscription;

        if (email) {
          let userName = "there";
          let planName = "Unknown";
          let planKey = "free";
          let graceEnds: string | null = null;
          if (sub?.plan?.name) {
            const name = sub.plan.name.toLowerCase();
            for (const tier of VALID_PLANS) {
              if (name.includes(tier)) { planName = PLAN_NAMES[tier] || tier; planKey = tier; break; }
            }
          }

          let targetUserId: string | null = null;
          try {
            const user = await db.collection("users").findOne(
              { email },
              { collation: { locale: "en", strength: 2 } }
            );
            if (user) {
              if (user.name) userName = user.name;
              targetUserId = user._id.toString();
            }
          } catch { /* default */ }

          // Store failed payment as a billing transaction + set grace period
          if (targetUserId) {
            try {
              const existing = await db
                .collection("billing_transactions")
                .findOne({
                  userId: targetUserId,
                  type: "subscription_purchase",
                  status: "failed",
                  createdAt: { $gte: new Date(Date.now() - 60000).toISOString() },
                });
              if (!existing) {
                await insertBillingTransaction({
                  userId: targetUserId,
                  plan: planKey,
                  planName,
                  amount: (data.amount || 0) / 100,
                  currency: data.currency || "NGN",
                  paymentProvider: "paystack",
                  paystackReference: data.reference || `wh_${Date.now()}`,
                  type: "subscription_purchase",
                  status: "failed",
                  billingCycle: "monthly",
                  failureCode: data.gateway_response || null,
                  failureReason: data.gateway_response || "Payment could not be completed",
                  expiresAt: new Date().toISOString(),
                  paidAt: new Date().toISOString(),
                  createdAt: new Date().toISOString(),
                } as any);
              }
            } catch (e) {
              console.error("[Paystack Webhook] Failed to store failed billing txn:", e);
            }

            // Set grace period on subscription
            try {
              const GRACE_DAYS = 7;
              graceEnds = new Date(
                Date.now() + GRACE_DAYS * 24 * 60 * 60 * 1000,
              ).toISOString();
              await db.collection("subscriptions").updateOne(
                { userId: targetUserId, status: { $in: ["active", "past_due"] } },
                {
                  $set: {
                    status: "past_due",
                    paymentFailedAt: new Date().toISOString(),
                    gracePeriodEndsAt: graceEnds,
                    retryCount: 0,
                  },
                },
              );
            } catch (e) {
              console.error("[Paystack Webhook] Failed to set grace period:", e);
            }
          }

          const platformSettings = await getPlatformSettings();
          if (platformSettings.notifications.paymentReminder) {
            sendEmail(
              paymentFailedEmail({ userName, userEmail: email, planName, gracePeriodEndsAt: graceEnds })
            ).catch((err) =>
              console.error("[Paystack Webhook] Payment failed email error:", err)
            );
          }

          if (targetUserId) {
            notifyPaymentFailed(targetUserId, planName).catch(() => { });
          }
          reportPaymentToTelegram({
            outcome: "failed",
            provider: "paystack",
            reference: String(
              data.transaction?.reference || data.reference || data.invoice_code || data.id || "",
            ),
            userId: targetUserId,
            name: userName === "there" ? undefined : userName,
            email,
            plan: planKey === "free" ? null : planKey,
            amount: typeof data.amount === "number" ? data.amount / 100 : null,
            currency: data.currency || "NGN",
            failureReason: data.gateway_response || data.description || "Subscription renewal charge failed",
            source: "Paystack webhook (renewal)",
          });
        }

        console.log(`[Paystack Webhook] Invoice payment failed for ${email || "unknown"}`);
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[Paystack Webhook] Error:", error);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}
