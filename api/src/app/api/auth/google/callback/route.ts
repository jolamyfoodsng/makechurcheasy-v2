import { NextRequest, NextResponse } from "next/server";
import { checkSignupAbuse } from "@/lib/adminControls";
import { jwtVerify } from "jose";
import { verifySessionToken } from "@/lib/jwt";
import clientPromise from "@/lib/mongodb";
import { signSessionToken } from "@/lib/jwt";
import { getPlanConfig } from "@/lib/db";
import { claimTrialForUserIfEligible } from "@/lib/trialAbuse";
import { getPlatformSettings } from "@/lib/platformSettings";
import { sendEmail, welcomeEmail } from "@/lib/emailTemplates";
import { processVerifiedSignupZohoSync, type ProcessZohoSignupResult } from "@/lib/zohoSignupSync";
import { nanoid } from "nanoid";
import { isKnownCountryCode, normalizeCountryCode } from "@/lib/countryNormalization";
import { detectRequestCountry, resolveSignupLanguage } from "@/lib/signupDefaults";
import { extractRequestLocation, buildLoginLocationUpdates } from "@/lib/userLocation";
import { notifyTelegramNewSignup } from "@/lib/telegramNotifications";
import { applyReferralCode, normalizeReferralCode } from "@/lib/referrals";
import { signupSourceFromRequest } from "@/lib/signupSource";

function appOrigin(appUrl: string): string {
  try {
    return new URL(appUrl).origin;
  } catch {
    return "https://makechurcheazy.com";
  }
}

function isAllowedOrigin(origin: string, appUrl: string): boolean {
  try {
    const parsed = new URL(origin);
    if (parsed.origin === appOrigin(appUrl)) return true;
    return process.env.NODE_ENV !== "production" && parsed.hostname === "localhost";
  } catch {
    return false;
  }
}

function sanitizeReturnUrl(value: string | null | undefined, origin: string): string {
  if (!value) return origin;
  try {
    const parsed = new URL(value, origin);
    if (parsed.origin !== origin) return origin;
    return parsed.toString();
  } catch {
    return origin;
  }
}

