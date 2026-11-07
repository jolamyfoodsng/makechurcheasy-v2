/**
 * MTN MoMo Collection callback.
 *
 * MTN sends the same shape as the RequestToPay status response. The callback
 * is only a wake-up signal: the provider status is queried again before any
 * account provisioning happens.
 */

import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { completeMtnMomoPayment } from "@/lib/completeMtnMomoPayment";
import { getMtnMomoRequestStatus, MtnMomoError } from "@/lib/mtnMomo";
import { paymentDetailsFromIntent, reportPaymentToTelegram } from "@/lib/paymentTelegramNotifications";

function reportFailure(intent: Record<string, any>, reference: string, failureReason: string) {
  reportPaymentToTelegram(paymentDetailsFromIntent(intent, {
    outcome: "failed",
    provider: "mtn_momo",
    reference,
    failureReason,
    source: "MTN MoMo callback",
  }));
}

function received(reference?: string, status?: string) {
  return NextResponse.json({
    received: true,
    ...(reference ? { reference } : {}),
    ...(status ? { status } : {}),
  });
}

async function handleCallback(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, any>;
    const reference = String(
      body.externalId || body.referenceId || body.reference || "",
    ).trim();
    if (!reference || reference.length > 80) {
      return NextResponse.json({ error: "Payment reference is required" }, { status: 400 });
    }

    const db = (await clientPromise).db();
    const intents = db.collection<any>("momo_payment_intents");
    const intent = await intents.findOne({ _id: reference });
    if (!intent) return NextResponse.json({ error: "Payment not found" }, { status: 404 });

    if (intent.status === "SUCCESSFUL" || intent.status === "FAILED") {
      return received(reference, intent.status);
    }
    if (intent.status === "PROCESSING") return received(reference, "PENDING");

    const provider = await getMtnMomoRequestStatus(reference);
    if (provider.externalId && provider.externalId !== reference) {
      return NextResponse.json({ error: "Payment reference could not be verified" }, { status: 502 });
    }

    if (provider.status === "PENDING") {
      await intents.updateOne(
        { _id: reference, status: "PENDING" },
        { $set: { providerStatus: provider.status, updatedAt: new Date().toISOString() } },
      );
      return received(reference, provider.status);
    }

    if (provider.status === "FAILED") {
      await intents.updateOne(
        { _id: reference, status: "PENDING" },
        {
          $set: {
            status: "FAILED",
            providerStatus: provider.status,
            failureReason: provider.reason || "MTN MoMo declined the payment.",
            updatedAt: new Date().toISOString(),
          },
        },
      );
      reportFailure(intent, reference, provider.reason || "MTN MoMo declined the payment.");
      return received(reference, provider.status);
    }

    if (provider.amount && Number(provider.amount) !== Number(intent.amount)) {
      await intents.updateOne(
        { _id: reference, status: "PENDING" },
        { $set: { status: "FAILED", failureReason: "Payment amount mismatch.", updatedAt: new Date().toISOString() } },
      );
      reportFailure(intent, reference, "Payment amount mismatch.");
      return NextResponse.json({ error: "Payment amount could not be verified" }, { status: 502 });
    }
    if (provider.currency && String(provider.currency).toUpperCase() !== String(intent.currency).toUpperCase()) {
      await intents.updateOne(
        { _id: reference, status: "PENDING" },
        { $set: { status: "FAILED", failureReason: "Payment currency mismatch.", updatedAt: new Date().toISOString() } },
      );
      reportFailure(intent, reference, "Payment currency mismatch.");
      return NextResponse.json({ error: "Payment currency could not be verified" }, { status: 502 });
    }

    const claim = await intents.updateOne(
      { _id: reference, status: "PENDING" },
      { $set: { status: "PROCESSING", providerStatus: provider.status, updatedAt: new Date().toISOString() } },
    );
    if (claim.modifiedCount !== 1) return received(reference, "PENDING");

    try {
      const result = await completeMtnMomoPayment({
        providerReference: reference,
        userId: String(intent.userId),
        email: String(intent.email || ""),
        amount: Number(intent.amount),
        currency: String(intent.currency),
        metadata: (intent.metadata || {}) as Record<string, any>,
      });
      await intents.updateOne(
        { _id: reference, status: "PROCESSING" },
        {
          $set: {
            status: "SUCCESSFUL",
            providerStatus: provider.status,
            financialTransactionId: provider.financialTransactionId || null,
            result,
            updatedAt: new Date().toISOString(),
          },
        },
      );
      return received(reference, provider.status);
    } catch (error) {
      await intents.updateOne(
        { _id: reference, status: "PROCESSING" },
        { $set: { status: "PENDING", updatedAt: new Date().toISOString() } },
      );
      throw error;
    }
  } catch (error) {
    if (error instanceof MtnMomoError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[MTN MoMo Webhook] Error:", error);
    return NextResponse.json({ error: "Could not process the MTN MoMo callback." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return handleCallback(req);
}

export async function PUT(req: NextRequest) {
  return handleCallback(req);
}
