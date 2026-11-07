/**
 * MultistreamStatusPanel — "Where your stream goes" for the active speaker profile.
 *
 * Shared by the Broadcast page and the OBS dock. Shows, per destination, whether it is
 * receiving the stream, whether recent edits still need to be sent to OBS, and how many
 * multi-stream hours are left this month.
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Send } from "./icons/NativeIcons";
import type { BroadcastPersonProfile } from "../services/broadcastSettingsService";
import type { MultistreamUsageInfo } from "../services/broadcastUsageService";
import {
  type MultistreamTarget,
  getMultistreamTarget,
  getTargetFreshness,
  subscribeMultistreamTarget,
} from "../services/multistreamState";

const GREEN = "#10B981";
const RED = "#EF4444";
const AMBER = "#F59E0B";
const MUTED = "rgba(148, 163, 184, 0.95)";

export function useMultistreamTarget(): MultistreamTarget | null {
  const [target, setTarget] = useState<MultistreamTarget | null>(() => getMultistreamTarget());
  useEffect(() => subscribeMultistreamTarget(setTarget), []);
  return target;
}

function StatusDot({ color, title }: { color: string; title?: string }) {
  return (
    <span
      title={title}
      aria-hidden
      style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0, display: "inline-block" }}
    />
  );
}

export interface MultistreamStatusPanelProps {
  profile: BroadcastPersonProfile;
  isStreaming: boolean;
  /** Plan includes multi-streaming. */
  allowed: boolean;
  usage: MultistreamUsageInfo;
  applying?: boolean;
  onApply: () => void;
  onUpgrade?: () => void;
  compact?: boolean;
  /** Integrated channel editor; the page renders the destination rows. */
  workspace?: boolean;
  icon?: ReactNode;
}

export function MultistreamStatusPanel({
  profile,
  isStreaming,
  allowed,
  usage,
  applying = false,
  onApply,
  onUpgrade,
  compact = false,
  workspace = false,
  icon,
}: MultistreamStatusPanelProps) {
  const target = useMultistreamTarget();
  const delivery = profile.channels.filter((ch) => ch.enabled !== false && ch.streamKey.trim());
  const freshness = getTargetFreshness(profile.id, delivery, target);
  const forThisProfile = target && target.profileId === profile.id ? target : null;
  const wantsMulti = delivery.length > 1;

  if (delivery.length === 0 && !workspace) return null;

  const statusFor = (id: string) => forThisProfile?.destinations.find((d) => d.id === id);

  let headline: string;
  let headlineColor = MUTED;
  if (freshness === "none") {
    headline = "Not sent to OBS yet";
  } else if (forThisProfile?.mode === "cloud") {
    const n = forThisProfile.channelIds.length;
    headline = `${isStreaming ? "Live on" : "Multi-stream ready ·"} ${n} destination${n === 1 ? "" : "s"}`;
    headlineColor = GREEN;
  } else {
    const primary = forThisProfile?.destinations.find((d) => d.ok);
    headline = `${isStreaming ? "Live on" : "Direct to"} ${primary?.name || "one destination"}`;
    headlineColor = wantsMulti ? AMBER : GREEN;
  }

  const box: CSSProperties = {
    border: "1px solid rgba(148, 163, 184, 0.22)",
    borderRadius: 3,
    padding: compact ? 10 : 14,
    display: "flex",
    flexDirection: "column",
    gap: compact ? 8 : 10,
    fontSize: compact ? 12 : 13,
    background: "rgba(148, 163, 184, 0.06)",
  };
  const applyBtn: CSSProperties = {
    border: "none",
    borderRadius: 3,
    padding: compact ? "5px 10px" : "6px 12px",
    fontSize: compact ? 11.5 : 12.5,
    fontWeight: 600,
    background: "var(--primary)",
    color: "#FFFFFF",
    cursor: applying ? "wait" : "pointer",
    opacity: applying ? 0.7 : 1,
    whiteSpace: "nowrap",
  };

  return (
    <section className={workspace ? "broadcast-destinations-summary" : undefined} style={workspace ? undefined : box} aria-label="Where your stream goes" data-testid="multistream-status">
      {workspace ? (
        <div className="broadcast-destinations-heading">
          <div className="broadcast-destinations-heading-copy">
            {icon}
            <div><h2>Where your stream goes</h2><p>These platforms will be streamed when you go live in OBS.</p></div>
          </div>
          <button type="button" className="broadcast-send-obs" onClick={onApply} disabled={applying || delivery.length === 0}>
            <Send size={19} />{applying ? "Applying…" : "Send to OBS"}
          </button>
        </div>
      ) : (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{ fontWeight: 700 }}>Where your stream goes</span>
          <span style={{ color: headlineColor, fontWeight: 600 }}>{headline}</span>
        </div>
        {freshness !== "applied" && (
          <button type="button" onClick={onApply} disabled={applying} style={applyBtn}>
            {applying ? "Applying…" : freshness === "none" ? "Send to OBS" : "Apply changes"}
          </button>
        )}
      </div>
      )}
      {workspace && delivery.length > 0 && <span className="broadcast-destinations-headline" style={{ color: headlineColor }}>{headline}</span>}

      {freshness === "changed" && (
        <div style={{ color: AMBER, lineHeight: 1.4 }}>
          {isStreaming && forThisProfile?.mode === "cloud"
            ? "You changed destinations. Apply to update them now — the stream keeps running."
            : isStreaming
            ? "You changed destinations. They take effect the next time you go live."
            : "You changed destinations since the last sync. Apply so OBS uses them."}
        </div>
      )}

      {!workspace && <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {delivery.map((ch) => {
          const st = freshness === "applied" ? statusFor(ch.id) : undefined;
          const color = !st ? MUTED : st.ok ? GREEN : RED;
          const text = !st ? "Waiting to be applied" : st.ok ? (isStreaming ? "Receiving the stream" : "Ready") : st.reason || "Not included";
          return (
            <li key={ch.id} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <span style={{ paddingTop: 5 }}>
                <StatusDot color={color} />
              </span>
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ch.name}</span>
                <span style={{ color: st && !st.ok ? RED : MUTED, fontSize: compact ? 11 : 12, lineHeight: 1.35 }}>{text}</span>
              </span>
            </li>
          );
        })}
      </ul>}

      {forThisProfile?.note && freshness === "applied" && (
        <div style={{ color: AMBER, lineHeight: 1.4 }}>{forThisProfile.note}</div>
      )}

      {wantsMulti && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, color: MUTED, fontSize: compact ? 11 : 12 }}>
          {allowed ? (
            <span style={{ color: usage.isExhausted ? RED : MUTED }}>
              {usage.isExhausted
                ? `This month's ${usage.totalHours}h of multi-streaming is used up — OBS will stream to one destination.`
                : `${usage.formattedRemaining} of ${usage.totalHours}h multi-stream time left this month`}
            </span>
          ) : (
            <span>Your plan streams to one destination at a time.</span>
          )}
          {!allowed && onUpgrade && (
            <button
              type="button"
              onClick={onUpgrade}
              style={{ ...applyBtn, background: "transparent", color: "var(--accent-blue)", padding: 0 }}
            >
              Upgrade
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export default MultistreamStatusPanel;
