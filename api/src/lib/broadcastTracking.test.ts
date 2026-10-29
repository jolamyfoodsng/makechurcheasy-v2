import { describe, expect, it, vi } from "vitest";

vi.mock("./mongodb", () => ({ default: Promise.resolve({}) }));

const { buildClickUrl, instrumentBroadcastHtml, verifyTrackingSignature } = await import("./broadcastTracking");

describe("instrumentBroadcastHtml", () => {
  const campaignId = "6650f1a2b3c4d5e6f7a8b9c0";
  const userId = "user-1";

  it("routes links through the click tracker but leaves the unsubscribe link alone", () => {
    const unsubscribe = "https://api.example.com/api/email/unsubscribe?token=abc";
    const html = `<html><body><a href="https://makechurcheazy.com/plans?promo=A&amp;billing=monthly">Claim</a><a href="${unsubscribe}">Unsubscribe</a></body></html>`;
    const out = instrumentBroadcastHtml(html, campaignId, userId, [unsubscribe]);

    expect(out).toContain(`href="${unsubscribe}"`);
    expect(out).not.toContain('href="https://makechurcheazy.com/plans');
    const tracked = out.match(/href="([^"]*\/api\/email\/track\/click[^"]*)"/)![1].replace(/&amp;/g, "&");
    const params = new URL(tracked).searchParams;
    expect(params.get("url")).toBe("https://makechurcheazy.com/plans?promo=A&billing=monthly");
    expect(verifyTrackingSignature(["click", campaignId, userId, params.get("url")!], params.get("s"))).toBe(true);
    expect(out).toMatch(/\/api\/email\/track\/open\?[^"]*"[^>]*\/><\/body>/);
  });

  it("rejects a click link whose destination was changed", () => {
    const params = new URL(buildClickUrl(campaignId, userId, "https://makechurcheazy.com")).searchParams;
    expect(verifyTrackingSignature(["click", campaignId, userId, "https://evil.example"], params.get("s"))).toBe(false);
    expect(verifyTrackingSignature(["click", campaignId, "user-2", "https://makechurcheazy.com"], params.get("s"))).toBe(false);
  });
});
