import { beforeEach, describe, expect, it, vi } from "vitest";

const values = new Map<string, string>();
const mockStorage: Storage = {
  get length() { return values.size; },
  clear: () => values.clear(),
  getItem: (key) => values.get(key) ?? null,
  key: (index) => Array.from(values.keys())[index] ?? null,
  removeItem: (key) => { values.delete(key); },
  setItem: (key, value) => { values.set(key, String(value)); },
};
vi.stubGlobal("localStorage", mockStorage);
vi.stubGlobal("window", { localStorage: mockStorage, addEventListener: vi.fn(), removeEventListener: vi.fn() });

vi.mock("./authService", () => ({
  getDeviceApiBaseCandidates: () => ["https://api.makechurcheazy.com"],
  getDeviceId: () => "device-1",
  getDeviceSecret: () => "secret-1",
  getSession: () => ({ user: { id: "user-1" }, deviceId: "device-1" }),
  rememberSessionApiBase: vi.fn(),
}));

import { DEVICE_REJECTED_SIGN_IN_THRESHOLD, getState, isSignInRequired, verify } from "./licenseGuard";
import { clearDesktopBootstrapCache } from "./desktopConfig";

const deviceRejected = () =>
  new Response(
    JSON.stringify({ error: "Device verification is temporarily unavailable. Please refresh the app and try again." }),
    { status: 503, headers: { "Content-Type": "application/json" } },
  );

describe("license sync when the server keeps refusing this computer", () => {
  beforeEach(() => {
    localStorage.clear();
    clearDesktopBootstrapCache();
  });

  it("needs a few refusals in a row before asking to sign in again", () => {
    expect(isSignInRequired(0)).toBe(false);
    expect(isSignInRequired(DEVICE_REJECTED_SIGN_IN_THRESHOLD - 1)).toBe(false);
    expect(isSignInRequired(DEVICE_REJECTED_SIGN_IN_THRESHOLD)).toBe(true);
  });

  it("asks to sign in again instead of saying the computer is offline", async () => {
    globalThis.fetch = vi.fn(async () => deviceRejected()) as typeof fetch;
    for (let i = 0; i < DEVICE_REJECTED_SIGN_IN_THRESHOLD; i++) {
      expect(getState().signInRequired).toBe(false);
      await verify();
    }
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(DEVICE_REJECTED_SIGN_IN_THRESHOLD);
    expect(getState().signInRequired).toBe(true);
    // Still not a lock: the app keeps working.
    expect(getState().lockReason).toBeNull();
  });

  it("does not count a real network failure as a refusal", async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
    for (let i = 0; i < DEVICE_REJECTED_SIGN_IN_THRESHOLD + 1; i++) await verify();
    expect(getState().signInRequired).toBe(false);
  });
});
