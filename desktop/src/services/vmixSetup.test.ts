import { describe, expect, it } from "vitest";
import { DEFAULT_VMIX_SETTINGS, VmixClient, normalizeVmixSettings, type VmixStatus } from "./vmixClient";
import {
  applyVmixTitleActions,
  buildMceVmixInputUrl,
  graphicContentKey,
  planVmixOverlayActions,
  planVmixTitleActions,
  presentationContentKey,
  removeMceVmixInputs,
  setupMceVmixInput,
  addVmixBuiltinTitle,
  slotForChurchTitle,
} from "./vmixSetup";
import type { PresentationRemoteState } from "./presentationState";
import type { MceTitleFiles } from "./vmixTitles";

/** vMix titles (the default) and Full themes (a Web Browser input). */
const titles = { ...DEFAULT_VMIX_SETTINGS };
const browser = { ...DEFAULT_VMIX_SETTINGS, outputMode: "browser" as const };
const LINK = "http://192.168.1.5:45679/p/mce-service";
const FILES: MceTitleFiles = {
  titlePath: "C:/Users/pc/Documents/MakeChurchEasy/vmix-titles/mce-presentation.gtxml",
  images: { background: "C:/t/background.png", bar: "C:/t/bar.png", accent: "C:/t/accent.png" },
};

interface FakeInput {
  key: string;
  number: number;
  type: string;
  title: string;
}

/** A tiny vMix that answers the functions MCE uses and records every call. */
function fakeVmix(options: { browserAddInput: boolean; inputs?: FakeInput[] }) {
  const inputs: FakeInput[] = [...(options.inputs ?? [{ key: "cam", number: 1, type: "Capture", title: "Camera 1" }])];
  const overlays = new Map<number, number | null>([[1, null], [2, null], [3, null], [4, null]]);
  const calls: Array<{ fn: string; name: string | null; value: string }> = [];
  let nextKey = 1;

  const find = (ref: string | null) =>
    inputs.find((input) => input.key === ref || String(input.number) === ref || input.title === ref);

  const fetchImpl = async (url: string) => {
    const query = new URL(url).searchParams;
    const fn = query.get("Function") ?? "";
    const input = query.get("Input");
    const value = query.get("Value") ?? "";
    calls.push({ fn, name: query.get("SelectedName"), value });
    if (fn === "AddInput") {
      if (value.startsWith("Title|")) {
        inputs.push({ key: `guid-${nextKey++}`, number: inputs.length + 1, type: "GT", title: value.split(/[\\/]/).pop() ?? "" });
        return new Response("", { status: 200 });
      }
      if (!value.startsWith("Browser|") || !options.browserAddInput) return new Response("", { status: 500 });
      inputs.push({ key: `guid-${nextKey++}`, number: inputs.length + 1, type: "Browser", title: value.slice(8) });
    } else if (fn === "SetInputName") {
      const target = find(input);
      if (target) target.title = value;
    } else if (fn === "RemoveInput") {
      const index = inputs.findIndex((i) => i === find(input));
      if (index >= 0) inputs.splice(index, 1);
    } else {
      const overlay = fn.match(/^OverlayInput(\d)(In|Out|Off)$/);
      if (overlay) {
        overlays.set(Number(overlay[1]), overlay[2] === "In" ? find(input)?.number ?? null : null);
      }
    }
    return new Response("", { status: 200 });
  };

  const client = new VmixClient(titles, fetchImpl);
  // The tests run without a DOM (no DOMParser), so the state comes back as an object.
  client.getStatus = async (): Promise<VmixStatus> => ({
    version: "28.0.0.42",
    edition: "Pro",
    inputs: inputs.map((i) => ({ ...i, state: "Running", fields: i.type === "GT" ? ["Text.Text"] : [] })),
    overlays: [...overlays].map(([number, inputNumber]) => ({ number, inputNumber })),
    active: 1,
    preview: 1,
    recording: false,
    streaming: false,
  });
  return { client, inputs, overlays, calls };
}

function status(type: "GT" | "Browser", overlay1: number | null = null): VmixStatus {
  return {
    version: "28",
    edition: "Pro",
    inputs: [
      { key: "cam", number: 1, type: "Capture", title: "Camera 1", state: "Running", fields: [] },
      { key: "mce", number: 2, type, title: "MCE Presentation", state: "Running", fields: type === "GT" ? ["Text.Text"] : [] },
    ],
    overlays: [{ number: 1, inputNumber: overlay1 }, { number: 2, inputNumber: null }],
    active: 1,
    preview: 1,
    recording: false,
    streaming: false,
  };
}

