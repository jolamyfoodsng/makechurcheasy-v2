import { useState, useEffect, useCallback, useRef } from "react";
import {
  PLATFORM_INFO,
  PLATFORM_KEY_GUIDES,
  type BroadcastChannel,
  type BroadcastPersonProfile,
  type BroadcastPlatform,
  type BroadcastStoreState,
  addChannelToProfile,
  addPersonProfile,
  deleteChannel,
  deletePersonProfile,
  getActiveProfile,
  getMultistreamPlanAllocation,
  type MultistreamPlanAllocation,
  loadBroadcastStore,
  setActiveProfileId,
  subscribeBroadcastStore,
  toggleChannelEnabled,
  updateChannel,
  updatePersonProfile,
} from "../services/broadcastSettingsService";
import {
  ensureObsConnected,
  syncChannelToObs,
  syncProfileToObs,
} from "../services/broadcastObsSyncService";
import { dockObsClient } from "../dock/dockObsClient";
import { getStoredUser } from "../services/authService";
import { getEffectivePlan } from "../services/licenseService";
import { useAuth } from "../contexts/AuthContext";
import UpgradeModal from "./UpgradeModal";
import BroadcastHowItWorksModal from "./BroadcastHowItWorksModal";
import {
  Plus,
  Edit2,
  Trash2,
  Eye,
  EyeOff,
  Check,
  AlertTriangle,
  Send,
  X,
  RefreshCw,
  Loader2,
  Crown,
  Lock,
  HelpCircle,
  ExternalLink,
} from "./icons/NativeIcons";
import "../pages/BroadcastPage.css";
import "./BroadcastSettingsPanel.css";

const handleOpenExternalLink = async (url: string) => {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
};

function PlatformBadgeIcon({ platform, size = 20 }: { platform: BroadcastPlatform; size?: number }) {
  switch (platform) {
    case "youtube":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <rect width="24" height="24" rx="6" fill="#EF4444" />
          <path d="M10 8.5L16 12L10 15.5V8.5Z" fill="#FFFFFF" />
        </svg>
      );
    case "facebook":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <rect width="24" height="24" rx="6" fill="#1877F2" />
          <path
            d="M15.5 12.5H13V19H10.5V12.5H9V10.2H10.5V8.8C10.5 7.1 11.5 6 13.5 6C14.3 6 15 6.1 15 6.1V8.2H14.1C13.2,8.2 13 8.7 13 9.4V10.2H15.4L15.5 12.5Z"
            fill="#FFFFFF"
          />
        </svg>
      );
    case "instagram":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <rect width="24" height="24" rx="6" fill="#E1306C" />
          <rect x="6.5" y="6.5" width="11" height="11" rx="3.5" stroke="#FFFFFF" strokeWidth="1.5" />
          <circle cx="12" cy="12" r="2.5" stroke="#FFFFFF" strokeWidth="1.5" />
          <circle cx="15.2" cy="8.8" r="0.8" fill="#FFFFFF" />
        </svg>
      );
    case "tiktok":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <rect width="24" height="24" rx="6" fill="#0F172A" />
          <path
            d="M14.5 7C14.8 8.1 15.6 9 16.7 9.3V11.2C15.8 11.2 15 10.9 14.3 10.4V14.3C14.3 16.3 12.7 18 10.7 18C8.7 18 7 16.3 7 14.3C7 12.3 8.6 10.7 10.6 10.7C10.8 10.7 11.1 10.7 11.3 10.8V12.7C11.1 12.6 10.9 12.5 10.7 12.5C9.7 12.5 8.9 13.3 8.9 14.3C8.9 15.3 9.7 16.1 10.7 16.1C11.7 16.1 12.5 15.3 12.5 14.3V6H14.5V7Z"
            fill="#00F2FE"
          />
        </svg>
      );
    case "kick":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <rect width="24" height="24" rx="6" fill="#53FC18" />
          <path
            d="M8 7V17M8 12H11L14.5 7M11 12L15 17"
            stroke="#000000"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "twitch":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <rect width="24" height="24" rx="6" fill="#9146FF" />
          <path
            d="M7 6H17V13L14 16H11L9.5 17.5V16H7V6Z"
            stroke="#FFFFFF"
            strokeWidth="1.5"
            strokeLinejoin="round"
            fill="none"
          />
          <rect x="10.5" y="9" width="1.5" height="3" fill="#FFFFFF" />
          <rect x="13.5" y="9" width="1.5" height="3" fill="#FFFFFF" />
        </svg>
      );
    case "custom":
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <rect width="24" height="24" rx="6" fill="#334155" />
          <path
            d="M12 7C9.2 7 7 9.2 7 12M12 9C10.3 9 9 10.3 9 12M12 11A1 1 0 1 1 11.99 11M12 12V17M15 12C15 10.3 13.7 9 12 9M17 12C17 9.2 14.8 7 12 7"
            stroke="#38BDF8"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
  }
}

