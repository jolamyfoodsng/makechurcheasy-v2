/**
 * dockBridge.ts — BroadcastChannel bridge for MakeChurchEazy Dock
 *
 * When the dock page is loaded inside OBS's Custom Browser Dock
 * (via the overlay HTTP server), it shares the same origin as the
 * main Tauri app window. This means they can communicate via
 * BroadcastChannel without needing WebSockets.
 *
 * Architecture:
 *   Dock (MakeChurchEazy Dock)  ──BroadcastChannel──►  Main App (Tauri)
 *     sends commands (e.g. "show-speaker", "send-bible-verse")
 *     receives state updates (e.g. OBS connected, current speaker, service status)
 *
 * The main app listens for dock commands and dispatches them to the
 * appropriate OBS services (bibleObsService, lowerThirdObsService, etc.)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import { getUserScopedKey } from "./userScopedStorage";

export type DockCommandType =
  // Speaker
  | "speaker:send-preview"
  | "speaker:go-live"
  | "speaker:clear"
  // Bible
  | "bible:send-preview"
  | "bible:go-live"
  | "bible:clear"
  // Lower Third / Event
  | "lt:send-preview"
  | "lt:go-live"
  | "lt:clear"
  // Worship
  | "worship:send-preview"
  | "worship:go-live"
  | "worship:clear-lyrics"
  | "worship:song-save"
  | "worship:song-archive"
  | "worship:save-preferences"
  // Notes
  | "notes:append"
  // Media
  | "media:save"
  | "media:delete"
  // Service Planner
  | "request-service-plans"
  | "service-plan:save"
  // Speech to Scripture
  | "voice-bible:start"
  | "voice-bible:stop"
  | "voice-bible:cancel"
  // LM Dock
  | "lm:start"
  | "lm:stop"
  | "lm:keep-listening"
  | "lm:navigate"
  // General
  | "ping"
  | "request-state"
  | "request-library-data"
  // Dock asks the app to re-fetch the account's themes and rewrite the Dock theme files
  | "themes:sync";

export interface DockCommand {
  type: DockCommandType;
  payload?: unknown;
  commandId?: string;
  timestamp: number;
}

export type DockStateType =
  | "state:update"
  | "state:obs-status"
  | "state:service-status"
  | "state:branding-updated"
  | "state:speakers"
  | "state:library-updated"
  | "state:songs-data"
  | "state:worship-song-save-result"
  | "state:notes-updated"
  | "state:service-plans"
  | "state:service-plan-save-result"
  | "state:live-tools"
  | "state:media-data"
  | "state:voice-bible-status"
  | "state:voice-bible-candidates"
  | "state:voice-bible-result"
  | "state:lm-status"
  | "state:lm-transcript"
  | "state:lm-candidates"
  | "state:bible-theme-updated"
  | "state:song-limit"
  | "state:plan-update"
  | "state:countdowns"
  | "state:favorite-themes-updated"
  | "state:pong"
  | "state:language-changed";

export interface DockStateMessage {
  type: DockStateType;
  payload: unknown;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Channel names
// ---------------------------------------------------------------------------

const DOCK_COMMAND_CHANNEL = "ocs-dock-commands";
const DOCK_STATE_CHANNEL = "ocs-dock-state";
const DOCK_STORAGE_EVENT_KEY = "ocs-dock-storage-event";
export const DOCK_BIBLE_LIVE_THEME_KEY = "ocs-dock-bible-live-theme";

function persistLiveBibleThemeSnapshot(msg: DockStateMessage): void {
  if (msg.type !== "state:bible-theme-updated") return;
  try {
    localStorage.setItem(
      getUserScopedKey(DOCK_BIBLE_LIVE_THEME_KEY),
      JSON.stringify(msg.payload ?? null),
    );
  } catch {
    // Ignore storage failures; BroadcastChannel remains the live transport.
  }
}

type StorageEventType =
  | "library-updated"
  | "songs-data"
  | "branding-updated"
  | "favorite-themes-updated";

interface StorageEventPayload {
  type: StorageEventType;
  payload?: unknown;
  timestamp: number;
}

function postStorageEvent(type: StorageEventType, payload?: unknown) {
  try {
    const event: StorageEventPayload = { type, payload, timestamp: Date.now() };
    localStorage.setItem(DOCK_STORAGE_EVENT_KEY, JSON.stringify(event));
  } catch {
    // localStorage might be unavailable
  }
}

function onStorageEvent(handler: (event: StorageEventPayload) => void): () => void {
  const listener = (e: StorageEvent) => {
    if (e.key !== DOCK_STORAGE_EVENT_KEY || !e.newValue) return;
    try {
      const event = JSON.parse(e.newValue) as StorageEventPayload;
      handler(event);
    } catch {
      // ignore parse errors
    }
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

// ---------------------------------------------------------------------------
// Dock Bridge — used by the main app to listen for dock commands
// and send state updates back to the dock
// ---------------------------------------------------------------------------

type CommandHandler = (cmd: DockCommand) => void;

class DockBridge {
  private commandChannel: BroadcastChannel | null = null;
  private stateChannel: BroadcastChannel | null = null;
  private handlers = new Set<CommandHandler>();
  private _initialized = false;

  /** Initialize the bridge (called once in the main app) */
  init() {
    if (this._initialized) return;
    this._initialized = true;

    try {
      this.commandChannel = new BroadcastChannel(DOCK_COMMAND_CHANNEL);
      this.stateChannel = new BroadcastChannel(DOCK_STATE_CHANNEL);

      this.commandChannel.onmessage = (ev: MessageEvent<DockCommand>) => {
        const cmd = ev.data;
        if (!cmd || !cmd.type) return;

        // Handle ping internally
        if (cmd.type === "ping") {
          this.sendState({ type: "state:pong", payload: null, timestamp: Date.now() });
        }

        // Dispatch ALL commands to registered handlers (including ping)
        for (const handler of this.handlers) {
          try {
            handler(cmd);
          } catch (e) {
            console.error("[DockBridge] Handler error:", e);
          }
        }
      };

    } catch (e) {
      console.warn("[DockBridge] BroadcastChannel not available:", e);
    }
  }

  /** Register a handler for dock commands */
  onCommand(handler: CommandHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Forward a command from the main app to dock clients. */
  sendCommand(cmd: DockCommand): void {
    try {
      this.commandChannel?.postMessage(cmd);
    } catch {
      // Channel might be closed during app shutdown.
    }
  }

  /** Send a state update to the dock */
  sendState(msg: DockStateMessage) {
    persistLiveBibleThemeSnapshot(msg);
    try {
      this.stateChannel?.postMessage(msg);
    } catch {
      // Channel might be closed
    }
  }

  /** Broadcast OBS connection status to the dock */
  sendObsStatus(connected: boolean) {
    this.sendState({
      type: "state:obs-status",
      payload: { connected },
      timestamp: Date.now(),
    });
  }

  /** Broadcast service status to the dock */
  sendServiceStatus(status: string, serviceName?: string) {
    this.sendState({
      type: "state:service-status",
      payload: { status, serviceName },
      timestamp: Date.now(),
    });
  }

  /** Broadcast full state snapshot to the dock */
  sendFullState(state: Record<string, unknown>) {
    this.sendState({
      type: "state:update",
      payload: state,
      timestamp: Date.now(),
    });
  }

  /** Notify the dock that library data (songs/media) changed so it can refresh */
  sendLibraryUpdated() {
    this.sendState({
      type: "state:library-updated",
      payload: null,
      timestamp: Date.now(),
    });
    postStorageEvent("library-updated");
  }

  sendBrandingUpdated(payload: Record<string, unknown> | null = null) {
    this.sendState({
      type: "state:branding-updated",
      payload,
      timestamp: Date.now(),
    });
  }

  sendFavoriteThemesUpdated(payload: Record<string, unknown> | null = null) {
    this.sendState({
      type: "state:favorite-themes-updated",
      payload,
      timestamp: Date.now(),
    });
    postStorageEvent("favorite-themes-updated", payload);
  }

  /** Notify all dock instances that the interface language changed */
  sendLanguageChanged(code: string) {
    this.sendState({
      type: "state:language-changed",
      payload: { code },
      timestamp: Date.now(),
    });
  }

  destroy() {
    this.commandChannel?.close();
    this.stateChannel?.close();
    this.handlers.clear();
    this._initialized = false;
  }
}

