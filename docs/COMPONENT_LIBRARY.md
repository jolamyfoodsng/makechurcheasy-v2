# MakeChurchEazy Component Library

> **Superseded:** the current design spec is [`desktop/docs/DESIGN_SYSTEM.md`](../desktop/docs/DESIGN_SYSTEM.md). Where this document disagrees with it (colours, fonts, radii, button and modal sizes, icons), follow DESIGN_SYSTEM.md.

Version: 1.0
Last Updated: June 2026

---

# Purpose

This document defines every reusable UI component used across:

- Desktop App
- OBS Dock
- Dashboard
- Landing Page
- Admin Portal
- Mobile Control

Developers and AI agents must follow these standards.

---

# Global Rules

1. Never invent new component styles.
2. Reuse existing components whenever possible.
3. Every component must support Light Mode and Dark Mode.
4. Components must be accessible.
5. Consistency is more important than creativity.

---

# Container Widths

Landing Page

Max Width: 1440px

Dashboard

Max Width: 1600px

Forms

Max Width: 720px

Modals

Max Width: 640px

Large Modal

Max Width: 960px

---

# Buttons

## Small Button

Height: 36px
Padding: 12px 16px
Radius: 8px

Use:

- Secondary actions
- Toolbar actions

---

## Medium Button

Height: 44px
Padding: 16px 20px
Radius: 12px

Default application button.

---

## Large Button

Height: 52px
Padding: 20px 24px
Radius: 12px

Use:

- Landing pages
- Upgrade CTAs
- Go Live actions

---

## Primary Button

Background:

Brand Gradient

Text:

White

---

## Secondary Button

Background:

Transparent

Border:

1px theme border

---

## Danger Button

Background:

#EF4444

---

# Inputs

Height:

44px

Radius:

12px

Border:

1px

Placeholder:

Muted text color

Focus State:

Primary Blue Border

---

# Text Areas

Minimum Height:

120px

Radius:

12px

---

# Select Dropdowns

Height:

44px

Radius:

12px

Icon:

Lucide ChevronDown

---

# Search Inputs

Height:

44px

Leading Icon:

Search

Radius:

999px

Use for:

- Bible search
- Worship search
- Media search

---

# Cards

## Standard Card

Radius:

16px

Padding:

24px

Border:

1px

Contains:

- Title
- Description
- Actions

---

## Feature Card

Used on landing pages.

Padding:

32px

Icon Size:

48px

---

## Pricing Card

Padding:

32px

Radius:

24px

Starter Plan:

1.1x larger than other cards.

---

# Page Headers

Structure:

Title
Description
Actions

Example:

Bible
Display scriptures beautifully inside OBS.

[ Add Scripture ]

---

# Sidebar

Desktop Width:

280px

Collapsed Width:

72px

Item Height:

44px

Radius:

12px

---

# Top Navigation

Height:

72px

Contains:

- Logo
- Search
- Notifications
- User Menu

---

# Tables

Row Height:

56px

Header Weight:

600

Alternating Row Colors:

Disabled

Use clean borders instead.

---

# Modals

## Standard Modal

Width:

640px

Padding:

32px

Radius:

24px

---

## Confirmation Modal

Width:

480px

Used for:

- Delete
- Remove
- Disconnect

---

# Icons

Library:

Lucide Only

Sizes:

16px
20px
24px
32px
48px

Do not use arbitrary sizes.

---

# Badges

Small:

24px Height

Radius:

999px

Examples:

Pro
New
Beta
Most Popular

---

# Tabs

Height:

44px

Radius:

12px

Active State:

Primary Blue Background

---

# Empty States

Illustration
Headline
Description
Action Button

Required on all empty screens.

---

# Loading States

Use skeleton loaders.

Avoid spinners when possible.

Skeleton radius:

12px

---

# Notifications

Toast Position:

Top Right

Duration:

4000ms

Types:

Success
Warning
Error
Info

---

# Dashboard Cards

Height:

120px Minimum

Display:

Title
Value
Trend

Examples:

Songs
Media
Credits
Devices

---

# OBS Feature Modules

All feature modules must use identical layout:

Header
Description
Content
Actions

Applies to:

- Bible
- Worship
- Media
- MultiView
- Ticker
- Lower Thirds
- AI Tools

---

# Mobile Control Components

Minimum Touch Target:

56px

Large Buttons Only.

Never use tiny controls.

---

# Animation Rules

Duration:

150ms
300ms

Avoid:

- Bounce
- Excessive motion
- Flashing effects

Preferred:

- Fade
- Slide
- Scale

---

# Final Rule

A user moving between the Landing Page, Dashboard, Desktop App, OBS Dock, and Mobile Control should immediately feel they are using the same product.
