# MakeChurchEazy Design System

**This is the single source of truth for how MakeChurchEazy looks.** Every new screen, dialog, banner, page, doc page or email — written by a person or by any AI model — must follow it. When something here disagrees with an older document (`docs/DESIGN.md`, `docs/COMPONENT_LIBRARY.md`), this file wins.

The rule in one line: **build with the app's tokens and shared components, never with your own colours.** Users can switch dark / light mode and pick their own accent colour and interface font in **Settings → Appearance**, so anything with a hard-coded colour or font breaks for them.

---

## 1. Where the styles come from

| What | File |
|---|---|
| Token defaults (dark first, then light) | `desktop/src/native-theme.css` |
| Runtime values the user sees (accent, font, dark/light) | `desktop/src/services/appAppearance.ts` → written inline on `<html>` |
| Dark / light switch | `desktop/src/hooks/useAppTheme.ts` (adds `.light` to `<html>`) |
| Global element styles (inputs, scrollbars, 4px radius rule) | `desktop/src/App.css` (top of file) |
| The one dialog look | `desktop/src/components/ModalDialog.tsx` + `ModalDialog.css` |
| Icons | `desktop/src/components/icons/NativeIcons.tsx` (Fluent icons) |

There is **no Tailwind** in the desktop app. Utility classes such as `w-full`, `text-[#7d8a42]` or `animate-spin` do nothing (or only work by accident). Write plain CSS in the feature's own `.css` file with BEM-style class names (`feature-block__part--state`).

## 2. Users customise the look — so never hard-code it

Settings → Appearance lets each church choose:

- **Theme:** dark (default), light or system. Light mode puts `.light` on `<html>`.
- **Accent colour:** six palettes (System Blue `#0067C0`, Ocean Teal, Royal Purple, Forest, Ember, Slate) or any custom hex. It drives `--primary`, `--primary-hover`, `--primary-pressed`, `--primary-rgb`, `--primary-soft`, `--primary-soft-border`, `--accent-blue`, `--focus-ring`, `--tab-indicator` and the sidebar's active state.
- **Interface font:** sets `--font-body` / `--font-heading`. Components inherit it from `body`; never set your own `font-family` (use `font-family: inherit` on buttons and inputs).

So:

- ✅ `color: var(--text-secondary)`, `background: var(--primary)`, `background: rgba(var(--primary-rgb), 0.12)`, `color-mix(in srgb, var(--warning) 38%, var(--border))`
- ❌ `#4F46E5`, `#7d8a42`, `#fcfaf4`, `rgba(255,255,255,0.08)` for a hover, `font-family: Inter`, a fallback like `var(--primary, #6366F1)` (the token always exists — the fallback only hides mistakes)

Every new piece of UI must be checked in **both dark and light mode** and with **a non-blue accent** (e.g. Ember) before it ships.

## 3. Tokens

### Colours

| Purpose | Token | Dark | Light |
|---|---|---|---|
| Page background | `--bg` | #18181B | #F3F3F3 |
| Card / panel / dialog surface | `--surface` | #202023 | #FFFFFF |
| Raised element on a surface (rows, inputs, secondary buttons) | `--surface-raised` | #2C2C30 | #F7F7F8 |
| Hover fill | `--surface-hover` | #38383D | #E8E8EB |
| Selected item fill | `--primary-soft` (with `--primary` or `--primary-soft-border` border) | accent 14% | accent 6% |
| Main text | `--text-primary` | #F4F4F5 | #1C1C1E |
| Secondary text | `--text-secondary` | #D1D1D6 | #48484A |
| Muted / helper text | `--text-muted` | #A1A1AA | #636366 |
| Disabled text | `--text-disabled` | #71717A | #8E8E93 |
| Default border | `--border` | #36363B | #D1D1D6 |
| Subtle divider | `--border-subtle` | #2C2C30 | #E5E5EA |
| Strong border (dialogs, hover) | `--border-strong` | #505057 | #8E8E93 |
| Accent: buttons, links, selection | `--primary` / `--primary-hover` / `--primary-pressed` | user accent | user accent |
| Accent for icons / text on dark | `--accent-blue` | accent, lightened | accent |
| Success | `--success`, `--success-bg`, `--success-border` | | |
| Warning | `--warning`, `--warning-bg` | | |
| Error | `--error`, `--error-bg`, `--error-border`, `--danger-text` | | |
| Inputs | `--input-bg`, `--input-border`, `--input-focus` | | |
| Focus ring | `--focus-ring` (or a 2px `--primary` outline) | | |

The only literal colour allowed is `#ffffff` for text on a `--primary`, `--error` or `--success` fill (the accent is darkened automatically until white text passes 4.5:1).

