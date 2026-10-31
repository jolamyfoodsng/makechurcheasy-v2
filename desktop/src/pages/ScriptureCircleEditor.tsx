/**
 * ScriptureCircleEditor — the in-app editor for the Scripture Circle look.
 * Everything is edited here against a live preview of the real overlay page. OBS is never touched
 * from here: "Send to Dock" only saves the current settings as a named theme
 * (multiview/scriptureCircleLook.ts) — the Dock's Multi-View tab is where the operator picks a
 * theme, assigns a camera scene, and actually builds the "MV: Scripture Circle" OBS scene.
 */

import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import ModalDialog from "../components/ModalDialog";
import { Save } from "../components/icons/NativeIcons";
import { obsService } from "../services/obsService";
import { LT_ANIMATIONS_IN, LT_ANIMATION_LABELS } from "../lowerthirds/types";
import {
  CAMERA_ZOOM_MAX,
  DEFAULT_SCRIPTURE_CIRCLE_SETTINGS,
  SCRIPTURE_CIRCLE_SCENE_NAME,
  getScriptureCircleTheme,
  listScriptureCircleThemes,
  normalizeScriptureCircleSettings,
  saveScriptureCircleTheme,
  type ScriptureCircleSettings,
  type ScriptureCircleSettingsInput,
} from "../multiview/scriptureCircleLook";
import ScriptureCirclePreview from "./ScriptureCirclePreview";
import "./ScriptureCircleEditor.css";

/** Native `confirm()`/`prompt()` are never used in this app — the dialog plugin's `confirm`/`ask`
 *  commands aren't in src-tauri/capabilities (only `dialog:allow-save` is granted), so calling
 *  `confirm()` here would silently resolve truthy and then reject in the background. Use
 *  ModalDialog instead, per docs/DESIGN_SYSTEM.md. */
type PendingSave =
  | { kind: "confirmUpdate"; id: string; name: string }
  | { kind: "confirmCreateAnother"; count: number };

interface Props {
  obsConnected: boolean;
  /** When editing an existing saved theme; omitted when creating a new one. */
  themeId?: string;
  onBack: () => void;
  onNotify: (message: string, type: "success" | "error") => void;
}

const CAMERA_REFRESH_MS = 3000;

