/**
 * vMix control for the Dock.
 *
 * vMix has no WebSocket. It has an HTTP API (GET requests to /api/, the same
 * address as vMix's Web Controller, port 8088 by default) and a TCP API on
 * port 8099. This file uses the HTTP API, relayed through the app (see
 * `VmixClient`), because vMix refuses requests made by web pages.
 *
 * - `GET /api` with no query returns the whole vMix state as XML.
 * - `GET /api/?Function=<Name>&Input=<number|name|guid>&Value=<value>` runs a
 *   vMix shortcut function. 200 means it ran, 500 means vMix rejected it.
 *
 * Docs: https://www.vmix.com/help29/DeveloperAPI.html
 *       https://www.vmix.com/help29/ShortcutFunctionReference.html
 *
 * MCE fills the church's vMix titles, or shows its full themes in a Web
 * Browser input (see `VmixOutputMode`). `vmixSetup.ts` sets these up.
 */

export const VMIX_DEFAULT_HOST = "127.0.0.1";
export const VMIX_DEFAULT_PORT = 8088;
export const VMIX_OVERLAY_CHANNELS = [1, 2, 3, 4] as const;
export type VmixOverlayChannel = (typeof VMIX_OVERLAY_CHANNELS)[number];

/**
 * How MCE shows things in vMix.
 *
 * "titles" (the default): vMix titles that vMix draws itself, brought in on an
 * overlay channel. For each job (scripture, songs, names) MCE uses either its
 * own title, "MCE Presentation" (see vmixTitles.ts), or a title the church
 * already has in vMix — its own design or one of vMix's built-in titles — whose
 * text fields MCE fills with SetText. The two live side by side: MCE only
 * touches its own title and the titles the church picked for it.
 * "browser": MCE's full themes in one Web Browser input, "MCE Presentation".
 */
export type VmixOutputMode = "titles" | "browser";

/** The jobs a vMix title does for MCE. */
export type VmixTitleJob = "scripture" | "songs" | "names";
export const VMIX_TITLE_JOBS: readonly VmixTitleJob[] = ["scripture", "songs", "names"];

/** Which title does a job: MCE's own, or one of the church's vMix titles and the fields MCE fills. */
export type VmixTitleSlot =
  | { kind: "mce" }
  | {
    kind: "vmix";
    /** vMix's input key (kept across vMix restarts by the preset). */
    key: string;
    /** The input's name, to find it again if the key changed. */
    title: string;
    /** Field for the reference or a person's name, e.g. "Verse.Text" or "Headline.Text"; "" for none. */
    referenceField: string;
    /** Field for the verse, lyric or role, e.g. "Message.Text" or "Description.Text"; "" for none. */
    textField: string;
  };
export type VmixChurchTitleSlot = Extract<VmixTitleSlot, { kind: "vmix" }>;

/**
 * MCE's own inputs: its title ("title", a GT title) and, for Full themes, its
 * Web Browser input ("presentation"). Both are called "MCE Presentation"; the
 * input type tells them apart, so neither clashes with the church's titles.
 */
export type MceVmixLayer = "title" | "presentation";
export const MCE_VMIX_ALL_LAYERS: readonly MceVmixLayer[] = ["title", "presentation"];
export const MCE_VMIX_INPUT_NAME = "MCE Presentation";
export const MCE_VMIX_INPUT_NAMES: Record<MceVmixLayer, string> = {
  title: MCE_VMIX_INPUT_NAME,
  presentation: MCE_VMIX_INPUT_NAME,
};

export function isTitleLayer(layer: MceVmixLayer): layer is "title" {
  return layer === "title";
}

/** vMix's input type for each of MCE's inputs: a GT title or a Web Browser input. */
export function vmixInputTypeForLayer(layer: MceVmixLayer): string {
  return isTitleLayer(layer) ? "GT" : "Browser";
}

const SETTINGS_KEY = "mce-dock-vmix-settings";
const REQUEST_TIMEOUT_MS = 2500;

