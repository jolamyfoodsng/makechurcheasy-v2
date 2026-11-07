import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { getAuthUserFromRequest } from "@/lib/auth";
import { COLLECTIONS } from "@/lib/db";
import { completeFlutterwavePayment } from "@/lib/completeMtnMomoPayment";
import {
  FlutterwaveError,
  verifyFlutterwaveTransaction,
} from "@/lib/flutterwave";
import { rateLimit } from "@/lib/rateLimit";
import { paymentDetailsFromIntent, reportPaymentToTelegram } from "@/lib/paymentTelegramNotifications";

const limiter = rateLimit({ windowMs: 60_000, max: 60 });

function pendingResponse(reference: string, message?: string) {
  return NextResponse.json({
    success: false,
    paymentMethod: "flutterwave",
    reference,
    status: "PENDING",
    ...(message ? { message } : {}),
  }, { status: 202 });
}

function failureResponse(reference: string, error: string, status = 402) {
  return NextResponse.json({
    success: false,
    paymentMethod: "flutterwave",
    reference,
    status: "FAILED",
    error,
  }, { status });
}

function reportFailure(intent: Record<string, any>, reference: string, failureReason: string) {
  reportPaymentToTelegram(paymentDetailsFromIntent(intent, {
    outcome: "failed",
    provider: "flutterwave",
    reference,
    failureReason,
    source: "Flutterwave status check",
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

export async function GET(req: NextRequest) {
  try {
    const rateResult = limiter.check(req);
    if (!rateResult.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    const authUser = await getAuthUserFromRequest(req);
    if (!authUser?.mongoUser?._id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const query = req.nextUrl.searchParams;
    const reference = String(query.get("reference") || query.get("tx_ref") || "").trim();
    const transactionId = String(query.get("transaction_id") || "").trim();
    const providerStatus = String(query.get("status") || "").trim().toLowerCase();
    if (!reference || reference.length > 120) {
      return NextResponse.json({ error: "Payment reference is required" }, { status: 400 });
    }

    const userId = authUser.mongoUser._id.toString();
    const db = (await clientPromise).db();
    const intents = db.collection<any>(COLLECTIONS.FLUTTERWAVE_INTENTS);
    const intent = await intents.findOne({ _id: reference, userId });
    if (!intent) return NextResponse.json({ error: "Payment not found" }, { status: 404 });

    if (intent.status === "SUCCESSFUL" && intent.result) {
      return NextResponse.json({
        ...intent.result,
        success: true,
        paymentMethod: "flutterwave",
        status: "SUCCESSFUL",
        reference,
      });
    }
    if (intent.status === "FAILED") {
      return failureResponse(reference, intent.failureReason || "Flutterwave payment failed.");
    }
    if (intent.status === "PROCESSING") return pendingResponse(reference);
    if (intent.expiresAt && new Date(intent.expiresAt).getTime() <= Date.now()) {
      await intents.updateOne(
        { _id: reference, userId, status: { $in: ["PENDING", "CREATING"] } },
        { $set: { status: "FAILED", failureReason: "Payment session expired.", updatedAt: new Date().toISOString() } },
      );
      reportFailure(intent, reference, "Payment session expired.");
      return failureResponse(reference, "The Flutterwave payment session expired. Please start again.");
    }
    if (providerStatus === "failed" || providerStatus === "cancelled" || providerStatus === "canceled") {
      await intents.updateOne(
        { _id: reference, userId, status: { $in: ["PENDING", "CREATING"] } },
        {
          $set: {
            status: "FAILED",
            failureReason: "Flutterwave payment was cancelled before completion.",
            providerStatus,
            updatedAt: new Date().toISOString(),
          },
        },
      );
      reportFailure(intent, reference, `Flutterwave payment ${providerStatus} before completion.`);
      return failureResponse(reference, "The Flutterwave payment was not completed.");
    }
    if (!transactionId) {
      return pendingResponse(reference, "Waiting for Flutterwave to return the transaction.");
    }

    const provider = await verifyFlutterwaveTransaction(transactionId);
    const data = provider.data;
    const status = String(data?.status || "").trim().toLowerCase();
    const expectedReference = String(intent.expectedTxRef || intent.reference || intent._id || "").trim();
    const expectedAmount = intent.expectedAmount ?? intent.amount;
    const expectedCurrency = intent.expectedCurrency || intent.currency;
    if (String(provider.status || "").toLowerCase() !== "success" || status !== "successful") {
      if (status === "failed" || status === "cancelled") {
        reportFailure(intent, reference, `Flutterwave reported the payment as ${status}.`);
        return failureResponse(reference, "The Flutterwave payment was not completed.");
      }
      return pendingResponse(reference, "Flutterwave is still confirming the payment.");
    }
    if (String(data?.tx_ref || data?.reference || "").trim() !== expectedReference) {
      reportFailure(intent, reference, "Payment reference could not be verified.");
      return failureResponse(reference, "Payment reference could not be verified.", 502);
    }
    if (!amountMatchesExpected(data?.amount, expectedAmount)) {
      reportFailure(intent, reference, "Payment amount could not be verified.");
      return failureResponse(reference, "Payment amount could not be verified.", 502);
    }
    if (!currencyMatches(data?.currency, expectedCurrency)) {
      reportFailure(intent, reference, "Payment currency could not be verified.");
      return failureResponse(reference, "Payment currency could not be verified.", 502);
    }

    const claim = await intents.updateOne(
      { _id: reference, userId, status: { $in: ["PENDING", "CREATING"] } },
      {
        $set: {
          status: "PROCESSING",
          providerTransactionId: transactionId,
          providerStatus: status,
          updatedAt: new Date().toISOString(),
        },
      },
    );
    if (claim.modifiedCount !== 1) {
      const latest = await intents.findOne({ _id: reference, userId });
      if (latest?.status === "SUCCESSFUL" && latest.result) {
        return NextResponse.json({
          ...latest.result,
          success: true,
          paymentMethod: "flutterwave",
          status: "SUCCESSFUL",
          reference,
        });
      }
      return pendingResponse(reference);
    }

    try {
      const result = await completeFlutterwavePayment({
        providerReference: reference,
        userId,
        email: String(intent.email || authUser.mongoUser.email || ""),
        amount: Number(expectedAmount),
        currency: String(expectedCurrency),
        metadata: (intent.metadata || {}) as Record<string, any>,
      });
      await intents.updateOne(
        { _id: reference, userId, status: "PROCESSING" },
        {
          $set: {
            status: "SUCCESSFUL",
            providerTransactionId: transactionId,
            providerPayload: {
              id: data?.id || transactionId,
              status,
              amount: data?.amount,
              currency: data?.currency,
              reference: data?.tx_ref || data?.reference,
            },
            result,
            completedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
      );
      return NextResponse.json({
        ...result,
        success: true,
        paymentMethod: "flutterwave",
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
    if (error instanceof FlutterwaveError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[Flutterwave Status] Error:", error);
    return NextResponse.json({ error: "Could not check the Flutterwave payment." }, { status: 500 });
  }
}
