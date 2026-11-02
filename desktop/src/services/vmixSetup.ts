/**
 * vmixSetup.ts — set up and drive vMix for MakeChurchEazy.
 *
 * MCE's own input is "MCE Presentation":
 *   - vMix titles mode: MCE's vMix title (see vmixTitles.ts), alongside any of
 *     the church's own vMix titles picked for scripture, songs or names;
 *   - Full themes mode: a Web Browser input showing the local presentation
 *     page (`/p/<session>`). `transparent=1` keeps the page see-through when it
 *     is empty, and `outDelay` keeps the last content on screen while vMix's
 *     overlay transition plays out.
 *
 * Everything MCE shows is published to the presentation state first, so vMix
 * needs no other data path. Nothing here touches OBS.
 */

import type { PresentationRemoteState } from "./presentationState";
import { getPresentationRemoteAccessInfo } from "./presentationRemote";
import { getPresentationSettings } from "./presentationSettings";
import {
  MCE_TITLE_FIELDS,
  MCE_TITLE_IMAGES,
  VMIX_BUILTIN_TITLES,
  churchTitleValues,
  ensureMceTitleFiles,
  guessTitleFields,
  titleImagesForLayout,
  type MceTitleContent,
  type MceTitleFiles,
  type MceTitleImages,
  type MceTitleKind,
} from "./vmixTitles";
import {
  MCE_VMIX_ALL_LAYERS,
  MCE_VMIX_INPUT_NAME,
  VMIX_TITLE_JOBS,
  VmixClient,
  activeVmixLayer,
  describeVmixLayer,
  findMceInput,
  findSlotInput,
  isTitleLayer,
  usesMceTitle,
  vmixInputTypeForLayer,
  type MceVmixLayer,
  type VmixChurchTitleSlot,
  type VmixInput,
  type VmixSettings,
  type VmixStatus,
  type VmixTitleJob,
} from "./vmixClient";

/** How long the page keeps cleared content while vMix transitions the overlay out. */
export const VMIX_OUT_DELAY_MS = 800;
const NEW_INPUT_WAIT_MS = 4000;
const NEW_INPUT_POLL_MS = 400;

/**
 * The presentation link for vMix's Web Browser input. It must come from the
 * app's presentation server, which pushes each change over a live connection;
 * any other address leaves the page checking for changes every 3 seconds.
 * vMix on this computer gets the 127.0.0.1 address, vMix elsewhere the network one.
 */
export async function resolveVmixPresentationLink(settings: VmixSettings): Promise<string> {
  const { sessionId, presentationLink } = getPresentationSettings();
  try {
    const info = await getPresentationRemoteAccessInfo(sessionId);
    if (info.running) {
      const local = /^(127\.|localhost$|::1$)/i.test(settings.host);
      return (local ? info.localLink : info.link) || presentationLink;
    }
  } catch {
    // Fall back to the saved link.
  }
  return presentationLink;
}

export function buildMceVmixInputUrl(presentationLink: string): string {
  const url = new URL(presentationLink);
  url.searchParams.set("transparent", "1");
  url.searchParams.set("outDelay", String(VMIX_OUT_DELAY_MS));
  return url.toString();
}

export interface VmixSetupResult {
  /** "created": MCE added the input now. "updated": it was already there. "manual": vMix wouldn't add it. */
  outcome: "created" | "updated" | "manual";
  layer: MceVmixLayer;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForNewInput(
  client: VmixClient,
  knownKeys: Set<string>,
  type: string,
  timeoutMs: number,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(NEW_INPUT_POLL_MS);
    const status = await client.getStatus();
    const added = status.inputs.find((input) => input.type === type && !knownKeys.has(input.key));
    if (added) return added.key;
  }
  return null;
}

/**
 * Make sure "MCE Presentation" exists in vMix for the chosen output mode. An
 * existing one is reused (never duplicated); one left from the other mode is
 * removed. If vMix will not add the input, the result says "manual".
 */