function state(patch: Partial<PresentationRemoteState>): PresentationRemoteState {
  return { sessionId: "mce-service", fullscreen: null, lowerThird: null, graphic: null, updatedAt: 1, ...patch };
}

const verse = { id: "v", source: "bible", title: "John 3:16", body: "For God so loved the world" } as never;

describe("setting up vMix", () => {
  it("adds one vMix title called MCE Presentation by default", async () => {
    const vmix = fakeVmix({ browserAddInput: false });
    const result = await setupMceVmixInput(vmix.client, LINK, titles, { newInputWaitMs: 1000, titleFiles: async () => FILES });
    // This vMix refuses Web Browser inputs, so "MCE Graphics" needs the manual step.
    expect(result).toEqual({ outcome: "created", layer: "title", graphics: "manual" });
    expect(vmix.inputs.map((i) => `${i.type}:${i.title}`)).toEqual(["Capture:Camera 1", "GT:MCE Presentation"]);
  });

  it("adds MCE Graphics beside the title, a page that shows broadcast graphics only", async () => {
    const vmix = fakeVmix({ browserAddInput: true });
    const result = await setupMceVmixInput(vmix.client, LINK, titles, { newInputWaitMs: 1000, titleFiles: async () => FILES });
    expect(result).toEqual({ outcome: "created", layer: "title", graphics: "created" });
    expect(vmix.inputs.map((i) => `${i.type}:${i.title}`)).toEqual([
      "Capture:Camera 1",
      "GT:MCE Presentation",
      "Browser:MCE Graphics",
    ]);
    const added = vmix.calls.find((c) => c.fn === "AddInput" && c.value.startsWith("Browser|"));
    expect(new URL(added!.value.slice(8)).searchParams.get("layer")).toBe("graphics");
  });

  it("adds MCE Graphics even when every job uses the church's own titles", async () => {
    const vmix = fakeVmix({ browserAddInput: true });
    const ownOnly = { ...titles, titles: { scripture: { kind: "vmix" as const, key: "k", title: "Mine", referenceField: "", textField: "" }, songs: { kind: "vmix" as const, key: "k", title: "Mine", referenceField: "", textField: "" }, names: { kind: "vmix" as const, key: "k", title: "Mine", referenceField: "", textField: "" } } };
    const result = await setupMceVmixInput(vmix.client, LINK, ownOnly, { newInputWaitMs: 1000 });
    expect(result).toEqual({ outcome: "updated", layer: "title", graphics: "created" });
    expect(vmix.inputs.map((i) => i.title)).toEqual(["Camera 1", "MCE Graphics"]);
  });

  it("removes MCE Graphics when switching to Full themes, which shows graphics itself", async () => {
    const vmix = fakeVmix({ browserAddInput: true });
    await setupMceVmixInput(vmix.client, LINK, titles, { newInputWaitMs: 1000, titleFiles: async () => FILES });
    await setupMceVmixInput(vmix.client, LINK, browser, { newInputWaitMs: 1000, removeWaitMs: 200 });
    expect(vmix.inputs.map((i) => `${i.type}:${i.title}`)).toEqual(["Capture:Camera 1", "Browser:MCE Presentation"]);
  });

  it("adds one Web Browser input called MCE Presentation for Full themes", async () => {
    const vmix = fakeVmix({ browserAddInput: true });
    const result = await setupMceVmixInput(vmix.client, LINK, browser, { newInputWaitMs: 1000 });
    expect(result.outcome).toBe("created");
    expect(vmix.inputs.map((i) => `${i.type}:${i.title}`)).toEqual(["Capture:Camera 1", "Browser:MCE Presentation"]);
  });

  it("keeps a single MCE Presentation when switching modes", async () => {
    const vmix = fakeVmix({ browserAddInput: true });
    await setupMceVmixInput(vmix.client, LINK, browser, { newInputWaitMs: 1000 });
    await setupMceVmixInput(vmix.client, LINK, titles, { newInputWaitMs: 1000, removeWaitMs: 200, titleFiles: async () => FILES });
    expect(vmix.inputs.filter((i) => i.title === "MCE Presentation").map((i) => i.type)).toEqual(["GT"]);
  });

  it("reuses the input instead of adding a duplicate", async () => {
    const vmix = fakeVmix({ browserAddInput: true });
    await setupMceVmixInput(vmix.client, LINK, titles, { newInputWaitMs: 1000, titleFiles: async () => FILES });
    const again = await setupMceVmixInput(vmix.client, LINK, titles, { newInputWaitMs: 1000, titleFiles: async () => FILES });
    expect(again.outcome).toBe("updated");
    expect(vmix.inputs.filter((i) => i.title === "MCE Presentation")).toHaveLength(1);
  });

  it("asks for a manual step when vMix refuses to add a Web Browser input", async () => {
    const vmix = fakeVmix({ browserAddInput: false });
    const result = await setupMceVmixInput(vmix.client, LINK, browser, { newInputWaitMs: 500 });
    expect(result.outcome).toBe("manual");
  });

  it("removes only MCE Presentation, taking it off the overlay first", async () => {
    const vmix = fakeVmix({ browserAddInput: true });
    await setupMceVmixInput(vmix.client, LINK, titles, { newInputWaitMs: 1000, titleFiles: async () => FILES });
    await vmix.client.overlayIn(1, "guid-1");
    expect(await removeMceVmixInputs(vmix.client, titles)).toBe(2);
    expect(vmix.inputs.map((i) => i.title)).toEqual(["Camera 1"]);
    expect(vmix.calls.map((c) => c.fn)).toContain("OverlayInput1Off");
  });

  it("gives the browser input a see-through page that holds content while vMix fades out", () => {
    const url = new URL(buildMceVmixInputUrl(LINK));
    expect(url.pathname).toBe("/p/mce-service");
    expect(url.searchParams.has("layer")).toBe(false);
    expect(url.searchParams.get("transparent")).toBe("1");
    expect(Number(url.searchParams.get("outDelay"))).toBeGreaterThan(0);
  });
});