export const dockBridge = new DockBridge();

// ---------------------------------------------------------------------------
// Dock Client — used by the dock page to send commands and receive state
// ---------------------------------------------------------------------------

type StateHandler = (msg: DockStateMessage) => void;

class DockClient {
  private commandChannel: BroadcastChannel | null = null;
  private stateChannel: BroadcastChannel | null = null;
  private handlers = new Set<StateHandler>();
  private _initialized = false;
  private _storageCleanup: (() => void) | null = null;

  init() {
    if (this._initialized) return;
    this._initialized = true;

    try {
      this.commandChannel = new BroadcastChannel(DOCK_COMMAND_CHANNEL);
      this.stateChannel = new BroadcastChannel(DOCK_STATE_CHANNEL);

      this.stateChannel.onmessage = (ev: MessageEvent<DockStateMessage>) => {
        const msg = ev.data;
        if (!msg || !msg.type) return;

        // Persist plan to dock's own localStorage (different origin from main app)
        if (msg.type === "state:plan-update") {
          const payload = msg.payload as { plan?: string } | null;
          if (payload?.plan) {
            try {
              localStorage.setItem(getUserScopedKey("ocs-dock-plan"), payload.plan);
            } catch { /* ignore */ }
          }
        }

        for (const handler of this.handlers) {
          try {
            handler(msg);
          } catch (e) {
            console.error("[DockClient] Handler error:", e);
          }
        }
      };

      // Fallback: listen for localStorage events (works across origins)
      this._storageCleanup = onStorageEvent((event) => {
        if (event.type === "library-updated") {
          // Trigger a refresh by requesting library data
          this.sendCommand({ type: "request-library-data", timestamp: Date.now() });
          return;
        }
        if (event.type === "favorite-themes-updated") {
          const msg: DockStateMessage = {
            type: "state:favorite-themes-updated",
            payload: event.payload ?? null,
            timestamp: event.timestamp,
          };
          for (const handler of this.handlers) {
            try {
              handler(msg);
            } catch (e) {
              console.error("[DockClient] Handler error:", e);
            }
          }
        }
      });

      // Send initial ping to check if main app is running
      this.sendCommand({ type: "ping", timestamp: Date.now() });
    } catch (e) {
      console.warn("[DockClient] BroadcastChannel not available:", e);
    }
  }

  /** Send a command to the main app */
  sendCommand(cmd: DockCommand) {
    try {
      this.commandChannel?.postMessage(cmd);
    } catch {
      // Channel might be closed
    }
  }

  /** Share a dock-owned live snapshot with sibling dock tabs. */
  sendState(msg: DockStateMessage) {
    persistLiveBibleThemeSnapshot(msg);
    try {
      this.stateChannel?.postMessage(msg);
    } catch {
      // Channel might be closed
    }
  }

  /** Register a handler for state updates from the main app */
  onState(handler: StateHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Request full state from main app */
  requestState() {
    this.sendCommand({ type: "request-state", timestamp: Date.now() });
  }

  destroy() {
    this.commandChannel?.close();
    this.stateChannel?.close();
    this.handlers.clear();
    this._storageCleanup?.();
    this._initialized = false;
  }
}

export const dockClient = new DockClient();