export async function setupMceVmixInput(
  client: VmixClient,
  presentationLink: string,
  settings: VmixSettings,
  options: {
    newInputWaitMs?: number;
    removeWaitMs?: number;
    /** Save the title and its images and return their paths (the app does this by default). */
    titleFiles?: () => Promise<MceTitleFiles>;
  } = {},
): Promise<VmixSetupResult> {
  const layer = activeVmixLayer(settings);
  await removeMceVmixInputs(client, settings, {
    layers: MCE_VMIX_ALL_LAYERS.filter((other) => other !== layer),
    removeWaitMs: options.removeWaitMs,
  });

  // Every job uses one of the church's own titles: nothing of MCE's to add.
  if (isTitleLayer(layer) && !usesMceTitle(settings)) return { outcome: "updated", layer };

  const type = vmixInputTypeForLayer(layer);
  const status = await client.getStatus();
  const existing = findMceInput(status, MCE_VMIX_INPUT_NAME, type);
  if (existing) {
    if (!isTitleLayer(layer)) {
      await client.navigateBrowser(existing.key || existing.number, buildMceVmixInputUrl(presentationLink));
    }
    return { outcome: "updated", layer };
  }

  const knownKeys = new Set(status.inputs.map((input) => input.key));
  let addedKey: string | null = null;
  try {
    if (isTitleLayer(layer)) {
      const files = await (options.titleFiles ?? ensureMceTitleFiles)();
      await client.addTitleInput(files.titlePath);
    } else {
      await client.addBrowserInput(buildMceVmixInputUrl(presentationLink));
    }
    addedKey = await waitForNewInput(client, knownKeys, type, options.newInputWaitMs ?? NEW_INPUT_WAIT_MS);
  } catch {
    addedKey = null;
  }
  if (!addedKey) return { outcome: "manual", layer };
  await client.setInputName(addedKey, MCE_VMIX_INPUT_NAME);
  return { outcome: "created", layer };
}

/**
 * Take MCE's input off its overlay and remove it (both modes unless `layers`
 * says which). The church's own inputs stay. vMix ignores a RemoveInput sent
 * while it is still removing the previous input, so each removal waits until
 * the input is gone.
 */
export async function removeMceVmixInputs(
  client: VmixClient,
  settings: VmixSettings,
  options: { layers?: readonly MceVmixLayer[]; removeWaitMs?: number } = {},
): Promise<number> {
  let removed = 0;
  for (const layer of options.layers ?? MCE_VMIX_ALL_LAYERS) {
    const state = describeVmixLayer(await client.getStatus(), settings, layer);
    if (!state.input) continue;
    const key = state.input.key;
    if (state.onOverlay) await client.overlayOff(state.channel);
    await client.removeInput(key || state.input.number);
    const deadline = Date.now() + (options.removeWaitMs ?? NEW_INPUT_WAIT_MS);
    while (Date.now() < deadline) {
      const after = await client.getStatus();
      if (!after.inputs.some((input) => input.key === key)) break;
      await sleep(NEW_INPUT_POLL_MS);
    }
    removed += 1;
  }
  return removed;
}

// ── Full themes mode: the overlay follows the page's content ────────────────

/** null when nothing is on screen, otherwise a key that changes with every new item. */
export function presentationContentKey(state: PresentationRemoteState | null): string | null {
  const parts = [
    state?.fullscreen ? JSON.stringify(state.fullscreen) : "",
    state?.lowerThird ? JSON.stringify(state.lowerThird) : "",
    state?.graphic?.url ? `${state.graphic.version}|${state.graphic.url}` : "",
  ];
  return parts.some(Boolean) ? parts.join("##") : null;
}

export type VmixOverlayAction =
  | { kind: "in"; input: string | number }
  | { kind: "out" };

/**
 * Overlay moves for a change of content. Only new content moves the overlay,
 * so an operator who takes it out by hand in vMix is not overruled until
 * something new is shown. "out" is only sent while MCE's input holds the
 * channel, never over another input.
 */
export function planVmixOverlayActions(
  previous: string | null | undefined,
  next: string | null,
  status: VmixStatus,
  settings: VmixSettings,
  options: { force?: boolean } = {},
): VmixOverlayAction[] {
  if (previous !== undefined && previous === next && !options.force) return [];
  const state = describeVmixLayer(status, settings, "presentation");
  if (!state.input) return [];
  if (next && !state.onOverlay) return [{ kind: "in", input: state.input.key || state.input.number }];
  if (!next && state.onOverlay) return [{ kind: "out" }];
  return [];
}

