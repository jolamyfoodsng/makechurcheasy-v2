import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BibleThemeSettings } from "../../bible/types";
import type { CompareThemeSettings } from "../compareThemeConfig";
import Icon from "../DockIcon";
import { parseTextShadow, buildTextShadow } from "./BackgroundPickerCard";

export type DockFullscreenQuickThemeSettings = Pick<
  BibleThemeSettings,
  | "fontSize"
  | "autoFontScale"
  | "fontFamily"
  | "refFontSize"
  | "refFontWeight"
  | "fontColor"
  | "refFontColor"
  | "refPosition"
  | "refAnchor"
  | "refTextTransform"
  | "refLetterSpacing"
  | "refOpacity"
  | "refTextAlign"
  | "refSpacing"
  | "fullscreenShadeColor"
  | "fullscreenShadeOpacity"
  | "textAlign"
  | "lineHeight"
  | "letterSpacing"
  | "wordSpacing"
  | "fontWeight"
  | "fontStyle"
  | "textTransform"
  | "textShadow"
  | "textOutline"
  | "textOutlineColor"
  | "textOutlineWidth"
  | "animation"
  | "animationDuration"
  | "backgroundImage"
  | "backgroundImageFilePath"
  | "backgroundPattern"
  | "backgroundVideo"
  | "backgroundVideoFilePath"
  | "backgroundOpacity"
  | "backgroundColor"
  | "backgroundColorEnd"
  | "bgGradientAngle"
  | "referenceBackgroundEnabled"
  | "referenceBackgroundColor"
  | "referenceBackgroundStyle"
  | "referenceBackgroundRadius"
  // Lower-third positioning & card styling
  | "lowerThirdPosition"
  | "lowerThirdSize"
  | "lowerThirdWidthPreset"
  | "lowerThirdOffsetX"
  | "lowerThirdCaptionPosition"
  | "lowerThirdEdge"
  | "lowerThirdCardPadding"
  | "lowerThirdBarMaxHeight"
  | "lowerThirdPaddingLinked"
  | "lowerThirdCardRadius"
  | "lowerThirdTextDirection"
  // Compare Translation layout
  | "compareTranslationWidth"
  | "compareTranslationGap"
> & Partial<
  Pick<
    BibleThemeSettings,
    | "boxBackground"
    | "boxBackgroundImage"
    | "boxOpacity"
    | "borderRadius"
    | "padding"
    | "safeArea"
    | "layoutTextScale"
    | "layoutRefScale"
    | "layoutLineHeight"
    | "layoutShowTitle"
    | "layoutBold"
    | "layoutItalic"
    | "layoutOffsetY"
    | "layoutBackdropDarkness"
  >
> & Partial<CompareThemeSettings> & {
  /** Dock-only: persisted background mode (off/theme/color/image/pattern/video) */
  backgroundType?: "off" | "theme" | "color" | "image" | "pattern" | "video";
};

interface Props {
  settings: DockFullscreenQuickThemeSettings;
  onChange: (settings: DockFullscreenQuickThemeSettings) => void;
  onReset: () => void;
  onSaveDefault: () => void | Promise<void>;
  title?: string;
  subtitle?: string;
  showBackgroundControls?: boolean;
}

type ThemePreset = {
  id: string;
  label: string;
  settings: DockFullscreenQuickThemeSettings;
};

