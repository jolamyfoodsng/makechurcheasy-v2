import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import BroadcastPage from "./BroadcastPage";

// Mock dockObsClient
vi.mock("../dock/dockObsClient", () => ({
  dockObsClient: {
    isConnected: true,
    connect: vi.fn().mockResolvedValue(undefined),
    getStreamStatus: vi.fn().mockResolvedValue({ outputActive: false, outputTimecode: "00:00:00" }),
    setStreamServiceSettings: vi.fn().mockResolvedValue(undefined),
    startStream: vi.fn().mockResolvedValue(undefined),
    stopStream: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("BroadcastPage UI & Multi-Platform Streaming Redesign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders profiles panel, active profile header, OBS connection badge, multi-platform hero banner, and channels section", () => {
    const html = renderToStaticMarkup(<BroadcastPage />);

    // Left Column / Profiles Panel
    expect(html).toContain("Profiles");
    expect(html).toContain("Add Profile");

    // Active Profile Card
    expect(html).toMatch(/channel|channels/);
    expect(html).toMatch(/Connected to OBS|Not Connected to OBS/);
    expect(html).toContain("Profile Settings");

    // Hero Multi-Platform Banner
    expect(html).toContain("Stream to multiple platforms");
    expect(html).toContain("one click");
    expect(html).toContain("simultaneously");
    expect(html).toContain("No manual setup");
    expect(html).toContain("One-click stream");
    expect(html).toContain("Save multiple profiles");
    expect(html).toContain("How it works");
    // The diagram lives in the "How it works" modal now, not inline on the page.
    expect(html).not.toContain("broadcast-diagram-svg");

    // Channels Section
    expect(html).toContain("Where your stream goes");
    expect(html).toContain("These platforms will be streamed when you go live in OBS.");
    expect(html).toContain("Add another channel:");
    expect(html).toContain("YouTube");
    expect(html).toContain("Facebook");
    expect(html).toContain("Instagram");
    expect(html).toContain("TikTok");
    expect(html).toContain("Twitch");
    expect(html).toContain("RTMP");
  });

  it("strictly enforces zero occurrences of gradients in the hero diagram", () => {
    const html = renderToStaticMarkup(<BroadcastPage />);
    expect(html).not.toContain("radialGradient");
    expect(html).not.toContain("linearGradient id=\"obs");
  });

  it("strictly enforces zero occurrences of the forbidden word", () => {
    const html = renderToStaticMarkup(<BroadcastPage />);
    expect(html.toLowerCase()).not.toContain("sanctuary");
  });
});
