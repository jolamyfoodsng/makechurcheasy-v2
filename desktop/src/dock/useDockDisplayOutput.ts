import { useCallback, useRef } from "react";
import type { DockDisplayModule } from "./dockDisplayOutput";
import { buildDockDisplayItem, clearDockDisplay, showOnDockDisplay, type DockDisplayThemes } from "./dockDisplayOutputClient";
import type { DockSceneRoute } from "./dockSceneRouting";

/**
 * "Output → Send to a display" for a tab: shows what the tab sends on the chosen
 * projector or TV, in the look picked for it. Fire and forget, so OBS is never held up.
 */
export function useDockDisplayOutput(
  module: DockDisplayModule,
  route: DockSceneRoute,
  updateRoute: (patch: Partial<DockSceneRoute>) => void,
) {
  const routeRef = useRef(route);
  routeRef.current = route;

  const sendToDisplay = useCallback((
    data: object & { backgroundOnly?: boolean },
    themes?: DockDisplayThemes,
  ) => {
    const display = routeRef.current.display;
    if (!display?.enabled || data.backgroundOnly) return;
    // Next task: the OBS request this send makes goes out first.
    setTimeout(() => {
      showOnDockDisplay(display, buildDockDisplayItem(module, data, display.mode, themes), (next) => updateRoute({ display: next }));
    }, 0);
  }, [module, updateRoute]);

  const clearDisplay = useCallback(() => {
    clearDockDisplay(routeRef.current.display, module);
  }, [module]);

  return { sendToDisplay, clearDisplay };
}
