import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Icon from "../DockIcon";
import {
  type BibleMacro,
  DEFAULT_BIBLE_MACROS,
  loadBibleMacros,
  saveBibleMacros,
  isCanonicalBookCollision,
} from "../bibleMacros";
import "./dock-bible-macros.css";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelectMacro: (macro: BibleMacro) => void;
}

export default function DockBibleMacrosModal({
  isOpen,
  onClose,
  onSelectMacro,
}: Props) {
  const { t } = useTranslation();
  const [macros, setMacros] = useState<BibleMacro[]>(() => loadBibleMacros());
  const [filterQuery, setFilterQuery] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  // New macro form state
  const [newKeyword, setNewKeyword] = useState("");
  const [newReference, setNewReference] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newTranslation, setNewTranslation] = useState("");
  const [formError, setFormError] = useState("");

  const filteredMacros = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return macros;
    return macros.filter((m) => {
      return (
        m.keyword.toLowerCase().includes(q) ||
        m.reference.toLowerCase().includes(q) ||
        (m.label && m.label.toLowerCase().includes(q))
      );
    });
  }, [macros, filterQuery]);

  const keywordCollision = useMemo(() => {
    return isCanonicalBookCollision(newKeyword);
  }, [newKeyword]);

  if (!isOpen) return null;

  const handleAddMacro = (e: React.FormEvent) => {
    e.preventDefault();
    const kw = newKeyword.trim().toLowerCase().replace(/\s+/g, "");
    const ref = newReference.trim();
    if (!kw || !ref) {
      setFormError(t("bible.macroFormRequired", "Keyword and scripture reference are required."));
      return;
    }

    const nextMacro: BibleMacro = {
      keyword: kw,
      reference: ref,
      label: newLabel.trim() || undefined,
      translation: newTranslation.trim().toUpperCase() || undefined,
    };

    const nextList = [nextMacro, ...macros.filter((m) => m.keyword.toLowerCase() !== kw)];
    setMacros(nextList);
    saveBibleMacros(nextList);
    setNewKeyword("");
    setNewReference("");
    setNewLabel("");
    setNewTranslation("");
    setFormError("");
    setIsAdding(false);
  };

  const handleDeleteMacro = (keyword: string) => {
    const nextList = macros.filter((m) => m.keyword.toLowerCase() !== keyword.toLowerCase());
    setMacros(nextList);
    saveBibleMacros(nextList);
  };

  const handleResetDefaults = () => {
    if (window.confirm(t("bible.confirmResetMacros", "Reset all shortcodes back to default?"))) {
      setMacros([...DEFAULT_BIBLE_MACROS]);
      saveBibleMacros([...DEFAULT_BIBLE_MACROS]);
    }
  };

  return (
    <div
      className="dock-modal-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="dock-modal dock-modal--standard dock-bible-macros-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dock-macros-modal-title"
        onClick={(e) => e.stopPropagation()}
        style={{ display: "flex", flexDirection: "column" }}
      >
        <div className="dock-modal__header">
          <div className="dock-modal__title-row" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="bolt" size={18} style={{ color: "#eab308" }} />
            <h2 id="dock-macros-modal-title" className="dock-modal__title" style={{ margin: 0 }}>
              {t("bible.smartShortcodes", "Scripture Shortcodes & Macros")}
            </h2>
            <span className="dock-macro-badge-count">
              {macros.length}
            </span>
          </div>
          <button
            type="button"
            className="dock-modal__close-btn"
            onClick={onClose}
            aria-label={t("common.close", "Close")}
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="dock-modal__body" style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
          <p className="dock-macro-intro">
            {t(
              "bible.macroDescription",
              "Type shortcuts directly in the Bible search bar (e.g. #grace, #offering, #benediction) to instantly display key service scriptures.",
            )}
          </p>

          <div className="dock-macro-toolbar">
            <input
              type="text"
              className="dock-input"
              style={{ flex: 1, height: "32px", fontSize: "12px" }}
              placeholder={t("bible.filterShortcodes", "Search shortcodes...")}
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
            />
            <button
              type="button"
              className="dock-btn dock-btn--primary"
              style={{ height: "32px", padding: "0 12px", fontSize: "12px", display: "flex", alignItems: "center", gap: 5 }}
              onClick={() => setIsAdding((prev) => !prev)}
            >
              <Icon name={isAdding ? "remove" : "add"} size={14} />
              <span>{isAdding ? t("common.cancel", "Cancel") : t("bible.addShortcode", "New Shortcode")}</span>
            </button>
          </div>

          {isAdding && (
            <form
              onSubmit={handleAddMacro}
              style={{
                padding: "12px",
                background: "var(--dock-surface-panel, var(--surface))",
                borderRadius: "var(--radius)",
                border: "1px solid var(--dock-border-subtle, var(--border-subtle))",
                marginBottom: "16px",
              }}
            >
              <h4 style={{ margin: "0 0 10px 0", fontSize: "13px", fontWeight: 600 }}>
                {t("bible.addNewShortcode", "Add Custom Shortcode")}
              </h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "11px", marginBottom: "4px", color: "var(--text-secondary, #94a3b8)" }}>
                    {t("bible.keyword", "Keyword / Shortcut")} *
                  </label>
                  <input
                    type="text"
                    className="dock-input"
                    placeholder="e.g. offering"
                    value={newKeyword}
                    onChange={(e) => setNewKeyword(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "11px", marginBottom: "4px", color: "var(--text-secondary, #94a3b8)" }}>
                    {t("bible.scriptureRef", "Scripture Reference")} *
                  </label>
                  <input
                    type="text"
                    className="dock-input"
                    placeholder="e.g. 2 Corinthians 9:7"
                    value={newReference}
                    onChange={(e) => setNewReference(e.target.value)}
                    required
                  />
                </div>
              </div>

              {keywordCollision && (
                <div
                  style={{
                    padding: "6px 10px",
                    background: "rgba(245, 158, 11, 0.15)",
                    border: "1px solid rgba(245, 158, 11, 0.3)",
                    borderRadius: "var(--radius)",
                    fontSize: "11px",
                    color: "#f59e0b",
                    marginBottom: "8px",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Icon name="warning" size={14} />
                  <span>
                    {t(
                      "bible.keywordCollisionWarning",
                      "Notice: This keyword matches a Bible book name. Canonical scripture will take precedence in search unless prefixed with '#' (e.g. '#keyword').",
                    )}
                  </span>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "10px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "11px", marginBottom: "4px", color: "var(--text-secondary, #94a3b8)" }}>
                    {t("bible.macroLabel", "Display Title (Optional)")}
                  </label>
                  <input
                    type="text"
                    className="dock-input"
                    placeholder="e.g. Cheerfully Giving"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "11px", marginBottom: "4px", color: "var(--text-secondary, #94a3b8)" }}>
                    {t("bible.preferredTranslation", "Default Translation (Optional)")}
                  </label>
                  <input
                    type="text"
                    className="dock-input"
                    placeholder="e.g. NIV, KJV"
                    value={newTranslation}
                    onChange={(e) => setNewTranslation(e.target.value)}
                  />
                </div>
              </div>

              {formError && (
                <p style={{ color: "#ef4444", fontSize: "11px", margin: "0 0 8px 0" }}>{formError}</p>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  type="button"
                  className="dock-btn"
                  onClick={() => setIsAdding(false)}
                >
                  {t("common.cancel", "Cancel")}
                </button>
                <button
                  type="submit"
                  className="dock-btn dock-btn--primary"
                >
                  {t("common.save", "Save Shortcode")}
                </button>
              </div>
            </form>
          )}

          <div className="dock-bible-macros-list">
            {filteredMacros.map((macro) => {
              const hasCollision = isCanonicalBookCollision(macro.keyword);
              return (
                <div
                  key={macro.keyword}
                  className="dock-macro-card"
                  onClick={() => {
                    onSelectMacro(macro);
                    onClose();
                  }}
                  title={t("bible.clickToProject", "Click to project passage")}
                >
                  <div className="dock-macro-card__left">
                    <span className="dock-macro-card__pill">
                      <span className="dock-macro-card__pill-hash">#</span>
                      {macro.keyword}
                    </span>
                    <div className="dock-macro-card__info">
                      <div className="dock-macro-card__title">
                        {macro.label || macro.keyword}
                      </div>
                      <div className="dock-macro-card__reference">
                        <Icon name="book" size={13} className="dock-macro-card__reference-icon" />
                        <span>{macro.reference} {macro.translation ? `(${macro.translation})` : ""}</span>
                      </div>
                    </div>
                  </div>

                  <div className="dock-macro-card__actions" onClick={(e) => e.stopPropagation()}>
                    {hasCollision && (
                      <span
                        title="Keyword collides with Bible book. Use # prefix to force macro."
                        style={{ fontSize: "10px", padding: "1px 5px", borderRadius: "3px", background: "rgba(245, 158, 11, 0.2)", color: "#f59e0b" }}
                      >
                        BOOK CLASH
                      </span>
                    )}
                    <button
                      type="button"
                      className="dock-macro-card__project-btn"
                      onClick={() => {
                        onSelectMacro(macro);
                        onClose();
                      }}
                      title={t("bible.sendToObs", "Project this passage")}
                    >
                      <Icon name="play_arrow" size={14} />
                      <span>{t("dock.project", "Project")}</span>
                    </button>
                    <button
                      type="button"
                      className="dock-macro-card__delete-btn"
                      onClick={() => handleDeleteMacro(macro.keyword)}
                      title={t("common.delete", "Delete")}
                      aria-label={t("common.delete", "Delete")}
                    >
                      <Icon name="delete" size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="dock-modal__footer" style={{ display: "flex", justifyContent: "space-between", padding: "12px 16px" }}>
          <button
            type="button"
            className="dock-btn dock-btn--sm"
            onClick={handleResetDefaults}
            style={{ fontSize: "11px", opacity: 0.8 }}
          >
            <Icon name="restart_alt" size={12} />
            <span>{t("bible.resetDefaults", "Reset Built-in Defaults")}</span>
          </button>
          <button
            type="button"
            className="dock-btn dock-btn--secondary dock-btn--sm"
            onClick={onClose}
          >
            {t("common.close", "Close")}
          </button>
        </div>
      </div>
    </div>
  );
}
