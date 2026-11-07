import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { completeNowPaymentsPayment } from "@/lib/completeMtnMomoPayment";
import { COLLECTIONS } from "@/lib/db";
import {
  isNowPaymentsConfigured,
  verifyNowPaymentsSignature,
} from "@/lib/nowPayments";
import { paymentDetailsFromIntent, reportPaymentToTelegram } from "@/lib/paymentTelegramNotifications";

function reportFailure(intent: Record<string, any>, reference: string, failureReason: string) {
  reportPaymentToTelegram(paymentDetailsFromIntent(intent, {
    outcome: "failed",
    provider: "nowpayments",
    reference,
    failureReason,
    source: "NOWPayments webhook",
  }));
}

const FINAL_FAILURE_STATUSES = new Set([
  "failed",
  "expired",
  "refunded",
  "partially_paid",
  "wrong_amount",
]);

function received(reference?: string, status?: string) {
  return NextResponse.json({
    received: true,
    ...(reference ? { reference } : {}),
    ...(status ? { status } : {}),
  });
}

function safeProviderPayload(payload: Record<string, any>) {
  return {
    paymentId: payload.payment_id ?? null,
    invoiceId: payload.invoice_id ?? null,
    paymentStatus: payload.payment_status ?? null,
    priceAmount: payload.price_amount ?? null,
    priceCurrency: payload.price_currency ?? null,
    payAmount: payload.pay_amount ?? null,
    payCurrency: payload.pay_currency ?? null,
    actuallyPaid: payload.actually_paid ?? null,
    outcomeAmount: payload.outcome_amount ?? null,
    outcomeCurrency: payload.outcome_currency ?? null,
  };
}

function amountMatches(providerAmount: unknown, expectedAmount: unknown) {
  const actual = Number(providerAmount);
  const expected = Number(expectedAmount);
  return Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= 0.01;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  let payload: Record<string, any>;
  try {
    payload = JSON.parse(rawBody) as Record<string, any>;
  } catch {
    return NextResponse.json({ error: "Invalid notification body" }, { status: 400 });
  }

  const signature = req.headers.get("x-nowpayments-sig");
  if (!isNowPaymentsConfigured() || !verifyNowPaymentsSignature(payload, signature)) {
    return NextResponse.json({ error: "Invalid notification signature" }, { status: 401 });
  }

  const orderId = String(payload.order_id || "").trim();
  const invoiceId = String(payload.invoice_id || "").trim();
  const paymentId = String(payload.payment_id || "").trim();
  const providerStatus = String(payload.payment_status || "").trim().toLowerCase();
  if (!orderId && !invoiceId) return received(undefined, providerStatus || undefined);

  try {
    const db = (await clientPromise).db();
    const intents = db.collection<any>(COLLECTIONS.NOWPAYMENTS_INTENTS);
    const intent = await intents.findOne({
      $or: [
        ...(orderId ? [{ orderId }] : []),
        ...(invoiceId ? [{ providerInvoiceId: invoiceId }] : []),
      ],
    });
    if (!intent) return received(orderId || invoiceId, providerStatus || undefined);

    const now = new Date().toISOString();
    await intents.updateOne(
      { _id: intent._id },
      {
        $set: {
          providerPaymentId: paymentId || intent.providerPaymentId || null,
          providerStatus,
          providerPayload: safeProviderPayload(payload),
          lastIpnAt: now,
          updatedAt: now,
        },
      },
    );

    if (intent.status === "SUCCESSFUL" || intent.status === "FAILED") {
      return received(orderId || invoiceId, intent.status);
    }
    if (intent.status === "PROCESSING") return received(orderId || invoiceId, "pending");

    if (FINAL_FAILURE_STATUSES.has(providerStatus)) {
      await intents.updateOne(
        { _id: intent._id, status: "PENDING" },
        {
          $set: {
            status: "FAILED",
            failureReason: `NOWPayments payment ${providerStatus.replaceAll("_", " ")}.`,
            updatedAt: now,
          },
        },
      );
      reportFailure(intent, String(intent._id), `NOWPayments payment ${providerStatus.replaceAll("_", " ")}.`);
      return received(orderId || invoiceId, providerStatus);
    }
    if (providerStatus !== "finished") return received(orderId || invoiceId, providerStatus || "pending");

    if (!amountMatches(payload.price_amount, intent.amount)) {
      await intents.updateOne(
        { _id: intent._id, status: "PENDING" },
        { $set: { status: "FAILED", failureReason: "Payment amount mismatch.", updatedAt: now } },
      );
      reportFailure(intent, String(intent._id), "Payment amount mismatch.");
      return received(orderId || invoiceId, "failed");
    }
    if (
      payload.price_currency &&
      String(payload.price_currency).toUpperCase() !== String(intent.currency).toUpperCase()
    ) {
      await intents.updateOne(
        { _id: intent._id, status: "PENDING" },
        { $set: { status: "FAILED", failureReason: "Payment currency mismatch.", updatedAt: now } },
      );
      reportFailure(intent, String(intent._id), "Payment currency mismatch.");
      return received(orderId || invoiceId, "failed");
    }

    const claim = await intents.updateOne(
      { _id: intent._id, status: { $in: ["PENDING", "CREATING"] } },
      { $set: { status: "PROCESSING", updatedAt: now } },
    );
    if (claim.modifiedCount !== 1) return received(orderId || invoiceId, "pending");

    try {
      const result = await completeNowPaymentsPayment({
        providerReference: paymentId || invoiceId || orderId,
        userId: String(intent.userId),
        email: String(intent.email || ""),
        amount: Number(intent.amount),
        currency: String(intent.currency),
        metadata: (intent.metadata || {}) as Record<string, any>,
      });
      await intents.updateOne(
        { _id: intent._id, status: "PROCESSING" },
        {
          $set: {
            status: "SUCCESSFUL",
            result,
            completedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
      );
      return received(orderId || invoiceId, "finished");
    } catch (error) {
      await intents.updateOne(
        { _id: intent._id, status: "PROCESSING" },
        { $set: { status: "PENDING", updatedAt: new Date().toISOString() } },
      );
      throw error;
    }
  } catch (error) {
    console.error("[NOWPayments Webhook] Error:", error);
    return NextResponse.json({ error: "Could not process the NOWPayments notification." }, { status: 500 });
  }
}
