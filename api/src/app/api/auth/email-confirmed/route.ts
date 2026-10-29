import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import clientPromise from "@/lib/mongodb";
import { getPlanConfig } from "@/lib/db";
import { getTrialForUser } from "@/lib/trialRecords";
import { claimTrialForUserIfEligible } from "@/lib/trialAbuse";
import { getPlatformSettings } from "@/lib/platformSettings";
import { processVerifiedSignupZohoSync } from "@/lib/zohoSignupSync";

export async function POST(req: NextRequest) {
  try {
    const authUser = await getAuthUser();
    if (!authUser?.mongoUser?._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { mongoUser } = authUser;

    // Idempotent — already activated
    if (mongoUser.emailVerified === true) {
      const trialRecord = await getTrialForUser(mongoUser._id.toString());
      const trial = trialRecord
        ? { endsAt: trialRecord.endsAt, durationDays: trialRecord.durationDays }
        : mongoUser.trial
          ? { endsAt: mongoUser.trial.endsAt, durationDays: mongoUser.trial.durationDays }
          : null;
      return NextResponse.json({
        success: true,
        alreadyVerified: true,
        trial,
        activationRequired: mongoUser.trialExperiment?.activationRequired === true && !trialRecord,
      });
    }

    // Atomic activation: verify email + ensure trial exists
    // Don't change plan — it stays "free" during trial so isOnTrial works
    const now = new Date();
    const updateFields: Record<string, any> = {
      emailVerified: true,
      emailVerifiedAt: now.toISOString(),
    };

    // Only create a trial if the user doesn't already have one
    // (handles pre-trial-system users who never got a trial at signup)
    // Trial creation is wrapped in try/catch so email verification always
    // succeeds even if trial provisioning fails (e.g. null trial field).
    let trialRecord = await getTrialForUser(mongoUser._id.toString());
    let trialData: { endsAt: string; durationDays: number } | null = null;
    let trialClaimResult: Awaited<ReturnType<typeof claimTrialForUserIfEligible>> | null = null;

    if (!trialRecord) {
      try {
        trialClaimResult = await claimTrialForUserIfEligible({
          userId: mongoUser._id.toString(),
          email: mongoUser.email,
          req,
          source: "email_confirmed",
        });
        trialRecord = trialClaimResult.trialRecord;
        if (!trialClaimResult.eligible) {
          console.warn("[email-confirmed] Trial not granted:", {
            userId: mongoUser._id.toString(),
            reason: trialClaimResult.reason,
            matchedSignalTypes: trialClaimResult.matchedSignalTypes,
          });
        }
      } catch (trialErr) {
        console.error("[email-confirmed] Failed to create trial (non-fatal):", trialErr);
      }
    }

    if (trialRecord) {
      trialData = { endsAt: trialRecord.endsAt, durationDays: trialRecord.durationDays };
      const planConfig = await getPlanConfig();
      updateFields.credits = planConfig.plans.trial.credits;
    }

    const client = await clientPromise;
    const db = client.db();
    await db.collection("users").updateOne(
      { _id: mongoUser._id },
      { $set: updateFields }
    );

    const platformSettings = await getPlatformSettings();
    let zohoWelcomeResult: Awaited<ReturnType<typeof processVerifiedSignupZohoSync>> | null = null;
    if (platformSettings.notifications.welcomeEmail) {
      try {
        zohoWelcomeResult = await processVerifiedSignupZohoSync(mongoUser._id);
      } catch (zohoError) {
        console.error("[email-confirmed] Zoho enrollment will be retried:", {
          error: zohoError instanceof Error ? zohoError.name : "unknown_error",
        });
      }
    }

    // Send Welcome email (Email 2) immediately — trial activation (Email 3)
    // is sent separately 5–10 minutes later by the lifecycle cron.
    if (platformSettings.notifications.welcomeEmail && zohoWelcomeResult?.status === "disabled" && trialData) {
      try {
        const { sendEmail, welcomeEmail } = await import(
          "@/lib/emailTemplates"
        );
        await sendEmail(
          welcomeEmail({
            userName: mongoUser.name || "",
            userEmail: mongoUser.email,
            trialDays: trialData.durationDays ?? 30,
            trialEndsAt: trialData.endsAt ?? "",
            custom: platformSettings.notifications,
          })
        );
        await db.collection("users").updateOne(
          { _id: mongoUser._id },
          { $set: { "lifecycleEmails.welcomeSent": true } },
        );
      } catch {
        /* email not critical */
      }
    } else if (
      platformSettings.notifications.welcomeEmail &&
      zohoWelcomeResult?.status === "disabled" &&
      trialClaimResult?.reason === "activation_required"
    ) {
      try {
        const { sendEmail, activationRequiredWelcomeEmail } = await import(
          "@/lib/emailTemplates"
        );
        await sendEmail(
          activationRequiredWelcomeEmail({
            userName: mongoUser.name || "there",
            userEmail: mongoUser.email,
            trialDays: trialClaimResult.assignment?.durationDays || 30,
            custom: platformSettings.notifications,
          })
        );
        await db.collection("users").updateOne(
          { _id: mongoUser._id },
          { $set: { "lifecycleEmails.welcomeSent": true } },
        );
      } catch {
        /* email not critical */
      }
    }

    return NextResponse.json({
      success: true,
      trial: trialData,
      activationRequired: trialClaimResult?.reason === "activation_required",
    });
  } catch (err) {
    console.error("[email-confirmed] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
