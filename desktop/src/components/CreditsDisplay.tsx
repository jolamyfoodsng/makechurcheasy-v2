/**
 * CreditsDisplay — Reusable inline badge showing the user's credit balance.
 *
 * When a userId is provided, refreshes on mount, on visibility restore,
 * and on a low-frequency background interval. Local credit mutations still
 * update immediately through the shared event bus.
 */

import { Zap, CloudOff } from "./icons/NativeIcons";
import { useEffect, useRef, useState } from "react";
import {
  getCreditsBalance,
  onCreditChange,
  syncCreditsWithBackend,
  getPendingCount,
  getOfflineCreditBalance,
} from "../services/credits";

interface CreditsDisplayProps {
  /** Force a re-render when external state changes (e.g. after deduction). */
  refreshKey?: number;
  /** User ID for backend sync. When provided, enables authenticated refreshes. */
  userId?: string;
  /** Credits being consumed right now (e.g. during a live session). Subtracted from displayed balance. */
  sessionCreditsUsed?: number;
}

const BACKGROUND_REFRESH_MS = 10 * 60 * 1000;

function PendingBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: 10,
        color: "var(--text-muted)",
        marginLeft: 4,
      }}
      title={`${count} transaction(s) pending sync`}
    >
      <CloudOff size={10} />
      {count} pending
    </span>
  );
}

export default function CreditsDisplay({ refreshKey, userId, sessionCreditsUsed = 0 }: CreditsDisplayProps) {
  const [balance, setBalance] = useState<number>(0);
  const [isUnlimited, setIsUnlimited] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [synced, setSynced] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Generation counter: incremented on every local deduction so stale poll
  // responses (initiated before the deduction) are discarded.
  const genRef = useRef(0);

  // Sync from backend on mount, on visibility restore, and on a low-frequency timer.
  useEffect(() => {
    if (!userId) return;

    let cancelled = false;

    async function sync(force = false) {
      const genBefore = genRef.current;
      const result = await syncCreditsWithBackend({ force });
      // If a deduction happened while the fetch was in flight, discard
      // the stale response — the deduction already set the correct balance.
      if (!cancelled && genBefore === genRef.current) {
        if (result === null) {
          setSynced(false);
        } else if (result === -1) {
          setIsUnlimited(true);
          setSynced(true);
        } else if (result >= 0) {
          setIsUnlimited(false);
          setBalance(result);
          setSynced(true);
        }
      }
      // Refresh pending count — sync may have flushed offline queue
      setPendingCount(getPendingCount());
    }

    // Initial sync
    void sync();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void sync(true);
      }
    };

    pollingRef.current = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void sync(true);
    }, BACKGROUND_REFRESH_MS);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      if (pollingRef.current) clearInterval(pollingRef.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [userId]);

  // Also update when refreshKey changes (local deduction)
  useEffect(() => {
    setBalance(getCreditsBalance());
    setPendingCount(getPendingCount());
  }, [refreshKey]);

  // Live-update when credits change anywhere in the app
  useEffect(() => {
    const unsub = onCreditChange((newBalance) => {
      genRef.current += 1;
      if (newBalance === -1) {
        setIsUnlimited(true);
      } else {
        setIsUnlimited(false);
        setBalance(newBalance);
      }
      setPendingCount(getPendingCount());
    });
    return unsub;
  }, []);

  if (isUnlimited) {
    return (
      <div
        className="sts3-usage-pill"
        style={{ gap: 6, cursor: "help" }}
        title="Unlimited Coins — Active plan includes unlimited live sermon transcription"
      >
        <Zap size={12} style={{ color: "var(--gold)" }} />
        <span className="sts3-usage-label">COINS</span>
        <span className="sts3-usage-value" style={{ color: "var(--gold)" }}>
          Unlimited Coins
        </span>
        <PendingBadge count={pendingCount} />
      </div>
    );
  }

  const effectiveBalance = Math.max(0, getOfflineCreditBalance(balance) - sessionCreditsUsed);
  const tier =
    effectiveBalance <= 0 ? "red" : effectiveBalance <= 10 ? "orange" : "gold";

  const hours = Math.floor(effectiveBalance / 60);
  const minutes = effectiveBalance % 60;
  const timeDesc =
    hours > 0
      ? `${hours} hr${hours > 1 ? "s" : ""}${minutes > 0 ? ` ${minutes} min${minutes > 1 ? "s" : ""}` : ""}`
      : `${minutes} min${minutes > 1 ? "s" : ""}`;
  const hoverTooltip = `${effectiveBalance} Coins (~${timeDesc} of live transcription remaining · 1 Coin = 1 min)`;

  return (
    <div
      className={`sts3-usage-pill sts3-usage-pill--${tier}`}
      style={{ gap: 6, cursor: "help" }}
      title={hoverTooltip}
    >
      <Zap size={12} />
      <span className="sts3-usage-label">COINS</span>
      <span className="sts3-usage-value">
        {!synced && userId
          ? "…"
          : effectiveBalance <= 0
            ? "0 Coins — Top Up"
            : `${effectiveBalance} Coins`}
      </span>
      <PendingBadge count={pendingCount} />
    </div>
  );
}