describe("vMix titles: MakeChurchEazy's title (the default)", () => {
  const full = { kind: "fullscreen" as const, job: "scripture" as const, reference: "John 3:16 (KJV)", text: "For God so loved the world" };
  const lower = { kind: "lowerThird" as const, job: "names" as const, reference: "Senior Pastor", text: "Pastor John" };

  it("sets the look and the text, then brings the title in", () => {
    expect(planVmixTitleActions(null, full, status("GT"), titles, { currentLayout: null })).toEqual([
      { kind: "layout", input: "mce", layout: "fullscreen" },
      { kind: "text", input: "mce", values: [["Reference.Text", "John 3:16 (KJV)"], ["Text.Text", "For God so loved the world"]] },
      { kind: "in", input: "mce" },
    ]);
  });

  it("only changes the text for the next verse while the title is up", () => {
    const next = { ...full, reference: "John 3:17 (KJV)", text: "For God sent not his Son" };
    expect(planVmixTitleActions(full, next, status("GT", 2), titles, { currentLayout: "fullscreen" })).toEqual([
      { kind: "text", input: "mce", values: [["Reference.Text", "John 3:17 (KJV)"], ["Text.Text", "For God sent not his Son"]] },
    ]);
  });

  it("switches the same title to the lower third look", () => {
    expect(planVmixTitleActions(full, lower, status("GT", 2), titles, { currentLayout: "fullscreen" })).toEqual([
      { kind: "layout", input: "mce", layout: "lowerThird" },
      { kind: "text", input: "mce", values: [["LTReference.Text", "Senior Pastor"], ["LTText.Text", "Pastor John"]] },
    ]);
  });

  it("takes the title out when cleared, and never takes another input off", () => {
    expect(planVmixTitleActions(full, null, status("GT", 2), titles)).toEqual([{ kind: "out" }]);
    expect(planVmixTitleActions(full, null, status("GT", 1), titles)).toEqual([]);
  });

  it("does nothing when the content hasn't changed, or before setup", () => {
    expect(planVmixTitleActions(full, { ...full }, status("GT"), titles)).toEqual([]);
    expect(planVmixTitleActions(null, full, status("Browser"), titles)).toEqual([]);
  });

  it("swaps the images and clears the other look's text in one frame", async () => {
    const vmix = fakeVmix({ browserAddInput: true });
    const actions = planVmixTitleActions(null, lower, status("GT"), titles, { currentLayout: "fullscreen" });
    await applyVmixTitleActions(vmix.client, titles, actions, FILES.images);
    const fns = vmix.calls.map((c) => c.fn);
    expect(fns[0]).toBe("PauseRender");
    expect(fns.indexOf("ResumeRender")).toBeLessThan(fns.indexOf("OverlayInput1In"));
    const images = Object.fromEntries(vmix.calls.filter((c) => c.fn === "SetImage").map((c) => [c.name, c.value]));
    expect(images).toEqual({ "Background.Source": "", "Bar.Source": "C:/t/bar.png", "Accent.Source": "C:/t/accent.png" });
    const texts = Object.fromEntries(vmix.calls.filter((c) => c.fn === "SetText").map((c) => [c.name, c.value]));
    expect(texts).toEqual({
      "Reference.Text": "",
      "Text.Text": "",
      "LTReference.Text": "Senior Pastor",
      "LTText.Text": "Pastor John",
    });
  });
});

