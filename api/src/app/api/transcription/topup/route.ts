import { NextRequest, NextResponse } from "next/server";
import { getAuthUserFromRequest } from "@/lib/auth";
import { calculateTopupPricing } from "@/lib/transcriptionCredits";
import { getSubscription } from "@/lib/db";
import { createFlutterwavePayment, isFlutterwaveConfigured } from "@/lib/flutterwave";
import clientPromise from "@/lib/mongodb";
import { reportPaymentToTelegram } from "@/lib/paymentTelegramNotifications";
import * as crypto from "node:crypto";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Device-Id, X-Device-Secret, Authorization",
};

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
    const email = authUser.mongoUser.email;
    const body = (await req.json().catch(() => ({}))) as Record<string, any>;
    const { packId, returnUrl } = body;

    if (!packId || typeof packId !== "string") {
      return NextResponse.json({ error: "Missing packId" }, { status: 400, headers: CORS_HEADERS });
    }

    const sub = await getSubscription(userId);
    const currency = sub?.currency || "NGN";

    const pricing = await calculateTopupPricing(currency);
    const selectedPack = pricing.packages.find((p) => p.id === packId);

    if (!selectedPack) {
      return NextResponse.json({ error: `Package ${packId} not found` }, { status: 404, headers: CORS_HEADERS });
    }

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:4000").replace(/\/$/, "");

    // Prioritize Flutterwave
    if (isFlutterwaveConfigured()) {
      const reference = `topup_fw_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
      const callbackUrl = returnUrl || `${appUrl}/credits?topup=success&reference=${reference}`;

      const db = (await clientPromise).db();
      await db.collection("transcription_topup_intents").insertOne({
        _id: reference as any,
        reference,
        userId,
        email,
        packId: selectedPack.id,
        seconds: selectedPack.seconds,
        hours: selectedPack.hours,
        credits: selectedPack.credits,
        price: selectedPack.price,
        currency: selectedPack.currency,
        status: "PENDING",
        createdAt: new Date().toISOString(),
      });

      let paymentUrl = "";
      try {
        const payment = await createFlutterwavePayment({
          amount: selectedPack.price,
          currency: selectedPack.currency,
          txRef: reference,
          email,
          name: String((authUser.mongoUser as any)?.name || "").trim() || undefined,
          redirectUrl: callbackUrl,
          description: `MakeChurchEazy ${selectedPack.hours}h (${selectedPack.credits} credits) Top-up`,
          metadata: {
            type: "transcription_topup",
            userId,
            packId: selectedPack.id,
            hours: selectedPack.hours,
            credits: selectedPack.credits,
            seconds: selectedPack.seconds,
            price: selectedPack.price,
            currency: selectedPack.currency,
          },
        });

        paymentUrl = String(payment.data?.link || "").trim();
        if (!paymentUrl) {
          throw new Error("Flutterwave did not return a payment link");
        }
      } catch (error) {
        const failureReason = error instanceof Error ? error.message : "Flutterwave payment creation failed";
        await db.collection("transcription_topup_intents").updateOne(
          { reference },
          { $set: { status: "FAILED", failureReason, updatedAt: new Date().toISOString() } },
        );
        reportPaymentToTelegram({
          outcome: "failed",
          provider: "flutterwave",
          reference,
          userId,
          name: authUser.mongoUser.name,
          email,
          purchase: "credits",
          credits: selectedPack.credits,
          amount: selectedPack.price,
          currency: selectedPack.currency,
          failureReason,
          source: "Top-up checkout start",
        });
        throw error;
      }

      return NextResponse.json(
        {
          authorization_url: paymentUrl,
          reference,
          amount: Math.round(selectedPack.price * 100),
          package: selectedPack,
        },
        { headers: CORS_HEADERS },
      );
    }

    return NextResponse.json(
      { error: "Flutterwave is not configured" },
      { status: 503, headers: CORS_HEADERS },
    );
  } catch (error) {
    console.error("[api/transcription/topup] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
}
