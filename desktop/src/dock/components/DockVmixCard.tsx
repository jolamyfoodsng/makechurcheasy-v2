import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon from "../DockIcon";
import { copyTextToClipboard } from "../bibleClipboard";
import { getPresentationSettings } from "../../services/presentationSettings";
import {
  MCE_VMIX_GRAPHICS_INPUT_NAME,
  MCE_VMIX_INPUT_NAME,
  MCE_VMIX_ALL_LAYERS,
  VMIX_OVERLAY_CHANNELS,
  VMIX_TITLE_JOBS,
  VmixClient,
  VmixError,
  activeVmixLayer,
  describeVmixLayers,
  findSlotInput,
  loadVmixSettings,
  saveVmixSettings,
  type VmixOverlayChannel,
  type VmixSettings,
  type VmixStatus,
} from "../../services/vmixClient";
import {
  buildMceVmixInputUrl,
  removeMceVmixInputs,
  resolveVmixPresentationLink,
  setupMceVmixInput,
  vmixAutoOverlayHint,
  vmixGraphicsHint,
  vmixInputsHint,
} from "../../services/vmixSetup";
import { requestVmixResync } from "../../services/vmixOutputEngine";
import DockVmixTitles from "./DockVmixTitles";
import { isVmixDockPinned, isVmixDockWindow, setVmixDockPinned } from "../../services/vmixDockWindow";
import "./DockVmixCard.css";

const POLL_MS = 2000;

type Connection =
  | { state: "connecting" }
  | { state: "connected"; status: VmixStatus }
  | { state: "error"; error: VmixError };

function errorHint(error: VmixError, settings: VmixSettings): string {
  switch (error.code) {
    case "timeout":
    case "unreachable":
      return `Can't reach vMix at ${settings.host}:${settings.port}. In vMix open Settings → Web Controller, tick "Enable" and check the port. If vMix runs on another PC, enter that PC's IP address in settings.`;
    case "http":
      return `vMix answered with an error (${error.message}). Check the host and port.`;
    case "not_vmix":
      return `Something answered at ${settings.host}:${settings.port} but it doesn't look like vMix. Check the port in vMix → Settings → Web Controller.`;
  }
}

/**
 * The Dock's vMix card: connects to vMix and sets up its one input,
 * "MCE Presentation". The app's main window drives vMix (vmixOutputEngine);
 * this card only sets it up and shows whether it is on air.
 */
