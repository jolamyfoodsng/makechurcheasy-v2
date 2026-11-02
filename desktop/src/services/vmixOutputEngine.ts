/**
 * vmixOutputEngine.ts — keeps vMix's "MCE Presentation" in step with what
 * MakeChurchEazy shows.
 *
 * Runs once, in the main app window. It listens to the presentation state that
 * the Dock window publishes (same app, so a local BroadcastChannel; nothing is
 * polled) and, for each change:
 *   - vMix titles mode: sets the title's text (and its look when switching
 *     between full screen and lower third), then brings it in;
 *   - Full themes mode: brings the Web Browser input's overlay in or out
 *     (the page itself already shows the new content).
 * vMix's state is read only when there is something to do.
 */

import { getPresentationSettings } from "./presentationSettings";
import {
  readLocalPresentationState,
  subscribeLocalPresentationState,
  type PresentationRemoteState,
} from "./presentationState";
import { VmixClient, loadVmixSettings, type VmixSettings } from "./vmixClient";
import {
  applyVmixOverlayActions,
  applyVmixTitleActions,
  planVmixOverlayActions,
  planVmixTitleActions,
  presentationContentKey,
} from "./vmixSetup";
import { ensureMceTitleFiles, titleContentFromState, type MceTitleContent, type MceTitleKind } from "./vmixTitles";

const ENGINE_CHANNEL = "mce-vmix-engine";

/** Ask the engine to put vMix in line with what is on screen now (after setup or a settings change). */
export function requestVmixResync(): void {
  try {
    const channel = new BroadcastChannel(ENGINE_CHANNEL);
    channel.postMessage({ type: "resync" });
    channel.close();
  } catch {
    // BroadcastChannel unavailable: the next change brings vMix in line.
  }
}

function settingsKey(settings: VmixSettings): string {
  return JSON.stringify(settings);
}

/** Start driving vMix. `isEnabled` is checked on every change (e.g. the church chose vMix). */
export function startVmixOutputEngine(isEnabled: () => boolean): () => void {
  const { sessionId } = getPresentationSettings();
  if (!sessionId || typeof window === "undefined") return () => undefined;

  let latest: PresentationRemoteState | null = readLocalPresentationState(sessionId);
  // What is already on screen counts as sent: only new content moves vMix.
  let appliedTitle: MceTitleContent | null | undefined = titleContentFromState(latest);
  let appliedKey: string | null | undefined = presentationContentKey(latest);
  // Unknown until MCE sets it, so the first title shown also sets the look.
  let titleLayout: MceTitleKind | null = null;
  let appliedSettings = "";
  let queue: Promise<void> = Promise.resolve();
  let warned = false;

  const run = (force: boolean) => {
    queue = queue
      .catch(() => undefined)
      .then(async () => {
        if (!isEnabled()) return;
        const settings = loadVmixSettings();
        // A changed setting (mode, overlay) means vMix must be re-sent what is on screen.
        const settingsChanged = settingsKey(settings) !== appliedSettings;
        if (settingsChanged) titleLayout = null;
        appliedSettings = settingsKey(settings);
        if (!settings.autoOverlay && !force) return;
        const client = new VmixClient(settings);
        const status = await client.getStatus();
        const resend = force || settingsChanged;

        if (settings.outputMode === "titles") {
          const next = titleContentFromState(latest);
          const actions = planVmixTitleActions(appliedTitle, next, status, settings, {
            force: resend,
            currentLayout: titleLayout,
          });
          appliedTitle = next;
          if (actions.length === 0) return;
          const needsImages = actions.some((action) => action.kind === "layout");
          const images = needsImages ? (await ensureMceTitleFiles()).images : null;
          await applyVmixTitleActions(client, settings, actions, images);
          if (needsImages && next) titleLayout = next.kind;
        } else {
          const next = presentationContentKey(latest);
          const actions = planVmixOverlayActions(appliedKey, next, status, settings, { force: resend });
          appliedKey = next;
          await applyVmixOverlayActions(client, settings, actions);
        }
        warned = false;
      })
      .catch((error) => {
        if (!warned) console.warn("[vMix] Could not update vMix:", error);
        warned = true;
      });
  };

  const unsubscribe = subscribeLocalPresentationState(sessionId, (state) => {
    latest = state;
    run(false);
  });

  let engineChannel: BroadcastChannel | null = null;
  try {
    engineChannel = new BroadcastChannel(ENGINE_CHANNEL);
    engineChannel.onmessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.data?.type !== "resync") return;
      latest = readLocalPresentationState(sessionId) ?? latest;
      // A new or re-made input has an unknown look.
      titleLayout = null;
      run(true);
    };
  } catch {
    engineChannel = null;
  }

  return () => {
    unsubscribe();
    engineChannel?.close();
  };
}
