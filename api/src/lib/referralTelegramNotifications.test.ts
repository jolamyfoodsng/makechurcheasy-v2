import { describe, expect, it, vi } from "vitest";

vi.mock("./mongodb", () => ({ default: new Promise(() => { }) }));

import {
  buildTelegramReferralPayoutDigestMessage,
  buildTelegramReferralUsedMessage,
  groupOwedReferralPayouts,
  isReferralPayoutOwed,
  notifyTelegramReferralUsed,
  reportReferralUsedToTelegram,
  type ReferralPerson,
} from "./referralTelegramNotifications";

const env = {
  TELEGRAM_BOT_TOKEN: "123:token",
  TELEGRAM_CHAT_ID: "456",
  TELEGRAM_NOTIFICATION_TIMEZONE: "UTC",
};

const people: Record<string, ReferralPerson> = {
  owner: { name: "Pastor Ade", email: "ade@example.com", churchName: "Grace Chapel" },
  newbie: { name: "Joy <Media>", email: "joy@example.com", churchName: "Hope & Light", plan: "growth" },
};

const base = {
  code: "MCEAB12CD34",
  referrerUserId: "owner",
  referredUserId: "newbie",
  appliedAt: "2026-11-09T14:05:00.000Z",
};

describe("buildTelegramReferralUsedMessage", () => {
  it("names who used the code and who owns it", () => {
    const message = buildTelegramReferralUsedMessage(
      { ...base, referrer: people.owner, referred: people.newbie },
      env,
    );
    expect(message).toContain("🤝 <b>Referral code used</b>");
    expect(message).toContain("<code>MCEAB12CD34</code>");
    expect(message).toContain("Joy &lt;Media&gt;");
    expect(message).toContain("Hope &amp; Light");
    expect(message).toContain("joy@example.com");
    expect(message).toContain("Pastor Ade");
    expect(message).toContain("Grace Chapel");
    expect(message).toContain("ade@example.com");
    expect(message.indexOf("Joy")).toBeLessThan(message.indexOf("Pastor Ade"));
    expect(message).toContain("9 Nov 2026");
    expect(message).not.toContain("Already paid");
  });

  it("marks a church that had already paid and falls back to Unknown", () => {
    const message = buildTelegramReferralUsedMessage(
      { ...base, status: "paid", referrer: null, referred: people.newbie },
      env,
    );
    expect(message).toContain("Already paid (Growth)");
    expect(message).toContain("<b>Name:</b> Unknown");
  });
});

