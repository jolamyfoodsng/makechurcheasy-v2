import { describe, it, expect, vi, beforeEach } from "vitest";
import { dockObsClient } from "./dockObsClient";

describe("ensureModuleSourceOpenAndOnTop", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Worship and Notes share one source, so a previous test's "already on top" memory
    // would make the fast path skip the OBS calls these tests look for.
    const client = dockObsClient as any;
    client._lastActivePresentationSource = null;
    client._lastVerifiedStackedBySceneSource = {};
  });

  it("checks if Bible source is open and on top, enabling it and stacking above other layers", async () => {
    vi.spyOn(dockObsClient, "isConnected", "get").mockReturnValue(true);

    const calls: Array<{ method: string; params: any }> = [];
    const sceneItems = [
      { sourceName: "Image - MCE Presentation", sceneItemId: 1, sceneItemIndex: 2, sceneItemEnabled: false },
      { sourceName: "Bible - MCE Presentation", sceneItemId: 2, sceneItemIndex: 1, sceneItemEnabled: false }, // Eye slashed / disabled
      { sourceName: "Worship - MCE Presentation", sceneItemId: 3, sceneItemIndex: 0, sceneItemEnabled: false },
      { sourceName: "Ticker - MCE Presentation", sceneItemId: 4, sceneItemIndex: 3, sceneItemEnabled: true }, // Ticker on top
    ];

    vi.spyOn(dockObsClient, "call").mockImplementation(async (method: string, params?: any) => {
      calls.push({ method, params });
      if (method === "GetSceneItemList") {
        return { sceneItems: [...sceneItems] };
      }
      if (method === "SetSceneItemEnabled") {
        const item = sceneItems.find((i) => i.sceneItemId === params?.sceneItemId);
        if (item) item.sceneItemEnabled = params.sceneItemEnabled;
        return {};
      }
      if (method === "SetSceneItemIndex") {
        const item = sceneItems.find((i) => i.sceneItemId === params?.sceneItemId);
        if (item) item.sceneItemIndex = params.sceneItemIndex;
        return {};
      }
      return {};
    });

    vi.spyOn(dockObsClient, "callBatch").mockImplementation(async (requests: any) => {
      for (const req of requests) {
        calls.push({ method: req.requestType, params: req.requestData });
        if (req.requestType === "SetSceneItemEnabled") {
          const item = sceneItems.find((i) => i.sceneItemId === req.requestData?.sceneItemId);
          if (item) item.sceneItemEnabled = req.requestData.sceneItemEnabled;
        }
      }
      return [];
    });

    await dockObsClient.ensureModuleSourceOpenAndOnTop("bible");

    // 1. Must enable Bible source
    const enableBibleCall = calls.find(
      (c) => c.method === "SetSceneItemEnabled" && c.params?.sceneItemId === 2 && c.params?.sceneItemEnabled === true,
    );
    expect(enableBibleCall).toBeDefined();

    // 2. Must place Bible source at top index under ticker
    const setIndexBibleCall = calls.find(
      (c) => c.method === "SetSceneItemIndex" && c.params?.sceneItemId === 2,
    );
    expect(setIndexBibleCall).toBeDefined();
    // In a 4-item list with ticker at index 3, targetIndex for content is 2 (above Image/Worship)
    expect(setIndexBibleCall?.params?.sceneItemIndex).toBe(2);
  });

  it("checks if Worship source is open and on top, enabling it", async () => {
    vi.spyOn(dockObsClient, "isConnected", "get").mockReturnValue(true);

    const calls: Array<{ method: string; params: any }> = [];
    const sceneItems = [
      { sourceName: "Worship - MCE Presentation", sceneItemId: 10, sceneItemIndex: 0, sceneItemEnabled: false },
      { sourceName: "Bible - MCE Presentation", sceneItemId: 11, sceneItemIndex: 1, sceneItemEnabled: true },
    ];

    vi.spyOn(dockObsClient, "call").mockImplementation(async (method: string, params?: any) => {
      calls.push({ method, params });
      if (method === "GetSceneItemList") {
        return { sceneItems: [...sceneItems] };
      }
      if (method === "SetSceneItemEnabled") {
        const item = sceneItems.find((i) => i.sceneItemId === params?.sceneItemId);
        if (item) item.sceneItemEnabled = params.sceneItemEnabled;
        return {};
      }
      if (method === "SetSceneItemIndex") {
        const item = sceneItems.find((i) => i.sceneItemId === params?.sceneItemId);
        if (item) item.sceneItemIndex = params.sceneItemIndex;
        return {};
      }
      return {};
    });

    vi.spyOn(dockObsClient, "callBatch").mockImplementation(async (requests: any) => {
      for (const req of requests) {
        calls.push({ method: req.requestType, params: req.requestData });
        if (req.requestType === "SetSceneItemEnabled") {
          const item = sceneItems.find((i) => i.sceneItemId === req.requestData?.sceneItemId);
          if (item) item.sceneItemEnabled = req.requestData.sceneItemEnabled;
        }
      }
      return [];
    });

    await dockObsClient.ensureModuleSourceOpenAndOnTop("worship");

    const enableWorshipCall = calls.find(
      (c) => c.method === "SetSceneItemEnabled" && c.params?.sceneItemId === 10 && c.params?.sceneItemEnabled === true,
    );
    expect(enableWorshipCall).toBeDefined();

    const setIndexWorshipCall = calls.find(
      (c) => c.method === "SetSceneItemIndex" && c.params?.sceneItemId === 10,
    );
    expect(setIndexWorshipCall).toBeDefined();
    // 2-item list without ticker, topIndex is 1
    expect(setIndexWorshipCall?.params?.sceneItemIndex).toBe(1);
  });

  it("checks if Notes source (shared with Worship) is open and on top, enabling it", async () => {
    vi.spyOn(dockObsClient, "isConnected", "get").mockReturnValue(true);

    const calls: Array<{ method: string; params: any }> = [];
    const sceneItems = [
      { sourceName: "Worship - MCE Presentation", sceneItemId: 20, sceneItemIndex: 0, sceneItemEnabled: false },
    ];

    vi.spyOn(dockObsClient, "call").mockImplementation(async (method: string, params?: any) => {
      calls.push({ method, params });
      if (method === "GetSceneItemList") {
        return { sceneItems: [...sceneItems] };
      }
      if (method === "SetSceneItemEnabled") {
        const item = sceneItems.find((i) => i.sceneItemId === params?.sceneItemId);
        if (item) item.sceneItemEnabled = params.sceneItemEnabled;
        return {};
      }
      return {};
    });

    vi.spyOn(dockObsClient, "callBatch").mockImplementation(async (requests: any) => {
      for (const req of requests) {
        calls.push({ method: req.requestType, params: req.requestData });
        if (req.requestType === "SetSceneItemEnabled") {
          const item = sceneItems.find((i) => i.sceneItemId === req.requestData?.sceneItemId);
          if (item) item.sceneItemEnabled = req.requestData.sceneItemEnabled;
        }
      }
      return [];
    });

    await dockObsClient.ensureModuleSourceOpenAndOnTop("notes");

    const enableNotesCall = calls.find(
      (c) => c.method === "SetSceneItemEnabled" && c.params?.sceneItemId === 20 && c.params?.sceneItemEnabled === true,
    );
    expect(enableNotesCall).toBeDefined();
  });

  it("skips redundant OBS queries when the module is already active and verified recently (fast path)", async () => {
    vi.spyOn(dockObsClient, "isConnected", "get").mockReturnValue(true);

    const calls: Array<{ method: string; params: any }> = [];
    const sceneItems = [
      { sourceName: "Bible - MCE Presentation", sceneItemId: 2, sceneItemIndex: 0, sceneItemEnabled: true },
    ];

    vi.spyOn(dockObsClient, "call").mockImplementation(async (method: string, params?: any) => {
      calls.push({ method, params });
      if (method === "GetSceneItemList") {
        return { sceneItems: [...sceneItems] };
      }
      return {};
    });

    // First call sets up and verifies the Bible source
    await dockObsClient.ensureModuleSourceOpenAndOnTop("bible");
    const initialCallCount = calls.length;

    // Second call within 15 seconds should take the fast path without any new OBS API calls
    await dockObsClient.ensureModuleSourceOpenAndOnTop("bible");
    expect(calls.length).toBe(initialCallCount);
  });
});
