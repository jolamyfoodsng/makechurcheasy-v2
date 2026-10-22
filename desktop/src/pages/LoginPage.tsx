import { Settings, QrCode, LoaderCircle, Mail } from "../components/icons/NativeIcons";
import { AppLogo } from "@/components/AppLogo";
import { useAuth } from "@/contexts/AuthContext";
import {
  createPairingCode,
  formatPairingCodeForDisplay,
  getDashboardBaseForAuth,
  normalizePairingCode,
  redeemPairingCode,
  resetPairingApiBase,
  watchPairingStatus
} from "@/services/authService";
import { DEFAULT_DESKTOP_CONFIG, readDesktopConfigCache } from "@/services/desktopConfig";
import { trackDevicePaired, trackLogin } from "@/services/tracking";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

function detectOS(): string {
  const ua = navigator.userAgent;
  if (/mac os/i.test(ua)) return "macOS";
  if (/windows/i.test(ua)) return "Windows";
  if (/linux/i.test(ua)) return "Linux";
  if (/android/i.test(ua)) return "Android";
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  return "Unknown OS";
}

type View = "initial" | "pairing" | "manual" | "qr";

export default function LoginPage() {
  const { t } = useTranslation();
  const { setUser, user, authenticated } = useAuth();
  const [view, setView] = useState<View>("initial");
  const [code, setCode] = useState("");
  const displayPairingCode = formatPairingCodeForDisplay(code);
  const [manualCode, setManualCode] = useState("");
  const displayCode = formatPairingCodeForDisplay(manualCode);
  const [countdown, setCountdown] = useState(300);
  const [error, setError] = useState("");
  const [welcomeBack, setWelcomeBack] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [redeeming, setRedeeming] = useState(false);

  // Email verification modal state
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState("");
  const [verificationName, setVerificationName] = useState("");
  const [verificationMessage, setVerificationMessage] = useState("");
  const [resendStatus, setResendStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [checkStatus, setCheckStatus] = useState<"idle" | "checking" | "verified" | "not_verified" | "error">("idle");

  const [regenError, setRegenError] = useState("");
  const [regenerating, setRegenerating] = useState(false);

  const cleanupRef = useRef<(() => void) | null>(null);
  const welcomeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (authenticated && user) {
    console.log("[LoginPage] authenticated && user → returning null (showing dashboard)");
    return null;
  }

  console.log("[LoginPage] render — authenticated:", authenticated, "user:", !!user, "view:", view);

  async function generateQrDataUrl(pairCode: string): Promise<string> {
    const pairUrl = `${getDashboardBaseForAuth()}/pair/mobile?code=${pairCode}`;
    return QRCode.toDataURL(pairUrl, {
      width: 240,
      margin: 2,
      // Black squares on white: every scanner reads this. (Reversed white-on-dark codes fail in some.)
      color: { dark: "#000000", light: "#FFFFFF" },
    });
  }

  async function startQrLogin() {
    setError("");
    resetPairingApiBase();
    const result = await createPairingCode("MakeChurchEazy");
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setCode(result.code);
    const dataUrl = await generateQrDataUrl(result.code);
    setQrDataUrl(dataUrl);
    setCountdown(300);
    setView("qr");
    startWatching(result.code);
  }

  async function handleRegenerate() {
    cleanupRef.current?.();
    cleanupRef.current = null;
    setRegenerating(true);
    setRegenError("");
    setCode("");
    setQrDataUrl("");
    resetPairingApiBase();

    const result = await createPairingCode("MakeChurchEazy");
    if ("error" in result) {
      setRegenError(result.error);
      setRegenerating(false);
      return;
    }

    setCode(result.code);
    setRegenerating(false);
    setCountdown(300);
    startWatching(result.code);

    if (view === "qr") {
      const dataUrl = await generateQrDataUrl(result.code).catch(() => "");
      setQrDataUrl(dataUrl);
    } else {
      await openPairingInBrowser(result.code);
    }
  }

  async function openPairingInBrowser(targetCode: string) {
    const os = detectOS();
    const params = new URLSearchParams();
    if (targetCode) params.set("code", targetCode);
    params.set("os", os);
    const url = `${getDashboardBaseForAuth()}/device?${params.toString()}`;
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch {
      window.open(url, "_blank");
    }
  }

  // Cleanup SSE and timeouts on unmount
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      if (welcomeTimeoutRef.current) clearTimeout(welcomeTimeoutRef.current);
    };
  }, []);

  // Countdown timer
  useEffect(() => {
    if ((view !== "pairing" && view !== "qr") || countdown <= 0) return;
    const timer = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [view, countdown]);

  function startWatching(pairingCode: string) {
    cleanupRef.current?.();

    cleanupRef.current = watchPairingStatus(pairingCode, {
      onAuthorized(user) {
        console.log("[LoginPage] onAuthorized called, setting user:", user.name);
        cleanupRef.current = null;

        // Bring desktop app to front immediately
        try {
          import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
            const win = getCurrentWindow();
            win.unminimize().then(() => {
              win.show().then(() => {
                win.setFocus().catch(() => {});
              }).catch(() => {});
            }).catch(() => {
              win.setFocus().catch(() => {});
            });
          }).catch(() => {});
        } catch {}

        // Stop countdown immediately — code is redeemed, expiration is irrelevant
        setCountdown(0);
        setCode("");
        trackLogin("pairing");
        trackDevicePaired();
        const hasVisited = localStorage.getItem("mce_has_visited");
        if (hasVisited) {
          setWelcomeBack(true);
          welcomeTimeoutRef.current = setTimeout(() => setWelcomeBack(false), 3000);
        }
        localStorage.setItem("mce_has_visited", "1");
        setUser(user);
      },
      onExpired() {
        cleanupRef.current = null;
        setCountdown(0);
      },
      onError(msg) {
        cleanupRef.current = null;
        setError(msg);
        setView("initial");
      },
      onVersionBlocked(message) {
        cleanupRef.current = null;
        setError(message);
        setView("initial");
      },
      onVerificationRequired(email, name, message) {
        cleanupRef.current = null;
        setVerificationEmail(email);
        setVerificationName(name);
        setVerificationMessage(message);
        setResendStatus("idle");
        setCheckStatus("idle");
        setShowVerificationModal(true);
      },
    });
  }



  async function handleManualSubmit() {
    const normalizedCode = normalizePairingCode(manualCode);
    if (normalizedCode.length !== 8) {
      setError("Please enter a valid pairing code");
      return;
    }

    setError("");
    setRedeeming(true);

    try {
      const result = await redeemPairingCode(normalizedCode);

      if (result.success) {
        console.log("[LoginPage] handleManualSubmit success, setting user:", result.user.name);
        // Bring desktop app to front immediately
        try {
          import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
            const win = getCurrentWindow();
            win.unminimize().then(() => win.show()).then(() => win.setFocus()).catch(() => {});
          }).catch(() => {});
        } catch {}

        trackLogin("pairing");
        trackDevicePaired();
        const hasVisited = localStorage.getItem("mce_has_visited");
        if (hasVisited) {
          setWelcomeBack(true);
          welcomeTimeoutRef.current = setTimeout(() => setWelcomeBack(false), 3000);
        }
        localStorage.setItem("mce_has_visited", "1");
        setUser(result.user);
      } else {
        console.log("[LoginPage] handleManualSubmit failed:", result.error);
        setError(result.error);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setRedeeming(false);
    }
  }

  function formatCountdown(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        padding: "24px",
      }}
    >
      {/* Maintenance Mode Overlay */}
      {(readDesktopConfigCache() || DEFAULT_DESKTOP_CONFIG).security.maintenanceMode && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0,0,0,0.9)",
          zIndex: 9999,
        }}>
          <div style={{
            textAlign: "center",
            padding: "48px",
            maxWidth: "400px",
          }}>
            <Settings size={48} style={{ marginBottom: 16, color: "var(--text-secondary)" }} />
            <h1 style={{ fontSize: "24px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "12px" }}>
              {t("login.maintenance.title")}
            </h1>
            <p style={{ fontSize: "16px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
              {(readDesktopConfigCache() || DEFAULT_DESKTOP_CONFIG).security.maintenanceMessage?.trim() ||
                t("login.maintenance.message")}
            </p>
          </div>
        </div>
      )}

      <div style={{ width: "100%", maxWidth: "360px" }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "36px" }}>
          <AppLogo
            alt="MakeChurchEazy"
            mode="dark"
            style={{ height: "130px", width: "130px" }}
          />
          <h1
            style={{
              fontSize: "20px",
              fontWeight: 600,
              color: "var(--text-primary)",
              marginBottom: "6px",
            }}
          >
            MakeChurchEazy
          </h1>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
            {t("login.subtitle")}
          </p>
        </div>

        {/* Initial View */}
        {view === "initial" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {error && (
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: "4px",
                  background: "rgba(239, 68, 68, 0.1)",
                  fontSize: "12px",
                  color: "#ef4444",
                }}
              >
                {error}
              </div>
            )}



            <button
              onClick={startQrLogin}
              style={{
                width: "100%",
                height: "42px",
                borderRadius: "var(--radius)",
                border: "1px solid var(--border)",
                background: "var(--surface-raised)",
                fontSize: "13px",
                fontWeight: 500,
                color: "var(--text-primary)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
              }}
              title={t("login.tooltip.scanQr")}>
              <QrCode size={16} />
              {t("login.btn.scanQr")}
            </button>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                margin: "4px 0",
              }}
            >
              <div style={{ flex: 1, height: "1px", background: "rgba(255, 255, 255, 0.12)" }} />
              <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>or</span>
              <div style={{ flex: 1, height: "1px", background: "rgba(255, 255, 255, 0.12)" }} />
            </div>

            <button
              onClick={async () => {
                setError("");
                resetPairingApiBase();
                const result = await createPairingCode("MakeChurchEazy");
                if ("error" in result) {
                  setError(result.error);
                  return;
                }
                setCode(result.code);
                setCountdown(300);
                setView("pairing");
                startWatching(result.code);
                await openPairingInBrowser(result.code);
              }}
              style={{
                width: "100%",
                height: "42px",
                borderRadius: "var(--radius)",
                border: "1px solid var(--border)",
                background: "var(--surface-raised)",
                fontSize: "13px",
                fontWeight: 500,
                color: "var(--text-primary)",
                cursor: "pointer",
              }}
              title="Continue">
              Continue in Browser
            </button>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                margin: "4px 0",
              }}
            >
              <div style={{ flex: 1, height: "1px", background: "rgba(255, 255, 255, 0.12)" }} />
              <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>or</span>
              <div style={{ flex: 1, height: "1px", background: "rgba(255, 255, 255, 0.12)" }} />
            </div>

            <button
              onClick={() => {
                setView("manual");
                setError("");
              }}
              style={{
                width: "100%",
                height: "42px",
                borderRadius: "var(--radius)",
                border: "1px solid var(--border)",
                background: "var(--surface-raised)",
                fontSize: "13px",
                fontWeight: 500,
                color: "var(--text-primary)",
                cursor: "pointer",
              }}
              title="Enter Pairing Code">
              Enter Pairing Code
            </button>

            <p
              style={{
                fontSize: "11px",
                color: "var(--text-muted)",
                marginTop: "12px",
                lineHeight: 1.5,
              }}
            >
              Get a pairing code from{" "}
              <span style={{ color: "var(--text-secondary)" }}>makechurcheazy.com/devices</span>
            </p>

          </div>
        )}

        {/* Pairing View — waiting for authorization */}
        {view === "pairing" && (
          <div style={{ textAlign: "center" }}>
            {regenError && (
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: "4px",
                  background: "rgba(239, 68, 68, 0.1)",
                  fontSize: "12px",
                  color: "#ef4444",
                  marginBottom: "12px",
                }}
              >
                {regenError}
              </div>
            )}

            {/* Generating spinner */}
            {regenerating ? (
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "8px" }}>
                  Generating a new authorization code...
                </div>
                <button
                  disabled
                  style={{
                    width: "100%",
                    height: "38px",
                    borderRadius: "var(--radius)",
                    border: "none",
                    background: "var(--primary)",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#fff",
                    cursor: "default",
                    opacity: 0.6,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                  }}
                >
                  <LoaderCircle size={14} style={{ animation: "spin 1s linear infinite" }} />
                  Generating...
                </button>
              </div>
            ) : (
              <>
            <div
              style={{
                marginBottom: "20px",
                fontFamily: "monospace",
                fontSize: "32px",
                fontWeight: 700,
                letterSpacing: "0.15em",
                color: "var(--accent-blue)",
              }}
            >
              {displayPairingCode}
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                marginBottom: "16px",
              }}
            >
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: countdown > 0 ? "#22c55e" : "#ef4444",
                  animation: countdown > 0 ? "pulse 2s infinite" : "none",
                }}
              />
              <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                {countdown > 0
                  ? `Waiting for authorization... ${formatCountdown(countdown)}`
                  : "Code expired"}
              </span>
            </div>

            {countdown > 0 ? (
              <>
                <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "12px" }}>
                  Check your browser to authorize this device.
                </p>
                <div style={{ marginBottom: "24px" }}>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button
                      onClick={() => openPairingInBrowser(code)}
                      style={{
                        flex: 1,
                        height: "36px",
                        borderRadius: "var(--radius)",
                        border: "1px solid #4F46E5",
                        background: "var(--primary)",
                        fontSize: "12px",
                        fontWeight: 600,
                        color: "#fff",
                        cursor: "pointer",
                      }}
                    >
                      Open in Browser
                    </button>
                    <button
                      onClick={() => {
                        const url = `${getDashboardBaseForAuth()}/device?code=${code}`;
                        navigator.clipboard.writeText(url).then(() => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        });
                      }}
                      style={{
                        flex: 1,
                        height: "36px",
                        borderRadius: "var(--radius)",
                        border: "1px solid var(--border)",
                        background: copied ? "#22c55e" : "var(--surface-raised)",
                        fontSize: "12px",
                        fontWeight: 500,
                        color: copied ? "#fff" : "var(--text-primary)",
                        cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                    >
                      {copied ? "✓ Copied" : "Copy Link"}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "16px", lineHeight: 1.5 }}>
                  This authorization code has expired.
                </p>
                <button
                  onClick={() => { setRegenError(""); handleRegenerate(); }}
                  style={{
                    width: "100%",
                    height: "38px",
                    borderRadius: "var(--radius)",
                    border: "none",
                    background: "var(--primary)",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#fff",
                    cursor: "pointer",
                    marginBottom: "8px",
                  }}
                >
                  Generate New Code
                </button>
              </>
            )}

            <button
              onClick={() => {
                cleanupRef.current?.();
                cleanupRef.current = null;
                setView("initial");
                setCode("");
                setError("");
                setRegenError("");
              }}
              style={{
                width: "100%",
                height: "38px",
                borderRadius: "4px",
                border: "1px solid #2a2a3a",
                background: "transparent",
                fontSize: "13px",
                fontWeight: 500,
                color: "var(--text-secondary)",
                cursor: "pointer",
              }}
              title="Cancel">
              Cancel
            </button>

            <style>{`
              @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.4; }
              }
            `}</style>
            </>
          )}
          </div>
        )}

        {/* Manual Code Entry */}
        {view === "manual" && (
          <div>
            {error && (
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: "4px",
                  background: "rgba(239, 68, 68, 0.1)",
                  fontSize: "12px",
                  color: "#ef4444",
                  marginBottom: "12px",
                }}
              >
                {error}
              </div>
            )}

            <label
              style={{
                display: "block",
                fontSize: "12px",
                fontWeight: 500,
                color: "var(--text-secondary)",
                marginBottom: "6px",
              }}
            >
              Enter pairing code
            </label>
            <p
              style={{
                fontSize: "11px",
                color: "var(--text-muted)",
                marginBottom: "10px",
                lineHeight: "1.5",
              }}
            >
              Generate a code from{" "}
              <span style={{ color: "var(--text-secondary)" }}>
                MakeChurchEazy
              </span>{" "}
              in your browser, then enter it here.
            </p>
            <input
              type="text"
              value={displayCode}
              onChange={(e) => {
                const raw = normalizePairingCode(e.target.value).slice(0, 8);
                setManualCode(raw);
              }}
              placeholder="ABCD-1234"
              autoFocus
              disabled={redeeming}
              onKeyDown={(e) => e.key === "Enter" && handleManualSubmit()}
              style={{
                width: "100%",
                height: "42px",
                borderRadius: "4px",
                border: "1px solid #2a2a3a",
                background: redeeming ? "var(--surface-raised)" : "var(--input-bg)",
                padding: "0 14px",
                fontSize: "18px",
                fontFamily: "monospace",
                fontWeight: 700,
                letterSpacing: "0.15em",
                color: redeeming ? "var(--text-muted)" : "var(--text-primary)",
                outline: "none",
                textAlign: "center",
                marginBottom: "12px",
                opacity: redeeming ? 0.7 : 1,
              }}
            />

            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => {
                  setView("initial");
                  setManualCode("");
                  setError("");
                }}
                style={{
                  flex: 1,
                  height: "38px",
                  borderRadius: "4px",
                  border: "1px solid #2a2a3a",
                  background: "transparent",
                  fontSize: "13px",
                  fontWeight: 500,
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                }}
                title="Go back">
                Back
              </button>
              <button
                onClick={handleManualSubmit}
                disabled={!manualCode || manualCode.length !== 8 || redeeming}
                style={{
                  flex: 2,
                  height: "38px",
                  borderRadius: "var(--radius)",
                  border: "none",
                  background: redeeming ? "#3a3a5a" : "var(--primary)",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#fff",
                  cursor: !manualCode || manualCode.length !== 8 || redeeming ? "default" : "pointer",
                  opacity: !manualCode || manualCode.length !== 8 ? 0.5 : 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                }}
                title="Authorize">
                {redeeming ? (
                  <>
                    <LoaderCircle size={14} style={{ animation: "spin 1s linear infinite" }} />
                    Pairing…
                  </>
                ) : "Authorize"}
              </button>
            </div>
          </div>
        )}

        {/* QR Code View */}
        {view === "qr" && (
          <div style={{ textAlign: "center" }}>
            {regenError && (
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: "4px",
                  background: "rgba(239, 68, 68, 0.1)",
                  fontSize: "12px",
                  color: "#ef4444",
                  marginBottom: "12px",
                }}
              >
                {regenError}
              </div>
            )}

            {regenerating ? (
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "12px" }}>
                  Generating a new authorization code...
                </div>
                <button
                  disabled
                  style={{
                    width: "100%",
                    height: "38px",
                    borderRadius: "var(--radius)",
                    border: "none",
                    background: "var(--primary)",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#fff",
                    cursor: "default",
                    opacity: 0.6,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                  }}
                >
                  <LoaderCircle size={14} style={{ animation: "spin 1s linear infinite" }} />
                  Generating...
                </button>
              </div>
            ) : (
              <>

            <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "16px" }}>
              Scan this QR code with your phone to log in
            </p>

            {qrDataUrl && (
              <div
                style={{
                  display: "inline-block",
                  padding: "12px",
                  borderRadius: "var(--radius)",
                  background: "#fff",
                  marginBottom: "16px",
                }}
              >
                <img
                  src={qrDataUrl}
                  alt="QR Code"
                  style={{ width: "240px", height: "240px", display: "block" }}
                />
              </div>
            )}

            {!qrDataUrl && (
              <div
                style={{
                  display: "inline-flex",
                  width: "240px",
                  height: "240px",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "var(--radius)",
                  background: "#16161f",
                  border: "1px solid #2a2a3a",
                  marginBottom: "16px",
                }}
              >
                <span style={{ color: "var(--text-muted)", fontSize: "13px" }}>Generating...</span>
              </div>
            )}

            <div
              style={{
                fontFamily: "monospace",
                fontSize: "20px",
                fontWeight: 700,
                letterSpacing: "0.15em",
                color: "var(--text-primary)",
                marginBottom: "8px",
              }}
            >
              {displayPairingCode}
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                marginBottom: "20px",
              }}
            >
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: countdown > 0 ? "#22c55e" : "#ef4444",
                  animation: countdown > 0 ? "pulse 2s infinite" : "none",
                }}
              />
              <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                {countdown > 0
                  ? `Expires in ${formatCountdown(countdown)}`
                  : "Code expired"}
              </span>
            </div>

            {countdown <= 0 && (
              <>
                <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "16px", lineHeight: 1.5 }}>
                  This authorization code has expired.
                </p>
                <button
                  onClick={() => { setRegenError(""); handleRegenerate(); }}
                  style={{
                    width: "100%",
                    height: "38px",
                    borderRadius: "var(--radius)",
                    border: "none",
                    background: "var(--primary)",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#fff",
                    cursor: "pointer",
                    marginBottom: "8px",
                  }}
                >
                  Generate New Code
                </button>
              </>
            )}

            <button
              onClick={() => {
                cleanupRef.current?.();
                cleanupRef.current = null;
                setView("initial");
                setCode("");
                setQrDataUrl("");
                setError("");
                setRegenError("");
              }}
              style={{
                width: "100%",
                height: "38px",
                borderRadius: "var(--radius)",
                border: "1px solid var(--border)",
                background: "transparent",
                fontSize: "13px",
                fontWeight: 500,
                color: "var(--text-secondary)",
                cursor: "pointer",
              }}
              title="Cancel">
              Cancel
            </button>

            <style>{`
              @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.4; }
              }
            `}</style>
            </>
          )}
          </div>
        )}

      </div>

      {/* Email Verification Modal */}
      {showVerificationModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.8)",
            zIndex: 9999,
            padding: "24px",
          }}
          onClick={(e) => {
            // Only close on backdrop click if not actively processing
            if (e.target === e.currentTarget && resendStatus !== "sending" && checkStatus !== "checking") {
              setShowVerificationModal(false);
              setView("initial");
            }
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "380px",
              background: "var(--surface)",
              borderRadius: "var(--radius)",
              border: "1px solid var(--border)",
              padding: "28px",
              boxShadow: "0 16px 48px rgba(0,0,0,0.6)",
            }}
          >
            {/* Icon */}
            <div style={{ textAlign: "center", marginBottom: "20px" }}>
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "50%",
                  background: "rgba(239, 68, 68, 0.1)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: "12px",
                }}
              >
                <Mail size={24} color="var(--error)" />
              </div>
              <h2 style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", margin: "0 0 6px" }}>
                Email Verification Required
              </h2>
              <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
                {verificationMessage}
              </p>
              {verificationEmail && (
                <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "8px 0 0", wordBreak: "break-all" }}>
                  {verificationName ? `${verificationName} — ` : ""}{verificationEmail}
                </p>
              )}
            </div>

            {/* Close / cancel */}
            <button
              onClick={() => {
                setShowVerificationModal(false);
                setView("initial");
                setCode("");
                setError("");
              }}
              style={{
                width: "100%",
                height: "36px",
                borderRadius: "4px",
                border: "none",
                background: "transparent",
                fontSize: "12px",
                fontWeight: 500,
                color: "var(--text-muted)",
                cursor: "pointer",
              }}
              title="Cancel">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Welcome back toast */}
      {welcomeBack && (
        <div
          style={{
            position: "fixed",
            top: "20px",
            right: "20px",
            zIndex: 100,
            animation: "slideIn 0.3s ease-out",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px 16px",
              borderRadius: "var(--radius)",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            }}
          >
            <div
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "50%",
                background: "var(--primary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "14px",
                fontWeight: 700,
                color: "#fff",
              }}
            >
              ✓
            </div>
            <div>
              <p style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>
                Welcome back
              </p>
              <p style={{ fontSize: "11px", color: "var(--text-secondary)", margin: 0 }}>
                Good to see you again.
              </p>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
            `}</style>
    </div>
  );
}
