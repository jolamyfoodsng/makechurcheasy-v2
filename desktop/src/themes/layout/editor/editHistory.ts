/**
 * editHistory.ts — keyboard undo / redo for the Theme Editor.
 *
 * Cmd+Z / Cmd+Shift+Z / Cmd+Y on macOS and Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z on
 * Windows. While the user types in a text field the shortcut is left alone so
 * the field's own undo keeps working. A slider drag or a burst of typing is one
 * step, not one step per tick.
 */

export type HistoryShortcut = "undo" | "redo";

type KeyLike = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

/** Which history shortcut the key press is, if any. */
export function historyShortcut(e: KeyLike): HistoryShortcut | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  // Shift makes e.key "Z"; a non-Latin keyboard layout gives another letter, so fall back to the key's position.
  let key = (e.key || "").toLowerCase();
  if (key !== "z" && key !== "y") key = e.code === "KeyZ" ? "z" : e.code === "KeyY" ? "y" : key;
  if (key === "z") return e.shiftKey ? "redo" : "undo";
  if (key === "y" && !e.shiftKey) return "redo";
  return null;
}

const TEXT_INPUT_TYPES = new Set(["", "text", "search", "url", "tel", "email", "password", "number"]);

/** True for fields with their own text undo (text inputs, text areas, editable text). Sliders and buttons are not. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toUpperCase();
  if (tag === "TEXTAREA") return true;
  if (tag !== "INPUT") return false;
  const type = ((el as HTMLInputElement).type || el.getAttribute?.("type") || "").toLowerCase();
  return TEXT_INPUT_TYPES.has(type);
}

/** Changes to the same thing this close together are one undo step. */
export const HISTORY_MERGE_MS = 600;

export interface LastEdit {
  key: string;
  at: number;
}

/** True when this edit continues the last one (same fields, soon after) and should not add a new undo step. */
export function continuesLastEdit(last: LastEdit | null, key: string, now: number, windowMs = HISTORY_MERGE_MS): boolean {
  return Boolean(last && last.key === key && now - last.at <= windowMs);
}
