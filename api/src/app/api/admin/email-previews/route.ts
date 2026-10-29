import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { renderEmailHtml } from "@/lib/emailBranding";
import { getPlatformSettings } from "@/lib/platformSettings";
import {
  adminManagedSubscriptionEmail,
  adminTemporaryPlanEndedEmail,
  adminTemporaryPlanGrantedEmail,
  ambassadorWelcomeEmail,
  emailChangeConfirmedEmail,
  emailChangeNotificationEmail,
  emailChangeVerificationEmail,
  loginCodeEmail,
  migrationEmail,
  newDeviceLoginEmail,
  passwordChangedEmail,
  passwordResetEmail,
  paymentFailedEmail,
  paymentReceiptEmail,
  planUpgradeEmail,
  reEngagementEmail,
  subscriptionActivatedEmail,
  subscriptionCancelledEmail,
  subscriptionExpiringSoonEmail,
  subscriptionRenewedEmail,
  trial1DayRemainingEmail,
  trialActivatedEmail,
  trialDay1ActivationEmail,
  trialDay3FeatureDiscoveryEmail,
  trialDay5FeatureDrivingEmail,
  trialEndingSoonEmail,
  trialExpiredEmail,
  verificationCodeEmail,
  verificationEmail,
  welcomeEmail,
  sendEmail,
} from "@/lib/emailTemplates";

type EmailPreview = {
  id: string;
  name: string;
  category: string;
  description: string;
  trigger: string;
  to: string;
  subject: string;
  html: string;
};

const SAMPLE_USER = {
  userName: "Sample User",
  userEmail: "tayo@example.com",
};

const SAMPLE_DATES = {
  trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  subscriptionEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  temporaryAccessEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
  paidAt: new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }),
};

function preview(
  id: string,
  name: string,
  category: string,
  description: string,
  trigger: string,
  email: { to: string; subject: string; html: string },
): EmailPreview {
  return { id, name, category, description, trigger, ...email };
}

function withRecipient(email: { to: string; subject: string; html: string }, to = SAMPLE_USER.userEmail) {
  return { ...email, to: email.to || to };
}

