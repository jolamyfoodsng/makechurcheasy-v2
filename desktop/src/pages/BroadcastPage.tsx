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
  syncBroadcastStoreFromNative,
  initBroadcastCrossProcessSync,
  toggleChannelEnabled,
  moveChannel,
  updateChannel,
  updatePersonProfile,
  BROADCAST_STORAGE_KEY,
} from "../services/broadcastSettingsService";
import {
  ensureObsConnected,
  syncChannelToObs,
  syncProfileToObs,
} from "../services/broadcastObsSyncService";
import {
  getMultistreamUsageInfo,
  recordMultistreamHeartbeat,
  reportMultistreamError,
  reportMultistreamStatus,
  subscribeMultistreamUsage,
  MULTISTREAM_EXHAUSTED_EVENT,
  type MultistreamUsageInfo,
} from "../services/broadcastUsageService";
import { getMultistreamTarget, getTargetFreshness, isCloudTargetFor } from "../services/multistreamState";
import { MultistreamStatusPanel, useMultistreamTarget } from "../components/MultistreamStatusPanel";
import { dockObsClient } from "../dock/dockObsClient";
import { getStoredUser } from "../services/authService";
import { getEffectivePlan } from "../services/licenseService";
import { useAuth } from "../contexts/AuthContext";
import UpgradeModal from "../components/UpgradeModal";
import PlanLimitModal from "../components/PlanLimitModal";
import { BroadcastHowItWorksModal } from "../components/BroadcastHowItWorksModal";
import ModalDialog, { ModalNotice } from "../components/ModalDialog";
import {
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Check,
  Radio,
  RefreshCw,
  Loader2,
  Settings,
  MoreVertical,
  Pencil,
  Key,
  Square,
  AlertTriangle,
  ExternalLink,
  Info,
  HelpCircle,
  Zap,
  Link2,
  Users,
  ChevronRight,
  ArrowUp,
  ArrowDown,
} from "../components/icons/NativeIcons";
import { OBS_LOGO_BASE64 } from "../assets/obsLogoBase64";
import "./BroadcastPage.css";

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
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
          <rect width="24" height="24" rx="6" fill="#EF4444" />
          <path d="M10 8.5L16 12L10 15.5V8.5Z" fill="#FFFFFF" />
        </svg>
      );
    case "facebook":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
          <circle cx="12" cy="12" r="12" fill="#1877F2" />
          <path
            d="M15.5 12.5H13V19H10.5V12.5H9V10.2H10.5V8.8C10.5 7.1 11.5 6 13.5 6C14.3 6 15 6.1 15 6.1V8.2H14.1C13.2 8.2 13 8.7 13 9.4V10.2H15.4L15.5 12.5Z"
            fill="#FFFFFF"
          />
        </svg>
      );
    case "instagram":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
          <rect width="24" height="24" rx="6" fill="#E1306C" />
          <rect x="6.5" y="6.5" width="11" height="11" rx="3.5" stroke="#FFFFFF" strokeWidth="1.5" />
          <circle cx="12" cy="12" r="2.5" stroke="#FFFFFF" strokeWidth="1.5" />
          <circle cx="15.2" cy="8.8" r="0.8" fill="#FFFFFF" />
        </svg>
      );
    case "tiktok":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
          <rect width="24" height="24" rx="6" fill="#0F172A" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
          <path
            d="M14.5 7C14.8 8.1 15.6 9 16.7 9.3V11.2C15.8 11.2 15 10.9 14.3 10.4V14.3C14.3 16.3 12.7 18 10.7 18C8.7 18 7 16.3 7 14.3C7 12.3 8.6 10.7 10.6 10.7C10.8 10.7 11.1 10.7 11.3 10.8V12.7C11.1 12.6 10.9 12.5 10.7 12.5C9.7 12.5 8.9 13.3 8.9 14.3C8.9 15.3 9.7 16.1 10.7 16.1C11.7 16.1 12.5 15.3 12.5 14.3V6H14.5V7Z"
            fill="#00F2FE"
          />
        </svg>
      );
    case "kick":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
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
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
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
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
          <rect width="24" height="24" rx="6" fill="#1E293B" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
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

