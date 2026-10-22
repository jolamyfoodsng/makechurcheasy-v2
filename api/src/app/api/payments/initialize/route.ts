/**
 * POST /api/payments/initialize
 *
 * Initializes the selected payment method for a plan purchase.
 * Returns an authorization URL or provider-specific pending status.
 *
 * Body: { plan: string, billingCycle?: "monthly" | "yearly" | "lifetime" }
 *
 * Currency and amount are determined server-side from the selected payment
 * method and the user's country. Flutterwave uses its explicit market map and
 * falls back to USD for all other countries.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthUserFromRequest } from "@/lib/auth";
import { getActiveSubscription, getPlanConfig } from "@/lib/db";
import { getPricingVersion } from "@/lib/countryPricing";
import { resolvePaymentPricing } from "@/lib/paymentPricing";
import { rateLimit } from "@/lib/rateLimit";
import { resolveEarlyAccessOffer } from "@/lib/earlyAccess";
import { getPlatformSettings } from "@/lib/platformSettings";
import { DiscountCodeError, resolveDiscountCode } from "@/lib/discounts";
import { resolveSpecialOfferById, type ResolvedSpecialOffer } from "@/lib/specialOffers";
import { getActiveTrialDaysRemaining } from "@/lib/trialRecords";
import { hasSuccessfulPaidSubscription } from "@/lib/subscriptionPricingEligibility";
import { loadPlanChangeContext, quotePlanChange, type PlanChangeQuote } from "@/lib/planChangeCredit";
import { completeMtnMomoPayment } from "@/lib/completeMtnMomoPayment";
import {
  createMtnMomoRequest,
  getMtnMomoPublicConfig,
  isMtnMomoAvailable,
  MtnMomoError,
} from "@/lib/mtnMomo";
import {
  createNowPaymentsInvoice,
  getNowPaymentsIpnCallbackUrl,
  hasExplicitNowPaymentsCallbackUrl,
  isNowPaymentsConfigured,
  isNowPaymentsPriceCurrencySupported,
  NowPaymentsError,
} from "@/lib/nowPayments";
import {
  createFlutterwavePayment,
  isFlutterwaveConfigured,
  isFlutterwaveCurrencySupported,
  FlutterwaveError,
} from "@/lib/flutterwave";
import clientPromise from "@/lib/mongodb";
import { recordActivationEvent } from "@/lib/activation";
import { notifyTelegramCheckoutStarted } from "@/lib/telegramNotifications";
import crypto from "node:crypto";
import { paymentProviderDisabledResponse } from "@/lib/adminControls";

const limiter = rateLimit({ windowMs: 60_000, max: 10 });

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Valid plan tiers (excludes "free" and "trial") */
const VALID_PURCHASE_PLANS = ["basic", "growth"] as const;
type PurchasePlan = (typeof VALID_PURCHASE_PLANS)[number];

interface InitializePaymentBody {
  plan?: string;
  billingCycle?: "monthly" | "yearly" | "lifetime";
  discountCode?: string;
  offerId?: string;
  paymentMethod?: "paystack" | "mtn_momo" | "nowpayments" | "flutterwave";
  mtnPhone?: string;
}