export interface VmixSettings {
  host: string;
  port: number;
  outputMode: VmixOutputMode;
  /** The overlay channel MCE uses in vMix. */
  overlay: VmixOverlayChannel;
  /** Bring the overlay in when something is shown and take it out when cleared. */
  autoOverlay: boolean;
  /** The title for each job (titles mode). MCE's own title unless the church picks one of theirs. */
  titles: Record<VmixTitleJob, VmixTitleSlot>;
}

export const DEFAULT_VMIX_SETTINGS: VmixSettings = {
  host: VMIX_DEFAULT_HOST,
  port: VMIX_DEFAULT_PORT,
  outputMode: "titles",
  overlay: 1,
  autoOverlay: true,
  titles: { scripture: { kind: "mce" }, songs: { kind: "mce" }, names: { kind: "mce" } },
};

function normalizeChannel(value: unknown, fallback: VmixOverlayChannel): VmixOverlayChannel {
  const channel = Math.round(Number(value));
  return (VMIX_OVERLAY_CHANNELS as readonly number[]).includes(channel) ? (channel as VmixOverlayChannel) : fallback;
}

function normalizeSlot(raw: unknown): VmixTitleSlot {
  const slot = (raw && typeof raw === "object" ? raw : {}) as Partial<VmixChurchTitleSlot>;
  const key = String(slot.key ?? "").trim();
  const title = String(slot.title ?? "").trim();
  if (slot.kind !== "vmix" || (!key && !title)) return { kind: "mce" };
  return {
    kind: "vmix",
    key,
    title,
    referenceField: String(slot.referenceField ?? ""),
    textField: String(slot.textField ?? ""),
  };
}

export function normalizeVmixSettings(
  raw: (Partial<VmixSettings> & { overlayChannel?: unknown; fullscreenOverlay?: unknown }) | null | undefined,
): VmixSettings {
  const host = String(raw?.host ?? "").trim().replace(/^https?:\/\//i, "").replace(/[/:].*$/, "");
  const port = Math.round(Number(raw?.port));
  const titles = (raw?.titles ?? {}) as Partial<Record<VmixTitleJob, unknown>>;
  return {
    host: host || DEFAULT_VMIX_SETTINGS.host,
    port: Number.isFinite(port) && port >= 1 && port <= 65535 ? port : DEFAULT_VMIX_SETTINGS.port,
    outputMode: raw?.outputMode === "browser" ? "browser" : "titles",
    // Earlier versions saved the channel as `fullscreenOverlay` or `overlayChannel`.
    overlay: normalizeChannel(raw?.overlay ?? raw?.fullscreenOverlay ?? raw?.overlayChannel, DEFAULT_VMIX_SETTINGS.overlay),
    autoOverlay: raw?.autoOverlay !== false,
    titles: {
      scripture: normalizeSlot(titles.scripture),
      songs: normalizeSlot(titles.songs),
      names: normalizeSlot(titles.names),
    },
  };
}

export function overlayForLayer(settings: VmixSettings, _layer: MceVmixLayer): VmixOverlayChannel {
  return settings.overlay;
}

/** MCE's input for the chosen output mode. */
export function activeVmixLayer(settings: VmixSettings): MceVmixLayer {
  return settings.outputMode === "titles" ? "title" : "presentation";
}

/** Whether any job uses MCE's own title (then setup adds it). */
export function usesMceTitle(settings: VmixSettings): boolean {
  return VMIX_TITLE_JOBS.some((job) => settings.titles[job].kind === "mce");
}

/** vMix title inputs (GT titles and the older XAML titles): inputs with text fields. */
export function isVmixTitleInput(input: VmixInput): boolean {
  return input.fields.length > 0 && input.type !== "Browser";
}

/** The church title a slot points at: by key, or by name if vMix gave it a new key. */
export function findSlotInput(status: VmixStatus, slot: VmixTitleSlot): VmixInput | null {
  if (slot.kind !== "vmix") return null;
  return (
    status.inputs.find((input) => slot.key && input.key === slot.key) ??
    status.inputs.find((input) => isVmixTitleInput(input) && input.title === slot.title) ??
    null
  );
}

export function loadVmixSettings(): VmixSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return normalizeVmixSettings(raw ? (JSON.parse(raw) as Partial<VmixSettings>) : null);
  } catch {
    return { ...DEFAULT_VMIX_SETTINGS };
  }
}