export default function DockVmixCard() {
  const [settings, setSettings] = useState<VmixSettings>(() => loadVmixSettings());
  const [showSettings, setShowSettings] = useState(false);
  const [connection, setConnection] = useState<Connection>({ state: "connecting" });
  const [presentationLink, setPresentationLink] = useState(() => getPresentationSettings().presentationLink);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [needsManual, setNeedsManual] = useState(false);
  const [needsGraphicsManual, setNeedsGraphicsManual] = useState(false);
  const [copiedGraphics, setCopiedGraphics] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // null = automatic: the setup steps are open until the input exists, then
  // fold away so the card stays a one-line bar.
  const [guideOpen, setGuideOpen] = useState<boolean | null>(null);
  const copiedTimer = useRef<number | null>(null);
  // Only the app's own Dock window can stay on top of vMix.
  const [inDockWindow] = useState(() => isVmixDockWindow());
  const [pinned, setPinned] = useState(() => isVmixDockPinned());

  const client = useMemo(() => new VmixClient(settings), [settings]);

  const refreshStatus = useCallback(async () => {
    try {
      const status = await client.getStatus();
      setConnection({ state: "connected", status });
    } catch (err) {
      const error = err instanceof VmixError ? err : new VmixError("unreachable", String(err));
      setConnection({ state: "error", error });
    }
  }, [client]);

  useEffect(() => {
    void refreshStatus();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshStatus();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refreshStatus]);

  useEffect(() => {
    const refresh = () => setPresentationLink(getPresentationSettings().presentationLink);
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      window.clearInterval(timer);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    };
  }, []);

  const connected = connection.state === "connected" ? connection.status : null;
  const layers = connected ? describeVmixLayers(connected, settings) : null;
  const mce = layers ? layers[activeVmixLayer(settings)] : null;
  const titlesMode = settings.outputMode === "titles";
  // In titles mode each job needs its title: MCE's own, or the church's pick.
  const titleInputs = connected && layers
    ? VMIX_TITLE_JOBS.map((job) =>
      settings.titles[job].kind === "mce" ? layers.title.input : findSlotInput(connected, settings.titles[job]))
    : [];
  const ready = titlesMode ? titleInputs.length > 0 && titleInputs.every(Boolean) : Boolean(mce?.input);
  const heldBy = connected?.overlays.find((overlay) => overlay.number === settings.overlay)?.inputNumber ?? null;
  const onAir = titlesMode
    ? heldBy !== null && titleInputs.some((input) => input?.number === heldBy)
    : Boolean(mce?.onOverlay);
  const anyMceInput = Boolean(layers && MCE_VMIX_ALL_LAYERS.some((layer) => layers[layer].input));

  const updateSettings = useCallback((patch: Partial<VmixSettings>) => {
    setSettings((current) => saveVmixSettings({ ...current, ...patch }));
    if ("host" in patch || "port" in patch) setConnection({ state: "connecting" });
    requestVmixResync();
  }, []);

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      await refreshStatus();
      setBusy(false);
    }
  }, [refreshStatus]);

  const handleSetup = useCallback(() => {
    void run(async () => {
      const result = await setupMceVmixInput(client, await resolveVmixPresentationLink(settings), settings);
      setNeedsManual(result.outcome === "manual");
      setNeedsGraphicsManual(result.graphics === "manual");
      requestVmixResync();
    });
  }, [client, run, settings]);

  const handleRemove = useCallback(() => {
    setConfirmRemove(false);
    void run(async () => {
      await removeMceVmixInputs(client, settings);
      setNeedsManual(false);
      setNeedsGraphicsManual(false);
    });
  }, [client, run, settings]);

  const toggleOnAir = useCallback(() => {
    if (onAir) {
      void run(() => client.overlayOut(settings.overlay));
      return;
    }
    // Titles go on air when something is shown from the Dock; only the browser input can go in empty.
    if (titlesMode || !mce?.input) return;
    const input = mce.input;
    void run(() => client.overlayIn(settings.overlay, input.key || input.number));
  }, [client, mce, run]);

  const manualLink = presentationLink ? buildMceVmixInputUrl(presentationLink) : "";
  const graphicsLink = presentationLink ? buildMceVmixInputUrl(presentationLink, "graphics") : "";
  const graphicsInput = layers?.graphics.input ?? null;

  const handleCopyGraphics = useCallback(async () => {
    if (!graphicsLink) return;
    const ok = await copyTextToClipboard(graphicsLink);
    setCopiedGraphics(ok);
    if (ok) window.setTimeout(() => setCopiedGraphics(false), 1800);
  }, [graphicsLink]);

  const handleCopy = useCallback(async () => {
    if (!manualLink) return;
    const ok = await copyTextToClipboard(manualLink);
    setCopied(ok);
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    if (ok) {
      copiedTimer.current = window.setTimeout(() => {
        setCopied(false);
        copiedTimer.current = null;
      }, 1800);
    }
  }, [manualLink]);

  const togglePinned = useCallback(() => {
    const next = !pinned;
    setPinned(next);
    void setVmixDockPinned(next).catch((err) => {
      setPinned(!next);
      setActionError(err instanceof Error ? err.message : String(err));
    });
  }, [pinned]);

  const stepsVisible = guideOpen ?? !ready;
  const dotClass =
    connection.state === "connected" ? "ok" : connection.state === "connecting" ? "wait" : "bad";

  return (
    <section className="dock-vmix-card" aria-label="vMix connection" data-testid="dock-vmix-card">
      <div className="dock-vmix-bar">
        <span className="dock-vmix-bar__tag">
          <span className={`dock-vmix-dot dock-vmix-dot--${dotClass}`} aria-hidden="true" />
          <strong>vMix</strong>
          <span className="dock-vmix-bar__status" data-testid="dock-vmix-status">
            {connection.state === "connected" &&
              `Connected · v${connection.status.version}${connection.status.edition ? ` ${connection.status.edition}` : ""}`}
            {connection.state === "connecting" && "Connecting…"}
            {connection.state === "error" && "Not connected"}
          </span>
        </span>

        <div className="dock-vmix-bar__actions">
          {ready && (
            <button
              type="button"
              className={`dock-vmix-layer-btn ${onAir ? "is-live" : ""}`}
              onClick={toggleOnAir}
              disabled={busy || (!onAir && titlesMode)}
              aria-pressed={onAir}
              title={onAir
                ? `On Overlay ${settings.overlay}. Click to take it out.`
                : titlesMode
                  ? "Comes on air when you show something from the Dock."
                  : `Put ${MCE_VMIX_INPUT_NAME} on Overlay ${settings.overlay}.`}
              data-testid="dock-vmix-on-air"
            >
              <span className="dock-vmix-layer-btn__dot" aria-hidden="true" />
              <span>{onAir ? "On air" : "Off air"}</span>
              <span className="dock-vmix-layer-btn__ov">OV{settings.overlay}</span>
            </button>
          )}
          {connected && !ready && !stepsVisible && (
            <button
              type="button"
              className="dock-btn dock-btn--primary dock-btn--sm"
              onClick={handleSetup}
              disabled={busy}
              data-testid="dock-vmix-setup"
            >
              <Icon name="auto_fix_high" size={13} />
              <span>{busy ? "Setting up…" : "Set up vMix"}</span>
            </button>
          )}
          {inDockWindow && (
            <button
              type="button"
              className={`dock-vmix-bar__icon-btn ${pinned ? "is-active" : ""}`}
              onClick={togglePinned}
              aria-pressed={pinned}
              title={pinned ? "Pinned on top of vMix. Click to unpin." : "Keep the Dock on top of vMix"}
              aria-label={pinned ? "Unpin the Dock" : "Pin the Dock on top"}
              data-testid="dock-vmix-pin"
            >
              <Icon name={pinned ? "push_pin" : "pin_off"} size={14} />
            </button>
          )}
          <button
            type="button"
            className="dock-vmix-bar__icon-btn"
            onClick={() => setGuideOpen(!stepsVisible)}
            aria-expanded={stepsVisible}
            title="Setup steps"
            aria-label="Setup steps"
            data-testid="dock-vmix-toggle-steps"
          >
            <Icon name={stepsVisible ? "expand_less" : "expand_more"} size={14} />
          </button>
          <button
            type="button"
            className="dock-vmix-bar__icon-btn"
            onClick={() => setShowSettings((v) => !v)}
            aria-expanded={showSettings}
            title="vMix settings"
            aria-label="vMix settings"
          >
            <Icon name="settings" size={14} />
          </button>
        </div>
      </div>

      {connection.state === "error" && (
        <p className="dock-vmix-note dock-vmix-note--error" role="alert">
          {errorHint(connection.error, settings)}
        </p>
      )}
      {actionError && (
        <p className="dock-vmix-note dock-vmix-note--error" role="alert">{actionError}</p>
      )}

      {showSettings && (
        <div className="dock-vmix-settings" data-testid="dock-vmix-settings">
          <label>
            <span>Host</span>
            <input value={settings.host} onChange={(e) => updateSettings({ host: e.target.value })} spellCheck={false} />
          </label>
          <label>
            <span>Port</span>
            <input
              type="number"
              value={settings.port}
              onChange={(e) => updateSettings({ port: Number(e.target.value) || settings.port })}
            />
          </label>
          <label>
            <span>Overlay</span>
            <select
              value={settings.overlay}
              onChange={(e) => updateSettings({ overlay: Number(e.target.value) as VmixOverlayChannel })}
            >
              {VMIX_OVERLAY_CHANNELS.map((n) => (
                <option key={n} value={n}>Overlay {n}</option>
              ))}
            </select>
          </label>
          {titlesMode && (
            <label>
              <span>Graphics overlay</span>
              <select
                value={settings.graphicsOverlay}
                onChange={(e) => updateSettings({ graphicsOverlay: Number(e.target.value) as VmixOverlayChannel })}
                data-testid="dock-vmix-graphics-overlay"
              >
                {VMIX_OVERLAY_CHANNELS.filter((n) => n !== settings.overlay).map((n) => (
                  <option key={n} value={n}>Overlay {n}</option>
                ))}
              </select>
            </label>
          )}
          <label className="dock-vmix-settings__wide">
            <span>Output (then press Set up vMix)</span>
            <select
              value={settings.outputMode}
              onChange={(e) => updateSettings({ outputMode: e.target.value === "browser" ? "browser" : "titles" })}
              data-testid="dock-vmix-output-mode"
            >
              <option value="titles">vMix title (fast, light on the computer)</option>
              <option value="browser">Full themes (Web Browser input, uses more CPU)</option>
            </select>
          </label>
          <p className="dock-vmix-settings__wide dock-vmix-step__hint">
            Prefer NDI? Turn on “Connect with NDI” in the Studio, then in vMix add the NDI source
            “MakeChurchEazy – Lower Third” and put it on an overlay.
          </p>
        </div>
      )}

      {stepsVisible && (
        <ol className="dock-vmix-steps" data-testid="dock-vmix-steps">
          <li className={`dock-vmix-step ${connected ? "is-done" : ""}`}>
            <span className="dock-vmix-step__mark">{connected ? <Icon name="check" size={12} /> : "1"}</span>
            <div className="dock-vmix-step__body">
              <div className="dock-vmix-step__title">vMix is reachable</div>
              {!connected && (
                <div className="dock-vmix-step__hint">
                  Start vMix, open Settings → Web Controller and tick Enable (port {settings.port}).
                </div>
              )}
            </div>
          </li>

          <li className={`dock-vmix-step ${ready ? "is-done" : ""}`}>
            <span className="dock-vmix-step__mark">{ready ? <Icon name="check" size={12} /> : "2"}</span>
            <div className="dock-vmix-step__body">
              <div className="dock-vmix-step__title">{titlesMode ? "Titles in vMix" : `“${MCE_VMIX_INPUT_NAME}” in vMix`}</div>
              <div className="dock-vmix-step__hint">{vmixInputsHint(settings, ready)}</div>
              {!titlesMode && mce?.input && (
                <div className="dock-vmix-step__hint">Input {mce.input.number} · Overlay {mce.channel}</div>
              )}
              {titlesMode && connected && (
                <DockVmixTitles
                  settings={settings}
                  status={connected}
                  client={client}
                  busy={busy}
                  onChange={(titles) => updateSettings({ titles })}
                  onError={setActionError}
                />
              )}
              {titlesMode && connected && (
                <div className="dock-vmix-step__hint" data-testid="dock-vmix-graphics-hint">
                  {vmixGraphicsHint(settings, Boolean(graphicsInput))}
                </div>
              )}
              {titlesMode && needsGraphicsManual && !graphicsInput && (
                <div className="dock-vmix-manual" role="status">
                  <div className="dock-vmix-step__hint">
                    This vMix version won&apos;t add Web Browser inputs from outside. For broadcast graphics, add one by
                    hand: in vMix choose Add Input → Web Browser, paste the link, then name the input
                    “{MCE_VMIX_GRAPHICS_INPUT_NAME}”.
                  </div>
                  <div className="dock-vmix-linkrow">
                    <code title={graphicsLink}>{graphicsLink || "…"}</code>
                    <button
                      type="button"
                      className="dock-btn dock-btn--primary dock-btn--sm"
                      onClick={() => void handleCopyGraphics()}
                      disabled={!graphicsLink}
                    >
                      <Icon name={copiedGraphics ? "check" : "content_copy"} size={13} />
                      <span>{copiedGraphics ? "Copied" : "Copy"}</span>
                    </button>
                  </div>
                </div>
              )}
              {needsManual && !ready && settings.outputMode === "browser" && (
                <div className="dock-vmix-manual" role="status">
                  <div className="dock-vmix-step__hint">
                    This vMix version won&apos;t add Web Browser inputs from outside. Add it once by hand: in vMix choose
                    Add Input → Web Browser, paste the link, then name the input “{MCE_VMIX_INPUT_NAME}”.
                  </div>
                  <div className="dock-vmix-linkrow">
                    <code title={manualLink}>{manualLink || "…"}</code>
                    <button
                      type="button"
                      className="dock-btn dock-btn--primary dock-btn--sm"
                      onClick={() => void handleCopy()}
                      disabled={!manualLink}
                    >
                      <Icon name={copied ? "check" : "content_copy"} size={13} />
                      <span>{copied ? "Copied" : "Copy"}</span>
                    </button>
                  </div>
                </div>
              )}
              {connected && (
                <div className="dock-vmix-row-actions">
                  <button
                    type="button"
                    className="dock-btn dock-btn--primary dock-btn--sm"
                    onClick={handleSetup}
                    disabled={busy}
                  >
                    <Icon name={ready ? "refresh" : "auto_fix_high"} size={13} />
                    <span>{ready ? "Refresh" : "Set up vMix"}</span>
                  </button>
                  {anyMceInput && (
                    confirmRemove ? (
                      <span className="dock-vmix-confirm">
                        <span>Remove MakeChurchEazy&apos;s inputs from vMix?</span>
                        <button type="button" className="dock-btn dock-btn--danger dock-btn--sm" onClick={handleRemove} disabled={busy}>
                          Remove
                        </button>
                        <button type="button" className="dock-btn dock-btn--ghost dock-btn--sm" onClick={() => setConfirmRemove(false)}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="dock-btn dock-btn--ghost dock-btn--sm"
                        onClick={() => setConfirmRemove(true)}
                        disabled={busy}
                      >
                        <Icon name="delete" size={13} />
                        <span>Remove from vMix</span>
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          </li>

          <li className={`dock-vmix-step ${settings.autoOverlay && ready ? "is-done" : ""}`}>
            <span className="dock-vmix-step__mark">
              {settings.autoOverlay && ready ? <Icon name="check" size={12} /> : "3"}
            </span>
            <div className="dock-vmix-step__body">
              <label className="dock-vmix-toggle">
                <input
                  type="checkbox"
                  checked={settings.autoOverlay}
                  onChange={(e) => updateSettings({ autoOverlay: e.target.checked })}
                  data-testid="dock-vmix-auto-overlay"
                />
                <span className="dock-vmix-step__title">Show and hide automatically</span>
              </label>
              <div className="dock-vmix-step__hint">{vmixAutoOverlayHint(settings)}</div>
            </div>
          </li>
        </ol>
      )}
    </section>
  );
}