describe("vMix titles: the church's own titles, side by side with MakeChurchEazy's", () => {
  const scriptureTitle = {
    key: "s28", number: 3, type: "GT", title: "Title 28- Scripture and Verse Blue.gtzip", state: "Paused",
    fields: ["Message.Text", "Verse.Text"],
  };
  const songsTitle = { key: "s40", number: 4, type: "GT", title: "Title 40- Songs Blue.gtzip", state: "Paused", fields: ["Text.Text"] };
  const nameTitle = {
    key: "c0", number: 5, type: "GT", title: "Title 0- The Classic Blue.gtzip", state: "Paused",
    fields: ["Headline.Text", "Description.Text"],
  };
  const withTitles = (overlay1: number | null = null): VmixStatus => ({
    ...status("GT", overlay1),
    inputs: [...status("GT").inputs, scriptureTitle, songsTitle, nameTitle],
  });
  const mixed = {
    ...titles,
    titles: {
      scripture: slotForChurchTitle(scriptureTitle),
      songs: { kind: "mce" as const },
      names: slotForChurchTitle(nameTitle),
    },
  };
  const verse = { kind: "fullscreen" as const, job: "scripture" as const, reference: "John 3:16 (KJV)", text: "For God so loved the world" };

  it("matches vMix's usual field names", () => {
    expect(slotForChurchTitle(scriptureTitle)).toMatchObject({ referenceField: "Verse.Text", textField: "Message.Text" });
    expect(slotForChurchTitle(songsTitle)).toMatchObject({ referenceField: "", textField: "Text.Text" });
    expect(slotForChurchTitle(nameTitle)).toMatchObject({ referenceField: "Headline.Text", textField: "Description.Text" });
  });

  it("fills the church's scripture title and brings it in", () => {
    expect(planVmixTitleActions(null, verse, withTitles(), mixed)).toEqual([
      { kind: "text", input: "s28", values: [["Verse.Text", "John 3:16 (KJV)"], ["Message.Text", "For God so loved the world"]] },
      { kind: "in", input: "s28" },
    ]);
  });

  it("puts a name in the Headline and the role in the Description", () => {
    const name = { kind: "lowerThird" as const, job: "names" as const, reference: "Senior Pastor", text: "Pastor John" };
    expect(planVmixTitleActions(null, name, withTitles(), mixed)).toEqual([
      { kind: "text", input: "c0", values: [["Headline.Text", "Pastor John"], ["Description.Text", "Senior Pastor"]] },
      { kind: "in", input: "c0" },
    ]);
  });

  it("switches between the church's title and MakeChurchEazy's title on the same overlay", () => {
    const lyric = { kind: "fullscreen" as const, job: "songs" as const, reference: "", text: "Amazing grace" };
    const actions = planVmixTitleActions(verse, lyric, withTitles(3), mixed, { currentLayout: null });
    expect(actions.map((a) => a.kind)).toEqual(["layout", "text", "in"]);
    expect(actions[actions.length - 1]).toEqual({ kind: "in", input: "mce" });
  });

  it("takes the church's title out when cleared", () => {
    expect(planVmixTitleActions(verse, null, withTitles(3), mixed)).toEqual([{ kind: "out" }]);
  });

  it("doesn't add MakeChurchEazy's title when every job uses the church's titles", async () => {
    const vmix = fakeVmix({ browserAddInput: false });
    const ownOnly = { ...titles, titles: { scripture: slotForChurchTitle(scriptureTitle), songs: slotForChurchTitle(songsTitle), names: slotForChurchTitle(nameTitle) } };
    const result = await setupMceVmixInput(vmix.client, LINK, ownOnly, { titleFiles: async () => FILES });
    expect(result.outcome).toBe("updated");
    expect(vmix.calls.filter((c) => c.fn === "AddInput" && c.value.startsWith("Title|"))).toEqual([]);
  });

  it("adds vMix's own built-in title for a job", async () => {
    const vmix = fakeVmix({ browserAddInput: false });
    const slot = await addVmixBuiltinTitle(vmix.client, "scripture", {
      findBuiltin: async (name) => `C:/Program Files (x86)/vMix/titles/GT Title/${name}`,
      newInputWaitMs: 1000,
    });
    expect(vmix.calls.find((c) => c.fn === "AddInput")?.value).toBe(
      "Title|C:/Program Files (x86)/vMix/titles/GT Title/Title 28- Scripture and Verse Blue.gtzip",
    );
    expect(slot).toMatchObject({ kind: "vmix", title: "Title 28- Scripture and Verse Blue.gtzip" });
  });
});

