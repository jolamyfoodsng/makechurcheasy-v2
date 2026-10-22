import { beforeEach, describe, expect, it, vi } from "vitest";

const { check } = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(), exit: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile: vi.fn() }));
vi.mock("@tauri-apps/api/path", () => ({ tempDir: vi.fn(), join: vi.fn() }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

import { clearPublishedReleaseCache, downloadVerifiedUpdate } from "./updateService";

function fakeUpdate(version: string) {
  return {
    version,
    currentVersion: "4.3.11",
    close: vi.fn().mockResolvedValue(undefined),
    download: vi.fn().mockResolvedValue(undefined),
    install: vi.fn().mockResolvedValue(undefined),
  };
}

function publishRelease(tag: string) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ tag_name: tag, draft: false, prerelease: false, assets: [] }),
  }));
}

describe("downloadVerifiedUpdate when a newer release came out after the update was found", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPublishedReleaseCache();
  });

  it("installs the matching signed update without asking again", async () => {
    publishRelease("v4.3.13");
    const update = fakeUpdate("4.3.13");
    const prepared = await downloadVerifiedUpdate(update as never);
    expect(prepared.source).toBe("signed");
    expect(update.download).toHaveBeenCalledTimes(1);
    expect(check).not.toHaveBeenCalled();
  });

  it("asks again and uses the newest signed update instead of opening an installer", async () => {
    publishRelease("v4.3.13");
    const stale = fakeUpdate("4.3.12");
    const fresh = fakeUpdate("4.3.13");
    check.mockResolvedValueOnce(fresh);
    const prepared = await downloadVerifiedUpdate(stale as never);
    expect(prepared.source).toBe("signed");
    expect(prepared.version).toBe("4.3.13");
    expect(stale.close).toHaveBeenCalled();
    expect(stale.download).not.toHaveBeenCalled();
    expect(fresh.download).toHaveBeenCalledTimes(1);
  });

  it("falls back to the installer only when no matching signed update exists", async () => {
    publishRelease("v4.3.13");
    const stale = fakeUpdate("4.3.12");
    check.mockResolvedValueOnce(null);
    await expect(downloadVerifiedUpdate(stale as never)).rejects.toThrow(/No installer available/);
    expect(check).toHaveBeenCalledTimes(1);
  });
});
