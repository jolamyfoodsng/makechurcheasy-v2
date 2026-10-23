"use client";

import { isTrafficSourceWord } from "@/lib/trafficSource";
import { Suspense, useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Loader2,
  Mail,
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  Check,
  Gift,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTranslations } from "next-intl";
import { AuthShell } from "@/components/AuthLayout";
import { useReferralCodeCheck } from "@/hooks/useReferralCodeCheck";
import {
  verifyEmailCode as apiVerifyEmailCode,
  sendVerificationEmail as apiSendVerificationEmail,
} from "@/lib/api";

const PENDING_REFERRAL_CODE_KEY = "mce_pending_referral_code";

function normalizeReferralCode(value: string | null | undefined): string {
  return (value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

type SignupStep = "form" | "verify-email" | "success";

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      }
    >
      <SignupInner />
    </Suspense>
  );
}

function SignupInner() {
  const {
    mongoUser,
    loading: authLoading,
    signUpWithEmail,
    signInWithGoogle,
  } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations();

  const callbackUrlParam = searchParams.get("callbackUrl") || "/dashboard";
  const safeCallbackUrl =
    callbackUrlParam.startsWith("/") && !callbackUrlParam.startsWith("//")
      ? callbackUrlParam
      : "/dashboard";

  const [step, setStep] = useState<SignupStep>("form");
  const [name, setName] = useState("");
  const [churchName, setChurchName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [referralServerError, setReferralServerError] = useState("");
  const referralCheck = useReferralCodeCheck(referralCode);
  const referralError =
    referralServerError || (referralCheck.status === "invalid" ? referralCheck.message : "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Email verification state
  const [verifyEmailCode, setVerifyEmailCode] = useState("");
  const [verifyEmailLoading, setVerifyEmailLoading] = useState(false);
  const [verifyEmailError, setVerifyEmailError] = useState("");
  const [verifyEmailNotice, setVerifyEmailNotice] = useState("");
  const [verifyEmailResendTimer, setVerifyEmailResendTimer] = useState(0);
  const verifyResendIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Detect referral code from URL query parameters and localStorage
  useEffect(() => {
    // ?ref=tiktok style links name a channel, not a friend's code (see lib/trafficSource).
    const refParam = searchParams.get("ref");
    const rawRef =
      (isTrafficSourceWord(refParam) ? null : refParam) ||
      searchParams.get("referral") ||
      searchParams.get("referralCode");
    const storedRef =
      typeof window !== "undefined"
        ? localStorage.getItem(PENDING_REFERRAL_CODE_KEY)
        : null;
    const refCode = normalizeReferralCode(rawRef || storedRef);

    if (refCode) {
      setReferralCode(refCode);
      try {
        localStorage.setItem(PENDING_REFERRAL_CODE_KEY, refCode);
      } catch {
        // Ignore storage errors
      }
    }

    const errorParam = searchParams.get("error");
    if (errorParam) {
      const errorMessages: Record<string, string> = {
        google_cancelled: "Google sign-up was cancelled",
        no_code: "Google sign-up failed — no authorization code received",
        google_not_configured: "Google sign-up is not configured",
        token_exchange_failed: "Google sign-up failed — could not complete authentication",
        no_email: "Google account has no email address",
        google_auth_failed: "Google sign-up failed. Please try again.",
        registrations_disabled: "New account registration is currently disabled.",
        disposable_email: "Please sign up with a permanent email address (temporary email providers aren't allowed).",
        too_many_signups_ip: "Too many accounts have been created from this network today. Please try again tomorrow or contact support.",
      };
      setError(errorMessages[errorParam] || `Sign-up error: ${errorParam}`);
    }
  }, [searchParams]);

  // If already authenticated and not in verification flow, navigate to callback
  useEffect(() => {
    if (authLoading) return;
    if (mongoUser && step === "form") {
      router.replace(safeCallbackUrl);
    }
  }, [authLoading, mongoUser, step, router, safeCallbackUrl]);

  // Cleanup resend timer
  useEffect(() => {
    return () => {
      if (verifyResendIntervalRef.current) {
        clearInterval(verifyResendIntervalRef.current);
      }
    };
  }, []);

  function startResendTimer() {
    if (verifyResendIntervalRef.current) clearInterval(verifyResendIntervalRef.current);
    verifyResendIntervalRef.current = setInterval(() => {
      setVerifyEmailResendTimer((prev) => {
        if (prev <= 1) {
          if (verifyResendIntervalRef.current) clearInterval(verifyResendIntervalRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (referralCode && referralCheck.status === "invalid") {
      setReferralServerError("");
      document.getElementById("signup-referral-code")?.focus();
      return;
    }
    setLoading(true);

    try {
      const finalReferralCode = normalizeReferralCode(
        referralCode || (typeof window !== "undefined" ? localStorage.getItem(PENDING_REFERRAL_CODE_KEY) : "")
      );

      const result = await signUpWithEmail(
        email,
        password,
        name,
        churchName,
        finalReferralCode || undefined
      );

      if (result.needsEmailVerification) {
        setStep("verify-email");
        setVerifyEmailCode("");
        setVerifyEmailError("");
        setVerifyEmailNotice(
          result.existingAccount
            ? "This email already has an account. A fresh verification code was sent, but your original password is still the one on the account."
            : ""
        );
        setVerifyEmailResendTimer(60);
        startResendTimer();
        setLoading(false);
        return;
      }

      setStep("success");
      setTimeout(() => {
        router.push(safeCallbackUrl);
      }, 1500);
    } catch (err: any) {
      setLoading(false);
      if (/referral code/i.test(err.message || "")) {
        setReferralServerError(err.message);
        document.getElementById("signup-referral-code")?.focus();
      } else if (err.message?.includes("already") || err.message?.includes("exists")) {
        setError("This email is already registered. Please log in instead.");
      } else if (err.message?.includes("Password")) {
        setError(t("auth.signup.passwordMinLength") || "Password must be at least 8 characters");
      } else {
        setError(err.message || t("common.somethingWentWrong") || "Something went wrong. Please try again.");
      }
    }
  }

  async function handleGoogleSignUp() {
    setError("");
    // A code that came in the link (or was typed) is checked before leaving for Google. With no code,
    // the page after Google asks for one.
    if (referralCode && referralCheck.status === "invalid") {
      document.getElementById("signup-referral-code")?.focus();
      return;
    }
    setLoading(true);
    try {
      const needs2FA = await signInWithGoogle(safeCallbackUrl);
      if (!needs2FA) router.push(safeCallbackUrl);
    } catch (err: any) {
      setLoading(false);
      console.error("[auth] Google sign-up error:", err);
      setError(t("auth.google.failed") || "Google authentication failed. Please try again.");
    }
  }

  async function handleVerifyEmail(e: React.FormEvent) {
    e.preventDefault();
    const code = verifyEmailCode.trim();
    if (!code || code.length !== 6) {
      setVerifyEmailError("Please enter the 6-digit code sent to your email.");
      return;
    }

    setVerifyEmailError("");
    setVerifyEmailLoading(true);

    try {
      await apiVerifyEmailCode(email, code);
      setStep("success");
      setTimeout(() => {
        router.push(safeCallbackUrl);
      }, 1200);
    } catch (err: any) {
      setVerifyEmailLoading(false);
      setVerifyEmailError(err.message || "Invalid or expired verification code.");
      setVerifyEmailCode("");
    }
  }

  async function handleResendVerificationEmail() {
    if (verifyEmailResendTimer > 0) return;
    setVerifyEmailError("");
    try {
      await apiSendVerificationEmail(email);
      setVerifyEmailResendTimer(60);
      startResendTimer();
    } catch (err: any) {
      setVerifyEmailError(err.message || "Failed to resend verification email.");
    }
  }

  // ── Step 1: Verify Email ──
  if (step === "verify-email") {
    return (
      <AuthShell>
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 sm:p-8">
          <div className="flex items-center gap-3.5 mb-5">
            <div className="w-11 h-11 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 tracking-tight">Verify your email</h2>
              <p className="text-xs text-slate-500 mt-0.5">We sent a 6-digit code to {email}</p>
            </div>
          </div>

          {verifyEmailNotice && (
            <div className="mb-4 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-xs text-amber-800">
              {verifyEmailNotice}
            </div>
          )}

          {verifyEmailError && (
            <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{verifyEmailError}</span>
            </div>
          )}

          <form onSubmit={handleVerifyEmail} className="flex flex-col gap-4">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={verifyEmailCode}
              onChange={(e) => setVerifyEmailCode(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              autoFocus
              className="h-13 w-full rounded-xl border border-slate-200 bg-white px-3 text-center font-mono text-2xl font-bold tracking-[0.35em] text-slate-900 outline-none transition-all placeholder:text-slate-300 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10"
            />
            <button
              type="submit"
              disabled={verifyEmailLoading || verifyEmailCode.length !== 6}
              className="h-11 rounded-xl bg-blue-600 text-sm font-semibold text-white transition-all hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer shadow-xs"
            >
              {verifyEmailLoading && <Loader2 className="w-4 h-4 animate-spin" />}
              {verifyEmailLoading ? "Verifying…" : "Verify and Continue"}
            </button>
          </form>

          <div className="mt-5 flex items-center justify-between text-xs text-slate-500">
            <span>Didn&apos;t receive a code?</span>
            <button
              type="button"
              onClick={handleResendVerificationEmail}
              disabled={verifyEmailResendTimer > 0}
              className="font-semibold text-blue-600 hover:underline disabled:opacity-50 disabled:no-underline cursor-pointer"
            >
              {verifyEmailResendTimer > 0 ? `Resend in ${verifyEmailResendTimer}s` : "Resend code"}
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setStep("form");
              setVerifyEmailError("");
            }}
            className="mt-6 text-xs text-slate-500 hover:text-slate-900 transition-colors font-semibold flex items-center gap-1.5 justify-center w-full cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to sign up
          </button>
        </div>
      </AuthShell>
    );
  }

  // ── Step 2: Signup Success ──
  if (step === "success") {
    return (
      <AuthShell>
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 sm:p-8 text-center">
          <div className="w-14 h-14 bg-green-50 border border-green-200 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <CheckCircle2 className="w-7 h-7 text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Account Created!</h2>
          <p className="text-sm text-slate-500 mb-6 leading-relaxed">
            Your 30-day (1 month) free trial has been activated. Redirecting you to your dashboard…
          </p>
          <Loader2 className="w-6 h-6 animate-spin text-blue-600 mx-auto" />
        </div>
      </AuthShell>
    );
  }

  // ── Step 3: Main Dedicated Signup Form ──
  return (
    <AuthShell>
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 sm:p-8">
        {/* Header */}
        <div className="mb-5">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Start your 1-month free trial
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1 leading-relaxed">
            Full access to offline Bibles, Studio, and AI speech-to-scripture. No credit card required.
          </p>
        </div>

        {/* Google 1-Click Button */}
        <button
          type="button"
          onClick={handleGoogleSignUp}
          disabled={loading}
          className="w-full h-11 flex items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50 hover:border-slate-300 hover:shadow-xs active:bg-slate-100 disabled:opacity-50 cursor-pointer"
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          <span>Sign up with Google</span>
        </button>

        {/* Divider */}
        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-200" />
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            or with email
          </span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        {/* Error alert */}
        {error && (
          <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs text-red-700 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
            {error.includes("already registered") && (
              <Link
                href="/login"
                className="text-xs font-bold text-red-800 underline hover:text-red-900 shrink-0"
              >
                Log in →
              </Link>
            )}
          </div>
        )}

        {/* Signup Form */}
        <form onSubmit={handleSignup} className="flex flex-col gap-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                {t("common.fullName") || "Full Name"}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10"
                placeholder={t("auth.signup.namePlaceholder") || "Your full name"}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-600">
                {t("common.churchName") || "Church Name"}
              </label>
              <input
                type="text"
                value={churchName}
                onChange={(e) => setChurchName(e.target.value)}
                required
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10"
                placeholder="e.g. Grace Fellowship"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-600">
              {t("common.email") || "Email Address"}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10"
              placeholder={t("auth.login.emailPlaceholder") || "pastor@church.org"}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-600">
              {t("common.password") || "Password"}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10"
              placeholder={t("auth.signup.passwordPlaceholder") || "At least 8 characters"}
            />
          </div>

          {/* Referral Code Field with Automatic Detection Badge */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                Referral Code <span className="text-slate-400 font-normal lowercase">(optional)</span>
              </label>
              {referralCode && referralCheck.status === "valid" && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200/60">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                  Code applied
                </span>
              )}
            </div>
            <div className="relative">
              <Gift className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={referralCode}
                onChange={(e) => {
                  const val = normalizeReferralCode(e.target.value);
                  setReferralCode(val);
                  setReferralServerError("");
                  try {
                    if (val) {
                      localStorage.setItem(PENDING_REFERRAL_CODE_KEY, val);
                    } else {
                      localStorage.removeItem(PENDING_REFERRAL_CODE_KEY);
                    }
                  } catch {
                    // Ignore storage errors
                  }
                }}
                id="signup-referral-code"
                aria-invalid={referralError ? true : undefined}
                aria-describedby={referralError ? "signup-referral-code-error" : undefined}
                className={`h-11 w-full rounded-xl border bg-white pl-10 pr-3.5 text-sm font-mono uppercase tracking-wider text-slate-900 outline-none transition-all placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-400 focus:ring-4 ${
                  referralError
                    ? "border-red-400 focus:border-red-500 focus:ring-red-500/10"
                    : "border-slate-200 focus:border-blue-600 focus:ring-blue-600/10"
                }`}
                placeholder="e.g. MCEABC12"
                maxLength={16}
              />
            </div>
            {referralError ? (
              <p id="signup-referral-code-error" role="alert" className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-red-600">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {referralError}
              </p>
            ) : referralCode && referralCheck.status === "checking" ? (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Checking code…
              </p>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-1.5 h-11 rounded-xl bg-blue-600 text-sm font-semibold text-white transition-all hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer shadow-xs"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? "Creating account…" : "Start 1-Month Free Trial"}
          </button>

          {/* Feature Perks */}
          <div className="mt-3 pt-3 border-t border-slate-100 flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <Check className="w-3.5 h-3.5 text-green-600 shrink-0" />
              <span>1-month free trial with full Growth plan features</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <Check className="w-3.5 h-3.5 text-green-600 shrink-0" />
              <span>No credit card required to start</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <Check className="w-3.5 h-3.5 text-green-600 shrink-0" />
              <span>Unlimited offline Bible access (KJV, NIV, ESV...)</span>
            </div>
          </div>
        </form>

        {/* Dedicated Link to Login */}
        <div className="mt-6 pt-5 border-t border-slate-100 text-center text-xs sm:text-sm text-slate-500">
          <span>Already have an account? </span>
          <Link
            href="/login"
            className="text-blue-600 font-semibold hover:text-blue-700 hover:underline cursor-pointer"
          >
            Sign in
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}
