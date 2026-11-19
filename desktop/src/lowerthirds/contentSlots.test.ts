import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyStyleToAllSlots,
  loadSharedSlotStyle,
  loadSlotStyleScope,
  loadSlots,
  saveSlot,
  saveSlotStyleScope,
} from "./contentSlots";
import type { LowerThirdTheme } from "./types";
import { LT_DEFAULT_CUSTOM_STYLE } from "./types";

const theme = {
  id: "kx-test",
  name: "Test",
  variables: [
    { key: "name", label: "Name", type: "text", defaultValue: "" },
    { key: "kxScale", label: "Size", type: "text", defaultValue: "0.5" },
  ],
} as unknown as LowerThirdTheme;

function fill(index: number, name: string) {
  const values = { name, kxScale: "0.5" };
  saveSlot(theme.id, "ed", index, values, theme, {
    variableValues: values,
    customStyles: { ...LT_DEFAULT_CUSTOM_STYLE },
    position: "bottom-left",
    animationIn: "slide-left",
    exitStyle: "fade",
  });
}

describe("shared slot style", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() { return store.size; },
    });
  });

  it("defaults to every slot and remembers This slot", () => {
    expect(loadSlotStyleScope()).toBe("all");
    saveSlotStyleScope("slot");
    expect(loadSlotStyleScope()).toBe("slot");
  });

  it("copies style to the other filled slots but keeps their text", () => {
    fill(0, "Pastor A");
    fill(2, "Pastor B");
    applyStyleToAllSlots(theme.id, "ed", { values: { kxScale: "1.2" }, position: "top-right", customStyles: { bgColor: "#112233" } }, 0);
    const slots = loadSlots(theme.id, "ed");
    expect(slots[0]?.state.variableValues.kxScale).toBe("0.5");
    expect(slots[2]?.state.variableValues).toEqual({ name: "Pastor B", kxScale: "1.2" });
    expect(slots[2]?.state.position).toBe("top-right");
    expect(slots[2]?.state.customStyles.bgColor).toBe("#112233");
    expect(slots[1]).toBeNull();
  });

  it("remembers the shared style for empty slots", () => {
    applyStyleToAllSlots(theme.id, "ed", { values: { kxScale: "1.2" } });
    applyStyleToAllSlots(theme.id, "ed", { position: "top-left" });
    expect(loadSharedSlotStyle(theme.id, "ed")).toMatchObject({ values: { kxScale: "1.2" }, position: "top-left" });
  });
});