describe("Full themes: the overlay follows the content", () => {
  const shown = presentationContentKey(state({ fullscreen: verse }));

  it("brings the overlay in for new content and out when cleared", () => {
    expect(planVmixOverlayActions(null, shown, status("Browser"), browser)).toEqual([{ kind: "in", input: "mce" }]);
    expect(planVmixOverlayActions(shown, null, status("Browser", 2), browser)).toEqual([{ kind: "out" }]);
  });

  it("keeps the overlay up while moving from a verse to a lower third", () => {
    const lower = presentationContentKey(state({ lowerThird: verse }));
    expect(planVmixOverlayActions(shown, lower, status("Browser", 2), browser)).toEqual([]);
  });

  it("leaves an operator's choice alone until new content arrives", () => {
    expect(planVmixOverlayActions(shown, shown, status("Browser"), browser)).toEqual([]);
  });

  it("never takes another input off the overlay", () => {
    expect(planVmixOverlayActions(shown, null, status("Browser", 1), browser)).toEqual([]);
  });
});

describe("vMix titles: broadcast graphics on MCE Graphics", () => {
  function withGraphics(overlay2: number | null = null): VmixStatus {
    const base = status("GT");
    return {
      ...base,
      inputs: [...base.inputs, { key: "gfx", number: 3, type: "Browser", title: "MCE Graphics", state: "Running", fields: [] }],
      overlays: [{ number: 1, inputNumber: null }, { number: 2, inputNumber: overlay2 }],
    };
  }
  const graphic = graphicContentKey(state({ graphic: { url: "http://127.0.0.1:45678/lower-third-overlay.html#data=a", version: 5 } }));
  const graphics = { layer: "graphics" as const };

  it("only has a key while a graphic is sent, and a new one for each send", () => {
    expect(graphicContentKey(state({ fullscreen: verse }))).toBeNull();
    expect(graphic).not.toBe(graphicContentKey(state({ graphic: { url: "http://127.0.0.1:45678/lower-third-overlay.html#data=a", version: 6 } })));
  });

  it("brings MCE Graphics in on its own overlay and out when the graphic is cleared", () => {
    expect(planVmixOverlayActions(null, graphic, withGraphics(), titles, graphics)).toEqual([{ kind: "in", input: "gfx" }]);
    expect(planVmixOverlayActions(graphic, null, withGraphics(3), titles, graphics)).toEqual([{ kind: "out" }]);
  });

  it("never takes the title or another input off the graphics overlay", () => {
    expect(planVmixOverlayActions(graphic, null, withGraphics(2), titles, graphics)).toEqual([]);
  });

  it("keeps the graphics overlay apart from the title's overlay", () => {
    expect(normalizeVmixSettings({ overlay: 2, graphicsOverlay: 2 }).graphicsOverlay).toBe(1);
    expect(normalizeVmixSettings({ overlay: 1 }).graphicsOverlay).toBe(2);
    expect(normalizeVmixSettings({ overlay: 1, graphicsOverlay: 4 }).graphicsOverlay).toBe(4);
  });
});
