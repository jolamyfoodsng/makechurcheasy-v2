import { describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../services/localDockSettings", () => ({
  readNativeDockSetting: (key: string) => settings.get(key),
  writeNativeDockSetting: async (key: string, value: unknown) => { settings.set(key, value); },
}));

import { buildDockMediaDisplayItem, loadDockMediaDisplay, saveDockMediaDisplay } from "./dockDisplayOutputClient";
import mediaTabSource from "./tabs/DockMediaTab.tsx?raw";

describe("Media → Send to a display", () => {
  it("plays a library video from the local server the way the Media tab set it up", () => {
    const built = buildDockMediaDisplayItem(
      { type: "video", name: "Welcome.mp4", url: "http://127.0.0.1:45678/uploads/Welcome.mp4", diskFileName: "Welcome.mp4" },
      { fit: "contain", muted: true, loop: false },
    );
    expect(built).toEqual({
      mode: "fullscreen",
      item: {
        module: "media",
        label: "Welcome.mp4",
        media: { kind: "video", url: "/uploads/Welcome.mp4", fit: "contain", loop: false, muted: true },
      },
    });
  });

  it("shows an uploaded picture by its file name and has nothing to show for sound", () => {
    expect(buildDockMediaDisplayItem({ type: "image", name: "Logo", url: "", diskFileName: "studio logo.png" })?.item)
      .toMatchObject({ module: "media", media: { kind: "image", url: "/uploads/studio%20logo.png", fit: "cover" } });
    expect(buildDockMediaDisplayItem({ type: "audio", name: "Song", url: "/uploads/song.mp3" })).toBeNull();
  });

  it("remembers the screen it last sent to", () => {
    expect(loadDockMediaDisplay().monitorKey).toBe("");
    saveDockMediaDisplay({ enabled: true, monitorKey: "Samsung@-3840,0:3840x2160", monitorName: "Samsung", mode: "fullscreen" });
    expect(loadDockMediaDisplay()).toEqual({ enabled: true, monitorKey: "Samsung@-3840,0:3840x2160", monitorName: "Samsung", mode: "fullscreen" });
  });

  it("offers it next to Send to a scene for pictures and videos", () => {
    expect(mediaTabSource).toContain("t('media.sendToDisplay', 'Send to a display')");
    expect(mediaTabSource).toContain('return (entry.kind === "image" || entry.kind === "video") && canSendEntryToScene(entry);');
  });
});
