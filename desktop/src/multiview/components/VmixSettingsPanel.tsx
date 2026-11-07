import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle, ExternalLink, RefreshCw } from "../../components/icons/NativeIcons";
import {
  DEFAULT_VMIX_SETTINGS,
  VMIX_OVERLAY_CHANNELS,
  VmixClient,
  VmixError,
  loadVmixSettings,
  saveVmixSettings,
  type VmixOverlayChannel,
  type VmixSettings,
} from "../../services/vmixClient";
import { requestVmixResync } from "../../services/vmixOutputEngine";
import { openVmixDockWindow } from "../../services/vmixDockWindow";
import "./VmixSettingsPanel.css";

const POLL_MS = 3000;

type Connection =
  | { state: "checking" }
  | { state: "connected"; version: string }
  | { state: "error"; message: string };

function errorText(error: unknown, settings: VmixSettings): string {
  const code = error instanceof VmixError ? error.code : "unreachable";
  if (code === "not_vmix") {
    return `Something answered at ${settings.host}:${settings.port} but it isn't vMix. Check the port in vMix → Settings → Web Controller.`;
  }
  if (code === "http") return `vMix answered with an error. Check the address and port.`;
  return `Can't reach vMix at ${settings.host}:${settings.port}. In vMix open Settings → Web Controller and tick "Enable".`;
}

/**
 * Settings → vMix: where MakeChurchEazy finds vMix and how it shows things there.
 * Uses the same saved settings as the vMix Dock card, so a change here applies there too.
 */
