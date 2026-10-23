import { NextRequest, NextResponse } from "next/server";
import { checkSignupAbuse, clientIpFromRequest, signupDeviceIdFromRequest } from "@/lib/adminControls";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import clientPromise from "@/lib/mongodb";
import { nanoid } from "nanoid";
import { signSessionToken } from "@/lib/jwt";
import { authLimiter } from "@/lib/rateLimit";
import { getPlanConfig, COLLECTIONS } from "@/lib/db";
import { claimTrialForUserIfEligible } from "@/lib/trialAbuse";
import { sendEmail, verificationCodeEmail } from "@/lib/emailTemplates";
import { setAuthCookieOnResponse } from "@/lib/auth";
import { isKnownCountryCode, normalizeCountryCode } from "@/lib/countryNormalization";
import { getPlatformSettings } from "@/lib/platformSettings";
import { applyReferralCode, normalizeReferralCode, validateReferralCode } from "@/lib/referrals";
import { detectRequestCountry, resolveSignupLanguage } from "@/lib/signupDefaults";
import { notifyTelegramNewSignup } from "@/lib/telegramNotifications";
import { signupSourceFromRequest } from "@/lib/signupSource";

const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

function generateCode(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

function generateAppId(): string {
  return `VC-${nanoid(6).toUpperCase()}`;
}

export async function POST(req: NextRequest) {
  try {
    const rl = authLimiter.check(req);
    if (!rl.ok) {
      return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
    }

    const body = (await req.json()) as {
      name?: string;
      email?: string;
      password?: string;
      churchName?: string;
      referralCode?: string;
      installationId?: string;
      deviceId?: string;
    };
    const { name, email, password, churchName, referralCode } = body;

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: "Name, email, and password are required" },
        { status: 400 }
      );
    }

    // A referral code is optional, but one that was typed or came in the link must be real. Say so
    // now, next to the field, instead of creating the account and quietly ignoring the code.
    const submittedReferralCode = normalizeReferralCode(referralCode);
    if (submittedReferralCode) {
      const check = await validateReferralCode(submittedReferralCode);
      if (!check.valid) {
        return NextResponse.json(
          { error: check.error || "This referral code isn't valid.", field: "referralCode" },
          { status: 400 },
        );
      }
    }

    const client = await clientPromise;
    const db = client.db();
    const platformSettings = await getPlatformSettings();
    if (!platformSettings.system.allowRegistrations) {
      return NextResponse.json(
        { error: "New account registration is currently disabled" },
        { status: 403 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const detectedCountry = detectRequestCountry(req.headers);
    // Keep this server-owned. A client-submitted country is intentionally not
    // used for signup, pricing, or account metadata.
    const normalizedCountry = detectedCountry && await isKnownCountryCode(detectedCountry)
      ? await normalizeCountryCode(detectedCountry)
      : "";
    const signupLanguage = resolveSignupLanguage(req.headers, normalizedCountry || "US");

    // Check if user already exists
    const existingUser = await db.collection("users").findOne(
      { email: normalizedEmail },
      { collation: { locale: "en", strength: 2 } }
    );

    if (existingUser) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      );
    }

    // Check if email is permanently reserved (previous email change)
    const reservedEmail = await db.collection(COLLECTIONS.RESERVED_EMAILS).findOne({
      email: normalizedEmail,
    });
    if (reservedEmail) {
      return NextResponse.json(
        { error: "This email address is unavailable" },
        { status: 409 }
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    const signupCity = req.headers.get("x-mce-geo-city")?.trim() || "";
    const signupTimezone = req.headers.get("x-mce-geo-timezone")?.trim() || "";
    const signupIp = req.headers.get("x-mce-client-ip")?.trim() || req.headers.get("cf-connecting-ip")?.trim() || "";
    const signupDeviceId = signupDeviceIdFromRequest(req, body);
    const abuse = await checkSignupAbuse(db, {
      email: normalizedEmail,
      ip: signupIp || clientIpFromRequest(req),
      deviceId: signupDeviceId,
    });
    if (!abuse.ok) {
      return NextResponse.json({ error: abuse.error, code: abuse.code }, { status: 403 });
    }

    // Create user
    const now = new Date().toISOString();
    const planConfig = await getPlanConfig();
    const user: Record<string, any> = {
      name,
      email: normalizedEmail,
      password: hashedPassword,
      avatar: "",
      provider: "credentials",
      appId: generateAppId(),
      churchName: churchName || "",
      country: normalizedCountry,
      city: signupCity,
      timezone: signupTimezone,
      signupCountry: normalizedCountry,
      signupCity,
      signupIp: signupIp || clientIpFromRequest(req),
      ...(signupDeviceId ? { signupDeviceId } : {}),
      lastLoginCountry: normalizedCountry,
      lastLoginCity: signupCity,
      lastLoginIp: signupIp,
      locationHistory: [
        {
          country: normalizedCountry || "UNKNOWN",
          ...(signupCity ? { city: signupCity } : {}),
          ...(signupTimezone ? { timezone: signupTimezone } : {}),
          ...(signupIp ? { ip: signupIp } : {}),
          timestamp: now,
        },
      ],
      language: signupLanguage,
      phone: "",
      role: "user",
      tokenVersion: 0,
      emailVerified: false,
      credits: planConfig.plans.free.credits,
      plan: "free",
      trialId: null,
      trial: null,
      onboardingCompleted: true,
      // Where they came from (ChatGPT, TikTok, a friend...), from the website's first-visit cookie.
      signupSource: signupSourceFromRequest(req, submittedReferralCode || null),
      createdAt: now,
      lastLogin: now,
    };

    const result = await db.collection("users").insertOne(user);
    const newUserId = result.insertedId.toString();

    await notifyTelegramNewSignup({
      name: user.name,
      country: normalizedCountry,
      createdAt: now,
      source: `Website signup · from ${user.signupSource.label}`,
    });

    if (submittedReferralCode) {
      try {
        await applyReferralCode(newUserId, submittedReferralCode);
      } catch (err: any) {
        console.warn("[signup] Referral code was not applied:", err?.message || err);
      }
    }

    // Create trial record only if this person/device has not claimed one before.
    try {
      const trialClaim = await claimTrialForUserIfEligible({
        userId: newUserId,
        email: normalizedEmail,
        req,
        source: "signup",
      });
      if (trialClaim.trialRecord) {
        await db.collection("users").updateOne(
          { _id: result.insertedId },
          {
            $set: {
              credits: planConfig.plans.trial.credits,
              trialId: trialClaim.trialRecord._id?.toString() || null,
            },
          }
        );
      } else if (!trialClaim.eligible) {
        console.warn("[signup] Trial not granted:", {
          userId: newUserId,
          reason: trialClaim.reason,
          matchedSignalTypes: trialClaim.matchedSignalTypes,
        });
      }
    } catch (err) {
      console.error("[signup] Failed to create trial record:", err);
    }

    // Generate email verification PIN and store on user document
    const code = generateCode();
    const hashedCode = await bcrypt.hash(code, 12);
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_MS);

    await db.collection("users").updateOne(
      { _id: result.insertedId },
      {
        $set: {
          emailVerificationCode: hashedCode,
          emailVerificationExpiresAt: expiresAt.toISOString(),
          emailVerificationAttempts: 0,
        },
      }
    );

    // Send verification email (best-effort)
    const emailOpts = verificationCodeEmail(code);
    emailOpts.to = normalizedEmail;
    sendEmail(emailOpts).catch((err) =>
      console.error("[signup] Failed to send verification email:", err)
    );

    // Sign JWT and set session cookie (user is logged in but blocked until verified)
    const jwt = await signSessionToken(newUserId, 0);
    const response = NextResponse.json(
      {
        message: "Account created successfully",
        userId: newUserId,
        needsEmailVerification: true,
        email: normalizedEmail,
      },
      { status: 201 }
    );

    return setAuthCookieOnResponse(response, jwt);
  } catch (error: any) {
    if (error?.code === 11000) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      );
    }
    console.error("Signup error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
