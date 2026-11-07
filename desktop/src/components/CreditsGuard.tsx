/**
 * CreditsGuard — Blocks page access when the user has 0 credits.
 *
 * Wraps page content and shows a full-screen blocked state with
 * an upgrade CTA when credits are exhausted. Full-access users bypass this guard.
 *
 * If the backend is unreachable or the user is offline, the guard blocks
 * credit-gated pages until credits can be verified.
 */

import { useEffect, useState } from "react";
import { Zap, ExternalLink, LogOut } from "./icons/NativeIcons";
import { fetchCreditsResult, isProUnlocked } from "../services/credits";
import { useAuth } from "../contexts/AuthContext";
import LoadingScreen from "./LoadingScreen";

const CREDITS_URL =
  "https://makechurcheazy.com/credits";

interface CreditsGuardProps {
  children: React.ReactNode;
}

type GuardState =
  | { phase: "loading" }
  | { phase: "unauthorized" }
  | { phase: "unavailable" }
  | { phase: "blocked" }
  | { phase: "pass" };

export default function CreditsGuard({ children }: CreditsGuardProps) {
  const [state, setState] = useState<GuardState>({ phase: "loading" });
  const [retryKey, setRetryKey] = useState(0);
  const fullAccess = isProUnlocked();
  const { logout } = useAuth();

  useEffect(() => {
    if (fullAccess) return;
    let cancelled = false;

    // Check online status first
    if (!navigator.onLine) {
      setState({ phase: "unavailable" });
      return () => { cancelled = true; };
    }

    fetchCreditsResult().then((result) => {
      if (cancelled) return;
      if (result.status === "unauthorized") {
        setState({ phase: "unauthorized" });
      } else if (result.status === "network_error") {
        setState({ phase: "unavailable" });
      } else if (result.credits < 0) {
        setState({ phase: "pass" });
      } else if (result.credits === 0) {
        setState({ phase: "blocked" });
      } else {
        setState({ phase: "pass" });
      }
    }).catch(() => {
      if (!cancelled) setState({ phase: "unavailable" });
    });

    // Also listen for online/offline events
    const handleOffline = () => {
      if (!cancelled) setState({ phase: "unavailable" });
    };
    window.addEventListener("offline", handleOffline);
    return () => {
      cancelled = true;
      window.removeEventListener("offline", handleOffline);
    };
  }, [fullAccess, retryKey]);

  // Full-access users always pass
  if (fullAccess) return <>{children}</>;

  // Loading state
  if (state.phase === "loading") {
    return <LoadingScreen variant="page" label="Verifying credits…" />;
  }

  // Session expired / unauthorized — prompt to log in again
  if (state.phase === "unauthorized") {
    return (
      <div style={styles.root}>
        <div style={styles.card}>
          <div style={{ ...styles.iconWrap, background: "rgba(239, 68, 68, 0.12)", color: "var(--error)" }}>
            <LogOut size={28} />
          </div>
          <h2 style={styles.title}>Session Expired</h2>
          <p style={styles.desc}>
            Your login session is no longer recognized by the server. Please sign out and log back in to reconnect your account.
          </p>
          <button
            type="button"
            style={{ ...styles.cta, background: "#ef4444", cursor: "pointer" }}
            onClick={() => logout()}
          >
            <LogOut size={14} />
            Sign Out & Reconnect
          </button>
        </div>
      </div>
    );
  }

  // Offline / backend unreachable — block until credits can be verified
  if (state.phase === "unavailable") {
    return (
      <div style={styles.root}>
        <div style={styles.card}>
          <div style={styles.iconWrap}>
            <Zap size={28} />
          </div>
          <h2 style={styles.title}>Credit Check Required</h2>
          <p style={styles.desc}>
            We need to verify your credits before opening transcription,
            transcript library, or translation features. Check your connection
            and try again.
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <button
              type="button"
              style={{ ...styles.cta, cursor: "pointer" }}
              onClick={() => {
                setState({ phase: "loading" });
                setRetryKey((key) => key + 1);
              }}
            >
              Retry
            </button>
            <button
              type="button"
              style={{
                ...styles.cta,
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--text-muted)",
                cursor: "pointer",
              }}
              onClick={() => logout()}
            >
              <LogOut size={14} />
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Credits available — pass through
  if (state.phase === "pass") return <>{children}</>;

  // Zero credits — show blocked state
  return (
    <div style={styles.root}>
      <div style={styles.card}>
        <div style={styles.iconWrap}>
          <Zap size={28} />
        </div>
        <h2 style={styles.title}>No Credits Remaining</h2>
        <p style={styles.desc}>
          You've used all your transcription credits. Purchase more to continue
          using speech-to-scripture, transcript library, and translation features.
        </p>
        <a
          href={CREDITS_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={styles.cta}
        >
          <Zap size={14} />
          Buy Credits
          <ExternalLink size={12} />
        </a>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    minHeight: 450,
    padding: 32,
    background: "var(--bg)",
  },
  card: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    maxWidth: 400,
    width: "100%",
    textAlign: "center",
    padding: "32px 24px",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.08)",
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: "50%",
    background: "rgba(239, 68, 68, 0.12)",
    color: "var(--error)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    color: "var(--text)",
    margin: 0,
    fontFamily: "var(--font-heading)",
  },
  desc: {
    fontSize: 13,
    lineHeight: 1.6,
    color: "var(--text-muted)",
    margin: 0,
  },
  cta: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    padding: "9px 20px",
    borderRadius: "var(--radius)",
    background: "var(--primary)",
    border: "none",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    textDecoration: "none",
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
};
