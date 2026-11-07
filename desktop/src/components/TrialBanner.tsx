/**
 * TrialBanner.tsx — Persistent notification when trial expires
 *
 * Shown on the dashboard after the Growth trial ends.
 * Informs the user they're now on Free plan and prompts upgrade.
 */

import { getCurrentUser } from "../services/authService";
import { isTrialExpired, getTrialDaysRemaining } from "../services/licenseService";
import { UPGRADE_PROMO_FALLBACK } from "../lib/upgradePromo";

interface TrialBannerProps {
  onUpgrade?: () => void;
}

export function TrialBanner({ onUpgrade }: TrialBannerProps) {
  const user = getCurrentUser();

  // Don't show if no trial ever started
  if (!user?.trial?.endsAt) return null;

  // Show if trial is still active (days remaining)
  const daysLeft = getTrialDaysRemaining(user);
  if (daysLeft > 0) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 16px",
        background: "rgba(123, 104, 238, 0.08)",
        border: "1px solid rgba(123, 104, 238, 0.2)",
        borderRadius: 6,
        marginBottom: 16,
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--accent-blue)", flexShrink: 0 }}>
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>
          Trial Active
        </span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {daysLeft} day{daysLeft !== 1 ? "s" : ""} remaining
        </span>
        <span style={{ fontSize: 11, color: "var(--text-primary)", fontWeight: 600 }}>
          {UPGRADE_PROMO_FALLBACK}
        </span>
        <button
          onClick={onUpgrade}
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--accent-blue)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "4px 8px",
            borderRadius: 4,
          }}
         title="Upgrade">
          Upgrade
        </button>
      </div>
    );
  }

  // Show expired trial banner
  if (!isTrialExpired(user)) return null;

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "10px 16px",
      background: "rgba(255, 107, 107, 0.08)",
      border: "1px solid rgba(255, 107, 107, 0.2)",
      borderRadius: 6,
      marginBottom: 16,
    }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--error)", flexShrink: 0 }}>
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>
        Trial Expired
      </span>
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
        You're now on the Free plan
      </span>
      <span style={{ fontSize: 11, color: "var(--text-primary)", fontWeight: 600 }}>
        {UPGRADE_PROMO_FALLBACK}
      </span>
      <button
        onClick={onUpgrade}
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "#fff",
          background: "#7b68ee",
          border: "none",
          cursor: "pointer",
          padding: "5px 12px",
          borderRadius: 4,
        }}
       title="Upgrade">
        Upgrade
      </button>
    </div>
  );
}

export default TrialBanner;
