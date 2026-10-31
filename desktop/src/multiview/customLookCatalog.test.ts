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
  __resetMultiviewLookCatalogForTests,
  getMultiviewLookCatalog,
  getCustomMultiViewLook,
  listCustomMultiViewLooks,
} = await import("./customLookCatalog");

const pkg = {
  format: "mce-multiview-look@1" as const,
  id: "excellent-glory-summit-2026",
  version: 1,
  name: "Excellent Glory",
  description: "Camera + verse look",
  html: "<html><body>hi</body></html>",
  cameraSlot: { x: 80, y: 260, width: 860, height: 640, shape: "rect" as const },
};

function catalog(looks: unknown[]) {
  return { fetchedAt: Date.now(), looks } as never;
}

describe("customLookCatalog", () => {
  beforeEach(() => {
    storageMap.clear();
    __resetMultiviewLookCatalogForTests();
  });

  it("has no looks before the first download", () => {
    expect(getMultiviewLookCatalog()).toBeNull();
    expect(listCustomMultiViewLooks(null as never)).toEqual([]);
  });

  it("lists only active looks that carry a package, sorted by sortOrder then name", () => {
    const c = catalog([
      { lookId: "b-look", status: "active", name: "B Look", sortOrder: 1, package: { ...pkg, id: "b-look" } },
      { lookId: "a-look", status: "active", name: "A Look", sortOrder: 1, package: { ...pkg, id: "a-look" } },
      { lookId: "paused-look", status: "paused", name: "Paused", sortOrder: 0, package: { ...pkg, id: "paused-look" } },
      { lookId: "hidden-look", status: "hidden", name: "Hidden" },
    ]);
    const listed = listCustomMultiViewLooks(c);
    expect(listed.map((l) => l.lookId)).toEqual(["a-look", "b-look"]);
  });

  it("drops an active entry whose package is missing or malformed", () => {
    const c = catalog([
      { lookId: "broken", status: "active", name: "Broken" },
      { lookId: "ok", status: "active", name: "OK", package: { ...pkg, id: "ok" } },
    ]);
    expect(listCustomMultiViewLooks(c).map((l) => l.lookId)).toEqual(["ok"]);
  });

  it("carries a package's cameraSlot through unchanged (shape included)", () => {
    const c = catalog([
      { lookId: "circle-look", status: "active", name: "Circle", package: { ...pkg, id: "circle-look", cameraSlot: { x: 1, y: 2, width: 3, height: 4, shape: "circle" } } },
    ]);
    expect(getCustomMultiViewLook("circle-look", c)?.package?.cameraSlot).toEqual({ x: 1, y: 2, width: 3, height: 4, shape: "circle" });
  });

  it("finds a look by id regardless of status", () => {
    const c = catalog([
      { lookId: "paused-look", status: "paused", name: "Paused", package: { ...pkg, id: "paused-look" } },
    ]);
    expect(getCustomMultiViewLook("paused-look", c)?.status).toBe("paused");
    expect(getCustomMultiViewLook("missing", c)).toBeUndefined();
  });
});
