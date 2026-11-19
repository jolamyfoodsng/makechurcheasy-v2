/**
 * contentSlots.ts — CG-style content slot persistence for lower-thirds
 *
 * 5 memory slots per lower-third, stored in localStorage.
 * Slots store the ENTIRE editor state: content, style, position, animation.
 * Key format: `mce-lt-slots-{themeId}-{editorId}`
 */

import type { LowerThirdTheme, LTCustomStyle, LTPosition, LTAnimationIn, LTExitStyle } from "./types";
import { LT_DEFAULT_CUSTOM_STYLE } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Full editor state snapshot stored in a single slot */
export interface SlotState {
  /** All variable key→value pairs (name, info, custom vars, etc.) */
  variableValues: Record<string, string>;
  /** Style overrides (bold, uppercase, color, etc.) */
  customStyles: LTCustomStyle;
  /** Overlay position */
  position: LTPosition;
  /** Entry animation */
  animationIn: LTAnimationIn;
  /** Exit animation */
  exitStyle: LTExitStyle;
}

/** A single content slot — stores a full editor state snapshot */
export interface ContentSlot {
  /** Slot index (0-9) */
  index: number;
  /** Full editor state snapshot */
  state: SlotState;
  /** Legacy: variable values (kept for backward compat reads) */
  values?: Record<string, string>;
  /** Display label (auto-generated from first text value or "Slot N", or user-renamed) */
  label: string;
  /** Timestamp when last saved/updated */
  updatedAt: number;
  /** @deprecated Use updatedAt. Kept for backward compat. */
  savedAt?: number;
}