export async function POST(req: NextRequest) {
  try {
    const rateResult = limiter.check(req);
    if (!rateResult.ok) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const platformSettings = await getPlatformSettings();
    if (!platformSettings.system.allowPayments) {
      return NextResponse.json(
        { error: "Payments are currently disabled" },
        { status: 403 }
      );
    }

    const authUser = await getAuthUserFromRequest(req);
    if (!authUser?.mongoUser?._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = authUser.mongoUser._id.toString();
    const email = authUser.mongoUser.email;

    const body = (await req.json()) as InitializePaymentBody;
    const requestedMethod = body.paymentMethod || "flutterwave";
    const paymentMethod = requestedMethod === "paystack" ? "flutterwave" : requestedMethod;
    if (
      paymentMethod !== "mtn_momo" &&
      paymentMethod !== "nowpayments" &&
      paymentMethod !== "flutterwave"
    ) {
      return NextResponse.json({ error: "Unsupported payment method" }, { status: 400 });
    }
    {
      const providerKey = paymentMethod === "mtn_momo" ? "mtnMomo" : paymentMethod === "nowpayments" ? "nowpayments" : "flutterwave";
      const disabled = await paymentProviderDisabledResponse(providerKey);
      if (disabled) return disabled;
    }
    if (paymentMethod === "nowpayments") {
      const callbackUrl = getNowPaymentsIpnCallbackUrl();
      const callbackConfigured =
        /^https?:\/\//i.test(callbackUrl) &&
        (process.env.NODE_ENV !== "production" || hasExplicitNowPaymentsCallbackUrl());
      if (!isNowPaymentsConfigured() || !callbackConfigured) {
        return NextResponse.json(
          { error: "NOWPayments is not configured with a public IPN callback URL." },
          { status: 503 },
        );
      }
    }
    if (paymentMethod === "flutterwave" && !isFlutterwaveConfigured()) {
      return NextResponse.json(
        { error: "Flutterwave is not configured" },
        { status: 503 },
      );
    }

    const { plan, discountCode, offerId } = body;
    let billingCycle: InitializePaymentBody["billingCycle"] = body.billingCycle || "monthly";

    if (!plan && !offerId) {
      return NextResponse.json(
        { error: "Missing required field: plan or offerId" },
        { status: 400 }
      );
    }

    if (plan && !VALID_PURCHASE_PLANS.includes(plan as PurchasePlan)) {
      return NextResponse.json(
        { error: `Invalid plan: ${plan}` },
        { status: 400 }
      );
    }
    let purchasePlan = (plan as PurchasePlan | undefined) || "growth";

    // ── Get user's country and pricing ──────────────────────────────────────

    const pricingResolution = await resolvePaymentPricing(
      req,
      authUser.mongoUser.country,
      paymentMethod,
    );
    const userCountry = pricingResolution.countryCode;
    const countryPricing = pricingResolution.countryPricing;
    const checkoutPricing = pricingResolution.checkoutPricing;
    if (pricingResolution.requiresCountrySelection) {
      return NextResponse.json(
        {
          error: "Please select your country in your profile before starting payment.",
          code: "COUNTRY_REQUIRED",
        },
        { status: 400 },
      );
    }
    const planConfig = await getPlanConfig();
    let numericAmount = 0;
    let paymentCurrency = checkoutPricing.currency;
    let paymentCurrencySymbol = checkoutPricing.currencySymbol;
    let originalAmount = 0;
    let appliedDiscount: Awaited<ReturnType<typeof resolveDiscountCode>> | null = null;
    let appliedOffer: ResolvedSpecialOffer | null = null;
    let purchaseKind: "subscription" | "one_time" = "subscription";
    let hasPriorPaidSubscription = false;

    if (offerId) {
      const offerResult = resolveSpecialOfferById({
        planConfig,
        user: authUser.mongoUser,
        countryPricing: checkoutPricing,
        offerId,
      });
      if (!offerResult) {
        return NextResponse.json(
          { error: "This offer is no longer available." },
          { status: 404 },
        );
      }
      if (!offerResult.eligible) {
        return NextResponse.json(
          { error: "You are not eligible for this offer.", reasons: offerResult.reasons },
          { status: 403 },
        );
      }

      appliedOffer = offerResult.offer;
      purchasePlan = appliedOffer.plan;
      billingCycle = appliedOffer.billingCycle;
      purchaseKind = appliedOffer.purchaseKind;
      numericAmount = appliedOffer.price;
      originalAmount = appliedOffer.originalPrice;
      paymentCurrency = appliedOffer.currency;
      paymentCurrencySymbol = appliedOffer.currencySymbol;
    } else if (billingCycle === "lifetime") {
      if (purchasePlan !== "growth") {
        return NextResponse.json(
          { error: "Lifetime early access is only available for Growth." },
          { status: 400 }
        );
      }

      const offer = await resolveEarlyAccessOffer(platformSettings, {
        ...authUser.mongoUser,
        country: userCountry,
      });
      if (!offer.enabled || !offer.eligible) {
        return NextResponse.json(
          { error: "You are not eligible for this early access offer." },
          { status: 403 }
        );
      }
      numericAmount = offer.price;
      paymentCurrency = offer.currency;
      paymentCurrencySymbol = offer.currencySymbol;
      originalAmount = numericAmount;
      purchaseKind = "one_time";
    } else {
      const planPricing = checkoutPricing.plans[purchasePlan as keyof typeof checkoutPricing.plans];
      if (!planPricing) {
        return NextResponse.json(
          { error: `No pricing found for plan "${plan}" in country "${userCountry}"` },
          { status: 400 }
        );
      }

      hasPriorPaidSubscription = await hasSuccessfulPaidSubscription(userId);
      const applyIntroductoryPrice =
        billingCycle === "monthly" && !hasPriorPaidSubscription && planPricing.introductoryMonthly != null;
      numericAmount = billingCycle === "yearly"
        ? planPricing.yearly
        : applyIntroductoryPrice
          ? planPricing.introductoryMonthly!
          : planPricing.monthly;
      originalAmount = numericAmount;
      if (applyIntroductoryPrice) {
        originalAmount = planPricing.monthly;
      }
    }

    if (!numericAmount || numericAmount <= 0) {
      return NextResponse.json(
        { error: `Invalid price for plan "${plan}" in country "${userCountry}"` },
        { status: 400 }
      );
    }

    if (discountCode?.trim() && !appliedOffer) {
      appliedDiscount = await resolveDiscountCode({
        code: discountCode,
        user: authUser.mongoUser,
        plan: purchasePlan,
        billingCycle,
        originalAmount,
      });
      numericAmount = appliedDiscount.finalAmount;
    }

    // ── Credit for the unused time of the current plan ─────────────────────
    // Changing plan (including Growth to Basic) or switching monthly/yearly takes the value of the days
    // left off the new price. When the credit covers the whole price nothing is charged: the plan is
    // switched now and the leftover becomes extra days.
    let planChange: PlanChangeQuote | null = null;
    const fullPrice = numericAmount;
    if (
      !appliedOffer &&
      purchaseKind === "subscription" &&
      (billingCycle === "monthly" || billingCycle === "yearly") &&
      (purchasePlan === "basic" || purchasePlan === "growth")
    ) {
      const changeContext = await loadPlanChangeContext(userId, authUser.mongoUser);
      const quote = quotePlanChange({
        context: changeContext,
        newPlan: purchasePlan,
        newCycle: billingCycle,
        newPrice: numericAmount,
        currency: paymentCurrency,
      });
      if (quote.eligible) planChange = quote;
    }
    if (planChange?.coversAll) {
      const switchedAt = new Date();
      const result = await completeMtnMomoPayment({
        providerReference: `mce_credit_${switchedAt.getTime()}_${crypto.randomBytes(6).toString("hex")}`,
        userId,
        email,
        amount: 0,
        currency: paymentCurrency,
        metadata: {
          userId,
          plan: purchasePlan,
          billingCycle,
          // The leftover credit, as extra days of the new plan.
          trialDaysCarried: planChange.extraDays,
          country: userCountry,
          currency: paymentCurrency,
          currencySymbol: paymentCurrencySymbol,
          price: fullPrice,
          originalPrice: originalAmount,
          pricingVersion: await getPricingVersion(),
          purchaseKind,
          creditApplied: planChange.creditApplied,
          creditUnusedDays: planChange.daysLeft,
        },
        paymentProvider: "plan_credit",
        paymentMethod: "Credit for unused time",
        completionSource: "user:plan-change",
      });
      return NextResponse.json({
        switched: true,
        plan: purchasePlan,
        billingCycle,
        expiresAt: result.expiresAt,
        extraDays: planChange.extraDays,
        creditApplied: planChange.creditApplied,
        currency: paymentCurrency,
      });
    }
    if (planChange) {
      if (paymentMethod === "nowpayments") {
        return NextResponse.json(
          { error: "Changing plan with your unused-time credit is not available with crypto yet. Please choose Cash / Card." },
          { status: 400 },
        );
      }
      numericAmount = planChange.amountDue;
    }

    // NOWPayments invoices are always priced in USD. Convert the exact local
    // amount selected above so the card price and the crypto invoice match.
    if (paymentMethod === "nowpayments") {
      let cryptoAmount: number | null = null;
      let cryptoOriginalAmount: number | null = null;

      const standardPlanPurchase = !appliedOffer && billingCycle !== "lifetime";
      if (standardPlanPurchase && !appliedDiscount) {
        const basePlan = countryPricing.baseUsdPlans[purchasePlan];
        if (basePlan) {
          cryptoAmount = billingCycle === "monthly" && !hasPriorPaidSubscription && basePlan.introductoryMonthly != null
            ? basePlan.introductoryMonthly
            : billingCycle === "yearly" ? basePlan.yearly : basePlan.monthly;
          cryptoOriginalAmount = billingCycle === "yearly" ? basePlan.yearly : basePlan.monthly;
        }
      } else if (paymentCurrency.toUpperCase() === "USD") {
        cryptoAmount = numericAmount;
        cryptoOriginalAmount = originalAmount;
      } else if (
        paymentCurrency.toUpperCase() === countryPricing.currency.toUpperCase() &&
        countryPricing.usdToLocalRate
      ) {
        cryptoAmount = numericAmount / countryPricing.usdToLocalRate;
        cryptoOriginalAmount = originalAmount / countryPricing.usdToLocalRate;
      }

      if (!cryptoAmount || cryptoAmount <= 0 || !cryptoOriginalAmount || cryptoOriginalAmount <= 0) {
        return NextResponse.json(
          { error: "Crypto checkout could not convert this price to USD. Please choose another payment method." },
          { status: 400 },
        );
      }

      numericAmount = roundMoney(cryptoAmount);
      originalAmount = roundMoney(cryptoOriginalAmount);
      paymentCurrency = "USD";
      paymentCurrencySymbol = "$";
    }

    if (paymentMethod === "nowpayments" && !isNowPaymentsPriceCurrencySupported(paymentCurrency)) {
      return NextResponse.json(
        { error: "Crypto checkout is not available in USD yet." },
        { status: 400 },
      );
    }
    if (paymentMethod === "flutterwave" && !isFlutterwaveCurrencySupported(paymentCurrency)) {
      return NextResponse.json(
        { error: `Flutterwave checkout is not available for ${paymentCurrency} pricing yet.` },
        { status: 400 },
      );
    }

    // ── Get pricing version for subscription lock ──────────────────────────

    const pricingVersion = await getPricingVersion();

    const activeTrialDays = purchaseKind === "subscription"
      ? await getActiveTrialDaysRemaining(userId)
      : 0;
    const activeSubscription = activeTrialDays > 0
      ? await getActiveSubscription(userId).catch(() => null)
      : null;
    const subscriptionEndsAtMs = authUser.mongoUser.subscriptionExpiresAt
      ? new Date(authUser.mongoUser.subscriptionExpiresAt).getTime()
      : 0;
    const hasCurrentPaidSubscription = Boolean(activeSubscription) ||
      (Number.isFinite(subscriptionEndsAtMs) && subscriptionEndsAtMs > Date.now());
    const nowMs = Date.now();
    const isGrantActive = (grant: { active?: boolean; expiresAt?: string | null } | null | undefined) => {
      if (!grant?.active) return false;
      if (!grant.expiresAt) return true;
      const expiresAtMs = new Date(grant.expiresAt).getTime();
      return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
    };
    const hasManagedAccess = authUser.mongoUser.role === "admin" ||
      Boolean(authUser.mongoUser.ambassador?.active) ||
      isGrantActive(authUser.mongoUser.adminTemporaryPlan) ||
      isGrantActive(authUser.mongoUser.adminManagedSubscription);
    const trialDaysCarried = activeTrialDays > 0 && !hasCurrentPaidSubscription && !hasManagedAccess
      ? activeTrialDays
      : 0;
    const paymentMetadata = {
      userId,
      plan: purchasePlan,
      billingCycle,
      trialDaysCarried,
      country: userCountry,
      currency: paymentCurrency,
      currencySymbol: paymentCurrencySymbol,
      // The plan's price; what is charged can be less when unused time is credited.
      price: planChange ? fullPrice : numericAmount,
      originalPrice: originalAmount,
      creditApplied: planChange?.creditApplied || undefined,
      creditUnusedDays: planChange?.daysLeft || undefined,
      pricingVersion,
      purchaseKind,
      earlyAccess: billingCycle === "lifetime",
      oneTimeOffer: purchaseKind === "one_time",
      offerId: appliedOffer?.id || undefined,
      offerName: appliedOffer?.name || undefined,
      offerKind: appliedOffer?.kind || undefined,
      offerOriginalPrice: appliedOffer?.originalPrice || undefined,
      offerAppliedPrice: appliedOffer?.price || undefined,
      offerDiscountPercent: appliedOffer?.discountPercent || undefined,
      offerDiscountDurationMonths: appliedOffer?.discountDurationMonths || undefined,
      offerDiscountAmount: appliedOffer?.discountAmount || undefined,
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

    await notifyTelegramCheckoutStarted({
      name: authUser.mongoUser.name,
      country: userCountry,
      plan: purchasePlan,
      billingCycle,
      paymentMethod,
      amount: numericAmount,
      currency: paymentCurrency,
      createdAt: new Date(),
    });

    // ── Initialize Flutterwave Standard hosted checkout ────────────────────

    if (paymentMethod === "flutterwave") {
      const reference = `mce_fw_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
      const db = (await clientPromise).db();
      const intents = db.collection<any>("flutterwave_payment_intents");
      await intents.insertOne({
        _id: reference,
        reference,
        userId,
        email,
        plan: purchasePlan,
        billingCycle,
        purchaseKind,
        amount: numericAmount,
        currency: paymentCurrency,
        expectedTxRef: reference,
        expectedAmount: numericAmount,
        expectedCurrency: paymentCurrency,
        currencySymbol: paymentCurrencySymbol,
        country: userCountry,
        metadata: paymentMetadata,
        status: "PENDING",
        expiresAt,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });

      const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:4000").replace(/\/$/, "");
      try {
        const payment = await createFlutterwavePayment({
          amount: numericAmount,
          currency: paymentCurrency,
          txRef: reference,
          email,
          name: String((authUser.mongoUser as any).name || "").trim() || undefined,
          redirectUrl: `${appUrl}/billing/success?type=flutterwave`,
          description: `MakeChurchEazy ${purchasePlan} ${billingCycle} access`,
          metadata: {
            userId,
            plan: purchasePlan,
            billingCycle,
            purchaseKind,
          },
        });
        const paymentUrl = String(payment.data?.link || "").trim();
        if (!paymentUrl) {
          throw new FlutterwaveError("Flutterwave did not return a payment link", 502);
        }

        await intents.updateOne(
          { _id: reference },
          {
            $set: {
              paymentUrl,
              providerPayload: { link: paymentUrl },
              updatedAt: new Date().toISOString(),
            },
          },
        );

        void recordActivationEvent(userId, "checkout_started", {
          paymentMethod,
          plan: purchasePlan,
          billingCycle,
          purchaseKind,
        }).catch(() => { });

        return NextResponse.json({
          success: true,
          paymentMethod: "flutterwave",
          authorization_url: paymentUrl,
          reference,
          status: "PENDING",
          expiresAt,
          amount: numericAmount,
          currency: paymentCurrency,
          currencySymbol: paymentCurrencySymbol,
          country: userCountry,
          price: numericAmount,
          originalPrice: originalAmount,
          discount: appliedDiscount,
          offer: appliedOffer,
          purchaseKind,
          pricingVersion,
          plan: purchasePlan,
          billingCycle,
        });
      } catch (error) {
        await intents.updateOne(
          { _id: reference },
          {
            $set: {
              status: "FAILED",
              failureReason: error instanceof Error ? error.message : "Flutterwave payment creation failed",
              updatedAt: new Date().toISOString(),
            },
          },
        );
        throw error;
      }
    }

    // ── Initialize MTN MoMo Collection payment ─────────────────────────────

    if (paymentMethod === "mtn_momo") {
      const momoConfig = getMtnMomoPublicConfig(userCountry);
      if (!momoConfig.enabled) {
        return NextResponse.json(
          { error: "MTN MoMo is not enabled for this country." },
          { status: 403 },
        );
      }
      if (!isMtnMomoAvailable(userCountry, paymentCurrency)) {
        return NextResponse.json(
          { error: `MTN MoMo requires ${momoConfig.currency} pricing for this account.` },
          { status: 400 },
        );
      }
      const mtnPhone = body.mtnPhone?.trim();
      if (!mtnPhone) {
        return NextResponse.json(
          { error: "MTN MoMo phone number is required." },
          { status: 400 },
        );
      }

      const providerReference = crypto.randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
      const db = (await clientPromise).db();
      const intents = db.collection<any>("momo_payment_intents");
      await intents.insertOne({
        _id: providerReference,
        providerReference,
        userId,
        email,
        plan: purchasePlan,
        billingCycle,
        purchaseKind,
        amount: numericAmount,
        currency: paymentCurrency,
        currencySymbol: paymentCurrencySymbol,
        country: userCountry,
        metadata: paymentMetadata,
        status: "PENDING",
        expiresAt,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });

      try {
        await createMtnMomoRequest({
          providerReference,
          amount: numericAmount,
          currency: paymentCurrency,
          countryCode: userCountry,
          phone: mtnPhone,
          externalId: providerReference,
          payerMessage: `MakeChurchEazy ${purchasePlan} subscription`,
          payeeNote: `MakeChurchEazy ${billingCycle} payment`,
        });
      } catch (error) {
        await intents.updateOne(
          { _id: providerReference },
          {
            $set: {
              status: "FAILED",
              failureReason: error instanceof Error ? error.message : "MTN MoMo request failed",
              updatedAt: new Date().toISOString(),
            },
          },
        );
        throw error;
      }

      void recordActivationEvent(userId, "checkout_started", {
        paymentMethod,
        plan: purchasePlan,
        billingCycle,
        purchaseKind,
      }).catch(() => { });

      return NextResponse.json({
        success: true,
        paymentMethod: "mtn_momo",
        reference: providerReference,
        status: "PENDING",
        expiresAt,
        amount: numericAmount,
        currency: paymentCurrency,
        currencySymbol: paymentCurrencySymbol,
        country: userCountry,
        plan: purchasePlan,
        billingCycle,
        purchaseKind,
      });
    }

    // ── Initialize NOWPayments hosted crypto invoice ────────────────────────

    if (paymentMethod === "nowpayments") {
      const orderId = `mce_np_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
      const db = (await clientPromise).db();
      const intents = db.collection<any>("nowpayments_payment_intents");
      await intents.insertOne({
        _id: orderId,
        orderId,
        userId,
        email,
        plan: purchasePlan,
        billingCycle,
        purchaseKind,
        amount: numericAmount,
        currency: paymentCurrency,
        currencySymbol: paymentCurrencySymbol,
        country: userCountry,
        metadata: paymentMetadata,
        status: "CREATING",
        expiresAt,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });

      const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:4000").replace(/\/$/, "");
      try {
        const invoice = await createNowPaymentsInvoice({
          amount: numericAmount,
          currency: paymentCurrency,
          orderId,
          description: `MakeChurchEazy ${purchasePlan} ${billingCycle} access`,
          ipnCallbackUrl: getNowPaymentsIpnCallbackUrl(),
          successUrl: `${appUrl}/billing/success?type=nowpayments&reference=${encodeURIComponent(orderId)}`,
          cancelUrl: `${appUrl}/subscription/plans?payment=cancelled`,
        });
        const invoiceUrl = String(invoice.invoice_url || "").trim();
        const providerInvoiceId = String(invoice.id ?? "").trim();
        if (!invoiceUrl || !providerInvoiceId) {
          throw new NowPaymentsError("NOWPayments did not return a usable invoice URL", 502);
        }

        await intents.updateOne(
          { _id: orderId },
          {
            $set: {
              status: "PENDING",
              providerInvoiceId,
              invoiceUrl,
              providerPayload: {
                invoiceId: providerInvoiceId,
                invoiceUrl,
                orderId,
              },
              updatedAt: new Date().toISOString(),
            },
          },
        );

        void recordActivationEvent(userId, "checkout_started", {
          paymentMethod,
          plan: purchasePlan,
          billingCycle,
          purchaseKind,
        }).catch(() => { });

        return NextResponse.json({
          success: true,
          paymentMethod: "nowpayments",
          authorization_url: invoiceUrl,
          invoice_url: invoiceUrl,
          reference: orderId,
          providerReference: providerInvoiceId,
          status: "PENDING",
          expiresAt,
          amount: numericAmount,
          currency: paymentCurrency,
          currencySymbol: paymentCurrencySymbol,
          country: userCountry,
          price: numericAmount,
          originalPrice: originalAmount,
          discount: appliedDiscount,
          offer: appliedOffer,
          purchaseKind,
          pricingVersion,
          plan: purchasePlan,
          billingCycle,
        });
      } catch (error) {
        await intents.updateOne(
          { _id: orderId },
          {
            $set: {
              status: "FAILED",
              failureReason: error instanceof Error ? error.message : "NOWPayments invoice creation failed",
              updatedAt: new Date().toISOString(),
            },
          },
        );
        throw error;
      }
    }

    return NextResponse.json({ error: "Unsupported payment method" }, { status: 400 });
  } catch (error) {
    if (error instanceof DiscountCodeError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof MtnMomoError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    if (error instanceof NowPaymentsError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    if (error instanceof FlutterwaveError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[Payment Init] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