export async function applyVmixOverlayActions(
  client: VmixClient,
  settings: VmixSettings,
  actions: VmixOverlayAction[],
): Promise<void> {
  for (const action of actions) {
    if (action.kind === "in") await client.overlayIn(settings.overlay, action.input);
    else await client.overlayOut(settings.overlay);
  }
}

// ── vMix titles mode ────────────────────────────────────────────────────────

export type VmixTitleAction =
  /** MCE's own title: switch between the full-screen and lower-third look. */
  | { kind: "layout"; input: string | number; layout: MceTitleKind }
  /** Set text fields (MCE's title or a church title). */
  | { kind: "text"; input: string | number; values: Array<[field: string, value: string]> }
  | { kind: "in"; input: string | number }
  | { kind: "out" };

function sameTitleContent(a: MceTitleContent | null, b: MceTitleContent | null): boolean {
  if (!a || !b) return a === b;
  return a.kind === b.kind && a.job === b.job && a.reference === b.reference && a.text === b.text;
}

/** MCE's own title, and the church titles picked for each job (the only titles MCE may touch). */
function titleInputs(status: VmixStatus, settings: VmixSettings) {
  const mce = describeVmixLayer(status, settings, "title").input;
  const forJob = (job: VmixTitleJob): VmixInput | null =>
    settings.titles[job].kind === "mce" ? mce : findSlotInput(status, settings.titles[job]);
  const ours = new Set<number>(
    [mce, ...VMIX_TITLE_JOBS.map((job) => findSlotInput(status, settings.titles[job]))]
      .filter((input): input is VmixInput => Boolean(input))
      .map((input) => input.number),
  );
  return { mce, forJob, ours };
}

/**
 * vMix moves for new content. The item goes on the title for its job (MCE's
 * own or the church's): set the text, then bring that title in on the
 * overlay channel. MCE's title also switches look between full screen and
 * lower third. Only new content moves anything, so an operator who takes the
 * overlay out in vMix is not overruled until something new is shown, and
 * "out" is only sent while one of MCE's titles holds the channel.
 */
export function planVmixTitleActions(
  previous: MceTitleContent | null | undefined,
  next: MceTitleContent | null,
  status: VmixStatus,
  settings: VmixSettings,
  options: { force?: boolean; currentLayout?: MceTitleKind | null } = {},
): VmixTitleAction[] {
  if (previous !== undefined && sameTitleContent(previous, next) && !options.force) return [];
  const { mce, forJob, ours } = titleInputs(status, settings);
  const heldBy = status.overlays.find((overlay) => overlay.number === settings.overlay)?.inputNumber ?? null;

  if (!next) return heldBy !== null && ours.has(heldBy) ? [{ kind: "out" }] : [];

  const target = forJob(next.job);
  if (!target) return [];
  const input = target.key || target.number;
  const actions: VmixTitleAction[] = [];
  const slot = settings.titles[next.job];

  if (slot.kind === "mce" && mce) {
    if (options.currentLayout !== next.kind || options.force) actions.push({ kind: "layout", input, layout: next.kind });
    const fields = MCE_TITLE_FIELDS[next.kind];
    actions.push({ kind: "text", input, values: [[fields.reference, next.reference], [fields.text, next.text]] });
  } else if (slot.kind === "vmix") {
    const values = churchTitleValues(next);
    const pairs: Array<[string, string]> = [];
    if (slot.referenceField) pairs.push([slot.referenceField, values.reference]);
    if (slot.textField) pairs.push([slot.textField, values.text]);
    actions.push({ kind: "text", input, values: pairs });
  }
  if (heldBy !== target.number) actions.push({ kind: "in", input });
  return actions;
}

/**
 * Send title moves to vMix. A look change on MCE's title is wrapped in
 * PauseRender / ResumeRender so the background, the bar and the text change
 * in one frame.
 */
