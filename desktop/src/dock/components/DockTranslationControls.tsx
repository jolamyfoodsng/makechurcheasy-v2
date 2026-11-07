import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isDockFeatureEnabled } from "../dockAdminControls";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import Icon from "../DockIcon";
import {
  getGoogleTranslateLanguage,
  GOOGLE_TRANSLATE_LANGUAGES,
  translateWithGoogleWeb,
  type GoogleTranslateLanguage,
} from "../../services/googleTranslateWeb";
import {
  getDockTranslationSourceSignature,
  normalizeDockTranslationOrder,
  type DockTranslationOrder,
} from "../dockTranslation";
import "./DockTranslationControls.css";

export type { DockTranslationOrder } from "../dockTranslation";
import { fitPopover } from "../useKeepInViewport";

export interface DockTranslationSection {
  id: string;
  text: string;
}

export interface DockTranslationValue {
  targetLanguage: string;
  targetLanguageLabel: string;
  translatedSections: Record<string, string>;
  showBoth: boolean;
  translationOrder: DockTranslationOrder;
  sourceSignature?: string;
}

interface Props {
  sections: DockTranslationSection[];
  value?: DockTranslationValue | null;
  onChange: (value: DockTranslationValue | null) => void;
  onClose?: () => void;
  compact?: boolean;
  compactLabel?: boolean;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}