/** Result of a save operation */
export interface SaveSlotResult {
  slot: ContentSlot;
  index: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_SLOTS = 7;
const STORAGE_PREFIX = "mce-lt-slots";

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function storageKey(themeId: string, editorId: string): string {
  return `${STORAGE_PREFIX}-${themeId}-${editorId}`;
}

const ACTIVE_SLOT_STORAGE_PREFIX = "mce-lt-active-slot";

/**
 * Load the saved active slot index for a given theme+editor combination.
 * Defaults to 0 if not found or invalid.
 */
export function loadActiveSlotIndex(themeId: string, editorId = "default"): number {
  try {
    const raw = localStorage.getItem(`${ACTIVE_SLOT_STORAGE_PREFIX}-${themeId}-${editorId}`);
    if (raw !== null) {
      const idx = Number.parseInt(raw, 10);
      if (!Number.isNaN(idx) && idx >= 0 && idx < MAX_SLOTS) {
        return idx;
      }
    }
  } catch { /* ignore */ }
  return 0;
}

/**
 * Persist the active slot index for a given theme+editor combination.
 */
export function saveActiveSlotIndex(themeId: string, editorId = "default", index: number): void {
  try {
    if (index >= 0 && index < MAX_SLOTS) {
      localStorage.setItem(`${ACTIVE_SLOT_STORAGE_PREFIX}-${themeId}-${editorId}`, String(index));
    }
  } catch { /* ignore */ }
}

/**
 * Load all slots for a given theme+editor combination.
 * Returns an array of length MAX_SLOTS (empty slots are null).
 */
export function loadSlots(themeId: string, editorId: string): (ContentSlot | null)[] {
  try {
    const raw = localStorage.getItem(storageKey(themeId, editorId));
    if (!raw) return Array(MAX_SLOTS).fill(null);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return Array(MAX_SLOTS).fill(null);
    // Pad to MAX_SLOTS
    const slots: (ContentSlot | null)[] = parsed.slice(0, MAX_SLOTS);
    while (slots.length < MAX_SLOTS) slots.push(null);
    return slots;
  } catch {
    return Array(MAX_SLOTS).fill(null);
  }
}

/**
 * Save a slot at a specific index with full editor state.
 * Returns the saved ContentSlot.
 */
export function saveSlot(
  themeId: string,
  editorId: string,
  index: number,
  values: Record<string, string>,
  theme: LowerThirdTheme,
  fullState: SlotState
): ContentSlot {
  if (index < 0 || index >= MAX_SLOTS) throw new Error(`Invalid slot index: ${index}`);

  const label = generateSlotLabel(values, theme, index);
  const now = Date.now();
  const slot: ContentSlot = {
    index,
    state: { ...fullState },
    values: { ...values },
    label,
    updatedAt: now,
    savedAt: now,
  };

  const slots = loadSlots(themeId, editorId);
  slots[index] = slot;
  localStorage.setItem(storageKey(themeId, editorId), JSON.stringify(slots));

  return slot;
}

/**
 * Resolve the full SlotState from a ContentSlot.
 * Handles backward compatibility: old slots have no `state`, only `values`.
 * In that case, returns the legacy values with default style/position/animation.
 */
export function resolveSlotState(slot: ContentSlot): SlotState {
  if (slot.state) return slot.state;

  // Legacy slot — only has variable values, use defaults for everything else
  return {
    variableValues: slot.values ?? {},
    customStyles: { ...LT_DEFAULT_CUSTOM_STYLE },
    position: "bottom-left",
    animationIn: "slide-left",
    exitStyle: "fade",
  };
}

/**
 * Delete a slot at a specific index.
 */
export function deleteSlot(themeId: string, editorId: string, index: number): void {
  if (index < 0 || index >= MAX_SLOTS) return;
  const slots = loadSlots(themeId, editorId);
  slots[index] = null;
  localStorage.setItem(storageKey(themeId, editorId), JSON.stringify(slots));
}

/**
 * Rename a slot's display label.
 * Preserves all slot state — only changes the label.
 */
export function renameSlot(themeId: string, editorId: string, index: number, newLabel: string): void {
  if (index < 0 || index >= MAX_SLOTS) return;
  const slots = loadSlots(themeId, editorId);
  const slot = slots[index];
  if (!slot) return;
  slot.label = newLabel.trim() || `Slot ${index + 1}`;
  slot.updatedAt = Date.now();
  localStorage.setItem(storageKey(themeId, editorId), JSON.stringify(slots));
}

/**
 * Get all populated (non-null) slots.
 */
export function getPopulatedSlots(
  themeId: string,
  editorId: string
): ContentSlot[] {
  return loadSlots(themeId, editorId).filter((s): s is ContentSlot => s !== null);
}

/**
 * Get the next populated slot after (and including) startIndex.
 * Wraps around. Returns null if no populated slots.
 */
export function getNextPopulatedSlot(
  themeId: string,
  editorId: string,
  startIndex: number = 0
): ContentSlot | null {
  const slots = loadSlots(themeId, editorId);
  if (slots.every((s) => s === null)) return null;

  // Search from startIndex to end, then wrap to beginning
  for (let i = startIndex; i < MAX_SLOTS; i++) {
    if (slots[i]) return slots[i]!;
  }
  for (let i = 0; i < startIndex; i++) {
    if (slots[i]) return slots[i]!;
  }
  return null;
}

/**
 * Get the first empty slot index, or -1 if all full.
 */
export function getFirstEmptySlot(themeId: string, editorId: string): number {
  const slots = loadSlots(themeId, editorId);
  for (let i = 0; i < MAX_SLOTS; i++) {
    if (slots[i] === null) return i;
  }
  return -1;
}

/**
 * Copy a theme's slots and chosen slot from one editor to another (a cloned Dock tab
 * starts with exactly what the tab it came from had).
 */
export function copyEditorSlots(themeId: string, fromEditorId: string, toEditorId: string): void {
  try {
    const raw = localStorage.getItem(storageKey(themeId, fromEditorId));
    if (raw) localStorage.setItem(storageKey(themeId, toEditorId), raw);
    else localStorage.removeItem(storageKey(themeId, toEditorId));
    const shared = localStorage.getItem(sharedStyleKey(themeId, fromEditorId));
    if (shared) localStorage.setItem(sharedStyleKey(themeId, toEditorId), shared);
    else localStorage.removeItem(sharedStyleKey(themeId, toEditorId));
    saveActiveSlotIndex(themeId, toEditorId, loadActiveSlotIndex(themeId, fromEditorId));
  } catch { /* storage full or unavailable */ }
}

// ---------------------------------------------------------------------------
// Shared style (Size, Duration, Speed, Position, colours) across memory slots
// ---------------------------------------------------------------------------

/** Where a style change goes: every memory slot of the graphic, or only the open one. */
export type SlotStyleScope = "all" | "slot";

/** Style settings copied between slots. Text content is never part of it. */
export interface SlotStylePatch {
  /** Style variables (kxScale, kxAutoOut, kxSpeed, colour fields…). */
  values?: Record<string, string>;
  position?: LTPosition;
  customStyles?: Partial<LTCustomStyle>;
}

const STYLE_SCOPE_KEY = "mce-lt-style-scope";
const SHARED_STYLE_PREFIX = "mce-lt-shared-style";

function sharedStyleKey(themeId: string, editorId: string): string {
  return `${SHARED_STYLE_PREFIX}-${themeId}-${editorId}`;
}

/** Style changes apply to every slot unless the user picked "This slot only". */
export function loadSlotStyleScope(): SlotStyleScope {
  try {
    return localStorage.getItem(STYLE_SCOPE_KEY) === "slot" ? "slot" : "all";
  } catch {
    return "all";
  }
}

export function saveSlotStyleScope(scope: SlotStyleScope): void {
  try {
    localStorage.setItem(STYLE_SCOPE_KEY, scope);
  } catch { /* ignore */ }
}

/** The style every slot shares; empty slots start with it. */
export function loadSharedSlotStyle(themeId: string, editorId: string): SlotStylePatch {
  try {
    const raw = localStorage.getItem(sharedStyleKey(themeId, editorId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as SlotStylePatch) : {};
  } catch {
    return {};
  }
}

function mergeStylePatch(base: SlotStylePatch, patch: SlotStylePatch): SlotStylePatch {
  return {
    values: patch.values ? { ...(base.values ?? {}), ...patch.values } : base.values,
    position: patch.position ?? base.position,
    customStyles: patch.customStyles ? { ...(base.customStyles ?? {}), ...patch.customStyles } : base.customStyles,
  };
}

/** Lay a style patch over a slot state (text content is left alone). */
export function applyStylePatchToState(state: SlotState, patch: SlotStylePatch): SlotState {
  return {
    ...state,
    variableValues: patch.values ? { ...state.variableValues, ...patch.values } : state.variableValues,
    position: patch.position ?? state.position,
    customStyles: patch.customStyles ? { ...state.customStyles, ...patch.customStyles } : state.customStyles,
  };
}

/**
 * Copy a style change to every saved slot of this graphic (except `exceptIndex`, the
 * open slot, which saves itself) and remember it so empty slots start with it too.
 */
export function applyStyleToAllSlots(
  themeId: string,
  editorId: string,
  patch: SlotStylePatch,
  exceptIndex: number | null = null,
): void {
  try {
    const slots = loadSlots(themeId, editorId);
    let changed = false;
    const next = slots.map((slot) => {
      if (!slot || slot.index === exceptIndex) return slot;
      changed = true;
      const state = applyStylePatchToState(resolveSlotState(slot), patch);
      return {
        ...slot,
        state,
        values: { ...state.variableValues },
        updatedAt: Date.now(),
      };
    });
    if (changed) localStorage.setItem(storageKey(themeId, editorId), JSON.stringify(next));
    const shared = mergeStylePatch(loadSharedSlotStyle(themeId, editorId), patch);
    localStorage.setItem(sharedStyleKey(themeId, editorId), JSON.stringify(shared));
  } catch { /* storage full or unavailable */ }
}

/** Remove every theme's slots for an editor (a closed Dock tab). */
export function deleteEditorSlots(editorId: string): void {
  try {
    const suffix = `-${editorId}`;
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.endsWith(suffix)) continue;
      if (
        key.startsWith(`${STORAGE_PREFIX}-`) ||
        key.startsWith(`${ACTIVE_SLOT_STORAGE_PREFIX}-`) ||
        key.startsWith(`${SHARED_STYLE_PREFIX}-`)
      ) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Auto-generate a label from variable values.
 * Uses the first non-empty text value, or falls back to "Slot N".
 */
function generateSlotLabel(
  values: Record<string, string>,
  theme: LowerThirdTheme,
  index: number
): string {
  const vars = theme.variables;
  // Try to find first text-type variable with a value
  for (const v of vars) {
    if (v.type === "text" || v.type === "list") {
      const val = values[v.key];
      if (val && val.trim()) {
        // Truncate to 30 chars
        const text = val.trim();
        return text.length > 30 ? text.substring(0, 27) + "..." : text;
      }
    }
  }
  // Fallback
  return `Slot ${index + 1}`;
}
