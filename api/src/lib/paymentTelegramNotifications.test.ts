import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./mongodb", () => ({ default: new Promise(() => { }) }));

import {
  buildTelegramPaymentMessage,
  notifyTelegramPayment,
  paymentDetailsFromIntent,
  paymentNotificationKey,
  resetPaymentNotificationStateForTests,
  type PaymentNotificationStore,
  type TelegramPaymentDetails,
} from "./paymentTelegramNotifications";

const env = {
  TELEGRAM_BOT_TOKEN: "123:token",
  TELEGRAM_CHAT_ID: "456",
  TELEGRAM_NOTIFICATION_TIMEZONE: "UTC",
};

function memoryStore(): PaymentNotificationStore & { keys: Set<string> } {
  const keys = new Set<string>();
  return {
    keys,
    async claim(key) {
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    },
    async release(key) {
      keys.delete(key);
    },
  };
}

const success: TelegramPaymentDetails = {
  outcome: "success",
  provider: "flutterwave",
  reference: "mce_fw_1_abc",
  name: "Grace <Admin>",
  email: "grace@example.com",
  churchName: "Grace Chapel",
  plan: "growth",
  billingCycle: "monthly",
  credits: 500,
  amount: 15000,
  currency: "ngn",
  source: "Flutterwave webhook",
  occurredAt: "2026-11-02T10:30:00.000Z",
};

beforeEach(() => {
  resetPaymentNotificationStateForTests();
});

describe("buildTelegramPaymentMessage", () => {
  it("formats a successful plan purchase", () => {
    const message = buildTelegramPaymentMessage(success, env);
    expect(message).toContain("✅ <b>Payment successful</b>");
    expect(message).toContain("Grace &lt;Admin&gt;");
    expect(message).toContain("grace@example.com");
    expect(message).toContain("<b>Church:</b> Grace Chapel");
    expect(message).toContain("Growth plan (monthly) · 500 credits");
    expect(message).toContain("<b>Amount:</b> NGN 15,000");
    expect(message).toContain("<b>Provider:</b> Flutterwave");
    expect(message).toContain("<code>mce_fw_1_abc</code>");
    expect(message).toContain("2 Nov 2026");
    expect(message).not.toContain("Reason");
  });

  it("formats a failure with its reason and a credit top-up", () => {
    const message = buildTelegramPaymentMessage({
      outcome: "failed",
      provider: "mtn_momo",
      reference: "ref-1",
      email: "pastor@example.com",
      purchase: "credits",
      credits: 60,
      amount: 25.5,
      currency: "GHS",
      failureReason: "Payer & wallet <declined>",
    }, env);
    expect(message).toContain("❌ <b>Payment failed</b>");
    expect(message).toContain("<b>Name:</b> Unknown");
    expect(message).toContain("Top-up: 60 credits");
    expect(message).toContain("GHS 25.5");
    expect(message).toContain("<b>Provider:</b> MTN MoMo");
    expect(message).toContain("<b>Reason:</b> Payer &amp; wallet &lt;declined&gt;");
    expect(message).not.toContain("Church:");
  });

  it("falls back when amount and reason are missing", () => {
    const message = buildTelegramPaymentMessage({ outcome: "failed", provider: "paystack", reference: "x" }, env);
    expect(message).toContain("<b>Amount:</b> Unknown");
    expect(message).toContain("<b>Reason:</b> Not given");
    expect(message).toContain("<b>Provider:</b> Paystack");
  });
});

describe("paymentDetailsFromIntent", () => {
  it("reads user, plan and amount from a stored intent", () => {
    const details = paymentDetailsFromIntent(
      { userId: "u1", email: "a@b.c", plan: "basic", billingCycle: "yearly", expectedAmount: 120, expectedCurrency: "KES" },
      { outcome: "failed", provider: "flutterwave", reference: "r1", failureReason: "Payment amount mismatch." },
    );
    expect(details).toMatchObject({
      userId: "u1",
      email: "a@b.c",
      plan: "basic",
      billingCycle: "yearly",
      amount: 120,
      currency: "KES",
      reference: "r1",
      failureReason: "Payment amount mismatch.",
    });
  });
});

describe("notifyTelegramPayment", () => {
  it("sends each provider/reference/outcome once", async () => {
    const store = memoryStore();
    const send = vi.fn(async () => true);
    expect(await notifyTelegramPayment(success, { env, store, send })).toBe(true);
    // Same payment reported by the verify callback after the webhook.
    expect(await notifyTelegramPayment({ ...success, source: "status check" }, { env, store, send })).toBe(false);
    // Another process instance (in-memory guard cleared) still hits the shared store.
    resetPaymentNotificationStateForTests();
    expect(await notifyTelegramPayment(success, { env, store, send })).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.keys.has(paymentNotificationKey(success))).toBe(true);
  });

  it("treats a failure and a success for the same reference as separate events", async () => {
    const store = memoryStore();
    const send = vi.fn(async () => true);
    await notifyTelegramPayment({ ...success, outcome: "failed", failureReason: "timeout" }, { env, store, send });
    await notifyTelegramPayment(success, { env, store, send });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("releases the claim when Telegram rejects the message so a later callback can retry", async () => {
    const store = memoryStore();
    const send = vi.fn(async () => false);
    expect(await notifyTelegramPayment(success, { env, store, send })).toBe(false);
    expect(store.keys.size).toBe(0);
    send.mockResolvedValue(true);
    expect(await notifyTelegramPayment(success, { env, store, send })).toBe(true);
  });

  it("does nothing when the bot token or chat id is missing", async () => {
    const store = memoryStore();
    const send = vi.fn(async () => true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
    expect(await notifyTelegramPayment(success, { env: { TELEGRAM_CHAT_ID: "456" }, store, send })).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(store.keys.size).toBe(0);
    warn.mockRestore();
  });

  it("never throws, even when sending blows up", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
    const send = vi.fn(async () => { throw new Error("network down"); });
    await expect(notifyTelegramPayment(success, { env, store: memoryStore(), send })).resolves.toBe(false);
    warn.mockRestore();
  });

  it("still sends when the dedupe store is unreachable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
    const send = vi.fn(async () => true);
    const store: PaymentNotificationStore = {
      claim: async () => { throw new Error("db offline"); },
      release: async () => { },
    };
    expect(await notifyTelegramPayment(success, { env, store, send })).toBe(true);
    expect(await notifyTelegramPayment(success, { env, store, send })).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("fills in the name, email and church from the user record", async () => {
    const send = vi.fn(async (_text: string) => true);
    await notifyTelegramPayment(
      { outcome: "success", provider: "mtn_momo", reference: "m1", userId: "u1", amount: 50, currency: "GHS" },
      {
        env,
        store: memoryStore(),
        send,
        lookupUser: async () => ({ name: "Ama", email: "ama@example.com", churchName: "Hope Church" }),
      },
    );
    const text = send.mock.calls[0][0];
    expect(text).toContain("Ama");
    expect(text).toContain("ama@example.com");
    expect(text).toContain("Hope Church");
  });
});