async function buildEmailPreviews(): Promise<EmailPreview[]> {
  const { notifications } = await getPlatformSettings();
  const previews = [
    preview(
      "login-code",
      "Login code",
      "Auth",
      "One-time code for signing in.",
      "Email login request",
      withRecipient(loginCodeEmail("482913")),
    ),
    preview(
      "email-verification-link",
      "Email verification link",
      "Auth",
      "Button-based email verification.",
      "Legacy verification link flow",
      withRecipient(verificationEmail("https://makechurcheazy.com/verify-email?token=sample-token")),
    ),
    preview(
      "email-verification-code",
      "Email verification code",
      "Auth",
      "Numeric code for account verification.",
      "Signup / resend verification code",
      withRecipient(verificationCodeEmail("918274")),
    ),
    preview(
      "welcome",
      "Welcome",
      "Auth",
      "Sent after email verification and trial activation.",
      "Email confirmed",
      welcomeEmail({
        ...SAMPLE_USER,
        trialDays: 14,
        trialEndsAt: SAMPLE_DATES.trialEndsAt,
        custom: notifications,
      }),
    ),
    preview(
      "password-reset",
      "Password reset",
      "Auth",
      "Password reset link.",
      "Forgot password",
      withRecipient(passwordResetEmail("https://makechurcheazy.com/reset-password?token=sample-token")),
    ),
    preview(
      "migration-password",
      "Set password after migration",
      "Auth",
      "Sent to users migrating from social login to password login.",
      "Account migration",
      withRecipient(migrationEmail("https://makechurcheazy.com/migrate-account?token=sample-token")),
    ),
    preview(
      "password-changed",
      "Password changed",
      "Security",
      "Security notice after password update.",
      "Password changed",
      passwordChangedEmail({ ...SAMPLE_USER, changedBy: "reset" }),
    ),
    preview(
      "email-change-verification",
      "Verify new email",
      "Security",
      "Verifies a requested email address change.",
      "Email change requested",
      emailChangeVerificationEmail("new-email@example.com", "sample-email-change-token"),
    ),
    preview(
      "email-change-notification",
      "Email changed notice",
      "Security",
      "Notice sent to the previous email address.",
      "Email change confirmed",
      emailChangeNotificationEmail("old-email@example.com", "new-email@example.com"),
    ),
    preview(
      "email-change-confirmed",
      "Email update confirmed",
      "Security",
      "Confirmation sent to the new email address.",
      "New email verified",
      emailChangeConfirmedEmail("new-email@example.com"),
    ),
    preview(
      "new-device-login",
      "New device connected",
      "Security",
      "Security notice when a new desktop device is paired.",
      "Device pairing",
      newDeviceLoginEmail({
        ...SAMPLE_USER,
        deviceName: "Tayo's MacBook Pro",
        deviceOs: "macOS",
        loginTime: new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }),
      }),
    ),
    preview(
      "subscription-activated",
      "Subscription activated",
      "Billing",
      "Plan activation / checkout success.",
      "Payment verification",
      subscriptionActivatedEmail({
        ...SAMPLE_USER,
        planName: "Growth",
        billingCycle: "Monthly",
        credits: 2000,
        expiresAt: SAMPLE_DATES.subscriptionEndsAt,
        amountPaid: "$29",
      }),
    ),
    preview(
      "subscription-renewed",
      "Subscription renewed",
      "Billing",
      "Sent after successful renewal.",
      "Subscription renewal",
      subscriptionRenewedEmail({
        ...SAMPLE_USER,
        planName: "Growth",
        expiresAt: SAMPLE_DATES.subscriptionEndsAt,
        amountPaid: "$29",
      }),
    ),
    preview(
      "admin-managed-subscription",
      "Admin-managed subscription",
      "Billing",
      "Sent when an admin activates paid access manually.",
      "Admin subscription grant",
      adminManagedSubscriptionEmail({
        ...SAMPLE_USER,
        planName: "Growth",
        billingCycle: "Monthly",
        mode: "started",
        expiresAt: SAMPLE_DATES.subscriptionEndsAt,
        amountPaid: "NGN 25,000",
        paymentReference: "vc_sample_reference",
      }),
    ),
    preview(
      "subscription-cancelled",
      "Subscription cancelled",
      "Billing",
      "Cancellation confirmation.",
      "Subscription cancelled",
      subscriptionCancelledEmail({
        ...SAMPLE_USER,
        planName: "Growth",
        expiresAt: SAMPLE_DATES.subscriptionEndsAt,
      }),
    ),
    preview(
      "payment-failed",
      "Payment failed",
      "Billing",
      "Failed renewal/payment notice.",
      "Payment provider failure",
      paymentFailedEmail({ ...SAMPLE_USER, planName: "Growth" }),
    ),
    preview(
      "subscription-expiring-soon",
      "Subscription expiring soon",
      "Billing",
      "Warns a user before paid access expires.",
      "Lifecycle cron",
      subscriptionExpiringSoonEmail({
        ...SAMPLE_USER,
        planName: "Growth",
        expiresAt: SAMPLE_DATES.subscriptionEndsAt,
        daysLeft: 5,
      }),
    ),
    preview(
      "payment-receipt",
      "Payment receipt",
      "Billing",
      "Receipt for successful payment.",
      "Payment verification / renewal",
      paymentReceiptEmail({
        ...SAMPLE_USER,
        planName: "Growth",
        amount: "$29",
        billingCycle: "Monthly",
        paidAt: SAMPLE_DATES.paidAt,
        receiptNumber: "MCE-2026-0001",
      }),
    ),
    preview(
      "plan-upgrade",
      "Plan upgrade",
      "Billing",
      "Sent when a user moves to a higher plan.",
      "Plan upgrade",
      planUpgradeEmail({
        ...SAMPLE_USER,
        fromPlan: "Basic",
        toPlan: "Growth",
        newFeatures: ["2,000 AI credits", "Live translation", "MultiView layouts", "Cloud sync"],
      }),
    ),
    preview(
      "temporary-plan-granted",
      "Temporary plan granted",
      "Admin",
      "Admin-granted temporary plan access.",
      "Admin temporary plan action",
      adminTemporaryPlanGrantedEmail({
        ...SAMPLE_USER,
        previousPlan: "Free",
        newPlan: "Growth",
        expiresAt: SAMPLE_DATES.temporaryAccessEndsAt,
        reason: "Special support access while onboarding.",
      }),
    ),
    preview(
      "temporary-plan-ended",
      "Temporary plan ended",
      "Admin",
      "Sent when admin temporary access expires or is ended.",
      "Temporary access expiry",
      adminTemporaryPlanEndedEmail({
        ...SAMPLE_USER,
        endedPlan: "Growth",
        reason: "expired",
      }),
    ),
    preview(
      "ambassador-welcome",
      "Ambassador welcome",
      "Admin",
      "Welcome email for the ambassador program.",
      "Ambassador activation",
      withRecipient(ambassadorWelcomeEmail({
        name: SAMPLE_USER.userName,
        credits: 10000,
        expiresAt: new Date(SAMPLE_DATES.subscriptionEndsAt).toLocaleDateString("en-US"),
      })),
    ),
    preview(
      "trial-activated",
      "Trial activated",
      "Trial",
      "Sent when the Growth trial begins.",
      "Trial activation",
      trialActivatedEmail({ ...SAMPLE_USER, trialDays: 14, trialEndsAt: SAMPLE_DATES.trialEndsAt }),
    ),
    preview(
      "trial-day-1",
      "Trial day 1 activation",
      "Trial",
      "First trial onboarding email.",
      "Lifecycle cron",
      trialDay1ActivationEmail({ ...SAMPLE_USER, trialDays: 13, trialEndsAt: SAMPLE_DATES.trialEndsAt }),
    ),
    preview(
      "trial-day-3",
      "Trial day 3 feature discovery",
      "Trial",
      "Highlights Speech-to-Scripture.",
      "Lifecycle cron",
      trialDay3FeatureDiscoveryEmail({ ...SAMPLE_USER, trialDays: 11, trialEndsAt: SAMPLE_DATES.trialEndsAt }),
    ),
    preview(
      "trial-day-5",
      "Trial day 5 feature driving",
      "Trial",
      "Highlights popular trial features.",
      "Lifecycle cron",
      trialDay5FeatureDrivingEmail({ ...SAMPLE_USER, trialDays: 9, trialEndsAt: SAMPLE_DATES.trialEndsAt }),
    ),
    preview(
      "trial-ending-soon",
      "Trial ending soon",
      "Trial",
      "Warns before trial end.",
      "Lifecycle cron",
      trialEndingSoonEmail({ ...SAMPLE_USER, trialDays: 3, trialEndsAt: SAMPLE_DATES.trialEndsAt }),
    ),
    preview(
      "trial-one-day-left",
      "Trial ends tomorrow",
      "Trial",
      "Final trial reminder.",
      "Lifecycle cron",
      trial1DayRemainingEmail({ ...SAMPLE_USER, trialDays: 1, trialEndsAt: SAMPLE_DATES.trialEndsAt }),
    ),
    preview(
      "trial-expired",
      "Trial expired",
      "Trial",
      "Sent after trial access ends.",
      "Trial expired",
      trialExpiredEmail({ ...SAMPLE_USER, freeCredits: 25 }),
    ),
    preview(
      "re-engagement",
      "Re-engagement",
      "Trial",
      "Win-back offer after trial expiry.",
      "Lifecycle cron",
      reEngagementEmail(SAMPLE_USER),
    ),
  ];

  return Promise.all(
    previews.map(async (item) => ({
      ...item,
      html: await renderEmailHtml(item.html, { recipient: item.to }),
    })),
  );
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const previews = await buildEmailPreviews();
  return NextResponse.json({
    previews,
    count: previews.length,
    generatedAt: new Date().toISOString(),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const { previewId, toEmail } = body;

    if (!toEmail || typeof toEmail !== "string") {
      return NextResponse.json({ error: "A valid recipient email is required" }, { status: 400 });
    }

    const previews = await buildEmailPreviews();
    const target = previews.find((p) => p.id === previewId);

    if (!target) {
      return NextResponse.json({ error: "Email preview template not found" }, { status: 404 });
    }

    const success = await sendEmail({
      to: toEmail.trim(),
      subject: `[TEST] ${target.subject}`,
      html: target.html,
    });

    if (!success) {
      return NextResponse.json({ error: "Failed to send test email" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `Test email "${target.name}" sent to ${toEmail}`,
      sentAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send test email" },
      { status: 500 },
    );
  }
}