export function saveVmixSettings(settings: VmixSettings): VmixSettings {
  const normalized = normalizeVmixSettings(settings);
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
  } catch {
    // Storage can be unavailable; the settings then last until the Dock reloads.
  }
  return normalized;
}

// ── State XML ───────────────────────────────────────────────────────────────

export interface VmixInput {
  key: string;
  number: number;
  type: string;
  title: string;
  state: string;
  /** A title's text fields, as SetText names them (e.g. "Message.Text"). Empty for other inputs. */
  fields: string[];
}

export interface VmixOverlay {
  number: number;
  /** Number of the input on this overlay channel, or null when it is empty. */
  inputNumber: number | null;
}

export interface VmixStatus {
  version: string;
  edition: string;
  inputs: VmixInput[];
  overlays: VmixOverlay[];
  active: number;
  preview: number;
  recording: boolean;
  streaming: boolean;
}

export type VmixErrorCode = "unreachable" | "timeout" | "http" | "not_vmix";

export class VmixError extends Error {
  readonly code: VmixErrorCode;
  constructor(code: VmixErrorCode, message: string) {
    super(message);
    this.name = "VmixError";
    this.code = code;
  }
}

function elementText(root: Element | Document, selector: string): string {
  return root.querySelector(selector)?.textContent?.trim() ?? "";
}

function toInt(value: string | null | undefined): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Read vMix's state XML. Accepts an overlay's input either as the element text
 * (`<overlay number="1">3</overlay>`) or as an `input` attribute, because the
 * exact form was not available to check against a real vMix.
 */
export function parseVmixStatus(xml: string): VmixStatus {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const root = doc.documentElement;
  if (!root || root.nodeName !== "vmix" || doc.querySelector("parsererror")) {
    throw new VmixError("not_vmix", "The address answered, but not with a vMix status page.");
  }

  const inputs: VmixInput[] = Array.from(root.querySelectorAll(":scope > inputs > input")).map((el) => ({
    key: el.getAttribute("key") ?? "",
    number: toInt(el.getAttribute("number")),
    type: el.getAttribute("type") ?? "",
    title: el.getAttribute("title") ?? el.textContent?.trim() ?? "",
    state: el.getAttribute("state") ?? "",
    fields: Array.from(el.querySelectorAll(":scope > text"))
      .map((field) => field.getAttribute("name") ?? "")
      .filter(Boolean),
  }));

  const overlays: VmixOverlay[] = Array.from(root.querySelectorAll(":scope > overlays > overlay")).map((el) => {
    const fromText = toInt(el.textContent);
    const fromAttribute = toInt(el.getAttribute("input"));
    return {
      number: toInt(el.getAttribute("number")),
      inputNumber: fromText || fromAttribute || null,
    };
  });

  return {
    version: elementText(root, ":scope > version"),
    edition: elementText(root, ":scope > edition"),
    inputs,
    overlays,
    active: toInt(elementText(root, ":scope > active")),
    preview: toInt(elementText(root, ":scope > preview")),
    recording: elementText(root, ":scope > recording").toLowerCase() === "true",
    streaming: elementText(root, ":scope > streaming").toLowerCase() === "true",
  };
}

// ── MCE inputs ──────────────────────────────────────────────────────────────

export interface VmixLayerState {
  layer: MceVmixLayer;
  /** The MCE Web Browser input for this layer, if it exists. */
  input: VmixInput | null;
  /** An input has the MCE name but is not a Web Browser input. */
  wrongType: boolean;
  channel: VmixOverlayChannel;
  /** The MCE input is on its overlay channel right now. */
  onOverlay: boolean;
  /** Another input currently holds the overlay channel. */
  overlayBusyWith: VmixInput | null;
}

