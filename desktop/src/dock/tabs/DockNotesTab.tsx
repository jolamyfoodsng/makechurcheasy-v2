import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { DockStagedItem } from "../dockTypes";
import type { DockPresentationOutputTarget } from "../dockPresentationTarget";
import { isPresentationLinkTarget } from "../dockPresentationTarget";
import type { DockSearchPlacement } from "../dockSearchPlacement";
import {
  dockObsClient,
  type DockOverlayFitOptions,
  type DockTabContentPushData,
} from "../dockObsClient";
import { ensureObsConnected } from "../obsConnectionGuard";
import { LOWER_THIRD_SIZE_PRESETS, type BibleTheme } from "../../bible/types";
import type { DockProductionModuleSettings } from "../../services/productionSettings";
import {
  calculateReorderTargetIndex,
  extractStructuredTextTitle,
  parseWorshipSectionLabelLine,
  stripLeadingVerseMarker,
} from "../../worship/slideEngine";
import { extractFirstLineAsTitle } from "../../worship/songTitleFromLyrics";
import { nextAutoNoteTitle, isDummyTitle } from "../../worship/songTitleAutoGen";
import type { DockFullscreenQuickThemeSettings } from "../components/DockFullscreenThemeQuickSettings";
import Icon from "../DockIcon";
import DockBottomToolbar from "../components/DockBottomToolbar";
import DockBottomSearchPanel from "../components/DockBottomSearchPanel";
import DockSceneRoutingControl from "../components/DockSceneRoutingControl";
import DockSceneRouteConfirmDialog from "../components/DockSceneRouteConfirmDialog";
import DockThemeSettingsModal from "../components/DockThemeSettingsModal";
import {
  DOCK_THEME_SYNC_EVENT,
  type DockThemeSyncPayload,
} from "../dockThemeSync";
import DockTranslationControls, {
  type DockTranslationValue,
} from "../components/DockTranslationControls";
import DockAutoAdvanceControl from "../components/DockAutoAdvanceControl";
import { useDockTabLabelMode } from "../useDockTabLabelMode";
import DockOutputQuickActions, {
  DEFAULT_DOCK_OUTPUT_QUICK_ACTIONS_TOP,
  type DockOutputLineMode,
  type DockOutputQuickSettingsPatch,
  type DockOutputQuickTextSettings,
} from "../components/DockOutputQuickActions";
import {
  DOCK_QUICK_SIZE_OPTIONS_FULLSCREEN,
  DOCK_QUICK_SIZE_OPTIONS_LOWER_THIRD,
} from "../dockQuickSizePresets";
import { layerThemeQuickDisplay, withLayerThemeQuickPatch } from "../layerThemeQuickPatch";
import DockNotesTextTools from "../components/DockNotesTextTools";
import { fuzzyFilter, fuzzyMatch } from "../../services/fuzzySearch";
import DockSpellcheckTextarea from "../components/DockSpellcheckTextarea";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useTextUndoRedo } from "../useTextUndoRedo";
import {
  LOWER_THIRD_FIT_MIN_FONT_SIZE,
  LOWER_THIRD_FIT_MIN_REFERENCE_FONT_SIZE,
  LOWER_THIRD_REFERENCE_FONT_SIZE_MAX,
  normalizeExplicitOutputFontSettings,
} from "../lowerThirdQuickSettings";
import { trackOverlayModeSwitched } from "../../services/tracking";
import {
  DOCK_THEMES_REFRESHED_EVENT,
  findRefreshedTheme,
  themeUsesLayout,
  type DockThemesRefreshedDetail,
} from "../dockThemeRefresh";
import {
  getDockTranslationSourceSignature,
  getOrderedTranslationParts,
  normalizeDockTranslationOrder,
} from "../dockTranslation";
import {
  DOCK_NOTES_KEY,
  DOCK_NOTES_BROADCAST_CHANNEL,
  DOCK_NOTES_UPDATED_EVENT,
  appendTextToDockNotes,
  applyQuickSettingsToNotesTheme,
  getDockNotesThemeForMode,
  getFallbackDockNotesTheme,
  loadDockNotes,
  loadDockNotesFromDockData,
  loadDockNotesPreferences,
  resolveDockNotesTheme,
  saveDockNotes,
  saveDockNotesPreferences,
  type DockNote,
  type DockNotesPreferences,
  type DockNotesOverlayMode,
} from "../dockNotesStorage";
import { getUserScopedKey } from "../../services/userScopedStorage";
import { readNativeDockSetting, writeNativeDockSetting } from "../../services/localDockSettings";
import {
  loadDockNotesAppendCommands,
  type DockNotesAppendCommand,
} from "../../services/dockNotesInterop";
import { getRecommendedPollingInterval } from "../../services/performanceManager";
import { dockClient } from "../../services/dockBridge";
import {
  formatNoteText,
  type NoteTextToolAction,
} from "../noteTextTools";
import { paginateNoteSections, preserveNoteSections, splitNoteBodyIntoSections } from "../noteSlideParser";
import { normalizeDockMultilineText } from "../textLineBreaks";
import { useDockSceneRoute } from "../dockSceneRouting";
import {
  addNoteToActiveSchedule,
  addWholeNoteToActiveSchedule,
  DOCK_SELECT_NOTE_EVENT,
  getPendingNoteSelection,
  setPendingNoteSelection,
} from "../dockScheduleService";

interface Props {
  staged: DockStagedItem | null;
  onStage: (item: DockStagedItem | null) => void;
  isActive?: boolean;
  presentationOutputTarget?: DockPresentationOutputTarget;
  searchPlacement?: DockSearchPlacement;
  /** Notes themes picked on the app's Themes page ("Use theme" with Notes ticked). */
  productionDefaults?: DockProductionModuleSettings;
}

type OverlayMode = DockNotesOverlayMode;

const MIN_NOTE_LINES_PER_SLIDE = 1;
const MAX_NOTE_LINES_PER_SLIDE = 8;
const DEFAULT_NOTE_LINES_PER_SLIDE = 4;

function clampNoteLinesPerSlide(value?: number): number {
  if (!value || Number.isNaN(value)) return DEFAULT_NOTE_LINES_PER_SLIDE;
  return Math.min(MAX_NOTE_LINES_PER_SLIDE, Math.max(MIN_NOTE_LINES_PER_SLIDE, Math.trunc(value)));
}

