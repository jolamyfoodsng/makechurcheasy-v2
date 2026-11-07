import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { getAuthUserFromRequest } from "@/lib/auth";
import { completeNowPaymentsPayment } from "@/lib/completeMtnMomoPayment";
import { COLLECTIONS } from "@/lib/db";
import {
  getNowPaymentsPaymentStatus,
  NowPaymentsError,
} from "@/lib/nowPayments";
import { rateLimit } from "@/lib/rateLimit";
import { paymentDetailsFromIntent, reportPaymentToTelegram } from "@/lib/paymentTelegramNotifications";

function reportFailure(intent: Record<string, any>, reference: string, failureReason: string) {
  reportPaymentToTelegram(paymentDetailsFromIntent(intent, {
    outcome: "failed",
    provider: "nowpayments",
    reference,
    failureReason,
    source: "NOWPayments status check",
  }));
}

const FINAL_FAILURE_STATUSES = new Set([
  "failed",
  "expired",
  "refunded",
  "partially_paid",
  "wrong_amount",
]);
const limiter = rateLimit({ windowMs: 60_000, max: 60 });

function pendingResponse(reference: string, message?: string) {
  return NextResponse.json({
    success: false,
    paymentMethod: "nowpayments",
    reference,
    status: "PENDING",
    ...(message ? { message } : {}),
  }, { status: 202 });
}

function failureResponse(reference: string, error: string, status = 402) {
  return NextResponse.json({
    success: false,
    paymentMethod: "nowpayments",
    reference,
    status: "FAILED",
    error,
  }, { status });
}

function amountMatches(providerAmount: unknown, expectedAmount: unknown) {
  const actual = Number(providerAmount);
  const expected = Number(expectedAmount);
  return Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= 0.01;
}

export async function GET(req: NextRequest) {
  try {
    const rateResult = limiter.check(req);
    if (!rateResult.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    const authUser = await getAuthUserFromRequest(req);
    if (!authUser?.mongoUser?._id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const reference = String(req.nextUrl.searchParams.get("reference") || "").trim();
    if (!reference || reference.length > 100) {
      return NextResponse.json({ error: "Payment reference is required" }, { status: 400 });
    }

    const userId = authUser.mongoUser._id.toString();
    const db = (await clientPromise).db();
    const intents = db.collection<any>(COLLECTIONS.NOWPAYMENTS_INTENTS);
    const intent = await intents.findOne({ _id: reference, userId });
    if (!intent) return NextResponse.json({ error: "Payment not found" }, { status: 404 });

    if (intent.status === "SUCCESSFUL" && intent.result) {
      return NextResponse.json({
        ...intent.result,
        success: true,
        paymentMethod: "nowpayments",
        status: "SUCCESSFUL",
        reference,
      });
    }
    if (intent.status === "FAILED") {
      return failureResponse(reference, intent.failureReason || "NOWPayments payment failed.");
    }
    if (intent.status === "PROCESSING") return pendingResponse(reference);
    if (intent.expiresAt && new Date(intent.expiresAt).getTime() <= Date.now()) {
      await intents.updateOne(
        { _id: reference, userId, status: "PENDING" },
        { $set: { status: "FAILED", failureReason: "Payment invoice expired.", updatedAt: new Date().toISOString() } },
      );
      reportFailure(intent, reference, "Payment invoice expired.");
      return failureResponse(reference, "The crypto payment invoice expired. Please start again.");
    }
    if (!intent.providerPaymentId) {
      return pendingResponse(reference, "Waiting for NOWPayments to confirm the transaction.");
    }

    const provider = await getNowPaymentsPaymentStatus(String(intent.providerPaymentId));
    const providerStatus = String(provider.payment_status || "").trim().toLowerCase();
    const now = new Date().toISOString();
    await intents.updateOne(
      { _id: reference, userId, status: "PENDING" },
      {
        $set: {
          providerStatus,
          providerPayload: {
            paymentId: provider.payment_id ?? null,
            invoiceId: provider.invoice_id ?? null,
            paymentStatus: provider.payment_status ?? null,
            priceAmount: provider.price_amount ?? null,
            priceCurrency: provider.price_currency ?? null,
            payAmount: provider.pay_amount ?? null,
            payCurrency: provider.pay_currency ?? null,
            actuallyPaid: provider.actually_paid ?? null,
          },
          updatedAt: now,
        },
      },
    );

    if (FINAL_FAILURE_STATUSES.has(providerStatus)) {
      await intents.updateOne(
        { _id: reference, userId, status: "PENDING" },
        { $set: { status: "FAILED", failureReason: `NOWPayments payment ${providerStatus.replaceAll("_", " ")}.`, updatedAt: now } },
      );
      reportFailure(intent, reference, `NOWPayments payment ${providerStatus.replaceAll("_", " ")}.`);
      return failureResponse(reference, `NOWPayments payment ${providerStatus.replaceAll("_", " ")}.`);
    }
    if (providerStatus !== "finished") return pendingResponse(reference);

    if (!amountMatches(provider.price_amount, intent.amount)) {
      await intents.updateOne(
        { _id: reference, userId, status: "PENDING" },
        { $set: { status: "FAILED", failureReason: "Payment amount mismatch.", updatedAt: now } },
      );
      reportFailure(intent, reference, "Payment amount mismatch.");
      return failureResponse(reference, "Payment amount could not be verified.", 502);
    }
    if (
      provider.price_currency &&
      String(provider.price_currency).toUpperCase() !== String(intent.currency).toUpperCase()
    ) {
      await intents.updateOne(
        { _id: reference, userId, status: "PENDING" },
        { $set: { status: "FAILED", failureReason: "Payment currency mismatch.", updatedAt: now } },
      );
      reportFailure(intent, reference, "Payment currency mismatch.");
      return failureResponse(reference, "Payment currency could not be verified.", 502);
    }

    const claim = await intents.updateOne(
      { _id: reference, userId, status: "PENDING" },
      { $set: { status: "PROCESSING", updatedAt: now } },
    );
    if (claim.modifiedCount !== 1) return pendingResponse(reference);

    try {
      const result = await completeNowPaymentsPayment({
        providerReference: String(provider.payment_id || intent.providerPaymentId),
        userId,
        email: String(intent.email || authUser.mongoUser.email || ""),
        amount: Number(intent.amount),
        currency: String(intent.currency),
        metadata: (intent.metadata || {}) as Record<string, any>,
      });
      await intents.updateOne(
        { _id: reference, userId, status: "PROCESSING" },
        { $set: { status: "SUCCESSFUL", result, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } },
      );
      return NextResponse.json({
        ...result,
        success: true,
        paymentMethod: "nowpayments",
        status: "SUCCESSFUL",
        reference,
      });
    } catch (error) {
      await intents.updateOne(
        { _id: reference, userId, status: "PROCESSING" },
        { $set: { status: "PENDING", updatedAt: new Date().toISOString() } },
      );
      throw error;
    }
  } catch (error) {
    if (error instanceof NowPaymentsError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[NOWPayments Status] Error:", error);
    return NextResponse.json({ error: "Could not check the NOWPayments payment." }, { status: 500 });
  }
}
