import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();
const invoke = vi.fn(async (command: string, args: { name: string; data?: string }) => {
  if (command === "load_dock_data") return files.get(args.name) ?? "";
  if (command === "save_dock_data") { files.set(args.name, args.data ?? ""); return undefined; }
  return undefined;
});

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("./db", () => ({ getCurrentUserId: () => "u1" }));
vi.mock("./userScopedStorage", () => ({ getUserScopedKey: (key: string) => key }));
vi.mock("./dockBridge", () => ({ dockBridge: { sendFavoriteThemesUpdated: () => undefined } }));
vi.mock("./broadcastGraphicsCatalog", () => ({ getGraphicAvailability: () => ({ usable: true }), getPackageThemes: () => [] }));

const FILE = "saved-broadcast-graphics-u1";
const base = { name: "", templateId: "t", category: "others" as const, displayType: "lower-third" as const, variables: {}, isAddedToObs: false };
const saved = (id: string) => ({ ...base, id, name: id, createdAt: "2026-01-01", updatedAt: "2026-01-01" });

async function freshModule() {
  vi.resetModules();
  return import("./broadcastGraphicsStorage");
}

beforeEach(() => {
  files.clear();
  invoke.mockClear();
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {}, dispatchEvent: () => true });
});

describe("saved graphics in the desktop app", () => {
  it("does not overwrite the saved list when saving before it was read (the Studio drawer after a restart)", async () => {
    files.set(FILE, JSON.stringify([saved("a"), saved("b")]));
    const storage = await freshModule();
    expect(storage.areSavedBroadcastGraphicsLoaded()).toBe(false);

    expect(() => storage.saveBroadcastGraphic({ ...base, name: "new" })).toThrow(/still loading/i);
    expect(JSON.parse(files.get(FILE)!).map((g: { id: string }) => g.id)).toEqual(["a", "b"]);
  });

  it("reads the list first, then a new graphic is added to it", async () => {
    files.set(FILE, JSON.stringify([saved("a"), saved("b")]));
    const storage = await freshModule();
    expect(await storage.ensureSavedBroadcastGraphicsLoaded()).toBe(true);
    expect(storage.loadSavedBroadcastGraphics().map((g) => g.id)).toEqual(["a", "b"]);

    storage.saveBroadcastGraphic({ ...base, name: "new", id: "c" });
    await vi.waitFor(() => expect(JSON.parse(files.get(FILE)!).map((g: { id: string }) => g.id)).toEqual(["c", "a", "b"]));
  });

  it("reads the file only once however many screens ask", async () => {
    files.set(FILE, JSON.stringify([saved("a")]));
    const storage = await freshModule();
    await Promise.all([storage.ensureSavedBroadcastGraphicsLoaded(), storage.ensureSavedBroadcastGraphicsLoaded(), storage.ensureSavedBroadcastGraphicsLoaded()]);
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "load_dock_data")).toHaveLength(1);
  });

  it("works from the start for a new account with no file", async () => {
    const storage = await freshModule();
    await storage.ensureSavedBroadcastGraphicsLoaded();
    storage.saveBroadcastGraphic({ ...base, name: "first", id: "x" });
    await vi.waitFor(() => expect(JSON.parse(files.get(FILE)!).map((g: { id: string }) => g.id)).toEqual(["x"]));
  });
});