export function findMceInput(status: VmixStatus, inputName: string, type = "Browser"): VmixInput | null {
  const wanted = inputName.trim().toLowerCase();
  return (
    status.inputs.find((input) => input.type === type && input.title.trim().toLowerCase() === wanted) ?? null
  );
}

export function describeVmixLayer(status: VmixStatus, settings: VmixSettings, layer: MceVmixLayer): VmixLayerState {
  const name = MCE_VMIX_INPUT_NAMES[layer];
  const input = findMceInput(status, name, vmixInputTypeForLayer(layer));
  const wanted = name.toLowerCase();
  const channel = overlayForLayer(settings, layer);
  const heldBy = status.overlays.find((entry) => entry.number === channel)?.inputNumber ?? null;
  return {
    layer,
    input,
    wrongType: !input && status.inputs.some((entry) => entry.title.trim().toLowerCase() === wanted),
    channel,
    onOverlay: Boolean(input && heldBy === input.number),
    overlayBusyWith:
      heldBy !== null && (!input || heldBy !== input.number)
        ? status.inputs.find((entry) => entry.number === heldBy) ?? null
        : null,
  };
}

export function describeVmixLayers(status: VmixStatus, settings: VmixSettings): Record<MceVmixLayer, VmixLayerState> {
  return Object.fromEntries(
    MCE_VMIX_ALL_LAYERS.map((layer) => [layer, describeVmixLayer(status, settings, layer)]),
  ) as Record<MceVmixLayer, VmixLayerState>;
}

// ── Requests ────────────────────────────────────────────────────────────────

export function vmixBaseUrl(settings: Pick<VmixSettings, "host" | "port">): string {
  return `http://${settings.host}:${settings.port}/api`;
}

