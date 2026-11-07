/**
 * POST /api/payments/retry
 * Retry a failed subscription payment through Flutterwave.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthUserFromRequest } from "@/lib/auth";
import { COLLECTIONS, getBillingTransactionById } from "@/lib/db";
import { getPricingVersion } from "@/lib/countryPricing";
import { DiscountCodeError, resolveDiscountCode } from "@/lib/discounts";
import { resolvePaymentPricing } from "@/lib/paymentPricing";
import { paymentProviderDisabledResponse } from "@/lib/adminControls";
import { createFlutterwavePayment, FlutterwaveError, isFlutterwaveConfigured } from "@/lib/flutterwave";
import { rateLimit } from "@/lib/rateLimit";
import clientPromise from "@/lib/mongodb";
import crypto from "node:crypto";
import { reportPaymentToTelegram } from "@/lib/paymentTelegramNotifications";

const limiter = rateLimit({ windowMs: 60_000, max: 10 });
const RETRYABLE_TYPES = ["subscription_purchase", "subscription_renewal", "plan_upgrade"];

interface RetryPaymentBody {
  transactionId?: string;
}

export async function POST(req: NextRequest) {
  try {
    const rateResult = limiter.check(req);
    if (!rateResult.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    const authUser = await getAuthUserFromRequest(req);
    if (!authUser?.mongoUser?._id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isFlutterwaveConfigured()) {
      return NextResponse.json({ error: "Flutterwave is not configured" }, { status: 503 });
    }

    const userId = authUser.mongoUser._id.toString();
    const email = authUser.mongoUser.email;
    const { transactionId } = (await req.json()) as RetryPaymentBody;
    if (!transactionId) return NextResponse.json({ error: "Missing transactionId" }, { status: 400 });

    const originalTxn = await getBillingTransactionById(transactionId);
    if (!originalTxn || originalTxn.userId !== userId) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }
    if (String(originalTxn.status || "").toLowerCase() !== "failed") {
      return NextResponse.json({ error: "Only failed transactions can be retried." }, { status: 409 });
    }
    if (!RETRYABLE_TYPES.includes(originalTxn.type)) {
      return NextResponse.json(
        { error: "This transaction cannot be retried here. Start a new purchase from the relevant page." },
        { status: 400 },
      );
    }

    const plan = String(originalTxn.plan || "").toLowerCase();
    const billingCycle = originalTxn.billingCycle;
    if ((plan !== "basic" && plan !== "growth") || (billingCycle !== "monthly" && billingCycle !== "yearly")) {
      return NextResponse.json({ error: "This plan purchase cannot be retried. Choose a plan to start a new checkout." }, { status: 400 });
    }

    const providerOff = await paymentProviderDisabledResponse("flutterwave");
    if (providerOff) return providerOff;

    const pricingResolution = await resolvePaymentPricing(req, authUser.mongoUser.country, "flutterwave");
    if (pricingResolution.requiresCountrySelection) {
      return NextResponse.json(
        { error: "Please select your country in your profile before starting payment.", code: "COUNTRY_REQUIRED" },
        { status: 400 },
      );
    }
    const { countryCode, checkoutPricing } = pricingResolution;
    const planPricing = checkoutPricing.plans[plan];
    const originalAmount = billingCycle === "yearly" ? planPricing.yearly : planPricing.monthly;
    if (!Number.isFinite(originalAmount) || originalAmount <= 0) {
      return NextResponse.json({ error: "No valid price is available for this plan." }, { status: 400 });
    }

    let amount = originalAmount;
    let appliedDiscount: Awaited<ReturnType<typeof resolveDiscountCode>> | null = null;
    if (originalTxn.discountCode) {
      appliedDiscount = await resolveDiscountCode({
        code: originalTxn.discountCode,
        user: authUser.mongoUser,
        plan,
        billingCycle,
        originalAmount,
      });
      amount = appliedDiscount.finalAmount;
    }

    const pricingVersion = await getPricingVersion();
    const reference = `mce_fw_retry_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
    const metadata = {
      userId,
      plan,
      billingCycle,
      purchaseKind: originalTxn.purchaseKind || "subscription",
      country: countryCode,
      currency: checkoutPricing.currency,
      currencySymbol: checkoutPricing.currencySymbol,
      price: amount,
      originalPrice: originalAmount,
      pricingVersion,
      retryOf: transactionId,
      discountCode: appliedDiscount?.code || undefined,
      discountPercent: appliedDiscount?.percentOff || undefined,
      discountDurationMonths: appliedDiscount?.durationMonths || undefined,
      discountMonthsRemaining: appliedDiscount?.monthsRemainingAfterCheckout || undefined,
      discountAmount: appliedDiscount?.discountAmount || undefined,
      discountOriginalPrice: appliedDiscount?.originalAmount || undefined,
      discountedPrice: appliedDiscount?.finalAmount || undefined,
      discountAnnouncementId: appliedDiscount?.announcementId || undefined,
      discountAnnouncementTitle: appliedDiscount?.announcementTitle || undefined,
    };
    const db = (await clientPromise).db();
    const intents = db.collection<any>(COLLECTIONS.FLUTTERWAVE_INTENTS);
    await intents.insertOne({
      _id: reference,
      reference,
      userId,
      email,
      plan,
      billingCycle,
      purchaseKind: metadata.purchaseKind,
      amount,
      currency: checkoutPricing.currency,
      expectedTxRef: reference,
      expectedAmount: amount,
      expectedCurrency: checkoutPricing.currency,
      currencySymbol: checkoutPricing.currencySymbol,
      country: countryCode,
      metadata,
      status: "PENDING",
      expiresAt,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });

    try {
      const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:4000").replace(/\/$/, "");
      const payment = await createFlutterwavePayment({
        amount,
        currency: checkoutPricing.currency,
        txRef: reference,
        email,
        name: String((authUser.mongoUser as any).name || "").trim() || undefined,
        redirectUrl: `${appUrl}/billing/success?type=flutterwave`,
        description: `MakeChurchEazy ${plan} ${billingCycle} access`,
        metadata,
      });
      const paymentUrl = String(payment.data?.link || "").trim();
      if (!paymentUrl) throw new FlutterwaveError("Flutterwave did not return a payment link", 502);

      await intents.updateOne(
        { _id: reference },
        { $set: { paymentUrl, providerPayload: { link: paymentUrl }, updatedAt: new Date().toISOString() } },
      );
      return NextResponse.json({
        success: true,
        paymentMethod: "flutterwave",
        authorization_url: paymentUrl,
        reference,
        amount,
        currency: checkoutPricing.currency,
        currencySymbol: checkoutPricing.currencySymbol,
        price: amount,
        originalPrice: originalAmount,
        discount: appliedDiscount,
        expiresAt,
      });
    } catch (error) {
      await intents.updateOne(
        { _id: reference },
        { $set: { status: "FAILED", failureReason: error instanceof Error ? error.message : "Flutterwave retry failed", updatedAt: new Date().toISOString() } },
      );
      reportPaymentToTelegram({
        outcome: "failed",
        provider: "flutterwave",
        reference,
        userId,
        name: authUser.mongoUser.name,
        email,
        plan,
        billingCycle,
        amount,
        currency: checkoutPricing.currency,
        failureReason: error instanceof Error ? error.message : "Flutterwave retry failed",
        source: "Checkout retry",
      });
      throw error;
    }
  } catch (error) {
    if (error instanceof DiscountCodeError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof FlutterwaveError) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    console.error("[Flutterwave Retry] Error:", error);
    return NextResponse.json({ error: "Could not start the Flutterwave retry." }, { status: 500 });
  }
}
