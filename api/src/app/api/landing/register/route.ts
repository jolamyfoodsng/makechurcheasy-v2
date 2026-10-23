import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import clientPromise from "@/lib/mongodb";
import { nanoid } from "nanoid";
import { getPlanConfig } from "@/lib/db";
import { rateLimit } from "@/lib/rateLimit";
import { isKnownCountryCode, normalizeCountryCode } from "@/lib/countryNormalization";
import { notifyTelegramNewSignup } from "@/lib/telegramNotifications";
import { signupSourceFromRequest } from "@/lib/signupSource";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Device-Id",
};

const limiter = rateLimit({ windowMs: 60_000, max: 5 });

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  try {
    const rateResult = limiter.check(req);
    if (!rateResult.ok) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: CORS_HEADERS });
    }

    const { name, email, password, churchName, country, role, churchSize, platform } =
      (await req.json()) as {
        name?: string;
        email?: string;
        password?: string;
        churchName?: string;
        country?: string;
        role?: string;
        churchSize?: string;
        platform?: string;
      };

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: "Name, email, and password are required" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const client = await clientPromise;
    const db = client.db();

    const normalizedEmail = email.trim().toLowerCase();
    let normalizedCountry = "";
    if (country?.trim()) {
      if (!(await isKnownCountryCode(country))) {
        return NextResponse.json(
          { error: "Please select a valid country." },
          { status: 400, headers: CORS_HEADERS },
        );
      }
      normalizedCountry = await normalizeCountryCode(country);
    }

    const existingUser = await db.collection("users").findOne(
      { email: normalizedEmail },
      { collation: { locale: "en", strength: 2 } }
    );
    if (existingUser) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409, headers: CORS_HEADERS }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const now = new Date().toISOString();
    const user = {
      name,
      email: normalizedEmail,
      password: hashedPassword,
      avatar: "",
      provider: "credentials",
      appId: `VC-${nanoid(6).toUpperCase()}`,
      churchName: churchName || "",
      country: normalizedCountry,
      role: role || "",
      churchSize: churchSize || "",
      downloadPlatform: platform || "",
      emailVerified: false,
      plan: "free",
      credits: (await getPlanConfig()).plans.free.credits,
      trial: null,
      isActive: true,
      signupDate: now,
      // Where they came from (ChatGPT, TikTok, a friend...), from the website's first-visit cookie.
      signupSource: signupSourceFromRequest(req),
      createdAt: now,
      lastLogin: now,
      lastActive: now,
    };

    const result = await db.collection("users").insertOne(user);

    await notifyTelegramNewSignup({
      name: user.name,
      country: normalizedCountry,
      createdAt: now,
      source: `Landing page signup · from ${user.signupSource.label}`,
    });

    await db.collection("activity_events").insertOne({
      event: "user_signup",
      userId: result.insertedId.toString(),
      properties: {
        source: "landing_page",
        platform: platform || "",
        country: normalizedCountry,
        role: role || "",
        churchSize: churchSize || "",
      },
      timestamp: new Date(),
      ip: req.headers.get("x-forwarded-for") || null,
    });

    return NextResponse.json(
      {
        message: "Account created successfully",
        userId: result.insertedId.toString(),
      },
      { status: 201, headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("Landing register error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
