"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Gift, Loader2, SkipForward } from "lucide-react";
import { applyReferralCode, dismissReferralPrompt, getReferrals } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const PENDING_REFERRAL_CODE_KEY = "mce_pending_referral_code";
const REFERRAL_SKIPPED_KEY = "mce_referral_skipped";

function normalizeReferralCode(value: string | null): string {
  return (value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function ReferralCodePrompt() {
  const { mongoUser, refreshMongoUser } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [showPrompt, setShowPrompt] = useState(false);
  const [skipping, setSkipping] = useState(false);

  useEffect(() => {
    if (!mongoUser?._id || mongoUser.role === "admin") return;

    // If the user already skipped locally, don't redirect or show anything.
    try {
      if (localStorage.getItem(REFERRAL_SKIPPED_KEY) === "1") return;
    } catch {
      // Storage unavailable: don't block.
    }

    const pendingCode = normalizeReferralCode(
      localStorage.getItem(PENDING_REFERRAL_CODE_KEY),
    );
    if (!pendingCode) {
      let stop = false;
      getReferrals()
        .then((data) => {
          if (stop || !data.referralRequired || data.referredBy) return;
          setShowPrompt(true);
        })
        .catch(() => undefined);
      return () => {
        stop = true;
      };
    }

    let cancelled = false;

    async function applyPendingReferral() {
      try {
        const data = await getReferrals();
        if (cancelled) return;

        if (data.referredBy) {
          localStorage.removeItem(PENDING_REFERRAL_CODE_KEY);
          return;
        }

        await applyReferralCode(pendingCode);
        localStorage.removeItem(PENDING_REFERRAL_CODE_KEY);
        await refreshMongoUser();
      } catch {
        localStorage.removeItem(PENDING_REFERRAL_CODE_KEY);
      }
    }

    void applyPendingReferral();
    return () => {
      cancelled = true;
    };
  }, [mongoUser?._id, mongoUser?.role]);

  async function handleSkip() {
    if (skipping) return;
    setSkipping(true);
    try {
      await dismissReferralPrompt();
    } catch {
      // Best-effort server dismiss — still let them through.
    }
    try {
      localStorage.setItem(REFERRAL_SKIPPED_KEY, "1");
    } catch {
      // Storage unavailable.
    }
    setShowPrompt(false);
  }

  function handleEnterCode() {
    router.push(`/signup/referral?next=${encodeURIComponent(pathname || "/dashboard")}`);
  }

  if (!showPrompt) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xl p-6 sm:p-8 max-w-md w-full">
        <div className="flex items-center gap-3.5 mb-4">
          <div className="w-11 h-11 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
            <Gift className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">Have a referral code?</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              If someone referred you to MakeChurchEazy, enter their code to continue.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={handleEnterCode}
            className="h-11 rounded-xl bg-blue-600 text-sm font-semibold text-white transition-all hover:bg-blue-700 active:bg-blue-800 flex items-center justify-center gap-2 cursor-pointer shadow-xs"
          >
            <Gift className="w-4 h-4" />
            Enter referral code
          </button>

          <button
            type="button"
            onClick={handleSkip}
            disabled={skipping}
            className="h-12 rounded-xl border-2 border-slate-900 bg-white text-sm font-bold text-slate-900 transition-all hover:bg-slate-900 hover:text-white active:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
          >
            {skipping ? <Loader2 className="w-4 h-4 animate-spin" /> : <SkipForward className="w-4 h-4" />}
            {skipping ? "Skipping…" : "I don't have a code — skip"}
          </button>
        </div>
      </div>
    </div>
  );
}
