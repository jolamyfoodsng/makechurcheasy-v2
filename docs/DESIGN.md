# MakeChurchEazy Design System Master Guide

> **Superseded:** the current design spec is [`desktop/docs/DESIGN_SYSTEM.md`](../desktop/docs/DESIGN_SYSTEM.md). Where this document disagrees with it (colours, fonts, radii, button and modal sizes, icons), follow DESIGN_SYSTEM.md.

Version: 1.0

This document is the highest design authority for MakeChurchEazy.

Applies to:

- Desktop App
- OBS Dock
- Dashboard
- Landing Page
- Admin Portal
- Mobile Control
- Future Applications

If a conflict exists:

DESIGN_SYSTEM_MASTER.md wins.

---

# Product Philosophy

MakeChurchEazy is not church management software.

MakeChurchEazy is a presentation and livestream platform built around OBS.

Every screen should reinforce:

"Everything your church needs, inside OBS."

---

# Design Principles

1. OBS First
2. Volunteer Friendly
3. Easy To Learn
4. Fast To Operate
5. Professional
6. Low Eye Strain
7. Consistent Everywhere

---

# Visual Personality

The product should feel:

- Modern
- Calm
- Reliable
- Professional
- Friendly

The product should NOT feel:

- Corporate ERP
- Gaming Software
- Fintech App
- Social Network
- Overly Religious

---

# Light Mode

Background:
#F8FAFC

Surface:
#FFFFFF

Elevated:
#F1F5F9

Border:
#CBD5E1

Primary Text:
#0F172A

Secondary Text:
#334155

Muted Text:
#64748B

---

# Dark Mode

Background:
#0F172A

Surface:
#111827

Elevated:
#1F2937

Border:
#334155

Primary Text:
#F8FAFC

Secondary Text:
#CBD5E1

Muted Text:
#94A3B8

---

# Brand Colors

Primary Blue:
#1D4ED8

Primary Purple:
#7C3AED

Accent Orange:
#F97316

Success:
#22C55E

Warning:
#F59E0B

Error:
#EF4444

---

# Color Usage

80% Neutral

15% Blue/Purple

5% Orange

Never create rainbow interfaces.

---

# Typography

Font:

Inter

---

# Text Hierarchy

Page Title

40px
700

Section Title

24px
600

Card Title

18px
600

Body

14px
400

Caption

12px
400

---

# Button System

Primary

Blue

Secondary

Outline

Danger

Red

Ghost

Text Only

No custom button types.

---

# Button Copy Rules

Bad:

Submit

Good:

Save Changes

---

Bad:

Proceed

Good:

Continue Setup

---

Bad:

Push

Good:

Push To OBS

---

# Input Rules

Height:
44px

Radius:
8px

Border:
1px

Padding:
12px

Use same styles everywhere.

---

# Placeholder Rules

Bad:

Search

Good:

Search scriptures, songs, or media...

Bad:

Name

Good:

Enter speaker name

Placeholders should help users.

---

# Labels

Always Above Inputs

Never inside inputs.

Required:

*

Optional:

(Optional)

---

# Textareas

Height:
120-160px

Resize:
Vertical

Radius:
8px

---

# Selects

Same height as inputs.

Same radius as inputs.

Same focus state as inputs.

---

# Validation Messages

Success:
Green

Warning:
Amber

Error:
Red

Icon Required

---

# Card System

Radius:
12px

Padding:
24px

Border:
1px

Cards should rely on borders more than shadows.

---

# Modal System

Standard:
640px

Large:
960px

Confirmation:
480px

Radius:
16px

---

# Page Structure

Every page:

Header

Description

Primary Action

Content

Optional Sidebar

---

# Empty States

Required Components:

Illustration

Headline

Description

Action

Never show blank screens.

---

# Loading States

Skeletons preferred.

Avoid long spinners.

---

# Table Rules

Clean Borders

No alternating rows

Row Height:
56px

Action Column:
Right Aligned

---

# Sidebar Rules

Width:
280px

Collapsed:
72px

Icons:
20px

Item Height:
44px

---

# Navigation Rules

Top Navigation:
72px

Contains:

Logo
Search
Notifications
User Menu

---

# OBS Module Layout

All OBS modules use:

Header

Description

Toolbar

Content

Actions

Advanced Settings

Applies To:

Bible
Worship
Media
MultiView
Ticker
Lower Thirds
AI Tools

---

# Mobile Rules

Touch Targets:
56px Minimum

No tiny buttons.

No tiny text.

---

# Animation Rules

Hover:
150ms

Open:
200ms

Close:
150ms

Maximum:
300ms

Allowed:

Fade
Slide
Scale

Avoid:

Bounce
Shake
Flash

---

# Copywriting Guide

Always communicate outcomes.

Bad:

Manage Media

Good:

Keep every image and video ready for service.

---

Bad:

Bible Versions

Good:

Access hundreds of Bible translations instantly.

---

Bad:

MultiView

Good:

Monitor every output from a single screen.

---

# Premium Gating

Never simply say:

Upgrade

Always explain value.

Example:

Unlock unlimited Bible versions and advanced OBS tools.

---

# Accessibility

Contrast:
4.5:1 Minimum

Keyboard Navigation:
Required

Touch Targets:
44x44 Minimum

---

# AI Agent Rules

Before modifying any UI:

1. Read DESIGN_SYSTEM_MASTER.md
2. Read STYLE_DESIGN.md
3. Read COMPONENT_LIBRARY.md

Priority:

DESIGN_SYSTEM_MASTER.md
↓
STYLE_DESIGN.md
↓
COMPONENT_LIBRARY.md

Never invent:

- New Buttons
- New Cards
- New Inputs
- New Modals

without updating the design system.

---

# Final Rule

A user should be able to move from:

Landing Page
↓
Dashboard
↓
Desktop App
↓
OBS Dock
↓
Mobile Control

and feel they are using one product.