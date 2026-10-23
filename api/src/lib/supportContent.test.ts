import { describe, expect, it } from "vitest";
import { DEFAULT_SUPPORT_CONTENT, normalizeSupportContent, whatsappChatLink } from "./supportContent";

describe("Support window content", () => {
  it("turns settings saved before the editor (three links) into the default channels with those links", () => {
    const content = normalizeSupportContent({
      whatsappUrl: "https://chat.whatsapp.com/abc",
      youtubeUrl: "",
      supportEmail: "help@church.org",
    });
    const byKind = Object.fromEntries(content.channels.map((c) => [c.kind, c]));
    expect(byKind.whatsapp).toMatchObject({ value: "https://chat.whatsapp.com/abc", enabled: true });
    expect(byKind.youtube).toMatchObject({ value: "", enabled: false });
    expect(byKind.email.value).toBe("help@church.org");
    expect(byKind.telegram.value).toBe("https://t.me/makechurcheasy");
    expect(content.title).toBe(DEFAULT_SUPPORT_CONTENT.title);
    expect(content.emergency.phone).toBe("+234 906 945 5406");
  });

  it("keeps what the admin saved, cleans bad values and hides channels that can't be opened", () => {
    const content = normalizeSupportContent({
      title: "  Need a hand? ",
      subtitle: "",
      status: { online: false, text: "Back on Monday" },
      primaryChannelId: "call",
      channels: [
        { id: "call", kind: "phone", label: "Call us", value: "+1 (555) 010-2000", enabled: true },
        { id: "site", kind: "website", label: "Docs", value: "javascript:alert(1)", enabled: true },
        { id: "call", kind: "email", label: "Mail", value: "team@church.org", enabled: true },
        { id: "x", kind: "nope", value: "https://example.com" },
      ],
      emergency: { enabled: true, title: "Hotline", description: "", phone: "not a number" },
    });
    expect(content.title).toBe("Need a hand?");
    expect(content.subtitle).toBe("");
    expect(content.status).toEqual({ online: false, text: "Back on Monday" });
    expect(content.channels.map((c) => [c.id, c.kind, c.enabled])).toEqual([
      ["call", "phone", true],
      ["site", "website", false],
      ["call-3", "email", true],
      ["x", "website", true],
    ]);
    expect(content.channels[1].value).toBe("");
    expect(content.primaryChannelId).toBe("call");
    expect(content.emergency).toMatchObject({ enabled: false, phone: "" });
    // Emails keep using the first email channel.
    expect(content.supportEmail).toBe("team@church.org");
    expect(content.whatsappUrl).toBe("");
  });

  it("falls back to the first shown channel when the main one is hidden or gone", () => {
    const content = normalizeSupportContent({
      primaryChannelId: "gone",
      channels: [
        { id: "a", kind: "email", label: "Mail", value: "", enabled: true },
        { id: "b", kind: "telegram", label: "Telegram", value: "https://t.me/x", enabled: true },
      ],
    });
    expect(content.primaryChannelId).toBe("b");
  });

  it("opens a WhatsApp chat with the support number by default, also for settings that kept the old group link", () => {
    expect(DEFAULT_SUPPORT_CONTENT.channels.find((c) => c.kind === "whatsapp")?.value).toBe("https://wa.me/2349054545286");
    const fromOld = normalizeSupportContent({ whatsappUrl: "https://chat.whatsapp.com/EQIuXfpCTBOG7YOSf2nKqU?mode=gi_t" });
    expect(fromOld.whatsappUrl).toBe("https://wa.me/2349054545286");
  });

  it("turns a WhatsApp number into a chat link, and needs the country code", () => {
    expect(whatsappChatLink("+234 906 945 5406")).toBe("https://wa.me/2349069455406");
    expect(whatsappChatLink("09069455406")).toBe("");
    const content = normalizeSupportContent({
      channels: [
        { id: "wa", kind: "whatsapp", label: "WhatsApp", value: "+44 (20) 7946-0958", enabled: true },
        { id: "local", kind: "whatsapp", label: "Local", value: "0906 945 5406", enabled: true },
      ],
    });
    expect(content.channels.map((c) => [c.value, c.enabled])).toEqual([
      ["https://wa.me/442079460958", true],
      ["", false],
    ]);
  });
});