export default function DockTranslationControls({
  sections,
  value,
  onChange,
  onClose,
  compact = false,
  compactLabel = false,
  isOpen: isOpenProp,
  onOpenChange,
  showTrigger = true,
}: Props) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const languageTriggerRef = useRef<HTMLButtonElement>(null);
  const languageMenuRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);
  const sourceSignature = useMemo(
    () => getDockTranslationSourceSignature(sections),
    [sections],
  );
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isOpenProp !== undefined ? isOpenProp : internalOpen;
  const setOpen = useCallback(
    (action: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof action === "function" ? action(open) : action;
      if (onOpenChange) {
        onOpenChange(next);
      }
      if (isOpenProp === undefined) {
        setInternalOpen(next);
      }
    },
    [open, isOpenProp, onOpenChange],
  );
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [languageQuery, setLanguageQuery] = useState("");
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [showBoth, setShowBoth] = useState(true);
  const [translationOrder, setTranslationOrder] = useState<DockTranslationOrder>("original-first");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [compactPanelPosition, setCompactPanelPosition] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const [compactLanguageMenuPosition, setCompactLanguageMenuPosition] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  useEffect(() => {
    // A source change invalidates an in-flight request, but it must not clear
    // the parent's completed translation. The owner of the source (Notes or
    // Worship) decides whether the current translation is still applicable.
    requestIdRef.current += 1;
    setLanguageMenuOpen(false);
    setLanguageQuery("");
    setTargetLanguage("en");
    setShowBoth(true);
    setTranslationOrder("original-first");
    setLoading(false);
    setError("");
  }, [sourceSignature]);

  useEffect(() => {
    if (!value) return;
    setTargetLanguage(value.targetLanguage || "en");
    setLanguageQuery(value.targetLanguageLabel || "");
    setShowBoth(value.showBoth !== false);
    setTranslationOrder(normalizeDockTranslationOrder(value.translationOrder));
  }, [value]);

  useLayoutEffect(() => {
    if (!compact || !open) {
      setCompactPanelPosition(null);
      setCompactLanguageMenuPosition(null);
      return;
    }

    const updatePanelPosition = () => {
      const trigger = triggerRef.current;
      const rect = trigger
        ? trigger.getBoundingClientRect()
        : {
            top: 64,
            left: Math.max(8, window.innerWidth - 308),
            right: window.innerWidth - 8,
            bottom: 96,
          };
      const viewportPadding = 8;
      const width = Math.min(300, Math.max(220, window.innerWidth - (viewportPadding * 2)));
      const left = Math.max(
        viewportPadding,
        Math.min(rect.right - width, window.innerWidth - width - viewportPadding),
      );
      const top = Math.min(
        rect.bottom + 6,
        Math.max(viewportPadding, window.innerHeight - 240),
      );
      const panelTop = top;
      setCompactPanelPosition({
        top,
        left,
        maxHeight: Math.max(96, window.innerHeight - panelTop - viewportPadding),
      });

      const languageTrigger = languageTriggerRef.current;
      if (!languageMenuOpen || !languageTrigger) {
        setCompactLanguageMenuPosition(null);
        return;
      }
      const languageRect = languageTrigger.getBoundingClientRect();
      const menuWidth = Math.min(300, Math.max(220, languageRect.width));
      const menuLeft = Math.max(
        viewportPadding,
        Math.min(languageRect.left, window.innerWidth - menuWidth - viewportPadding),
      );
      const spaceBelow = window.innerHeight - languageRect.bottom - viewportPadding;
      const spaceAbove = languageRect.top - viewportPadding;
      const openAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
      const maxHeight = Math.max(120, Math.min(300, openAbove ? spaceAbove - 6 : spaceBelow - 6));
      const menuTop = openAbove
        ? Math.max(viewportPadding, languageRect.top - maxHeight - 6)
        : languageRect.bottom + 6;
      setCompactLanguageMenuPosition({
        top: menuTop,
        left: menuLeft,
        width: menuWidth,
        maxHeight,
      });
    };

    updatePanelPosition();
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    return () => {
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [compact, languageMenuOpen, open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !languageMenuRef.current?.contains(target)) {
        setOpen(false);
        setLanguageMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const selectedLanguage = getGoogleTranslateLanguage(targetLanguage);
  const filteredLanguages = useMemo(() => {
    const query = languageQuery.trim().toLocaleLowerCase();
    if (!query) return GOOGLE_TRANSLATE_LANGUAGES;
    return GOOGLE_TRANSLATE_LANGUAGES.filter((language) =>
      language.label.toLocaleLowerCase().includes(query)
      || language.code.toLocaleLowerCase().includes(query),
    );
  }, [languageQuery]);

  const translateSections = useCallback(async (language: GoogleTranslateLanguage) => {
    const requestId = ++requestIdRef.current;
    const nonEmptySections = sections.filter((section) => section.text.trim());
    if (nonEmptySections.length === 0) return;

    setTargetLanguage(language.code);
    setLoading(true);
    setError("");
    try {
      if (!(await isDockFeatureEnabled("liveTranslation"))) {
        throw new Error("Live translation is paused for maintenance. Please try again later.");
      }
      const translatedEntries = await Promise.all(
        nonEmptySections.map(async (section) => [section.id, await translateWithGoogleWeb(section.text, language.code)] as const),
      );
      if (requestId !== requestIdRef.current) return;

      onChange({
        targetLanguage: language.code,
        targetLanguageLabel: language.label,
        translatedSections: Object.fromEntries(translatedEntries),
        showBoth,
        translationOrder,
        sourceSignature,
      });
      // Done: close the panel, like the other Dock pickers.
      setOpen(false);
      onClose?.();
    } catch (cause) {
      if (requestId !== requestIdRef.current) return;
      setError(cause instanceof Error ? cause.message : t("dock.translation.failed", { defaultValue: "Translation failed" }));
      onChange(null);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [onChange, onClose, sections, setOpen, showBoth, t, translationOrder, sourceSignature]);

  const handleLanguageSelect = (language: GoogleTranslateLanguage) => {
    setLanguageQuery(language.label);
    setLanguageMenuOpen(false);
    void translateSections(language);
  };

  const handleShowBothChange = (nextShowBoth: boolean) => {
    setShowBoth(nextShowBoth);
    if (value) {
      onChange({
        ...value,
        showBoth: nextShowBoth,
        translationOrder: normalizeDockTranslationOrder(value.translationOrder ?? translationOrder),
      });
    }
  };

  const handleTranslationOrderChange = (nextOrder: DockTranslationOrder) => {
    setTranslationOrder(nextOrder);
    if (value) onChange({ ...value, translationOrder: nextOrder });
  };

  const resetToOriginal = () => {
    requestIdRef.current += 1;
    setLoading(false);
    setError("");
    setLanguageMenuOpen(false);
    setLanguageQuery("");
    setTargetLanguage("en");
    setShowBoth(true);
    setTranslationOrder("original-first");
    onChange(null);
  };

  const languageMenu = (
    <div
      ref={(el) => { languageMenuRef.current = el; fitPopover(el); }}
      className={`dock-translation__language-menu${compact ? " dock-translation__language-menu--portal" : ""}`}
      data-dock-keep-overflow-open={compact ? "true" : undefined}
      style={compact && compactLanguageMenuPosition ? {
        position: "fixed",
        top: compactLanguageMenuPosition.top,
        left: compactLanguageMenuPosition.left,
        width: compactLanguageMenuPosition.width,
        maxHeight: compactLanguageMenuPosition.maxHeight,
        overflowY: "auto",
      } : undefined}
    >
      <div className="dock-translation__language-search">
        <Icon name="search" size={13} />
        <input
          value={languageQuery}
          onChange={(event) => setLanguageQuery(event.target.value)}
          placeholder={t("dock.translation.searchLanguages", { defaultValue: "Search languages" })}
          autoFocus
        />
      </div>
      <div className="dock-translation__language-list">
        {filteredLanguages.length === 0 ? (
          <div className="dock-translation__empty">{t("common.noResults", { defaultValue: "No results" })}</div>
        ) : filteredLanguages.map((language) => (
          <button
            type="button"
            key={language.code}
            className={`dock-translation__language-option${language.code === targetLanguage ? " dock-translation__language-option--active" : ""}`}
            onClick={() => handleLanguageSelect(language)}
          >
            <span>{language.label}</span>
            <span className="dock-translation__language-code">{language.code}</span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className={`dock-translation${compact ? " dock-translation--compact" : ""}${compactLabel ? " dock-translation--compact-label" : ""}`} ref={panelRef}>
      {showTrigger && (
        <div className="dock-translation__trigger-row">
          <button
            type="button"
            className={`dock-translation__trigger${open ? " dock-translation__trigger--active" : ""}`}
            ref={triggerRef}
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            aria-label={t("dock.translation.open", { defaultValue: "Translate this song" })}
            title={t("dock.translation.open", { defaultValue: "Translate this song" })}
          >
            <Icon name="translate" size={14} />
            <span className="dock-translation__trigger-label">{t("common.translate", { defaultValue: "Translate" })}</span>
            {value && <span className="dock-translation__status-dot" aria-label={value.targetLanguageLabel} />}
          </button>
          {value && (
            <span className="dock-translation__active-language">{value.targetLanguageLabel}</span>
          )}
        </div>
      )}

      {open && (
        <div
          className="dock-translation__panel"
          role="region"
          aria-label={t("common.translate", { defaultValue: "Translate" })}
          style={compact ? {
            top: compactPanelPosition?.top,
            left: compactPanelPosition?.left,
            maxHeight: compactPanelPosition?.maxHeight,
            visibility: compactPanelPosition ? "visible" : "hidden",
          } : undefined}
        >
          <div className="dock-translation__panel-head">
            <div>
              <div className="dock-translation__panel-title">{t("dock.translation.title", { defaultValue: "Translate text" })}</div>
              <div className="dock-translation__panel-subtitle">{t("dock.translation.subtitle", { defaultValue: "Choose a language for the selected song or note." })}</div>
            </div>
            <button
              type="button"
              className="dock-translation__close"
              onClick={() => {
                setOpen(false);
                onClose?.();
              }}
              aria-label={t("common.close", { defaultValue: "Close" })}
              title={t("common.close", { defaultValue: "Close" })}
            >
              <Icon name="close" size={13} />
            </button>
          </div>

          <div className="dock-translation__field-label">{t("dock.translation.language", { defaultValue: "Translate to" })}</div>
          <div className="dock-translation__language-picker">
            <button
              type="button"
              className="dock-translation__language-trigger"
              ref={languageTriggerRef}
              onClick={() => setLanguageMenuOpen((current) => {
                const next = !current;
                if (next) setLanguageQuery("");
                return next;
              })}
              aria-expanded={languageMenuOpen}
            >
              <Icon name="language" size={14} />
              <span>{selectedLanguage.label}</span>
              <Icon name={languageMenuOpen ? "expand_less" : "expand_more"} size={14} />
            </button>
            {languageMenuOpen && !compact && languageMenu}
          </div>

          {languageMenuOpen && compact && compactLanguageMenuPosition && createPortal(
            languageMenu,
            panelRef.current?.closest<HTMLElement>(".dock-root") ?? document.body,
          )}

          <label className="dock-translation__toggle">
            <input
              type="checkbox"
              checked={showBoth}
              onChange={(event) => handleShowBothChange(event.target.checked)}
            />
            <span>{t("dock.translation.showBoth", { defaultValue: "Show original and translation" })}</span>
          </label>

          {showBoth && (
            <label className="dock-translation__order">
              <span>{t("dock.translation.displayFirst", { defaultValue: "Display first" })}</span>
              <select
                value={translationOrder}
                onChange={(event) => handleTranslationOrderChange(event.target.value as DockTranslationOrder)}
                aria-label={t("dock.translation.displayFirst", { defaultValue: "Display first" })}
              >
                <option value="original-first">{t("dock.translation.originalFirst", { defaultValue: "Original text" })}</option>
                <option value="translation-first">{t("dock.translation.translationFirst", { defaultValue: "Translation" })}</option>
              </select>
            </label>
          )}

          <div className="dock-translation__actions">
            <button
              type="button"
              className="dock-btn dock-btn--primary dock-translation__action"
              onClick={() => void translateSections(selectedLanguage)}
              disabled={loading || sections.length === 0}
            >
              <Icon name={loading ? "sync" : "translate"} size={13} />
              {loading ? t("common.loading", { defaultValue: "Translating..." }) : t("common.translate", { defaultValue: "Translate" })}
            </button>
            <button
              type="button"
              className="dock-btn dock-btn--ghost dock-translation__action"
              onClick={resetToOriginal}
              disabled={!value && !loading}
            >
              <Icon name="restart_alt" size={13} />
              {t("dock.translation.reset", { defaultValue: "Reset to original" })}
            </button>
          </div>

          {error && <div className="dock-translation__error" role="alert">{error}</div>}
          {value && !loading && !error && (
            <div className="dock-translation__ready">
              <Icon name="check_circle" size={13} />
              {translationOrder === "translation-first"
                ? t("dock.translation.readyTranslationFirst", { defaultValue: "Translation is shown above the original." })
                : t("dock.translation.ready", { defaultValue: "Translation is shown below the original." })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