/** vMix reads %20 as a space in names, so every value is percent-encoded. */
export function buildVmixFunctionUrl(
  settings: Pick<VmixSettings, "host" | "port">,
  fn: string,
  params: Record<string, string | number | undefined> = {},
): string {
  const parts = [`Function=${encodeURIComponent(fn)}`];
  for (const [key, value] of Object.entries(params)) {
    // An empty Value is kept: SetText uses it to clear a field.
    if (value === undefined) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return `${vmixBaseUrl(settings)}/?${parts.join("&")}`;
}

type FetchLike = (input: string, init?: { signal?: AbortSignal; cache?: RequestCache }) => Promise<Response>;

interface VmixReply {
  status: number;
  body: string;
}

function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function errorFromRelay(message: string, where: string): VmixError {
  return message.startsWith("timeout")
    ? new VmixError("timeout", `vMix did not answer at ${where}.`)
    : new VmixError("unreachable", `Could not reach vMix at ${where}.`);
}

export class VmixClient {
  private readonly settings: VmixSettings;
  private readonly fetchImpl: FetchLike | null;

  /**
   * Inside the desktop app requests go through the `vmix_request` command.
   * A web-page Dock uses the overlay server's `/api/vmix` relay, because
   * vMix refuses requests from web pages ("Browser script access not
   * permitted"). `fetchImpl`
   * (tests) talks to vMix directly.
   */
  constructor(settings: VmixSettings, fetchImpl?: FetchLike) {
    this.settings = normalizeVmixSettings(settings);
    this.fetchImpl = fetchImpl ?? null;
  }

  private where(): string {
    return `${this.settings.host}:${this.settings.port}`;
  }

  private async withTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS + 1000);
    try {
      return await run(controller.signal);
    } catch (error) {
      if (error instanceof VmixError) throw error;
      if (controller.signal.aborted) {
        throw new VmixError("timeout", `vMix did not answer at ${this.where()}.`);
      }
      throw new VmixError("unreachable", `Could not reach vMix at ${this.where()}.`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async send(url: string): Promise<VmixReply> {
    if (this.fetchImpl) {
      const fetchImpl = this.fetchImpl;
      return this.withTimeout(async (signal) => {
        const response = await fetchImpl(url, { signal, cache: "no-store" });
        return { status: response.status, body: await response.text() };
      });
    }

    const query = url.slice(vmixBaseUrl(this.settings).length);
    if (hasTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        return await invoke<VmixReply>("vmix_request", {
          host: this.settings.host,
          port: this.settings.port,
          query,
        });
      } catch (error) {
        throw errorFromRelay(String(error), this.where());
      }
    }

    const relayUrl =
      `/api/vmix?host=${encodeURIComponent(this.settings.host)}` +
      `&port=${this.settings.port}&q=${encodeURIComponent(query)}`;
    return this.withTimeout(async (signal) => {
      const response = await fetch(relayUrl, { signal, cache: "no-store" });
      const payload = (await response.json()) as Partial<VmixReply> & { error?: string };
      if (payload.error) throw errorFromRelay(payload.error, this.where());
      return { status: Number(payload.status) || 0, body: String(payload.body ?? "") };
    });
  }

  private async request(url: string): Promise<string> {
    const reply = await this.send(url);
    if (reply.status < 200 || reply.status >= 300) {
      throw new VmixError("http", `vMix answered ${reply.status}.`);
    }
    return reply.body;
  }

  async getStatus(): Promise<VmixStatus> {
    return parseVmixStatus(await this.request(vmixBaseUrl(this.settings)));
  }

  async call(fn: string, params: Record<string, string | number | undefined> = {}): Promise<void> {
    await this.request(buildVmixFunctionUrl(this.settings, fn, params));
  }

  /** Put an input on an overlay channel with vMix's configured transition. */
  overlayIn(channel: VmixOverlayChannel, input: string | number): Promise<void> {
    return this.call(`OverlayInput${channel}In`, { Input: input });
  }

  overlayOut(channel: VmixOverlayChannel): Promise<void> {
    return this.call(`OverlayInput${channel}Out`);
  }

  /** Take an overlay channel off at once (no transition). */
  overlayOff(channel: VmixOverlayChannel): Promise<void> {
    return this.call(`OverlayInput${channel}Off`);
  }

  /** Change the page a Web Browser input shows. */
  navigateBrowser(input: string | number, url: string): Promise<void> {
    return this.call("BrowserNavigate", { Input: input, Value: url });
  }

  /**
   * Ask vMix to add a Web Browser input. `Browser` is not in vMix's documented
   * list of AddInput types (it works in vMix 28), so callers must check the
   * input list afterwards. vMix may reuse an empty "Blank" input for it.
   */
  addBrowserInput(url: string): Promise<void> {
    return this.call("AddInput", { Value: `Browser|${url}` });
  }

  /** Add a vMix title from a GT title file on this computer. */
  addTitleInput(path: string): Promise<void> {
    return this.call("AddInput", { Value: `Title|${path}` });
  }

  /** Set one text field of a title, e.g. `Text.Text`. */
  setText(input: string | number, field: string, value: string): Promise<void> {
    return this.call("SetText", { Input: input, SelectedName: field, Value: value });
  }

  /** Set one image of a title (e.g. `Background.Source`) to a file, or clear it with "". */
  setImage(input: string | number, field: string, path: string): Promise<void> {
    return this.call("SetImage", { Input: input, SelectedName: field, Value: path });
  }

  /** Hold a title's picture while several changes are made, then show them together. */
  pauseRender(input: string | number): Promise<void> {
    return this.call("PauseRender", { Input: input });
  }

  resumeRender(input: string | number): Promise<void> {
    return this.call("ResumeRender", { Input: input });
  }

  setInputName(input: string | number, name: string): Promise<void> {
    return this.call("SetInputName", { Input: input, Value: name });
  }

  removeInput(input: string | number): Promise<void> {
    return this.call("RemoveInput", { Input: input });
  }
}
