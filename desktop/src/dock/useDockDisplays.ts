import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { describeDockDisplays, type DockDisplayChoice } from "./dockDisplayOutput";
import { getLastKnownDockDisplays, listDockDisplays } from "./dockDisplayOutputClient";

/** How often the list is refreshed while it is on screen (screens plugged in or out). */
const DISPLAY_REFRESH_MS = 3000;

/**
 * The screens plugged into this computer while `active` (a picker is open).
 * Starts from the last known list so it shows at once; the refresh corrects it.
 */
export function useDockDisplays(active: boolean): { displays: DockDisplayChoice[] | null; error: string } {
  const { t } = useTranslation();
  const [displays, setDisplays] = useState<DockDisplayChoice[] | null>(() => {
    const known = getLastKnownDockDisplays();
    return known ? describeDockDisplays(known) : null;
  });
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setDisplays(describeDockDisplays(await listDockDisplays()));
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("sceneRouting.displaysUnavailable", "Screens could not be listed."));
    }
  }, [t]);

  useEffect(() => {
    if (!active) return;
    void load();
    const timer = setInterval(() => { void load(); }, DISPLAY_REFRESH_MS);
    return () => clearInterval(timer);
  }, [active, load]);

  return { displays, error };
}
