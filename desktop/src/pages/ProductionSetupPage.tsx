/**
 * ProductionSetupPage.tsx — "OBS & vMix setup": pick the streaming software,
 * then follow its steps. OBS gets the Dock as a custom browser dock; vMix gets
 * the Dock in its own window that can stay on top of vMix.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, Check, Copy, Monitor, Tv } from "../components/icons/NativeIcons";
import { useAuth } from "../contexts/AuthContext";
import { writeDockOutputSoftware } from "../dock/dockOutputSoftware";
import { getEffectivePlan } from "../services/licenseService";
import { obsService, type ConnectionStatus } from "../services/obsService";
import { useDockBaseUrl } from "../services/overlayUrl";
import { VmixClient, loadVmixSettings } from "../services/vmixClient";
import { isVmixDockPinned, openVmixDockWindow, setVmixDockPinned } from "../services/vmixDockWindow";
import { getPreferredWorkspace, setPreferredWorkspace } from "../services/workspacePreference";
import "./ProductionSetupPage.css";

type Software = "obs" | "vmix";

const VMIX_POLL_MS = 3000;

function useCopy(): [string | null, (id: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback((id: string, text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      window.setTimeout(() => setCopied((current) => (current === id ? null : current)), 2000);
    });
  }, []);
  return [copied, copy];
}

function Step({ n, done, title, children }: { n: number; done?: boolean; title: string; children: React.ReactNode }) {
  return (
    <li className={`setup-step${done ? " setup-step--done" : ""}`}>
      <span className="setup-step__mark" aria-hidden="true">{done ? <Check size={12} /> : n}</span>
      <div className="setup-step__body">
        <h3 className="setup-step__title">{title}</h3>
        {children}
      </div>
    </li>
  );
}

function VmixSetup({ isFreePlan }: { isFreePlan: boolean }) {
  const [vmixVersion, setVmixVersion] = useState<string | null>(null);
  const [pinned, setPinned] = useState(() => isVmixDockPinned());
  const [error, setError] = useState("");
  const settings = useMemo(() => loadVmixSettings(), []);

  useEffect(() => {
    const client = new VmixClient(settings);
    let cancelled = false;
    const check = () => {
      client.getStatus()
        .then((status) => { if (!cancelled) setVmixVersion(status.version || "?"); })
        .catch(() => { if (!cancelled) setVmixVersion(null); });
    };
    check();
    const timer = window.setInterval(check, VMIX_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [settings]);

  const openDock = useCallback(() => {
    setError("");
    setPreferredWorkspace("vmix");
    openVmixDockWindow().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const togglePinned = useCallback((next: boolean) => {
    setPinned(next);
    void setVmixDockPinned(next).catch(() => undefined);
  }, []);

  return (
    <section className="app-surface setup-panel" aria-labelledby="setup-vmix-title">
      <div className="app-surface__header">
        <div>
          <h2 id="setup-vmix-title" className="app-surface__title">Set up vMix</h2>
          <p className="setup-panel__lead">
            Do this once. After that, every verse, song or name you click appears over your vMix cameras.
          </p>
        </div>
      </div>
      <div className="app-surface__body">
        {isFreePlan && (
          <div className="app-banner app-banner--warning setup-panel__banner">
            <div className="app-banner__content">
              <AlertCircle size={16} />
              <span>
                Controlling vMix is part of the paid plans. On the free plan the Dock shows content through the presentation link instead.
              </span>
            </div>
          </div>
        )}
        <ol className="setup-steps">
          <Step n={1} done={Boolean(vmixVersion)} title="Turn on vMix's Web Controller">
            <p>In vMix, open <strong>Settings → Web Controller</strong>, tick <strong>Enable</strong> and keep the port at {settings.port}.</p>
            <p className={`setup-status${vmixVersion ? " setup-status--ok" : ""}`} role="status">
              <span className="setup-status__dot" aria-hidden="true" />
              {vmixVersion ? `vMix found (version ${vmixVersion})` : `Waiting for vMix at ${settings.host}:${settings.port}…`}
            </p>
          </Step>
          <Step n={2} title="Open the Dock">
            <p>The Dock opens in its own window. Put it beside vMix.</p>
            <div className="setup-actions">
              <button type="button" className="app-btn app-btn--primary" onClick={openDock}>
                <Tv size={16} /> Open Dock
              </button>
              <label className="setup-check">
                <input type="checkbox" checked={pinned} onChange={(e) => togglePinned(e.target.checked)} />
                <span>Keep the Dock on top of vMix</span>
              </label>
            </div>
            {error && <p className="obs-error" role="alert">{error}</p>}
          </Step>
          <Step n={3} title="Click “Set up vMix” in the Dock">
            <p>
              It adds one input to vMix, <strong>MCE Presentation</strong>, on Overlay 1. It&apos;s a vMix title that vMix
              draws itself, so it updates instantly and barely uses the computer. Your own inputs are not changed.
            </p>
            <p className="setup-note">
              Already have your own vMix titles, or prefer vMix&apos;s built-in Scripture and Songs titles? Pick them in the
              Dock&apos;s vMix card for Bible verses, songs or names; MakeChurchEazy fills them in and leaves their design
              alone.
            </p>
            <p className="setup-note">
              Want MakeChurchEazy&apos;s full themes instead? In the Dock&apos;s vMix settings choose “Full themes” under
              Output. It looks richer but uses more CPU.
            </p>
          </Step>
          <Step n={4} title="Present from the Dock">
            <p>
              Click a verse, song or note and it comes in over your live camera. Hide takes it out. You never have to
              type a verse into vMix.
            </p>
          </Step>
        </ol>
      </div>
    </section>
  );
}

function ObsSetup() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<ConnectionStatus>(obsService.status);
  const [copied, copy] = useCopy();
  const base = useDockBaseUrl();
  const dockUrl = `${base}/dock`;
  const assistantUrl = `${base}/lm-dock`;

  useEffect(() => obsService.onStatusChange((next) => setStatus(next)), []);

  const connect = useCallback(async () => {
    setPreferredWorkspace("obs");
    writeDockOutputSoftware("obs");
    try {
      await obsService.connect();
      window.setTimeout(() => {
        if (obsService.status !== "connected") navigate("/settings?tab=obs");
      }, 1500);
    } catch {
      navigate("/settings?tab=obs");
    }
  }, [navigate]);

  const connected = status === "connected";

  return (
    <section className="app-surface setup-panel" aria-labelledby="setup-obs-title">
      <div className="app-surface__header">
        <div>
          <h2 id="setup-obs-title" className="app-surface__title">Set up OBS Studio</h2>
          <p className="setup-panel__lead">
            Do this once. The Dock then lives inside OBS and puts verses, lyrics and lower thirds into your scenes.
          </p>
        </div>
      </div>
      <div className="app-surface__body">
        <ol className="setup-steps">
          <Step n={1} done={connected} title="Connect to OBS">
            <p>In OBS, open <strong>Tools → WebSocket Server Settings</strong> and tick <strong>Enable WebSocket server</strong>. Then connect.</p>
            <div className="setup-actions">
              <button type="button" className="app-btn app-btn--primary" onClick={() => void connect()} disabled={connected}>
                {connected ? <Check size={16} /> : <Monitor size={16} />}
                {connected ? "OBS connected" : "Connect to OBS"}
              </button>
            </div>
          </Step>
          <Step n={2} title="Add the Dock to OBS">
            <p>
              In OBS choose <strong>Docks → Custom Browser Docks</strong>, name it “MakeChurchEazy”, paste this link and click Apply.
            </p>
            <div className="setup-link">
              <input readOnly value={dockUrl} aria-label="Dock link" />
              <button type="button" className="app-btn" onClick={() => copy("dock", dockUrl)}>
                {copied === "dock" ? <Check size={14} /> : <Copy size={14} />}
                {copied === "dock" ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="setup-note">
              Optional: add the Scripture Assistant the same way. It shows Bible references as the preacher speaks.
            </p>
            <div className="setup-link">
              <input readOnly value={assistantUrl} aria-label="Scripture Assistant link" />
              <button type="button" className="app-btn" onClick={() => copy("assistant", assistantUrl)}>
                {copied === "assistant" ? <Check size={14} /> : <Copy size={14} />}
                {copied === "assistant" ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="setup-note">These are Dock links, not Browser Sources. Don't add them under Sources.</p>
          </Step>
          <Step n={3} title="Present from the Dock">
            <p>Click a verse, song or note in the Dock inside OBS. MakeChurchEazy creates its scenes and sources for you.</p>
          </Step>
        </ol>
      </div>
    </section>
  );
}

export default function ProductionSetupPage() {
  const { user } = useAuth();
  const isFreePlan = Boolean(user) && getEffectivePlan(user) === "free";
  const [software, setSoftware] = useState<Software>(() => (getPreferredWorkspace() === "vmix" ? "vmix" : "obs"));

  const options: Array<{ id: Software; title: string; desc: string }> = [
    { id: "obs", title: "OBS Studio", desc: "The Dock sits inside OBS and builds your scenes." },
    { id: "vmix", title: "vMix", desc: "The Dock sits beside vMix and drives its overlays." },
  ];

  return (
    <div className="app-page">
      <div className="app-page__inner setup-page">
        <header className="app-page__header">
          <div className="app-page__header-copy">
            <p className="app-page__eyebrow">Setup</p>
            <h1 className="app-page__title">OBS &amp; vMix setup</h1>
            <p className="app-page__subtitle">
              What do you stream with? Pick it, follow the steps once, then present everything from the Dock.
            </p>
          </div>
        </header>

        <div className="setup-choice" role="radiogroup" aria-label="Streaming software">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={software === option.id}
              className={`setup-choice__option${software === option.id ? " setup-choice__option--active" : ""}`}
              onClick={() => setSoftware(option.id)}
            >
              <span className="setup-choice__title">{option.title}</span>
              <span className="setup-choice__desc">{option.desc}</span>
            </button>
          ))}
        </div>

        {software === "vmix" ? <VmixSetup isFreePlan={isFreePlan} /> : <ObsSetup />}
      </div>
    </div>
  );
}
