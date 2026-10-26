import { beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const handlers = vi.hoisted(() => [] as Array<(packet: Record<string, unknown>) => void>);

vi.mock("./dockOverlayBridge", () => ({
  overlayBridge: {
    connect: vi.fn(),
    subscribe: (handler: (packet: Record<string, unknown>) => void) => {
      handlers.push(handler);
      return () => undefined;
    },
    publish: (packet: Record<string, unknown>) => { sent.push(packet); },
  },
}));
// Keep the packet simple: the adapter's own output is tested elsewhere.
vi.mock("../studio/studioDockAdapter", () => ({
  studioItemFromDock: (item: { type: string; label: string; data: Record<string, unknown> }) => ({
    module: item.type,
    data: item.data,
    label: item.label,
  }),
}));

import { buildDockDisplayItem, clearDockDisplay, showOnDockDisplay } from "./dockDisplayOutputClient";

const display = { enabled: true, monitorKey: "pj", monitorName: "EPSON PJ", mode: "fullscreen" as const };
const fsTheme = { name: "full" };
const ltTheme = { name: "lt" };

function reply(index: number) {
  const request = sent[index];
  for (const handler of handlers) handler({ channel: "dock-display", type: "reply", requestId: request.requestId, ok: true });
}

describe("dock display client", () => {
  beforeEach(() => {
    sent.length = 0;
  });

  it("uses the look chosen for the display, with the tab's theme for that look", () => {
    const tabLowerThird = { verseText: "For God so loved", overlayMode: "lower-third", bibleThemeSettings: ltTheme };
    const full = buildDockDisplayItem("bible", tabLowerThird, "fullscreen", { fullscreen: fsTheme, lowerThird: ltTheme });
    expect(full?.mode).toBe("fullscreen");
    expect(full?.item).toMatchObject({ data: { overlayMode: "fullscreen", bibleThemeSettings: fsTheme } });

    const follow = buildDockDisplayItem("bible", tabLowerThird, "inherit", { fullscreen: fsTheme, lowerThird: ltTheme });
    expect(follow?.mode).toBe("lower-third");
    expect(follow?.item).toMatchObject({ data: { overlayMode: "lower-third", bibleThemeSettings: ltTheme } });

    const tabFull = { sectionText: "Amazing grace", overlayMode: "fullscreen", bibleThemeSettings: fsTheme };
    const lower = buildDockDisplayItem("worship", tabFull, "lower-third", { fullscreen: fsTheme, lowerThird: ltTheme });
    expect(lower?.mode).toBe("lower-third");
    expect(lower?.item).toMatchObject({ data: { overlayMode: "lower-third", bibleThemeSettings: ltTheme } });
  });

  it("sends one update at a time and skips to the newest when verses change quickly", async () => {
    const item = (text: string) => buildDockDisplayItem("bible", { verseText: text }, "fullscreen");
    showOnDockDisplay(display, item("v1"));
    showOnDockDisplay(display, item("v2"));
    showOnDockDisplay(display, item("v3"));
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ type: "show", mode: "fullscreen", item: { data: { verseText: "v1" } } });
    reply(0);
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    // v2 was replaced by v3 while v1 was on its way.
    expect(sent[1]).toMatchObject({ type: "show", item: { data: { verseText: "v3" } } });
    reply(1);
  });

  it("does not let an older show land after a clear", async () => {
    showOnDockDisplay(display, buildDockDisplayItem("bible", { verseText: "v1" }, "fullscreen"));
    showOnDockDisplay(display, buildDockDisplayItem("bible", { verseText: "v2" }, "fullscreen"));
    clearDockDisplay(display, "bible");
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    reply(0);
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toMatchObject({ type: "clear", module: "bible" });
    reply(1);
  });

  it("does nothing while the display is off", () => {
    showOnDockDisplay({ ...display, enabled: false }, buildDockDisplayItem("bible", { verseText: "v1" }, "fullscreen"));
    clearDockDisplay({ ...display, enabled: false }, "bible");
    expect(sent).toHaveLength(0);
  });
});
