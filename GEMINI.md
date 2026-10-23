# Make Church Eazy (MCE) - Workspace Guidelines & Rules

## 🚫 CRITICAL VOCABULARY RULE: NEVER USE THE WORD "SANCTUARY"

> [!CAUTION]
> **STRICT BAN ON THE WORD "SANCTUARY"**:
> NEVER use the word **"sanctuary"** anywhere in this project.
> This prohibition applies to:
> - User Interface labels, buttons, cards, modals, tabs, and placeholders
> - Default data, mock data, sample channel or profile names
> - Code identifiers, variable names, functions, type names, or test fixtures
> - Documentation, comments, marketing copy, and email templates
> - AI responses, commit messages, and feature summaries

### Approved Replacement Terminology:
When referring to in-person spaces, church venues, or physical displays:
- Instead of "sanctuary screens" / "sanctuary projectors" ➔ Use **"Church screens"**, **"Auditorium screens"**, or **"In-person displays"**
- Instead of "sanctuary service" ➔ Use **"Main service"**, **"Sunday service"**, or **"Church service"**
- Instead of "sanctuary stream" ➔ Use **"Live stream"**, **"Church broadcast"**, or **"Auditorium feed"**
- Instead of "sanctuary PC" ➔ Use **"Media PC"**, **"Broadcast PC"**, or **"Church PC"**
- Instead of "people in the sanctuary" ➔ Use **"Congregation"**, **"In-person audience"**, or **"Auditorium"**

---

## 🎨 Design: match the existing app (all UI, docs and pages)

> [!IMPORTANT]
> **Read [`desktop/docs/DESIGN_SYSTEM.md`](desktop/docs/DESIGN_SYSTEM.md) before building or changing any UI** — app screens, dialogs, banners, the dock, the dashboard, web pages, docs pages or emails. It is the single source of truth and overrides `docs/DESIGN.md` and `docs/COMPONENT_LIBRARY.md`.

- Use the app's CSS tokens (`var(--surface)`, `var(--text-secondary)`, `var(--border)`, `var(--primary)` …) — never hard-coded colours, fonts or Tailwind classes. Users change dark/light mode, the accent colour and the interface font in Settings → Appearance, and new UI must follow those choices.
- Reuse the shared components (`ModalDialog` for every dialog, `.app-btn`, `.app-banner`, `.app-surface`, `NativeIcons`) instead of inventing new styles.
- Check new UI in dark **and** light mode, and with a non-blue accent, before calling it done.

## 💳 Plan limits apply to everything users bring in

Importing (EasyWorship, files, bulk import) is free on every plan, but **the plan's limits still apply to the content**: cap imports at the plan's remaining room (`getRemaining*Slots` in `desktop/src/services/licenseService.ts`), fail closed when the count can't be read, and make content beyond the limit lock when a trial ends or a church moves to a lower plan (songs and media in the Dock and Songs page, themes via `desktop/src/themes/planLocks.ts`). The Studio section is the exception: it can use every song and all media.

---

## 📡 Live Broadcast & OBS Stream Settings
- Never expose internal cloud infrastructure vendors (e.g. Cloudflare) to the end user. Frame as Make Church Eazy's built-in cloud broadcasting engine.
- For YouTube stream destinations, allow server options matching OBS Studio (`auto`, `Primary YouTube ingest server`, `Backup YouTube ingest server`).
