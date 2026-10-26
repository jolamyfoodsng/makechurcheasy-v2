import { describe, expect, it } from "vitest";
import { continuesLastEdit, historyShortcut, isTextEntryTarget } from "./editHistory";

const key = (k: string, mods: Partial<{ meta: boolean; ctrl: boolean; shift: boolean; alt: boolean; code: string }> = {}) => ({
  key: k,
  code: mods.code ?? `Key${k.toUpperCase()}`,
  metaKey: Boolean(mods.meta),
  ctrlKey: Boolean(mods.ctrl),
  shiftKey: Boolean(mods.shift),
  altKey: Boolean(mods.alt),
});

describe("historyShortcut", () => {
  it("reads the macOS shortcuts", () => {
    expect(historyShortcut(key("z", { meta: true }))).toBe("undo");
    // Shift turns the key into a capital Z.
    expect(historyShortcut(key("Z", { meta: true, shift: true }))).toBe("redo");
    expect(historyShortcut(key("y", { meta: true }))).toBe("redo");
  });

  it("reads the Windows shortcuts", () => {
    expect(historyShortcut(key("z", { ctrl: true }))).toBe("undo");
    expect(historyShortcut(key("y", { ctrl: true }))).toBe("redo");
    expect(historyShortcut(key("Z", { ctrl: true, shift: true }))).toBe("redo");
  });

  it("works with Caps Lock and non-Latin layouts", () => {
    expect(historyShortcut(key("Z", { ctrl: true }))).toBe("undo");
    expect(historyShortcut(key("я", { ctrl: true, code: "KeyZ" }))).toBe("undo");
  });

  it("ignores other keys and plain letters", () => {
    expect(historyShortcut(key("z"))).toBeNull();
    expect(historyShortcut(key("x", { meta: true }))).toBeNull();
    expect(historyShortcut(key("z", { meta: true, alt: true }))).toBeNull();
    expect(historyShortcut(key("Y", { ctrl: true, shift: true }))).toBeNull();
  });
});

describe("isTextEntryTarget", () => {
  // The tests run without a DOM; these stand in for elements.
  const el = (tagName: string, type = "", isContentEditable = false) => ({ tagName, type, isContentEditable }) as unknown as EventTarget;

  it("leaves text fields to their own undo", () => {
    expect(isTextEntryTarget(el("INPUT", "text"))).toBe(true);
    expect(isTextEntryTarget(el("INPUT", "number"))).toBe(true);
    expect(isTextEntryTarget(el("TEXTAREA"))).toBe(true);
    expect(isTextEntryTarget(el("DIV", "", true))).toBe(true);
  });

  it("handles sliders, colours, buttons and the page", () => {
    expect(isTextEntryTarget(el("INPUT", "range"))).toBe(false);
    expect(isTextEntryTarget(el("INPUT", "color"))).toBe(false);
    expect(isTextEntryTarget(el("BUTTON"))).toBe(false);
    expect(isTextEntryTarget(el("BODY"))).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });
});

describe("continuesLastEdit", () => {
  it("merges quick changes to the same thing", () => {
    expect(continuesLastEdit({ key: "fontSize", at: 1000 }, "fontSize", 1400)).toBe(true);
  });

  it("starts a new step for another field, after a pause, or with nothing before", () => {
    expect(continuesLastEdit({ key: "fontSize", at: 1000 }, "fontColor", 1100)).toBe(false);
    expect(continuesLastEdit({ key: "fontSize", at: 1000 }, "fontSize", 2000)).toBe(false);
    expect(continuesLastEdit(null, "fontSize", 1000)).toBe(false);
  });
});
