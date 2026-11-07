/**
 * LowerThirdPanel.tsx — Dashboard quick-send panel for Lower Thirds
 *
 * Features:
 *   - Theme picker (all 30 themes in categorized grid)
 *   - Variable inputs (title, description, etc.) based on selected theme
 *   - Preview of the rendered theme
 *   - "Send to All Lower Thirds" button
 *   - "Send to Specific Source" dropdown
 *   - Source list showing all discovered LT sources in OBS
 *   - Blank / Clear controls
 */

import { useState, useMemo } from "react";
import { useLowerThird } from "./lowerThirdStore";
import { LT_THEMES, LT_BIBLE_THEMES, LT_WORSHIP_THEMES, LT_GENERAL_THEMES } from "./themes";
import type { LowerThirdTheme, LTVariable } from "./types";
import { LT_SIZES, LT_SIZE_LABELS } from "./types";
import Icon from "../components/Icon";

// ─────────────────────────────────────────────────────────────────────────────
// Theme Picker Modal
// ─────────────────────────────────────────────────────────────────────────────

function ThemePickerModal({
  currentThemeId,
  onSelect,
  onClose,
}: {
  currentThemeId: string | null;
  onSelect: (theme: LowerThirdTheme) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.toLowerCase();
    return LT_THEMES.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.includes(q))
    );
  }, [search]);

  const renderGrid = (themes: LowerThirdTheme[]) => (
    <div className="lt-picker-grid">
      {themes.map((theme) => (
        <button
          key={theme.id}
          className={`lt-theme-card ${currentThemeId === theme.id ? "lt-theme-card--active" : ""}`}
          onClick={() => onSelect(theme)}
        >
          <div
            className="lt-theme-card-icon"
            style={{ background: theme.accentColor }}
          >
            <Icon name={theme.icon} size={20} />
          </div>
          <span className="lt-theme-card-name">{theme.name}</span>
          <span className="lt-theme-card-cat">{theme.category}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="lt-picker-backdrop" onClick={onClose}>
      <div className="lt-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="lt-picker-header">
          <h3>
            <Icon name="subtitles" size={18} style={{ verticalAlign: "middle", marginRight: 6 }} />
            Choose a Lower Third Theme
          </h3>
          <button className="mv-btn mv-btn--ghost mv-btn--sm" onClick={onClose} title="Close">
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="lt-picker-search">
          <input
            type="text"
            placeholder="Search themes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search lower third themes"
            autoFocus
          />
          {search && (
            <button
              type="button"
              className="lt-picker-search-clear"
              onClick={() => setSearch("")}
              aria-label="Clear lower third theme search"
              title="Clear lower third theme search"
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </div>

        {filtered ? (
          <div className="lt-picker-section">
            <div className="lt-picker-section-title">
              Search Results ({filtered.length})
            </div>
            {filtered.length > 0 ? renderGrid(filtered) : (
              <p style={{ color: "var(--text-muted)", fontSize: 13, padding: 8 }}>
                No themes match "{search}"
              </p>
            )}
          </div>
        ) : (
          <>
            {LT_BIBLE_THEMES.length > 0 && (
              <div className="lt-picker-section">
                <div className="lt-picker-section-title">
                  <Icon name="menu_book" size={14} />
                  Bible / Scripture ({LT_BIBLE_THEMES.length})
                </div>
                {renderGrid(LT_BIBLE_THEMES)}
              </div>
            )}
            {LT_WORSHIP_THEMES.length > 0 && (
              <div className="lt-picker-section">
                <div className="lt-picker-section-title">
                  <Icon name="music_note" size={14} />
                  Worship ({LT_WORSHIP_THEMES.length})
                </div>
                {renderGrid(LT_WORSHIP_THEMES)}
              </div>
            )}
            {LT_GENERAL_THEMES.length > 0 && (
              <div className="lt-picker-section">
                <div className="lt-picker-section-title">
                  <Icon name="widgets" size={14} />
                  General ({LT_GENERAL_THEMES.length})
                </div>
                {renderGrid(LT_GENERAL_THEMES)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Variable Inputs
// ─────────────────────────────────────────────────────────────────────────────

function VariableInputs({
  variables,
  values,
  onChange,
}: {
  variables: LTVariable[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  // Group variables
  const groups = useMemo(() => {
    const map = new Map<string, LTVariable[]>();
    for (const v of variables) {
      const group = v.group || "General";
      if (!map.has(group)) map.set(group, []);
      map.get(group)!.push(v);
    }
    return map;
  }, [variables]);

  return (
    <div className="lt-vars">
      {Array.from(groups.entries()).map(([groupName, vars]) => (
        <div key={groupName}>
          {groups.size > 1 && (
            <div className="lt-var-group-title">{groupName}</div>
          )}
          {vars.map((v) => (
            <div key={v.key} className="lt-var-field">
              <label className="lt-var-label">
                {v.label}
                {v.required && <span className="lt-required">*</span>}
              </label>
              {v.type === "toggle" ? (
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-primary)", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={values[v.key] === "true"}
                    onChange={(e) => onChange(v.key, e.target.checked ? "true" : "false")}
                  />
                  {values[v.key] === "true" ? "On" : "Off"}
                </label>
              ) : v.type === "select" && v.options ? (
                <select
                  className="lt-var-input"
                  value={values[v.key] || v.defaultValue}
                  onChange={(e) => onChange(v.key, e.target.value)}
                >
                  {v.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              ) : v.type === "color" ? (
                <input
                  type="color"
                  className="lt-var-input"
                  value={values[v.key] || v.defaultValue}
                  onChange={(e) => onChange(v.key, e.target.value)}
                  style={{ height: 32, padding: 2 }}
                />
              ) : (
                <input
                  type={v.type === "number" ? "number" : "text"}
                  className="lt-var-input"
                  value={values[v.key] || ""}
                  placeholder={v.placeholder}
                  onChange={(e) => onChange(v.key, e.target.value)}
                  maxLength={v.maxLength}
                />
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Panel
// ═══════════════════════════════════════════════════════════════════════════

export function LowerThirdPanel() {
  const {
    state,
    selectTheme,
    setValue,
    resetValues,
    sendToAll,
    sendToSpecific,
    blankAll,
    clearAll,
    refreshSources,
    setSize,
  } = useLowerThird();

  const [showPicker, setShowPicker] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [sendTarget, setSendTarget] = useState("");

  const theme = state.selectedTheme;

  const handleSelectTheme = (t: LowerThirdTheme) => {
    selectTheme(t.id);
    setShowPicker(false);
  };

  const handleSendToSpecific = async () => {
    if (!sendTarget) return;
    await sendToSpecific(sendTarget);
  };

  return (
    <div className="lt-panel">
      {/* ── Header ── */}
      <div className="lt-panel-header">
        <Icon name="subtitles" size={20} style={{ color: "#C8102E" }} />
        <h3>Lower Thirds</h3>
        {state.isLive && (
          <span className="lt-panel-badge lt-panel-badge--live">● Live</span>
        )}
      </div>

      {/* ── Theme Selector ── */}
      <div className="lt-theme-selector">
        <div className="lt-theme-selector-label">Theme</div>
        {theme ? (
          <div className="lt-theme-current" onClick={() => setShowPicker(true)}>
            <div
              className="lt-theme-current-preview"
              style={{ background: theme.accentColor }}
            >
              <Icon name={theme.icon} size={20} style={{ color: "#fff" }} />
            </div>
            <div className="lt-theme-current-info">
              <span className="lt-theme-current-name">{theme.name}</span>
              <span className="lt-theme-current-cat">{theme.category}</span>
            </div>
            <button
              className="lt-btn lt-btn--secondary lt-btn--sm"
              onClick={(e) => { e.stopPropagation(); setShowPicker(true); }}
             title="Change">
              Change
            </button>
          </div>
        ) : (
          <button
            className="lt-btn lt-btn--secondary"
            onClick={() => setShowPicker(true)}
            style={{ width: "100%" }}
           title="Select">
            <Icon name="palette" size={16} />
            Select Theme
          </button>
        )}
      </div>

      {/* ── Variable Inputs ── */}
      {theme && (
        <>
          <VariableInputs
            variables={theme.variables}
            values={state.values}
            onChange={setValue}
          />

          {/* ── Size Selector ── */}
          <div style={{ marginBottom: 10 }}>
            <div className="lt-var-group-title" style={{ marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
              <Icon name="aspect_ratio" size={14} style={{ opacity: 0.5 }} />
              Size
            </div>
            <div className="lt-size-picker lt-size-picker--compact">
              {LT_SIZES.map((s) => (
                <button
                  key={s}
                  className={`lt-size-btn ${state.size === s ? "lt-size-btn--active" : ""}`}
                  onClick={() => setSize(s)}
                  title={`Size: ${LT_SIZE_LABELS[s]}`}
                >
                  {LT_SIZE_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          {/* ── Actions ── */}
          <div className="lt-actions">
            <button
              className="lt-btn lt-btn--primary"
              disabled={state.isSending}
              onClick={sendToAll}
             title="Send">
              <Icon name="send" size={16} />
              {state.isSending ? "Sending..." : "Send to All Lower Thirds"}
            </button>

            <button
              className="lt-btn lt-btn--secondary lt-btn--sm"
              onClick={resetValues}
              title="Reset to default values"
            >
              <Icon name="restart_alt" size={14} />
            </button>
          </div>

          {/* ── Send to Specific ── */}
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <select
                className="lt-var-input"
                style={{ flex: 1, fontSize: 12 }}
                value={sendTarget}
                onChange={(e) => setSendTarget(e.target.value)}
              >
                <option value="">— Select Source —</option>
                {state.obsSources.map((s) => (
                  <option key={s.inputName} value={s.inputName}>
                    {s.inputName} {s.isOcsManaged ? "(VC)" : "(MV)"}
                  </option>
                ))}
              </select>
              <button
                className="lt-btn lt-btn--secondary lt-btn--sm"
                disabled={!sendTarget || state.isSending}
                onClick={handleSendToSpecific}
               title="Send">
                <Icon name="send" size={14} />
                Send
              </button>
            </div>
          </div>

          {/* ── Blank / Clear ── */}
          {state.isLive && (
            <div className="lt-actions" style={{ marginTop: 8 }}>
              <button
                className="lt-btn lt-btn--secondary lt-btn--sm"
                disabled={state.isSending}
                onClick={blankAll}
               title="Hide">
                <Icon name="visibility_off" size={14} />
                Blank All
              </button>
              <button
                className="lt-btn lt-btn--danger lt-btn--sm"
                disabled={state.isSending}
                onClick={clearAll}
               title="Clear">
                <Icon name="delete_outline" size={14} />
                Clear All
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Error ── */}
      {state.error && (
        <div className="lt-error">
          <Icon name="error" size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
          {state.error}
        </div>
      )}

      {/* ── Source List (collapsible) ── */}
      <div className="lt-sources">
        <div
          className={`lt-section-toggle ${showSources ? "open" : ""}`}
          onClick={() => {
            setShowSources(!showSources);
            if (!showSources) refreshSources();
          }}
        >
          <Icon name="chevron_right" size={20} />
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            OBS Sources ({state.obsSources.length})
          </span>
          {state.isRefreshing && (
            <Icon name="refresh" size={14} style={{ animation: "spin 1s linear infinite" }} />
          )}
        </div>

        {showSources && (
          <div>
            {state.obsSources.length === 0 ? (
              <p className="lt-status">No lower-third sources found in OBS</p>
            ) : (
              state.obsSources.map((s) => (
                <div key={s.inputName} className="lt-source-item">
                  <Icon name={s.isOcsManaged ? "tv" : "grid_view"} size={16} style={{ color: "var(--text-muted)" }} />
                  <span className="lt-source-item-name">{s.inputName}</span>
                  <span className={`lt-source-item-badge ${s.isOcsManaged ? "lt-source-item-badge--ocs" : "lt-source-item-badge--mv"}`}>
                    {s.isOcsManaged ? "VC" : "MV"}
                  </span>
                  {s.themeId && (
                    <span style={{ fontSize: 10, color: "var(--text-disabled)" }}>
                      {s.themeId.replace("lt-", "").replace(/-/g, " ")}
                    </span>
                  )}
                </div>
              ))
            )}
            <button
              className="lt-btn lt-btn--secondary lt-btn--sm"
              style={{ marginTop: 6, width: "100%" }}
              onClick={refreshSources}
              disabled={state.isRefreshing}
             title="Refresh">
              <Icon name="refresh" size={14} />
              Refresh Sources
            </button>
          </div>
        )}
      </div>

      {/* ── Theme Picker Modal ── */}
      {showPicker && (
        <ThemePickerModal
          currentThemeId={theme?.id || null}
          onSelect={handleSelectTheme}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}

export default LowerThirdPanel;