const PRESETS: ThemePreset[] = [
  {
    id: "faith",
    label: "Faith",
    settings: {
      fontSize: 58,
      fontFamily: "'Georgia', serif",
      refFontSize: 40,
      refFontWeight: "bold",
      fontColor: "#FFF8E0",
      refFontColor: "#FFF8E0",
      refPosition: "bottom",
      refTextTransform: "none",
      refLetterSpacing: 0,
      refOpacity: 1,
      refTextAlign: "match",
      refSpacing: 24,
      fullscreenShadeColor: "#1A2244",
      fullscreenShadeOpacity: 0.52,
      textAlign: "center",
      lineHeight: 1.34,
      fontWeight: "bold",
      textTransform: "none",
      textShadow: "0 2px 8px rgba(0,0,0,0.6)",
      animation: "fade",
      animationDuration: 400,
      backgroundImage: "",
      backgroundImageFilePath: "",
      backgroundPattern: "",
      backgroundVideo: "",
      backgroundVideoFilePath: "",
      backgroundOpacity: 1,
      backgroundColor: "#0B1426",
      backgroundColorEnd: "#162040",
      bgGradientAngle: 180,
      referenceBackgroundEnabled: false,
      referenceBackgroundColor: "#F4D17B",
      referenceBackgroundStyle: "solid",
      referenceBackgroundRadius: 12,
      lowerThirdPosition: "center",
      lowerThirdSize: "medium",
      lowerThirdWidthPreset: "full",
      lowerThirdOffsetX: 0,
      lowerThirdCaptionPosition: "bottom",
      lowerThirdEdge: "bottom",
      lowerThirdCardPadding: "18px 28px",
      lowerThirdPaddingLinked: false,
      lowerThirdCardRadius: 18,
      lowerThirdTextDirection: "normal",
      compareTranslationWidth: 40,
      compareTranslationGap: 40,
    },
  },
  {
    id: "minimal",
    label: "Minimal",
    settings: {
      fontSize: 48,
      fontFamily: "'Inter', system-ui, sans-serif",
      refFontSize: 34,
      refFontWeight: "bold",
      fontColor: "#F8FAFC",
      refFontColor: "#F8FAFC",
      refPosition: "bottom",
      refTextTransform: "none",
      refLetterSpacing: 0,
      refOpacity: 1,
      refTextAlign: "match",
      refSpacing: 24,
      fullscreenShadeColor: "#0F172A",
      fullscreenShadeOpacity: 0.36,
      textAlign: "center",
      lineHeight: 1.48,
      fontWeight: "bold",
      textTransform: "none",
      textShadow: "none",
      animation: "none",
      animationDuration: 300,
      backgroundImage: "",
      backgroundImageFilePath: "",
      backgroundPattern: "",
      backgroundVideo: "",
      backgroundVideoFilePath: "",
      backgroundOpacity: 1,
      backgroundColor: "#0F172A",
      backgroundColorEnd: "#1E293B",
      bgGradientAngle: 180,
      referenceBackgroundEnabled: false,
      referenceBackgroundColor: "#CBD5E1",
      referenceBackgroundStyle: "solid",
      referenceBackgroundRadius: 12,
      lowerThirdPosition: "center",
      lowerThirdSize: "medium",
      lowerThirdWidthPreset: "full",
      lowerThirdOffsetX: 0,
      lowerThirdCaptionPosition: "bottom",
      lowerThirdEdge: "bottom",
      lowerThirdCardPadding: "18px 28px",
      lowerThirdPaddingLinked: false,
      lowerThirdCardRadius: 18,
      lowerThirdTextDirection: "normal",
      compareTranslationWidth: 40,
      compareTranslationGap: 40,
    },
  },
  {
    id: "bold",
    label: "Bold",
    settings: {
      fontSize: 68,
      fontFamily: "'Impact', 'Arial Black', sans-serif",
      refFontSize: 46,
      refFontWeight: "bold",
      fontColor: "#FFFFFF",
      refFontColor: "#B9CCFF",
      refPosition: "bottom",
      refTextTransform: "none",
      refLetterSpacing: 0,
      refOpacity: 1,
      refTextAlign: "match",
      refSpacing: 24,
      fullscreenShadeColor: "#050816",
      fullscreenShadeOpacity: 0.66,
      textAlign: "center",
      lineHeight: 1.22,
      fontWeight: "bold",
      textTransform: "uppercase",
      textShadow: "0 2px 8px rgba(0,0,0,0.6)",
      animation: "fade",
      animationDuration: 400,
      backgroundImage: "",
      backgroundImageFilePath: "",
      backgroundPattern: "",
      backgroundVideo: "",
      backgroundVideoFilePath: "",
      backgroundOpacity: 1,
      backgroundColor: "#050816",
      backgroundColorEnd: "#0C1633",
      bgGradientAngle: 180,
      referenceBackgroundEnabled: true,
      referenceBackgroundColor: "#B9CCFF",
      referenceBackgroundStyle: "pill",
      referenceBackgroundRadius: 20,
      lowerThirdPosition: "center",
      lowerThirdSize: "medium",
      lowerThirdWidthPreset: "full",
      lowerThirdOffsetX: 0,
      lowerThirdCaptionPosition: "bottom",
      lowerThirdEdge: "bottom",
      lowerThirdCardPadding: "18px 28px",
      lowerThirdPaddingLinked: false,
      lowerThirdCardRadius: 18,
      lowerThirdTextDirection: "normal",
      compareTranslationWidth: 40,
      compareTranslationGap: 40,
    },
  },
  {
    id: "high-contrast",
    label: "High Contrast",
    settings: {
      fontSize: 56,
      fontFamily: "'Inter', system-ui, sans-serif",
      refFontSize: 38,
      refFontWeight: "bold",
      fontColor: "#FFFFFF",
      refFontColor: "#FDE68A",
      refPosition: "bottom",
      refTextTransform: "none",
      refLetterSpacing: 0,
      refOpacity: 1,
      refTextAlign: "match",
      refSpacing: 24,
      fullscreenShadeColor: "#000000",
      fullscreenShadeOpacity: 0.78,
      textAlign: "center",
      lineHeight: 1.32,
      fontWeight: "bold",
      textTransform: "uppercase",
      textShadow: "0 2px 8px rgba(0,0,0,0.6)",
      animation: "fade",
      animationDuration: 400,
      backgroundImage: "",
      backgroundImageFilePath: "",
      backgroundPattern: "",
      backgroundVideo: "",
      backgroundVideoFilePath: "",
      backgroundOpacity: 1,
      backgroundColor: "#000000",
      backgroundColorEnd: "#0F172A",
      bgGradientAngle: 180,
      referenceBackgroundEnabled: true,
      referenceBackgroundColor: "#FDE68A",
      referenceBackgroundStyle: "outline",
      referenceBackgroundRadius: 4,
      lowerThirdPosition: "center",
      lowerThirdSize: "medium",
      lowerThirdWidthPreset: "full",
      lowerThirdOffsetX: 0,
      lowerThirdCaptionPosition: "bottom",
      lowerThirdEdge: "bottom",
      lowerThirdCardPadding: "18px 28px",
      lowerThirdPaddingLinked: false,
      lowerThirdCardRadius: 18,
      lowerThirdTextDirection: "normal",
      compareTranslationWidth: 40,
      compareTranslationGap: 40,
    },
  },
  {
    id: "easyworship",
    label: "Bold Contour",
    settings: {
      fontSize: 76,
      fontFamily: '"CMG Sans Black", "CMG Sans", sans-serif',
      refFontSize: 52,
      refFontWeight: "black",
      fontColor: "#FFFFFF",
      refFontColor: "#FFFFFF",
      refPosition: "top",
      refTextTransform: "none",
      refLetterSpacing: 0,
      refOpacity: 1,
      refTextAlign: "center",
      refSpacing: 20,
      fullscreenShadeColor: "#050816",
      fullscreenShadeOpacity: 0.65,
      textAlign: "center",
      lineHeight: 1.24,
      fontWeight: "black",
      textTransform: "none",
      textShadow: "3px 3px 0 #000000, -2px -2px 0 #000000, 2px -2px 0 #000000, -2px 2px 0 #000000, 4px 6px 12px rgba(0,0,0,1)",
      textOutline: true,
      textOutlineColor: "#000000",
      textOutlineWidth: 4,
      animation: "fade",
      animationDuration: 300,
      backgroundImage: "",
      backgroundImageFilePath: "",
      backgroundPattern: "",
      backgroundVideo: "",
      backgroundVideoFilePath: "",
      backgroundOpacity: 1,
      backgroundColor: "#050816",
      backgroundColorEnd: "#1a1236",
      bgGradientAngle: 180,
      referenceBackgroundEnabled: false,
      referenceBackgroundColor: "#FFD700",
      referenceBackgroundStyle: "solid",
      referenceBackgroundRadius: 12,
      lowerThirdPosition: "center",
      lowerThirdSize: "medium",
      lowerThirdWidthPreset: "full",
      lowerThirdOffsetX: 0,
      lowerThirdCaptionPosition: "bottom",
      lowerThirdEdge: "bottom",
      lowerThirdCardPadding: "18px 28px",
      lowerThirdPaddingLinked: false,
      lowerThirdCardRadius: 18,
      lowerThirdTextDirection: "normal",
      compareTranslationWidth: 40,
      compareTranslationGap: 40,
    },
  },
];

