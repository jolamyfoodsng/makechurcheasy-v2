/**
 * useDockTabLabelMode — the "Label" choice in the Worship and Notes quick controls.
 *
 * Themes have a small label line (the reference slot for Bible). For songs and notes
 * it can show the song / note title, the section (e.g. "Chorus"), both, or nothing.
 * "Auto" keeps the original behaviour. The choice is remembered per tab and handed
 * to dockObsClient, which fills the label on every slide it sends.
 */
import { useCallback, useEffect, useState } from "react";
import { readDockPreference, saveDockPreference } from "../services/dockPreferenceStorage";
import { dockObsClient, normalizeDockTabLabelMode, type DockTabLabelMode } from "./dockObsClient";

const PREF_KEY: Record<"worship" | "notes", string> = {
  worship: "ocs-dock-worship-label-mode",
  notes: "ocs-dock-notes-label-mode",
};

export const DOCK_TAB_LABEL_OPTIONS: Record<"worship" | "notes", readonly { id: DockTabLabelMode; label: string; hint: string }[]> = {
  worship: [
    { id: "auto", label: "Auto", hint: "As before: no label on songs" },
    { id: "none", label: "Off", hint: "No heading: hides the label and the box behind it" },
    { id: "title", label: "Song", hint: "Show the song title" },
    { id: "section", label: "Section", hint: "Show the section, e.g. Chorus" },
    { id: "title-section", label: "Both", hint: "Song title · section" },
  ],
  notes: [
    { id: "auto", label: "Auto", hint: "As before: the slide label in lower thirds" },
    { id: "none", label: "Off", hint: "No heading: hides the label and the box behind it" },
    { id: "title", label: "Note", hint: "Show the note title" },
    { id: "section", label: "Slide", hint: "Show the slide label" },
    { id: "title-section", label: "Both", hint: "Note title · slide label" },
  ],
};

function readMode(tab: "worship" | "notes"): DockTabLabelMode {
  try {
    return normalizeDockTabLabelMode(readDockPreference<{ mode?: string }>(PREF_KEY[tab])?.mode);
  } catch {
    return "auto";
  }
}

/** Several panels show this choice (quick controls, the theme's Size panel); they stay in step. */
const CHANGE_EVENT = "mce-dock-tab-label-mode-change";

export function useDockTabLabelMode(tab: "worship" | "notes") {
  const [mode, setModeState] = useState<DockTabLabelMode>(() => readMode(tab));

  useEffect(() => {
    dockObsClient.setTabLabelMode(tab, mode);
  }, [tab, mode]);

  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ tab: string; mode: DockTabLabelMode }>).detail;
      if (detail?.tab === tab) setModeState(normalizeDockTabLabelMode(detail.mode));
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, [tab]);

  const setMode = useCallback(
    (next: string) => {
      const value = normalizeDockTabLabelMode(next);
      setModeState(value);
      dockObsClient.setTabLabelMode(tab, value);
      void saveDockPreference(PREF_KEY[tab], { mode: value }).catch(() => undefined);
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { tab, mode: value } }));
    },
    [tab],
  );

  return { labelMode: mode, setLabelMode: setMode, labelOptions: DOCK_TAB_LABEL_OPTIONS[tab] };
}