function readQuickActionsLeft(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getNoteDisplayTitle(note: DockNote): string {
  return extractStructuredTextTitle(normalizeDockMultilineText(note.content)).title || note.title;
}

interface DockNoteEditorDialogProps {
  editing: boolean;
  initialTitle: string;
  initialContent: string;
  onCancel: () => void;
  onSave: (draft: { title: string; content: string }) => void;
  onFormat: (content: string, action: NoteTextToolAction, linesPerSlide?: number) => string;
}

function DockNoteEditorDialog({
  editing,
  initialTitle,
  initialContent,
  onCancel,
  onSave,
  onFormat,
}: DockNoteEditorDialogProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initialTitle);
  const {
    value: content,
    setValue: setContent,
    undo,
    redo,
    canUndo,
    canRedo,
    handleKeyDown: handleUndoRedoKeyDown,
  } = useTextUndoRedo(initialContent);
  const titleWasAutoGeneratedRef = useRef(!editing || isDummyTitle(initialTitle));

  const handleTitleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    titleWasAutoGeneratedRef.current = isDummyTitle(event.target.value);
    setTitle(event.target.value);
  };

  const handleContentChange = (nextContent: string) => {
    setContent(nextContent);
    if (titleWasAutoGeneratedRef.current || isDummyTitle(title) || !title.trim()) {
      const firstLine = extractFirstLineAsTitle(nextContent);
      if (firstLine) {
        setTitle(firstLine);
      } else if (!nextContent.trim()) {
        setTitle(initialTitle);
      }
    }
  };

  const handleFormat = useCallback((action: NoteTextToolAction, linesPerSlide?: number) => {
    const formatted = onFormat(content, action, linesPerSlide);
    setContent(formatted, true);
    if (titleWasAutoGeneratedRef.current || isDummyTitle(title) || !title.trim()) {
      const firstLine = extractFirstLineAsTitle(formatted);
      if (firstLine) setTitle(firstLine);
    }
  }, [content, onFormat, setContent, title]);

  const handleSave = () => {
    let finalTitle = title.trim();
    if (titleWasAutoGeneratedRef.current || isDummyTitle(finalTitle) || !finalTitle) {
      const firstLine = extractFirstLineAsTitle(content);
      if (firstLine) {
        finalTitle = firstLine;
      }
    }
    if (!finalTitle || !content.trim()) return;
    onSave({ title: finalTitle, content });
  };

  return (
    <div className="dock-dialog-backdrop" role="presentation">
      <div className="dock-dialog" role="dialog" aria-modal="true" aria-labelledby="dock-note-editor-title">
        <div className="dock-dialog__header">
          <div>
            <div className="dock-dialog__eyebrow">{editing ? t("notes.editNote") : t("notes.addNote")}</div>
            <h2 id="dock-note-editor-title" className="dock-dialog__title">
              {editing ? t("notes.editNote") : t("notes.newNote")}
            </h2>
          </div>
          <button type="button" className="dock-dialog__close" onClick={onCancel} aria-label={t("common.close")} title={t("common.close")}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="dock-dialog__body">
          <label className="dock-dialog-field">
            <span className="dock-dialog-field__label">
              <span>{t("common.title")}</span>
              <span className="dock-dialog-field__tag dock-dialog-field__tag--required">{t("common.required")}</span>
            </span>
            <input className="dock-input" value={title} onChange={handleTitleChange} placeholder={t("notes.noteTitlePlaceholder")} />
          </label>
          <DockNotesTextTools
            className="dock-notes-text-tools dock-notes-text-tools--editor"
            buttonClassName="dock-notes-text-tools__btn"
            onAction={handleFormat}
            onUndo={undo}
            onRedo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
          />
          <div className="dock-dialog-field">
            <label className="dock-dialog-field__label" htmlFor="dock-note-content">
              <span>{t("notes.content")}</span>
              <span className="dock-dialog-field__tag dock-dialog-field__tag--required">{t("common.required")}</span>
            </label>
            <DockSpellcheckTextarea
              id="dock-note-content"
              className="dock-input dock-dialog-textarea"
              value={content}
              onChange={handleContentChange}
              onKeyDown={(event) => {
                handleUndoRedoKeyDown(event);
                if (event.key === "Enter" || event.key === " ") event.stopPropagation();
              }}
              placeholder={t("notes.contentPlaceholderTips", "Type note content here...\n\nExample:\n[Point 1]\nFirst main point\nSupporting details\n\n[Point 2]\nSecond main point")}
              rows={8}
            />
          </div>
        </div>
        <div className="dock-dialog__footer">
          <button type="button" className="dock-btn dock-btn--ghost" onClick={onCancel} title={t("common.cancel")}>{t("common.cancel")}</button>
          <button
            type="button"
            className="dock-btn dock-btn--primary"
            onClick={handleSave}
            disabled={!title.trim() || !content.trim()}
            title={t("common.save")}>
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

interface DockNoteSlideEditorDialogProps {
  label: string;
  initialText: string;
  onCancel: () => void;
  onSave: (text: string) => void;
  onFormat: (content: string, action: NoteTextToolAction, linesPerSlide?: number) => string;
}

function DockNoteSlideEditorDialog({
  label,
  initialText,
  onCancel,
  onSave,
  onFormat,
}: DockNoteSlideEditorDialogProps) {
  const { t } = useTranslation();
  const {
    value: text,
    setValue: setText,
    undo,
    redo,
    canUndo,
    canRedo,
    handleKeyDown: handleUndoRedoKeyDown,
  } = useTextUndoRedo(initialText);

  return (
    <div className="dock-dialog-backdrop" role="presentation">
      <div className="dock-dialog dock-dialog--compact" role="dialog" aria-modal="true" aria-labelledby="dock-note-slide-editor-title">
        <div className="dock-dialog__header">
          <div>
            <div className="dock-dialog__eyebrow">{t("notes.quickEdit")}</div>
            <h2 id="dock-note-slide-editor-title" className="dock-dialog__title">{label}</h2>
          </div>
          <button type="button" className="dock-dialog__close" onClick={onCancel} aria-label={t("common.close")} title={t("common.close")}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="dock-dialog__body">
          <DockNotesTextTools
            className="dock-notes-text-tools dock-notes-text-tools--editor"
            buttonClassName="dock-notes-text-tools__btn"
            onAction={(action, linesPerSlide) => {
              setText(onFormat(text, action, linesPerSlide), true);
            }}
            onUndo={undo}
            onRedo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
          />
          <div className="dock-dialog-field">
            <label className="dock-dialog-field__label" htmlFor="dock-note-slide-text">
              <span>{t("notes.slideText")}</span>
            </label>
            <DockSpellcheckTextarea
              id="dock-note-slide-text"
              className="dock-input dock-dialog-textarea dock-dialog-textarea--short"
              value={text}
              placeholder={t("notes.slideTextPlaceholderTips", "Type note slide text here…\n\n• Add section tags like [Point 1], <Chorus>, or Header: at the top of a slide to display a header badge.")}
              onChange={setText}
              onKeyDown={(event) => {
                handleUndoRedoKeyDown(event);
                if (event.key === "Enter" || event.key === " ") event.stopPropagation();
              }}
            />
          </div>
        </div>
        <div className="dock-dialog__footer">
          <button type="button" className="dock-btn dock-btn--ghost" onClick={onCancel} title={t("common.cancel")}>{t("common.cancel")}</button>
          <button
            type="button"
            className="dock-btn dock-btn--primary"
            onClick={() => onSave(text)}
            disabled={!text.trim()}
            title={t("common.save")}>
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function generateNoteSlides(
  note: DockNote,
  linesPerSlide = DEFAULT_NOTE_LINES_PER_SLIDE,
  autoSplit = true,
): { id: string; label: string; text: string }[] {
  const slides: { id: string; label: string; text: string }[] = [];
  const structuredText = extractStructuredTextTitle(normalizeDockMultilineText(note.content));
  const displayTitle = structuredText.title || note.title;
  const sections = splitNoteBodyIntoSections(structuredText.body);
  if (sections.length === 0 && displayTitle) {
    slides.push({ id: `note-${note.id}-0-0`, label: "", text: displayTitle });
  } else {
    const groupedSections: Array<{ headingLabel: string; lines: string[] }> = [];

    sections.forEach((text) => {
      const lines = text.split("\n");
      const heading = parseWorshipSectionLabelLine(lines[0] ?? "");
      // In notes, DO NOT treat "Verse 1" or numbered list prefixes as hymn verses
      const isVerseHeading = Boolean(
        heading && (heading.type === "verse" || /^(?:verse(?:\s*\d+)?|v\d+)$/i.test(heading.label)),
      );
      const validHeading = heading && !isVerseHeading ? heading : null;

      const sectionText = validHeading
        ? [validHeading.rest, ...lines.slice(1)].filter(Boolean).join("\n")
        : text;
      const cleanSectionText = stripLeadingVerseMarker(sectionText);
      const sectionLines = cleanSectionText.split("\n").map((line) => line.trim()).filter(Boolean);
      if (sectionLines.length === 0) return;

      if (validHeading) {
        groupedSections.push({ headingLabel: validHeading.label, lines: sectionLines });
        return;
      }

      groupedSections.push({ headingLabel: "", lines: sectionLines });
    });

    const generatedSections = autoSplit
      ? paginateNoteSections(groupedSections, clampNoteLinesPerSlide(linesPerSlide))
      : preserveNoteSections(groupedSections);

    generatedSections.forEach((slide, slideIndex) => {
      const isVerseHeading = /^(?:verse(?:\s*\d+)?|v\d+)$/i.test(slide.headingLabel.trim());
      const cleanHeading = isVerseHeading ? "" : slide.headingLabel;
      slides.push({
        id: `note-${note.id}-${slideIndex}`,
        label: cleanHeading || (slideIndex === 0 ? displayTitle : ""),
        text: stripLeadingVerseMarker(slide.text),
      });
    });
  }
  return slides;
}

function serializeNoteSlides(note: DockNote, slides: Array<{ label: string; text: string }>): string {
  const structuredText = extractStructuredTextTitle(normalizeDockMultilineText(note.content));
  const titleMarker = structuredText.title ? `[${structuredText.title}]\n\n` : "";
  const body = slides
    .map((slide) => {
      const label = slide.label.trim();
      const isDocumentTitle = label === structuredText.title || (!structuredText.title && label === note.title);
      const isVerseHeading = /^(?:verse(?:\s*\d+)?|v\d+)$/i.test(label);
      const heading = !isDocumentTitle && !isVerseHeading && parseWorshipSectionLabelLine(label) ? `[${label}]` : "";
      const cleanText = stripLeadingVerseMarker(slide.text.trim());
      return [heading, cleanText].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
  return `${titleMarker}${body}`.trim();
}

function getNoteQuickSettings(
  overlayMode: OverlayMode,
  selectedFSTheme: BibleTheme,
  selectedLTTheme: BibleTheme,
  fullscreenQuickSettings: DockFullscreenQuickThemeSettings | null,
  lowerThirdQuickSettings: DockFullscreenQuickThemeSettings | null,
): DockOutputQuickTextSettings {
  const theme = overlayMode === "fullscreen"
    ? getDockNotesThemeForMode(selectedFSTheme, "fullscreen")
    : getDockNotesThemeForMode(selectedLTTheme, "lower-third");
  const quickSettings = overlayMode === "fullscreen" ? fullscreenQuickSettings : lowerThirdQuickSettings;
  const fontSize = quickSettings?.fontSize ?? theme.settings.fontSize;
  return layerThemeQuickDisplay({
    fontSize: overlayMode === "fullscreen"
      ? fontSize
      : Math.max(LOWER_THIRD_FIT_MIN_FONT_SIZE, fontSize),
    autoFontScale: false,
    // Shown by the Bold / Italic buttons in the quick panel.
    fontWeight: quickSettings?.fontWeight ?? theme.settings.fontWeight,
    fontStyle: quickSettings?.fontStyle ?? theme.settings.fontStyle,
  }, theme.settings.layout, { ...theme.settings, ...(quickSettings ?? {}) });
}

function resolveNotesOutputThemeSettings(
  selectedTheme: BibleTheme,
  overlayMode: OverlayMode,
  quickSettings: DockFullscreenQuickThemeSettings | null | undefined,
): DockFullscreenQuickThemeSettings {
  const baseTheme = getDockNotesThemeForMode(selectedTheme, overlayMode);
  const effectiveTheme = applyQuickSettingsToNotesTheme(baseTheme, quickSettings);
  return normalizeExplicitOutputFontSettings(
    { ...(effectiveTheme.settings as unknown as DockFullscreenQuickThemeSettings) },
    overlayMode,
  );
}

type ToastTone = "info" | "success" | "error";

const DOCK_NOTES_TRANSLATIONS_KEY = "ocs-dock-notes-translations-v1";
type StoredDockNoteTranslations = Record<string, DockTranslationValue>;

function isStoredDockTranslation(value: unknown): value is DockTranslationValue {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DockTranslationValue>;
  const translatedSections = candidate.translatedSections as Record<string, unknown> | undefined;
  return typeof candidate.targetLanguage === "string"
    && typeof candidate.targetLanguageLabel === "string"
    && typeof translatedSections === "object"
    && translatedSections !== null
    && Object.values(translatedSections).every((text) => typeof text === "string")
    && typeof candidate.showBoth === "boolean"
    && (candidate.translationOrder === "original-first" || candidate.translationOrder === "translation-first");
}

function loadDockNoteTranslations(): StoredDockNoteTranslations {
  try {
    const stored = readNativeDockSetting<unknown>(DOCK_NOTES_TRANSLATIONS_KEY);
    if (!stored) return {};
    const parsed: unknown = typeof stored === "string" ? JSON.parse(stored) : stored;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => isStoredDockTranslation(value)),
    ) as StoredDockNoteTranslations;
  } catch {
    return {};
  }
}

function saveDockNoteTranslation(noteId: string, translation: DockTranslationValue | null): void {
  try {
    const stored = loadDockNoteTranslations();
    if (translation) stored[noteId] = translation;
    else delete stored[noteId];
    writeNativeDockSetting(DOCK_NOTES_TRANSLATIONS_KEY, stored);
  } catch {
    // Ignore malformed translation records.
  }
}

export default function DockNotesTab({
  onStage,
  isActive,
  presentationOutputTarget = "obs",
  searchPlacement = "top",
  productionDefaults,
}: Props) {
  const notesLabel = useDockTabLabelMode("notes");
  const { t } = useTranslation();
  const presentationLinkMode = isPresentationLinkTarget(presentationOutputTarget);
  const [sceneRoute, updateSceneRoute] = useDockSceneRoute("notes");
  const hasSceneRoute = sceneRoute.enabled && sceneRoute.targets.length > 0;

  const notesSceneRouteConfirmedRef = useRef(false);
  const [pendingNotesRouteConfirm, setPendingNotesRouteConfirm] = useState<{
    idx: number;
    quickSettingsOverride?: DockFullscreenQuickThemeSettings;
    fitOptions?: DockOverlayFitOptions;
  } | null>(null);

  const sceneRouteTargetsKey = useMemo(() => {
    return `${sceneRoute.enabled ? "1" : "0"}:${sceneRoute.targets.map((t) => `${t.sceneName}:${t.mode}`).join(",")}`;
  }, [sceneRoute.enabled, sceneRoute.targets]);

  useEffect(() => {
    notesSceneRouteConfirmedRef.current = false;
  }, [sceneRouteTargetsKey]);

  const pushNotesToConfiguredOutput = useCallback(async (
    data: DockTabContentPushData,
    options?: DockOverlayFitOptions,
    pushOptions?: { bypassSceneRoute?: boolean },
  ) => {
    if (!hasSceneRoute || pushOptions?.bypassSceneRoute) {
      return dockObsClient.pushNotesLyrics(data, options);
    }
    await Promise.all(sceneRoute.targets.map((target) => {
      if (target.mode === "inherit") {
        return dockObsClient.pushNotesToScene(data, target.sceneName);
      }

      const targetThemeSettings = target.mode === "fullscreen"
        ? (liveFullscreenThemeSettingsRef.current ?? data.bibleThemeSettings)
        : (liveLowerThirdThemeSettingsRef.current ?? data.bibleThemeSettings);
      return dockObsClient.pushNotesToScene({
        ...data,
        overlayMode: target.mode,
        bibleThemeSettings: targetThemeSettings,
      }, target.sceneName);
    }));
    if (sceneRoute.syncPresentation) return dockObsClient.pushNotesLyrics(data, options);
    return null;
  }, [hasSceneRoute, sceneRoute.targets, sceneRoute.syncPresentation]);

  const clearNotesFromConfiguredOutput = useCallback(async () => {
    if (!hasSceneRoute) {
      await dockObsClient.clearNotesLyrics();
      return;
    }
    await Promise.all(sceneRoute.targets.map((target) => (
      dockObsClient.clearSceneRouteSource("notes", target.sceneName)
    )));
    if (sceneRoute.syncPresentation) await dockObsClient.clearNotesLyrics();
  }, [hasSceneRoute, sceneRoute.targets, sceneRoute.syncPresentation]);
  const initialPrefsRef = useRef<DockNotesPreferences | null>(null);
  if (initialPrefsRef.current === null) {
    initialPrefsRef.current = loadDockNotesPreferences();
  }
  const initialPrefs = initialPrefsRef.current;
  const initialOverlayMode: OverlayMode = initialPrefs.overlayMode === "lower-third" ? "lower-third" : "fullscreen";

  const [notes, setNotes] = useState<DockNote[]>(() => loadDockNotes());
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 160);
  const [selectedNote, setSelectedNote] = useState<DockNote | null>(null);
  // Always-current copies, so quick-setting commits never work from a stale note.
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const selectedNoteRef = useRef(selectedNote);
  selectedNoteRef.current = selectedNote;
  const [notesTranslation, setNotesTranslation] = useState<DockTranslationValue | null>(null);
  const [noteSlidesSearchQuery, setNoteSlidesSearchQuery] = useState("");
  const debouncedNoteSlidesSearchQuery = useDebouncedValue(noteSlidesSearchQuery, 160);
  const [selectedSlideIdx, setSelectedSlideIdx] = useState<number | null>(null);
  const [visibleSlideIdx, setVisibleSlideIdx] = useState<number | null>(null);
  const [noteContextMenu, setNoteContextMenu] = useState<{ x: number; y: number; note: DockNote } | null>(null);
  const [noteDeleteTarget, setNoteDeleteTarget] = useState<DockNote | null>(null);
  const [slideContextMenu, setSlideContextMenu] = useState<{ x: number; y: number; slideIdx: number } | null>(null);

  useEffect(() => {
    if (!noteContextMenu) return;
    const handleCloseMenu = () => setNoteContextMenu(null);
    window.addEventListener("click", handleCloseMenu);
    return () => window.removeEventListener("click", handleCloseMenu);
  }, [noteContextMenu]);

  useEffect(() => {
    if (!slideContextMenu) return;
    const handleCloseMenu = () => setSlideContextMenu(null);
    window.addEventListener("click", handleCloseMenu);
    return () => window.removeEventListener("click", handleCloseMenu);
  }, [slideContextMenu]);

  useEffect(() => {
    const checkAndApplyPendingNote = () => {
      const pending = getPendingNoteSelection();
      if (!pending) return;
      const { noteId, noteTitle } = pending;
      const targetNote = notes.find(
        (n) =>
          (noteId && n.id === noteId) ||
          (noteTitle &&
            (n.title.trim().toLowerCase() === noteTitle.trim().toLowerCase() ||
              getNoteDisplayTitle(n).trim().toLowerCase() === noteTitle.trim().toLowerCase())),
      );

      if (targetNote) {
        setSelectedNote(targetNote);
        setSelectedSlideIdx(0);
        setVisibleSlideIdx(null);
        setPendingNoteSelection(null);
      }
    };

    checkAndApplyPendingNote();

    const handleSelectNoteEvent = (event: Event) => {
      const customEvent = event as CustomEvent<{ noteId?: string; noteTitle?: string }>;
      const { noteId, noteTitle } = customEvent.detail || {};

      const targetNote = notes.find(
        (n) =>
          (noteId && n.id === noteId) ||
          (noteTitle &&
            (n.title.trim().toLowerCase() === noteTitle.trim().toLowerCase() ||
              getNoteDisplayTitle(n).trim().toLowerCase() === noteTitle.trim().toLowerCase())),
      );

      if (targetNote) {
        setSelectedNote(targetNote);
        setSelectedSlideIdx(0);
        setVisibleSlideIdx(null);
        setPendingNoteSelection(null);
      }
    };

    window.addEventListener(DOCK_SELECT_NOTE_EVENT, handleSelectNoteEvent);
    return () => {
      window.removeEventListener(DOCK_SELECT_NOTE_EVENT, handleSelectNoteEvent);
    };
  }, [notes]);

  const [overlayVisible, setOverlayVisible] = useState(true);
  const [visibilityActionPending, setVisibilityActionPending] = useState(false);
  /** Invalidates in-flight note pushes when Hide Notes is pressed. */
  const visibilityEpochRef = useRef(0);
  const visibilityActionInFlightRef = useRef(false);
  const [autoAdvanceActive, setAutoAdvanceActive] = useState(false);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>(initialOverlayMode);
  const [showThemeSettings, setShowThemeSettings] = useState(false);
  const [selectedFSTheme, setSelectedFSTheme] = useState<BibleTheme>(() =>
    getFallbackDockNotesTheme("fullscreen", initialPrefs.fullscreenThemeId),
  );
  const [selectedLTTheme, setSelectedLTTheme] = useState<BibleTheme>(() =>
    getFallbackDockNotesTheme("lower-third", initialPrefs.lowerThirdThemeId),
  );
  const [fullscreenQuickSettings, setFullscreenQuickSettings] = useState<DockFullscreenQuickThemeSettings | null>(() => initialPrefs.fullscreenQuickSettings ?? null);
  const [lowerThirdQuickSettings, setLowerThirdQuickSettings] = useState<DockFullscreenQuickThemeSettings | null>(() => initialPrefs.lowerThirdQuickSettings ?? null);
  const [fullscreenLinesPerSlide, setFullscreenLinesPerSlide] = useState(() =>
    clampNoteLinesPerSlide(initialPrefs.fullscreenLinesPerSlide ?? initialPrefs.linesPerSlide),
  );
  const [lowerThirdLinesPerSlide, setLowerThirdLinesPerSlide] = useState(() =>
    clampNoteLinesPerSlide(initialPrefs.lowerThirdLinesPerSlide ?? initialPrefs.linesPerSlide),
  );
  const [notesLinesPerSlide, setNotesLinesPerSlide] = useState(() => {
    const active = initialPrefs.overlayMode === "fullscreen"
      ? (initialPrefs.fullscreenLinesPerSlide ?? initialPrefs.linesPerSlide)
      : (initialPrefs.lowerThirdLinesPerSlide ?? initialPrefs.linesPerSlide);
    return clampNoteLinesPerSlide(active);
  });
  const [notesAutoSplit, setNotesAutoSplit] = useState(() => initialPrefs.autoSplit ?? false);
  const [quickActionsTop, setQuickActionsTop] = useState(() => (
    typeof initialPrefs.quickActionsTop === "number" && Number.isFinite(initialPrefs.quickActionsTop)
      ? initialPrefs.quickActionsTop
      : DEFAULT_DOCK_OUTPUT_QUICK_ACTIONS_TOP
  ));
  const [quickActionsLeft, setQuickActionsLeft] = useState<number | null>(() => readQuickActionsLeft(initialPrefs.quickActionsLeft));
  const [quickUpdateImmediately, setQuickUpdateImmediately] = useState(() => initialPrefs.quickUpdateImmediately !== false);
  const [quickSettingsRefreshNonce, setQuickSettingsRefreshNonce] = useState(0);
  const [showNoteEditor, setShowNoteEditor] = useState(false);
  const [showCompactSummaryActions, setShowCompactSummaryActions] = useState(false);
  const [showNotesBrowserMenu, setShowNotesBrowserMenu] = useState(false);
  const notesBrowserMenuRef = useRef<HTMLDivElement | null>(null);
  const [isConstrained, setIsConstrained] = useState(() => (typeof window !== "undefined" ? window.innerWidth <= 400 || window.innerHeight < 450 : false));

  useEffect(() => {
    const handleResize = () => {
      setIsConstrained(window.innerWidth <= 400 || window.innerHeight < 450);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  const [draggingSlideIdx, setDraggingSlideIdx] = useState<number | null>(null);
  const [dragOverSlideIdx, setDragOverSlideIdx] = useState<number | null>(null);
  const [dropPosition, setDropPosition] = useState<"above" | "below" | null>(null);
  const [showAutoAdvanceModal, setShowAutoAdvanceModal] = useState(false);
  const [showTranslationModal, setShowTranslationModal] = useState(false);
  const [editingNote, setEditingNote] = useState<DockNote | null>(null);
  const [noteSlideEditor, setNoteSlideEditor] = useState<{ index: number; label: string; text: string } | null>(null);
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  const [bottomSearchExpanded, setBottomSearchExpanded] = useState(true);
  const [actionError, setActionError] = useState("");
  const [toasts, setToasts] = useState<{ id: string; message: string; tone: ToastTone }[]>([]);
  const prefsReadyRef = useRef(false);
  const processedAppendCommandIdsRef = useRef<Set<string>>(new Set());
  const pendingQuickSettingsRefreshRef = useRef(false);
  const notesTranslationChangeRef = useRef(false);
  const compactSummaryActionsRef = useRef<HTMLDivElement>(null);
  const handleCompactSummaryChildClose = useCallback(() => {
    setShowCompactSummaryActions(false);
  }, []);
  const liveFullscreenThemeSettingsRef = useRef<Record<string, unknown> | null>(null);
  const liveLowerThirdThemeSettingsRef = useRef<Record<string, unknown> | null>(null);
  const selectedFSThemeRef = useRef(selectedFSTheme);
  const selectedLTThemeRef = useRef(selectedLTTheme);

  const handleSelectFSTheme = useCallback((theme: BibleTheme) => {
    selectedFSThemeRef.current = theme;
    setSelectedFSTheme(theme);
  }, []);

  const handleSelectLTTheme = useCallback((theme: BibleTheme) => {
    selectedLTThemeRef.current = theme;
    setSelectedLTTheme(theme);
  }, []);

  useEffect(() => {
    selectedFSThemeRef.current = selectedFSTheme;
    selectedLTThemeRef.current = selectedLTTheme;
    liveFullscreenThemeSettingsRef.current = resolveNotesOutputThemeSettings(
      selectedFSTheme,
      "fullscreen",
      fullscreenQuickSettings,
    ) as unknown as Record<string, unknown>;
    liveLowerThirdThemeSettingsRef.current = resolveNotesOutputThemeSettings(
      selectedLTTheme,
      "lower-third",
      lowerThirdQuickSettings,
    ) as unknown as Record<string, unknown>;
  }, [fullscreenQuickSettings, lowerThirdQuickSettings, selectedFSTheme, selectedLTTheme]);

  const filteredNotes = useMemo(() => {
    const q = debouncedSearchQuery.trim();
    if (!q) return notes;
    return fuzzyFilter(notes, q, (n) => [n.title, n.content]);
  }, [notes, debouncedSearchQuery]);

  const INITIAL_NOTES_RENDER_LIMIT = 40;
  const [visibleNotesCount, setVisibleNotesCount] = useState<number>(INITIAL_NOTES_RENDER_LIMIT);

  useEffect(() => {
    setVisibleNotesCount(INITIAL_NOTES_RENDER_LIMIT);
  }, [debouncedSearchQuery]);

  const handleNotesListScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 250) {
      setVisibleNotesCount((prev) => (prev < filteredNotes.length ? prev + 40 : prev));
    }
  }, [filteredNotes.length]);

  const renderedNotes = useMemo(() => {
    return filteredNotes.slice(0, visibleNotesCount);
  }, [filteredNotes, visibleNotesCount]);

  const selectedNoteSlides = useMemo(
    () => (selectedNote ? generateNoteSlides(selectedNote, notesLinesPerSlide, notesAutoSplit) : []),
    [notesAutoSplit, notesLinesPerSlide, selectedNote],
  );
  const notesTranslationSourceSignature = useMemo(
    () => getDockTranslationSourceSignature(selectedNoteSlides),
    [selectedNoteSlides],
  );
  const effectiveNotesTranslation = useMemo(
    () => notesTranslation?.sourceSignature === notesTranslationSourceSignature ? notesTranslation : null,
    [notesTranslation, notesTranslationSourceSignature],
  );
  const filteredNoteSlides = useMemo(() => {
    const query = debouncedNoteSlidesSearchQuery.trim();
    return selectedNoteSlides
      .map((slide, idx) => ({ slide, idx }))
      .filter(({ slide }) => {
        if (!query) return true;
        return fuzzyMatch(query, `${slide.label} ${slide.text}`);
      });
  }, [debouncedNoteSlidesSearchQuery, selectedNoteSlides]);
  const selectedNoteDisplayTitle = selectedNote ? getNoteDisplayTitle(selectedNote) : "";

  const selectedNoteAutoAdvanceIndex = useMemo(
    () => (selectedNote ? 0 : -1),
    [selectedNote],
  );

  const handleAutoAdvanceNoteSelection = useCallback((_index: number) => {
    // Auto-advance is scoped to the opened note. It must never select from
    // the notes list.
  }, []);

  useEffect(() => {
    notesTranslationChangeRef.current = false;
    const stored = selectedNote ? loadDockNoteTranslations()[selectedNote.id] : null;
    const nextTranslation = stored?.sourceSignature === notesTranslationSourceSignature ? stored : null;
    if (selectedNote && stored && !nextTranslation) saveDockNoteTranslation(selectedNote.id, null);
    setNotesTranslation(nextTranslation);
    setNoteSlidesSearchQuery("");
  }, [notesTranslationSourceSignature, selectedNote?.id]);

  useEffect(() => {
    if (!showCompactSummaryActions && !showNotesBrowserMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-dock-keep-overflow-open='true']")) return;
      if (compactSummaryActionsRef.current && target instanceof Node && !compactSummaryActionsRef.current.contains(target)) {
        setShowCompactSummaryActions(false);
      }
      if (notesBrowserMenuRef.current && target instanceof Node && !notesBrowserMenuRef.current.contains(target)) {
        setShowNotesBrowserMenu(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [showCompactSummaryActions, showNotesBrowserMenu]);

  useEffect(() => {
    setShowCompactSummaryActions(false);
  }, [selectedNote?.id]);

  const activeSlideIndex = useMemo(() => {
    if (selectedSlideIdx !== null && selectedSlideIdx < selectedNoteSlides.length) return selectedSlideIdx;
    if (visibleSlideIdx !== null && visibleSlideIdx < selectedNoteSlides.length) return visibleSlideIdx;
    return selectedNoteSlides.length > 0 ? 0 : null;
  }, [selectedNoteSlides.length, selectedSlideIdx, visibleSlideIdx]);

  const showToast = useCallback((message: string, tone: ToastTone = "info") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((current) => [...current.slice(-2), { id, message, tone }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 1500);
  }, []);

  const refreshNotes = useCallback((incomingNotes?: DockNote[]) => {
    const localNotes = loadDockNotes();
    const next = Array.isArray(incomingNotes)
      ? (incomingNotes.length > 0 || localNotes.length === 0 ? incomingNotes : localNotes)
      : localNotes;
    setNotes(next);
    setSelectedNote((current) => {
      if (!current) return current;
      return next.find((note) => note.id === current.id) ?? null;
    });
  }, []);

  const applyAppendCommand = useCallback((command: DockNotesAppendCommand) => {
    const commandId = command.commandId.trim();
    if (!commandId || processedAppendCommandIdsRef.current.has(commandId)) return;
    processedAppendCommandIdsRef.current.add(commandId);

    const result = appendTextToDockNotes(command.text, command.title, {
      sourceId: commandId,
      sessionId: command.sessionId,
    });
    if (result) refreshNotes(result.notes);
  }, [refreshNotes]);

  useEffect(() => {
    let cancelled = false;
    const prefs = initialPrefsRef.current ?? loadDockNotesPreferences();

    Promise.all([
      resolveDockNotesTheme("fullscreen", prefs),
      resolveDockNotesTheme("lower-third", prefs),
    ])
      .then(([fullscreenTheme, lowerThirdTheme]) => {
        if (cancelled) return;
        setSelectedFSTheme(fullscreenTheme);
        setSelectedLTTheme(lowerThirdTheme);
      })
      .catch(() => {
        // Keep the built-in fallback theme.
      })
      .finally(() => {
        if (!cancelled) prefsReadyRef.current = true;
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // A theme picked for Notes on the Themes page applies straight away. The first
  // value is skipped so the Dock's own saved choice wins on start-up.
  const productionNotesKey = productionDefaults
    ? `${productionDefaults.fullscreenTheme?.id ?? ""}|${productionDefaults.lowerThirdTheme?.id ?? ""}`
    : "";
  const lastProductionNotesKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!productionDefaults || !productionNotesKey) return;
    const previous = lastProductionNotesKeyRef.current;
    lastProductionNotesKeyRef.current = productionNotesKey;
    if (previous === null || previous === productionNotesKey) return;
    if (productionDefaults.fullscreenTheme) setSelectedFSTheme(productionDefaults.fullscreenTheme);
    if (productionDefaults.lowerThirdTheme) setSelectedLTTheme(productionDefaults.lowerThirdTheme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productionNotesKey]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === getUserScopedKey(DOCK_NOTES_KEY)) refreshNotes();
    };
    const handleNotesUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ notes?: DockNote[] }>).detail;
      refreshNotes(detail?.notes);
    };

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(DOCK_NOTES_BROADCAST_CHANNEL);
      bc.onmessage = (event: MessageEvent<{ type?: string; notes?: DockNote[] }>) => {
        if (event.data?.type === "notes-updated") refreshNotes(event.data.notes);
      };
    } catch {
      bc = null;
    }

    window.addEventListener(DOCK_NOTES_UPDATED_EVENT, handleNotesUpdated);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(DOCK_NOTES_UPDATED_EVENT, handleNotesUpdated);
      window.removeEventListener("storage", handleStorage);
      bc?.close();
    };
  }, [refreshNotes]);

  useEffect(() => {
    if (isActive) refreshNotes();
  }, [isActive, refreshNotes]);

  useEffect(() => {
    if (!isActive) return;
    let disposed = false;
    dockClient.sendCommand({ type: "request-library-data", timestamp: Date.now() });

    const fallbackTimer = window.setTimeout(() => {
      void loadDockNotesFromDockData().then((remoteNotes) => {
        if (!disposed && remoteNotes.length > 0) refreshNotes(remoteNotes);
      });
    }, 300);

    return () => {
      disposed = true;
      window.clearTimeout(fallbackTimer);
    };
  }, [isActive, refreshNotes]);

  useEffect(() => {
    const unsubscribe = dockClient.onState((msg) => {
      if (msg.type !== "state:notes-updated") return;
      const payload = msg.payload as { notes?: DockNote[] } | null;
      refreshNotes(payload?.notes);
    });
    return unsubscribe;
  }, [refreshNotes]);

  useEffect(() => {
    if (!isActive) return;

    let disposed = false;
    let inFlight = false;

    const pollAppendCommands = async () => {
      if (disposed || inFlight || !isActive) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const commands = await loadDockNotesAppendCommands();
        if (disposed || commands.length === 0) return;
        commands.forEach(applyAppendCommand);
      } catch {
        // The overlay relay is a fallback; local storage/broadcast still work.
      } finally {
        inFlight = false;
      }
    };

    void pollAppendCommands();
    const timer = window.setInterval(
      () => void pollAppendCommands(),
      getRecommendedPollingInterval(750),
    );

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [applyAppendCommand, isActive]);

  const openNewNote = useCallback(() => {
    setEditingNote(null);
    setShowNoteEditor(true);
    setNotesAutoSplit(false);
  }, []);

  const openEditNote = useCallback((note: DockNote) => {
    setEditingNote(note);
    setShowNoteEditor(true);
    setNotesAutoSplit(note.autoSplit ?? false);
    if (typeof note.linesPerSlide === "number") {
      setNotesLinesPerSlide(clampNoteLinesPerSlide(note.linesPerSlide));
    }
  }, []);

  const formatNoteDraft = useCallback((content: string, action: NoteTextToolAction, linesPerSlide?: number) => {
    return formatNoteText(content, action, linesPerSlide);
  }, []);

  const saveNoteDraft = useCallback(({ title: draftTitle, content: draftContent }: { title: string; content: string }) => {
    let title = draftTitle.trim();
    const content = draftContent.trim();
    if (isDummyTitle(title) || !title) {
      const firstLine = extractFirstLineAsTitle(content);
      if (firstLine) title = firstLine;
    }
    if (!title || !content) return;
    const now = Date.now();
    if (editingNote) {
      const maintainedAutoSplit = editingNote.autoSplit ?? false;
      const updated: DockNote = {
        ...editingNote,
        title,
        content,
        splitOnLineBreaks: false,
        autoSplit: maintainedAutoSplit,
        linesPerSlide: editingNote.linesPerSlide ?? notesLinesPerSlide,
        updatedAt: now,
      };
      const next = notes.map((n) => (n.id === updated.id ? updated : n));
      setNotes(next);
      saveDockNotes(next);
      setSelectedNote((cur) => (cur?.id === updated.id ? updated : cur));
      setNotesAutoSplit(maintainedAutoSplit);
    } else {
      const newNote: DockNote = {
        id: crypto.randomUUID?.() ?? `note-${now}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        content,
        splitOnLineBreaks: false,
        autoSplit: false,
        linesPerSlide: notesLinesPerSlide,
        updatedAt: now,
      };
      const next = [newNote, ...notes];
      setNotes(next);
      saveDockNotes(next);
      setNotesAutoSplit(false);
    }
    setShowNoteEditor(false);
    setEditingNote(null);
  }, [editingNote, notes, notesLinesPerSlide]);

  const openNoteSlideEditor = useCallback((idx: number) => {
    const slide = selectedNoteSlides[idx];
    if (!slide) return;
    const isVerse = /^(?:verse(?:\s*\d+)?|v\d+)$/i.test(slide.label.trim());
    const displayLabel = isVerse ? "" : slide.label;
    setNoteSlideEditor({
      index: idx,
      label: displayLabel || `${t("notes.slideLabel")} ${idx + 1}`,
      text: stripLeadingVerseMarker(slide.text),
    });
  }, [selectedNoteSlides, t]);

  const closeNoteSlideEditor = useCallback(() => setNoteSlideEditor(null), []);

  const saveNoteSlideEditor = useCallback((nextText: string) => {
    if (!selectedNote || !noteSlideEditor || !nextText.trim()) return;
    const cleanText = stripLeadingVerseMarker(nextText);
    const nextSlides = selectedNoteSlides.map((slide, index) => (
      index === noteSlideEditor.index ? { ...slide, text: cleanText } : slide
    ));
    const updated: DockNote = {
      ...selectedNote,
      content: serializeNoteSlides(selectedNote, nextSlides),
      splitOnLineBreaks: false,
      updatedAt: Date.now(),
    };
    const nextNotes = notes.map((note) => note.id === updated.id ? updated : note);
    setNotes(nextNotes);
    saveDockNotes(nextNotes);
    setSelectedNote(updated);
    setNoteSlideEditor(null);
    showToast(t("notes.slideUpdated"), "success");
  }, [noteSlideEditor, notes, selectedNote, selectedNoteSlides, showToast, t]);

  const deleteNoteSlide = useCallback((idx: number) => {
    if (!selectedNote || selectedNoteSlides.length <= 1) return;
    const nextSlides = selectedNoteSlides.filter((_, index) => index !== idx);
    const updated: DockNote = {
      ...selectedNote,
      content: serializeNoteSlides(selectedNote, nextSlides),
      updatedAt: Date.now(),
    };
    const nextNotes = notes.map((note) => note.id === updated.id ? updated : note);
    setNotes(nextNotes);
    saveDockNotes(nextNotes);
    setSelectedNote(updated);
    setSelectedSlideIdx((current) => current === null ? null : Math.min(current > idx ? current - 1 : current, nextSlides.length - 1));
    setVisibleSlideIdx((current) => current === null ? null : Math.min(current > idx ? current - 1 : current, nextSlides.length - 1));
    setNotesTranslation(null);
    saveDockNoteTranslation(selectedNote.id, null);
    showToast(t("notes.slideDeleted"), "info");
  }, [notes, selectedNote, selectedNoteSlides, showToast, t]);

  const handleReorderNoteSlide = useCallback((sourceIdx: number, targetIdx: number) => {
    if (!selectedNote || sourceIdx === targetIdx || sourceIdx < 0 || targetIdx < 0) return;
    if (sourceIdx >= selectedNoteSlides.length || targetIdx >= selectedNoteSlides.length) return;

    const nextSlides = [...selectedNoteSlides];
    const [moved] = nextSlides.splice(sourceIdx, 1);
    nextSlides.splice(targetIdx, 0, moved);

    const updated: DockNote = {
      ...selectedNote,
      content: serializeNoteSlides(selectedNote, nextSlides),
      updatedAt: Date.now(),
    };
    const nextNotes = notes.map((note) => note.id === updated.id ? updated : note);
    setNotes(nextNotes);
    saveDockNotes(nextNotes);
    setSelectedNote(updated);

    setSelectedSlideIdx((current) => {
      if (current === null) return targetIdx;
      if (current === sourceIdx) return targetIdx;
      if (sourceIdx < targetIdx) {
        if (current > sourceIdx && current <= targetIdx) return current - 1;
      } else {
        if (current >= targetIdx && current < sourceIdx) return current + 1;
      }
      return current;
    });

    setVisibleSlideIdx((current) => {
      if (current === null) return null;
      if (current === sourceIdx) return targetIdx;
      if (sourceIdx < targetIdx) {
        if (current > sourceIdx && current <= targetIdx) return current - 1;
      } else {
        if (current >= targetIdx && current < sourceIdx) return current + 1;
      }
      return current;
    });

    showToast(t("notes.slideReordered", "Slide reordered"), "info");
  }, [notes, selectedNote, selectedNoteSlides, showToast, t]);

  const handleAddWholeNoteToSchedule = useCallback((note: DockNote) => {
    const selectedTheme = overlayMode === "fullscreen" ? selectedFSTheme : selectedLTTheme;
    const theme = getDockNotesThemeForMode(selectedTheme, overlayMode);
    const quickSettings = overlayMode === "fullscreen" ? fullscreenQuickSettings : lowerThirdQuickSettings;
    const themeSettings = resolveNotesOutputThemeSettings(selectedTheme, overlayMode, quickSettings);

    addWholeNoteToActiveSchedule({
      noteTitle: getNoteDisplayTitle(note),
      noteContent: note.content,
      noteId: note.id,
      overlayMode,
      theme: theme.id,
      bibleThemeSettings: themeSettings as unknown as Record<string, unknown> | null,
    });
    showToast(t("schedule.addedNoteToSchedule", { defaultValue: `Added "${getNoteDisplayTitle(note)}" to Schedule` }), "success");
  }, [fullscreenQuickSettings, lowerThirdQuickSettings, overlayMode, selectedFSTheme, selectedLTTheme, showToast, t]);

  const handleAddNoteSlideToSchedule = useCallback((slideIdx: number) => {
    const slide = selectedNoteSlides[slideIdx];
    if (!slide || !selectedNote) return;

    const selectedTheme = overlayMode === "fullscreen" ? selectedFSTheme : selectedLTTheme;
    const theme = getDockNotesThemeForMode(selectedTheme, overlayMode);
    const quickSettings = overlayMode === "fullscreen" ? fullscreenQuickSettings : lowerThirdQuickSettings;
    const themeSettings = resolveNotesOutputThemeSettings(selectedTheme, overlayMode, quickSettings);

    addNoteToActiveSchedule({
      noteTitle: selectedNoteDisplayTitle || selectedNote.title,
      slideIndex: slideIdx,
      slideText: stripLeadingVerseMarker(slide.text),
      overlayMode,
      theme: theme.id,
      bibleThemeSettings: themeSettings as unknown as Record<string, unknown> | null,
    });
    showToast(t("schedule.addedSlideToSchedule", { defaultValue: `Added slide to Schedule` }), "success");
  }, [fullscreenQuickSettings, lowerThirdQuickSettings, overlayMode, selectedFSTheme, selectedLTTheme, selectedNote, selectedNoteDisplayTitle, selectedNoteSlides, showToast, t]);

  const handleDeleteNote = useCallback((targetNote: DockNote) => {
    const nextNotes = notes.filter((n) => n.id !== targetNote.id);
    setNotes(nextNotes);
    saveDockNotes(nextNotes);
    if (selectedNote?.id === targetNote.id) {
      setSelectedNote(null);
      setSelectedSlideIdx(null);
      setVisibleSlideIdx(null);
    }
    setNoteDeleteTarget(null);
    showToast(t("notes.noteDeleted", { defaultValue: "Note deleted" }), "info");
  }, [notes, selectedNote?.id, showToast, t]);

  const handleNotesTranslationChange = useCallback((next: DockTranslationValue | null) => {
    notesTranslationChangeRef.current = true;
    setNotesTranslation(next);
    if (selectedNote?.id) {
      saveDockNoteTranslation(
        selectedNote.id,
        next?.sourceSignature === notesTranslationSourceSignature ? next : null,
      );
    }
  }, [notesTranslationSourceSignature, selectedNote?.id]);

  const buildNoteObsPayload = useCallback(
    (idx: number, quickSettingsOverride?: DockFullscreenQuickThemeSettings) => {
      if (!selectedNote) return null;
      const slide = selectedNoteSlides[idx];
      if (!slide) return null;
      const selectedTheme = overlayMode === "fullscreen"
        ? selectedFSThemeRef.current
        : selectedLTThemeRef.current;
      const theme = getDockNotesThemeForMode(selectedTheme, overlayMode);
      const quickSettings = quickSettingsOverride
        ?? (overlayMode === "fullscreen" ? fullscreenQuickSettings : lowerThirdQuickSettings);
      const themeSettings = resolveNotesOutputThemeSettings(selectedTheme, overlayMode, quickSettings);
      const slideText = stripLeadingVerseMarker(normalizeDockMultilineText(slide.text));
      const translatedText = normalizeDockMultilineText(effectiveNotesTranslation?.translatedSections[slide.id] ?? "").trim();
      const showBoth = Boolean(effectiveNotesTranslation?.showBoth && translatedText);
      const sectionText = showBoth ? slideText : (translatedText || slideText);
      const translationText = showBoth ? translatedText : "";
      const isVerse = /^(?:verse(?:\s*\d+)?|v\d+)$/i.test(slide.label.trim());
      const cleanLabel = isVerse ? "" : slide.label;
      const displayLabel = cleanLabel || selectedNoteDisplayTitle;
      const resolvedThemeSettings = (() => {
        const base = (themeSettings as unknown as Record<string, unknown>) || {};
        if (overlayMode === "lower-third") {
          const baseFont = Number(base.fontSize || 64);
          const baseRefFont = Number(base.refFontSize || 42);
          return {
            ...base,
            fontSize: baseFont > 0 ? baseFont : 64,
            refFontSize: baseRefFont > 0 ? baseRefFont : 42,
          };
        }
        return base;
      })();

      return {
        stageItem: {
          type: "notes" as const,
          label: displayLabel,
          subtitle: selectedNoteDisplayTitle,
          data: {
            sectionText,
            translationText,
            translationOrder: normalizeDockTranslationOrder(effectiveNotesTranslation?.translationOrder),
            sectionLabel: cleanLabel,
            note: selectedNote,
            slideIdx: idx,
            overlayMode,
            theme: theme.id,
            bibleThemeSettings: resolvedThemeSettings,
            liveOverrides: null,
          },
        },
        obsData: {
          sectionText,
          translationText,
          translationOrder: normalizeDockTranslationOrder(effectiveNotesTranslation?.translationOrder),
          sectionLabel: displayLabel,
          songTitle: selectedNoteDisplayTitle,
          overlayMode,
          bibleThemeSettings: resolvedThemeSettings,
          liveOverrides: null,
          backgroundOnly: false,
        },
      };
    },
    [selectedNote, selectedNoteDisplayTitle, selectedNoteSlides, effectiveNotesTranslation, overlayMode, selectedFSTheme, selectedLTTheme, fullscreenQuickSettings, lowerThirdQuickSettings],
  );

  const pushNoteSlide = useCallback(
    (
      idx: number,
      quickSettingsOverride?: DockFullscreenQuickThemeSettings,
      fitOptions?: DockOverlayFitOptions,
      pushOptions?: { bypassSceneRoute?: boolean },
    ) => {
      if (hasSceneRoute && !notesSceneRouteConfirmedRef.current && !pushOptions?.bypassSceneRoute) {
        setPendingNotesRouteConfirm({ idx, quickSettingsOverride, fitOptions });
        return;
      }
      void dockObsClient.ensureModuleSourceOpenAndOnTop("notes", overlayMode);
      const payload = buildNoteObsPayload(idx, quickSettingsOverride);
      if (!payload) return;
      const visibilityEpoch = visibilityEpochRef.current;
      setActionError("");
      setSelectedSlideIdx(idx);
      setVisibleSlideIdx(idx);
      onStage(payload.stageItem);

      if (presentationLinkMode) {
        setOverlayVisible(true);
        return;
      }

      const pushLive = () => (hasSceneRoute && !pushOptions?.bypassSceneRoute)
        ? pushNotesToConfiguredOutput(payload.obsData, fitOptions, pushOptions)
        : payload.obsData.overlayMode === "lower-third"
        ? dockObsClient.pushNotesOverlayFast(payload.obsData, fitOptions)
        : pushNotesToConfiguredOutput(payload.obsData, fitOptions, pushOptions);
      if (fitOptions?.waitForFit) {
        return pushLive()
          .then((measurement) => {
            if (visibilityEpoch !== visibilityEpochRef.current) return measurement;
            setOverlayVisible(true);
            return measurement;
          })
          .catch((err) => {
            console.warn("[DockNotesTab] Save-time overlay measurement failed:", err);
            return null;
          });
      }
      pushLive()
        .then(() => {
          if (visibilityEpoch !== visibilityEpochRef.current) return;
          setOverlayVisible(true);
        })
        .catch((err) => {
          console.warn("[DockNotesTab] OBS push failed:", err);
          setActionError(err instanceof Error ? err.message : String(err));
        });
    },
    [buildNoteObsPayload, hasSceneRoute, onStage, overlayMode, presentationLinkMode, pushNotesToConfiguredOutput, sceneRoute.syncPresentation],
  );

  const handleAutoAdvanceStart = useCallback((startIndex: number) => {
    if (startIndex !== selectedNoteAutoAdvanceIndex) return;
    const startSlideIndex = activeSlideIndex ?? (selectedNoteSlides.length > 0 ? 0 : null);
    if (startSlideIndex !== null) pushNoteSlide(startSlideIndex);
  }, [activeSlideIndex, pushNoteSlide, selectedNoteAutoAdvanceIndex, selectedNoteSlides.length]);

  const handleAutoAdvanceNoteStep = useCallback(
    (currentNoteIndex: number, nextItemIndex: number | null) => {
      if (!selectedNote || currentNoteIndex !== selectedNoteAutoAdvanceIndex) return;

      const nextSlideIndex = activeSlideIndex === null ? undefined : activeSlideIndex + 1;
      if (nextSlideIndex !== undefined && nextSlideIndex < selectedNoteSlides.length) {
        pushNoteSlide(nextSlideIndex);
        return { handled: true, nextIndex: currentNoteIndex };
      }

      // A loop stays inside this note and returns to its first slide. A null
      // candidate means stop-at-end, so the control finishes the run.
      if (nextItemIndex === currentNoteIndex) {
        if (selectedNoteSlides.length > 0) pushNoteSlide(0);
        return { handled: true, nextIndex: currentNoteIndex };
      }

      return;
    },
    [
      activeSlideIndex,
      pushNoteSlide,
      selectedNote,
      selectedNoteAutoAdvanceIndex,
      selectedNoteSlides.length,
    ],
  );

  const activeNoteQuickSettings = useMemo(
    () => getNoteQuickSettings(
      overlayMode,
      selectedFSTheme,
      selectedLTTheme,
      fullscreenQuickSettings,
      lowerThirdQuickSettings,
    ),
    [fullscreenQuickSettings, lowerThirdQuickSettings, overlayMode, selectedFSTheme, selectedLTTheme],
  );

  const handleNotesQuickCommit = useCallback((
    patch: DockOutputQuickSettingsPatch,
    nextLineCount?: number,
    nextLineMode?: DockOutputLineMode,
  ) => {
    const isFullscreen = overlayMode === "fullscreen";
    const fullscreenTheme = selectedFSThemeRef.current;
    const lowerThirdTheme = selectedLTThemeRef.current;
    let nextFullscreenSettings = fullscreenQuickSettings;
    let nextLowerThirdSettings = lowerThirdQuickSettings;
    // A ready-made layer theme reads its own size / bold / italic fields, not the plain font settings.
    const layerTheme = isFullscreen
      ? getDockNotesThemeForMode(fullscreenTheme, "fullscreen")
      : getDockNotesThemeForMode(lowerThirdTheme, "lower-third");
    const layerCurrent = isFullscreen ? fullscreenQuickSettings : lowerThirdQuickSettings;
    patch = withLayerThemeQuickPatch(patch, {
      layout: layerTheme.settings.layout,
      mode: isFullscreen ? "fullscreen" : "lower-third",
      adjustSource: { ...layerTheme.settings, ...(layerCurrent ?? {}) },
      previousFontSize: layerCurrent?.fontSize ?? layerTheme.settings.fontSize,
    });

    if (isFullscreen) {
      const fullscreenBase = fullscreenQuickSettings
        ?? (() => {
          const settings = getDockNotesThemeForMode(fullscreenTheme, "fullscreen").settings;
          return {
            ...(settings as unknown as DockFullscreenQuickThemeSettings),
            autoFontScale: false,
          };
        })();
      nextFullscreenSettings = normalizeExplicitOutputFontSettings(
        { ...fullscreenBase, ...patch, autoFontScale: false },
        "fullscreen",
      );
      setFullscreenQuickSettings(nextFullscreenSettings);
      liveFullscreenThemeSettingsRef.current = resolveNotesOutputThemeSettings(
        fullscreenTheme,
        "fullscreen",
        nextFullscreenSettings,
      ) as unknown as Record<string, unknown>;
    } else {
      const lowerThirdBase = lowerThirdQuickSettings
        ?? (() => {
          const settings = getDockNotesThemeForMode(lowerThirdTheme, "lower-third").settings;
          return {
            ...(settings as unknown as DockFullscreenQuickThemeSettings),
            autoFontScale: false,
          };
        })();
      nextLowerThirdSettings = normalizeExplicitOutputFontSettings(
        { ...lowerThirdBase, ...patch, autoFontScale: false },
        "lower-third",
      );
      setLowerThirdQuickSettings(nextLowerThirdSettings);
      liveLowerThirdThemeSettingsRef.current = resolveNotesOutputThemeSettings(
        lowerThirdTheme,
        "lower-third",
        nextLowerThirdSettings,
      ) as unknown as Record<string, unknown>;
    }

    // Mode and count arrive together ("count" + 3). Build ONE note update so the second half can
    // never overwrite the first (the old code spread the same stale note twice, so the saved note
    // lost autoSplit and fell back to "original" = one block per slide).
    const notePatch: Partial<DockNote> = {};
    if (nextLineMode !== undefined) {
      const nextAutoSplit = nextLineMode !== "original";
      setNotesAutoSplit(nextAutoSplit);
      notePatch.autoSplit = nextAutoSplit;
    }
    if (nextLineCount !== undefined) {
      const clamped = clampNoteLinesPerSlide(nextLineCount);
      setNotesLinesPerSlide(clamped);
      if (isFullscreen) {
        setFullscreenLinesPerSlide(clamped);
      } else {
        setLowerThirdLinesPerSlide(clamped);
      }
      notePatch.linesPerSlide = clamped;
    }
    if (nextLineMode !== undefined || nextLineCount !== undefined) {
      setSelectedSlideIdx(0);
      setVisibleSlideIdx(null);
      const current = selectedNoteRef.current;
      if (current) {
        const updated = { ...current, ...notePatch };
        selectedNoteRef.current = updated;
        setSelectedNote(updated);
        const nextNotes = notesRef.current.map((n) => (n.id === updated.id ? updated : n));
        notesRef.current = nextNotes;
        setNotes(nextNotes);
        saveDockNotes(nextNotes);
      }
    }
    const lineLayoutChanged = nextLineCount !== undefined || nextLineMode !== undefined;
    if (overlayVisible && activeSlideIndex !== null && !lineLayoutChanged) {
      // Publish the exact settings selected by the operator. Waiting for the
      // state update effect here can send the previous font size to OBS when
      // the same note remains live.
      const nextSettings = isFullscreen
        ? nextFullscreenSettings
        : nextLowerThirdSettings;
      void pushNoteSlide(activeSlideIndex, nextSettings ?? undefined);
    } else if (overlayVisible && activeSlideIndex !== null) {
      pendingQuickSettingsRefreshRef.current = true;
      setQuickSettingsRefreshNonce((current) => current + 1);
    }
  }, [activeSlideIndex, fullscreenQuickSettings, lowerThirdQuickSettings, overlayMode, overlayVisible, pushNoteSlide]);

  const isFullscreen = overlayMode === "fullscreen";
  const activeNoteSizePresets = isFullscreen
    ? DOCK_QUICK_SIZE_OPTIONS_FULLSCREEN
    : DOCK_QUICK_SIZE_OPTIONS_LOWER_THIRD;

  const activeNoteSizePreset = useMemo(() => {
    const quickSettings = isFullscreen ? fullscreenQuickSettings : lowerThirdQuickSettings;
    const theme = isFullscreen
      ? getDockNotesThemeForMode(selectedFSTheme, "fullscreen")
      : getDockNotesThemeForMode(selectedLTTheme, "lower-third");
    const currentPreset = quickSettings?.lowerThirdSize ?? theme.settings.lowerThirdSize;
    return activeNoteSizePresets.find((option) => option.preset === currentPreset)?.id;
  }, [activeNoteSizePresets, fullscreenQuickSettings, isFullscreen, lowerThirdQuickSettings, selectedFSTheme, selectedLTTheme]);

  const getNotesQuickSizePatch = useCallback((id: string): DockOutputQuickSettingsPatch | null => {
    const isFullscreen = overlayMode === "fullscreen";
    const sizeOptions = isFullscreen
      ? DOCK_QUICK_SIZE_OPTIONS_FULLSCREEN
      : DOCK_QUICK_SIZE_OPTIONS_LOWER_THIRD;
    const option = sizeOptions.find((item) => item.id === id);
    if (!option) return null;
    const preset = LOWER_THIRD_SIZE_PRESETS[option.preset];
    const minFontSize = isFullscreen ? 16 : LOWER_THIRD_FIT_MIN_FONT_SIZE;
    const minRefFontSize = overlayMode === "fullscreen"
      ? 10
      : LOWER_THIRD_FIT_MIN_REFERENCE_FONT_SIZE;
    const maxRefFontSize = overlayMode === "fullscreen"
      ? 150
      : LOWER_THIRD_REFERENCE_FONT_SIZE_MAX;
    const cardPadding = option.cardPadding ?? preset.padding;
    const horizontalPadding = Math.round(cardPadding * 1.55);
    const fontSize = Math.max(minFontSize, option.fontSize);
    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
    const refFontSize = clamp(option.refFontSize, minRefFontSize, maxRefFontSize);
    return {
      fontSize,
      refFontSize,
      lineHeight: preset.lineHeight,
      refSpacing: preset.refSpacing,
      lowerThirdSize: option.preset,
      lowerThirdWidthPreset: lowerThirdQuickSettings?.lowerThirdWidthPreset === "full" ? "full" : option.width,
      lowerThirdCardPadding: `${cardPadding}px ${horizontalPadding}px`,
      lowerThirdBarMaxHeight: option.cardMaxHeight ?? preset.maxHeight,
    };
  }, [lowerThirdQuickSettings?.lowerThirdWidthPreset, overlayMode]);

  const handleNotesQuickActionsPositionChange = useCallback((top: number, left: number | null) => {
    setQuickActionsTop(top);
    setQuickActionsLeft(left);
  }, []);

  useEffect(() => {
    if (!pendingQuickSettingsRefreshRef.current) return;
    if (!overlayVisible || activeSlideIndex === null) {
      pendingQuickSettingsRefreshRef.current = false;
      return;
    }
    pendingQuickSettingsRefreshRef.current = false;
    // Only refresh an output that is already visible. Quick settings must not
    // publish a hidden or not-yet-presented note.
    pushNoteSlide(activeSlideIndex);
  }, [activeSlideIndex, overlayVisible, pushNoteSlide, quickSettingsRefreshNonce]);

  useEffect(() => {
    if (!notesTranslationChangeRef.current) return;
    notesTranslationChangeRef.current = false;
    if (activeSlideIndex === null || !overlayVisible || visibleSlideIdx === null) return;
    pushNoteSlide(activeSlideIndex);
  }, [activeSlideIndex, effectiveNotesTranslation, overlayVisible, pushNoteSlide, visibleSlideIdx]);

  const handleClear = useCallback(async () => {
    if (visibilityActionInFlightRef.current) return;
    visibilityActionInFlightRef.current = true;
    setVisibilityActionPending(true);
    const visibilityEpoch = ++visibilityEpochRef.current;
    setActionError("");
    try {
      if (presentationLinkMode) {
        if (overlayVisible) {
          onStage(null);
          setOverlayVisible(false);
        } else if (activeSlideIndex !== null) {
          pushNoteSlide(activeSlideIndex);
          if (visibilityEpoch === visibilityEpochRef.current) setOverlayVisible(true);
        }
        return;
      }
      await ensureObsConnected();
      if (overlayVisible) {
        // Hide locally first so an older push completion cannot repaint Notes.
        setOverlayVisible(false);
        // Play the overlay's exit animation before the source is hidden.
        await dockObsClient.animateOutPresentationOverlay("notes", {
          mode: overlayMode,
          includePresentation: !hasSceneRoute || sceneRoute.syncPresentation,
          targets: hasSceneRoute ? sceneRoute.targets : [],
        }).catch(() => { });
        await clearNotesFromConfiguredOutput();
      } else if (activeSlideIndex !== null) {
        await pushNoteSlide(activeSlideIndex);
        if (visibilityEpoch === visibilityEpochRef.current) setOverlayVisible(true);
      }
    } catch (err) {
      console.warn("[DockNotesTab] Toggle failed:", err);
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      visibilityActionInFlightRef.current = false;
      setVisibilityActionPending(false);
    }
  }, [overlayVisible, activeSlideIndex, clearNotesFromConfiguredOutput, hasSceneRoute, overlayMode, presentationLinkMode, pushNoteSlide, sceneRoute.syncPresentation, sceneRoute.targets]);

  const handleConfirmNotesRoute = useCallback(() => {
    if (!pendingNotesRouteConfirm) return;
    notesSceneRouteConfirmedRef.current = true;
    const { idx, quickSettingsOverride, fitOptions } = pendingNotesRouteConfirm;
    setPendingNotesRouteConfirm(null);
    void pushNoteSlide(idx, quickSettingsOverride, fitOptions, { bypassSceneRoute: false });
  }, [pendingNotesRouteConfirm, pushNoteSlide]);

  const handleSendNotesToMceAlone = useCallback(async () => {
    if (!pendingNotesRouteConfirm) return;
    const { idx, quickSettingsOverride, fitOptions } = pendingNotesRouteConfirm;
    setPendingNotesRouteConfirm(null);
    updateSceneRoute({ enabled: false });
    if (sceneRoute.targets.length > 0) {
      await Promise.allSettled(sceneRoute.targets.map((t) => (
        dockObsClient.clearSceneRouteSource("notes", t.sceneName)
      )));
    }
    void pushNoteSlide(idx, quickSettingsOverride, fitOptions, { bypassSceneRoute: true });
  }, [pendingNotesRouteConfirm, pushNoteSlide, sceneRoute.targets, updateSceneRoute]);

  const handleCancelNotesRouteConfirm = useCallback(() => {
    setPendingNotesRouteConfirm(null);
  }, []);

  const handleOverlayModeChange = useCallback((nextMode: OverlayMode) => {
    if (nextMode === overlayMode) return;

    setOverlayMode(nextMode);
    const targetLineCount = nextMode === "fullscreen" ? fullscreenLinesPerSlide : lowerThirdLinesPerSlide;
    setNotesLinesPerSlide(targetLineCount);
    const prefs = loadDockNotesPreferences();
    prefs.overlayMode = nextMode;
    prefs.linesPerSlide = targetLineCount;
    prefs.fullscreenLinesPerSlide = fullscreenLinesPerSlide;
    prefs.lowerThirdLinesPerSlide = lowerThirdLinesPerSlide;
    saveDockNotesPreferences(prefs);
    trackOverlayModeSwitched("notes", nextMode);

    if (overlayVisible && activeSlideIndex !== null) {
      pendingQuickSettingsRefreshRef.current = true;
      setQuickSettingsRefreshNonce((current) => current + 1);
    }

    if (nextMode === "lower-third") {
      liveLowerThirdThemeSettingsRef.current = resolveNotesOutputThemeSettings(
        selectedLTThemeRef.current,
        "lower-third",
        lowerThirdQuickSettings,
      ) as unknown as Record<string, unknown>;
    }
  }, [activeSlideIndex, fullscreenLinesPerSlide, lowerThirdLinesPerSlide, lowerThirdQuickSettings, overlayMode, overlayVisible]);

  // Persist theme preferences on change
  useEffect(() => {
    if (!prefsReadyRef.current) return;
    const prefs = loadDockNotesPreferences();
    prefs.fullscreenThemeId = selectedFSTheme.id;
    prefs.lowerThirdThemeId = selectedLTTheme.id;
    saveDockNotesPreferences(prefs);
  }, [selectedFSTheme.id, selectedLTTheme.id]);

  // Persist quick settings on change
  useEffect(() => {
    const prefs = loadDockNotesPreferences();
    prefs.fullscreenQuickSettings = fullscreenQuickSettings;
    prefs.lowerThirdQuickSettings = lowerThirdQuickSettings;
    prefs.linesPerSlide = notesLinesPerSlide;
    prefs.fullscreenLinesPerSlide = fullscreenLinesPerSlide;
    prefs.lowerThirdLinesPerSlide = lowerThirdLinesPerSlide;
    prefs.autoSplit = notesAutoSplit;
    prefs.quickActionsTop = quickActionsTop;
    prefs.quickActionsLeft = quickActionsLeft;
    prefs.quickUpdateImmediately = quickUpdateImmediately;
    saveDockNotesPreferences(prefs);
  }, [fullscreenLinesPerSlide, fullscreenQuickSettings, lowerThirdLinesPerSlide, lowerThirdQuickSettings, notesAutoSplit, notesLinesPerSlide, quickActionsLeft, quickActionsTop, quickUpdateImmediately]);

  useEffect(() => {
    const handleThemeSync = (event: Event) => {
      const customEvent = event as CustomEvent<DockThemeSyncPayload>;
      const payload = customEvent.detail;
      if (!payload || !payload.targetTabs.includes("notes")) return;

      const { targetModes, quickSettings, theme, themeId, sourceTab, sourceMode } = payload;
      const findTheme = (mode: "fullscreen" | "lower-third", id: string | null | undefined): BibleTheme | null => {
        if (!id) return null;
        if (theme && theme.id === id) return theme;
        return getFallbackDockNotesTheme(mode, id);
      };

      if (targetModes.includes("fullscreen")) {
        const fsTheme = theme ?? findTheme("fullscreen", themeId);
        const fsSettings = normalizeExplicitOutputFontSettings(quickSettings, "fullscreen");
        if (fsTheme) {
          setSelectedFSTheme(fsTheme);
          selectedFSThemeRef.current = fsTheme;
        }
        setFullscreenQuickSettings(fsSettings);
        liveFullscreenThemeSettingsRef.current = resolveNotesOutputThemeSettings(
          fsTheme ?? selectedFSThemeRef.current,
          "fullscreen",
          fsSettings,
        ) as unknown as Record<string, unknown>;
      }

      if (targetModes.includes("lower-third")) {
        const ltTheme = theme ?? findTheme("lower-third", themeId);
        const ltSettings = normalizeExplicitOutputFontSettings(quickSettings, "lower-third");
        if (ltTheme) {
          setSelectedLTTheme(ltTheme);
          selectedLTThemeRef.current = ltTheme;
        }
        setLowerThirdQuickSettings(ltSettings);
        liveLowerThirdThemeSettingsRef.current = resolveNotesOutputThemeSettings(
          ltTheme ?? selectedLTThemeRef.current,
          "lower-third",
          ltSettings,
        ) as unknown as Record<string, unknown>;
      }

      if (targetModes.includes(overlayMode) && (sourceTab !== "notes" || sourceMode !== overlayMode)) {
        const activeSettings = overlayMode === "fullscreen"
          ? normalizeExplicitOutputFontSettings(quickSettings, "fullscreen")
          : normalizeExplicitOutputFontSettings(quickSettings, "lower-third");

        // Only re-send a note that was really projected from this tab and is
        // still on air (`overlayVisible` starts as true, and Worship may now
        // be showing on the shared source). Mirrors the Worship tab.
        const notesIsOnAir = overlayVisible
          && visibleSlideIdx !== null
          && activeSlideIndex !== null
          && !dockObsClient.isSharedWorshipNotesSourceHeldByOther("notes");
        if (notesIsOnAir) {
          void pushNoteSlide(activeSlideIndex, activeSettings);
        } else {
          const currentThemeSettings = overlayMode === "fullscreen"
            ? liveFullscreenThemeSettingsRef.current
            : liveLowerThirdThemeSettingsRef.current;
          void dockObsClient.primeNotesOverlay({
            overlayMode,
            bibleThemeSettings: currentThemeSettings,
            backgroundOnly: true,
          });
        }
      }
    };

    window.addEventListener(DOCK_THEME_SYNC_EVENT, handleThemeSync);
    return () => window.removeEventListener(DOCK_THEME_SYNC_EVENT, handleThemeSync);
  }, [
    activeSlideIndex,
    overlayMode,
    overlayVisible,
    pushNoteSlide,
    visibleSlideIdx,
  ]);

  // A theme was edited in the app: swap in the new copy of the selected one so bold,
  // colours, backgrounds and layers show up without reselecting it.
  useEffect(() => {
    const handleThemesRefreshed = (event: Event) => {
      const themes = (event as CustomEvent<DockThemesRefreshedDetail>).detail?.themes ?? [];
      const freshFS = findRefreshedTheme(selectedFSThemeRef.current, themes, "fullscreen");
      const freshLT = findRefreshedTheme(selectedLTThemeRef.current, themes, "lower-third");
      if (!freshFS && !freshLT) return;

      if (freshFS) {
        setSelectedFSTheme(freshFS);
        selectedFSThemeRef.current = freshFS;
        // Layer themes keep the operator's size / background tweaks; classic themes
        // restart from the edited look because saved quick settings are a copy of the old one.
        const keep = themeUsesLayout(freshFS, "fullscreen") ? fullscreenQuickSettings : null;
        if (!keep) setFullscreenQuickSettings(null);
        liveFullscreenThemeSettingsRef.current = resolveNotesOutputThemeSettings(
          freshFS,
          "fullscreen",
          keep,
        ) as unknown as Record<string, unknown>;
      }
      if (freshLT) {
        setSelectedLTTheme(freshLT);
        selectedLTThemeRef.current = freshLT;
        const keep = themeUsesLayout(freshLT, "lower-third") ? lowerThirdQuickSettings : null;
        if (!keep) setLowerThirdQuickSettings(null);
        liveLowerThirdThemeSettingsRef.current = resolveNotesOutputThemeSettings(
          freshLT,
          "lower-third",
          keep,
        ) as unknown as Record<string, unknown>;
      }

      // Re-send the note on air with the edited theme, once the new theme state has rendered.
      const affectsLiveMode = overlayMode === "fullscreen" ? Boolean(freshFS) : Boolean(freshLT);
      if (
        affectsLiveMode
        && overlayVisible
        && visibleSlideIdx !== null
        && activeSlideIndex !== null
        && !dockObsClient.isSharedWorshipNotesSourceHeldByOther("notes")
      ) {
        pendingQuickSettingsRefreshRef.current = true;
        setQuickSettingsRefreshNonce((current) => current + 1);
      }
    };

    window.addEventListener(DOCK_THEMES_REFRESHED_EVENT, handleThemesRefreshed);
    return () => window.removeEventListener(DOCK_THEMES_REFRESHED_EVENT, handleThemesRefreshed);
  }, [
    activeSlideIndex,
    fullscreenQuickSettings,
    lowerThirdQuickSettings,
    overlayMode,
    overlayVisible,
    visibleSlideIdx,
  ]);

  // Escape key handler
  useEffect(() => {
    if (!isActive) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      const targetElement = target instanceof Element ? target : null;
      if (event.key === "Escape") {
        if (showNotesBrowserMenu) {
          event.preventDefault();
          setShowNotesBrowserMenu(false);
          return;
        }
        if (showNoteEditor) {
          event.preventDefault();
          setShowNoteEditor(false);
          setEditingNote(null);
          return;
        }
        if (showCompactSummaryActions) {
          event.preventDefault();
          setShowCompactSummaryActions(false);
          return;
        }
        if (targetElement?.closest(".dtb-modal, .dock-dialog")) return;
        if (selectedNote) {
          event.preventDefault();
          setSelectedNote(null);
          setSelectedSlideIdx(null);
          setVisibleSlideIdx(null);
          onStage(null);
          if (!presentationLinkMode) {
            ensureObsConnected().then(() => clearNotesFromConfiguredOutput()).catch(() => { });
          }
          return;
        }
      }
      if (!selectedNote || !selectedNoteSlides.length) return;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        const next = Math.min((activeSlideIndex ?? 0) + 1, selectedNoteSlides.length - 1);
        void pushNoteSlide(next);
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        const prev = Math.max((activeSlideIndex ?? 0) - 1, 0);
        void pushNoteSlide(prev);
      } else if (event.key === "Enter" && activeSlideIndex !== null) {
        event.preventDefault();
        void pushNoteSlide(activeSlideIndex);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isActive, showNoteEditor, showCompactSummaryActions, selectedNote, selectedNoteSlides, activeSlideIndex, clearNotesFromConfiguredOutput, onStage, presentationLinkMode, pushNoteSlide]);

  const renderNotesSearchPanel = () => (
    <section className="dock-console-panel dock-console-panel--toolbar">
      <div className="dock-console-header dock-notes-browser-toolbar">
        <div className="dock-search dock-search--console" style={{ marginBottom: 0 }}>
          <Icon name="search" size={14} className="dock-search__icon" />
          <input
            className="dock-input"
            placeholder={t("notes.searchPlaceholder")}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            aria-label={t("notes.searchPlaceholder")}
          />
          {searchQuery && (
            <button
              type="button"
              className="dock-search__clear"
              onClick={() => setSearchQuery("")}
              aria-label={t("common.clear")}
              title={t("common.clear")}
            >
              <Icon name="close" size={13} />
            </button>
          )}
        </div>
        <div className="dock-console-actions dock-console-actions--song-browser">
          {isConstrained ? (
            <div className="dock-notes-browser-overflow-wrap" ref={notesBrowserMenuRef} style={{ position: "relative" }}>
              <button
                type="button"
                className="dock-console-toggle dock-console-toggle--icon-only"
                onClick={() => setShowNotesBrowserMenu((prev) => !prev)}
                title={t("common.moreActions", "More actions")}
                aria-label={t("common.moreActions", "More actions")}
                aria-expanded={showNotesBrowserMenu}
                aria-haspopup="menu"
              >
                <Icon name="more_vert" size={14} />
              </button>
              {showNotesBrowserMenu && (
                <div
                  className="dock-bible-actions__menu dock-notes-actions__menu"
                  role="menu"
                  style={{ top: "calc(100% + 4px)", right: 0, width: "180px", minWidth: "160px", zIndex: 250 }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className="dock-bible-actions__menu-item-entry"
                    role="menuitem"
                    onClick={() => {
                      setShowNotesBrowserMenu(false);
                      openNewNote();
                    }}
                  >
                    <Icon name="add" size={16} />
                    <span>{t("notes.addNote", "Add Note")}</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <DockSceneRoutingControl
                module="notes"
                route={sceneRoute}
                onRouteChange={updateSceneRoute}
                disabled={presentationLinkMode}
                title={t("notes.output")}
                itemLabel={t("notes.note", "note")}
                onSend={(opts) => {
                  const targetSlideIndex = activeSlideIndex ?? (selectedNoteSlides.length > 0 ? 0 : null);
                  if (targetSlideIndex !== null) {
                    if (opts?.bypassSceneRoute) {
                      notesSceneRouteConfirmedRef.current = false;
                    } else {
                      notesSceneRouteConfirmedRef.current = true;
                    }
                    void pushNoteSlide(targetSlideIndex, undefined, undefined, {
                      bypassSceneRoute: opts?.bypassSceneRoute,
                    });
                  }
                }}
              />
              <button
                type="button"
                className="dock-console-toggle dock-console-toggle--primary dock-console-toggle--add"
                onClick={openNewNote}
                title={t("notes.addNote")}
                aria-label={t("notes.addNote")}
              >
                <Icon name="add" size={13} />
                <span className="dock-console-toggle__label">{t("common.add")}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );

  const renderNoteSlidesSearchPanel = () => (
    <section className="dock-console-panel dock-console-panel--toolbar dock-worship-lyrics-search">
      <div className="dock-media-search dock-media-search--plain">
        <input
          className="dock-media-search__input"
          placeholder={t("notes.searchSlidesPlaceholder")}
          value={noteSlidesSearchQuery}
          onChange={(event) => setNoteSlidesSearchQuery(event.target.value)}
          aria-label={t("notes.searchSlidesPlaceholder")}
        />
        {noteSlidesSearchQuery && (
          <button
            type="button"
            className="dock-media-search__clear"
            onClick={() => setNoteSlidesSearchQuery("")}
            aria-label={t("common.clear")}
            title={t("common.close")}
          >
            <Icon name="close" size={13} />
          </button>
        )}
      </div>
    </section>
  );

  return (
    <div className="dock-module dock-module--worship">
      {!selectedNote ? (
        <>
          {searchPlacement !== "bottom" && renderNotesSearchPanel()}

          <section className="dock-console-panel dock-console-panel--workspace dock-worship-workspace">
            {filteredNotes.length === 0 ? (
              <div className="dock-empty dock-worship-workspace__empty">
                <Icon name={notes.length === 0 ? "sticky_note_2" : "search_off"} size={20} />
                <div className="dock-empty__title">
                  {notes.length === 0 ? t("notes.noNotesYet") : t("notes.noNotesMatch")}
                </div>
                <div className="dock-empty__text">
                  {notes.length === 0 ? t("notes.createFirstHint") : t("notes.noResultsFor", { query: searchQuery })}
                </div>
              </div>
            ) : (
              <div
                className="dock-console-list dock-worship-workspace__list"
                onScroll={handleNotesListScroll}
              >
                {renderedNotes.map((note) => (
                  <div
                    key={note.id}
                    className="dock-card dock-card--console dock-song-card dock-notes-card"
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setNoteContextMenu({
                        x: Math.min(event.clientX, window.innerWidth - 220),
                        y: Math.min(event.clientY, window.innerHeight - 200),
                        note,
                      });
                    }}
                  >
                    <button
                      type="button"
                      className="dock-song-card__main"
                      onClick={() => {
                        setSelectedNote(note);
                        setSelectedSlideIdx(0);
                        setVisibleSlideIdx(null);
                        setNoteSlidesSearchQuery("");
                        setNotesAutoSplit(note.autoSplit ?? false);
                        if (typeof note.linesPerSlide === "number") {
                          setNotesLinesPerSlide(clampNoteLinesPerSlide(note.linesPerSlide));
                        }
                      }}
                      title={note.title}
                    >
                      <span className="dock-card__title">{getNoteDisplayTitle(note)}</span>
                      <span className="dock-card__subtitle">
                        {extractStructuredTextTitle(normalizeDockMultilineText(note.content)).body.split("\n")[0]?.substring(0, 80) || t("notes.noContent")}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="dock-song-card__schedule"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAddWholeNoteToSchedule(note);
                      }}
                      aria-label={`${t("schedule.addToSchedule", "Add to Schedule")} ${getNoteDisplayTitle(note)}`}
                      title={t("schedule.addToSchedule", "Add to Schedule")}
                    >
                      <Icon name="playlist_add" size={15} />
                    </button>
                    <button type="button" className="dock-song-card__edit" onClick={() => openEditNote(note)} aria-label={t("common.edit")} title={t("common.edit")}>
                      <Icon name="edit" size={14} />
                    </button>
                    <button
                      type="button"
                      className="dock-song-card__delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        setNoteDeleteTarget(note);
                      }}
                      aria-label={`${t("common.delete", "Delete")} ${getNoteDisplayTitle(note)}`}
                      title={t("common.delete", "Delete")}
                    >
                      <Icon name="delete_outline" size={15} />
                    </button>
                  </div>
                ))}
                {visibleNotesCount < filteredNotes.length && (
                  <div className="dock-worship-load-more" style={{ padding: "8px", textAlign: "center" }}>
                    <button
                      type="button"
                      className="dock-btn dock-btn--ghost dock-btn--compact"
                      onClick={() => setVisibleNotesCount((prev) => Math.min(prev + 40, filteredNotes.length))}
                    >
                      {t("common.loadMore", { defaultValue: "Load more..." })} ({filteredNotes.length - visibleNotesCount} remaining)
                    </button>
                  </div>
                )}
                {noteContextMenu && (
                  <div
                    className="dock-bible-context-menu"
                    style={{
                      position: "fixed",
                      top: `${noteContextMenu.y}px`,
                      left: `${noteContextMenu.x}px`,
                      zIndex: 10000,
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="dock-bible-context-menu__item"
                      onClick={() => {
                        handleAddWholeNoteToSchedule(noteContextMenu.note);
                        setNoteContextMenu(null);
                      }}
                    >
                      <Icon name="playlist_add" size={16} />
                      <span>{t("schedule.addToSchedule", "Add to Schedule")}</span>
                    </button>
                    <button
                      type="button"
                      className="dock-bible-context-menu__item"
                      onClick={() => {
                        setSelectedNote(noteContextMenu.note);
                        setSelectedSlideIdx(0);
                        setVisibleSlideIdx(null);
                        setNoteContextMenu(null);
                      }}
                    >
                      <Icon name="sticky_note_2" size={16} />
                      <span>{t("notes.openNote", "Open Note")}</span>
                    </button>
                    <button
                      type="button"
                      className="dock-bible-context-menu__item"
                      onClick={() => {
                        openEditNote(noteContextMenu.note);
                        setNoteContextMenu(null);
                      }}
                    >
                      <Icon name="edit" size={16} />
                      <span>{t("common.edit", "Edit Note")}</span>
                    </button>
                    <div style={{ height: "1px", background: "rgba(255, 255, 255, 0.08)", margin: "3px 0" }} />
                    <button
                      type="button"
                      className="dock-bible-context-menu__item dock-bible-context-menu__item--danger"
                      style={{ color: "#FCA5A5" }}
                      onClick={() => {
                        setNoteDeleteTarget(noteContextMenu.note);
                        setNoteContextMenu(null);
                      }}
                    >
                      <Icon name="delete_outline" size={16} />
                      <span>{t("common.delete", "Delete Note")}</span>
                    </button>
                  </div>
                )}
                {noteDeleteTarget && (
                  <div className="dock-modal-backdrop" onClick={() => setNoteDeleteTarget(null)}>
                    <div className="dock-modal dock-modal--confirm" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
                      <div className="dock-modal__header">
                        <div className="dock-modal__title">{t("notes.deleteNoteTitle", "Delete Note")}</div>
                      </div>
                      <div className="dock-modal__body">
                        <p>{t("notes.confirmDelete", { title: getNoteDisplayTitle(noteDeleteTarget), defaultValue: `Are you sure you want to delete "${getNoteDisplayTitle(noteDeleteTarget)}"?` })}</p>
                      </div>
                      <div className="dock-modal__footer" style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                        <button type="button" className="dock-btn dock-btn--ghost" onClick={() => setNoteDeleteTarget(null)}>
                          {t("common.cancel", "Cancel")}
                        </button>
                        <button type="button" className="dock-btn dock-btn--danger" onClick={() => handleDeleteNote(noteDeleteTarget)}>
                          {t("common.delete", "Delete")}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
          {searchPlacement !== "top" && (
            <DockBottomSearchPanel
              expanded={bottomSearchExpanded}
              onToggle={() => setBottomSearchExpanded((current) => !current)}
            >
              {renderNotesSearchPanel()}
            </DockBottomSearchPanel>
          )}
        </>
      ) : (
        <>
          <section className="dock-console-panel dock-console-panel--toolbar dock-worship-summary">
            <div className="dock-worship-summary__header">
              <button
                type="button"
                className="dock-worship-back-btn"
                onClick={() => {
                  setSelectedNote(null);
                  setSelectedSlideIdx(null);
                  setVisibleSlideIdx(null);
                  setShowCompactSummaryActions(false);
                }}
                title={t("common.back")}
              >
                <Icon name="arrow_back" size={14} />
              </button>
              <div className="dock-worship-summary__copy">
                <div className="dock-worship-summary__title">{selectedNoteDisplayTitle}</div>
                <div className="dock-worship-summary__meta">
                  <span>{selectedNoteSlides.length} {selectedNoteSlides.length === 1 ? t("notes.slide") : t("notes.slides")}</span>
                  <span className="dock-worship-summary__meta-dot">·</span>
                  <span>{notesAutoSplit
                    ? `${notesLinesPerSlide} ${notesLinesPerSlide === 1 ? t("notes.linePerNote") : t("notes.linesPerNote")}`
                    : t("notes.original", "Original")}</span>
                </div>
              </div>
                {searchPlacement !== "bottom" && <div className="dock-worship-summary__compact-search">
                  <div className="dock-media-search dock-media-search--plain">
                    <input
                      className="dock-media-search__input"
                      placeholder={t("notes.searchSlidesPlaceholder")}
                      value={noteSlidesSearchQuery}
                      onChange={(event) => setNoteSlidesSearchQuery(event.target.value)}
                      aria-label={t("notes.searchSlidesPlaceholder")}
                    />
                    {noteSlidesSearchQuery && (
                      <button
                        type="button"
                        className="dock-media-search__clear"
                        onClick={() => setNoteSlidesSearchQuery("")}
                        aria-label={t("common.clear")}
                        title={t("common.close")}
                      >
                        <Icon name="close" size={13} />
                      </button>
                    )}
                  </div>
                </div>}
                <div className="dock-worship-summary__actions">
                  <button type="button" className="dock-shell-icon-btn" onClick={() => openEditNote(selectedNote)} title={t("notes.editNote")} aria-label={t("notes.editNote")}>
                    <Icon name="edit" size={16} />
                  </button>
                  <div className="dock-worship-summary__overflow-wrap" ref={compactSummaryActionsRef}>
                    <button
                      type="button"
                      className="dock-worship-summary__overflow-trigger"
                      onClick={() => setShowCompactSummaryActions((open) => !open)}
                      aria-label={t("common.moreActions", "More actions")}
                      title={t("common.moreActions", "More actions")}
                      aria-haspopup="menu"
                      aria-expanded={showCompactSummaryActions}
                    >
                      <Icon name="more_vert" size={14} />
                    </button>
                    {showCompactSummaryActions && (
                      <div
                        className="dock-worship-summary__overflow-menu"
                        role="menu"
                        aria-label={t("common.moreActions", "More actions")}
                      >
                        <button
                          type="button"
                          className="dock-worship-summary__menu-btn"
                          role="menuitem"
                          onClick={() => {
                            setShowTranslationModal(true);
                            setShowCompactSummaryActions(false);
                          }}
                        >
                          <div className="dock-worship-summary__menu-btn-content">
                            <Icon name="translate" size={16} />
                            <span>{t('common.translate', 'Translate')}</span>
                          </div>
                          {effectiveNotesTranslation && (
                            <span className="dock-worship-summary__menu-btn-badge">
                              {effectiveNotesTranslation.targetLanguageLabel}
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          className="dock-worship-summary__menu-btn"
                          role="menuitem"
                          onClick={() => {
                            setShowAutoAdvanceModal(true);
                            setShowCompactSummaryActions(false);
                          }}
                        >
                          <div className="dock-worship-summary__menu-btn-content">
                            <Icon name="fast_forward" size={16} />
                            <span>{t('autoAdvance.title', 'Set Auto Advance')}</span>
                          </div>
                          {autoAdvanceActive && (
                            <span className="dock-worship-summary__menu-btn-dot" title={t('autoAdvance.running', 'Running')} />
                          )}
                        </button>
                      </div>
                    )}
                    <DockTranslationControls
                      compact
                      compactLabel
                      showTrigger={false}
                      isOpen={showTranslationModal}
                      onOpenChange={setShowTranslationModal}
                      sections={selectedNoteSlides.map((slide) => ({ id: slide.id, text: slide.text }))}
                      value={effectiveNotesTranslation}
                      onChange={handleNotesTranslationChange}
                      onClose={handleCompactSummaryChildClose}
                    />
                    <DockAutoAdvanceControl
                      items={[{ id: selectedNote.id, label: selectedNoteDisplayTitle }]}
                      selectedIndex={selectedNoteAutoAdvanceIndex}
                      onSelectIndex={handleAutoAdvanceNoteSelection}
                      onClose={handleCompactSummaryChildClose}
                      onAdvance={handleAutoAdvanceNoteStep}
                      onStart={handleAutoAdvanceStart}
                      onActiveChange={setAutoAdvanceActive}
                      itemKind="note"
                      storageScope="notes"
                      compactLabel
                      showTrigger={false}
                      isOpen={showAutoAdvanceModal}
                      onOpenChange={setShowAutoAdvanceModal}
                    />
                  </div>
                </div>
              </div>
          </section>

          {searchPlacement !== "bottom" && renderNoteSlidesSearchPanel()}

          <section className="dock-console-panel dock-console-panel--workspace dock-worship-workspace" data-toolbar-collapsed={toolbarCollapsed || undefined}>
            {selectedNoteSlides.length === 0 ? (
              <div className="dock-empty dock-worship-workspace__empty">
                <Icon name="sticky_note_2" size={18} />
                <div className="dock-empty__text">{t("notes.noContentToDisplay")}</div>
              </div>
            ) : filteredNoteSlides.length === 0 ? (
              <div className="dock-empty dock-worship-workspace__empty">
                <Icon name="search_off" size={18} />
                <div className="dock-empty__text">{t("notes.noSlidesMatch", { query: noteSlidesSearchQuery })}</div>
              </div>
            ) : (
              <div
                className={`dock-console-list dock-worship-workspace__list dock-worship-slide-queue${draggingSlideIdx !== null ? " is-reordering" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  const container = event.currentTarget;
                  const rect = container.getBoundingClientRect();
                  const offsetY = event.clientY - rect.top;
                  if (offsetY < 50) {
                    container.scrollTop -= 14;
                  } else if (rect.bottom - event.clientY < 50) {
                    container.scrollTop += 14;
                  }
                }}
                onDrop={(event) => {
                  const sourceIdx = draggingSlideIdx ?? Number(event.dataTransfer.getData("text/plain"));
                  if (Number.isFinite(sourceIdx) && sourceIdx >= 0) {
                    const container = event.currentTarget;
                    const rect = container.getBoundingClientRect();
                    const offsetY = event.clientY - rect.top;
                    const targetIdx = offsetY < rect.height / 2 ? 0 : selectedNoteSlides.length - 1;
                    handleReorderNoteSlide(sourceIdx, targetIdx);
                  }
                  setDraggingSlideIdx(null);
                  setDragOverSlideIdx(null);
                  setDropPosition(null);
                }}
              >
                {filteredNoteSlides.map(({ slide, idx }) => {
                  const isVisible = visibleSlideIdx === idx;
                  const isSelected = selectedSlideIdx === idx;
                  const isDragging = draggingSlideIdx === idx;
                  const isDragOver = dragOverSlideIdx === idx && draggingSlideIdx !== idx;
                  const isVerse = /^(?:verse(?:\s*\d+)?|v\d+)$/i.test(slide.label.trim());
                  const cleanLabel = isVerse ? "" : slide.label;
                  return (
                    <div
                      key={slide.id}
                      draggable={true}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setSlideContextMenu({
                          x: Math.min(event.clientX, window.innerWidth - 220),
                          y: Math.min(event.clientY, window.innerHeight - 250),
                          slideIdx: idx,
                        });
                      }}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/plain", String(idx));
                        event.dataTransfer.effectAllowed = "move";
                        setDraggingSlideIdx(idx);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        const rect = event.currentTarget.getBoundingClientRect();
                        const midY = rect.top + rect.height / 2;
                        const position = event.clientY < midY ? "above" : "below";
                        if (dragOverSlideIdx !== idx || dropPosition !== position) {
                          setDragOverSlideIdx(idx);
                          setDropPosition(position);
                        }
                      }}
                      onDragLeave={(event) => {
                        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                        if (dragOverSlideIdx === idx) {
                          setDragOverSlideIdx(null);
                          setDropPosition(null);
                        }
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const sourceIdx = draggingSlideIdx ?? Number(event.dataTransfer.getData("text/plain"));
                        if (Number.isFinite(sourceIdx) && sourceIdx >= 0) {
                          const rect = event.currentTarget.getBoundingClientRect();
                          const pos = dropPosition || (event.clientY < rect.top + rect.height / 2 ? "above" : "below");
                          const targetIdx = calculateReorderTargetIndex(sourceIdx, idx, pos, selectedNoteSlides.length);
                          handleReorderNoteSlide(sourceIdx, targetIdx);
                        }
                        setDraggingSlideIdx(null);
                        setDragOverSlideIdx(null);
                        setDropPosition(null);
                      }}
                      onDragEnd={() => {
                        setDraggingSlideIdx(null);
                        setDragOverSlideIdx(null);
                        setDropPosition(null);
                      }}
                      className={`dock-worship-slide-card${
                        isVisible ? " dock-worship-slide-card--visible" : ""
                      }${isSelected && !isVisible ? " dock-worship-slide-card--selected" : ""}${
                        isDragging ? " dock-worship-slide-card--dragging" : ""
                      }${
                        isDragOver
                          ? dropPosition === "above"
                            ? " dock-worship-slide-card--drop-above"
                            : " dock-worship-slide-card--drop-below"
                          : ""
                      }`}
                      title={t("notes.clickToView")}
                    >
                      <button type="button" className="dock-worship-slide-card__main" onClick={() => void pushNoteSlide(idx)}>
                        <div className="dock-worship-slide-card__header">
                          <div className="dock-worship-slide-card__label">
                            <div
                              className="dock-worship-slide-card__drag-handle"
                              title={t("common.dragToReorder", "Drag to reorder slide")}
                              aria-label={t("common.dragToReorder", "Drag to reorder slide")}
                            >
                              <Icon name="drag_indicator" size={14} />
                            </div>
                            <span className="dock-worship-slide-card__name">{cleanLabel || `${t("notes.slideLabel")} ${idx + 1}`}</span>
                            <span className="dock-worship-slide-card__index">{idx + 1}</span>
                          </div>
                          <div className="dock-worship-slide-card__badges" />
                        </div>
                        {getOrderedTranslationParts(
                          stripLeadingVerseMarker(slide.text),
                          normalizeDockMultilineText(effectiveNotesTranslation?.translatedSections[slide.id] ?? ""),
                          effectiveNotesTranslation?.showBoth ?? false,
                          effectiveNotesTranslation?.translationOrder,
                        ).map((part, partIndex) => (
                          <div
                            key={`${slide.id}-${part.kind}-${partIndex}`}
                            className={part.kind === "translation"
                              ? `dock-worship-slide-card__translation${partIndex === 0 ? " dock-worship-slide-card__translation--first" : ""}`
                              : "dock-worship-slide-card__text"}
                          >
                            {stripLeadingVerseMarker(normalizeDockMultilineText(part.text))}
                          </div>
                        ))}
                      </button>
                      <div className="dock-worship-slide-card__actions">
                        <button
                          type="button"
                          className="dock-worship-slide-card__action"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleAddNoteSlideToSchedule(idx);
                          }}
                          title={t("schedule.addToSchedule", "Add slide to Schedule")}
                          aria-label={t("schedule.addToSchedule", "Add slide to Schedule")}
                        >
                          <Icon name="playlist_add" size={14} />
                        </button>
                        <button
                          type="button"
                          className="dock-worship-slide-card__action"
                          onClick={(event) => {
                            event.stopPropagation();
                            openNoteSlideEditor(idx);
                          }}
                          title={t("notes.quickEditSlide")}
                          aria-label={t("notes.quickEditSlide")}
                        >
                          <Icon name="edit" size={16} />
                        </button>
                        <button
                          type="button"
                          className="dock-worship-slide-card__action dock-worship-slide-card__action--danger"
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteNoteSlide(idx);
                          }}
                          title={t("notes.deleteSlide")}
                          aria-label={t("notes.deleteSlide")}
                          disabled={selectedNoteSlides.length <= 1}
                        >
                          <Icon name="delete" size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {slideContextMenu && (
              <div
                className="dock-bible-context-menu"
                style={{
                  position: "fixed",
                  top: `${slideContextMenu.y}px`,
                  left: `${slideContextMenu.x}px`,
                  zIndex: 1000,
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="dock-bible-context-menu__item"
                  onClick={() => {
                    handleAddNoteSlideToSchedule(slideContextMenu.slideIdx);
                    setSlideContextMenu(null);
                  }}
                >
                  <Icon name="playlist_add" size={16} />
                  <span>{t("schedule.addToSchedule", "Add slide to Schedule")}</span>
                </button>
                <button
                  type="button"
                  className="dock-bible-context-menu__item"
                  onClick={() => {
                    void pushNoteSlide(slideContextMenu.slideIdx);
                    setSlideContextMenu(null);
                  }}
                >
                  <Icon name="play_arrow" size={16} />
                  <span>{t("common.present", "Present Live")}</span>
                </button>
                <button
                  type="button"
                  className="dock-bible-context-menu__item"
                  onClick={() => {
                    openNoteSlideEditor(slideContextMenu.slideIdx);
                    setSlideContextMenu(null);
                  }}
                >
                  <Icon name="edit" size={16} />
                  <span>{t("notes.quickEditSlide", "Edit Slide")}</span>
                </button>
                <div style={{ height: "1px", background: "rgba(255, 255, 255, 0.08)", margin: "3px 0" }} />
                {slideContextMenu.slideIdx > 0 && (
                  <button
                    type="button"
                    className="dock-bible-context-menu__item"
                    onClick={() => {
                      handleReorderNoteSlide(slideContextMenu.slideIdx, 0);
                      setSlideContextMenu(null);
                    }}
                  >
                    <Icon name="vertical_align_top" size={16} />
                    <span>{t("common.moveToTop", "Move to Top")}</span>
                  </button>
                )}
                {slideContextMenu.slideIdx > 0 && (
                  <button
                    type="button"
                    className="dock-bible-context-menu__item"
                    onClick={() => {
                      handleReorderNoteSlide(slideContextMenu.slideIdx, slideContextMenu.slideIdx - 1);
                      setSlideContextMenu(null);
                    }}
                  >
                    <Icon name="arrow_upward" size={16} />
                    <span>{t("common.moveUp", "Move Up")}</span>
                  </button>
                )}
                {slideContextMenu.slideIdx < selectedNoteSlides.length - 1 && (
                  <button
                    type="button"
                    className="dock-bible-context-menu__item"
                    onClick={() => {
                      handleReorderNoteSlide(slideContextMenu.slideIdx, slideContextMenu.slideIdx + 1);
                      setSlideContextMenu(null);
                    }}
                  >
                    <Icon name="arrow_downward" size={16} />
                    <span>{t("common.moveDown", "Move Down")}</span>
                  </button>
                )}
                {slideContextMenu.slideIdx < selectedNoteSlides.length - 1 && (
                  <button
                    type="button"
                    className="dock-bible-context-menu__item"
                    onClick={() => {
                      handleReorderNoteSlide(slideContextMenu.slideIdx, selectedNoteSlides.length - 1);
                      setSlideContextMenu(null);
                    }}
                  >
                    <Icon name="vertical_align_bottom" size={16} />
                    <span>{t("common.moveToBottom", "Move to Bottom")}</span>
                  </button>
                )}
                <div style={{ height: "1px", background: "rgba(255, 255, 255, 0.08)", margin: "3px 0" }} />
                <button
                  type="button"
                  className="dock-bible-context-menu__item dock-bible-context-menu__item--danger"
                  style={{ color: "#FCA5A5" }}
                  disabled={selectedNoteSlides.length <= 1}
                  onClick={() => {
                    deleteNoteSlide(slideContextMenu.slideIdx);
                    setSlideContextMenu(null);
                  }}
                >
                  <Icon name="delete_outline" size={16} />
                  <span>{t("notes.deleteSlide", "Delete Slide")}</span>
                </button>
              </div>
            )}
            <DockOutputQuickActions
              textLabel={t("notes.text")}
              lineLabel={t("notes.linesPerNote")}
              settings={activeNoteQuickSettings}
              lineCount={notesLinesPerSlide}
              lineMode={notesAutoSplit ? "count" : "original"}
              maxLineCount={MAX_NOTE_LINES_PER_SLIDE}
              minFontSize={overlayMode === "fullscreen" ? 16 : LOWER_THIRD_FIT_MIN_FONT_SIZE}
              updateImmediately={quickUpdateImmediately}
              isLive={overlayVisible}
              top={quickActionsTop}
              left={quickActionsLeft}
              onPositionChange={handleNotesQuickActionsPositionChange}
              onCommit={handleNotesQuickCommit}
              originalLineLabel={t("notes.original", "Original")}
              sizePresets={activeNoteSizePresets}
              activeSizePreset={activeNoteSizePreset}
              getSizePresetPatch={getNotesQuickSizePatch}
              onOpenSettings={() => setShowThemeSettings(true)}
              onUpdateImmediatelyChange={setQuickUpdateImmediately}
              overlayMode={overlayMode}
              onOverlayModeChange={handleOverlayModeChange}
              labelMode={notesLabel.labelMode}
              labelOptions={notesLabel.labelOptions}
              onLabelModeChange={notesLabel.setLabelMode}
            />
          </section>

          <section className="dock-console-panel dock-console-panel--deck dock-console-panel--deck-static dock-console-panel--deck-worship">
            <div className="dock-worship-toolbar">
              <DockBottomToolbar
                overlayMode={overlayMode}
                onModeChange={handleOverlayModeChange}
                overlayModeToggleDisabled={autoAdvanceActive}
                clearLabel={overlayVisible ? t("notes.hide") : t("notes.show")}
                onClear={handleClear}
                clearDisabled={visibilityActionPending}
                sourceVisible={overlayVisible}
                collapsed={toolbarCollapsed}
                onCollapseChange={setToolbarCollapsed}
                bottomPanel={searchPlacement !== "top" ? (
                  <DockBottomSearchPanel
                    expanded={bottomSearchExpanded}
                    onToggle={() => setBottomSearchExpanded((current) => !current)}
                    toggleInToolbar
                  >
                    {renderNoteSlidesSearchPanel()}
                  </DockBottomSearchPanel>
                ) : undefined}
                bottomPanelToggle={searchPlacement !== "top" ? {
                  expanded: bottomSearchExpanded,
                  onToggle: () => setBottomSearchExpanded((current) => !current),
                } : undefined}
                children={(
                  <>
                    <button
                      type="button"
                      className="dock-btm-overflow__menu-item"
                      data-dock-close-overflow="true"
                      onClick={() => setShowThemeSettings(true)}
                      title={t("worship.quickEdits", "Quick Edits")}
                      aria-label={t("worship.quickEdits", "Quick Edits")}
                    >
                      <Icon name="edit" size={14} />
                      <span>{t("worship.quickEdits", "Quick Edits")}</span>
                    </button>
                    <DockSceneRoutingControl
                      module="notes"
                      route={sceneRoute}
                      onRouteChange={updateSceneRoute}
                      title={t("sceneRouting.bible", "Output")}
                      placement="above"
                      showLabel
                      iconName="cast"
                      itemLabel={t("notes.note", "note")}
                      onSend={(opts) => {
                        const targetSlideIndex = activeSlideIndex ?? (selectedNoteSlides.length > 0 ? 0 : null);
                        if (targetSlideIndex !== null) {
                          if (opts?.bypassSceneRoute) {
                            notesSceneRouteConfirmedRef.current = false;
                          } else {
                            notesSceneRouteConfirmedRef.current = true;
                          }
                          void pushNoteSlide(targetSlideIndex, undefined, undefined, {
                            bypassSceneRoute: opts?.bypassSceneRoute,
                          });
                        }
                      }}
                    />
                  </>
                )}
              />
            </div>
          </section>
        </>
      )}

      {actionError && (
        <div className="dock-console-error" style={{ padding: "8px 12px", fontSize: 11, color: "var(--error)" }}>
          {actionError}
        </div>
      )}

      <DockThemeSettingsModal
        selectedThemeId={overlayMode === "fullscreen" ? selectedFSTheme.id : selectedLTTheme.id}
        onSelect={overlayMode === "fullscreen" ? handleSelectFSTheme : handleSelectLTTheme}
        allowedCategories={["worship", "general"]}
        isOpen={showThemeSettings}
        onClose={() => setShowThemeSettings(false)}
        overlayMode={overlayMode}
        showReferences={false}
        quickSettings={overlayMode === "fullscreen"
          ? (fullscreenQuickSettings ?? getDockNotesThemeForMode(selectedFSTheme, "fullscreen").settings as unknown as DockFullscreenQuickThemeSettings)
          : (lowerThirdQuickSettings ?? getDockNotesThemeForMode(selectedLTTheme, "lower-third").settings as unknown as DockFullscreenQuickThemeSettings)}
        onQuickSettingsSave={async (settings) => {
          const nextSettings = normalizeExplicitOutputFontSettings(settings, overlayMode);
          if (overlayMode === "fullscreen") {
            liveFullscreenThemeSettingsRef.current = resolveNotesOutputThemeSettings(
              selectedFSThemeRef.current,
              "fullscreen",
              nextSettings,
            ) as unknown as Record<string, unknown>;
          } else {
            liveLowerThirdThemeSettingsRef.current = resolveNotesOutputThemeSettings(
              selectedLTThemeRef.current,
              "lower-third",
              nextSettings,
            ) as unknown as Record<string, unknown>;
          }
          if (overlayVisible && activeSlideIndex !== null) {
            await pushNoteSlide(activeSlideIndex, nextSettings);
          } else {
            const currentThemeSettings = overlayMode === "fullscreen"
              ? liveFullscreenThemeSettingsRef.current
              : liveLowerThirdThemeSettingsRef.current;
            void dockObsClient.primeNotesOverlay({
              overlayMode,
              bibleThemeSettings: currentThemeSettings,
              backgroundOnly: true,
            });
          }
          if (overlayMode === "fullscreen") setFullscreenQuickSettings(nextSettings);
          else setLowerThirdQuickSettings(nextSettings);
        }}
        title={t("notes.theme")}
        subtitle={t("notes.themeDescription")}
        storageScope="notes"
      />

      {showNoteEditor && (
        <DockNoteEditorDialog
          key={editingNote?.id ?? "new-note"}
          editing={Boolean(editingNote)}
          initialTitle={editingNote?.title ?? nextAutoNoteTitle()}
          initialContent={editingNote?.content ?? ""}
          onCancel={() => {
            setShowNoteEditor(false);
            setEditingNote(null);
          }}
          onSave={saveNoteDraft}
          onFormat={formatNoteDraft}
        />
      )}

      {noteSlideEditor && (
        <DockNoteSlideEditorDialog
          key={`${selectedNote?.id ?? "note"}-${noteSlideEditor.index}`}
          label={noteSlideEditor.label}
          initialText={noteSlideEditor.text}
          onCancel={closeNoteSlideEditor}
          onSave={saveNoteSlideEditor}
          onFormat={formatNoteText}
        />
      )}

      {toasts.length > 0 && (
        <div className="dock-toast-stack" role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`dock-toast dock-toast--${toast.tone}`}>
              {toast.tone === "success" && <Icon name="check" size={13} />}
              {toast.tone === "error" && <Icon name="warning" size={13} />}
              {toast.tone === "info" && <Icon name="check_circle" size={13} />}
              <span>{toast.message}</span>
            </div>
          ))}
        </div>
      )}

      <DockSceneRouteConfirmDialog
        open={Boolean(pendingNotesRouteConfirm)}
        route={sceneRoute}
        itemLabel={t("notes.note", "note")}
        onConfirmRouted={handleConfirmNotesRoute}
        onSendToMceAlone={handleSendNotesToMceAlone}
        onCancel={handleCancelNotesRouteConfirm}
      />
    </div>
  );
}
