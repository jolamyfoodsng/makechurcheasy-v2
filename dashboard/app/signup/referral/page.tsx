"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Gift, Loader2, SkipForward } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { AuthShell } from "@/components/AuthLayout";
import { useReferralCodeCheck } from "@/hooks/useReferralCodeCheck";
import { applyReferralCode, dismissReferralPrompt, getReferrals } from "@/lib/api";

const PENDING_REFERRAL_CODE_KEY = "mce_pending_referral_code";

function normalizeReferralCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * The page after "Continue with Google" for a brand-new account that arrived without a referral
 * code in the link. A code is optional, same as email/password signup: entering one is checked
 * right away (errors show under the field), but "Skip for now" moves on without one.
 */
export default function SignupReferralPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      }
    >
      <ReferralStep />
    </Suspense>
  );
}

function ReferralStep() {
  const { mongoUser, loading: authLoading, refreshMongoUser } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const nextParam = searchParams.get("next") || "/dashboard";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/dashboard";
  const linkCodeWasInvalid = searchParams.get("invalid") === "1";

  const [code, setCode] = useState("");
  const [serverError, setServerError] = useState(
    linkCodeWasInvalid ? "The referral code from your link wasn't valid. Enter another one to continue." : "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [ready, setReady] = useState(false);
  const check = useReferralCodeCheck(code);

  function leave() {
    try {
      localStorage.removeItem(PENDING_REFERRAL_CODE_KEY);
    } catch {
      // Storage unavailable: nothing to clear.
    }
    router.replace(next);
  }

  // Must be signed in. Anyone who already has a referral (or never needed one) goes straight on.
  useEffect(() => {
    if (authLoading) return;
    if (!mongoUser) {
      router.replace(`/login?callbackUrl=${encodeURIComponent(`/signup/referral?next=${encodeURIComponent(next)}`)}`);
      return;
    }
    let cancelled = false;
    getReferrals()
      .then((data) => {
        if (cancelled) return;
        if (data.referredBy || !data.referralRequired) {
          leave();
          return;
        }
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, mongoUser?._id]);

  const error = serverError || (check.status === "invalid" ? check.message : "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code || submitting) return;
    if (check.status === "invalid") return;
    setServerError("");
    setSubmitting(true);
    try {
      await applyReferralCode(code);
      await refreshMongoUser().catch(() => undefined);
      leave();
    } catch (err: any) {
      setSubmitting(false);
      setServerError(err?.message || "Could not apply this referral code. Please try again.");
    }
  }

  async function handleSkip() {
    if (submitting || skipping) return;
    setSkipping(true);
    try {
      await dismissReferralPrompt();
    } catch {
      // Skipping is best-effort: still let them through even if the dismiss call fails.
    }
    leave();
  }

  if (authLoading || !mongoUser || !ready) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <AuthShell>
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 sm:p-8">
        <div className="flex items-center gap-3.5 mb-5">
          <div className="w-11 h-11 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
            <Gift className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 tracking-tight">Have a referral code?</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Enter the referral code from the friend or ministry who sent you to MakeChurchEazy to continue.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="referral-code" className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                Referral code
              </label>
              {check.status === "valid" && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200/60">
                  <CheckCircle2 className="w-3 h-3" />
                  Code is valid
                </span>
              )}
            </div>
            <div className="relative">
              <Gift className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="referral-code"
                type="text"
                value={code}
                onChange={(e) => {
                  setCode(normalizeReferralCode(e.target.value));
                  setServerError("");
                }}
                autoFocus
                autoComplete="off"
                maxLength={16}
                placeholder="e.g. MCEABC12"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "referral-code-error" : undefined}
                className={`h-11 w-full rounded-xl border bg-white pl-10 pr-3.5 text-sm font-mono uppercase tracking-wider text-slate-900 outline-none transition-all placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-400 focus:ring-4 ${
                  error
                    ? "border-red-400 focus:border-red-500 focus:ring-red-500/10"
                    : "border-slate-200 focus:border-blue-600 focus:ring-blue-600/10"
                }`}
              />
            </div>
            {error ? (
              <p id="referral-code-error" role="alert" className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-red-600">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {error}
              </p>
            ) : code && check.status === "checking" ? (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Checking code…
              </p>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={!code || submitting || check.status === "invalid"}
            className="h-11 rounded-xl bg-blue-600 text-sm font-semibold text-white transition-all hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer shadow-xs"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {submitting ? "Applying…" : "Apply code and continue"}
          </button>

          <div className="flex items-center gap-3 py-1">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">or</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <button
            type="button"
            onClick={handleSkip}
            disabled={submitting || skipping}
            className="h-12 rounded-xl border-2 border-slate-900 bg-white text-sm font-bold text-slate-900 transition-all hover:bg-slate-900 hover:text-white active:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
          >
            {skipping ? <Loader2 className="w-4 h-4 animate-spin" /> : <SkipForward className="w-4 h-4" />}
            {skipping ? "Skipping…" : "I don't have a code — skip this step"}
          </button>
        </form>

      </div>
    </AuthShell>
  );
}
