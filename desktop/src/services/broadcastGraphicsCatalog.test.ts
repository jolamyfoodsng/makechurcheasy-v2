import { describe, it, expect, beforeEach } from "vitest";

const storageMap = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => storageMap.set(key, String(value)),
    removeItem: (key: string) => storageMap.delete(key),
    clear: () => storageMap.clear(),
    get length() { return storageMap.size; },
    key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
  },
  writable: true,
  configurable: true,
});

const {
  __resetBroadcastGraphicsCatalogForTests,
  describeGraphicTiers,
  getBlockedGraphicThemeIds,
  getGraphicAvailability,
  getPackageThemes,
  getPackageTickers,
} = await import("./broadcastGraphicsCatalog");
const { BUNDLED_GRAPHIC_PACKAGES } = await import("../lowerthirds/bundledGraphicPackages");

const pkg = {
  format: "mce-graphic@1",
  id: "welcome-bar",
  version: 2,
  name: "Welcome Bar",
  category: "welcome",
  hold: 6,
  fields: [
    { key: "title", label: "Title", type: "text", default: "WELCOME" },
    { key: "bar", label: "Bar colour", type: "color", default: "#2563eb" },
    { key: "socials", label: "Social icons", type: "list", options: "brands", default: "facebook" },
  ],
  html: "<div class=\"bar\">{{title}}</div>",
  css: ".bar{background:var(--bar)}",
  animation: { in: [[".bar", "wipeL", 0]] },
};

function catalog(graphics: unknown[], audience = "free") {
  return { fetchedAt: Date.now(), audience, graphics } as never;
}

describe("broadcastGraphicsCatalog", () => {
  beforeEach(() => {
    storageMap.clear();
    __resetBroadcastGraphicsCatalogForTests();
  });

  it("hides the News Ticker Bar lower third now that it is a ticker", () => {
    expect(getGraphicAvailability("lt-stream-ticker", null)).toMatchObject({ visible: false, usable: false });
  });

  it("does not list an uploaded copy of the Sunrise ticker next to the bundled one", () => {
    const tickerPkg = { format: "mce-ticker@1", name: "Sunrise Ticker", html: "<div>{{tickerText}}</div>" };
    const tickers = getPackageTickers(catalog([
      { graphicId: "starter-sunrise-ticker", kind: "ticker", source: "package", status: "active", tiers: { free: true, paid: true, ambassador: true }, package: tickerPkg },
      { graphicId: "my-ticker", kind: "ticker", source: "package", status: "active", tiers: { free: true, paid: true, ambassador: true }, package: { ...tickerPkg, name: "Mine" } },
    ]));
    expect(tickers.map((t) => t.name)).toEqual(["Mine"]);
  });

  it("keeps every bundled graphic available before the first download", () => {
    expect(getGraphicAvailability("lt-sun-green", null)).toMatchObject({ visible: true, usable: true });
    expect(getBlockedGraphicThemeIds(null)).toEqual([]);
    // Only the graphics bundled with the app.
    expect(getPackageThemes(null).map((t) => t.id)).toEqual(BUNDLED_GRAPHIC_PACKAGES.map((p) => `lt-pkg-${p.id}`));
  });

  it("ships the bundled graphics, lets admin hide them and lets a published package replace them", () => {
    expect(BUNDLED_GRAPHIC_PACKAGES.map((p) => p.id)).toEqual(
      expect.arrayContaining(["prayer-bar", "website-bar", "live-social-bar", "arrow-logo-bar", "contact-bar", "testimony-bar", "question-bar"]),
    );
    const hidden = catalog([
      { graphicId: "lt-pkg-prayer-bar", source: "builtin", status: "hidden", tiers: { free: true, paid: true, ambassador: true }, access: "allowed" },
    ]);
    expect(getPackageThemes(hidden).map((t) => t.id)).not.toContain("lt-pkg-prayer-bar");
    expect(getPackageThemes(hidden).map((t) => t.id)).toContain("lt-pkg-website-bar");

    const replaced = catalog([
      { graphicId: "website-bar", source: "package", status: "active", tiers: { free: true, paid: true, ambassador: true }, access: "allowed", version: 5, package: { ...pkg, id: "website-bar", name: "Website Bar v5" } },
    ]);
    const website = getPackageThemes(replaced).filter((t) => t.id === "lt-pkg-website-bar");
    expect(website).toHaveLength(1);
    expect(website[0].name).toBe("Website Bar v5");
  });

  it("applies paused, hidden and plan-locked graphics", () => {
    const c = catalog([
      { graphicId: "lt-sun-green", source: "builtin", status: "paused", tiers: { free: true, paid: true, ambassador: true }, access: "allowed" },
      { graphicId: "lt-sun-bishop", source: "builtin", status: "hidden", tiers: { free: true, paid: true, ambassador: true }, access: "allowed" },
      { graphicId: "lt-sun-advert", source: "builtin", status: "active", tiers: { free: false, paid: true, ambassador: false }, access: "locked" },
    ]);
    expect(getGraphicAvailability("lt-sun-green", c)).toMatchObject({ visible: true, usable: false, reason: "paused" });
    expect(getGraphicAvailability("lt-sun-bishop", c)).toMatchObject({ visible: false, usable: false });
    expect(getGraphicAvailability("lt-sun-advert", c)).toMatchObject({ visible: true, usable: false, reason: "locked" });
    expect(getGraphicAvailability("lt-sun-prayer", c)).toMatchObject({ visible: true, usable: true });
    expect(getBlockedGraphicThemeIds(c).sort()).toEqual(["lt-sun-advert", "lt-sun-bishop", "lt-sun-green"]);
  });

  it("turns uploaded packages into lower thirds that carry the package", () => {
    const c = catalog([{ graphicId: "welcome-bar", source: "package", status: "active", tiers: { free: true, paid: true, ambassador: true }, access: "allowed", version: 2, package: pkg }]);
    const theme = getPackageThemes(c).find((t) => t.id === "lt-pkg-welcome-bar")!;
    expect(theme.id).toBe("lt-pkg-welcome-bar");
    expect(theme.html).toContain('data-kx="pkg-welcome-bar"');
    expect(theme.html).toContain('data-v-title="{{title}}"');
    const encoded = /data-kx-pkg="([^"]+)"/.exec(theme.html)?.[1] ?? "";
    expect(JSON.parse(Buffer.from(encoded, "base64").toString("utf8")).html).toBe(pkg.html);
    expect(theme.variables.find((v) => v.key === "socials")?.options?.length).toBeGreaterThan(3);
    expect(theme.variables.find((v) => v.key === "kxAutoOut")?.defaultValue).toBe("6");
    expect(getGraphicAvailability("lt-pkg-welcome-bar", c).usable).toBe(true);
  });

  it("describes plan limits in plain words", () => {
    expect(describeGraphicTiers({ free: true, paid: false, ambassador: false })).toBe("Everyone");
    expect(describeGraphicTiers({ free: false, paid: true, ambassador: true })).toBe("Paid plans and ambassadors");
    expect(describeGraphicTiers({ free: false, paid: false, ambassador: true })).toBe("Ambassadors");
  });
});