export default function ScriptureCircleEditor({ obsConnected, themeId, onBack, onNotify }: Props) {
  const [settings, setSettings] = useState<ScriptureCircleSettings>(() => {
    const existing = themeId ? getScriptureCircleTheme(themeId) : null;
    return existing ? existing.settings : { ...DEFAULT_SCRIPTURE_CIRCLE_SETTINGS };
  });
  const [themeName, setThemeName] = useState<string>(() => {
    const existing = themeId ? getScriptureCircleTheme(themeId) : null;
    return existing?.name ?? "";
  });
  const [scenes, setScenes] = useState<string[]>([]);
  const [cameraImage, setCameraImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  const loadScenes = () => {
    obsService.getSceneList()
      .then((list) => setScenes(list.map((s) => s.sceneName).filter((name) => name !== SCRIPTURE_CIRCLE_SCENE_NAME && !/^MV:/i.test(name))))
      .catch(() => setScenes([]));
  };

  useEffect(() => {
    if (!obsConnected) return;
    loadScenes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obsConnected]);

  const reconnectAndReload = async () => {
    setReconnecting(true);
    try {
      await obsService.connect();
      loadScenes();
      onNotify("Reconnected to OBS.", "success");
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "Could not reconnect to OBS.", "error");
    } finally {
      setReconnecting(false);
    }
  };

  // Keep a fresh picture of the chosen camera scene in the circle.
  useEffect(() => {
    setCameraImage(null);
    if (!obsConnected || !settings.cameraSceneName) return;
    let cancelled = false;
    const grab = () => {
      obsService.getSourceScreenshot(settings.cameraSceneName, 720).then((image) => {
        if (!cancelled && image) setCameraImage(image);
      });
    };
    grab();
    const timer = setInterval(grab, CAMERA_REFRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [obsConnected, settings.cameraSceneName]);

  const update = (patch: ScriptureCircleSettingsInput) =>
    setSettings((current) => normalizeScriptureCircleSettings({
      ...current,
      ...patch,
      circle: { ...current.circle, ...patch.circle },
      camera: { ...current.camera, ...patch.camera },
    }));

  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);

  const doSave = async (id: string | undefined, name: string) => {
    setBusy(true);
    try {
      const saved = saveScriptureCircleTheme({ id, name, settings });
      onNotify(`"${saved.name}" saved to the Dock's Multi-View tab.`, "success");
      onBack();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "Could not save this theme.", "error");
    } finally {
      setBusy(false);
    }
  };

  // Opening the main gallery card always starts a new, unnamed theme (no themeId). Without this
  // check, saving repeatedly without picking a name just keeps bumping the default name
  // ("Scripture Circle", "2", "3"...) and silently piles up near-duplicate themes.
  const send = () => {
    if (themeId) {
      void doSave(themeId, themeName);
      return;
    }

    const trimmedName = themeName.trim();
    const existingThemes = listScriptureCircleThemes();

    if (trimmedName) {
      const match = existingThemes.find((t) => t.name.trim().toLowerCase() === trimmedName.toLowerCase());
      if (match) {
        setPendingSave({ kind: "confirmUpdate", id: match.id, name: match.name });
        return;
      }
      void doSave(undefined, themeName);
      return;
    }

    if (existingThemes.length === 1) {
      const [only] = existingThemes;
      setPendingSave({ kind: "confirmUpdate", id: only.id, name: only.name });
      return;
    }
    if (existingThemes.length > 1) {
      setPendingSave({ kind: "confirmCreateAnother", count: existingThemes.length });
      return;
    }

    void doSave(undefined, themeName);
  };

  const { x, y, diameter } = settings.circle;
  const { zoom, focusX, focusY } = settings.camera;
  const d = DEFAULT_SCRIPTURE_CIRCLE_SETTINGS;
  const windowName = settings.shape === "box" ? "box" : "circle";
  const placeholder = !obsConnected ? "Connect to OBS to see your camera here" : settings.cameraSceneName ? "Loading camera…" : "Pick a camera scene";

  return (
    <div className="app-page">
      <div className="app-page__inner">
        <header className="app-page__header">
          <div className="app-page__header-copy">
            <p className="app-page__eyebrow">Multi-View</p>
            <h1 className="app-page__title">{themeName.trim() || "Scripture Circle"}</h1>
            <p className="app-page__subtitle">Your camera in a round or square window, with the verse you click in the Bible tab beside it.</p>
          </div>
          <div className="app-page__actions">
            <button className="app-btn" onClick={onBack}><Icon name="arrow_back" size={14} /> Back to layouts</button>
            <button className="app-btn app-btn--primary" onClick={send} disabled={busy}>
              {busy ? "Saving…" : "Send to Dock"}
            </button>
          </div>
        </header>

        <div className="sce__body">
          <div className="sce__main">
            <div className="sce__preview app-surface">
              <ScriptureCirclePreview
                settings={settings}
                cameraImage={cameraImage}
                placeholder={placeholder}
                onMove={(position) => update({ circle: position })}
              />
              <p className="sce__preview-note">Drag the {windowName} to move it. The sample verse is replaced on air by the verse you click in the Bible tab.</p>
            </div>

            <div className="sce__bottom-grid">
              <section className="app-surface">
                <div className="app-surface__header">
                  <h2 className="app-surface__title">Camera framing</h2>
                  <button className="app-btn" onClick={() => update({ camera: d.camera })}>Reset framing</button>
                </div>
                <div className="app-surface__body sce__section">
                  <label className="sce__field">
                    <span className="sce__field-head">Zoom <span className="sce__value">{Math.round(zoom * 100)}%</span></span>
                    <input type="range" min={1} max={CAMERA_ZOOM_MAX} step={0.05} value={zoom} onChange={(e) => update({ camera: { zoom: Number(e.target.value) } })} />
                  </label>
                  <label className="sce__field">
                    <span className="sce__field-head">Move camera left / right <span className="sce__value">{focusX}%</span></span>
                    <input type="range" min={0} max={100} step={1} value={focusX} onChange={(e) => update({ camera: { focusX: Number(e.target.value) } })} />
                  </label>
                  <label className="sce__field">
                    <span className="sce__field-head">Move camera up / down <span className="sce__value">{focusY}%</span></span>
                    <input type="range" min={0} max={100} step={1} value={focusY} onChange={(e) => update({ camera: { focusY: Number(e.target.value) } })} />
                  </label>
                  <p className="sce__hint">Frames the person inside the {windowName}. Your camera scene itself stays untouched; here it refreshes every few seconds.</p>
                </div>
              </section>

              <section className="app-surface">
                <div className="app-surface__header">
                  <h2 className="app-surface__title">Animation</h2>
                  <button className="app-btn" onClick={() => update({ animationIn: d.animationIn })}>Reset</button>
                </div>
                <div className="app-surface__body sce__section">
                  <label className="sce__field">
                    <span className="sce__field-head">Animate in</span>
                    <select
                      className="sce__field-row-select"
                      value={settings.animationIn}
                      onChange={(e) => update({ animationIn: e.target.value as ScriptureCircleSettings["animationIn"] })}
                    >
                      {LT_ANIMATIONS_IN.map((id) => (
                        <option key={id} value={id}>{LT_ANIMATION_LABELS[id]}</option>
                      ))}
                    </select>
                  </label>
                  <p className="sce__hint">How the verse plays in when it changes on air.</p>
                </div>
              </section>

              <section className="app-surface">
                <div className="app-surface__header">
                  <h2 className="app-surface__title">Camera window</h2>
                  <button className="app-btn" onClick={() => update({ circle: d.circle })}>Reset</button>
                </div>
                <div className="app-surface__body sce__section">
                  <div className="sce__segmented" role="radiogroup" aria-label="Window shape">
                    {(["circle", "box"] as const).map((shape) => (
                      <button
                        key={shape}
                        role="radio"
                        aria-checked={settings.shape === shape}
                        className={`sce__segment${settings.shape === shape ? " sce__segment--active" : ""}`}
                        onClick={() => update({ shape })}
                      >
                        {shape === "circle" ? "Circle" : "Box"}
                      </button>
                    ))}
                  </div>
                  <label className="sce__field">
                    <span className="sce__field-head">Size <span className="sce__value">{diameter}px</span></span>
                    <input type="range" min={240} max={1000} step={10} value={diameter} onChange={(e) => update({ circle: { diameter: Number(e.target.value) } })} />
                  </label>
                  <label className="sce__field">
                    <span className="sce__field-head">Left <span className="sce__value">{x}px</span></span>
                    <input type="range" min={0} max={1920 - diameter} step={2} value={x} onChange={(e) => update({ circle: { x: Number(e.target.value) } })} />
                  </label>
                  <label className="sce__field">
                    <span className="sce__field-head">Top <span className="sce__value">{y}px</span></span>
                    <input type="range" min={0} max={1080 - diameter} step={2} value={y} onChange={(e) => update({ circle: { y: Number(e.target.value) } })} />
                  </label>
                  <label className="sce__check">
                    <input type="checkbox" checked={settings.showLive} onChange={(e) => update({ showLive: e.target.checked })} />
                    Show the LIVE tag
                  </label>
                </div>
              </section>
            </div>

            <p className="sce__hint">Send to Dock saves this as a theme. Pick it in the Dock's Multi-View tab, assign a camera scene, then Push to build the "{SCRIPTURE_CIRCLE_SCENE_NAME}" scene in OBS.</p>
          </div>

          <div className="sce__side">
            <section className="app-surface">
              <div className="app-surface__header">
                <h2 className="app-surface__title">Theme</h2>
              </div>
              <div className="app-surface__body sce__section">
                <label className="sce__field">
                  Name
                  <input
                    type="text"
                    className="sce__field-row-select"
                    value={themeName}
                    placeholder="Scripture Circle"
                    onChange={(e) => setThemeName(e.target.value)}
                  />
                </label>
                <p className="sce__hint">This name is how the look appears in the Dock's Multi-View template picker. You can rename it any time.</p>
              </div>
            </section>

            <section className="app-surface">
              <div className="app-surface__header">
                <h2 className="app-surface__title">Camera</h2>
              </div>
              <div className="app-surface__body sce__section">
                <label className="sce__field">
                  OBS scene with your camera
                  <div className="sce__field-row">
                    <select
                      className="sce__field-row-select"
                      value={settings.cameraSceneName}
                      onChange={(e) => update({ cameraSceneName: e.target.value })}
                      disabled={!obsConnected}
                    >
                      <option value="">{obsConnected ? "Choose a scene…" : "Connect to OBS to choose"}</option>
                      {scenes.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                    <button
                      type="button"
                      className="app-btn sce__reconnect-btn"
                      onClick={reconnectAndReload}
                      disabled={reconnecting}
                      title="Reconnect to OBS and reload scenes"
                    >
                      <Icon name="refresh" size={14} className={reconnecting ? "spin-icon" : undefined} />
                      {reconnecting ? "Reconnecting…" : "Reconnect"}
                    </button>
                  </div>
                </label>
              </div>
            </section>

            <section className="app-surface">
              <div className="app-surface__header">
                <h2 className="app-surface__title">Colours</h2>
                <button className="app-btn" onClick={() => update({ wedgeColor: d.wedgeColor, paperColor: d.paperColor, textColor: d.textColor })}>Reset</button>
              </div>
              <div className="app-surface__body sce__swatches">
                <label className="sce__swatch">
                  <input type="color" value={settings.wedgeColor} onChange={(e) => update({ wedgeColor: e.target.value })} />
                  <span>Left side<small>{settings.wedgeColor.toUpperCase()}</small></span>
                </label>
                <label className="sce__swatch">
                  <input type="color" value={settings.paperColor} onChange={(e) => update({ paperColor: e.target.value })} />
                  <span>Right side<small>{settings.paperColor.toUpperCase()}</small></span>
                </label>
                <label className="sce__swatch">
                  <input type="color" value={settings.textColor} onChange={(e) => update({ textColor: e.target.value })} />
                  <span>Verse text<small>{settings.textColor.toUpperCase()}</small></span>
                </label>
              </div>
              <p className="sce__hint sce__hint--pad">The left-side colour is also used for the SCRIPTURE label, the line and the LIVE tag.</p>
            </section>
          </div>
        </div>
      </div>

      {pendingSave?.kind === "confirmUpdate" && (
        <ModalDialog
          tone="brand"
          icon={<Save size={26} />}
          title="Update the existing theme?"
          onClose={() => setPendingSave(null)}
          actions={[
            {
              label: "No, create new",
              variant: "ghost",
              onClick: () => { setPendingSave(null); void doSave(undefined, themeName); },
            },
            {
              label: "Update existing",
              variant: "primary",
              autoFocus: true,
              onClick: () => { setPendingSave(null); void doSave(pendingSave.id, pendingSave.name); },
            },
          ]}
        >
          A theme named "{pendingSave.name}" already exists. Update it instead of creating a new one?
        </ModalDialog>
      )}

      {pendingSave?.kind === "confirmCreateAnother" && (
        <ModalDialog
          tone="warning"
          icon={<Save size={26} />}
          title="Create another theme?"
          onClose={() => setPendingSave(null)}
          hint='Open one from the "My" tab and give it a name to update it instead.'
          actions={[
            { label: "Cancel", variant: "ghost", onClick: () => setPendingSave(null) },
            {
              label: "Create anyway",
              variant: "primary",
              onClick: () => { setPendingSave(null); void doSave(undefined, themeName); },
            },
          ]}
        >
          You already have {pendingSave.count} saved themes. This will create another one.
        </ModalDialog>
      )}
    </div>
  );
}
