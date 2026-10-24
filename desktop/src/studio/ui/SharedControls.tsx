/**
 * SharedControls.tsx — the Camera card, under the "Show Bible / Text" card.
 *
 * The camera and the words work on their own and share one screen:
 *   Camera  which camera, and Show Camera / Hide Camera. Switching it never touches the words.
 *   Words   (the card above) on / off.
 * Nothing goes on the screen until Send to Screen (or Straight to screen is on).
 */
import { useEffect, useRef, useState } from "react";
import { CameraOff, RefreshCw, Video } from "../../components/icons/NativeIcons";
import type { StudioCameraApi } from "../useStudioCamera";
import { isNdiId } from "../nativeCamera";

interface CameraCardProps {
  camera: StudioCameraApi;
  /** A hint when the camera sits behind a full-screen theme (an opaque background hides it). */
  cameraHint: string;
  /** Words are on: the camera sits behind them. */
  wordsOn: boolean;
  /** Camera on / off. (The words are not touched.) */
  onCamera: (on: boolean) => void;
  /** Show the Show / Hide button. Off when the "What's on the screen" picker turns the camera on and off. */
  showToggle?: boolean;
}

/** Opens the system's Camera privacy page (Mac and Windows). */
async function openCameraSettings(): Promise<void> {
  const mac = /Mac/i.test(navigator.userAgent);
  const url = mac ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera" : "ms-settings:privacy-webcam";
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch (err) {
    console.warn("[Studio] Could not open the camera settings:", err);
  }
}

/** A small live picture of the chosen camera; when it is off, a tile that turns it on. */
function Preview({ stream, on, onTurnOn }: { stream: MediaStream | null; on: boolean; onTurnOn: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    if (stream) void el.play().catch(() => undefined);
  }, [stream]);
  if (stream && on) {
    return (
      <div className="st-cm__stage is-on" role="img" aria-label="Camera picture">
        <video ref={ref} muted playsInline />
      </div>
    );
  }
  return (
    <button type="button" className="st-cm__stage st-cm__stage--off" onClick={onTurnOn} title="Camera is off. Click to turn it on." aria-label="Camera is off. Turn on camera">
      <CameraOff size={18} aria-hidden="true" />
    </button>
  );
}

export default function SharedControls(props: CameraCardProps) {
  const { camera } = props;
  const [refreshing, setRefreshing] = useState(false);
  const cameraOn = camera.enabled && camera.layout !== "hidden";
  const showHint = Boolean(props.cameraHint) && cameraOn && props.wordsOn;

  const refreshCameras = async () => {
    setRefreshing(true);
    try {
      await camera.refresh();
    } catch (err) {
      console.warn("[Studio] Could not refresh camera list:", err);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section className="st-lo__mini st-camcard" aria-label="Camera">
      <div className="st-lo__minihead">
        <strong><Video size={15} /> Camera</strong>
        <Preview stream={camera.stream} on={cameraOn} onTurnOn={() => props.onCamera(true)} />
      </div>
      <div className="st-cm__row">
        <select
          className="st-lay__dev st-cm__sel"
          value={camera.deviceId}
          onChange={(e) => camera.setDeviceId(e.target.value)}
          disabled={camera.devices.length === 0}
          aria-label="Which camera"
          title={camera.ndiNote ? `Which camera. ${camera.ndiNote}` : "Which camera (cameras on this computer and NDI sources on the network)"}
        >
          {camera.devices.length === 0 && <option value="">No camera found</option>}
          {camera.devices.filter((d) => !isNdiId(d.id)).map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          {camera.devices.some((d) => isNdiId(d.id)) && (
            <optgroup label="NDI sources on the network">
              {camera.devices.filter((d) => isNdiId(d.id)).map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </optgroup>
          )}
        </select>
        <button
          type="button"
          className="st-iconbtn st-iconbtn--sm st-cm__refresh"
          onClick={() => void refreshCameras()}
          disabled={refreshing}
          aria-label="Refresh camera list"
          title={refreshing ? "Refreshing camera list…" : "Refresh camera list"}
          aria-busy={refreshing}
        >
          <RefreshCw size={14} className={refreshing ? "st-spin" : undefined} />
        </button>
        {props.showToggle !== false && <button
          type="button"
          className={`st-cm__btn st-cm__toggle${cameraOn ? " is-on" : " is-off"}`}
          onClick={() => props.onCamera(!cameraOn)}
          aria-pressed={cameraOn}
          title={cameraOn ? "Hide Camera: take the camera off the screen. The words stay as they are." : "Show Camera: put the camera on the screen. The words stay as they are."}
        >
          {cameraOn ? <CameraOff size={16} /> : <Video size={16} />} <span>{cameraOn ? "Hide" : "Show"}</span>
        </button>}
      </div>
      {camera.error && (
        <div className="st-lay__err" role="status">
          <span>{camera.error}</span>
          <span className="st-lay__errbtns">
            <button type="button" className="st-lay__btn st-lay__btn--main" onClick={() => void camera.requestAccess()}>Allow camera</button>
            {camera.denied && <button type="button" className="st-lay__btn" onClick={() => void openCameraSettings()}>Open camera settings</button>}
          </span>
        </div>
      )}
      {showHint && <p className="st-lay__help st-lay__help--warn" role="status">{props.cameraHint}</p>}
    </section>
  );
}
