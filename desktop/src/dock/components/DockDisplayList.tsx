import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Icon from "../DockIcon";
import { closeAllDockProjectors } from "../dockDisplayOutputClient";
import { dockDisplayLabel, type DockDisplayChoice } from "../dockDisplayOutput";
import "./DockSceneRoutingControl.css";

interface Props {
  /** null while the first list is loading. */
  displays: DockDisplayChoice[] | null;
  error?: string;
  /** Key of the chosen display, or "" for none. */
  selectedKey: string;
  /** Radio group name (one per picker on the page). */
  name: string;
  onPick: (display: DockDisplayChoice) => void;
  /** A saved display that isn't connected now: shown as a disabled row. */
  missingName?: string;
  /** Shown on the chosen row instead of its size (e.g. a look picker). */
  selectedExtra?: (display: DockDisplayChoice) => ReactNode;
  /** The hint under the list when nothing needs explaining. */
  hint: string;
}

/**
 * The screens plugged into this computer as a radio list: this computer's own
 * screen is listed but can't be picked. Used by Output → "Send to a display"
 * and the Media tab's "Send to a display".
 */
export default function DockDisplayList({
  displays,
  error = "",
  selectedKey,
  name,
  onPick,
  missingName,
  selectedExtra,
  hint,
}: Props) {
  const { t } = useTranslation();
  const [closing, setClosing] = useState(false);
  const onlyComputerScreen = displays !== null && !displays.some((display) => !display.isComputerScreen);

  return (
    <>
      <div className="dock-scene-routing-control__scene-list" role="radiogroup" aria-label={t("sceneRouting.displays", "Displays")}>
        {displays === null ? (
          <div className="dock-scene-routing-control__empty">
            {error || t("sceneRouting.loadingDisplays", "Looking for displays…")}
          </div>
        ) : (
          <>
            {displays.map((display) => {
              const selected = Boolean(selectedKey) && display.key === selectedKey;
              return (
                <label
                  key={display.key}
                  className={`dock-scene-routing-control__scene-row dock-scene-routing-control__display-row${selected ? " is-selected" : ""}${display.isComputerScreen ? " is-disabled" : ""}`}
                >
                  <input
                    type="radio"
                    name={name}
                    className="dock-scene-routing-control__check"
                    checked={selected}
                    disabled={display.isComputerScreen}
                    onChange={() => onPick(display)}
                  />
                  <span className="dock-scene-routing-control__display-name" title={dockDisplayLabel(display)}>
                    {display.name}
                  </span>
                  {selected && selectedExtra ? selectedExtra(display) : (
                    <span className="dock-scene-routing-control__display-meta">
                      {display.isComputerScreen
                        ? t("sceneRouting.thisComputer", "This computer")
                        : `${display.width}×${display.height}`}
                    </span>
                  )}
                </label>
              );
            })}
            {missingName && (
              <div className="dock-scene-routing-control__scene-row dock-scene-routing-control__display-row is-disabled">
                <input type="radio" className="dock-scene-routing-control__check" checked={false} disabled readOnly />
                <span className="dock-scene-routing-control__display-name">{missingName}</span>
                <span className="dock-scene-routing-control__display-meta">{t("sceneRouting.notConnected", "Not connected")}</span>
              </div>
            )}
          </>
        )}
      </div>
      <small className="dock-scene-routing-control__hint">
        {error && displays !== null
          ? error
          : onlyComputerScreen
            ? t("sceneRouting.onlyComputerScreen", "Only this computer's screen is connected. Plug in a projector or TV to use this.")
            : missingName
              ? t("sceneRouting.savedDisplayMissing", "{{name}} isn't connected. Nothing will be projected until it's plugged in or you pick another display.", { name: missingName })
              : hint}
      </small>
      {/* Always reachable from the dock, whatever happened to the screen. */}
      <button
        type="button"
        className="dock-btn dock-btn--ghost dock-btn--compact dock-display-list__close-all"
        disabled={closing}
        onClick={() => {
          setClosing(true);
          void closeAllDockProjectors().finally(() => setClosing(false));
        }}
        title={t("sceneRouting.closeAllProjectorsHint", "Closes every projector window on every screen.")}
      >
        <Icon name="tv_off" size={13} />
        <span>{closing ? t("sceneRouting.closingProjectors", "Closing…") : t("sceneRouting.closeAllProjectors", "Close all projectors")}</span>
      </button>
    </>
  );
}
