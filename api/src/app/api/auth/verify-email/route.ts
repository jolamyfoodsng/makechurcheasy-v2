import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import clientPromise from "@/lib/mongodb";
import { claimTrialForUserIfEligible } from "@/lib/trialAbuse";
import { rateLimit } from "@/lib/rateLimit";
import { getPlanConfig } from "@/lib/db";
import { getPlatformSettings } from "@/lib/platformSettings";
import { sendEmail, welcomeEmail } from "@/lib/emailTemplates";
import { processVerifiedSignupZohoSync } from "@/lib/zohoSignupSync";
import { getTrialForUser } from "@/lib/trialRecords";

const limiter = rateLimit({ windowMs: 60_000, max: 10 });
const MAX_ATTEMPTS = 5;

export async function POST(req: NextRequest) {
  const rl = limiter.check(req);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429 }
    );
  }

  try {
    const { email, code } = (await req.json()) as {
      email?: string;
      code?: string;
    };

    if (!email || !code) {
      return NextResponse.json(
        { error: "Email and code are required" },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const trimmedCode = code.trim();

    if (!/^\d{6}$/.test(trimmedCode)) {
      return NextResponse.json(
        { error: "Invalid code format" },
        { status: 400 }
      );
    }

    const client = await clientPromise;
    const db = client.db();

    const user = await db.collection("users").findOne(
      { email: normalizedEmail },
      { collation: { locale: "en", strength: 2 } }
    );

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Already verified
    if (user.emailVerified) {
      // Clean up any leftover verification fields
      await db.collection("users").updateOne(
        { _id: user._id },
        {
          $unset: {
            emailVerificationCode: "",
            emailVerificationExpiresAt: "",
            emailVerificationAttempts: "",
          },
        }
      );
      return NextResponse.json({ success: true, message: "Email already verified" });
    }

    // Check if verification code exists
    if (!user.emailVerificationCode || !user.emailVerificationExpiresAt) {
      return NextResponse.json(
        { error: "No verification code found. Please request a new one." },
        { status: 400 }
      );
    }

    // Check expiry
    if (new Date(user.emailVerificationExpiresAt) <= new Date()) {
      // Clear expired code
      await db.collection("users").updateOne(
        { _id: user._id },
        {
          $unset: {
            emailVerificationCode: "",
            emailVerificationExpiresAt: "",
            emailVerificationAttempts: "",
          },
        }
      );
      return NextResponse.json(
        { error: "Code expired. Please request a new one." },
        { status: 410 }
      );
    }

    // Check attempts
    const attempts = user.emailVerificationAttempts || 0;
    if (attempts >= MAX_ATTEMPTS) {
      // Too many attempts — clear code, force regeneration
      await db.collection("users").updateOne(
        { _id: user._id },
        {
          $unset: {
            emailVerificationCode: "",
            emailVerificationExpiresAt: "",
            emailVerificationAttempts: "",
          },
        }
      );
      return NextResponse.json(
        { error: "Too many failed attempts. Please request a new code." },
        { status: 429 }
      );
    }

    // Verify code
    const valid = await bcrypt.compare(trimmedCode, user.emailVerificationCode);
    if (!valid) {
      // Increment attempts
      await db.collection("users").updateOne(
        { _id: user._id },
        { $inc: { emailVerificationAttempts: 1 } }
      );
      const remaining = MAX_ATTEMPTS - attempts - 1;
      return NextResponse.json(
        {
          error: "Invalid code. Please try again.",
          attemptsRemaining: remaining,
        },
        { status: 401 }
      );
    }

    // Code valid — mark email as verified and clear verification fields
    const verifiedAt = new Date().toISOString();
    await db.collection("users").updateOne(
      { _id: user._id },
      {
        $set: { emailVerified: true, emailVerifiedAt: verifiedAt },
        $unset: {
          emailVerificationCode: "",
          emailVerificationExpiresAt: "",
          emailVerificationAttempts: "",
        },
      }
    );

    // Auto-provision trial if the user doesn't have one
    let trialForWelcome: { endsAt: string; durationDays: number } | null = null;
    if (!user.trialId && (!user.plan || user.plan === "free")) {
      try {
        const trialClaim = await claimTrialForUserIfEligible({
          userId: user._id.toString(),
          email: user.email,
          req,
          source: "verify_email",
        });
        const record = trialClaim.trialRecord;
        if (record) {
          trialForWelcome = { endsAt: record.endsAt, durationDays: record.durationDays };
          const planConfig = await getPlanConfig();
          await db.collection("users").updateOne(
            { _id: user._id },
            {
              $set: {
                trialId: record._id?.toString(),
                credits: planConfig.plans.trial.credits,
              },
            }
          );
        } else if (!trialClaim.eligible) {
          console.warn("[verify-email] Trial not granted:", {
            userId: user._id.toString(),
            reason: trialClaim.reason,
            matchedSignalTypes: trialClaim.matchedSignalTypes,
          });
        }
      } catch (err) {
        console.error("[verify-email] Failed to create trial:", err);
      }
    } else if (user.trialId) {
      const existingTrial = await getTrialForUser(user._id.toString());
      if (existingTrial) {
        trialForWelcome = {
          endsAt: existingTrial.endsAt,
          durationDays: existingTrial.durationDays,
        };
      }
    } else if (user.trial?.endsAt) {
      trialForWelcome = {
        endsAt: user.trial.endsAt,
        durationDays: user.trial.durationDays || 30,
      };
    }

    const platformSettings = await getPlatformSettings();
    const welcomeEmailEnabled = platformSettings.notifications.welcomeEmail;
    let zohoWelcomeResult: Awaited<ReturnType<typeof processVerifiedSignupZohoSync>> | null = null;
    if (welcomeEmailEnabled) {
      try {
        zohoWelcomeResult = await processVerifiedSignupZohoSync(user._id);
      } catch (zohoError) {
        console.error("[verify-email] Zoho enrollment will be retried:", {
          error: zohoError instanceof Error ? zohoError.name : "unknown_error",
        });
      }
    }

    if (zohoWelcomeResult?.status === "confirmation-required") {
      console.error("[verify-email] Zoho signup list requires another confirmation; welcome email was not duplicated.");
    } else if (trialForWelcome && welcomeEmailEnabled && zohoWelcomeResult?.status === "disabled") {
      try {
        await sendEmail(
          welcomeEmail({
            userName: user.name || "there",
            userEmail: user.email,
            trialDays: trialForWelcome.durationDays,
            trialEndsAt: trialForWelcome.endsAt,
            custom: platformSettings.notifications,
          })
        );
        await db.collection("users").updateOne(
          { _id: user._id },
          { $set: { "lifecycleEmails.welcomeSent": true } }
        );
      } catch (err) {
        console.error("[verify-email] Failed to send welcome email:", err);
      }
    }

    return NextResponse.json({ success: true, message: "Email verified successfully" });
  } catch (err: any) {
    console.error("[verify-email] Error:", err?.message || err);
    return NextResponse.json({ error: "Failed to verify email" }, { status: 500 });
  }
}