function getProfileInitials(nickname: string): string {
  if (!nickname) return "CH";
  const parts = nickname.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return nickname.slice(0, 2).toUpperCase();
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

export default function BroadcastPage() {
  const [store, setStore] = useState<BroadcastStoreState>(loadBroadcastStore);
  const [obsConnected, setObsConnected] = useState(dockObsClient.isConnected);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamTimecode, setStreamTimecode] = useState("00:00:00");
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);
  const [isConnectingObs, setIsConnectingObs] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showHowItWorksModal, setShowHowItWorksModal] = useState(false);
  const [showObsSettingsModal, setShowObsSettingsModal] = useState(false);

  // View mode and Dropdown states
  const [visibleKeyId, setVisibleKeyId] = useState<string | null>(null);
  const multistreamTarget = useMultistreamTarget();
  const [showManageProfileMenu, setShowManageProfileMenu] = useState(false);
  const [openProfileMenuId, setOpenProfileMenuId] = useState<string | null>(null);
  const [openChannelMenuId, setOpenChannelMenuId] = useState<string | null>(null);

  // OBS Settings inputs
  const [obsWsUrlInput, setObsWsUrlInput] = useState(() => {
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      try {
        return localStorage.getItem("mce_broadcast_obs_url") || "ws://localhost:4455";
      } catch {
        return "ws://localhost:4455";
      }
    }
    return "ws://localhost:4455";
  });
  const [obsWsPasswordInput, setObsWsPasswordInput] = useState(() => {
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      try {
        return localStorage.getItem("mce_broadcast_obs_password") || "";
      } catch {
        return "";
      }
    }
    return "";
  });
  const [showObsPassword, setShowObsPassword] = useState(false);
  const [obsTestingConnection, setObsTestingConnection] = useState(false);

  const { allocation } = useCurrentPlanAllocation();
  // Free plan: one profile and one channel, streamed straight from OBS (no cloud multistream).
  const multistreamLocked = !allocation.allowed;
  const [planLimit, setPlanLimit] = useState<{ title: string; message: string; reason: string } | null>(null);
  const showMultistreamLimit = useCallback((what: "profile" | "channel" | "enable") => {
    setPlanLimit({
      title: what === "profile" ? "One profile on the Free plan" : "Multistream is a paid feature",
      message: what === "profile"
        ? "The Free plan includes one streaming profile with one channel. Upgrade to save more profiles and stream to several platforms at once."
        : "The Free plan streams to one channel straight from OBS. Upgrade to Basic to go live on YouTube, Facebook, Instagram, TikTok and more at the same time (10 hours a month).",
      reason: what === "profile" ? "multistream_profile_limit" : "multistream_channel_limit",
    });
  }, []);
  const [usageInfo, setUsageInfo] = useState<MultistreamUsageInfo>(() =>
    getMultistreamUsageInfo(allocation.hours),
  );

  // Subscribe to multistream usage changes
  useEffect(() => {
    const unsub = subscribeMultistreamUsage((info) => {
      setUsageInfo(info);
    }, allocation.hours);
    return unsub;
  }, [allocation.hours]);

  // Modals state
  const [showPersonModal, setShowPersonModal] = useState(false);
  const [editingPerson, setEditingPerson] = useState<BroadcastPersonProfile | null>(null);
  const [personNameInput, setPersonNameInput] = useState("");
  const [personNicknameInput, setPersonNicknameInput] = useState("");
  const [personColorInput, setPersonColorInput] = useState("#EF4444");

  const [showChannelModal, setShowChannelModal] = useState(false);
  const [editingChannel, setEditingChannel] = useState<{ personId: string; channel: BroadcastChannel | null } | null>(null);
  const [channelPlatformInput, setChannelPlatformInput] = useState<BroadcastPlatform>("youtube");
  const [channelNameInput, setChannelNameInput] = useState("");
  const [channelKeyInput, setChannelKeyInput] = useState("");
  const [channelServerInput, setChannelServerInput] = useState("");
  const [showKeyInModal, setShowKeyInModal] = useState(false);

  // Profile / channel waiting for the person to confirm removal.
  const [pendingRemoval, setPendingRemoval] = useState<
    | { kind: "profile"; profile: BroadcastPersonProfile }
    | { kind: "channel"; personId: string; channel: BroadcastChannel }
    | null
  >(null);

  const streamKeyInputRef = useRef<HTMLInputElement>(null);

  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        !target.closest(".broadcast-profile-menu-wrapper") &&
        !target.closest(".broadcast-channel-menu-container") &&
        !target.closest(".broadcast-manage-profile-wrapper") &&
        !target.closest(".broadcast-dropdown-menu")
      ) {
        setOpenProfileMenuId(null);
        setOpenChannelMenuId(null);
        setShowManageProfileMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Sync store & instant cross-process updates
  useEffect(() => {
    initBroadcastCrossProcessSync();
    syncBroadcastStoreFromNative().then((latest) => {
      setStore(latest);
    });

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === BROADCAST_STORAGE_KEY) {
        setStore(loadBroadcastStore());
      }
    };

    const handleFocus = () => {
      syncBroadcastStoreFromNative().then((latest) => {
        setStore(latest);
      });
    };

    const handleCustomSync = (e: Event) => {
      const customEvent = e as CustomEvent<BroadcastStoreState>;
      if (customEvent.detail) {
        setStore(customEvent.detail);
      } else {
        setStore(loadBroadcastStore());
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("storage", handleStorageChange);
      window.addEventListener("focus", handleFocus);
      document.addEventListener("visibilitychange", handleFocus);
      window.addEventListener("mce-broadcast-store-updated", handleCustomSync);
    }

    const unsub = subscribeBroadcastStore((next) => {
      setStore(next);
    });

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("storage", handleStorageChange);
        window.removeEventListener("focus", handleFocus);
        document.removeEventListener("visibilitychange", handleFocus);
        window.removeEventListener("mce-broadcast-store-updated", handleCustomSync);
      }
      unsub();
    };
  }, []);

  // Poll OBS stream status periodically
  useEffect(() => {
    let mounted = true;
    const checkStatus = async () => {
      setObsConnected(dockObsClient.isConnected);
      if (!dockObsClient.isConnected) {
        setIsStreaming(false);
        return;
      }
      try {
        const status = await dockObsClient.getStreamStatus();
        const streaming = Boolean(status?.outputActive);
        if (mounted) {
          setIsStreaming(streaming);
          setStreamTimecode(status?.outputTimecode || "00:00:00");

          // Reconcile with latest native store if updated in another tab/dock
          const curStore = loadBroadcastStore();
          setStore((prev) => {
            if (curStore.updatedAt && curStore.updatedAt !== prev.updatedAt) {
              return curStore;
            }
            if (JSON.stringify(curStore.profiles) !== JSON.stringify(prev.profiles)) {
              return curStore;
            }
            return prev;
          });

          // Count multi-stream time only while OBS is really going through the cloud engine.
          const target = getMultistreamTarget();
          const cloudLive = streaming && Boolean(target && isCloudTargetFor(target.profileId, target));
          const liveDestinations = cloudLive && target ? target.destinations.filter((d) => d.ok) : [];
          void reportMultistreamStatus({
            active: cloudLive,
            profileName: target?.profileName || "",
            channels: liveDestinations.map((d) => ({ name: d.name, platform: d.platform })),
          });
          if (cloudLive && allocation.allowed) {
            const updated = recordMultistreamHeartbeat(allocation.hours);
            setUsageInfo(updated);
          }
        }
      } catch {
        if (mounted) setIsStreaming(false);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 2000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [allocation.allowed, allocation.hours]);

  const activeProfile = getActiveProfile(store);
  const delivery = activeProfile?.channels.filter(ch => ch.enabled && ch.streamKey.trim()) ?? [];
  const targetFreshness = activeProfile ? getTargetFreshness(activeProfile.id, delivery, multistreamTarget) : "none";
  useEffect(() => { setVisibleKeyId(null); }, [activeProfile?.id]);
  useEffect(() => {
    if (!visibleKeyId) return;
    const timer = window.setTimeout(() => setVisibleKeyId(null), 15000);
    const hide = () => setVisibleKeyId(null);
    window.addEventListener("blur", hide);
    return () => { window.clearTimeout(timer); window.removeEventListener("blur", hide); };
  }, [visibleKeyId]);

  const showToast = useCallback((text: string, type: "success" | "error" | "info" = "success") => {
    setStatusMessage({ text, type });
    setTimeout(() => {
      setStatusMessage(null);
    }, 5000);
  }, []);

  // Hours ran out mid-service: tell the operator. The current broadcast is not cut off.
  useEffect(() => {
    const onExhausted = () =>
      showToast("This month's multi-stream hours are used up. This broadcast keeps going; next time OBS will stream to one destination.", "error");
    window.addEventListener(MULTISTREAM_EXHAUSTED_EVENT, onExhausted);
    return () => window.removeEventListener(MULTISTREAM_EXHAUSTED_EVENT, onExhausted);
  }, [showToast]);

  const handleSelectPerson = useCallback(
    async (profileId: string) => {
      const updated = setActiveProfileId(profileId);
      setStore(updated);
      setOpenProfileMenuId(null);
      const profile = updated.profiles.find((p) => p.id === profileId);
      if (!profile) return;

      if (profile.channels.length > 0) {
        setIsSyncing(true);
        try {
          const res = await syncProfileToObs(profile, dockObsClient, updated);
          if (res.success) {
            setObsConnected(true);
            setSyncSuccess(true);
            setTimeout(() => setSyncSuccess(false), 3000);
            showToast(res.warning ? res.message : `Selected "${profile.nickname}" and synced with OBS!`, res.warning ? "info" : "success");
          } else {
            setObsConnected(dockObsClient.isConnected);
            showToast(
              `Selected "${profile.nickname}". ${res.message}`,
              "error",
            );
          }
        } catch (err: unknown) {
          setObsConnected(dockObsClient.isConnected);
          const msg = (err as { message?: string })?.message || "Connection refused";
          showToast(`Could not connect to OBS: ${msg}`, "error");
        } finally {
          setIsSyncing(false);
        }
      } else {
        showToast(`Selected profile: ${profile.nickname}`, "info");
      }
    },
    [showToast],
  );

  const handleConnectObsDirectly = useCallback(async () => {
    if (obsConnected) {
      showToast("OBS Studio is already connected and ready.", "info");
      return;
    }
    setIsConnectingObs(true);
    showToast("Connecting to OBS Studio...", "info");
    try {
      const res = await ensureObsConnected();
      if (res.connected) {
        setObsConnected(true);
        showToast("Connected to OBS Studio!", "success");
      } else {
        showToast(
          "Could not connect to OBS. Make sure OBS is open with WebSocket enabled (in OBS: Tools → WebSocket Server Settings).",
          "error",
        );
      }
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || "Connection refused";
      showToast(`OBS Connection error: ${msg}`, "error");
    } finally {
      setIsConnectingObs(false);
    }
  }, [obsConnected, showToast]);

  const handleTestObsConnection = async () => {
    setObsTestingConnection(true);
    try {
      localStorage.setItem("mce_broadcast_obs_url", obsWsUrlInput.trim());
      if (obsWsPasswordInput) {
        localStorage.setItem("mce_broadcast_obs_password", obsWsPasswordInput);
      } else {
        localStorage.removeItem("mce_broadcast_obs_password");
      }

      await dockObsClient.connect(
        obsWsUrlInput.trim() || undefined,
        obsWsPasswordInput.trim() || undefined,
      );
      setObsConnected(true);
      showToast("Connected to OBS WebSocket successfully!", "success");
      setShowObsSettingsModal(false);
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || "Connection failed";
      showToast(`Could not connect: ${msg}`, "error");
    } finally {
      setObsTestingConnection(false);
    }
  };

  const handleApplyActivePersonToObs = useCallback(async () => {
    if (!activeProfile) {
      showToast("Please create or select a profile first.", "error");
      return;
    }
    if (activeProfile.channels.length === 0) {
      showToast("Please add at least one channel to this profile first.", "error");
      return;
    }

    setIsSyncing(true);
    try {
      if (!dockObsClient.isConnected) {
        showToast("Connecting to OBS Studio...", "info");
      }
      const res = await syncProfileToObs(activeProfile, dockObsClient, store);
      if (res.success) {
        setObsConnected(true);
        setSyncSuccess(true);
        setTimeout(() => setSyncSuccess(false), 3500);
        showToast(res.message, res.warning ? "info" : "success");
      } else {
        showToast(res.message, "error");
      }
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || "Unknown error";
      showToast(`Failed to sync profile with OBS: ${msg}`, "error");
    } finally {
      setIsSyncing(false);
    }
  }, [activeProfile, showToast, store]);

  const handleApplyChannelToObs = useCallback(
    async (channel: BroadcastChannel, nickname?: string) => {
      if (!channel.streamKey.trim()) {
        showToast(
          `Stream key for "${channel.name}" is empty. Please enter your stream key first.`,
          "error",
        );
        return;
      }
      setIsSyncing(true);
      try {
        if (!dockObsClient.isConnected) {
          showToast("Connecting to OBS Studio...", "info");
        }
        const res = await syncChannelToObs(
          channel,
          nickname,
          dockObsClient,
          activeProfile?.id,
        );
        if (res.success) {
          setObsConnected(true);
          showToast(res.message, "success");
        } else {
          showToast(res.message, "error");
        }
      } catch (err: unknown) {
        const msg = (err as { message?: string })?.message || "Unknown error";
        showToast(`Failed to sync channel with OBS: ${msg}`, "error");
      } finally {
        setIsSyncing(false);
      }
    },
    [activeProfile?.id, showToast],
  );

  const handleToggleStream = useCallback(async () => {
    if (!dockObsClient.isConnected) {
      showToast("Connecting to OBS Studio...", "info");
      const conn = await ensureObsConnected();
      if (!conn.connected) {
        showToast(
          "Could not connect to OBS. Please ensure OBS Studio is open on this computer with WebSocket enabled.",
          "error",
        );
        return;
      }
      setObsConnected(true);
    }
    try {
      if (isStreaming) {
        await dockObsClient.stopStream();
        setIsStreaming(false);
        showToast("Stopped live stream.", "info");
      } else {
        if (activeProfile) {
          const syncRes = await syncProfileToObs(activeProfile, dockObsClient, store);
          if (!syncRes.success) {
            showToast(syncRes.message, "error");
            return;
          }
          if (syncRes.warning) {
            await dockObsClient.startStream();
            setIsStreaming(true);
            showToast(`Live. ${syncRes.message}`, "info");
            return;
          }
        }
        await dockObsClient.startStream();
        setIsStreaming(true);
        showToast("Live stream started in OBS!", "success");
      }
    } catch (err: unknown) {
      console.error("[BroadcastPage] Stream toggle error:", err);
      const channels = activeProfile?.channels.filter((channel) => channel.enabled && channel.streamKey.trim()) || [];
      if (channels.length > 1) {
        void reportMultistreamError({
          stage: "obs_stream",
          code: "OBS_STREAM_TOGGLE_FAILED",
          message: "OBS could not start or stop the multi-stream session.",
          profileName: activeProfile?.nickname || activeProfile?.name || "",
          channels: channels.map((channel) => ({ name: channel.name, platform: channel.platform })),
        });
      }
      showToast("Failed to start/stop stream in OBS. Please check OBS settings.", "error");
    }
  }, [activeProfile, isStreaming, showToast, store]);

  // Profile modal
  const openNewPersonModal = () => {
    if (multistreamLocked && store.profiles.length >= 1) {
      setOpenProfileMenuId(null);
      showMultistreamLimit("profile");
      return;
    }
    setEditingPerson(null);
    setPersonNameInput("");
    setPersonNicknameInput("");
    setPersonColorInput("#EF4444");
    setOpenProfileMenuId(null);
    setShowPersonModal(true);
  };

  const openEditPersonModal = (p: BroadcastPersonProfile) => {
    setEditingPerson(p);
    setPersonNameInput(p.name);
    setPersonNicknameInput(p.nickname);
    setPersonColorInput(p.color);
    setOpenProfileMenuId(null);
    setShowPersonModal(true);
  };

  const handleSavePerson = () => {
    if (!personNameInput.trim()) {
      showToast("Please enter a profile name.", "error");
      return;
    }
    if (editingPerson) {
      updatePersonProfile(editingPerson.id, {
        name: personNameInput.trim(),
        nickname: personNicknameInput.trim() || personNameInput.trim(),
        color: personColorInput,
      });
      showToast(`Updated profile: ${personNicknameInput.trim() || personNameInput.trim()}`, "success");
    } else {
      const added = addPersonProfile(
        personNameInput.trim(),
        personNicknameInput.trim() || personNameInput.trim(),
        personColorInput,
      );
      showToast(`Created profile: ${added.nickname}`, "success");
    }
    setShowPersonModal(false);
  };

  const handleDeletePerson = (p: BroadcastPersonProfile) => {
    setOpenProfileMenuId(null);
    setPendingRemoval({ kind: "profile", profile: p });
  };

  const confirmDeletePerson = (p: BroadcastPersonProfile) => {
    deletePersonProfile(p.id);
    showToast(`Deleted profile: ${p.nickname}`, "info");
  };

  // Channel modal
  const openNewChannelModalWithPlatform = (personId: string, platform: BroadcastPlatform = "youtube") => {
    const owner = store.profiles.find((p) => p.id === personId);
    if (multistreamLocked && owner && owner.channels.length >= 1) {
      setOpenChannelMenuId(null);
      showMultistreamLimit("channel");
      return;
    }
    setEditingChannel({ personId, channel: null });
    setChannelPlatformInput(platform);
    const platLabel = PLATFORM_INFO[platform]?.label || platform;
    const defaultName = activeProfile ? `${activeProfile.nickname} (${platLabel})` : platLabel;
    setChannelNameInput(defaultName);
    setChannelKeyInput("");
    setChannelServerInput(PLATFORM_INFO[platform]?.defaultServer || "Primary YouTube ingest server");
    setShowKeyInModal(false);
    setOpenChannelMenuId(null);
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
    setOpenChannelMenuId(null);
    setShowChannelModal(true);
    if (focusKey) {
      setTimeout(() => {
        streamKeyInputRef.current?.focus();
      }, 100);
    }
  };

  const handleSaveChannel = async () => {
    if (!editingChannel) return;
    if (!channelNameInput.trim()) {
      showToast("Please enter a channel name.", "error");
      return;
    }
    const isEditing = !!editingChannel.channel;
    const targetPersonId = editingChannel.personId;
    let updatedStore: BroadcastStoreState;

    if (isEditing && editingChannel.channel) {
      updatedStore = updateChannel(targetPersonId, editingChannel.channel.id, {
        name: channelNameInput.trim(),
        platform: channelPlatformInput,
        streamKey: channelKeyInput.trim(),
        serverUrl: channelServerInput.trim() || PLATFORM_INFO[channelPlatformInput].defaultServer,
      });
    } else {
      addChannelToProfile(targetPersonId, {
        name: channelNameInput.trim(),
        platform: channelPlatformInput,
        streamKey: channelKeyInput.trim(),
        serverUrl: channelServerInput.trim() || PLATFORM_INFO[channelPlatformInput].defaultServer,
        enabled: true,
      });
      updatedStore = loadBroadcastStore();
    }
    setStore(updatedStore);
    setShowChannelModal(false);

    // Auto-connect and sync immediately with OBS Studio!
    const targetProfile = updatedStore.profiles.find((p) => p.id === targetPersonId);
    if (!targetProfile) return;

    setIsSyncing(true);
    try {
      const res = await syncProfileToObs(targetProfile, dockObsClient, updatedStore);
      if (res.success) {
        setObsConnected(true);
        setSyncSuccess(true);
        setTimeout(() => setSyncSuccess(false), 3500);
        showToast(
          res.warning
            ? res.message
            : isEditing
            ? `Updated "${channelNameInput.trim()}" and synced with OBS!`
            : `Added "${channelNameInput.trim()}" and synced with OBS!`,
          res.warning ? "info" : "success",
        );
      } else {
        setObsConnected(dockObsClient.isConnected);
        showToast(
          `Channel saved. ${res.message}`,
          "error",
        );
      }
    } catch (err: unknown) {
      setObsConnected(dockObsClient.isConnected);
      const msg = (err as { message?: string })?.message || "Connection refused";
      showToast(
        `Channel saved, but failed to connect to OBS: ${msg}. Make sure OBS is open with WebSocket enabled.`,
        "error",
      );
    } finally {
      setIsSyncing(false);
    }
  };

  const handleToggleChannelEnabled = async (profileId: string, channelId: string) => {
    if (isStreaming) return;
    if (multistreamLocked) {
      // Free: only one channel can be on. Turning a second one on asks to upgrade.
      const owner = store.profiles.find((p) => p.id === profileId);
      const target = owner?.channels.find((c) => c.id === channelId);
      if (owner && target && !target.enabled && owner.channels.some((c) => c.enabled && c.id !== channelId)) {
        showMultistreamLimit("enable");
        return;
      }
    }
    const updatedStore = toggleChannelEnabled(profileId, channelId);
    setStore(updatedStore);

    const targetProfile = updatedStore.profiles.find((p) => p.id === profileId);
    if (!targetProfile) return;

    const toggledChannel = targetProfile.channels.find((c) => c.id === channelId);
    const actionLabel = toggledChannel?.enabled ? "enabled" : "disabled";

    setIsSyncing(true);
    try {
      const res = await syncProfileToObs(targetProfile, dockObsClient, updatedStore);
      if (res.success) {
        setObsConnected(true);
        setSyncSuccess(true);
        setTimeout(() => setSyncSuccess(false), 3000);
        showToast(res.warning ? res.message : `Channel ${actionLabel} and synced with OBS!`, res.warning ? "info" : "success");
      } else {
        setObsConnected(dockObsClient.isConnected);
        showToast(`Channel ${actionLabel}. ${res.message}`, "error");
      }
    } catch (err: unknown) {
      setObsConnected(dockObsClient.isConnected);
      const msg = (err as { message?: string })?.message || "Connection refused";
      showToast(`Could not connect to OBS: ${msg}`, "error");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDeleteChannel = (personId: string, ch: BroadcastChannel) => {
    setOpenChannelMenuId(null);
    setPendingRemoval({ kind: "channel", personId, channel: ch });
  };

  const confirmDeleteChannel = async (personId: string, ch: BroadcastChannel) => {
    const updatedStore = deleteChannel(personId, ch.id);
    setStore(updatedStore);
    showToast(`Removed channel: ${ch.name}`, "info");

    const prof = updatedStore.profiles.find((p) => p.id === personId);
    if (prof && prof.channels.length > 0) {
      try {
        const res = await syncProfileToObs(prof, dockObsClient, updatedStore);
        if (res.success) {
          setObsConnected(true);
        } else {
          setObsConnected(dockObsClient.isConnected);
          showToast(res.message, "error");
        }
      } catch (err: unknown) {
        setObsConnected(dockObsClient.isConnected);
        const msg = (err as { message?: string })?.message || "Connection refused";
        showToast(`Could not connect to OBS: ${msg}`, "error");
      }
    }
  };

  return (
    <div className="broadcast-page">
      {/* Toast Feedback */}
      {statusMessage && (
        <div className={`broadcast-toast broadcast-toast--${statusMessage.type}`}>
          {statusMessage.type === "success" ? (
            <Check size={18} />
          ) : statusMessage.type === "error" ? (
            <AlertTriangle size={18} />
          ) : (
            <Radio size={18} />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Live Stream Status Bar (when actively live) */}
      {isStreaming && (
        <div className="broadcast-live-banner">
          <div className="broadcast-live-banner__info">
            <span className="broadcast-pulse-dot broadcast-pulse-dot--live" />
            <span className="broadcast-live-badge">LIVE ON AIR</span>
            <span className="broadcast-live-timecode">{streamTimecode}</span>
          </div>
          <button
            type="button"
            onClick={handleToggleStream}
            className="broadcast-stop-stream-btn"
            title="Stop stream in OBS"
          >
            <Square size={13} fill="#FFFFFF" />
            <span>STOP STREAM</span>
          </button>
        </div>
      )}

      {/* ── Top Hero Promotional Banner (Top-Left Above Profile Spanning Full Page Width) ── */}
      <div className="broadcast-hero-banner">
        <div className="broadcast-hero-banner__content">
          <h2 className="broadcast-hero-title">
            Stream to multiple platforms{" "}
            <span className="broadcast-hero-highlight">with one click</span>
          </h2>
          <p className="broadcast-hero-description">
            Multistream live to YouTube, Facebook, Instagram, TikTok, Twitch, and custom RTMP platforms simultaneously in real time directly from OBS Studio.
          </p>
          <div className="broadcast-hero-chips">
            <div className="broadcast-hero-chip">
              <Zap size={13} className="broadcast-hero-chip__icon" />
              <span>No manual setup</span>
            </div>
            <div className="broadcast-hero-chip">
              <Link2 size={13} className="broadcast-hero-chip__icon" />
              <span>One-click stream</span>
            </div>
            <div className="broadcast-hero-chip">
              <Users size={13} className="broadcast-hero-chip__icon" />
              <span>Save multiple profiles</span>
            </div>
            <button
              type="button"
              onClick={() => setShowHowItWorksModal(true)}
              className="broadcast-hero-how-it-works-btn"
              title="Learn how Multi-Platform Streaming works"
            >
              <HelpCircle size={13} />
              <span>How it works</span>
            </button>
          </div>
        </div>


      </div>

      {multistreamLocked && (
        <div className="broadcast-free-notice" role="status">
          <span className="broadcast-free-notice__tag">Free plan</span>
          <span className="broadcast-free-notice__text">
            You can stream to <strong>one channel</strong> straight from OBS. Multistream to several platforms at once is on Basic and up.
          </span>
          <button type="button" className="broadcast-free-notice__cta" onClick={() => showMultistreamLimit("channel")}>
            Unlock multistream
          </button>
        </div>
      )}

      {/* ── Main Layout: Sidebar on Left, Content on Right (Stacked in Small Width) ── */}
      <div className="broadcast-main-container">
        {/* ── Left Column / Top in Small Mode: Profiles Card ── */}
        <aside className="broadcast-profiles-panel">
          <div className="broadcast-panel-header">
            <h2 className="broadcast-panel-title">Profiles</h2>
            <button
              type="button"
              onClick={openNewPersonModal}
              disabled={isStreaming}
              className="broadcast-add-profile-btn"
              title={isStreaming ? "Cannot add profile while streaming live" : "Create new streaming profile"}
            >
              <Plus size={15} />
              <span className="broadcast-add-profile-btn__label-full">Add Profile</span>
              <span className="broadcast-add-profile-btn__label-short">Add</span>
            </button>
          </div>

          <p className="broadcast-profiles-description">Choose a profile to manage its streaming destinations.</p>
          <div className="broadcast-profiles-list">
            {store.profiles.map((p) => {
              const isSelected = activeProfile?.id === p.id;
              const isMenuOpen = openProfileMenuId === p.id;
              const initials = getProfileInitials(p.nickname);

              return (
                <div
                  key={p.id}
                  className={`broadcast-profile-card ${
                    isSelected ? "broadcast-profile-card--selected" : ""
                  }`}
                >
                  <button type="button" className="broadcast-profile-select" disabled={isStreaming}
                    onClick={() => handleSelectPerson(p.id)} aria-pressed={isSelected}>
                  <div
                    className="broadcast-profile-avatar"
                    style={{ backgroundColor: p.color || "#EF4444" }}
                  >
                    {initials}
                  </div>

                  <div className="broadcast-profile-info">
                    <div className="broadcast-profile-name">{p.nickname}</div>
                    <div className="broadcast-profile-count">
                      {p.channels.length} {p.channels.length === 1 ? "channel" : "channels"}
                    </div>
                  </div>

                  <ChevronRight size={18} className="broadcast-profile-chevron" />
                  </button>
                  <div
                    className="broadcast-profile-menu-wrapper"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        !isStreaming && setOpenProfileMenuId((prev) => (prev === p.id ? null : p.id))
                      }
                      disabled={isStreaming}
                      className="broadcast-icon-btn-dots"
                      title={isStreaming ? "Cannot modify profile while streaming live" : "Profile options"}
                    >
                      <MoreVertical size={16} />
                    </button>

                    {isMenuOpen && (
                      <div className="broadcast-dropdown-menu">
                        <button
                          type="button"
                          onClick={() => openEditPersonModal(p)}
                          className="broadcast-dropdown-item"
                        >
                          <Pencil size={14} />
                          <span>Rename Profile</span>
                        </button>
                        {store.profiles.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleDeletePerson(p)}
                            className="broadcast-dropdown-item broadcast-dropdown-item--danger"
                          >
                            <Trash2 size={14} />
                            <span>Delete Profile</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* ── Right Column / Workspace ── */}
        <main className="broadcast-main-workspace">
          {activeProfile && (
            <>
              {/* 1. Active Profile Header Bar */}
              <div className="broadcast-active-profile-card">
                <div className="broadcast-active-profile-card__left">
                  <div
                    className="broadcast-active-avatar"
                    style={{ backgroundColor: activeProfile.color || "#3B82F6" }}
                  >
                    {getProfileInitials(activeProfile.nickname)}
                  </div>
                  <div className="broadcast-active-profile-meta">
                    <div className="broadcast-active-profile-title-row">
                      <h1 className="broadcast-active-profile-name">{activeProfile.nickname}</h1>
                      <button
                        type="button"
                        onClick={() => !isStreaming && openEditPersonModal(activeProfile)}
                        disabled={isStreaming}
                        className="broadcast-edit-pencil-btn"
                        title={isStreaming ? "Cannot edit profile while streaming live" : "Edit profile name"}
                      >
                        <Pencil size={15} />
                      </button>
                    </div>
                    <div className="broadcast-active-profile-channels-count">
                      {activeProfile.channels.length} {activeProfile.channels.length === 1 ? "channel" : "channels"}
                    </div>
                  </div>
                </div>

                <div className="broadcast-active-profile-card__right">
                  {/* Compact OBS Connection Status Badge */}
                  <button
                    type="button"
                    onClick={
                      !obsConnected
                        ? handleConnectObsDirectly
                        : handleApplyActivePersonToObs
                    }
                    disabled={isSyncing || isConnectingObs || isStreaming}
                    className="broadcast-obs-status-btn"
                    title={
                      isStreaming
                        ? "Live stream active"
                        : obsConnected
                        ? "OBS Connected. Click to sync channels."
                        : "Click to connect OBS Studio"
                    }
                  >
                    <span
                      className={`broadcast-obs-status-dot ${
                        obsConnected ? "broadcast-obs-status-dot--connected" : ""
                      }`}
                    />
                    <span className="broadcast-obs-status-text">
                      {isConnectingObs
                        ? "Connecting OBS..."
                        : isSyncing
                        ? "Syncing OBS..."
                        : syncSuccess
                        ? "✓ Synced with OBS"
                        : obsConnected
                        ? "Connected to OBS"
                        : "Not Connected to OBS"}
                    </span>
                    <RefreshCw
                      size={13}
                      className={`broadcast-obs-status-refresh ${
                        isSyncing || isConnectingObs ? "spin" : ""
                      }`}
                    />
                  </button>

                  {/* Manage Profile Dropdown Button */}
                  <div className="broadcast-manage-profile-wrapper">
                    <button
                      type="button"
                      onClick={() => !isStreaming && setShowManageProfileMenu((v) => !v)}
                      disabled={isStreaming}
                      className="broadcast-manage-profile-btn"
                      title="Manage Profile"
                    >
                      <Settings size={14} />
                      <span>Profile Settings</span>
                    </button>

                    {showManageProfileMenu && (
                      <div className="broadcast-dropdown-menu broadcast-dropdown-menu--right">
                        <button
                          type="button"
                          onClick={() => {
                            setShowManageProfileMenu(false);
                            openEditPersonModal(activeProfile);
                          }}
                          className="broadcast-dropdown-item"
                        >
                          <Pencil size={14} />
                          <span>Edit Profile Details</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowManageProfileMenu(false);
                            setShowObsSettingsModal(true);
                          }}
                          className="broadcast-dropdown-item"
                        >
                          <Settings size={14} />
                          <span>OBS WebSocket Settings</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowManageProfileMenu(false);
                            setShowHowItWorksModal(true);
                          }}
                          className="broadcast-dropdown-item"
                        >
                          <Info size={14} />
                          <span>How It Works</span>
                        </button>
                        {store.profiles.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              setShowManageProfileMenu(false);
                              handleDeletePerson(activeProfile);
                            }}
                            className="broadcast-dropdown-item broadcast-dropdown-item--danger"
                          >
                            <Trash2 size={14} />
                            <span>Delete Profile</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="broadcast-channels-card">
                <MultistreamStatusPanel
                  profile={activeProfile}
                  isStreaming={isStreaming}
                  allowed={allocation.allowed}
                  usage={usageInfo}
                  applying={isSyncing}
                  onApply={handleApplyActivePersonToObs}
                  workspace
                  icon={<img src={OBS_LOGO_BASE64} alt="" width={42} height={42} />}
                />
                {activeProfile.channels.length === 0 ? (
                  <div className="broadcast-empty-channels-box">
                    <Radio size={32} aria-hidden="true" />
                    <h4 className="broadcast-empty-title">Add your first channel</h4>
                    <p className="broadcast-empty-subtitle">Choose a platform below to add your streaming destination.</p>
                  </div>
                ) : (
                  <div className="broadcast-destination-list">
                    {activeProfile.channels.map((ch, index) => {
                      const hasKey = Boolean(ch.streamKey.trim());
                      const applied = targetFreshness === "applied"
                        ? multistreamTarget?.destinations.find(d => d.id === ch.id) : undefined;
                      const status = !ch.enabled ? "Not enabled" : !hasKey ? "Stream key missing"
                        : applied && !applied.ok ? applied.reason || "Not included"
                        : applied?.ok ? (isStreaming ? "Receiving the stream" : "Ready") : "Waiting to be applied";
                      const tone = !ch.enabled ? "muted" : !hasKey || (applied && !applied.ok) ? "error"
                        : applied?.ok ? "ready" : "muted";
                      return (
                        <div key={ch.id} className="broadcast-destination-row">
                          <div className="broadcast-destination-identity">
                            <span className="broadcast-destination-number" aria-label={`Channel ${index + 1}`}>{String(index + 1).padStart(2, "0")}</span>
                            <span className="broadcast-destination-logo"><PlatformBadgeIcon platform={ch.platform} size={42} /></span>
                            <div className="broadcast-destination-meta">
                              <div className="broadcast-destination-name">
                                <span title={ch.name}>{ch.name}</span>
                                <button type="button" className="broadcast-edit-pencil-btn" disabled={isStreaming || isSyncing}
                                  aria-label={`Edit ${ch.name}`} onClick={() => openEditChannelModal(activeProfile.id, ch)}><Pencil size={15} /></button>
                              </div>
                              <span className={`broadcast-destination-status broadcast-destination-status--${tone}`}><i aria-hidden="true" />{status}</span>
                            </div>
                          </div>
                          <div className="broadcast-stream-key">
                            <div className="broadcast-stream-key-value">
                              <span>Stream key</span>
                              {hasKey ? <span className="broadcast-key-text">{visibleKeyId === ch.id ? ch.streamKey : "••••••••••••"}</span>
                                : <span className={ch.enabled ? "broadcast-key-missing" : ""}>Not set</span>}
                            </div>
                            {hasKey ? <button type="button" className="broadcast-key-reveal" aria-label={`${visibleKeyId === ch.id ? "Hide" : "Show"} stream key for ${ch.name}`}
                              aria-pressed={visibleKeyId === ch.id} onClick={() => setVisibleKeyId(visibleKeyId === ch.id ? null : ch.id)}>
                              {visibleKeyId === ch.id ? <EyeOff size={19} /> : <Eye size={19} />}
                            </button> : <button type="button" className="broadcast-add-key" disabled={isStreaming || isSyncing}
                              onClick={() => openEditChannelModal(activeProfile.id, ch, true)}>Add Key</button>}
                          </div>
                          <div className="broadcast-destination-actions">
                            <button type="button" role="switch" aria-checked={ch.enabled} aria-label={`Enable ${ch.name}`}
                              className={`broadcast-channel-toggle ${ch.enabled ? "broadcast-channel-toggle--checked" : ""}`}
                              disabled={isStreaming || isSyncing} onClick={() => handleToggleChannelEnabled(activeProfile.id, ch.id)}>
                              <span className="broadcast-channel-toggle-thumb" />
                            </button>
                            <div className="broadcast-channel-menu-container">
                              <button type="button" className="broadcast-destination-menu" aria-label={`Options for ${ch.name}`} aria-expanded={openChannelMenuId === ch.id}
                                onClick={() => setOpenChannelMenuId(openChannelMenuId === ch.id ? null : ch.id)}><MoreVertical size={20} /></button>
                              {openChannelMenuId === ch.id && <div className="broadcast-dropdown-menu broadcast-dropdown-menu--right">
                                <button type="button" disabled={isStreaming || isSyncing} onClick={() => { setOpenChannelMenuId(null); openEditChannelModal(activeProfile.id, ch); }}><Pencil size={14} />Edit channel</button>
                                <button type="button" disabled={isStreaming || isSyncing} onClick={() => { setOpenChannelMenuId(null); openEditChannelModal(activeProfile.id, ch, true); }}><Key size={14} />Replace stream key</button>
                                <button type="button" disabled={isStreaming || isSyncing || !hasKey} onClick={() => { setOpenChannelMenuId(null); void handleApplyChannelToObs(ch, activeProfile.nickname); }}><RefreshCw size={14} />Send this channel to OBS</button>
                                <button type="button" disabled={isStreaming || isSyncing || index === 0} onClick={() => { moveChannel(activeProfile.id, ch.id, "up"); setOpenChannelMenuId(null); }}><ArrowUp size={14} />Move up</button>
                                <button type="button" disabled={isStreaming || isSyncing || index === activeProfile.channels.length - 1} onClick={() => { moveChannel(activeProfile.id, ch.id, "down"); setOpenChannelMenuId(null); }}><ArrowDown size={14} />Move down</button>
                                <button type="button" className="broadcast-dropdown-item--danger" disabled={isStreaming || isSyncing} onClick={() => { setOpenChannelMenuId(null); handleDeleteChannel(activeProfile.id, ch); }}><Trash2 size={14} />Remove channel</button>
                              </div>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Bottom Quick-Add Pill Strip (Always present to easily add more platforms) */}
                <div className="broadcast-add-another-strip">
                  <span className="broadcast-add-another-label">Add another channel:</span>
                  <div className="broadcast-add-another-buttons">
                    <button
                      type="button"
                      onClick={() => !isStreaming && openNewChannelModalWithPlatform(activeProfile.id, "youtube")}
                      disabled={isStreaming}
                      className="broadcast-pill-btn broadcast-pill-btn--youtube"
                      title="Add YouTube Channel"
                    >
                      <PlatformBadgeIcon platform="youtube" size={16} />
                      <span>YouTube</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => !isStreaming && openNewChannelModalWithPlatform(activeProfile.id, "facebook")}
                      disabled={isStreaming}
                      className="broadcast-pill-btn broadcast-pill-btn--facebook"
                      title="Add Facebook Channel"
                    >
                      <PlatformBadgeIcon platform="facebook" size={16} />
                      <span>Facebook</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => !isStreaming && openNewChannelModalWithPlatform(activeProfile.id, "instagram")}
                      disabled={isStreaming}
                      className="broadcast-pill-btn broadcast-pill-btn--instagram"
                      title="Add Instagram Channel"
                    >
                      <PlatformBadgeIcon platform="instagram" size={16} />
                      <span>Instagram</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => !isStreaming && openNewChannelModalWithPlatform(activeProfile.id, "tiktok")}
                      disabled={isStreaming}
                      className="broadcast-pill-btn broadcast-pill-btn--tiktok"
                      title="Add TikTok Channel"
                    >
                      <PlatformBadgeIcon platform="tiktok" size={16} />
                      <span>TikTok</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => !isStreaming && openNewChannelModalWithPlatform(activeProfile.id, "twitch")}
                      disabled={isStreaming}
                      className="broadcast-pill-btn broadcast-pill-btn--twitch"
                      title="Add Twitch Channel"
                    >
                      <PlatformBadgeIcon platform="twitch" size={16} />
                      <span>Twitch</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => !isStreaming && openNewChannelModalWithPlatform(activeProfile.id, "custom")}
                      disabled={isStreaming}
                      className="broadcast-pill-btn broadcast-pill-btn--rtmp"
                      title="Add Custom RTMP Channel"
                    >
                      <Link2 size={14} />
                      <span>RTMP</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* 4. Bottom Info Box */}
              <div className="broadcast-cloud-info-box">
                <div className="broadcast-cloud-info-box__icon">
                  <Info size={19} color="var(--accent-blue)" />
                </div>
                <div className="broadcast-cloud-info-box__text">
                  <span className="broadcast-cloud-info-box__title">No extra plugins needed</span>
                  <span className="broadcast-cloud-info-box__desc">
                    Make Church Eazy uses a built-in cloud broadcasting engine. Send a single stream from OBS, and we&apos;ll duplicate it to your destinations without extra CPU or upload bandwidth strain on your church PC.
                  </span>
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      {/* ── MODAL: ADD / EDIT PROFILE ── */}
      {showPersonModal && (
        <ModalDialog
          icon={<Users size={26} />}
          title={editingPerson ? "Rename Profile" : "Create Profile"}
          onClose={() => setShowPersonModal(false)}
          closeOnBackdrop
          extra={
            <div className="broadcast-modal-form">
              <div className="broadcast-form-group">
                <label className="broadcast-form-label">
                  Profile Name (e.g. Church Account, Sunday Service, Department)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Sunday Service or Youth Ministry"
                  value={personNameInput}
                  onChange={(e) => setPersonNameInput(e.target.value)}
                  className="broadcast-form-input"
                  autoFocus
                />
              </div>

              <div className="broadcast-form-group">
                <label className="broadcast-form-label">Display Label / Nickname</label>
                <input
                  type="text"
                  placeholder="e.g. Sunday"
                  value={personNicknameInput}
                  onChange={(e) => setPersonNicknameInput(e.target.value)}
                  className="broadcast-form-input"
                />
              </div>

              <div className="broadcast-form-group">
                <label className="broadcast-form-label">Profile Badge Color</label>
                <div className="broadcast-color-picker">
                  {["#EF4444", "#10B981", "#F59E0B", "#6366F1", "#8B5CF6", "#EC4899", "#3B82F6"].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setPersonColorInput(c)}
                      className={`broadcast-color-swatch ${personColorInput === c ? "broadcast-color-swatch--active" : ""}`}
                      style={{ background: c }}
                      aria-label={`Badge color ${c}`}
                      aria-pressed={personColorInput === c}
                    />
                  ))}
                </div>
              </div>
            </div>
          }
          actions={[
            { label: "Cancel", onClick: () => setShowPersonModal(false), variant: "ghost" },
            { label: "Save Profile", onClick: handleSavePerson, variant: "primary" },
          ]}
        />
      )}

      {/* ── MODAL: ADD / EDIT CHANNEL ── */}
      {showChannelModal && (
        <ModalDialog
          icon={<Radio size={26} />}
          title={editingChannel?.channel ? "Edit Channel" : "Add Channel"}
          onClose={() => setShowChannelModal(false)}
          width={520}
          extra={
            <div className="broadcast-modal-form">
              <div className="broadcast-form-group">
                <label className="broadcast-form-label">Platform</label>
                <select
                  value={channelPlatformInput}
                  onChange={(e) => {
                    const plat = e.target.value as BroadcastPlatform;
                    setChannelPlatformInput(plat);
                    setChannelServerInput(PLATFORM_INFO[plat]?.defaultServer || "auto");
                  }}
                  className="broadcast-form-select"
                >
                  <option value="youtube">YouTube</option>
                  <option value="facebook">Facebook</option>
                  <option value="instagram">Instagram</option>
                  <option value="tiktok">TikTok</option>
                  <option value="kick">Kick</option>
                  <option value="twitch">Twitch</option>
                  <option value="custom">Custom RTMP Server</option>
                </select>
              </div>

              <div className="broadcast-form-group">
                <label className="broadcast-form-label">Channel Name / Label</label>
                <input
                  type="text"
                  placeholder="e.g. Church Main YouTube"
                  value={channelNameInput}
                  onChange={(e) => setChannelNameInput(e.target.value)}
                  className="broadcast-form-input"
                />
              </div>

              <div className="broadcast-form-group">
                <div className="broadcast-form-label-row">
                  <label className="broadcast-form-label">Stream Key</label>
                  <button
                    type="button"
                    onClick={() => setShowKeyInModal((v) => !v)}
                    className="broadcast-form-toggle-link"
                  >
                    {showKeyInModal ? <EyeOff size={14} /> : <Eye size={14} />}
                    <span>{showKeyInModal ? "Hide" : "Show"}</span>
                  </button>
                </div>
                <input
                  ref={streamKeyInputRef}
                  type={showKeyInModal ? "text" : "password"}
                  placeholder="Paste platform stream key..."
                  value={channelKeyInput}
                  onChange={(e) => setChannelKeyInput(e.target.value)}
                  className="broadcast-form-input font-mono"
                />

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
                <div className="broadcast-form-group">
                  <label className="broadcast-form-label">Stream Server (YouTube Ingest)</label>
                  <select
                    value={
                      channelServerInput && channelServerInput !== "auto"
                        ? channelServerInput
                        : "Primary YouTube ingest server"
                    }
                    onChange={(e) => setChannelServerInput(e.target.value)}
                    className="broadcast-form-select"
                  >
                    <option value="Primary YouTube ingest server">Primary YouTube ingest server (RTMPS - Default)</option>
                    <option value="Primary YouTube ingest server (legacy RTMP)">Primary YouTube ingest server (Standard RTMP - Matches YouTube Studio)</option>
                    <option value="Backup YouTube ingest server">Backup YouTube ingest server</option>
                    <option value="Backup YouTube ingest server (legacy RTMP)">Backup YouTube ingest server (legacy RTMP)</option>
                  </select>
                  <span className="broadcast-form-hint">
                    Standard RTMP matches your YouTube Studio URL (rtmp://a.rtmp.youtube.com/live2) for reliable delivery.
                  </span>
                </div>
              )}

              {channelPlatformInput === "custom" && (
                <div className="broadcast-form-group">
                  <label className="broadcast-form-label">Streaming Server Address (RTMP URL)</label>
                  <input
                    type="text"
                    placeholder="rtmp://custom.server.com/live"
                    value={channelServerInput}
                    onChange={(e) => setChannelServerInput(e.target.value)}
                    className="broadcast-form-input font-mono"
                  />
                </div>
              )}
            </div>
          }
          actions={[
            { label: "Cancel", onClick: () => setShowChannelModal(false), variant: "ghost" },
            { label: "Save Channel", onClick: () => void handleSaveChannel(), variant: "primary" },
          ]}
        />
      )}

      {/* ── MODAL: OBS WEBSOCKET SETTINGS ── */}
      {showObsSettingsModal && (
        <ModalDialog
          icon={<Settings size={26} />}
          iconBusy={obsTestingConnection}
          title="OBS WebSocket Settings"
          onClose={() => setShowObsSettingsModal(false)}
          extra={
            <div className="broadcast-modal-form">
              <div className="broadcast-form-group">
                <label className="broadcast-form-label">WebSocket URL</label>
                <input
                  type="text"
                  placeholder="ws://localhost:4455"
                  value={obsWsUrlInput}
                  onChange={(e) => setObsWsUrlInput(e.target.value)}
                  className="broadcast-form-input font-mono"
                />
                <span className="broadcast-form-hint">Default port in OBS Studio 28+ is 4455.</span>
              </div>

              <div className="broadcast-form-group">
                <div className="broadcast-form-label-row">
                  <label className="broadcast-form-label">Server Password (Optional)</label>
                  <button
                    type="button"
                    onClick={() => setShowObsPassword((v) => !v)}
                    className="broadcast-form-toggle-link"
                  >
                    {showObsPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    <span>{showObsPassword ? "Hide" : "Show"}</span>
                  </button>
                </div>
                <input
                  type={showObsPassword ? "text" : "password"}
                  placeholder="Leave empty if password authentication is disabled"
                  value={obsWsPasswordInput}
                  onChange={(e) => setObsWsPasswordInput(e.target.value)}
                  className="broadcast-form-input font-mono"
                />
              </div>

              <ModalNotice tone="info" icon={<Info size={14} />}>
                <strong>Tip:</strong> In OBS Studio, go to <strong>Tools → WebSocket Server Settings</strong> and check <strong>&ldquo;Enable WebSocket server&rdquo;</strong>.
              </ModalNotice>
            </div>
          }
          actions={[
            { label: "Close", onClick: () => setShowObsSettingsModal(false), variant: "ghost" },
            {
              label: obsTestingConnection ? "Connecting..." : "Save & Test Connection",
              onClick: () => void handleTestObsConnection(),
              variant: "primary",
              disabled: obsTestingConnection,
              icon: obsTestingConnection ? <Loader2 size={14} className="spin" /> : undefined,
            },
          ]}
        >
          Make Church Eazy connects to OBS Studio using the built-in OBS WebSocket Server to synchronize stream keys automatically.
        </ModalDialog>
      )}

      {/* ── CONFIRM: REMOVE PROFILE / CHANNEL ── */}
      {pendingRemoval && (
        <ModalDialog
          tone="danger"
          icon={<Trash2 size={26} />}
          title={pendingRemoval.kind === "profile" ? "Delete this profile?" : "Remove this channel?"}
          onClose={() => setPendingRemoval(null)}
          actions={[
            { label: "Cancel", onClick: () => setPendingRemoval(null), variant: "ghost", autoFocus: true },
            pendingRemoval.kind === "profile"
              ? {
                  label: "Delete profile",
                  variant: "danger",
                  onClick: () => {
                    const { profile } = pendingRemoval;
                    setPendingRemoval(null);
                    confirmDeletePerson(profile);
                  },
                }
              : {
                  label: "Remove channel",
                  variant: "danger",
                  onClick: () => {
                    const { personId, channel } = pendingRemoval;
                    setPendingRemoval(null);
                    void confirmDeleteChannel(personId, channel);
                  },
                },
          ]}
        >
          {pendingRemoval.kind === "profile"
            ? <>Delete profile &ldquo;{pendingRemoval.profile.nickname}&rdquo; and its configured channels?</>
            : <>Remove &ldquo;{pendingRemoval.channel.name}&rdquo; from this profile?</>}
        </ModalDialog>
      )}

      {/* ── MODAL: HOW IT WORKS ── */}
      <BroadcastHowItWorksModal
        open={showHowItWorksModal}
        onClose={() => setShowHowItWorksModal(false)}
        allocation={allocation}
        onOpenUpgrade={() => {
          setShowHowItWorksModal(false);
          setShowUpgradeModal(true);
        }}
      />

      {/* ── MODAL: FREE PLAN LIMIT ── */}
      <PlanLimitModal
        open={planLimit !== null}
        onClose={() => setPlanLimit(null)}
        title={planLimit?.title ?? ""}
        message={planLimit?.message ?? ""}
        requiredPlan="basic"
        reason={planLimit?.reason}
      />

      {/* ── MODAL: UPGRADE ── */}
      {showUpgradeModal && (
        <UpgradeModal
          open={showUpgradeModal}
          onClose={() => setShowUpgradeModal(false)}
        />
      )}
    </div>
  );
}
