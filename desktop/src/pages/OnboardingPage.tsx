/**
 * OnboardingPage — Desktop onboarding wizard for MakeChurchEazy.
 *
 * Flow: Choose workspace → Connect OBS (when selected) → Install Dock → Ready
 *
 * Every step fires a milestone to the backend.
 * Persisted in localStorage so future launches skip straight to dashboard.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowRight,
  ExternalLink,
  Copy,
  Check,
  ChevronRight,
  CheckCircle,
  Loader2,
  AlertTriangle,
  Play,
  LayoutDashboard,
  LogOut,
  Church,
  MonitorPlay,
  Clapperboard,
  Tv,
} from "../components/icons/NativeIcons";
import { obsService } from "../services/obsService";
import { useDockBaseUrl } from "../services/overlayUrl";
import { getDeviceId } from "../services/authService";
import { useAuth } from "../contexts/AuthContext";
import { track } from "../services/analytics";
import {
  trackEvent as trackProductEvent,
  trackObsConnected as trackObsConnectedBackend,
} from "../services/tracking";
import { getDefaultOBSPort } from "../services/desktopConfig";
import { persistOBSWebSocketConfig } from "../services/obsConnectionSettings";
import {
  completeWorkspaceOnboarding,
  isOnboardingCompleted,
  markStudioWelcomePending,
  setPreferredWorkspace,
  type PreferredWorkspace,
} from "../services/workspacePreference";
import "./OnboardingPage.css";

/* ── Constants ── */
const STORAGE_KEY = "mce-onboarding-complete";
const STEP_KEY = "mce-onboarding-step";
const FLOW_VERSION_KEY = "mce-onboarding-flow-version";
const FLOW_VERSION = 5;
const TOTAL_STEPS = 4;

const API_BASE =
  import.meta.env.VITE_AUTH_API_URL ||
  "https://api.makechurcheazy.com";

const STEP_NAMES = [
  "Workspace",
  "OBS Connection",
  "OBS Docks",
  "Ready",
];

type OnboardingTutorial = {
  title: string;
  description: string;
  videoId: string;
  watchUrl: string;
  startAt?: number;
};

/**
 * Keep onboarding videos in one place so they can be replaced without
 * changing the step components or the tutorial panel layout.
 */
const ONBOARDING_TUTORIALS: Record<number, OnboardingTutorial> = {
  2: {
    title: "Connect MakeChurchEazy to OBS",
    description: "Follow the OBS connection setup before moving on.",
    videoId: "i-WnFFnuCMA",
    watchUrl: "https://youtu.be/i-WnFFnuCMA?si=bnyZ0huirCa_oIaZ&t=16",
    startAt: 16,
  },
  3: {
    title: "Install MakeChurchEazy Dock",
    description: "Learn how to add the MakeChurchEazy Dock to OBS.",
    videoId: "i-WnFFnuCMA",
    watchUrl: "https://youtu.be/i-WnFFnuCMA?si=LwLanAr5wZmXxVyR&t=83",
    startAt: 83,
  },
};

/* ── Helpers ── */
function readLocalValue(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeLocalValue(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* Onboarding can continue for this session. */ }
}

function removeLocalValue(key: string): void {
  try { localStorage.removeItem(key); } catch { /* Ignore unavailable browser storage. */ }
}

