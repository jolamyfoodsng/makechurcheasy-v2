import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetVerifiedLicenseForTests,
  getClockFloor,
  getVerifiedPlanCap,
  markVerificationInitDone,
  resolveIsAdmin,
  setVerifiedLicense,
} from "./verifiedLicense";
import {
  evaluateOfflineEntitlement,
  getOfflineEntitlementState,
  readLastSyncMs,
  trustedNowMs,
} from "./offlineEntitlement";

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

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  __resetVerifiedLicenseForTests();
  localStorage.clear();
});

describe("verified licence state", () => {
  it("is inactive on dev/test builds, so local values still work", () => {
    markVerificationInitDone();
    expect(getVerifiedPlanCap().active).toBe(false);
  });

  it("exposes the verified plan and admin flag", () => {
    setVerifiedLicense({ plan: "basic", isAdmin: false }, 1_000);
    expect(getVerifiedPlanCap()).toMatchObject({ known: true, plan: "basic", isAdmin: false });
    setVerifiedLicense({ plan: "growth", isAdmin: true }, 2_000);
    expect(getVerifiedPlanCap()).toMatchObject({ plan: "growth", isAdmin: true });
  });

  it("raises the clock floor from the signed time and never lowers it", () => {
    setVerifiedLicense({ plan: "growth" }, 5_000_000_000_000);
    expect(getClockFloor()).toBe(5_000_000_000_000);
    setVerifiedLicense({ plan: "growth" }, 1_000);
    expect(getClockFloor()).toBe(5_000_000_000_000);
  });
});

describe("resolveIsAdmin", () => {
  it("uses the stored role on dev/test builds", () => {
    expect(resolveIsAdmin("admin")).toBe(true);
    expect(resolveIsAdmin("user")).toBe(false);
    expect(resolveIsAdmin(undefined)).toBe(false);
  });
});

describe("offline entitlement with a verified licence", () => {
  it("ignores an edited localStorage clock: the signed floor wins", () => {
    const signed = Date.now() + 30 * DAY; // pretend the server signed "30 days from now"
    setVerifiedLicense({ plan: "growth", entitledUntil: null }, signed);
    localStorage.setItem("mce-clock-high-water", "1000"); // user rewound the stored clock
    expect(trustedNowMs()).toBeGreaterThanOrEqual(signed);
  });

  it("uses the signed time as the last sync, so a bumped localStorage timestamp does nothing", () => {
    const signedAt = Date.now() - 25 * DAY;
    setVerifiedLicense({ plan: "growth", entitledUntil: null }, signedAt);
    localStorage.setItem("mce-last-online-at", String(Date.now())); // attacker "just synced"
    expect(readLastSyncMs()).toBe(signedAt);
    const state = getOfflineEntitlementState();
    expect(state.paidPaused).toBe(true);
  });

  it("reads the end date from the verified licence, not from storage", () => {
    const ended = Date.now() - DAY;
    setVerifiedLicense({ plan: "basic", entitledUntil: new Date(ended).toISOString() }, Date.now() - 1000);
    localStorage.setItem("ocs-license-cache", JSON.stringify({ payload: { plan: "basic", entitledUntil: null } }));
    expect(getOfflineEntitlementState().entitlementEnded).toBe(true);
    // sanity: the pure rule still behaves
    expect(evaluateOfflineEntitlement({ plan: "basic", entitledUntil: null }, Date.now(), Date.now()).entitlementEnded).toBe(false);
  });
});
