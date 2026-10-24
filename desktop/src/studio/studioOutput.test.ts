import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/overlayUrl", () => ({ getOverlayBaseUrl: async () => "http://127.0.0.1:45678" }));
vi.mock("../services/productionSettings", () => ({ buildDockProductionSettingsPayload: async () => ({}) }));
vi.mock("../dock/dockOverlayBridge", () => ({ overlayBridge: { publish: vi.fn() } }));
vi.mock("../dock/dockObsClient", () => ({
  dockObsClient: {
    buildStudioOverlayPacket: ({ text, reference }: { text: string; reference: string }) => ({ data: { slide: { text, reference } }, css: "" }),
  },
}));

import {
  getLastOutputError,
  getProgramState,
  clearProgram,
  goLive,
  setPreviewState,
  setPreviewMediaControl,
  setProgramCamera,
  setProgramMediaControl,
  stopProgramAudio,
  type StudioSlide,
} from "./studioEngine";

const verse: StudioSlide = { key: "bible:John:3:16:KJV", module: "bible", label: "16", text: "For God so loved", reference: "John 3:16 (KJV)", itemTitle: "John 3" };
const video: StudioSlide = { key: "media:v", module: "media", label: "Video", text: "", reference: "", itemTitle: "Loop", media: { kind: "video", url: "/uploads/loop.mp4", fit: "cover", loop: true, muted: false } };
const sound: StudioSlide = { key: "media:a", module: "media", label: "Sound", text: "", reference: "", itemTitle: "Song", media: { kind: "audio", url: "/uploads/song.mp3", fit: "cover", loop: false, muted: false } };

