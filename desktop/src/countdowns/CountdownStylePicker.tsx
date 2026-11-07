/**
 * CountdownStylePicker — "Choose a style" gallery for new countdowns.
 * Every style is a layer design the user can edit freely afterwards.
 */
import { useMemo } from "react";
import { X } from "../components/icons/NativeIcons";
import ThemeLayoutPreview from "../themes/layout/ThemeLayoutPreview";
import { COUNTDOWN_PRESETS, type CountdownPreset } from "./layouts/presets";
import { buildCountdownContent } from "./countdownTime";

interface Props {
  onPick: (presetId: string) => void;
  onClose: () => void;
}

function Thumb({ preset }: { preset: CountdownPreset }) {
  const content = useMemo(
    () => buildCountdownContent({ ...preset.sample, speaker: "Speaker name" }),
    [preset],
  );
  return (
    <div style={{ width: "100%", aspectRatio: "16 / 9", borderRadius: 8, overflow: "hidden", background: "#000", position: "relative" }}>
      <ThemeLayoutPreview layout={preset.layout} content={content} />
    </div>
  );
}

export default function CountdownStylePicker({ onPick, onClose }: Props) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose a countdown style"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(5,8,16,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(1180px, 100%)", maxHeight: "100%", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, boxShadow: "0 30px 80px rgba(0,0,0,0.6)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 750, color: "var(--text-primary)" }}>Choose a style</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>Every style is fully editable — move, resize, recolour and animate each part, then add it to OBS.</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 6 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ overflowY: "auto", padding: 20, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
          {COUNTDOWN_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onPick(preset.id)}
              style={{ textAlign: "left", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 12, padding: 10, cursor: "pointer", color: "var(--text-primary)" }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--primary)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
            >
              <Thumb preset={preset} />
              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 10 }}>{preset.name}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.4 }}>{preset.description}</div>
            </button>
          ))}
          <button
            type="button"
            onClick={() => onPick("classic")}
            style={{ textAlign: "left", background: "var(--surface-raised)", border: "1px dashed var(--border-strong)", borderRadius: 12, padding: 10, cursor: "pointer", color: "var(--text-primary)", display: "flex", flexDirection: "column", justifyContent: "center" }}
          >
            <div style={{ fontSize: 14, fontWeight: 700 }}>Classic countdown</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.4 }}>Simple ring and timer text with a picture or video background.</div>
          </button>
        </div>
      </div>
    </div>
  );
}