/**
 * GET /api/auth/google/callback
 *
 * Handles the OAuth callback from Google. Exchanges the authorization code
 * for tokens, fetches user info, and creates/finds the MongoDB user.
 * Sets a JWT session cookie and redirects to the dashboard.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://makechurcheazy.com";

  // Decode state: { o: clientOrigin, r: returnUrl, ref?: string } — or fall back to legacy plain string
  let clientOrigin = appUrl;
  let returnUrl = appUrl;
  let referralCodeFromState: string | undefined = undefined;
  let oauthIntent: "login" | "link" = "login";
  let oauthUserId: string | undefined;
  if (state) {
    try {
      const authSecret = process.env.AUTH_SECRET;
      if (!authSecret) throw new Error("OAuth state signing is unavailable");
      const { payload: parsed } = await jwtVerify(state, new TextEncoder().encode(authSecret), { algorithms: ["HS256"] });
      const parsedOrigin = typeof parsed.o === "string" ? parsed.o : appOrigin(appUrl);
      clientOrigin = isAllowedOrigin(parsedOrigin, appUrl)
        ? new URL(parsedOrigin).origin
        : appOrigin(appUrl);
      returnUrl = sanitizeReturnUrl(typeof parsed.r === "string" ? parsed.r : null, clientOrigin);
      if (typeof parsed.ref === "string" && parsed.ref.trim()) {
        referralCodeFromState = parsed.ref.trim();
      }
      oauthIntent = parsed.intent === "link" ? "link" : "login";
      oauthUserId = typeof parsed.uid === "string" ? parsed.uid : undefined;
    } catch {
      // Older unsigned states are accepted only as login redirects during rollout.
      try {
        const parsed = JSON.parse(state);
        const parsedOrigin = typeof parsed.o === "string" ? parsed.o : appOrigin(appUrl);
        clientOrigin = isAllowedOrigin(parsedOrigin, appUrl) ? new URL(parsedOrigin).origin : appOrigin(appUrl);
        returnUrl = sanitizeReturnUrl(typeof parsed.r === "string" ? parsed.r : null, clientOrigin);
        if (typeof parsed.ref === "string") referralCodeFromState = parsed.ref;
      } catch {
        return NextResponse.redirect(`${appOrigin(appUrl)}/login?error=google_state_invalid`);
      }
    }
  }

  const redirectWithError = (code: string) => {
    const target = oauthIntent === "link" ? returnUrl : `${clientOrigin}/login`;
    const url = new URL(target);
    url.searchParams.set(oauthIntent === "link" ? "google_error" : "error", code);
    return NextResponse.redirect(url.toString());
  };

  if (error) {
    return redirectWithError("google_cancelled");
  }

  if (!code) {
    return redirectWithError("no_code");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.AUTH_GOOGLE_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.AUTH_GOOGLE_SECRET;

  if (!clientId || !clientSecret) {
    return redirectWithError("google_not_configured");
  }

  const redirectUri = `${clientOrigin}/api/auth/google/callback`;

  try {
    // Exchange authorization code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      [key: string]: unknown;
    };

    if (!tokenData.access_token) {
      console.error("[google/callback] Token exchange failed:", tokenData);
      return redirectWithError("token_exchange_failed");
    }

    // Fetch user info from Google
    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const googleUser = (await userInfoRes.json()) as {
      id?: string;
      email?: string;
      verified_email?: boolean;
      name?: string;
      picture?: string;
    };

    if (!googleUser.email || !googleUser.id || googleUser.verified_email !== true) {
      return redirectWithError("google_email_unverified");
    }

    if (oauthIntent === "link") {
      const token = req.cookies.get("session-token")?.value;
      const session = token ? await verifySessionToken(token) : null;
      if (!oauthUserId || !session?.sub || session.sub !== oauthUserId) return redirectWithError("google_link_session_expired");
      const client = await clientPromise;
      const db = client.db();
      const linkedElsewhere = await db.collection("users").findOne({ "googleAccount.sub": googleUser.id, _id: { $ne: (await import("mongodb")).ObjectId.createFromHexString(oauthUserId) } }, { projection: { _id: 1 } });
      if (linkedElsewhere) return redirectWithError("google_account_in_use");
      await db.collection("users").updateOne(
        { _id: (await import("mongodb")).ObjectId.createFromHexString(oauthUserId), isActive: { $ne: false } },
        { $set: { googleAccount: { sub: googleUser.id, email: googleUser.email.trim().toLowerCase(), connectedAt: new Date().toISOString() } } },
      );
      const target = new URL(returnUrl);
      target.searchParams.set("google_connected", "1");
      return NextResponse.redirect(target.toString());
    }

    const client = await clientPromise;
    const db = client.db();
    const normalizedEmail = googleUser.email.trim().toLowerCase();
    const detectedCountry = detectRequestCountry(req.headers);
    const normalizedCountry = detectedCountry && await isKnownCountryCode(detectedCountry)
      ? await normalizeCountryCode(detectedCountry)
      : "";
    const signupLanguage = resolveSignupLanguage(req.headers, normalizedCountry || "US");

    // Find or create user
    // New Google accounts that arrive without a (working) referral code are sent to the "Have a
    // referral code?" page right after sign-up.
    let createdNewAccount = false;
    let referralApplied = false;
    let referralRejected = false;
    let user = await db.collection("users").findOne(
      { "googleAccount.sub": googleUser.id },
    );
    if (!user) user = await db.collection("users").findOne(
      { email: normalizedEmail },
      { collation: { locale: "en", strength: 2 } }
    );

    const now = new Date().toISOString();
    let shouldSyncExistingGoogleVerification = false;

    if (user) {
      if (user.isActive === false) {
        return redirectWithError("account_unavailable");
      }
      if (user.googleAccount?.sub && user.googleAccount.sub !== googleUser.id) return redirectWithError("google_account_mismatch");

      // Existing user — update avatar, login location, and mark email as verified
      const location = await extractRequestLocation(req.headers);
      const { set: loginLocationSet, push: loginLocationPush } = buildLoginLocationUpdates(user, location, now);

      const updateFields: Record<string, any> = {
        ...loginLocationSet,
        emailVerified: true,
        googleAccount: { sub: googleUser.id, email: normalizedEmail, connectedAt: user.googleAccount?.connectedAt || now },
      };
      if (!user.emailVerified) {
        const platformSettings = await getPlatformSettings();
        if (platformSettings.notifications.welcomeEmail) {
          shouldSyncExistingGoogleVerification = true;
          updateFields.zohoSignupSync = {
            status: "pending",
            requestedAt: new Date(now),
            attempts: 0,
            nextAttemptAt: new Date(now),
          };
        }
      }
      if (!user.emailVerifiedAt) {
        updateFields.emailVerifiedAt = now;
      }
      if (googleUser.picture && !user.avatar) {
        updateFields.avatar = googleUser.picture;
      }
      if (googleUser.name && !user.name) {
        updateFields.name = googleUser.name;
      }
      if (!user.language) {
        updateFields.language = signupLanguage;
      }
      // If user has no provider set, or was firebase, update to google
      if (!user.provider || user.provider === "firebase") {
        updateFields.provider = "google";
      }

      const updateDoc: Record<string, any> = { $set: updateFields };
      if (loginLocationPush) {
        updateDoc.$push = loginLocationPush;
      }

      await db.collection("users").updateOne(
        { _id: user._id },
        updateDoc
      );
      user = { ...user, ...updateFields };
      if (shouldSyncExistingGoogleVerification) {
        try {
          const zohoResult = await processVerifiedSignupZohoSync(user._id);
          if (zohoResult.status === "confirmation-required") {
            console.error("[google/callback] Zoho signup list requires another confirmation.");
          }
        } catch (zohoError) {
          console.error("[google/callback] Zoho enrollment will be retried:", {
            error: zohoError instanceof Error ? zohoError.name : "unknown_error",
          });
        }
      }
    } else {
      const platformSettings = await getPlatformSettings();
      if (!platformSettings.system.allowRegistrations) {
        return NextResponse.redirect(`${clientOrigin}/login?error=registrations_disabled`);
      }

      const location = await extractRequestLocation(req.headers);
      const effectiveCountry = normalizedCountry || location.country;
      const clientCity = location.city;
      const clientTimezone = location.timezone;
      const clientIp = location.ip;

      const abuse = await checkSignupAbuse(db, { email: normalizedEmail, ip: clientIp });
      if (!abuse.ok) {
        return NextResponse.redirect(`${clientOrigin}/login?error=${abuse.code}`);
      }

      // New user — create account
      const planConfig = await getPlanConfig();

      const newUser: Record<string, any> = {
        name: googleUser.name || normalizedEmail.split("@")[0],
        email: normalizedEmail,
        avatar: googleUser.picture || "",
        provider: "google",
        googleAccount: { sub: googleUser.id, email: normalizedEmail, connectedAt: now },
        emailVerified: true,
        emailVerifiedAt: now,
        appId: `VC-${nanoid(6).toUpperCase()}`,
        churchName: "",
        country: effectiveCountry,
        city: clientCity,
        timezone: clientTimezone,
        signupCountry: effectiveCountry,
        signupCity: clientCity,
        signupIp: clientIp,
        lastLoginCountry: effectiveCountry,
        lastLoginCity: clientCity,
        lastLoginIp: clientIp,
        locationHistory: [
          {
            country: effectiveCountry || "UNKNOWN",
            ...(clientCity ? { city: clientCity } : {}),
            ...(clientTimezone ? { timezone: clientTimezone } : {}),
            ...(clientIp ? { ip: clientIp } : {}),
            timestamp: now,
          },
        ],
        language: signupLanguage,
        phone: "",
        role: "user",
        tokenVersion: 0,
        credits: planConfig.plans.free.credits,
        plan: "free",
        trialId: null as string | null,
        onboardingCompleted: true,
        lifecycleEmails: {},
        ...(platformSettings.notifications.welcomeEmail
          ? {
              zohoSignupSync: {
                status: "pending",
                requestedAt: new Date(now),
                attempts: 0,
                nextAttemptAt: new Date(now),
              },
            }
          : {}),
        // Where they came from (ChatGPT, TikTok, a friend...), from the website's first-visit cookie.
        signupSource: signupSourceFromRequest(req, referralCodeFromState || null),
        createdAt: now,
        lastLogin: now,
      };

      const result = await db.collection("users").insertOne(newUser);
      user = { ...newUser, _id: result.insertedId };
      createdNewAccount = true;

      let zohoWelcomeResult: ProcessZohoSignupResult | null = null;
      if (platformSettings.notifications.welcomeEmail) {
        try {
          zohoWelcomeResult = await processVerifiedSignupZohoSync(result.insertedId);
        } catch (zohoError) {
          console.error("[google/callback] Zoho enrollment will be retried:", {
            error: zohoError instanceof Error ? zohoError.name : "unknown_error",
          });
        }
        if (zohoWelcomeResult?.status === "confirmation-required") {
          console.error("[google/callback] Zoho signup list requires another confirmation; welcome email was not duplicated.");
        }
      }

      await notifyTelegramNewSignup({
        name: newUser.name,
        country: normalizedCountry,
        createdAt: now,
        source: `Google signup · from ${newUser.signupSource.label}`,
      });

      if (referralCodeFromState) {
        try {
          await applyReferralCode(result.insertedId.toString(), referralCodeFromState);
          referralApplied = true;
        } catch (err: any) {
          referralRejected = true;
          console.warn("[google/callback] Referral code was not applied:", err?.message || err);
        }
      }

      // Create trial only if the claim is eligible.
      try {
        const trialClaim = await claimTrialForUserIfEligible({
          userId: result.insertedId.toString(),
          email: normalizedEmail,
          req,
          source: "google_callback",
        });
        const record = trialClaim.trialRecord;
        if (record) {
          const welcomeData = {
            endsAt: record.endsAt,
            durationDays: record.durationDays,
          };
          await db.collection("users").updateOne(
            { _id: result.insertedId },
            {
              $set: {
                credits: planConfig.plans.trial.credits,
                trialId: record._id?.toString(),
              },
            }
          );
          user.credits = planConfig.plans.trial.credits;
          user.trialId = record._id?.toString() || null;
          if (
            platformSettings.notifications.welcomeEmail &&
            zohoWelcomeResult?.status === "disabled"
          ) {
            sendEmail(
              welcomeEmail({
                userName: user.name || "there",
                userEmail: user.email,
                trialDays: welcomeData.durationDays,
                trialEndsAt: welcomeData.endsAt,
              })
            ).then(() => db.collection("users").updateOne(
              { _id: result.insertedId },
              { $set: { "lifecycleEmails.welcomeSent": true } },
            )).catch((err) => console.error("[google/callback] Failed to send welcome email:", err));
          }
        } else if (!trialClaim.eligible) {
          console.warn("[google/callback] Trial not granted:", {
            userId: result.insertedId.toString(),
            reason: trialClaim.reason,
            matchedSignalTypes: trialClaim.matchedSignalTypes,
          });
        }
      } catch (err) {
        console.error("[google/callback] Failed to create trial:", err);
      }
    }

    // Sign JWT
    const tokenVersion = user.tokenVersion ?? 0;
    const jwt = await signSessionToken(user._id.toString(), tokenVersion);

    let destination = returnUrl;
    if (createdNewAccount && !referralApplied) {
      // A new Google account must enter a referral code before it can use the dashboard (the flag is
      // cleared when a code is applied, and the dashboard sends them back here until then).
      try {
        await db.collection("users").updateOne({ _id: user._id }, { $set: { referralRequired: true } });
      } catch (err) {
        console.error("[google/callback] Could not flag referral as required:", err);
      }
      // Next page: ask for the referral code. `next` is the page they were headed to.
      try {
        const target = new URL(returnUrl);
        const next = `${target.pathname}${target.search}`;
        const page = new URL("/signup/referral", clientOrigin);
        page.searchParams.set("next", next);
        if (referralRejected) page.searchParams.set("invalid", "1");
        destination = page.toString();
      } catch {
        destination = returnUrl;
      }
    }

    const response = NextResponse.redirect(destination);
    response.cookies.set("session-token", jwt, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return response;
  } catch (err) {
    console.error("[google/callback] Error:", err);
    return redirectWithError("google_auth_failed");
  }
}