function readSessionValue(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

function writeSessionValue(key: string, value: string): void {
  try { sessionStorage.setItem(key, value); } catch { /* Analytics must not block setup. */ }
}

function isOnboardingComplete(): boolean {
  return isOnboardingCompleted();
}

function getSavedStep(): number {
  const raw = readLocalValue(STEP_KEY);
  let savedStep = 1;
  if (raw != null) {
    const n = parseInt(raw, 10);
    if (n >= 1) savedStep = n;
  }

  // Migrate earlier flow versions
  const savedVersion = parseInt(
    readLocalValue(FLOW_VERSION_KEY) || "1",
    10,
  );
  if (raw != null && savedVersion < 2 && savedStep >= 3) {
    savedStep += 1;
  }
  if (raw != null && savedVersion < 3 && savedStep >= 3) {
    savedStep = savedStep === 3 ? 3 : savedStep - 1;
  }
  if (raw != null && savedVersion < 4 && savedStep >= 4) {
    savedStep = 4;
  }

  const normalizedStep = Math.min(savedStep, TOTAL_STEPS);
  writeLocalValue(FLOW_VERSION_KEY, String(FLOW_VERSION));
  writeLocalValue(STEP_KEY, String(normalizedStep));
  return normalizedStep;
}

function saveStep(step: number) {
  writeLocalValue(STEP_KEY, String(step));
  writeLocalValue(FLOW_VERSION_KEY, String(FLOW_VERSION));
}

function completeOnboarding() {
  completeWorkspaceOnboarding();
  removeLocalValue(STORAGE_KEY + "-theme-id");

  // Guard: ensure backend complete endpoint is called only once
  if (readLocalValue(STORAGE_KEY + "-api-reported") === "true") {
    return;
  }
  writeLocalValue(STORAGE_KEY + "-api-reported", "true");

  try {
    const deviceId = getDeviceId();
    fetch(`${API_BASE}/api/onboarding/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(deviceId ? { "X-Device-Id": deviceId } : {}),
      },
      body: JSON.stringify({
        timezone:
          Intl.DateTimeFormat().resolvedOptions().timeZone || "(GMT+00:00) UTC",
      }),
    }).catch(() => { });
  } catch {
    // Not critical
  }
}

function fireMilestone(milestone: string) {
  // Guard: ensure each milestone is only fired once per install
  const milestoneKey = `mce-milestone-${milestone}`;
  if (readLocalValue(milestoneKey) === "true") {
    return;
  }
  writeLocalValue(milestoneKey, "true");

  try {
    const deviceId = getDeviceId();
    fetch(`${API_BASE}/api/onboarding/milestone`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(deviceId ? { "X-Device-Id": deviceId } : {}),
      },
      body: JSON.stringify({ milestone, timestamp: new Date().toISOString() }),
    }).catch(() => { });
  } catch {
    // Not critical
  }
}

/**
 * The video guide for a setup step. It is a card: a picture of the video and a Watch button. The video
 * opens on YouTube in the person's browser. (YouTube refuses to play an embedded video inside the
 * desktop app's windows, which showed "Error 153", so it is never played in here.)
 */
function OnboardingTutorialPanel({ step }: { step: number }) {
  const tutorial = ONBOARDING_TUTORIALS[step] ?? ONBOARDING_TUTORIALS[2];

  const openTutorial = useCallback(() => {
    void openUrl(tutorial.watchUrl).catch(() => {
      window.open(tutorial.watchUrl, "_blank", "noopener,noreferrer");
    });
  }, [tutorial.watchUrl]);

  return (
    <aside className="ob-tutorial-panel" aria-label={`Step ${step} tutorial`}>
      <div className="ob-tutorial-header">
        <div className="ob-tutorial-heading">
          <span className="ob-tutorial-kicker">Video Guide</span>
          <h2>{tutorial.title}</h2>
        </div>
      </div>

      <button
        type="button"
        className="ob-tutorial-card"
        onClick={openTutorial}
        title="Opens on YouTube in your browser"
        aria-label={`Watch on YouTube: ${tutorial.title}`}
      >
        <img src={`https://i.ytimg.com/vi/${tutorial.videoId}/hqdefault.jpg`} alt="" loading="lazy" />
        <span className="ob-tutorial-card__play" aria-hidden="true">
          <Play size={26} fill="currentColor" />
        </span>
      </button>
      <p className="ob-tutorial-note">{tutorial.description}</p>

      <div className="ob-tutorial-footer">
        <span className="ob-tutorial-playing">
          <span className="ob-tutorial-live-dot" />
          Step {step} Walkthrough
        </span>
        <button
          className="ob-tutorial-watch-btn"
          type="button"
          onClick={openTutorial}
          title="Watch tutorial on YouTube"
        >
          <span>Watch on YouTube</span>
          <ExternalLink size={12} />
        </button>
      </div>
    </aside>
  );
}

/* ── Resume Banner (exported for dashboard) ── */
export function OnboardingResumeBanner() {
  const navigate = useNavigate();

  if (isOnboardingComplete()) return null;

  const step = getSavedStep();
  const remaining = TOTAL_STEPS - step + 1;

  return (
    <div
      className="ob-resume-banner"
      onClick={() => navigate("/onboarding")}
    >
      <AlertTriangle size={16} />
      <span className="ob-resume-text">Complete Setup</span>
      <span className="ob-resume-steps">
        {remaining} step{remaining !== 1 ? "s" : ""} remaining
      </span>
      <ChevronRight size={14} className="ob-resume-arrow" />
    </div>
  );
}

/* ── Main Component ── */
export default function OnboardingPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(() => getSavedStep());
  const [showSkipModal, setShowSkipModal] = useState(false);
  const showTutorial = step === 2 || step === 3;

  const goNext = useCallback(() => {
    if (step < TOTAL_STEPS) {
      const next = step + 1;
      setStep(next);
      saveStep(next);
      track("onboarding_step_completed", {
        step: STEP_NAMES[next - 1] ?? String(next),
      });
      trackProductEvent("onboarding_step_completed", {
        step: STEP_NAMES[next - 1] ?? String(next),
      });
    }
  }, [step]);

  const goPrev = useCallback(() => {
    if (step > 1) {
      const prev = step - 1;
      setStep(prev);
      saveStep(prev);
    }
  }, [step]);

  const hasFinishedRef = useRef(false);

  const finish = useCallback(() => {
    if (hasFinishedRef.current) return;
    hasFinishedRef.current = true;

    const alreadyReported = readLocalValue("mce-onboarding-completed-reported") === "true";
    if (!alreadyReported) {
      writeLocalValue("mce-onboarding-completed-reported", "true");
      fireMilestone("desktopOnboardingCompletedAt");
      track("onboarding_completed");
      trackProductEvent("onboarding_completed");
    }
    completeOnboarding();
    navigate("/", { replace: true });
  }, [navigate]);

  const skip = useCallback(() => {
    if (hasFinishedRef.current) return;
    hasFinishedRef.current = true;

    const alreadyReported = readLocalValue("mce-onboarding-completed-reported") === "true";
    if (!alreadyReported) {
      writeLocalValue("mce-onboarding-completed-reported", "true");
      track("onboarding_skipped");
      trackProductEvent("onboarding_skipped");
    }
    completeOnboarding();
    navigate("/", { replace: true });
  }, [navigate]);

  const chooseWorkspace = useCallback((choice: PreferredWorkspace) => {
    setPreferredWorkspace(choice);
    if (choice === "obs") {
      setStep(2);
      saveStep(2);
      track("onboarding_step_completed", { step: "Workspace" });
      trackProductEvent("onboarding_step_completed", { step: "Workspace" });
      return;
    }

    if (hasFinishedRef.current) return;
    hasFinishedRef.current = true;
    markStudioWelcomePending();
    const alreadyReported = readLocalValue("mce-onboarding-completed-reported") === "true";
    if (!alreadyReported) {
      writeLocalValue("mce-onboarding-completed-reported", "true");
      fireMilestone("desktopOnboardingCompletedAt");
      track("onboarding_completed", { workspace: "studio" });
      trackProductEvent("onboarding_completed", { workspace: "studio" });
    }
    completeOnboarding();
    navigate("/studio", { replace: true });
  }, [navigate]);

  useEffect(() => {
    const startedKey = "mce-onboarding-started-reported";
    if (!readSessionValue(startedKey) && !readLocalValue(STORAGE_KEY)) {
      writeSessionValue(startedKey, "true");
      track("onboarding_started");
      trackProductEvent("onboarding_started");
      fireMilestone("desktopOnboardingStartedAt");
    }
  }, []);

  return (
    <div className="ob-root">
      {/* Integrated Header Bar */}
      <header className="ob-navbar">
        <div className="ob-navbar-brand">
          <div className="ob-brand-badge">
            <Church size={14} />
          </div>
          <div className="ob-brand-info">
            <span className="ob-brand-name">MakeChurchEazy</span>
            <span className="ob-brand-sub">Setup Guide</span>
          </div>
        </div>

        {step === 1 ? (
          <div className="ob-workspace-progress">Step 1 of 2 <span>·</span> Workspace setup</div>
        ) : <nav className="ob-step-nav" aria-label="Setup steps">
          {STEP_NAMES.map((name, i) => {
            const s = i + 1;
            const isDone = s < step;
            const isActive = s === step;
            return (
              <div
                key={i}
                className={`ob-nav-item${isActive ? " is-active" : ""}${isDone ? " is-done" : ""}`}
              >
                <span className="ob-nav-num">
                  {isDone ? <Check size={11} strokeWidth={3} /> : s}
                </span>
                <span className="ob-nav-label">{name}</span>
                {i < STEP_NAMES.length - 1 && <span className="ob-nav-divider" />}
              </div>
            );
          })}
        </nav>}

        <div className="ob-navbar-actions">
          <button
            type="button"
            className="ob-logout-btn"
            onClick={logout}
            title="Log out"
            aria-label="Log out"
          >
            <LogOut size={13} aria-hidden="true" />
            <span>Log out</span>
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="ob-content">
        <div className={`ob-layout${showTutorial ? " ob-layout--with-tutorial" : ""}${step === 3 ? " ob-layout--dock-step" : ""}`}>
          <main className="ob-step-stage">
            {step === 1 && <StepChooseWorkspace onChoose={chooseWorkspace} />}
            {step === 2 && (
              <StepConnectOBS onNext={goNext} onBack={goPrev} />
            )}
            {step === 3 && (
              <StepInstallDock onNext={goNext} onBack={goPrev} />
            )}
            {step === 4 && <StepReady onFinish={finish} onBack={goPrev} />}
          </main>
          {showTutorial && <OnboardingTutorialPanel step={step} />}
        </div>
      </div>

      {/* Skip modal */}
      {showSkipModal && (
        <div
          className="ob-modal-overlay"
          onClick={() => setShowSkipModal(false)}
        >
          <div className="ob-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Skip Setup?</h3>
            <p>
              Some features may not work until setup is completed. You can
              resume setup later from the dashboard.
            </p>
            <div className="ob-modal-actions">
              <button
                className="ob-btn ob-btn--ghost"
                onClick={() => setShowSkipModal(false)}
                title="Continue">
                Continue Setup
              </button>
              <button className="ob-btn ob-btn--primary" onClick={skip} title="Skip">
                Skip for Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Step 1 — Choose a workspace
   ══════════════════════════════════════════════════════════════ */

function StepChooseWorkspace({ onChoose }: { onChoose: (workspace: PreferredWorkspace) => void }) {
  return (
    <section className="ob-workspace-step" aria-labelledby="ob-workspace-title">
      <div className="ob-workspace-intro">
        <span className="ob-welcome-pill"><MonitorPlay size={13} /> Choose your workspace</span>
        <h1 id="ob-workspace-title">How would you like to get started?</h1>
        <p>Choose your preferred production workspace to continue.</p>
      </div>
      <div className="ob-workspace-options">
        <article className="ob-workspace-option ob-workspace-option--recommended">
          <div className="ob-workspace-option__top">
            <span className="ob-workspace-option__icon"><MonitorPlay size={22} /></span>
            <span className="ob-workspace-option__badge">Recommended</span>
          </div>
          <h2>MakeChurchEazy Studio</h2>
          <p>Run your church presentation directly. No OBS required.</p>
          <button type="button" className="ob-btn ob-btn--primary ob-workspace-option__action" onClick={() => onChoose("studio")}>
            Continue with Studio <ArrowRight size={16} />
          </button>
        </article>
        <article className="ob-workspace-option">
          <div className="ob-workspace-option__top">
            <span className="ob-workspace-option__icon"><Clapperboard size={22} /></span>
          </div>
          <h2>OBS Studio</h2>
          <p>Connect to OBS for livestreaming and production control.</p>
          <button type="button" className="ob-btn ob-btn--secondary ob-workspace-option__action" onClick={() => onChoose("obs")}>
            Set up OBS <ArrowRight size={16} />
          </button>
        </article>
        <article className="ob-workspace-option ob-workspace-option--disabled" aria-disabled="true">
          <div className="ob-workspace-option__top">
            <span className="ob-workspace-option__icon"><Tv size={22} /></span>
            <span className="ob-workspace-option__badge ob-workspace-option__badge--soon">Coming soon</span>
          </div>
          <h2>vMix</h2>
          <p>Professional video production integration.</p>
          <button type="button" className="ob-btn ob-btn--secondary ob-workspace-option__action" disabled>Coming soon</button>
        </article>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════
   Step 2 — Connect OBS
   ══════════════════════════════════════════════════════════════ */

function StepConnectOBS({
  onNext,
  onBack,
}: {
  onNext: () => void;
  onBack: () => void;
}) {
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState(getDefaultOBSPort());
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<
    "idle" | "checking" | "connected" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const testConnection = useCallback(async () => {
    setStatus("checking");
    setErrorMsg("");
    try {
      const url = `ws://${host}:${port}`;
      await obsService.connect(url, password || undefined);
      await new Promise((r) => setTimeout(r, 500));
      if (obsService.isConnected) {
        await persistOBSWebSocketConfig(url, password || undefined, true);
        setStatus("connected");
        trackObsConnectedBackend();
        fireMilestone("firstDesktopLoginAt");
      } else {
        setStatus("error");
        setErrorMsg(obsService.error || "Connection failed");
      }
    } catch (err: unknown) {
      setStatus("error");
      setErrorMsg(
        err instanceof Error ? err.message : "Could not connect to OBS",
      );
    }
  }, [host, port, password]);

  return (
    <div className="ob-card">
      <div className="ob-card-header">
        <div>
          <h1 className="ob-card-title">Connect OBS Studio</h1>
          <p className="ob-card-subtitle">
            Verify that OBS Studio is running on your computer.
          </p>
        </div>

        <div className={`ob-status-pill ob-status-pill--${status}`}>
          <span className="ob-status-dot" />
          <span>
            {status === "connected"
              ? "Connected"
              : status === "checking"
                ? "Connecting..."
                : "Not Connected"}
          </span>
        </div>
      </div>

      {status === "error" && errorMsg && (
        <div className="ob-status-error-banner">
          <AlertTriangle size={14} />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="ob-obs-tip">
        <strong>In OBS Studio:</strong> Tools → WebSocket Server Settings → Enable WebSocket Server (Port 4455).
      </div>

      <div className="ob-form">
        <div className="ob-form-row">
          <div className="ob-field">
            <label>Host</label>
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="localhost"
            />
          </div>
          <div className="ob-field">
            <label>Port</label>
            <input
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="4455"
            />
          </div>
        </div>
        <div className="ob-field">
          <label>Password (optional)</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter OBS WebSocket password if configured"
          />
        </div>
      </div>

      <div className="ob-card-footer">
        <button className="ob-btn ob-btn--ghost" onClick={onBack} title="Go back">
          Back
        </button>
        <div className="ob-footer-actions">
          <button
            className="ob-btn ob-btn--secondary"
            onClick={testConnection}
            title="Test Connection"
          >
            {status === "checking" ? (
              <Loader2
                size={14}
                style={{ animation: "spin 1s linear infinite" }}
              />
            ) : (
              <Play size={14} />
            )}
            <span>Test Connection</span>
          </button>
          <button
            className="ob-btn ob-btn--primary"
            disabled={status !== "connected"}
            onClick={onNext}
            title="Continue"
          >
            <span>Continue</span>
            <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Step 3 — Install Dock
   ══════════════════════════════════════════════════════════════ */

function StepInstallDock({
  onNext,
  onBack,
}: {
  onNext: () => void;
  onBack: () => void;
}) {
  const [copied, setCopied] = useState<"dock" | "ai" | null>(null);
  const base = useDockBaseUrl();
  const dockUrl = `${base}/dock`;
  const aiUrl = `${base}/lm-dock`;

  const copyUrl = async (url: string, which: "dock" | "ai") => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <div className="ob-card">
      <div className="ob-card-header">
        <div>
          <h1 className="ob-card-title">Install OBS Docks</h1>
          <p className="ob-card-subtitle">
            Add these custom browser docks inside OBS to control presentations.
          </p>
        </div>
      </div>

      <div className="ob-obs-tip">
        <strong>In OBS Studio:</strong> Go to <strong>Docks → Custom Browser Docks</strong> and paste each URL.
      </div>

      <div className="ob-url-cards-row">
        {/* Bible Overlay Dock */}
        <div className="ob-url-card">
          <div className="ob-url-card-header">
            <span className="ob-url-card-title">Bible Control Dock</span>
            {copied === "dock" && (
              <span className="ob-copied-badge"><Check size={11} /> Copied</span>
            )}
          </div>
          <div className="ob-url-input-row">
            <input className="ob-url-input" readOnly value={dockUrl} />
            <button
              className="ob-btn ob-btn--primary ob-url-copy-btn"
              onClick={() => copyUrl(dockUrl, "dock")}
              title="Copy"
            >
              <Copy size={13} />
              <span>{copied === "dock" ? "Copied" : "Copy"}</span>
            </button>
          </div>
          <p className="ob-url-desc">
            Search scriptures and control live lower thirds.
          </p>
        </div>

        {/* Scripture Assistant */}
        <div className="ob-url-card">
          <div className="ob-url-card-header">
            <span className="ob-url-card-title">Scripture Assistant</span>
            {copied === "ai" && (
              <span className="ob-copied-badge"><Check size={11} /> Copied</span>
            )}
          </div>
          <div className="ob-url-input-row">
            <input className="ob-url-input" readOnly value={aiUrl} />
            <button
              className="ob-btn ob-btn--primary ob-url-copy-btn"
              onClick={() => copyUrl(aiUrl, "ai")}
              title="Copy"
            >
              <Copy size={13} />
              <span>{copied === "ai" ? "Copied" : "Copy"}</span>
            </button>
          </div>
          <p className="ob-url-desc">
            Detects spoken Bible verses live during preaching.
          </p>
        </div>
      </div>

      <div className="ob-card-footer">
        <button className="ob-btn ob-btn--ghost" onClick={onBack} title="Go back">
          Back
        </button>
        <button className="ob-btn ob-btn--primary" onClick={onNext} title="Continue">
          <span>Continue</span>
          <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Step 4 — Ready
   ══════════════════════════════════════════════════════════════ */

function StepReady({
  onFinish,
}: {
  onFinish: () => void;
  onBack?: () => void;
}) {
  return (
    <div className="ob-card ob-card--ready">
      <div className="ob-ready-hero">
        <div className="ob-ready-icon">
          <CheckCircle size={36} />
        </div>
        <h1 className="ob-card-title">Setup Complete</h1>
        <p className="ob-card-subtitle">
          MakeChurchEazy is configured and ready for live presentation.
        </p>
      </div>

      <div className="ob-summary-grid">
        <div className="ob-summary-item">
          <Check size={14} className="ob-summary-check" />
          <span>OBS Connected</span>
        </div>
        <div className="ob-summary-item">
          <Check size={14} className="ob-summary-check" />
          <span>Bible Resources Ready</span>
        </div>
        <div className="ob-summary-item">
          <Check size={14} className="ob-summary-check" />
          <span>Custom Docks Available</span>
        </div>
        <div className="ob-summary-item">
          <Check size={14} className="ob-summary-check" />
          <span>Verse AI Active</span>
        </div>
      </div>

      <div className="ob-ready-actions">
        <button
          className="ob-btn ob-btn--primary ob-ready-btn"
          onClick={onFinish}
          title="Go to Dashboard"
        >
          <LayoutDashboard size={16} />
          <span>Go to Dashboard</span>
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
