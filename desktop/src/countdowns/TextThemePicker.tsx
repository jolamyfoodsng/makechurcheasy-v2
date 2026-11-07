/**
 * TextThemePicker.tsx — Canva-style theme gallery for countdown text
 *
 * Shows a visual preview of each theme (timer + name) so users can
 * pick a style instantly instead of manually configuring fonts.
 */

import { useEffect, useRef } from "react";
import {
  COUNTDOWN_TEXT_THEMES,
  TEXT_THEME_CATEGORIES,
  loadTextThemeFont,
  preloadTextThemeFonts,
  type CountdownTextTheme,
  type TextThemeCategory,
} from "./textThemes";

// ── Styles ─────────────────────────────────────────────────────────────────

const GRID_STYLE: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, 1fr)",
  gap: 8,
};

const CARD_BASE: React.CSSProperties = {
  position: "relative",
  borderRadius: 10,
  padding: "14px 10px",
  cursor: "pointer",
  border: "2px solid transparent",
  transition: "all 0.15s ease",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  minHeight: 80,
  overflow: "hidden",
};

const CARD_SELECTED: React.CSSProperties = {
  borderColor: "var(--primary)",
  boxShadow: "0 0 0 1px var(--primary)",
};

const TIMER_STYLE: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: 28,
  fontWeight: 700,
  lineHeight: 1,
  letterSpacing: 1,
};

const NAME_STYLE: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 600,
  opacity: 0.8,
  textAlign: "center",
  lineHeight: 1.2,
};

const CATEGORY_HEADER_STYLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  padding: "14px 0 6px",
};

// ── Theme Card ─────────────────────────────────────────────────────────────

function ThemeCard({
  theme,
  isSelected,
  onSelect,
}: {
  theme: CountdownTextTheme;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Load the font when card becomes visible
  useEffect(() => {
    loadTextThemeFont(theme);
  }, [theme]);

  // Determine a preview background color based on category
  const bgByCategory: Record<TextThemeCategory, string> = {
    modern: "linear-gradient(135deg, #1a1a2e, #16213e)",
    elegant: "linear-gradient(135deg, #1a1a1a, #2d1b3d)",
    handwritten: "linear-gradient(135deg, #1a2a1a, #1e3a2a)",
    cinematic: "linear-gradient(135deg, #0a0a0a, #1a0a0a)",
    minimal: "linear-gradient(135deg, #f5f5f5, #e8e8e8)",
    youth: "linear-gradient(135deg, #0a0a2e, #1a0a3e)",
  };

  const isLight = theme.category === "minimal";
  const timerColor = isLight ? "#333" : theme.timerColor;
  const nameColor = isLight ? "#666" : theme.timerColor;

  return (
    <div
      ref={cardRef}
      onClick={onSelect}
      style={{
        ...CARD_BASE,
        background: bgByCategory[theme.category],
        ...(isSelected ? CARD_SELECTED : {}),
      }}
      onMouseEnter={(e) => {
        if (!isSelected) e.currentTarget.style.borderColor = "var(--border-strong)";
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.borderColor = "transparent";
      }}
      title={theme.name}
    >
      <div
        style={{
          ...TIMER_STYLE,
          fontFamily: theme.fontFamily,
          fontWeight: theme.fontWeight,
          color: timerColor,
          textShadow: theme.timerShadow,
          letterSpacing: Math.min(theme.timerLetterSpacing, 4),
        }}
      >
        05:00
      </div>
      <div style={{ ...NAME_STYLE, color: nameColor, fontFamily: theme.fontFamily }}>
        {theme.name}
      </div>
    </div>
  );
}

// ── Main Picker ────────────────────────────────────────────────────────────

interface TextThemePickerProps {
  selectedThemeId?: string;
  onSelectTheme: (theme: CountdownTextTheme) => void;
}

export default function TextThemePicker({ selectedThemeId, onSelectTheme }: TextThemePickerProps) {
  // Preload all theme fonts when picker mounts
  useEffect(() => {
    preloadTextThemeFonts(COUNTDOWN_TEXT_THEMES);
  }, []);

  // Group themes by category in display order
  const categories = TEXT_THEME_CATEGORIES;

  return (
    <div style={{ padding: "4px 0" }}>
      {/* Gallery grid */}
      <div style={GRID_STYLE}>
        {categories.map((cat) => {
          const themes = COUNTDOWN_TEXT_THEMES.filter((t) => t.category === cat.id);
          if (themes.length === 0) return null;
          return (
            <>
              <div key={cat.id} style={CATEGORY_HEADER_STYLE}>
                {cat.label}
              </div>
              {themes.map((theme) => (
                <ThemeCard
                  key={theme.id}
                  theme={theme}
                  isSelected={theme.id === selectedThemeId}
                  onSelect={() => onSelectTheme(theme)}
                />
              ))}
            </>
          );
        })}
      </div>
    </div>
  );
}
