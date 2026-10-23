import { describe, expect, it } from "vitest";
import { classifySignupSource, channelForSourceName, parseSignupSourceCookie } from "./signupSource";

describe("signup source", () => {
  it("uses ?src= / ?utm_source= names first", () => {
    expect(classifySignupSource({ src: "tiktok", referrer: "www.google.com" }).channel).toBe("tiktok");
    expect(classifySignupSource({ src: "chatgpt.com" }).label).toBe("ChatGPT");
    expect(classifySignupSource({ src: "FB", campaign: "easter-2026" })).toMatchObject({ channel: "facebook", campaign: "easter-2026" });
  });

  it("falls back to the site that linked to us", () => {
    expect(classifySignupSource({ referrer: "chatgpt.com" }).channel).toBe("chatgpt");
    expect(classifySignupSource({ referrer: "l.facebook.com" }).channel).toBe("facebook");
    expect(classifySignupSource({ referrer: "www.google.com.ng" }).channel).toBe("google");
    expect(classifySignupSource({ referrer: "m.youtube.com" }).channel).toBe("youtube");
  });

  it("uses ad click ids when there is nothing else", () => {
    expect(classifySignupSource({ clickId: "ttclid" }).channel).toBe("tiktok");
  });

  it("names unknown sites and unknown ?src values", () => {
    expect(classifySignupSource({ referrer: "www.churchblog.org" })).toMatchObject({ channel: "website", label: "churchblog.org" });
    expect(classifySignupSource({ src: "pastors-conference" })).toMatchObject({ channel: "website", label: "pastors-conference" });
  });

  it("ignores our own pages and handles no data", () => {
    expect(classifySignupSource({ referrer: "makechurcheazy.com" }).channel).toBe("direct");
    expect(classifySignupSource(null).channel).toBe("direct");
    expect(classifySignupSource(null, { signupClient: "desktop" }).channel).toBe("unknown");
    expect(classifySignupSource(null, { referralCode: "ABC123" }).channel).toBe("friend-referral");
  });

  it("only treats known channel words as sources, so referral codes keep working", () => {
    expect(channelForSourceName("tiktok")).toBe("tiktok");
    expect(channelForSourceName("JOHN42")).toBeNull();
  });

  it("strips odd characters from the cookie", () => {
    const raw = parseSignupSourceCookie(encodeURIComponent(JSON.stringify({ src: "<script>tiktok", landing: "/pricing" })));
    expect(classifySignupSource(raw)).toMatchObject({ channel: "website", source: "scripttiktok", landingPath: "/pricing" });
    expect(parseSignupSourceCookie("%E0%A4%A")).toBeNull();
  });
});
