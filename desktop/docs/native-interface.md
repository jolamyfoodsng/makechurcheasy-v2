# Native-style desktop interface

> The full, current spec (tokens, components, checklist) is [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md).

The October 2026 app-wide refresh follows the requested Studio direction and supersedes older decorative colors, large radii, and web-font defaults in `docs/DESIGN.md` for application chrome.

- `src/native-theme.css` provides shared startup tokens, system font stacks, compact radii, keyboard focus, and native form feedback. Main app and standalone dock entry points share it.
- `src/services/appAppearance.ts` resolves the light/dark palettes and saved accent preferences. Use neutral surfaces and reserve accents for actions and selection. Preserve meaningful live, warning, error, and connection colors.
- Use `src/components/icons/NativeIcons.tsx` for Fluent System Icons. Existing semantic names are compatibility aliases; the glyphs are Microsoft Fluent regular/filled SVGs. Per-icon imports keep unused glyphs out of the production bundle. This is a native-style web interface, not an OS widget rewrite or Apple SF Symbols implementation.
- Legacy named icons use `Icon` / `DockIcon`, backed by the same Fluent set. Do not introduce emoji controls, icon fonts, or a second general icon family.
- Use `--font-body` / `--font-heading` for interface text and `--font-mono` for codes. Explicit user-selected fonts remain supported. Presentation content retains its own fonts, colors, and previews.
- Use `--radius` (4px), `--radius-sm` (3px), and `--radius-lg` (6px). Keep circular progress indicators, avatars, and swatches circular.
- New pages must use shared surface, text, border, and control tokens, including light mode. Avoid local root palette overrides, glass panels, and decorative gradients.

Source: https://github.com/microsoft/fluentui-system-icons (MIT).