export const QUICK_TEXT_SHADOW_PRESETS = [
  { id: "broadcast", label: "Broadcast", value: "4px 5px 2px rgba(0, 0, 0, 0.95)" },
  { id: "none", label: "None", value: "none" },
  { id: "soft", label: "Soft", value: "0 2px 6px rgba(0,0,0,0.45), 0 1px 2px rgba(0,0,0,0.3)" },
  { id: "bold", label: "Bold", value: "0 3px 8px rgba(0,0,0,0.6), 0 1px 3px rgba(0,0,0,0.45)" },
  { id: "easyworship", label: "Solid Contour", value: "0 2px 8px rgba(0,0,0,0.7), 0 1px 2px rgba(0,0,0,0.5)" },
  { id: "glow", label: "Glow", value: "0 0 8px rgba(0,0,0,0.6), 0 0 16px rgba(0,0,0,0.4)" },
] as const;

export const QUICK_TEXT_OUTLINE_PRESETS = [
  { id: "none", label: "Off", width: 0, enabled: false },
  { id: "1px", label: "1px", width: 1, enabled: true },
  { id: "2px", label: "2px", width: 2, enabled: true },
  { id: "3px", label: "3px", width: 3, enabled: true },
  { id: "4px", label: "4px", width: 4, enabled: true },
  { id: "6px", label: "6px", width: 6, enabled: true },
  { id: "8px", label: "8px", width: 8, enabled: true },
  { id: "10px", label: "10px", width: 10, enabled: true },
  { id: "12px", label: "12px", width: 12, enabled: true },
] as const;