function getPlatformSubtitle(platform: BroadcastPlatform, serverUrl?: string): string {
  switch (platform) {
    case "youtube":
      if (!serverUrl || serverUrl === "auto") return "YouTube Live • Auto Ingest";
      return `YouTube Live • ${serverUrl}`;
    case "facebook":
      return "Facebook Live";
    case "instagram":
      return "Instagram Live";
    case "tiktok":
      return "TikTok Live";
    case "kick":
      return "Kick Stream";
    case "twitch":
      if (!serverUrl || serverUrl === "auto") return "Twitch • Auto Ingest";
      return `Twitch • ${serverUrl}`;
    case "custom":
      return serverUrl ? `Custom RTMP • ${serverUrl}` : "Custom RTMP Server";
    default:
      return "Live Stream";
  }
}

function useCurrentPlanAllocation(): { effectivePlan: string; allocation: MultistreamPlanAllocation } {
  let user = null;
  try {
    const auth = useAuth();
    user = auth?.user ?? null;
  } catch {
    user = getStoredUser();
  }
  const effectivePlan = getEffectivePlan(user);
  return {
    effectivePlan,
    allocation: getMultistreamPlanAllocation(effectivePlan),
  };
}

export function BroadcastSettingsPanel({
  onToast,
}: {
  onToast?: (message: string, tone?: "success" | "accent" | "error" | "info") => void;
}) {
  const [store, setStore] = useState<BroadcastStoreState>(loadBroadcastStore);
  const [obsConnected, setObsConnected] = useState(dockObsClient.isConnected);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncingChannelId, setSyncingChannelId] = useState<string | null>(null);
  const [isConnectingObs, setIsConnectingObs] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);

  const { allocation } = useCurrentPlanAllocation();

  // Modals state
  const [showPersonModal, setShowPersonModal] = useState(false);
  const [editingPerson, setEditingPerson] = useState<BroadcastPersonProfile | null>(null);
  const [personNameInput, setPersonNameInput] = useState("");
  const [personNicknameInput, setPersonNicknameInput] = useState("");
  const [personColorInput, setPersonColorInput] = useState("#F59E0B");

  const [showChannelModal, setShowChannelModal] = useState(false);
  const [editingChannel, setEditingChannel] = useState<{ personId: string; channel: BroadcastChannel | null } | null>(null);
  const [channelPlatformInput, setChannelPlatformInput] = useState<BroadcastPlatform>("youtube");
  const [channelNameInput, setChannelNameInput] = useState("");
  const [channelKeyInput, setChannelKeyInput] = useState("");
  const [channelServerInput, setChannelServerInput] = useState("");
  const [showKeyInModal, setShowKeyInModal] = useState(false);

  const [visibleKeyIds, setVisibleKeyIds] = useState<Record<string, boolean>>({});

  const streamKeyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return subscribeBroadcastStore((next) => {
      setStore(next);
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      setObsConnected(dockObsClient.isConnected);
      if (!dockObsClient.isConnected) {
        setIsStreaming(false);
        return;
      }
      try {
        const status = await dockObsClient.getStreamStatus();
        if (mounted) {
          setIsStreaming(Boolean(status?.outputActive));
        }
      } catch {
        if (mounted) setIsStreaming(false);
      }
    };
    check();
    const interval = setInterval(check, 2500);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const activeProfile = getActiveProfile(store);

  const notify = (msg: string, tone: "success" | "accent" | "error" | "info" = "success") => {
    if (onToast) onToast(msg, tone);
  };

  const handleSelectPerson = useCallback((profileId: string) => {
    const updated = setActiveProfileId(profileId);
    setStore(updated);
    const profile = updated.profiles.find((p) => p.id === profileId);
    if (profile) {
      notify(`Switched active profile to ${profile.nickname}`, "info");
    }
  }, []);

  const handleConnectObsDirectly = useCallback(async () => {
    if (obsConnected) {
      notify("OBS Studio is already connected and ready.", "info");
      return;
    }
    setIsConnectingObs(true);
    notify("Connecting to OBS Studio...", "info");
    try {
      const res = await ensureObsConnected();
      if (res.connected) {
        setObsConnected(true);
        notify("Connected to OBS Studio!", "success");
      } else {
        notify(
          "Could not connect to OBS Studio. Please make sure OBS is running on this computer with WebSocket enabled.",
          "error",
        );
      }
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || "Connection refused";
      notify(`OBS connection error: ${msg}`, "error");
    } finally {
      setIsConnectingObs(false);
    }
  }, [obsConnected]);

  const handleApplyChannelToObs = useCallback(async (channel: BroadcastChannel, personName: string) => {
    if (!channel.streamKey.trim()) {
      notify(`Stream key for "${channel.name}" is empty. Please enter your stream key first.`, "error");
      return;
    }
    setIsSyncing(true);
    setSyncingChannelId(channel.id);
    try {
      if (!dockObsClient.isConnected) {
        notify("Connecting to OBS Studio...", "info");
      }
      const res = await syncChannelToObs(channel, personName);
      if (res.success) {
        setObsConnected(true);
        notify(res.message, "success");
      } else {
        notify(res.message, "error");
      }
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || "Unknown error";
      notify(`Failed to sync channel with OBS: ${msg}`, "error");
    } finally {
      setIsSyncing(false);
      setSyncingChannelId(null);
    }
  }, []);

  const handleApplyActivePersonToObs = useCallback(async () => {
    if (!activeProfile) return;
    setIsSyncing(true);
    try {
      if (!dockObsClient.isConnected) {
        notify("Connecting to OBS Studio...", "info");
      }
      const res = await syncProfileToObs(activeProfile, dockObsClient, store);
      if (res.success) {
        setObsConnected(true);
        notify(res.message, "success");
      } else {
        notify(res.message, "error");
      }
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || "Unknown error";
      notify(`Failed to sync profile with OBS: ${msg}`, "error");
    } finally {
      setIsSyncing(false);
    }
  }, [activeProfile, store]);

  // Profile modal
  const openNewPersonModal = () => {
    setEditingPerson(null);
    setPersonNameInput("");
    setPersonNicknameInput("");
    setPersonColorInput("#F59E0B");
    setShowPersonModal(true);
  };

  const openEditPersonModal = (p: BroadcastPersonProfile) => {
    setEditingPerson(p);
    setPersonNameInput(p.name);
    setPersonNicknameInput(p.nickname);
    setPersonColorInput(p.color);
    setShowPersonModal(true);
  };

  const handleSavePerson = () => {
    if (!personNameInput.trim()) {
      notify("Please enter a person/profile name.", "error");
      return;
    }
    if (editingPerson) {
      updatePersonProfile(editingPerson.id, {
        name: personNameInput.trim(),
        nickname: personNicknameInput.trim() || personNameInput.trim(),
        color: personColorInput,
      });
      notify(`Updated profile: ${personNicknameInput.trim() || personNameInput.trim()}`, "success");
    } else {
      const added = addPersonProfile(
        personNameInput.trim(),
        personNicknameInput.trim() || personNameInput.trim(),
        personColorInput,
      );
      notify(`Created profile: ${added.nickname}`, "success");
    }
    setShowPersonModal(false);
  };

  const handleDeletePerson = (p: BroadcastPersonProfile) => {
    if (confirm(`Delete profile "${p.nickname}" and its tied channels?`)) {
      deletePersonProfile(p.id);
      notify(`Deleted profile: ${p.nickname}`, "info");
    }
  };

  // Channel modal
  const openNewChannelModal = (personId: string) => {
    setEditingChannel({ personId, channel: null });
    setChannelPlatformInput("youtube");
    setChannelNameInput("");
    setChannelKeyInput("");
    setChannelServerInput(PLATFORM_INFO.youtube.defaultServer);
    setShowKeyInModal(false);
    setShowChannelModal(true);
  };

  const openEditChannelModal = (personId: string, ch: BroadcastChannel, focusKey = false) => {
    setEditingChannel({ personId, channel: ch });
    setChannelPlatformInput(ch.platform);
    setChannelNameInput(ch.name);
    setChannelKeyInput(ch.streamKey);
    const serverVal =
      ch.platform === "youtube" && (!ch.serverUrl || ch.serverUrl === "auto")
        ? "Primary YouTube ingest server"
        : ch.serverUrl;
    setChannelServerInput(serverVal);
    setShowKeyInModal(focusKey);
    setShowChannelModal(true);
    if (focusKey) {
      setTimeout(() => {
        streamKeyInputRef.current?.focus();
      }, 100);
    }
  };

  const handleSaveChannel = () => {
    if (!editingChannel) return;
    if (!channelNameInput.trim()) {
      notify("Please enter a channel name.", "error");
      return;
    }
    if (editingChannel.channel) {
      updateChannel(editingChannel.personId, editingChannel.channel.id, {
        name: channelNameInput.trim(),
        platform: channelPlatformInput,
        streamKey: channelKeyInput.trim(),
        serverUrl: channelServerInput.trim() || PLATFORM_INFO[channelPlatformInput].defaultServer,
      });
      notify(`Updated channel: ${channelNameInput.trim()}`, "success");
    } else {
      addChannelToProfile(editingChannel.personId, {
        name: channelNameInput.trim(),
        platform: channelPlatformInput,
        streamKey: channelKeyInput.trim(),
        serverUrl: channelServerInput.trim() || PLATFORM_INFO[channelPlatformInput].defaultServer,
        enabled: true,
      });
      notify(`Added channel: ${channelNameInput.trim()}`, "success");
    }
    setShowChannelModal(false);
  };

  const handleDeleteChannel = (personId: string, ch: BroadcastChannel) => {
    if (confirm(`Remove "${ch.name}" from this profile?`)) {
      deleteChannel(personId, ch.id);
      notify(`Removed channel: ${ch.name}`, "info");
    }
  };

  const toggleKeyVisibility = (chId: string) => {
    setVisibleKeyIds((prev) => ({ ...prev, [chId]: !prev[chId] }));
  };

  const enabledChannels = activeProfile?.channels.filter((c) => c.enabled) || [];

  return (
    <div className="broadcast-settings-panel">
      {/* Header & Controls in Unified Surface */}
      <section className="broadcast-settings-overview">
        <div className="broadcast-settings-overview__heading">
          <div className="broadcast-settings-overview__intro">
            {/* Pulsing dot by the left */}
            <span
              style={{ marginTop: "7px" }}
              className={`broadcast-pulse-dot ${
                isStreaming ? "broadcast-pulse-dot--live" : obsConnected ? "broadcast-pulse-dot--ready" : "broadcast-pulse-dot--off"
              }`}
            />
            <div className="broadcast-settings-overview__copy">
              <h2 className="broadcast-settings-title">
                Multi-Platform Live Streaming & OBS Control
              </h2>
              <p className="broadcast-settings-description">
                Save profiles for your pastors and guest ministers with their YouTube, Facebook, and custom channels ({enabledChannels.length} active). Click &ldquo;Sync with OBS&rdquo; to connect and switch stream keys in 1 click.
              </p>
            </div>
          </div>

          <div className="broadcast-settings-overview__actions">
            <button
              type="button"
              onClick={handleConnectObsDirectly}
              className="broadcast-obs-status-btn action-btn secondary"
              disabled={isConnectingObs}
              title={obsConnected ? "OBS is connected" : "Click to connect to OBS Studio"}
            >
              {isConnectingObs ? (
                <Loader2 size={13} className="spin" />
              ) : (
                <span className={`broadcast-pulse-dot ${obsConnected ? "broadcast-pulse-dot--ready" : "broadcast-pulse-dot--amber"}`} />
              )}
              <span>{obsConnected ? "OBS Connected" : isConnectingObs ? "Connecting..." : "OBS Disconnected • Connect"}</span>
            </button>

            <button
              type="button"
              className="broadcast-secondary-button action-btn"
              onClick={handleApplyActivePersonToObs}
              disabled={isSyncing}
              title={`Connects to OBS and sends ${activeProfile?.nickname || "active speaker"}'s stream key`}
            >
              {isSyncing && !syncingChannelId ? (
                <RefreshCw size={13} className="spin" />
              ) : (
                <Send size={13} />
              )}
              <span>{isSyncing && !syncingChannelId ? "Connecting & Syncing..." : "Sync with OBS"}</span>
            </button>
          </div>
        </div>

        {/* Plan access and next step */}
        <div className="broadcast-plan-bar">
          <div className="broadcast-plan-bar__summary">
            <span className={`broadcast-quota-badge broadcast-quota-badge--${allocation.plan}`}>
              {allocation.allowed ? <Crown size={14} /> : <Lock size={14} />}
              {allocation.label}
            </span>
            <span className="broadcast-plan-bar__description">
              {allocation.allowed
                ? "Multi-platform streaming is included in your plan."
                : "Your plan supports one destination at a time."}
            </span>
          </div>
          <div className="broadcast-plan-bar__actions">
            <button
              type="button"
              onClick={() => setShowInfoModal(true)}
              className="broadcast-info-btn action-btn secondary"
              title="Learn how multi-platform streaming works"
            >
              <HelpCircle size={15} />
              <span>How it works</span>
            </button>
            {!allocation.allowed ? (
              <button type="button" onClick={() => setShowUpgradeModal(true)} className="broadcast-upgrade-action-btn action-btn btn-primary">
                View plans
              </button>
            ) : (
              <button type="button" onClick={() => setShowUpgradeModal(true)} className="broadcast-info-btn action-btn">
                Change plan
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Contextual Notice for Free Plan when >1 destinations are active */}
      {!allocation.allowed && enabledChannels.length > 1 && (
        <div className="broadcast-multistream-notice">
          <AlertTriangle size={16} style={{ flexShrink: 0, color: "var(--warning)" }} />
          <span>
            Free Plan streams to 1 channel at a time. Upgrade to Growth (20 hrs/mo) or Basic (10 hrs/mo) to stream to all {enabledChannels.length} platforms at once with no extra plugins.
          </span>
          <button
            type="button"
            onClick={() => setShowUpgradeModal(true)}
            className="broadcast-notice-upgrade-btn action-btn small btn-primary"
          >
            Upgrade now
          </button>
        </div>
      )}

      {/* Two Column Section */}
      <div className="broadcast-settings-layout">
        {/* Left: Speaker Profiles with pulsing dots by the left */}
        <section className="broadcast-settings-card broadcast-settings-profiles">
          <div className="broadcast-settings-card__header">
            <div>
              <h3 className="broadcast-settings-card__title">
                Speaker Profiles
              </h3>
              <div className="broadcast-settings-card__description">
                Create a profile (e.g. church account, pastor account, etc.)
              </div>
            </div>
            <button
              type="button"
              onClick={openNewPersonModal}
              className="broadcast-primary-button action-btn btn-primary"
            >
              <Plus size={14} />
              <span>Add</span>
            </button>
          </div>

          <div className="broadcast-profile-list">
            {store.profiles.map((p) => {
              const isActive = p.id === store.activeProfileId;
              const hasKey = p.channels.some((c) => c.enabled && c.streamKey.trim());
              return (
                <div
                  key={p.id}
                  onClick={() => handleSelectPerson(p.id)}
                  className={`broadcast-profile-item ${isActive ? "broadcast-profile-item--active" : ""}`}
                >
                  {/* Pulsing dot by the left of each profile */}
                  <span
                    className={`broadcast-pulse-dot ${
                      isActive && isStreaming
                        ? "broadcast-pulse-dot--live"
                        : isActive
                        ? "broadcast-pulse-dot--ready"
                        : hasKey
                        ? "broadcast-pulse-dot--amber"
                        : "broadcast-pulse-dot--off"
                    }`}
                  />

                  <div className="broadcast-profile-avatar" style={{ background: p.color || "#F59E0B" }}>
                    {p.nickname.slice(0, 2).toUpperCase()}
                  </div>

                  <div className="broadcast-profile-item__copy">
                    <div className="broadcast-profile-name">
                      {p.nickname}
                    </div>
                    <div className="broadcast-profile-desc">
                      {p.channels.length} destination{p.channels.length !== 1 ? "s" : ""}
                    </div>
                  </div>

                  <div className="broadcast-profile-item__actions">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditPersonModal(p);
                      }}
                      title="Edit Profile"
                      className="broadcast-icon-button"
                    >
                      <Edit2 size={13} />
                    </button>
                    {store.profiles.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeletePerson(p);
                        }}
                        title="Delete Profile"
                        className="broadcast-icon-button broadcast-icon-button--danger"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Right: Destinations for Active Profile */}
        {activeProfile && (
          <section className="broadcast-settings-card broadcast-settings-destinations">
            <div className="broadcast-settings-card__header">
              <div>
                <div className="broadcast-settings-card__title-row">
                  <h4 className="broadcast-settings-card__title">
                    Destinations for {activeProfile.nickname}
                  </h4>
                  <span className="broadcast-settings-card__count">
                    ({enabledChannels.length} active)
                  </span>
                </div>
                <div className="broadcast-settings-card__description">
                  {activeProfile.name} • Click &ldquo;Sync with OBS&rdquo; to load into OBS
                </div>
              </div>
              <button
                type="button"
                className="broadcast-primary-button action-btn btn-primary"
                onClick={() => openNewChannelModal(activeProfile.id)}
              >
                <Plus size={14} />
                <span>Add Channel</span>
              </button>
            </div>

            {activeProfile.channels.length === 0 ? (
              <div className="broadcast-settings-empty">
                No channels added yet. Add YouTube or Facebook to start broadcasting.
              </div>
            ) : (
              <div className="broadcast-channel-list">
                {activeProfile.channels.map((ch) => {
                  const hasKey = Boolean(ch.streamKey.trim());
                  const keyRevealed = Boolean(visibleKeyIds[ch.id]);

                  return (
                    <div
                      key={ch.id}
                      className={`broadcast-channel-row ${!ch.enabled ? "broadcast-channel-row--disabled" : ""}`}
                    >
                      <div className="broadcast-channel-top">
                        <div className="broadcast-channel-info">
                          {/* Pulsing dot by the left of each channel */}
                          <span
                            className={`broadcast-pulse-dot ${
                              ch.enabled && hasKey
                                ? "broadcast-pulse-dot--ready"
                                : ch.enabled
                                ? "broadcast-pulse-dot--amber"
                                : "broadcast-pulse-dot--off"
                            }`}
                          />
                          <PlatformBadgeIcon platform={ch.platform} size={26} />
                          <div>
                            <div className="broadcast-channel-name">
                              {ch.name}
                            </div>
                            <div className="broadcast-channel-meta">
                              {getPlatformSubtitle(ch.platform, ch.serverUrl)}
                            </div>
                          </div>
                        </div>

                        <div className="broadcast-channel-actions">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={ch.enabled}
                            className={`broadcast-toggle ${ch.enabled ? "broadcast-toggle--checked" : ""}`}
                            onClick={() => toggleChannelEnabled(activeProfile.id, ch.id)}
                            title={ch.enabled ? "Channel active" : "Channel disabled"}
                          >
                            <span className="broadcast-toggle-thumb" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditChannelModal(activeProfile.id, ch)}
                            className="broadcast-icon-button"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteChannel(activeProfile.id, ch)}
                            className="broadcast-icon-button broadcast-icon-button--danger"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      <div className="broadcast-channel-bottom">
                        {hasKey ? (
                          <div className="broadcast-channel-key">
                            <span className="broadcast-channel-key__label">Key:</span>
                            <span className="broadcast-channel-key__value">
                              {keyRevealed ? ch.streamKey : "••••••••••••••••"}
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleKeyVisibility(ch.id)}
                              className="broadcast-icon-button broadcast-key-visibility"
                            >
                              {keyRevealed ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                            <span className="broadcast-channel-key__saved">
                              <Check size={13} /> Saved
                            </span>
                          </div>
                        ) : (
                          <div className="broadcast-channel-key broadcast-channel-key--missing">
                            <span className="broadcast-channel-key__warning">
                              <AlertTriangle size={14} /> Key missing
                            </span>
                            <button
                              type="button"
                              onClick={() => openEditChannelModal(activeProfile.id, ch, true)}
                              className="broadcast-key-entry-button action-btn small secondary"
                            >
                              + Enter Key
                            </button>
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => handleApplyChannelToObs(ch, activeProfile.nickname)}
                          disabled={isSyncing}
                          className="broadcast-secondary-button broadcast-secondary-button--small action-btn small secondary"
                          title={`Connect to OBS and set stream destination to ${ch.name}`}
                        >
                          {syncingChannelId === ch.id && <RefreshCw size={12} className="spin" />}
                          <span>{syncingChannelId === ch.id ? "Syncing..." : "Sync to OBS"}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>

      {/* MODAL: ADD / EDIT PERSON PROFILE */}
      {showPersonModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            backdropFilter: "blur(4px)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
          }}
          onClick={() => setShowPersonModal(false)}
        >
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "28px 32px",
              maxWidth: "460px",
              width: "100%",
              display: "flex",
              flexDirection: "column",
              gap: "18px",
              boxShadow: "0 20px 40px rgba(0, 0, 0, 0.6)",
              color: "var(--text-primary)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)", paddingBottom: "14px" }}>
              <h3 style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "var(--text-primary)" }}>
                {editingPerson ? "Edit Speaker Profile" : "Add Speaker Profile"}
              </h3>
              <button
                type="button"
                onClick={() => setShowPersonModal(false)}
                style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "4px" }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <label style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
                Profile Name (e.g. Church Account, Sunday Service, Youth Ministry)
              </label>
              <input
                type="text"
                placeholder="e.g. Church Main Account or Sunday Service"
                value={personNameInput}
                onChange={(e) => setPersonNameInput(e.target.value)}
                style={{
                  background: "var(--input-bg)",
                  border: "1px solid var(--input-border)",
                  color: "var(--text-primary)",
                  padding: "10px 14px",
                  borderRadius: "var(--radius)",
                  fontSize: "15px",
                  outline: "none",
                }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <label style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
                Short Nickname (Shown on quick switch buttons)
              </label>
              <input
                type="text"
                placeholder="e.g. Church Account or Pastor Account"
                value={personNicknameInput}
                onChange={(e) => setPersonNicknameInput(e.target.value)}
                style={{
                  background: "var(--input-bg)",
                  border: "1px solid var(--input-border)",
                  color: "var(--text-primary)",
                  padding: "10px 14px",
                  borderRadius: "var(--radius)",
                  fontSize: "15px",
                  outline: "none",
                }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <label style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
                Tag Color
              </label>
              <div style={{ display: "flex", gap: "8px" }}>
                {["#F59E0B", "#EF4444", "#3B82F6", "#10B981", "#8B5CF6", "#EC4899"].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setPersonColorInput(c)}
                    style={{
                      width: "32px",
                      height: "32px",
                      borderRadius: "50%",
                      background: c,
                      border: personColorInput === c ? "2px solid var(--text-primary)" : "2px solid transparent",
                      cursor: "pointer",
                    }}
                  />
                ))}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px", paddingTop: "14px", borderTop: "1px solid var(--border)" }}>
              <button
                type="button"
                onClick={() => setShowPersonModal(false)}
                style={{ padding: "8px 18px", borderRadius: "var(--radius)", background: "var(--surface-raised)", color: "var(--text-primary)", border: "1px solid var(--border)", cursor: "pointer", fontSize: "14px", fontWeight: 500 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSavePerson}
                style={{ padding: "8px 18px", borderRadius: "var(--radius)", background: "var(--primary)", color: "#ffffff", fontWeight: 600, border: "none", cursor: "pointer", fontSize: "14px" }}
              >
                Save Profile
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ADD / EDIT CHANNEL */}
      {showChannelModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            backdropFilter: "blur(4px)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
          }}
          onClick={() => setShowChannelModal(false)}
        >
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "28px 32px",
              maxWidth: "480px",
              width: "100%",
              display: "flex",
              flexDirection: "column",
              gap: "18px",
              boxShadow: "0 20px 40px rgba(0, 0, 0, 0.6)",
              color: "var(--text-primary)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)", paddingBottom: "14px" }}>
              <h3 style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "var(--text-primary)" }}>
                {editingChannel?.channel ? "Edit Social Destination" : "Add Social Destination"}
              </h3>
              <button
                type="button"
                onClick={() => setShowChannelModal(false)}
                style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "4px" }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <label style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
                Platform
              </label>
              <select
                value={channelPlatformInput}
                onChange={(e) => {
                  const plat = e.target.value as BroadcastPlatform;
                  setChannelPlatformInput(plat);
                  setChannelServerInput(PLATFORM_INFO[plat].defaultServer);
                }}
                style={{
                  background: "var(--input-bg)",
                  border: "1px solid var(--input-border)",
                  color: "var(--text-primary)",
                  padding: "10px 14px",
                  borderRadius: "var(--radius)",
                  fontSize: "15px",
                  outline: "none",
                }}
              >
                <option value="youtube">YouTube Live</option>
                <option value="facebook">Facebook Live</option>
                <option value="instagram">Instagram Live</option>
                <option value="tiktok">TikTok Live</option>
                <option value="kick">Kick Stream</option>
                <option value="twitch">Twitch</option>
                <option value="custom">Custom RTMP Server</option>
              </select>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <label style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
                Channel Nickname / Label
              </label>
              <input
                type="text"
                placeholder="e.g. Church Main YouTube"
                value={channelNameInput}
                onChange={(e) => setChannelNameInput(e.target.value)}
                style={{
                  background: "var(--input-bg)",
                  border: "1px solid var(--input-border)",
                  color: "var(--text-primary)",
                  padding: "10px 14px",
                  borderRadius: "var(--radius)",
                  fontSize: "15px",
                  outline: "none",
                }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <label style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
                  Stream Key
                </label>
                <button
                  type="button"
                  onClick={() => setShowKeyInModal((v) => !v)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--text-muted)",
                    fontSize: "13px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                  }}
                >
                  {showKeyInModal ? <EyeOff size={15} /> : <Eye size={15} />}
                  <span>{showKeyInModal ? "Hide" : "Show"}</span>
                </button>
              </div>
              <input
                ref={streamKeyInputRef}
                type={showKeyInModal ? "text" : "password"}
                placeholder="Paste platform stream key..."
                value={channelKeyInput}
                onChange={(e) => setChannelKeyInput(e.target.value)}
                style={{
                  background: "var(--input-bg)",
                  border: "1px solid var(--input-border)",
                  color: "var(--text-primary)",
                  padding: "10px 14px",
                  borderRadius: "var(--radius)",
                  fontSize: "15px",
                  fontFamily: "monospace",
                  outline: "none",
                }}
              />

              {/* Where to get the key helper */}
              {PLATFORM_KEY_GUIDES[channelPlatformInput] && (
                <div className="broadcast-key-guide">
                  <div className="broadcast-key-guide__text">
                    <strong className="broadcast-key-guide__label">How to get this key:</strong>{" "}
                    <span>{PLATFORM_KEY_GUIDES[channelPlatformInput].instructions}</span>
                  </div>
                  {PLATFORM_KEY_GUIDES[channelPlatformInput].url && (
                    <button
                      type="button"
                      onClick={() => handleOpenExternalLink(PLATFORM_KEY_GUIDES[channelPlatformInput].url!)}
                      className="broadcast-key-guide__link"
                    >
                      <span>{PLATFORM_KEY_GUIDES[channelPlatformInput].actionLabel}</span>
                      <ExternalLink size={12} />
                    </button>
                  )}
                </div>
              )}
            </div>

            {channelPlatformInput === "youtube" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
                  Stream Server (YouTube Ingest)
                </label>
                <select
                  value={
                    channelServerInput && channelServerInput !== "auto"
                      ? channelServerInput
                      : "Primary YouTube ingest server"
                  }
                  onChange={(e) => setChannelServerInput(e.target.value)}
                  style={{
                    background: "var(--input-bg)",
                    border: "1px solid var(--input-border)",
                    color: "var(--text-primary)",
                    padding: "10px 14px",
                    borderRadius: "var(--radius)",
                    fontSize: "15px",
                    outline: "none",
                  }}
                >
                  <option value="Primary YouTube ingest server">Primary YouTube ingest server (RTMPS - Default)</option>
                  <option value="Primary YouTube ingest server (legacy RTMP)">Primary YouTube ingest server (Standard RTMP - Matches YouTube Studio)</option>
                  <option value="Backup YouTube ingest server">Backup YouTube ingest server</option>
                  <option value="Backup YouTube ingest server (legacy RTMP)">Backup YouTube ingest server (legacy RTMP)</option>
                </select>
                <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                  Standard RTMP matches your YouTube Studio URL (rtmp://a.rtmp.youtube.com/live2) for reliable delivery.
                </span>
              </div>
            )}

            {channelPlatformInput === "custom" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
                  Server RTMP URL
                </label>
                <input
                  type="text"
                  placeholder="rtmp://custom.server.com/live"
                  value={channelServerInput}
                  onChange={(e) => setChannelServerInput(e.target.value)}
                  style={{
                    background: "var(--input-bg)",
                    border: "1px solid var(--input-border)",
                    color: "var(--text-primary)",
                    padding: "10px 14px",
                    borderRadius: "var(--radius)",
                    fontSize: "15px",
                    fontFamily: "monospace",
                    outline: "none",
                  }}
                />
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px", paddingTop: "14px", borderTop: "1px solid var(--border)" }}>
              <button
                type="button"
                onClick={() => setShowChannelModal(false)}
                style={{ padding: "8px 18px", borderRadius: "var(--radius)", background: "var(--surface-raised)", color: "var(--text-primary)", border: "1px solid var(--border)", cursor: "pointer", fontSize: "14px", fontWeight: 500 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveChannel}
                style={{ padding: "8px 18px", borderRadius: "var(--radius)", background: "var(--primary)", color: "#ffffff", fontWeight: 600, border: "none", cursor: "pointer", fontSize: "14px" }}
              >
                Save Channel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HOW IT WORKS MODAL */}
      <BroadcastHowItWorksModal
        open={showInfoModal}
        onClose={() => setShowInfoModal(false)}
        allocation={allocation}
        onOpenUpgrade={() => setShowUpgradeModal(true)}
      />

      {/* UPGRADE MODAL */}
      {showUpgradeModal && (
        <UpgradeModal
          open={showUpgradeModal}
          onClose={() => setShowUpgradeModal(false)}
        />
      )}
    </div>
  );
}
