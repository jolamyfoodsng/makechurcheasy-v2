import { describe, it, expect, vi } from "vitest";
import {
  RETIRED_MCE_SOURCE_NAMES,
  canRemoveRetiredMceSource,
  removeRetiredMceSources,
} from "./retiredMceSources";
import dockObsClientSource from "../dock/dockObsClient.ts?raw";
import appSource from "../App.tsx?raw";
import dockMediaTabSource from "../dock/tabs/DockMediaTab.tsx?raw";

type Call = { type: string; data?: Record<string, unknown> };

function fakeObs(
  inputs: string[],
  active: Record<string, { videoActive?: boolean; videoShowing?: boolean } | "error">,
) {
  const calls: Call[] = [];
  const request = vi.fn(async (type: string, data?: Record<string, unknown>) => {
    calls.push({ type, data });
    if (type === "GetInputList") return { inputs: inputs.map((inputName) => ({ inputName })) };
    if (type === "GetSourceActive") {
      const state = active[String(data?.sourceName)];
      if (state === "error" || state === undefined) throw new Error("no answer");
      return state;
    }
    return {};
  });
  return { request, calls };
}

// The names live in retiredMceSources.ts only; the tests take them from there.
const [CURRENT_NAME, OLDER_NAME] = RETIRED_MCE_SOURCE_NAMES;

describe("retired OBS sources", () => {
  it("lists the retired Text overlay source under its current and older names", () => {
    expect(RETIRED_MCE_SOURCE_NAMES.length).toBe(2);
    expect(new Set(RETIRED_MCE_SOURCE_NAMES).size).toBe(2);
  });

  it("removes a hidden source and keeps one that is on air or unanswered", () => {
    expect(canRemoveRetiredMceSource({ videoActive: false, videoShowing: false })).toBe(true);
    expect(canRemoveRetiredMceSource({})).toBe(true);
    expect(canRemoveRetiredMceSource({ videoActive: true })).toBe(false);
    expect(canRemoveRetiredMceSource(null)).toBe(false);
  });

  it("removes only the retired names, never the church's own or current MCE sources", async () => {
    const obs = fakeObs(
      ["Video - MCE Presentation", CURRENT_NAME, "Image - MCE Presentation", "Text - Church Chat", "Worship - MCE Presentation"],
      { [CURRENT_NAME]: { videoActive: false, videoShowing: false } },
    );
    const result = await removeRetiredMceSources(obs.request);
    expect(result).toEqual({ removed: [CURRENT_NAME], kept: [] });
    const removals = obs.calls.filter((call) => call.type === "RemoveInput");
    expect(removals).toEqual([{ type: "RemoveInput", data: { inputName: CURRENT_NAME } }]);
  });

  it("leaves a source that is on air, and one OBS cannot answer for", async () => {
    const live = fakeObs([CURRENT_NAME], { [CURRENT_NAME]: { videoActive: true, videoShowing: true } });
    expect(await removeRetiredMceSources(live.request)).toEqual({ removed: [], kept: [CURRENT_NAME] });
    expect(live.calls.some((call) => call.type === "RemoveInput")).toBe(false);

    const unknown = fakeObs([OLDER_NAME], { [OLDER_NAME]: "error" });
    expect(await removeRetiredMceSources(unknown.request)).toEqual({ removed: [], kept: [OLDER_NAME] });
    expect(unknown.calls.some((call) => call.type === "RemoveInput")).toBe(false);
  });

  it("does nothing, and does not throw, when OBS fails or has none of them", async () => {
    const none = fakeObs(["Bible - MCE Presentation"], {});
    expect(await removeRetiredMceSources(none.request)).toEqual({ removed: [], kept: [] });
    expect(none.calls.map((call) => call.type)).toEqual(["GetInputList"]);

    const broken = vi.fn(async () => { throw new Error("OBS gone"); });
    expect(await removeRetiredMceSources(broken)).toEqual({ removed: [], kept: [] });
  });

  it("runs when the Dock and the main app connect to OBS", () => {
    expect(dockObsClientSource).toContain("scheduleRetiredMceSourceCleanup(");
    expect(appSource).toContain("scheduleRetiredMceSourceCleanup");
  });

  it("the rest of the Dock no longer names the retired source", () => {
    for (const name of RETIRED_MCE_SOURCE_NAMES) {
      expect(dockObsClientSource).not.toContain(name);
      expect(appSource).not.toContain(name);
    }
    expect(dockObsClientSource).not.toContain("DOCK_MEDIA_TEXT_SOURCE");
    expect(dockObsClientSource).not.toContain("mediaTextSource");
  });

  it("can no longer create the Text source, and the Text tab is gone", () => {
    const method = dockObsClientSource.slice(
      dockObsClientSource.indexOf("async setMediaTextOverlay("),
      dockObsClientSource.indexOf("async setMediaTextOverlay(") + 200,
    );
    expect(method).toContain("return;");
    expect(dockObsClientSource).not.toContain("buildMediaTextOverlayUrl");
    expect(dockMediaTabSource).not.toContain('setBrowserTab("text")');
    expect(dockMediaTabSource).toContain('value === "patterns";');
  });
});
