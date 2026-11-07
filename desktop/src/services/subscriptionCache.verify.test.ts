import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./userScopedStorage", () => ({ getUserScopedKey: (key: string) => key }));

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUBLIC_B64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

function canonical(payload: Record<string, unknown>) {
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(payload).sort()) sorted[k] = payload[k];
  return JSON.stringify(sorted);
}
const signPayload = (p: Record<string, unknown>) =>
  sign(null, Buffer.from(canonical(p)), privateKey).toString("base64");

const FUTURE = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
const payload = {
  userId: "u1",
  plan: "basic",
  subscriptionStatus: "active" as const,
  creditsRemaining: 40,
  expiresAt: null,
  lastVerifiedAt: new Date().toISOString(),
  offlineExpiresAt: FUTURE,
};

// Tests run in a node environment, so stand in for the browser's localStorage.
function installLocalStorage() {
  const values = new Map<string, string>();
  const storage = {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
  } as Storage;
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", { localStorage: storage });
}
installLocalStorage();

async function load() {
  vi.resetModules();
  vi.stubEnv("PROD", true);
  vi.stubEnv("DEV", false);
  vi.stubEnv("VITE_SUBSCRIPTION_PUBLIC_KEY", PUBLIC_B64);
  return import("./subscriptionCache");
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllEnvs());

describe("subscription snapshot on a release build", () => {
  it("trusts a snapshot whose signature verifies", async () => {
    const m = await load();
    localStorage.setItem("ocs-subscription-cache", JSON.stringify({ payload, signature: signPayload(payload), cachedAt: 1 }));
    await m.restoreSubscriptionCache("u1");
    expect(m.getCachedPlan()).toBe("basic");
    expect(m.getCachedCredits()).toBe(40);
  });

  it("ignores and deletes a snapshot edited to a higher plan", async () => {
    const m = await load();
    const signature = signPayload(payload);
    const edited = { ...payload, plan: "growth", creditsRemaining: 99999 };
    localStorage.setItem("ocs-subscription-cache", JSON.stringify({ payload: edited, signature, cachedAt: 1 }));
    await m.restoreSubscriptionCache("u1");
    expect(m.getCachedPlan()).toBe("free");
    expect(m.getCachedCredits()).toBe(0);
    expect(localStorage.getItem("ocs-subscription-cache")).toBeNull();
  });

  it("ignores a snapshot that belongs to another user", async () => {
    const m = await load();
    localStorage.setItem("ocs-subscription-cache", JSON.stringify({ payload, signature: signPayload(payload), cachedAt: 1 }));
    await m.restoreSubscriptionCache("someone-else");
    expect(m.getCachedPlan()).toBe("free");
  });

  it("notices an edit made after startup", async () => {
    const m = await load();
    const signature = signPayload(payload);
    localStorage.setItem("ocs-subscription-cache", JSON.stringify({ payload, signature, cachedAt: 1 }));
    await m.restoreSubscriptionCache("u1");
    expect(m.getCachedPlan()).toBe("basic");
    localStorage.setItem("ocs-subscription-cache", JSON.stringify({ payload: { ...payload, plan: "growth" }, signature, cachedAt: 1 }));
    expect(m.getCachedPlan()).toBe("free");
  });

  it("offline credit spending can lower the balance but never raise it", async () => {
    const m = await load();
    localStorage.setItem("ocs-subscription-cache", JSON.stringify({ payload, signature: signPayload(payload), cachedAt: 1 }));
    await m.restoreSubscriptionCache("u1");
    m.updateCachedCredits(30);
    expect(m.getCachedCredits()).toBe(30);
    m.updateCachedCredits(500);
    expect(m.getCachedCredits()).toBe(30);
    // the signed payload is untouched, so it still verifies after a restart
    const again = await load();
    await again.restoreSubscriptionCache("u1");
    expect(again.getCachedPlan()).toBe("basic");
  });
});
