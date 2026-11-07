/**
 * DockGraphicPreviewModal — preview the lower third / graphic exactly as it is set up
 * in the Dock editor (current text, text styles, colours and size), without sending
 * anything to OBS. Plays the animation in, holds, and can play it out again.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LowerThirdTheme } from "../../lowerthirds/types";
import {
  buildThemePreviewHtml,
  obsPreviewSandbox,
  type BroadcastTheme,
} from "../../lowerthirds/broadcastPreviewHtml";

interface Props {
  theme: LowerThirdTheme;
  values: Record<string, string>;
  onClose: () => void;
  onSend?: () => void;
}

const BACKDROPS: { id: string; label: string; css: string }[] = [
  { id: "dark", label: "Dark", css: "#1c2230" },
  { id: "light", label: "Light", css: "#e9e8e4" },
  { id: "camera", label: "Stage", css: "linear-gradient(160deg,#3a2f2a 0%,#6b5446 45%,#1d1a19 100%)" },
  { id: "check", label: "Transparent", css: "repeating-conic-gradient(#3a3f4b 0% 25%, #2a2e37 0% 50%) 50% / 24px 24px" },
];

export default function DockGraphicPreviewModal({ theme, values, onClose, onSend }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [backdrop, setBackdrop] = useState(BACKDROPS[0].id);
  const [nonce, setNonce] = useState(0);
  const backdropCss = BACKDROPS.find((b) => b.id === backdrop)?.css ?? BACKDROPS[0].css;

  const html = useMemo(
    () => buildThemePreviewHtml(theme as unknown as BroadcastTheme, {
      customVariables: values,
      backdrop: backdropCss,
    }),
    // nonce rebuilds the page to replay from the start
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme, values, backdropCss, nonce],
  );
  const isKinetic = typeof theme.html === "string" && theme.html.includes("kx-root");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const post = (type: string) => frameRef.current?.contentWindow?.postMessage({ type }, "*");

  const btn: React.CSSProperties = {
    padding: "4px 10px",
    fontSize: 11,
    fontWeight: 600,
    borderRadius: 4,
    border: "1px solid var(--dock-border)",
    background: "var(--dock-input-bg, transparent)",
    color: "var(--dock-text)",
    cursor: "pointer",
    fontFamily: "inherit",
  };

  return createPortal(
    <div
      className="dock-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview: ${theme.name}`}
      style={{ zIndex: 12500 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(960px, 100%)",
          maxHeight: "100%",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: 10,
          borderRadius: 8,
          border: "1px solid var(--dock-border)",
          background: "var(--dock-surface, var(--surface))",
          color: "var(--dock-text)",
          boxShadow: "0 20px 50px rgba(0,0,0,.5)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <strong style={{ fontSize: 12, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Preview · {theme.name}
          </strong>
          <button type="button" style={{ ...btn, padding: "2px 8px" }} onClick={onClose} aria-label="Close preview">
            ✕
          </button>
        </div>

        <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", borderRadius: 4, overflow: "hidden", background: backdropCss }}>
          <iframe
            key={nonce}
            ref={frameRef}
            title={`Preview of ${theme.name}`}
            srcDoc={html}
            sandbox={obsPreviewSandbox(theme as unknown as BroadcastTheme)}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0, background: "transparent" }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {isKinetic ? (
            <>
              <button type="button" style={btn} onClick={() => post("mce-kx-in")}>▶ Animate in</button>
              <button type="button" style={btn} onClick={() => post("mce-kx-out")}>Animate out</button>
            </>
          ) : (
            <button type="button" style={btn} onClick={() => setNonce((n) => n + 1)}>↻ Replay</button>
          )}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10, opacity: 0.75 }}>Background</span>
          {BACKDROPS.map((b) => (
            <button
              key={b.id}
              type="button"
              aria-pressed={backdrop === b.id}
              style={{
                ...btn,
                padding: "3px 8px",
                fontWeight: 500,
                borderColor: backdrop === b.id ? "var(--dock-accent, var(--primary))" : "var(--dock-border)",
              }}
              onClick={() => setBackdrop(b.id)}
            >
              {b.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, opacity: 0.7, flex: 1 }}>
            Nothing is sent to OBS from this preview.
          </span>
          {onSend && (
            <button
              type="button"
              className="dock-btn dock-btn--sm dock-btn--primary"
              onClick={() => {
                onSend();
                onClose();
              }}
            >
              Send to OBS
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