describe("notifyTelegramReferralUsed", () => {
  it("looks up both churches and sends one message", async () => {
    const send = vi.fn(async () => true);
    const lookupUser = vi.fn(async (id: string) => people[id] ?? null);

    await expect(notifyTelegramReferralUsed(base, { env, send, lookupUser })).resolves.toBe(true);
    expect(lookupUser).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(1);
    const [text] = send.mock.calls[0] as unknown as [string];
    expect(text).toContain("Pastor Ade");
    expect(text).toContain("Joy &lt;Media&gt;");
  });

  it("still sends when a lookup fails", async () => {
    const send = vi.fn(async () => true);
    const lookupUser = vi.fn(async (id: string) => {
      if (id === "owner") throw new Error("db down");
      return people[id];
    });
    await expect(notifyTelegramReferralUsed(base, { env, send, lookupUser })).resolves.toBe(true);
    const [text] = send.mock.calls[0] as unknown as [string];
    expect(text).toContain("Joy &lt;Media&gt;");
  });

  it("returns false instead of throwing when sending fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
    const send = vi.fn(async () => { throw new Error("network"); });
    await expect(
      notifyTelegramReferralUsed(base, { env, send, lookupUser: async () => null }),
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("skips quietly when Telegram is not configured", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      notifyTelegramReferralUsed(base, { env: {}, lookupUser: async (id) => people[id] }),
    ).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("reportReferralUsedToTelegram", () => {
  it("returns immediately and swallows errors", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
    expect(() => reportReferralUsedToTelegram(base, {
      env,
      lookupUser: async () => { throw new Error("db down"); },
      send: async () => { throw new Error("network"); },
    })).not.toThrow();
    warn.mockRestore();
  });
});

describe("referral payout digest", () => {
  const referrals = [
    { code: "MCEOWNER1", referrerUserId: "owner", status: "paid", paidAt: "2026-11-01T10:00:00.000Z", paidAmount: 15000, paidCurrency: "ngn" },
    { code: "MCEOWNER1", referrerUserId: "owner", status: "paid", paidAt: "2026-10-20T10:00:00.000Z", paidAmount: 10, paidCurrency: "USD" },
    { code: "MCEOWNER1", referrerUserId: "owner", status: "paid", paidAt: "2026-10-01T10:00:00.000Z", paidAmount: 5000, paidCurrency: "NGN", payoutPaidAt: "2026-10-05T10:00:00.000Z" },
    { code: "MCEOWNER1", referrerUserId: "owner", status: "signed_up" },
    { code: "MCEOTHER2", referrerUserId: "other", status: "paid", paidAt: "2026-11-05T10:00:00.000Z", paidAmount: null },
    { code: "MCEPAID03", referrerUserId: "settled", status: "paid", paidAt: "2026-09-01T10:00:00.000Z", payoutPaidAt: "2026-09-02T00:00:00.000Z" },
  ];

  it("counts only paid referrals that have not been paid out", () => {
    const grouped = groupOwedReferralPayouts(referrals, new Map([["owner", people.owner]]));
    expect(grouped.map((item) => item.referrerUserId)).toEqual(["owner", "other"]);
    expect(grouped[0]).toMatchObject({
      code: "MCEOWNER1",
      owedReferrals: 2,
      paidByCurrency: { NGN: 15000, USD: 10 },
      oldestPaidAt: "2026-10-20T10:00:00.000Z",
      referrer: people.owner,
    });
    expect(grouped[1]).toMatchObject({ owedReferrals: 1, paidByCurrency: {}, referrer: null });
  });

  it("isReferralPayoutOwed needs a paid church and no payout", () => {
    expect(isReferralPayoutOwed({ status: "paid" })).toBe(true);
    expect(isReferralPayoutOwed({ status: "paid", payoutPaidAt: "2026-11-01" })).toBe(false);
    expect(isReferralPayoutOwed({ status: "signed_up" })).toBe(false);
  });

  it("lists each referrer with their code and unpaid count", () => {
    const message = buildTelegramReferralPayoutDigestMessage({
      dateLabel: "2026-11-09",
      referrers: groupOwedReferralPayouts(referrals, new Map([["owner", people.owner]])),
    });
    expect(message).toContain("💸 <b>Referral payouts owed</b>");
    expect(message).toContain("<b>Referrers owed:</b> 2 · <b>Unpaid referrals:</b> 3");
    expect(message).toContain("1. <b>Pastor Ade</b> — Grace Chapel");
    expect(message).toContain("ade@example.com");
    expect(message).toContain("<code>MCEOWNER1</code> · 2 unpaid referrals");
    expect(message).toContain("Their churches paid: NGN 15,000 + USD 10");
    expect(message).toContain("Waiting since: 2026-10-20");
    expect(message).toContain("2. <b>Unknown</b>");
    expect(message).toContain("<code>MCEOTHER2</code> · 1 unpaid referral");
    expect(message).not.toContain("MCEPAID03");
  });

  it("says so when nobody is owed", () => {
    const message = buildTelegramReferralPayoutDigestMessage({ dateLabel: "2026-11-09", referrers: [] });
    expect(message).toContain("Nothing owed today");
  });

  it("stays within Telegram's message limit for many referrers", () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      code: `MCECODE${i}`,
      referrerUserId: `r${i}`,
      status: "paid",
      paidAt: "2026-11-01T00:00:00.000Z",
      paidAmount: 1000,
      paidCurrency: "NGN",
    }));
    const message = buildTelegramReferralPayoutDigestMessage({
      dateLabel: "2026-11-09",
      referrers: groupOwedReferralPayouts(many, new Map(many.map((r) => [r.referrerUserId, {
        name: `Pastor Number ${r.referrerUserId}`,
        churchName: `A Fairly Long Church Name ${r.referrerUserId}`,
        email: `pastor.${r.referrerUserId}@example-church.org`,
      }]))),
    });
    expect(message.length).toBeLessThan(4096);
    expect(message).toMatch(/…and \d+ more\. See Admin → Referrals\./);
    expect(message).toContain("1. <b>Pastor Number r0</b>");
  });
});
