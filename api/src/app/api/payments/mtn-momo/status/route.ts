import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { getAuthUserFromRequest } from "@/lib/auth";
import { getMtnMomoRequestStatus, MtnMomoError } from "@/lib/mtnMomo";
import { completeMtnMomoPayment } from "@/lib/completeMtnMomoPayment";
import { rateLimit } from "@/lib/rateLimit";
import { paymentDetailsFromIntent, reportPaymentToTelegram } from "@/lib/paymentTelegramNotifications";

function reportFailure(intent: Record<string, any>, reference: string, failureReason: string) {
  reportPaymentToTelegram(paymentDetailsFromIntent(intent, {
    outcome: "failed",
    provider: "mtn_momo",
    reference,
    failureReason,
    source: "MTN MoMo status check",
  }));
}

const limiter = rateLimit({ windowMs: 60_000, max: 60 });

function pendingResponse(reference: string, reason?: string) {
  return NextResponse.json({
    success: false,
    paymentMethod: "mtn_momo",
    reference,
    status: "PENDING",
    ...(reason ? { message: reason } : {}),
  });
}

export async function GET(req: NextRequest) {
  try {
    const rateResult = limiter.check(req);
    if (!rateResult.ok) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const authUser = await getAuthUserFromRequest(req);
    if (!authUser?.mongoUser?._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const reference = String(req.nextUrl.searchParams.get("reference") || "").trim();
    if (!reference || reference.length > 80) {
      return NextResponse.json({ error: "Payment reference is required" }, { status: 400 });
    }

    const userId = authUser.mongoUser._id.toString();
    const db = (await clientPromise).db();
    const intents = db.collection<any>("momo_payment_intents");
    const intent = await intents.findOne({ _id: reference, userId });
    if (!intent) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    if (intent.status === "SUCCESSFUL" && intent.result) {
      return NextResponse.json({
        ...intent.result,
        success: true,
        paymentMethod: "mtn_momo",
        status: "SUCCESSFUL",
        reference,
      });
    }
    if (intent.status === "FAILED") {
      return NextResponse.json({
        success: false,
        paymentMethod: "mtn_momo",
        reference,
        status: "FAILED",
        error: intent.failureReason || "MTN MoMo payment failed.",
      }, { status: 402 });
    }
    if (intent.status === "PROCESSING") {
      return pendingResponse(reference);
    }

    if (intent.expiresAt && new Date(intent.expiresAt).getTime() <= Date.now()) {
      await intents.updateOne(
        { _id: reference, userId, status: "PENDING" },
        { $set: { status: "FAILED", failureReason: "Payment request expired.", updatedAt: new Date().toISOString() } },
      );
      reportFailure(intent, reference, "Payment request expired.");
      return NextResponse.json({
        success: false,
        paymentMethod: "mtn_momo",
        reference,
        status: "FAILED",
        error: "The MTN MoMo payment request expired. Please start again.",
      }, { status: 402 });
    }

    const provider = await getMtnMomoRequestStatus(reference);
    if (provider.status === "PENDING") {
      await intents.updateOne(
        { _id: reference, userId, status: "PENDING" },
        { $set: { providerStatus: provider.status, updatedAt: new Date().toISOString() } },
      );
      return pendingResponse(reference, "Approve the request on your MTN MoMo phone.");
    }

    if (provider.status === "FAILED") {
      await intents.updateOne(
        { _id: reference, userId, status: "PENDING" },
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
      return NextResponse.json({
        success: false,
        paymentMethod: "mtn_momo",
        reference,
        status: "FAILED",
        error: provider.reason || "MTN MoMo declined the payment.",
      }, { status: 402 });
    }

    if (provider.amount && Number(provider.amount) !== Number(intent.amount)) {
      await intents.updateOne(
        { _id: reference, userId, status: "PENDING" },
        { $set: { status: "FAILED", failureReason: "Payment amount mismatch.", updatedAt: new Date().toISOString() } },
      );
      reportFailure(intent, reference, "Payment amount mismatch.");
      return NextResponse.json({ error: "Payment amount could not be verified" }, { status: 502 });
    }
    if (provider.currency && String(provider.currency).toUpperCase() !== String(intent.currency).toUpperCase()) {
      await intents.updateOne(
        { _id: reference, userId, status: "PENDING" },
        { $set: { status: "FAILED", failureReason: "Payment currency mismatch.", updatedAt: new Date().toISOString() } },
      );
      reportFailure(intent, reference, "Payment currency mismatch.");
      return NextResponse.json({ error: "Payment currency could not be verified" }, { status: 502 });
    }

    const claim = await intents.updateOne(
      { _id: reference, userId, status: "PENDING" },
      { $set: { status: "PROCESSING", providerStatus: provider.status, updatedAt: new Date().toISOString() } },
    );
    if (claim.modifiedCount !== 1) {
      const latest = await intents.findOne({ _id: reference, userId });
      if (latest?.status === "SUCCESSFUL" && latest.result) {
        return NextResponse.json({
          ...latest.result,
          success: true,
          paymentMethod: "mtn_momo",
          status: "SUCCESSFUL",
          reference,
        });
      }
      return pendingResponse(reference);
    }

    try {
      const result = await completeMtnMomoPayment({
        providerReference: reference,
        userId,
        email: String(intent.email || authUser.mongoUser.email || ""),
        amount: Number(intent.amount),
        currency: String(intent.currency),
        metadata: (intent.metadata || {}) as Record<string, any>,
      });
      await intents.updateOne(
        { _id: reference, userId },
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
      return NextResponse.json({
        ...result,
        success: true,
        paymentMethod: "mtn_momo",
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
    if (error instanceof MtnMomoError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[MTN MoMo Status] Error:", error);
    return NextResponse.json({ error: "Could not check the MTN MoMo payment." }, { status: 500 });
  }
}
