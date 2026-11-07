import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { COLLECTIONS } from "@/lib/db";
import { completeFlutterwavePayment } from "@/lib/completeMtnMomoPayment";
import {
  getFlutterwaveSecretHash,
  isFlutterwaveConfigured,
  verifyFlutterwaveTransaction,
  verifyFlutterwaveWebhookSignature,
} from "@/lib/flutterwave";
import { paymentDetailsFromIntent, reportPaymentToTelegram } from "@/lib/paymentTelegramNotifications";

function received(reference?: string, status?: string) {
  return NextResponse.json({
    received: true,
    ...(reference ? { reference } : {}),
    ...(status ? { status } : {}),
  });
}

function reportFailure(intent: Record<string, any>, reference: string, failureReason: string) {
  reportPaymentToTelegram(paymentDetailsFromIntent(intent, {
    outcome: "failed",
    provider: "flutterwave",
    reference,
    failureReason,
    source: "Flutterwave webhook",
  }));
}

function amountMatchesExpected(actualValue: unknown, expectedValue: unknown) {
  const actual = Number(actualValue);
  const expected = Number(expectedValue);
  return Number.isFinite(actual) && Number.isFinite(expected)
    && Math.round(actual * 100) === Math.round(expected * 100);
}

function currencyMatches(actualValue: unknown, expectedValue: unknown) {
  return String(actualValue || "").trim().toUpperCase() === String(expectedValue || "").trim().toUpperCase();
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  let payload: Record<string, any>;
  try {
    payload = JSON.parse(rawBody) as Record<string, any>;
  } catch {
    return NextResponse.json({ error: "Invalid notification body" }, { status: 400 });
  }

  if (
    !isFlutterwaveConfigured() ||
    !getFlutterwaveSecretHash() ||
    !verifyFlutterwaveWebhookSignature({
      rawBody,
      flutterwaveSignature: req.headers.get("flutterwave-signature"),
      verifHash: req.headers.get("verif-hash"),
    })
  ) {
    return NextResponse.json({ error: "Invalid notification signature" }, { status: 401 });
  }

  const data = payload.data && typeof payload.data === "object" ? payload.data : {};
  const transactionId = String(data.id || payload.id || "").trim();
  const reference = String(data.tx_ref || data.reference || "").trim();
  const eventStatus = String(data.status || payload.status || "").trim().toLowerCase();
  if (!reference && !transactionId) return received(undefined, eventStatus || undefined);

  try {
    const db = (await clientPromise).db();
    const intents = db.collection<any>(COLLECTIONS.FLUTTERWAVE_INTENTS);
    const intent = await intents.findOne({
      $or: [
        ...(reference ? [{ _id: reference }, { reference }] : []),
        ...(transactionId ? [{ providerTransactionId: transactionId }] : []),
      ],
    });
    if (!intent) return received(reference || transactionId, eventStatus || undefined);

    const intentReference = String(intent.reference || intent._id);
    if (intent.status === "SUCCESSFUL" || intent.status === "FAILED") {
      return received(intentReference, intent.status);
    }

    const now = new Date().toISOString();
    await intents.updateOne(
      { _id: intent._id },
      {
        $set: {
          providerTransactionId: transactionId || intent.providerTransactionId || null,
          providerStatus: eventStatus,
          lastWebhookAt: now,
          updatedAt: now,
        },
      },
    );

    if (["failed", "cancelled", "canceled", "refunded"].includes(eventStatus)) {
      await intents.updateOne(
        { _id: intent._id, status: { $in: ["PENDING", "CREATING"] } },
        { $set: { status: "FAILED", failureReason: `Flutterwave payment ${eventStatus}.`, updatedAt: now } },
      );
      reportFailure(intent, intentReference, `Flutterwave payment ${eventStatus}.`);
      return received(intentReference, eventStatus);
    }
    if (!transactionId || !["successful", "succeeded"].includes(eventStatus)) {
      return received(intentReference, eventStatus || "pending");
    }

    // Never provision from the webhook body alone. Re-query Flutterwave and
    // compare the immutable checkout values with the stored intent.
    const verified = await verifyFlutterwaveTransaction(transactionId);
    const verifiedData = verified.data;
    const expectedReference = String(intent.expectedTxRef || intent.reference || intent._id || "").trim();
    const expectedAmount = intent.expectedAmount ?? intent.amount;
    const expectedCurrency = intent.expectedCurrency || intent.currency;
    const verifiedStatus = String(verifiedData?.status || "").trim().toLowerCase();
    if (String(verified.status || "").toLowerCase() !== "success" || verifiedStatus !== "successful") {
      return received(intentReference, verifiedStatus || "pending");
    }
    if (String(verifiedData?.tx_ref || verifiedData?.reference || "").trim() !== expectedReference) {
      return received(intentReference, "reference_mismatch");
    }
    if (!amountMatchesExpected(verifiedData?.amount, expectedAmount)) {
      await intents.updateOne(
        { _id: intent._id, status: { $in: ["PENDING", "CREATING"] } },
        { $set: { status: "FAILED", failureReason: "Payment amount mismatch.", updatedAt: new Date().toISOString() } },
      );
      reportFailure(intent, intentReference, "Payment amount mismatch.");
      return received(intentReference, "amount_mismatch");
    }
    if (!currencyMatches(verifiedData?.currency, expectedCurrency)) {
      await intents.updateOne(
        { _id: intent._id, status: { $in: ["PENDING", "CREATING"] } },
        { $set: { status: "FAILED", failureReason: "Payment currency mismatch.", updatedAt: new Date().toISOString() } },
      );
      reportFailure(intent, intentReference, "Payment currency mismatch.");
      return received(intentReference, "currency_mismatch");
    }

    const claim = await intents.updateOne(
      { _id: intent._id, status: { $in: ["PENDING", "CREATING"] } },
      { $set: { status: "PROCESSING", updatedAt: new Date().toISOString() } },
    );
    if (claim.modifiedCount !== 1) return received(intentReference, "pending");

    try {
      const result = await completeFlutterwavePayment({
        providerReference: intentReference,
        userId: String(intent.userId),
        email: String(intent.email || ""),
        amount: Number(expectedAmount),
        currency: String(expectedCurrency),
        metadata: (intent.metadata || {}) as Record<string, any>,
      });
      await intents.updateOne(
        { _id: intent._id, status: "PROCESSING" },
        {
          $set: {
            status: "SUCCESSFUL",
            providerTransactionId: transactionId,
            providerPayload: {
              id: verifiedData?.id || transactionId,
              status: verifiedStatus,
              amount: verifiedData?.amount,
              currency: verifiedData?.currency,
              reference: verifiedData?.tx_ref || verifiedData?.reference,
            },
            result,
            completedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
      );
      return received(intentReference, "successful");
    } catch (error) {
      await intents.updateOne(
        { _id: intent._id, status: "PROCESSING" },
        { $set: { status: "PENDING", updatedAt: new Date().toISOString() } },
      );
      throw error;
    }
  } catch (error) {
    console.error("[Flutterwave Webhook] Error:", error);
    return NextResponse.json({ error: "Could not process the Flutterwave notification." }, { status: 500 });
  }
}