### Shape, spacing, type, motion

- **Radius:** `--radius` 4px (default for everything), `--radius-sm` 3px, `--radius-lg` 6px (dialogs, panels). `App.css` forces 4px on anything named like a button, card, modal, tab, badge or input, so pills and big rounded cards will not render — don't design them. Circles only for avatars, dots and spinners.
- **Spacing scale:** 4, 8, 12, 16, 24, 32, 40, 48 px (`--spacing-xs` 4 … `--spacing-xl` 32). Dense by default; 24px is the standard dialog/panel padding.
- **Type:** px sizes, inherited font. Page title 26px/700; section title 18px/700; dialog title 18px/700; body 14px; secondary 13px; helper and labels 12px; eyebrow 11px/700 uppercase. Don't use `rem`, don't add new sizes.
- **Control height:** `--control-height` 34px (toolbar buttons and inputs); 40px for dialog buttons.
- **Motion:** `transition: <property> var(--transition)` (150ms). No `transition: all`, no hover lifts (`translateY`), no slide-in banners. Respect `prefers-reduced-motion` for anything that loops.
- **Depth:** borders, not shadows. Only dialogs get a shadow (`--mce-modal-shadow`). No glass, blur or gradients.

## 4. Components to reuse (don't invent new ones)

| Need | Use | Where |
|---|---|---|
| Any dialog: confirm, notice, limit, progress, a small form | `ModalDialog` (+ `ModalProgress`) | `components/ModalDialog.tsx`. Tones: `brand`, `info`, `warning`, `danger`, `success`. Put custom content in `extra`, notes in `hint`, Cancel (`ghost`) first then the main action (`primary`). Esc, backdrop and the corner X close it. |
| A larger form dialog with header / body / footer | `.lib-modal-backdrop` + `.lib-add-modal`, `-header`, `-body`, `-footer` | `library/library.css` |
| Toolbar / page buttons | `.app-btn`, `.app-btn--primary` | `App.css` |
| Production pages buttons | `.production-btn` (`--primary`, `--ghost`, `--danger`, `--sm`) | `App.css` |
| Page layout | `.app-page`, `.app-page__header`, `__eyebrow`, `__title`, `__subtitle`, `__actions` | `App.css` |
| Panels / cards | `.app-surface` (`__header`, `__body`, `__title`), `.production-panel` | `App.css` |
| Inline notice | `.app-banner` (`--warning`), `.app-banner__content` | `App.css` |
| Inline error | `.obs-error` | `App.css` |
| Inputs | plain `<input>` / `<select>` (styled globally), `.obs-field` for label + input | `App.css` |
| Tabs | `.lib-tab-btn` / `.app-topnav-tab` (3px `--tab-indicator` underline) | `library.css`, `App.css` |
| Empty state | `.lib-empty` | `library.css` |
| Spinner | `.mce-spinner` | `components/loading-screen.css` |
| Icons | `NativeIcons` (`<FolderOpen size={16} />`) — Fluent only, `currentColor` | `components/icons/NativeIcons.tsx` |

Button rules: one primary action per view; secondary actions are neutral (`--surface-raised` + `--border`); destructive actions use the danger variant. Every button needs hover, `:focus-visible` and `:disabled` states.

**Don't copy** the Settings page CSS (`MVSettings.css`), `.lib-media-card` or `.production-btn:hover` — they still carry old hard-coded colours and are being cleaned up.

## 5. Writing the words

- Plain, short sentences; say what happens ("Pictures and videos are copied into your Media library").
- Never use the word "sanctuary" — see the root `AGENTS.md` for replacements.
- Never name internal vendors (Cloudflare etc.); it's Make Church Eazy's own cloud.
- Name plan limits honestly: importing or adding is free, but each plan's limits still apply.

## 6. Other surfaces

New work on the dashboard (`dashboard/`), website pages, docs and emails should use the same look: neutral surfaces, the System Blue accent `#0067C0` (hover `#005BAA`), 4px radius, borders over shadows, system font stack. Copy the token values from §3 rather than inventing new ones; where those projects have their own CSS variables, map them to these values.

## 7. Checklist before you ship UI

- [ ] No hex / rgb colour in the CSS except `#ffffff` text on a filled accent.
- [ ] Reuses a component from §4 (or explains why none fits).
- [ ] Checked in dark **and** light mode, and with a non-blue accent.
- [ ] Spacing from the scale, px font sizes from §3, radius from the tokens.
- [ ] Hover, focus-visible and disabled states exist.
- [ ] No Tailwind classes, no `transition: all`, no glass/blur/gradients, no emoji icons.