describe("one way onto the screen", () => {
  const ok = vi.fn(async () => new Response("{}"));
  beforeEach(() => {
    ok.mockClear();
    vi.stubGlobal("fetch", ok);
  });

  it("Go live says whether the output got it", async () => {
    await expect(goLive(verse, null, "fullscreen", "fade")).resolves.toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await expect(goLive(verse, null, "fullscreen", "fade")).resolves.toBe(false);
    expect(getLastOutputError()).toContain("500");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connection refused"); }));
    await expect(goLive(verse, null, "fullscreen", "fade")).resolves.toBe(false);
    vi.stubGlobal("fetch", ok);
    await expect(goLive(verse, null, "fullscreen", "fade")).resolves.toBe(true);
    expect(getLastOutputError()).toBe("");
  });

  it("the camera keeps its place while words and media change", async () => {
    await setProgramCamera({ enabled: true, deviceId: "cam-1", layout: "behind-content" });
    await goLive(verse, null, "lower-third", "fade");
    await goLive(video, null, "lower-third", "fade");
    expect(getProgramState().camera).toEqual({ enabled: true, deviceId: "cam-1", layout: "behind-content" });
    await setProgramCamera({ enabled: true, deviceId: "cam-1", layout: "hidden" });
    expect(getProgramState().camera?.enabled).toBe(true);
  });

  it("Clear sends the church logo and hides the camera in one Program update", async () => {
    await goLive(verse, null, "lower-third", "fade");
    await setProgramCamera({ enabled: true, deviceId: "cam-1", layout: "behind-content" });
    await clearProgram("lower-third", {
      screen: "logo",
      logoUrl: "/uploads/church-logo.png",
      churchName: "Grace Church",
      camera: { enabled: false, deviceId: "cam-1", layout: "hidden", wordsOff: false },
    });

    expect(getProgramState()).toMatchObject({
      active: null,
      screen: "logo",
      logoUrl: "/uploads/church-logo.png",
      churchName: "Grace Church",
      camera: { enabled: false, layout: "hidden", wordsOff: false },
    });
  });

  it("a video starts playing from the top; pause / volume / fit change it in place", async () => {
    await goLive(video, null, "fullscreen", "fade");
    const first = getProgramState().mediaControl;
    expect(first).toMatchObject({ paused: false, loop: true, fit: "cover", seekTo: 0 });
    await setProgramMediaControl({ paused: true, volume: 0.3, fit: "contain" });
    expect(getProgramState().mediaControl).toMatchObject({ paused: true, volume: 0.3, fit: "contain", seekRev: first?.seekRev });
    expect(getProgramState().media?.url).toBe("/uploads/loop.mp4");
  });

  it("sound plays under the screen and leaves the words alone", async () => {
    await goLive(verse, null, "fullscreen", "fade");
    await goLive(sound, null, "fullscreen", "fade");
    const state = getProgramState();
    expect(state.active).toBe("bible");
    expect(state.audio?.url).toBe("/uploads/song.mp3");
    await stopProgramAudio();
    expect(getProgramState().audio).toBeNull();
    expect(getProgramState().active).toBe("bible");
  });

  it("previewing never touches what is live", async () => {
    await goLive(verse, null, "fullscreen", "fade");
    const live = JSON.stringify(getProgramState().packets);
    await setPreviewState({ ...verse, key: "bible:John:3:17:KJV", text: "For God sent not" }, null, "fullscreen");
    expect(JSON.stringify(getProgramState().packets)).toBe(live);
    expect(getProgramState().active).toBe("bible");
    expect(getProgramState().preview?.active).toBe("bible");
    // Sound has nothing to preview.
    await setPreviewState(sound, null, "fullscreen");
    expect(getProgramState().preview?.active).toBeNull();
  });

  it("Preview blanks the module it leaves so that layer animates out under the new words", async () => {
    const song: StudioSlide = { key: "worship:s1:1", module: "worship", label: "V1", text: "Amazing grace", reference: "", itemTitle: "Amazing Grace" };
    await setPreviewState(verse, null, "lower-third");
    expect(getProgramState().preview?.packets.bible?.blanked).toBeUndefined();
    await setPreviewState(song, null, "lower-third");
    const preview = getProgramState().preview;
    expect(preview?.active).toBe("worship");
    expect(preview?.packets.bible?.blanked).toBe(true);
    expect(preview?.packets.worship?.blanked).toBeUndefined();
    // Back to the Bible: its layer gets real words again, and the worship one is the one that leaves.
    await setPreviewState(verse, null, "lower-third");
    expect(getProgramState().preview?.packets.bible?.blanked).toBeUndefined();
    expect(getProgramState().preview?.packets.worship?.blanked).toBe(true);
    // Changing the look of the same module is not a swap.
    await setPreviewState({ ...verse, text: "For God so loved the world" }, null, "lower-third");
    expect(getProgramState().preview?.packets.worship?.blanked).toBe(true);
    expect(getProgramState().preview?.packets.bible?.blanked).toBeUndefined();
  });

  it("preview video starts independently and can pause without changing Program", async () => {
    await goLive(verse, null, "fullscreen", "fade");
    await setPreviewState(video, null, "fullscreen");
    const state = getProgramState();
    const liveBefore = JSON.stringify({ active: state.active, media: state.media, mediaControl: state.mediaControl });

    expect(state.preview?.mediaControl).toMatchObject({ paused: false, loop: true, muted: false });
    await setPreviewMediaControl({ paused: true });

    expect(getProgramState().preview?.mediaControl).toMatchObject({ paused: true });
    expect(JSON.stringify({
      active: getProgramState().active,
      media: getProgramState().media,
      mediaControl: getProgramState().mediaControl,
    })).toBe(liveBefore);
  });
});

describe("the Studio's own address", () => {
  it("always uses this computer (127.0.0.1), never the cached Wi-Fi address", async () => {
    const { toLoopbackBase } = await import("./studioEngine");
    expect(toLoopbackBase("http://192.168.1.23:45678")).toBe("http://127.0.0.1:45678");
    expect(toLoopbackBase("http://127.0.0.1:45678/")).toBe("http://127.0.0.1:45678");
    expect(toLoopbackBase("http://localhost:1420")).toBe("http://localhost:1420");
  });
});