export async function applyVmixTitleActions(
  client: VmixClient,
  settings: VmixSettings,
  actions: VmixTitleAction[],
  images: MceTitleImages | null,
): Promise<void> {
  const layout = actions.find((action): action is Extract<VmixTitleAction, { kind: "layout" }> => action.kind === "layout");
  if (layout) await client.pauseRender(layout.input);
  try {
    for (const action of actions) {
      if (action.kind === "layout") {
        if (!images) continue;
        const slots = titleImagesForLayout(action.layout, images);
        const other = action.layout === "fullscreen" ? MCE_TITLE_FIELDS.lowerThird : MCE_TITLE_FIELDS.fullscreen;
        await Promise.all([
          client.setImage(action.input, MCE_TITLE_IMAGES.background, slots.background),
          client.setImage(action.input, MCE_TITLE_IMAGES.bar, slots.bar),
          client.setImage(action.input, MCE_TITLE_IMAGES.accent, slots.accent),
          client.setText(action.input, other.reference, ""),
          client.setText(action.input, other.text, ""),
        ]);
      } else if (action.kind === "text") {
        await Promise.all(action.values.map(([field, value]) => client.setText(action.input, field, value)));
      } else {
        if (layout) await client.resumeRender(layout.input);
        if (action.kind === "in") await client.overlayIn(settings.overlay, action.input);
        else await client.overlayOut(settings.overlay);
      }
    }
  } finally {
    // Resuming twice is harmless; never leave the title frozen.
    if (layout) await client.resumeRender(layout.input).catch(() => undefined);
  }
}

/**
 * Add vMix's own built-in title for a job (e.g. "Title 28- Scripture and
 * Verse Blue") from vMix's install folder, and return a slot for it with its
 * fields matched. Null when vMix isn't installed on this computer.
 */
export async function addVmixBuiltinTitle(
  client: VmixClient,
  job: VmixTitleJob,
  options: { findBuiltin?: (fileName: string) => Promise<string | null>; newInputWaitMs?: number } = {},
): Promise<VmixChurchTitleSlot | null> {
  const findBuiltin = options.findBuiltin ?? (async (name: string) => {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string | null>("vmix_builtin_title_path", { fileName: name });
  });
  const path = await findBuiltin(VMIX_BUILTIN_TITLES[job]);
  if (!path) return null;
  const before = await client.getStatus();
  const knownKeys = new Set(before.inputs.map((input) => input.key));
  await client.addTitleInput(path);
  const key = await waitForNewInput(client, knownKeys, "GT", options.newInputWaitMs ?? NEW_INPUT_WAIT_MS);
  if (!key) return null;
  const input = (await client.getStatus()).inputs.find((entry) => entry.key === key);
  return input ? slotForChurchTitle(input) : null;
}

/** A slot for one of the church's titles, with its fields matched from vMix's usual names. */
export function slotForChurchTitle(input: VmixInput): VmixChurchTitleSlot {
  return { kind: "vmix", key: input.key, title: input.title, ...guessTitleFields(input.fields) };
}

// ── Words shown in the vMix setup UI ────────────────────────────────────────

/** What MCE uses in vMix, for the setup step. */
export function vmixInputsHint(settings: VmixSettings, ready: boolean): string {
  if (settings.outputMode === "titles") {
    if (!usesMceTitle(settings)) {
      return ready
        ? "Your vMix titles are ready. MakeChurchEazy fills them in; it doesn't change their design."
        : "Pick a vMix title for each line below.";
    }
    return ready
      ? "Ready. vMix draws the titles itself, so they update instantly and use very little of the computer."
      : "Set up vMix adds MakeChurchEazy's vMix title, “MCE Presentation”. Your own titles are not changed, and you can use them instead below.";
  }
  return ready
    ? "“MCE Presentation” is in vMix with MakeChurchEazy's full themes. Everything you show appears on it."
    : "Set up vMix adds one Web Browser input, “MCE Presentation”. Your own inputs are not changed.";
}

/** What "show and hide automatically" does with these settings. */
export function vmixAutoOverlayHint(settings: VmixSettings): string {
  if (!settings.autoOverlay) {
    return "The overlay stays as it is. Use the overlay button, or vMix itself, to bring it in and out.";
  }
  return `When you show something, Overlay ${settings.overlay} comes in with your vMix transition, and goes out when you clear it.`;
}
