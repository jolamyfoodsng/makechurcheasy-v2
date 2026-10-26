import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DockNote } from "./dockNotesStorage";

type NotesModule = typeof import("./dockNotesStorage");

function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
  };
}

function note(id: string, content: string, updatedAt: number): DockNote {
  return { id, title: id, content, updatedAt };
}

// The OBS Dock and the main app window each have their own browser storage,
// but share the app's on-disk settings (one module instance here).
const appWindow = createMemoryStorage();
const dockWindow = createMemoryStorage();

function inWindow<T>(storage: Storage, run: () => T): T {
  vi.stubGlobal("localStorage", storage);
  return run();
}

describe("dock notes never go back to an older copy", () => {
  let notes: NotesModule;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    appWindow.clear();
    dockWindow.clear();
    vi.stubGlobal("localStorage", appWindow);
    const settings = await import("../services/localDockSettings");
    await settings.hydrateNativeDockSettings();
    notes = await import("./dockNotesStorage");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps today's edit after a restart when the app window still has yesterday's notes", () => {
    // Yesterday: the note is written and both windows see it.
    vi.setSystemTime(new Date("2026-10-24T10:00:00Z"));
    const yesterday = [note("sermon", "Yesterday's outline", Date.now())];
    inWindow(dockWindow, () => notes.saveDockNotes(yesterday));
    inWindow(appWindow, () => notes.saveDockNotes(yesterday));

    // Today: the note is changed in the Dock only.
    vi.setSystemTime(new Date("2026-10-25T09:00:00Z"));
    inWindow(dockWindow, () => notes.saveDockNotes([note("sermon", "Today's outline", Date.now())]));

    // Restart: the app window reads its notes and sends them to the Dock.
    const sentByApp = inWindow(appWindow, () => notes.loadDockNotes());
    const savedAt = inWindow(appWindow, () => notes.loadDockNotesSavedAt());
    expect(sentByApp[0].content).toBe("Today's outline");

    // Even an old copy sent before the fix is not allowed to win.
    const shown = inWindow(dockWindow, () => notes.acceptIncomingDockNotes(yesterday, savedAt));
    expect(shown[0].content).toBe("Today's outline");
    expect(inWindow(dockWindow, () => notes.loadDockNotes())[0].content).toBe("Today's outline");
  });

  it("keeps the note after it is set back and the app restarts again", () => {
    vi.setSystemTime(new Date("2026-10-24T10:00:00Z"));
    const yesterday = [note("sermon", "Old", Date.now())];
    inWindow(appWindow, () => notes.saveDockNotes(yesterday));

    vi.setSystemTime(new Date("2026-10-25T09:00:00Z"));
    inWindow(dockWindow, () => notes.saveDockNotes([note("sermon", "Set back", Date.now())]));

    // Each restart, the app window offers its old copy again.
    for (let restart = 0; restart < 3; restart += 1) {
      const fromApp = inWindow(appWindow, () => notes.loadDockNotes());
      inWindow(dockWindow, () => notes.acceptIncomingDockNotes(fromApp));
      expect(inWindow(dockWindow, () => notes.loadDockNotes())[0].content).toBe("Set back");
    }
  });

  it("does not bring back a deleted note from an older copy", () => {
    vi.setSystemTime(new Date("2026-10-24T10:00:00Z"));
    const both = [note("keep", "Keep", Date.now()), note("gone", "Delete me", Date.now())];
    inWindow(appWindow, () => notes.saveDockNotes(both));
    inWindow(dockWindow, () => notes.saveDockNotes(both));

    vi.setSystemTime(new Date("2026-10-25T09:00:00Z"));
    inWindow(dockWindow, () => notes.saveDockNotes([both[0]]));

    const result = inWindow(dockWindow, () => notes.acceptIncomingDockNotes(both));
    expect(result.map((n) => n.id)).toEqual(["keep"]);
  });

  it("keeps a note created in another window after this list was saved", () => {
    const merged = notes.mergeDockNotesCopies([
      { notes: [note("a", "A", 100)], savedAt: 200 },
      { notes: [note("a", "A edited", 300), note("b", "New", 250)], savedAt: 150 },
    ]);
    expect(merged.notes.map((n) => [n.id, n.content])).toEqual([["b", "New"], ["a", "A edited"]]);
  });
});