function formatPx(value: number): string {
  return `${Math.round(value)}px`;
}

function formatOpacity(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatLineHeight(value: number): string {
  return `${value.toFixed(2)}x`;
}

function withPatch(
  current: DockFullscreenQuickThemeSettings,
  patch: Partial<DockFullscreenQuickThemeSettings>,
): DockFullscreenQuickThemeSettings {
  return {
    ...current,
    ...patch,
  };
}

export default function DockFullscreenThemeQuickSettings({
  settings,
  onChange,
  onReset,
  onSaveDefault,
  title,
  subtitle,
  showBackgroundControls = true,
}: Props) {
  const { t } = useTranslation();
  const resolvedTitle = title ?? t("dock.fullscreenThemeQuickSettings.quickThemeSettings");
  const resolvedSubtitle = subtitle ?? t("dock.fullscreenThemeQuickSettings.subtitle");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const handlePreset = (preset: ThemePreset) => {
    onChange(withPatch(settings, preset.settings));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await onSaveDefault();
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`dock-theme-quick${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="dock-theme-quick__trigger"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={t("dock.fullscreenThemeQuickSettings.quickThemeSettings")}
      >
        <Icon name="edit" size={10} />
      </button>

      {open && (
        <div
          className="dock-theme-quick__backdrop"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="dock-theme-quick__modal"
            role="dialog"
            aria-label={t("dock.fullscreenThemeQuickSettings.quickThemeSettings")}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dock-theme-quick__modal-head">
              <div>
                <div className="dock-theme-quick__heading">{resolvedTitle}</div>
                <div className="dock-theme-quick__sub">{resolvedSubtitle}</div>
              </div>
              <button
                type="button"
                className="dock-theme-quick__close"
                onClick={() => setOpen(false)}
                aria-label={t("dock.fullscreenThemeQuickSettings.closeQuickThemeSettings")}
                title={t("common.close")}
              >
                <Icon name="close" size={14} />
              </button>
            </div>

            <div className="dock-theme-quick__body">
              <div className="dock-theme-quick__section">
                <label className="dock-theme-quick__field">
                  <span className="dock-theme-quick__field-head">
                    <span>{t("dock.fullscreenThemeQuickSettings.mainTextSize")}</span>
                    <span>{formatPx(settings.fontSize)}</span>
                  </span>
                  <input
                    className="dock-theme-quick__range"
                    type="range"
                    min={28}
                    max={200}
                    step={1}
                    value={settings.fontSize}
                    onChange={(event) =>
                      onChange(withPatch(settings, { fontSize: Number(event.target.value) }))
                    }
                  />
                </label>

                <div className="dock-theme-quick__split-row">
                  <div className="dock-theme-quick__section">
                    <div className="dock-theme-quick__section-label">{t("dock.fullscreenThemeQuickSettings.weight")}</div>
                    <div className="dock-console-segmented dock-console-segmented--compact">
                      {(["normal", "bold", "extrabold"] as const).map((weight) => (
                        <button
                          key={weight}
                          type="button"
                          className={`dock-console-segmented__item${settings.fontWeight === weight ? " dock-console-segmented__item--active" : ""}`}
                          onClick={() => onChange(withPatch(settings, { fontWeight: weight }))}
                          title={weight === "normal" ? t("dock.fullscreenThemeQuickSettings.normal") : weight === "extrabold" ? t("bgPicker.extraBold", "Extra Bold") : t("dock.fullscreenThemeQuickSettings.bold")}>
                          {weight === "normal" ? t("dock.fullscreenThemeQuickSettings.normal") : weight === "extrabold" ? t("bgPicker.extraBold", "Extra Bold") : t("dock.fullscreenThemeQuickSettings.bold")}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="dock-theme-quick__section">
                    <div className="dock-theme-quick__section-label">{t("dock.fullscreenThemeQuickSettings.case")}</div>
                    <div className="dock-console-segmented dock-console-segmented--compact dock-theme-quick__segmented-wrap">
                      {([
                        ["none", "Aa"],
                        ["uppercase", "AA"],
                        ["lowercase", "aa"],
                        ["capitalize", "Ab"],
                      ] as const).map(([transform, label]) => (
                        <button
                          key={transform}
                          type="button"
                          className={`dock-console-segmented__item${settings.textTransform === transform ? " dock-console-segmented__item--active" : ""}`}
                          onClick={() => onChange(withPatch(settings, { textTransform: transform }))}
                          title={transform}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="dock-theme-quick__section">
                <label className="dock-theme-quick__field">
                  <span className="dock-theme-quick__field-head">
                    <span>{t("dock.fullscreenThemeQuickSettings.fontFamily")}</span>
                  </span>
                  <select
                    className="dock-theme-quick__select"
                    value={settings.fontFamily ?? "Inter, system-ui, sans-serif"}
                    onChange={(event) => onChange(withPatch(settings, { fontFamily: event.target.value }))}
                  >
                    <option value='"CMG Sans Black", "CMG Sans", sans-serif'>CMG Sans (Bold Presentation)</option>
                    <option value="Inter, system-ui, sans-serif">Inter</option>
                    <option value="'Georgia', serif">Georgia</option>
                    <option value="'Playfair Display', serif">Playfair Display</option>
                    <option value="'Merriweather', serif">Merriweather</option>
                    <option value="'Lora', serif">Lora</option>
                    <option value="'Open Sans', sans-serif">Open Sans</option>
                    <option value="'Roboto', sans-serif">Roboto</option>
                    <option value="'Impact', 'Arial Black', sans-serif">Impact</option>
                    <option value="'Courier New', monospace">Courier New</option>
                    <option value="system-ui, sans-serif">{t("dock.fullscreenThemeQuickSettings.systemDefault")}</option>
                  </select>
                </label>
              </div>

              <div className="dock-theme-quick__section">
                <label className="dock-theme-quick__field">
                  <span className="dock-theme-quick__field-head">
                    <span>{t("dock.fullscreenThemeQuickSettings.refSize")}</span>
                    <span>{formatPx(settings.refFontSize)}</span>
                  </span>
                  <input
                    className="dock-theme-quick__range"
                    type="range"
                    min={12}
                    max={80}
                    step={1}
                    value={settings.refFontSize}
                    onChange={(event) =>
                      onChange(withPatch(settings, { refFontSize: Number(event.target.value) }))
                    }
                  />
                </label>
              </div>

              <div className="dock-theme-quick__section">
                <div className="dock-theme-quick__color-grid">
                  <label className="dock-theme-quick__color-field">
                    <span>{t("dock.fullscreenThemeQuickSettings.mainText")}</span>
                    <span className="dock-theme-quick__color-input-wrap">
                      <input
                        className="dock-theme-quick__color-input"
                        type="color"
                        value={settings.fontColor}
                        onChange={(event) =>
                          onChange(withPatch(settings, { fontColor: event.target.value }))
                        }
                      />
                      <span>{settings.fontColor.toUpperCase()}</span>
                    </span>
                  </label>

                  <label className="dock-theme-quick__color-field">
                    <span>{t("dock.fullscreenThemeQuickSettings.reference")}</span>
                    <span className="dock-theme-quick__color-input-wrap">
                      <input
                        className="dock-theme-quick__color-input"
                        type="color"
                        value={settings.refFontColor}
                        onChange={(event) =>
                          onChange(withPatch(settings, { refFontColor: event.target.value }))
                        }
                      />
                      <span>{settings.refFontColor.toUpperCase()}</span>
                    </span>
                  </label>

                  {showBackgroundControls && (
                    <label className="dock-theme-quick__color-field">
                      <span>{t("dock.fullscreenThemeQuickSettings.background")}</span>
                      <span className="dock-theme-quick__color-input-wrap">
                        <input
                          className="dock-theme-quick__color-input"
                          type="color"
                          value={settings.fullscreenShadeColor}
                          onChange={(event) =>
                            onChange(
                              withPatch(settings, {
                                fullscreenShadeColor: event.target.value,
                              }),
                            )
                          }
                        />
                        <span>{settings.fullscreenShadeColor.toUpperCase()}</span>
                      </span>
                    </label>
                  )}
                </div>
              </div>

              {showBackgroundControls && (
                <div className="dock-theme-quick__section">
                  <label className="dock-theme-quick__field">
                    <span className="dock-theme-quick__field-head">
                      <span>{t("dock.fullscreenThemeQuickSettings.backgroundOpacity")}</span>
                      <span>{formatOpacity(settings.fullscreenShadeOpacity)}</span>
                    </span>
                    <input
                      className="dock-theme-quick__range"
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round(settings.fullscreenShadeOpacity * 100)}
                      onChange={(event) =>
                        onChange(
                          withPatch(settings, {
                            fullscreenShadeOpacity: Number(event.target.value) / 100,
                          }),
                        )
                      }
                    />
                  </label>
                </div>
              )}

              <div className="dock-theme-quick__split-row">
                <div className="dock-theme-quick__section">
                  <div className="dock-theme-quick__section-label">{t("dock.fullscreenThemeQuickSettings.textAlignment")}</div>
                  <div className="dock-console-segmented dock-console-segmented--compact">
                    {(["left", "center", "right"] as const).map((align) => (
                      <button
                        key={align}
                        type="button"
                        className={`dock-console-segmented__item${settings.textAlign === align ? " dock-console-segmented__item--active" : ""}`}
                        onClick={() => onChange(withPatch(settings, { textAlign: align }))}
                        title={t(`common.${align}`)}>
                        {t(`common.${align}`)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="dock-theme-quick__section">
                  <label className="dock-theme-quick__field">
                    <span className="dock-theme-quick__field-head">
                      <span>{t("dock.fullscreenThemeQuickSettings.lineHeight")}</span>
                      <span>{formatLineHeight(settings.lineHeight)}</span>
                    </span>
                    <input
                      className="dock-theme-quick__range"
                      type="range"
                      min={1.05}
                      max={1.8}
                      step={0.05}
                      value={settings.lineHeight}
                      onChange={(event) =>
                        onChange(withPatch(settings, { lineHeight: Number(event.target.value) }))
                      }
                    />
                  </label>
                </div>
              </div>

              {/* Text Shadow */}
              <div className="dock-theme-quick__section">
                <div className="dock-theme-quick__section-label">{t("worship.textShadow", "Text Shadow")}</div>
                <div className="dock-console-segmented dock-console-segmented--compact dock-theme-quick__segmented-wrap">
                  {QUICK_TEXT_SHADOW_PRESETS.map((p) => {
                    const isActive = (settings.textShadow ?? "none") === p.value;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`dock-console-segmented__item${isActive ? " dock-console-segmented__item--active" : ""}`}
                        onClick={() => onChange(withPatch(settings, { textShadow: p.value }))}
                        title={p.label}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
                {(() => {
                  const shadow = parseTextShadow(settings.textShadow);
                  return (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginTop: "8px" }}>
                      <label className="dock-theme-quick__field">
                        <span className="dock-theme-quick__field-head">
                          <span>{t("bgPicker.shadowDistance", "Distance")}</span>
                          <span>{formatPx(shadow.distance)}</span>
                        </span>
                        <input
                          className="dock-theme-quick__range"
                          type="range"
                          min={0}
                          max={15}
                          step={1}
                          value={shadow.distance}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            onChange(withPatch(settings, { textShadow: buildTextShadow(val, shadow.blur, shadow.opacity) }));
                          }}
                        />
                      </label>
                      <label className="dock-theme-quick__field">
                        <span className="dock-theme-quick__field-head">
                          <span>{t("bgPicker.shadowBlur", "Blur")}</span>
                          <span>{formatPx(shadow.blur)}</span>
                        </span>
                        <input
                          className="dock-theme-quick__range"
                          type="range"
                          min={0}
                          max={15}
                          step={1}
                          value={shadow.blur}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            onChange(withPatch(settings, { textShadow: buildTextShadow(shadow.distance, val, shadow.opacity) }));
                          }}
                        />
                      </label>
                      <label className="dock-theme-quick__field">
                        <span className="dock-theme-quick__field-head">
                          <span>{t("bgPicker.shadowOpacity", "Opacity")}</span>
                          <span>{shadow.opacity}%</span>
                        </span>
                        <input
                          className="dock-theme-quick__range"
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={shadow.opacity}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            onChange(withPatch(settings, { textShadow: buildTextShadow(shadow.distance, shadow.blur, val) }));
                          }}
                        />
                      </label>
                    </div>
                  );
                })()}
              </div>

              {/* Text Outline / Stroke */}
              <div className="dock-theme-quick__section">
                <div className="dock-theme-quick__section-label">{t("bible.themeEditor.textOutline", "Text Outline (Stroke)")}</div>
                <div className="dock-theme-quick__split-row">
                  <div className="dock-console-segmented dock-console-segmented--compact">
                    {QUICK_TEXT_OUTLINE_PRESETS.map((p) => {
                      const currentWidth = settings.textOutline ? (settings.textOutlineWidth ?? 2) : 0;
                      const isActive = p.width === 0 ? !settings.textOutline : (settings.textOutline && currentWidth === p.width);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className={`dock-console-segmented__item${isActive ? " dock-console-segmented__item--active" : ""}`}
                          onClick={() => onChange(withPatch(settings, {
                            textOutline: p.enabled,
                            textOutlineWidth: p.width,
                            textOutlineColor: settings.textOutlineColor || "#000000",
                          }))}
                          title={p.label}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                  {settings.textOutline && (
                    <label className="dock-theme-quick__color-field" style={{ minWidth: 100 }}>
                      <span className="dock-theme-quick__color-input-wrap">
                        <input
                          className="dock-theme-quick__color-input"
                          type="color"
                          value={settings.textOutlineColor || "#000000"}
                          onChange={(event) =>
                            onChange(withPatch(settings, { textOutlineColor: event.target.value }))
                          }
                        />
                        <span>{(settings.textOutlineColor || "#000000").toUpperCase()}</span>
                      </span>
                    </label>
                  )}
                </div>
                <label className="dock-theme-quick__field" style={{ marginTop: "8px" }}>
                  <span className="dock-theme-quick__field-head">
                    <span>{t("bible.themeEditor.outlineWidth", "Outline Width")}</span>
                    <span>{formatPx(settings.textOutline ? (settings.textOutlineWidth ?? 4) : 0)}</span>
                  </span>
                  <input
                    className="dock-theme-quick__range"
                    type="range"
                    min={0}
                    max={12}
                    step={1}
                    value={settings.textOutline ? (settings.textOutlineWidth ?? 4) : 0}
                    onChange={(event) => {
                      const val = Number(event.target.value);
                      if (val <= 0) {
                        onChange(withPatch(settings, { textOutline: false, textOutlineWidth: 0 }));
                      } else {
                        onChange(withPatch(settings, {
                          textOutline: true,
                          textOutlineWidth: val,
                          textOutlineColor: settings.textOutlineColor || "#000000",
                        }));
                      }
                    }}
                  />
                </label>
              </div>

              <div className="dock-theme-quick__section">
                <div className="dock-theme-quick__section-label">{t("dock.fullscreenThemeQuickSettings.presets")}</div>
                <div className="dock-theme-quick__preset-grid">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="dock-theme-quick__preset"
                      onClick={() => handlePreset(preset)}
                    >
                      {t(`dock.fullscreenThemeQuickSettings.preset${preset.id.split("-").map(s => s.charAt(0).toUpperCase() + s.slice(1)).join("")}`)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="dock-theme-quick__actions">
              <button
                type="button"
                className="dock-btn dock-btn--ghost dock-btn--compact dock-theme-quick__action"
                onClick={onReset}
                title={t("common.reset")}>
                {t("dock.fullscreenThemeQuickSettings.resetToDefault")}
              </button>
              <button
                type="button"
                className="dock-btn dock-btn--preview dock-btn--compact dock-theme-quick__action"
                onClick={() => void handleSave()}
                disabled={saving}
                title={t("dock.fullscreenThemeQuickSettings.saving")}>
                {saving ? t("dock.fullscreenThemeQuickSettings.saving") : t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
