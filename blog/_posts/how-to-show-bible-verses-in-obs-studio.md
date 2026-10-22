---
title: "How to Show Bible Verses in OBS Studio (Step by Step)"
subtitle: "Put any verse on your church livestream in about ten minutes, with no scenes to build"
slug: "how-to-show-bible-verses-in-obs-studio"
excerpt: "A simple step-by-step guide to showing Bible verses in OBS Studio for your church livestream, full screen or as a lower third, using MakeChurchEazy."
date: "2026-10-22T09:00:00.000Z"
coverImage: "/assets/blog/dynamic-routing/cover.jpg"
author:
  name: "MakeChurchEazy Editorial"
  picture: "/assets/blog/authors/mce.svg"
category: "How-to Guides"
tags:
  - Bible in OBS
  - OBS Studio
  - church livestream
  - scripture
seoTitle: "How to Show Bible Verses in OBS Studio (Step by Step) | MakeChurchEazy"
seoDescription: "Learn how to show Bible verses in OBS Studio for your church livestream. Full screen or lower third, any translation, no scenes to build."
---

**Short answer:** install MakeChurchEazy, connect it to OBS Studio, type a Bible reference such as `John 3:16`, and click the verse. It appears on your livestream, full screen or as a lower third. You do not have to build scenes or sources by hand.

This guide takes about ten minutes the first time. After that, showing a verse takes a few seconds.

## What you need

- OBS Studio version 28 or later (it is free)
- A Windows or Mac computer
- MakeChurchEazy (there is a free plan)

## How to show a Bible verse in OBS, step by step

### 1. Install MakeChurchEazy

Download MakeChurchEazy for Windows or Mac from the [download page](/download), install it, and sign in.

### 2. Turn on the WebSocket server in OBS

This lets MakeChurchEazy talk to OBS. There is no plugin to install.

1. In OBS Studio, open **Tools → WebSocket Server Settings**.
2. Tick **Enable WebSocket server**.
3. Leave the port as `4455`. A password is optional.

### 3. Connect MakeChurchEazy to OBS

In MakeChurchEazy, the setup step called **Connect OBS Studio** asks for the host (`localhost`) and port (`4455`). Choose **Test Connection**. When the status says **Connected**, continue.

### 4. Add the Bible dock to OBS

The dock is a control panel that sits inside OBS, next to your preview.

1. In MakeChurchEazy, open **How to Add a Dock in OBS** and copy the **Bible Overlay Dock** URL.
2. In OBS, go to **Docks → Custom Browser Docks**, give it a name, paste the URL, and choose **Apply**.

Add it as a **dock**, not as a Browser Source in a scene.

### 5. Find a verse and put it on screen

1. Open the **Bible** tab in the dock.
2. Type a reference in the search box. Short forms work: `John 3:16`, `jn3:16`, `rom 8:28-30`, `ps23`.
3. Click the verse. It goes live straight away.

You can also search by words. Typing `for God so loved the world` finds John 3:16.

### 6. Choose full screen or lower third

Use the **Full** and **LT** buttons in the bottom toolbar of the dock.

- **Full** fills the screen with the verse. Good for the moment the preacher reads the passage.
- **LT** (lower third) shows the verse as a bar over your camera. Good when you want people to keep seeing the speaker.

## Move through the passage as the preacher reads

You do not need to search again for every verse.

- **Up and down arrows** move to the previous or next verse.
- **Left and right arrows** move to the previous or next chapter.
- **Hide Bible** takes the verse off screen for a moment and keeps your place.
- **Esc** clears the screen.

## Show a different Bible translation

MakeChurchEazy comes with KJV. The first time you sign in with internet, it also downloads ASV, NKJV and ERV. You can download more from **Resources → Bible Library & Downloads**. The catalogue has around a thousand Bibles.

To switch version while searching, type `@` and the short name, for example `@niv`.

## Show two translations side by side

Congregations often follow along in different Bibles. To show two translations of the same verse:

1. In the dock menu, choose **Compare Translations & Passages**.
2. Turn on **Enable Compare Translations**.
3. Pick **Translation A** and **Translation B**.
4. Choose **Side By Side** or **Line By Line**.

A shortcut: type `John 3:16 // niv` in the search box.

## What about the scenes and sources in OBS?

- **Paid plans:** the first time you present, MakeChurchEazy creates a scene called **MCE Presentation** with everything it needs, and keeps it up to date. You never edit it.
- **Free plan:** MakeChurchEazy does not change anything in OBS. Instead, copy the presentation link from the dock (**Copy presentation link**), add one **Browser Source** to your scene, paste the link, and set the size to 1920 × 1080. Everything you present shows in that one source.

## What if you do not use OBS?

You can still show Bible verses on a projector or TV. **Studio mode** sends scripture, lyrics and media straight to a screen in the room, from the same app and the same Bible library. No OBS is needed.

## Can it find the verse for me?

Yes. **Verse AI** listens to the sermon through a microphone or an OBS audio input. When the preacher says a reference such as "John chapter three, verse sixteen", it suggests the passage. Your operator checks it before it goes on screen. It needs an internet connection and depends on your plan and available credits.

## Common questions

### Can I show Bible verses in OBS for free?
Yes. The Free plan includes the Bible dock and several Bible versions. Paid plans add all Bible versions and automatic OBS scenes and sources. See [pricing](/pricing).

### Do I need to know how to use OBS well?
No. If your stream already works in OBS, adding verses is the dock and one click. MakeChurchEazy is built so volunteers can run it.

### Does it work on Mac and Windows?
Yes. MakeChurchEazy is available for both.

### Does it work offline?
Downloaded Bibles can be used for local presentation after setup. Signing in, downloading more Bibles, cloud sync and AI features need internet.

## Ready to try it?

[Download MakeChurchEazy](/download) and follow the steps above. If you get stuck, the full [Show Bible verses](/docs/bible) and [Set up OBS Studio](/docs/obs-setup) guides cover every setting.