export function VmixSettingsPanel({ isFreePlan }: { isFreePlan: boolean }) {
  const [settings, setSettings] = useState<VmixSettings>(() => loadVmixSettings());
  // Host and port are typed freely and saved when the field is left.
  const [hostDraft, setHostDraft] = useState(settings.host);
  const [portDraft, setPortDraft] = useState(String(settings.port));
  const [connection, setConnection] = useState<Connection>({ state: "checking" });
  const [dockError, setDockError] = useState("");

  const client = useMemo(() => new VmixClient(settings), [settings]);

  const check = useCallback(async () => {
    try {
      const status = await client.getStatus();
      setConnection({ state: "connected", version: status.version || "?" });
    } catch (err) {
      setConnection({ state: "error", message: errorText(err, settings) });
    }
  }, [client, settings]);

  useEffect(() => {
    void check();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [check]);

  const apply = useCallback((patch: Partial<VmixSettings>) => {
    setSettings((prev) => {
      const next = saveVmixSettings({ ...prev, ...patch });
      setHostDraft(next.host);
      setPortDraft(String(next.port));
      return next;
    });
    requestVmixResync();
  }, []);

  const commitAddress = () => {
    if (hostDraft.trim() === settings.host && portDraft.trim() === String(settings.port)) return;
    setConnection({ state: "checking" });
    apply({ host: hostDraft, port: Number(portDraft) });
  };

  const testNow = () => {
    commitAddress();
    setConnection({ state: "checking" });
    void check();
  };

  const resetAddress = () => {
    setConnection({ state: "checking" });
    apply({ host: DEFAULT_VMIX_SETTINGS.host, port: DEFAULT_VMIX_SETTINGS.port });
  };

  const openDock = () => {
    setDockError("");
    openVmixDockWindow().catch((err) => setDockError(err instanceof Error ? err.message : String(err)));
  };

  const statusTone = connection.state === "connected" ? "ok" : connection.state === "checking" ? "wait" : "off";

  return (
    <>
      <div className="settings-section">
        <div className="section-header">
          <h3 className="section-title">vMix connection</h3>
          <p className="section-desc">MakeChurchEazy talks to vMix through its Web Controller.</p>
        </div>

        <div className="settings-card fields-rows-stack">
          <div className={`vmix-settings__status vmix-settings__status--${statusTone}`} role="status">
            <span className="vmix-settings__dot" aria-hidden="true" />
            <div className="vmix-settings__status-text">
              <strong>
                {connection.state === "connected"
                  ? `Connected to vMix ${connection.version}`
                  : connection.state === "checking"
                    ? "Looking for vMix…"
                    : "vMix not found"}
              </strong>
              <span>
                {connection.state === "connected"
                  ? `Web Controller answering at ${settings.host}:${settings.port}`
                  : connection.state === "checking"
                    ? `Checking ${settings.host}:${settings.port}`
                    : connection.message}
              </span>
            </div>
          </div>

          <hr className="settings-divider" />

          <div className="form-group">
            <label className="form-label" htmlFor="vmix-host">vMix computer address</label>
            <div className="custom-input-container vmix-settings__address">
              <input
                id="vmix-host"
                type="text"
                className="custom-textbox"
                value={hostDraft}
                onChange={(e) => setHostDraft(e.target.value)}
                onBlur={commitAddress}
                onKeyDown={(e) => { if (e.key === "Enter") commitAddress(); }}
                placeholder={DEFAULT_VMIX_SETTINGS.host}
                spellCheck={false}
              />
              <input
                type="number"
                className="custom-textbox vmix-settings__port"
                aria-label="Web Controller port"
                value={portDraft}
                min={1}
                max={65535}
                onChange={(e) => setPortDraft(e.target.value)}
                onBlur={commitAddress}
                onKeyDown={(e) => { if (e.key === "Enter") commitAddress(); }}
                placeholder={String(DEFAULT_VMIX_SETTINGS.port)}
              />
              <button
                type="button"
                className="action-btn btn-primary"
                onClick={testNow}
                disabled={connection.state === "checking"}
                title="Test vMix connection"
              >
                {connection.state === "checking"
                  ? (<><RefreshCw size={14} className="animate-spin" /><span>Checking…</span></>)
                  : (<><CheckCircle size={14} /><span>Test connection</span></>)}
              </button>
            </div>
            <span className="vmix-settings__hint">
              Use {DEFAULT_VMIX_SETTINGS.host} when vMix runs on this computer, or the other PC's IP address.
              The port is shown in vMix → Settings → Web Controller (usually {DEFAULT_VMIX_SETTINGS.port}).{" "}
              <button type="button" className="vmix-settings__link" onClick={resetAddress}>Use defaults</button>
            </span>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="section-header">
          <h3 className="section-title">Showing in vMix</h3>
          <p className="section-desc">How verses, lyrics and names appear in vMix.</p>
        </div>

        {isFreePlan && (
          <div className="vmix-settings__notice" role="note">
            <AlertCircle size={16} />
            <span>
              On the free plan, MakeChurchEazy doesn&apos;t control vMix: add the presentation link to vMix yourself.
              These options apply on the paid plans.
            </span>
          </div>
        )}

        <div className="settings-card fields-rows-stack">
          <div className="switch-row vmix-settings__row">
            <div className="switch-left">
              <span className="switch-title">Output</span>
              <span className="switch-subtitle">
                {settings.outputMode === "titles"
                  ? "vMix titles: text updates instantly and uses vMix's own title designs."
                  : "Browser input: shows the MakeChurchEazy theme exactly as on the presentation screen."}
              </span>
            </div>
            <select
              className="custom-select vmix-settings__select"
              value={settings.outputMode}
              onChange={(e) => apply({ outputMode: e.target.value === "browser" ? "browser" : "titles" })}
              aria-label="Output"
            >
              <option value="titles">vMix titles</option>
              <option value="browser">Browser input</option>
            </select>
          </div>

          <hr className="settings-divider" />

          <div className="switch-row vmix-settings__row">
            <div className="switch-left">
              <span className="switch-title">Overlay channel</span>
              <span className="switch-subtitle">The vMix overlay MakeChurchEazy uses.</span>
            </div>
            <select
              className="custom-select vmix-settings__select"
              value={settings.overlay}
              onChange={(e) => apply({ overlay: Number(e.target.value) as VmixOverlayChannel })}
              aria-label="Overlay channel"
            >
              {VMIX_OVERLAY_CHANNELS.map((channel) => (
                <option key={channel} value={channel}>Overlay {channel}</option>
              ))}
            </select>
          </div>

          <hr className="settings-divider" />

          <div className="switch-row vmix-settings__row">
            <div className="switch-left">
              <span className="switch-title">Bring the overlay in and out</span>
              <span className="switch-subtitle">
                Turns the overlay on when you show something and off when you clear it.
              </span>
            </div>
            <label className="switch-toggle-label">
              <input
                type="checkbox"
                checked={settings.autoOverlay}
                onChange={() => apply({ autoOverlay: !settings.autoOverlay })}
              />
              <span className="switch-slider" />
            </label>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="section-header">
          <h3 className="section-title">vMix Dock</h3>
          <p className="section-desc">
            A small window that sits beside vMix. Set up the MakeChurchEazy inputs and pick your own titles there.
          </p>
        </div>
        <div className="settings-card">
          <button type="button" className="action-btn" onClick={openDock}>
            <ExternalLink size={14} />
            <span>Open vMix Dock</span>
          </button>
          {dockError && <p className="vmix-settings__error" role="alert">{dockError}</p>}
        </div>
      </div>
    </>
  );
}
