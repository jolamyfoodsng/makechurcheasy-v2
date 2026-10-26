import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOCK_NOTES_KEY,
  DOCK_NOTES_SAVED_AT_KEY,
  appendTextToDockNotes,
  loadDockNotes,
  resolveDockNotesPresentationSettings,
  saveDockNotesPreferences,
} from "./dockNotesStorage";
import type { DockFullscreenQuickThemeSettings } from "./components/DockFullscreenThemeQuickSettings";
import { removeNativeDockSetting } from "../services/localDockSettings";

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

describe("dock notes presentation settings", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
    // Notes are read from the on-disk copy too; start each test without one.
    void removeNativeDockSetting(DOCK_NOTES_KEY);
    void removeNativeDockSetting(DOCK_NOTES_SAVED_AT_KEY);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("can force the caller-selected overlay mode over saved Notes preferences", async () => {
    saveDockNotesPreferences({ overlayMode: "lower-third" });

    const settings = await resolveDockNotesPresentationSettings("fullscreen", {
      forceOverlayMode: true,
    });

    expect(settings.overlayMode).toBe("fullscreen");
  });

  it("keeps saved Notes preferences when the caller does not force the mode", async () => {
    saveDockNotesPreferences({ overlayMode: "lower-third" });

    const settings = await resolveDockNotesPresentationSettings("fullscreen");

    expect(settings.overlayMode).toBe("lower-third");
  });

  it("creates visible note cards from LM saves instead of hiding them in an old daily note", () => {
    const first = appendTextToDockNotes("First saved line");
    const second = appendTextToDockNotes("Second saved line");

    expect(first?.note.title).toContain("First saved line");
    expect(second?.note.title).toContain("Second saved line");

    const notes = loadDockNotes();
    expect(notes).toHaveLength(2);
    expect(notes[0].content).toBe("Second saved line");
    expect(notes[1].content).toBe("First saved line");
  });

  it("moves an explicitly appended note to the top after updating it", () => {
    appendTextToDockNotes("Original first", "Shared Note");
    appendTextToDockNotes("Other note", "Other Note");
    appendTextToDockNotes("New content", "Shared Note");

    const notes = loadDockNotes();
    expect(notes).toHaveLength(2);
    expect(notes[0].title).toBe("Shared Note");
    expect(notes[0].content).toContain("Original first");
    expect(notes[0].content).toContain("New content");
  });

  it("does not duplicate the same relayed LM note command", () => {
    appendTextToDockNotes("Relayed line", "Relayed Note", { sourceId: "lm-command-1" });
    appendTextToDockNotes("Relayed line", "Relayed Note", { sourceId: "lm-command-1" });

    const notes = loadDockNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe("Relayed Note");
    expect(notes[0].content).toBe("Relayed line");
    expect(notes[0].sourceId).toBe("lm-command-1");
  });

  it("appends captures from one listening session to a single note and deduplicates relays", () => {
    const first = appendTextToDockNotes("First edited capture", "Speech Notes · Session A", {
      sourceId: "lm-command-a",
      sessionId: "lm-session-a",
    });
    const second = appendTextToDockNotes("Second edited capture", "Speech Notes · Session A", {
      sourceId: "lm-command-b",
      sessionId: "lm-session-a",
    });
    appendTextToDockNotes("Second edited capture", "Speech Notes · Session A", {
      sourceId: "lm-command-b",
      sessionId: "lm-session-a",
    });

    expect(first?.note.id).toBe(second?.note.id);
    expect(loadDockNotes()).toHaveLength(1);
    expect(loadDockNotes()[0]).toMatchObject({
      title: "Speech Notes · Session A",
      sessionId: "lm-session-a",
      content: "First edited capture\n\nSecond edited capture",
      appendSourceIds: ["lm-command-a", "lm-command-b"],
    });
  });

  it("starts a separate transcript note when the listening session changes", () => {
    appendTextToDockNotes("First session", "Speech Notes · A", {
      sourceId: "lm-command-a",
      sessionId: "lm-session-a",
    });
    appendTextToDockNotes("Second session", "Speech Notes · B", {
      sourceId: "lm-command-b",
      sessionId: "lm-session-b",
    });

    expect(loadDockNotes()).toHaveLength(2);
    expect(loadDockNotes()[0].sessionId).toBe("lm-session-b");
    expect(loadDockNotes()[1].sessionId).toBe("lm-session-a");
  });

  it("resolves Notes lower-third quick pattern settings into the final overlay theme", async () => {
    const quickSettings: DockFullscreenQuickThemeSettings = {
      fontSize: 42,
      fontFamily: "Inter, system-ui, sans-serif",
      refFontSize: 18,
      refFontWeight: "normal",
      fontColor: "#ffffff",
      refFontColor: "#ffffff",
      refPosition: "bottom",
      refTextTransform: "none",
      refLetterSpacing: 0,
      refOpacity: 1,
      refTextAlign: "match",
      refSpacing: 16,
      fullscreenShadeColor: "#000000",
      fullscreenShadeOpacity: 0.42,
      textAlign: "center",
      lineHeight: 1.32,
      fontWeight: "bold",
      fontStyle: "normal",
      textTransform: "none",
      textShadow: "none",
      animation: "fade",
      animationDuration: 300,
      backgroundImage: "",
      backgroundImageFilePath: "",
      backgroundPattern: "diagonal-lines",
      backgroundVideo: "",
      backgroundVideoFilePath: "",
      backgroundOpacity: 1,
      backgroundColor: "",
      backgroundColorEnd: "",
      bgGradientAngle: 180,
      referenceBackgroundEnabled: false,
      referenceBackgroundColor: "#ffffff",
      referenceBackgroundStyle: "solid",
      referenceBackgroundRadius: 12,
      lowerThirdPosition: "left",
      lowerThirdSize: "medium",
      lowerThirdWidthPreset: "md",
      lowerThirdOffsetX: 0,
      lowerThirdCaptionPosition: "bottom",
      compareTranslationWidth: 40,
      compareTranslationGap: 40,
      backgroundType: "pattern",
    };

    saveDockNotesPreferences({
      overlayMode: "lower-third",
      lowerThirdQuickSettings: quickSettings,
    });

    const settings = await resolveDockNotesPresentationSettings("lower-third");

    expect(settings.overlayMode).toBe("lower-third");
    expect(settings.themeSettings?.backgroundType).toBe("pattern");
    expect(settings.themeSettings?.backgroundPattern).toBe("diagonal-lines");
    expect(settings.themeSettings?.backgroundColor).toBe("transparent");
    expect(settings.themeSettings?.boxBackground).toBeTruthy();
  });
});
