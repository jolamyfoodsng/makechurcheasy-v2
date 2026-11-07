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
import { buildMceVmixInputUrl, resolveVmixPresentationLink } from "../services/vmixSetup";
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

/** One numbered step: a short title, one line of instruction, and its button on the right. */
function Step({
  n,
  done,
  title,
  action,
  children,
}: {
  n: number;
  done?: boolean;
  title: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <li className={`setup-step${done ? " setup-step--done" : ""}`}>
      <span className="setup-step__mark" aria-hidden="true">{done ? <Check size={14} /> : n}</span>
      <div className="setup-step__body">
        <h3 className="setup-step__title">{title}</h3>
        {children}
      </div>
      {action ? <div className="setup-step__action">{action}</div> : null}
    </li>
  );
}

/** Read-only link with a Copy button. */
function CopyLink({ id, label, value, copied, onCopy }: { id: string; label: string; value: string; copied: string | null; onCopy: (id: string, text: string) => void }) {
  return (
    <div className="setup-link">
      <input readOnly value={value || "Getting the link…"} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <button type="button" className="app-btn" onClick={() => onCopy(id, value)} disabled={!value}>
        {copied === id ? <Check size={14} /> : <Copy size={14} />}
        {copied === id ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/**
 * vMix on the free plan: MakeChurchEazy creates and changes nothing in vMix
 * (as with OBS scenes). The church adds the presentation link to vMix itself.
 */
function VmixFreeSetup() {
  const [link, setLink] = useState("");
  const [copied, copy] = useCopy();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const settings = loadVmixSettings();
    void resolveVmixPresentationLink(settings)
      .then((resolved) => { if (!cancelled && resolved) setLink(buildMceVmixInputUrl(resolved)); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const openDock = useCallback(() => {
    setError("");
    setPreferredWorkspace("vmix");
    openVmixDockWindow().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <section className="app-surface setup-panel" aria-labelledby="setup-vmix-title">
      <div className="app-surface__header">
        <div>
          <h2 id="setup-vmix-title" className="app-surface__title">Set up vMix</h2>
          <p className="setup-panel__lead">4 steps, once. On the free plan you add the link to vMix yourself.</p>
        </div>
      </div>
      <div className="app-surface__body">
        <div className="app-banner app-banner--warning setup-panel__banner">
          <div className="app-banner__content">
            <AlertCircle size={16} />
            <span>One-click vMix setup with instant vMix titles is on the paid plans.</span>
          </div>
        </div>
        <ol className="setup-steps">
          <Step n={1} title="Copy the presentation link">
            <CopyLink id="vmix-link" label="Presentation link" value={link} copied={copied} onCopy={copy} />
          </Step>
          <Step n={2} title="Add it to vMix">
            <p>In vMix: <strong>Add Input → Web Browser</strong>, paste the link, click OK. Put it on Overlay 1.</p>
          </Step>
          <Step
            n={3}
            title="Open the Dock"
            action={
              <button type="button" className="app-btn app-btn--primary" onClick={openDock}>
                <Tv size={16} /> Open Dock
              </button>
            }
          >
            <p>It opens in its own window, beside vMix.</p>
            {error && <p className="obs-error" role="alert">{error}</p>}
          </Step>
          <Step n={4} title="Present">
            <p>Click a verse, song or note in the Dock.</p>
          </Step>
        </ol>
      </div>
    </section>
  );
}

function VmixSetup() {
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
          <p className="setup-panel__lead">4 steps, once. Then everything you click shows over your vMix cameras.</p>
        </div>
      </div>
      <div className="app-surface__body">
        <ol className="setup-steps">
          <Step n={1} done={Boolean(vmixVersion)} title="Turn on vMix Web Controller">
            <p>In vMix: <strong>Settings → Web Controller</strong>, tick <strong>Enable</strong>, port {settings.port}.</p>
            <p className={`setup-status${vmixVersion ? " setup-status--ok" : ""}`} role="status">
              <span className="setup-status__dot" aria-hidden="true" />
              {vmixVersion ? `vMix found (version ${vmixVersion})` : `Waiting for vMix at ${settings.host}:${settings.port}…`}
            </p>
          </Step>
          <Step
            n={2}
            title="Open the Dock"
            action={
              <button type="button" className="app-btn app-btn--primary" onClick={openDock}>
                <Tv size={16} /> Open Dock
              </button>
            }
          >
            <p>It opens in its own window, beside vMix.</p>
            <label className="setup-check">
              <input type="checkbox" checked={pinned} onChange={(e) => togglePinned(e.target.checked)} />
              <span>Keep the Dock on top of vMix</span>
            </label>
            {error && <p className="obs-error" role="alert">{error}</p>}
          </Step>
          <Step n={3} title="Click “Set up vMix” in the Dock">
            <p>It adds one title, <strong>MCE Presentation</strong>, on Overlay 1. Your own inputs stay as they are.</p>
            <p className="setup-note">Using your own vMix titles? Pick them in the Dock&apos;s vMix card.</p>
          </Step>
          <Step n={4} title="Present">
            <p>Click a verse, song or note in the Dock. <strong>Hide</strong> takes it off.</p>
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
          <p className="setup-panel__lead">3 steps, once. Then you present from the Dock inside OBS.</p>
        </div>
      </div>
      <div className="app-surface__body">
        <ol className="setup-steps">
          <Step
            n={1}
            done={connected}
            title="Connect to OBS"
            action={
              <button type="button" className="app-btn app-btn--primary" onClick={() => void connect()} disabled={connected}>
                {connected ? <Check size={16} /> : <Monitor size={16} />}
                {connected ? "Connected" : "Connect to OBS"}
              </button>
            }
          >
            <p>In OBS: <strong>Tools → WebSocket Server Settings</strong>, tick <strong>Enable WebSocket server</strong>.</p>
          </Step>
          <Step n={2} title="Add the Dock to OBS">
            <p>In OBS: <strong>Docks → Custom Browser Docks</strong>. Name it MakeChurchEazy, paste this link, click <strong>Apply</strong>.</p>
            <CopyLink id="dock" label="Dock link" value={dockUrl} copied={copied} onCopy={copy} />
            <p className="setup-note">Optional, same way: Scripture Assistant (finds verses as the preacher speaks).</p>
            <CopyLink id="assistant" label="Scripture Assistant link" value={assistantUrl} copied={copied} onCopy={copy} />
          </Step>
          <Step n={3} title="Present">
            <p>Click a verse, song or note in the Dock. Scenes are made for you.</p>
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
    { id: "obs", title: "OBS Studio", desc: "The Dock goes inside OBS." },
    { id: "vmix", title: "vMix", desc: "The Dock sits beside vMix." },
  ];

  return (
    <div className="app-page">
      <div className="app-page__inner setup-page">
        <header className="app-page__header">
          <div className="app-page__header-copy">
            <p className="app-page__eyebrow">Setup</p>
            <h1 className="app-page__title">OBS &amp; vMix setup</h1>
            <p className="app-page__subtitle">
              Pick what you stream with and follow the steps once.
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

        {software === "vmix" ? (isFreePlan ? <VmixFreeSetup /> : <VmixSetup />) : <ObsSetup />}
      </div>
    </div>
  );
}
