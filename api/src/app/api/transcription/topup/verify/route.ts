import { NextRequest, NextResponse } from "next/server";
import { getAuthUserFromRequest } from "@/lib/auth";
import { addPurchasedTranscriptionSeconds, getTranscriptionBalanceSummary } from "@/lib/transcriptionCredits";
import { verifyFlutterwaveTransaction, isFlutterwaveConfigured } from "@/lib/flutterwave";
import clientPromise from "@/lib/mongodb";
import { reportPaymentToTelegram } from "@/lib/paymentTelegramNotifications";

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "";
const PAYSTACK_API = "https://api.paystack.co";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Device-Id, X-Device-Secret, Authorization",
};

function reportTopup(input: {
  outcome: "success" | "failed";
  provider: "flutterwave" | "paystack";
  reference: string;
  userId: string;
  email?: unknown;
  name?: unknown;
  seconds?: number;
  amount?: number | null;
  currency?: string | null;
  failureReason?: unknown;
}) {
  reportPaymentToTelegram({
    ...input,
    purchase: "credits",
    credits: input.seconds ? Math.round(input.seconds / 60) : null,
    source: "Top-up verify",
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await getAuthUserFromRequest(req);
    if (!authUser?.mongoUser?._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS_HEADERS });
    }

    const userId = authUser.mongoUser._id.toString();
    const body = (await req.json().catch(() => ({}))) as Record<string, any>;
    const { reference, transactionId } = body;

    if (!reference || typeof reference !== "string") {
      return NextResponse.json({ error: "Missing reference" }, { status: 400, headers: CORS_HEADERS });
    }

    const client = await clientPromise;
    const db = client.db();

    // Check if transaction already credited
    const existingTx = await db.collection("transcription_transactions").findOne({
      requestId: reference,
      type: "credit_purchase",
    });

    if (existingTx) {
      const balance = await getTranscriptionBalanceSummary(userId, authUser.mongoUser);
      return NextResponse.json({
        success: true,
        alreadyProcessed: true,
        balance,
      }, { headers: CORS_HEADERS });
    }

    // Flutterwave verification
    if (reference.startsWith("topup_fw_") || transactionId) {
      const intent = await db.collection("transcription_topup_intents").findOne({ reference });
      const txIdToVerify = transactionId || intent?.providerTransactionId;

      if (txIdToVerify) {
        const verified = await verifyFlutterwaveTransaction(txIdToVerify).catch(() => null);
        if (verified && String(verified.data?.status || "").toLowerCase() === "successful") {
          const txData = verified.data;
          const seconds = Number(intent?.seconds) || 3600;
          const amountPaid = Number(txData?.amount) || Number(intent?.price) || 0;
          const currency = String(txData?.currency || intent?.currency || "NGN");

          const balance = await addPurchasedTranscriptionSeconds({
            userId,
            seconds,
            amountPaid,
            currency,
            reference,
            packId: intent?.packId,
            description: `Verified top-up purchase (${reference}): ${seconds / 3600}h (${seconds / 60} credits)`,
          });

          await db.collection("transcription_topup_intents").updateOne(
            { reference },
            { $set: { status: "SUCCESSFUL", providerTransactionId: txIdToVerify, updatedAt: new Date().toISOString() } }
          );
          reportTopup({
            outcome: "success",
            provider: "flutterwave",
            reference,
            userId,
            email: authUser.mongoUser.email,
            name: authUser.mongoUser.name,
            seconds,
            amount: amountPaid,
            currency,
          });

          return NextResponse.json({
            success: true,
            balance,
          }, { headers: CORS_HEADERS });
        }
        const fwStatus = String(verified?.data?.status || "").toLowerCase();
        if (["failed", "cancelled", "canceled"].includes(fwStatus)) {
          reportTopup({
            outcome: "failed",
            provider: "flutterwave",
            reference,
            userId,
            email: authUser.mongoUser.email,
            name: authUser.mongoUser.name,
            seconds: Number(intent?.seconds) || undefined,
            amount: Number(intent?.price) || null,
            currency: intent?.currency ? String(intent.currency) : null,
            failureReason: `Flutterwave payment ${fwStatus}.`,
          });
        }
      }

      // If intent exists and has been marked successful by webhook
      if (intent?.status === "SUCCESSFUL") {
        const seconds = Number(intent.seconds) || 3600;
        const balance = await addPurchasedTranscriptionSeconds({
          userId,
          seconds,
          amountPaid: Number(intent.price) || 0,
          currency: String(intent.currency || "NGN"),
          reference,
          packId: intent.packId,
          description: `Verified top-up purchase (${reference}): ${seconds / 3600}h (${seconds / 60} credits)`,
        });
        reportTopup({
          outcome: "success",
          provider: "flutterwave",
          reference,
          userId,
          email: authUser.mongoUser.email,
          name: authUser.mongoUser.name,
          seconds,
          amount: Number(intent.price) || 0,
          currency: String(intent.currency || "NGN"),
        });

        return NextResponse.json({
          success: true,
          balance,
        }, { headers: CORS_HEADERS });
      }
    }

    if (!PAYSTACK_SECRET_KEY) {
      return NextResponse.json({ error: "Payment gateway unconfigured" }, { status: 503, headers: CORS_HEADERS });
    }

    const verifyRes = await fetch(`${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
    });

    const verifyData = (await verifyRes.json()) as any;
    if (!verifyData.status || verifyData.data?.status !== "success") {
      const failedStatus = String(verifyData.data?.status || "").toLowerCase();
      if (["failed", "abandoned", "reversed"].includes(failedStatus)) {
        const failedMetadata = verifyData.data.metadata || {};
        reportTopup({
          outcome: "failed",
          provider: "paystack",
          reference,
          userId,
          email: authUser.mongoUser.email,
          name: authUser.mongoUser.name,
          seconds: Number(failedMetadata.seconds) || (Number(failedMetadata.hours) * 3600) || (Number(failedMetadata.credits) * 60) || undefined,
          amount: (Number(verifyData.data.amount) || 0) / 100,
          currency: verifyData.data.currency || null,
          failureReason: verifyData.data.gateway_response || `Payment ${failedStatus}`,
        });
      }
      return NextResponse.json({
        success: false,
        error: verifyData.data?.gateway_response || "Payment not completed or failed",
      }, { status: 400, headers: CORS_HEADERS });
    }

    const txData = verifyData.data;
    const metadata = txData.metadata || {};
    const seconds = Number(metadata.seconds) || (Number(metadata.hours) * 3600) || (Number(metadata.credits) * 60) || 0;
    const amountPaid = (Number(txData.amount) || 0) / 100;
    const currency = txData.currency || "NGN";

    if (seconds <= 0) {
      return NextResponse.json({ error: "Invalid transaction seconds metadata" }, { status: 400, headers: CORS_HEADERS });
    }

    const balance = await addPurchasedTranscriptionSeconds({
      userId,
      seconds,
      amountPaid,
      currency,
      reference,
      packId: metadata.packId,
      description: `Verified top-up purchase (${reference}): ${seconds / 3600}h (${seconds / 60} credits)`,
    });
    reportTopup({
      outcome: "success",
      provider: "paystack",
      reference,
      userId,
      email: authUser.mongoUser.email,
      name: authUser.mongoUser.name,
      seconds,
      amount: amountPaid,
      currency,
    });

    return NextResponse.json({
      success: true,
      balance,
    }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[api/transcription/topup/verify] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
}
