/**
 * bundledGraphicPackages.ts — broadcast graphics that ship inside the app.
 *
 * Same "mce-graphic@1" format as graphics published from Admin → Broadcast Graphics,
 * so they render with public/kinetic/mce-graphic-packages.js (offline, in OBS, the
 * Dock and previews). They use the app's bundled fonts (Montserrat, Arimo).
 * Defaults are placeholder text only — never a real church's details.
 *
 * Admin can still pause, hide or limit them: the catalog entry for the same id wins,
 * and publishing a package with the same id replaces the bundled version.
 * After editing this list, run desktop/scripts/export-broadcast-graphics-builtins.cjs.
 */
import type { GraphicPackage } from "./graphicPackages";

export const BUNDLED_GRAPHIC_PACKAGES: GraphicPackage[] = [
  {
    "format": "mce-graphic@1",
    "id": "prayer-bar",
    "version": 1,
    "name": "Prayer Bar",
    "category": "service",
    "description": "Wide colour bar for a prayer, declaration or confession, with a small label tab. The bar sweeps in, the tab drops onto it, the label spaces out and the words rise in line by line",
    "color": "#d32f2f",
    "hold": 0,
    "placement": {
      "x": 110,
      "y": 60,
      "scale": 1
    },
    "fields": [
      {
        "key": "label",
        "label": "Label",
        "type": "text",
        "default": "PRAYER"
      },
      {
        "key": "text",
        "label": "Prayer text (wraps on its own; press Enter for a new line)",
        "type": "text",
        "default": "Your prayer point goes here",
        "multiline": true
      },
      {
        "key": "align",
        "label": "Text alignment",
        "type": "select",
        "default": "center",
        "options": [
          {
            "value": "center",
            "label": "Centre"
          },
          {
            "value": "left",
            "label": "Left"
          }
        ]
      },
      {
        "key": "size",
        "label": "Text size",
        "type": "select",
        "default": "m",
        "options": [
          {
            "value": "s",
            "label": "Small"
          },
          {
            "value": "m",
            "label": "Medium"
          },
          {
            "value": "l",
            "label": "Large"
          }
        ]
      },
      {
        "key": "bar",
        "label": "Bar colour",
        "type": "color",
        "default": "#d32f2f",
        "shades": true
      },
      {
        "key": "t",
        "label": "Text colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "tab",
        "label": "Label tab colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "tabt",
        "label": "Label text colour",
        "type": "color",
        "default": "#1a1a1a"
      }
    ],
    "animation": {
      "in": [
        [
          ".pr-bar",
          "wipeL",
          0,
          {
            "d": 0.7
          }
        ],
        [
          ".pr-tab",
          "maskDown",
          0.45,
          {
            "d": 0.45
          }
        ],
        {
          "sel": ".pr-label",
          "from": {
            "letterSpacing": "0.02em",
            "opacity": 0
          },
          "to": {
            "letterSpacing": "0.3em",
            "opacity": 1
          },
          "at": 0.6,
          "d": 0.6,
          "e": "power3.out"
        },
        [
          ".pr-text",
          "up",
          0.55,
          {
            "d": 0.6
          }
        ]
      ],
      "out": [
        {
          "sel": ".pr-text",
          "to": {
            "y": -18,
            "opacity": 0
          },
          "at": 0,
          "d": 0.3,
          "e": "power2.in"
        },
        {
          "sel": ".pr-label",
          "to": {
            "opacity": 0
          },
          "at": 0,
          "d": 0.2
        },
        {
          "sel": ".pr-tab",
          "to": {
            "yPercent": 100,
            "opacity": 0
          },
          "at": 0.1,
          "d": 0.3,
          "e": "power2.in"
        },
        {
          "sel": ".pr-bar",
          "to": {
            "clipPath": "inset(0% 0% 0% 100%)"
          },
          "at": 0.25,
          "d": 0.55,
          "e": "power3.inOut"
        }
      ],
      "ambient": [
        {
          "sel": ".pr-shine",
          "from": {
            "xPercent": -150
          },
          "to": {
            "xPercent": 900
          },
          "d": 1.8,
          "e": "power2.inOut",
          "repeat": -1,
          "repeatDelay": 5
        }
      ]
    },
    "css": ".pr{position:relative;width:1700px;padding-top:58px}\n.pr-tab{position:absolute;left:0;top:0;height:58px;display:flex;align-items:center;padding:0 34px 0 30px;background:var(--tab);overflow:hidden;box-shadow:0 -4px 14px rgba(0,0,0,.12)}\n.pr-label{font:600 28px/1 Montserrat,Arial,sans-serif;color:var(--tabt);letter-spacing:.3em;white-space:nowrap}\n.pr-bar{position:relative;overflow:hidden;min-height:150px;display:flex;align-items:center;padding:26px 64px;background:linear-gradient(180deg,var(--bar) 0%,var(--bar) 78%,var(--bar-d) 140%);box-shadow:0 12px 30px rgba(0,0,0,.35)}\n.pr-shine{position:absolute;top:0;bottom:0;left:0;width:10%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.18),transparent);transform:translateX(-150%)}\n.pr-text{position:relative;width:100%;font:700 32px/1.38 Montserrat,Arial,sans-serif;color:var(--t);text-align:center;white-space:normal;text-shadow:0 2px 3px rgba(0,0,0,.25)}\n.pr-al-left .pr-text{text-align:left}\n.pr-sz-s .pr-text{font:700 27px/1.38 Montserrat,Arial,sans-serif}\n.pr-sz-l .pr-text{font:700 38px/1.34 Montserrat,Arial,sans-serif}",
    "html": "<div class=\"pr pr-al-{{align}} pr-sz-{{size}}\">\n  <div class=\"pr-bar\"><i class=\"pr-shine\"></i><div class=\"pr-text\">{{text|br}}</div></div>\n  {{#label}}<div class=\"pr-tab\"><span class=\"pr-label\">{{label}}</span></div>{{/label}}\n</div>"
  },
  {
    "format": "mce-graphic@1",
    "id": "website-bar",
    "version": 1,
    "name": "Website Bar",
    "category": "announcements",
    "description": "Two-tier bar that sends viewers to your website: a light caption strip above a bold address bar with a globe-and-pointer icon. The bar wipes in, the caption slides across, the icon spins in and the address rises",
    "color": "#3d0b10",
    "hold": 10,
    "placement": {
      "x": 110,
      "y": 70,
      "scale": 1
    },
    "fields": [
      {
        "key": "caption",
        "label": "Caption",
        "type": "text",
        "default": "Visit our website for more information"
      },
      {
        "key": "website",
        "label": "Website address",
        "type": "text",
        "default": "yourchurch.org"
      },
      {
        "key": "icon",
        "label": "Globe icon",
        "type": "select",
        "default": "show",
        "options": [
          {
            "value": "show",
            "label": "Show"
          },
          {
            "value": "hide",
            "label": "Hide"
          }
        ]
      },
      {
        "key": "bar",
        "label": "Address bar colour",
        "type": "color",
        "default": "#3d0b10",
        "shades": true
      },
      {
        "key": "t",
        "label": "Address text colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "strip",
        "label": "Caption strip colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "stript",
        "label": "Caption text colour",
        "type": "color",
        "default": "#1a1a1a"
      },
      {
        "key": "ic",
        "label": "Icon colour",
        "type": "color",
        "default": "#e9e4e4"
      }
    ],
    "animation": {
      "in": [
        [
          ".wb-bar",
          "wipeL",
          0,
          {
            "d": 0.7
          }
        ],
        [
          ".wb-strip",
          "wipeL",
          0.25,
          {
            "d": 0.6
          }
        ],
        [
          ".wb-cap",
          "left",
          0.55,
          {
            "d": 0.5
          }
        ],
        [
          ".wb-icon",
          "spin",
          0.5,
          {
            "d": 0.7
          }
        ],
        [
          ".wb-url",
          "maskUp",
          0.6,
          {
            "d": 0.55
          }
        ]
      ],
      "out": [
        {
          "sel": ".wb-url",
          "to": {
            "yPercent": -100,
            "opacity": 0
          },
          "at": 0,
          "d": 0.3,
          "e": "power2.in"
        },
        {
          "sel": ".wb-cap",
          "to": {
            "x": 40,
            "opacity": 0
          },
          "at": 0,
          "d": 0.25,
          "e": "power2.in"
        },
        {
          "sel": ".wb-icon",
          "to": {
            "scale": 0,
            "rotation": 120,
            "opacity": 0,
            "transformOrigin": "50% 50%"
          },
          "at": 0.05,
          "d": 0.3,
          "e": "back.in(2)"
        },
        {
          "sel": ".wb-strip",
          "to": {
            "clipPath": "inset(0% 0% 0% 100%)"
          },
          "at": 0.15,
          "d": 0.4,
          "e": "power3.in"
        },
        {
          "sel": ".wb-bar",
          "to": {
            "clipPath": "inset(0% 0% 0% 100%)"
          },
          "at": 0.3,
          "d": 0.55,
          "e": "power3.inOut"
        }
      ],
      "ambient": [
        {
          "sel": ".wb-shine",
          "from": {
            "xPercent": -150
          },
          "to": {
            "xPercent": 900
          },
          "d": 1.6,
          "e": "power2.inOut",
          "repeat": -1,
          "repeatDelay": 4
        },
        {
          "sel": ".wb-cursor",
          "to": {
            "x": -4,
            "y": -4
          },
          "d": 0.6,
          "yoyo": true,
          "repeatDelay": 2.2
        }
      ]
    },
    "css": ".wb{position:relative;width:max-content;min-width:1000px;max-width:1720px}\n.wb-strip{position:relative;height:66px;display:flex;align-items:center;padding:0 34px;background:var(--strip);box-shadow:0 6px 18px rgba(0,0,0,.18)}\n.wb-cap{font:600 34px/1 Montserrat,Arial,sans-serif;color:var(--stript);white-space:nowrap}\n.wb-bar{position:relative;overflow:hidden;height:150px;display:flex;align-items:center;gap:30px;padding:0 64px 0 40px;background:linear-gradient(180deg,var(--bar) 0%,var(--bar) 70%,var(--bar-d) 130%);box-shadow:0 14px 34px rgba(0,0,0,.4)}\n.wb-shine{position:absolute;top:0;bottom:0;left:0;width:10%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.14),transparent);transform:translateX(-150%)}\n.wb-icon{position:relative;flex:0 0 auto;width:104px;height:104px;color:var(--ic)}\n.wb-icon svg{display:block;width:100%;height:100%;overflow:visible}\n.wb-icon-hide .wb-icon{display:none}\n.wb-url{position:relative;font:800 88px/1 Montserrat,Arial,sans-serif;color:var(--t);letter-spacing:-0.01em;white-space:nowrap;padding-bottom:6px}",
    "html": "<div class=\"wb wb-icon-{{icon}}\">\n  {{#caption}}<div class=\"wb-strip\"><div class=\"wb-cap\">{{caption}}</div></div>{{/caption}}\n  <div class=\"wb-bar\"><i class=\"wb-shine\"></i>\n    <div class=\"wb-icon\"><svg viewBox=\"0 0 100 100\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <circle cx=\"44\" cy=\"44\" r=\"36\"/>\n      <path d=\"M8 44h72M44 8c-12 11-12 61 0 72M44 8c12 11 12 61 0 72M14 26h60M14 62h40\"/>\n      <g class=\"wb-cursor\"><path d=\"M54 52l42 18-18 6-6 18z\" fill=\"currentColor\" stroke=\"var(--bar)\" stroke-width=\"5\"/></g>\n    </svg></div>\n    <div class=\"wb-url\">{{website}}</div>\n  </div>\n</div>"
  },
  {
    "format": "mce-graphic@1",
    "id": "live-social-bar",
    "version": 1,
    "name": "Live Social Bar",
    "category": "social",
    "description": "Gradient title bar with a logo tab, a LIVE badge and three social handles. The bar wipes in, the logo drops, LIVE flashes, the titles rise and the socials slide along the bottom strip",
    "color": "#7a2cf5",
    "hold": 10,
    "placement": {
      "x": 110,
      "y": 70,
      "scale": 1
    },
    "fields": [
      {
        "key": "logo",
        "label": "Logo (leave empty to show the logo text)",
        "type": "image",
        "default": ""
      },
      {
        "key": "logotext",
        "label": "Logo text",
        "type": "text",
        "default": "LOGO HERE"
      },
      {
        "key": "live",
        "label": "Badge",
        "type": "text",
        "default": "LIVE"
      },
      {
        "key": "title",
        "label": "Title",
        "type": "text",
        "default": "YOUR TITLE GOES HERE"
      },
      {
        "key": "subtitle",
        "label": "Additional text",
        "type": "text",
        "default": "ADDITIONAL TEXT HERE"
      },
      {
        "key": "s1",
        "label": "Social 1",
        "type": "select",
        "default": "facebook",
        "options": [
          {
            "value": "facebook",
            "label": "Facebook"
          },
          {
            "value": "instagram",
            "label": "Instagram"
          },
          {
            "value": "youtube",
            "label": "YouTube"
          },
          {
            "value": "x",
            "label": "X / Twitter"
          },
          {
            "value": "tiktok",
            "label": "TikTok"
          },
          {
            "value": "whatsapp",
            "label": "WhatsApp"
          },
          {
            "value": "telegram",
            "label": "Telegram"
          },
          {
            "value": "threads",
            "label": "Threads"
          },
          {
            "value": "twitch",
            "label": "Twitch"
          }
        ]
      },
      {
        "key": "h1",
        "label": "Social 1 handle",
        "type": "text",
        "default": "your social media here"
      },
      {
        "key": "s2",
        "label": "Social 2",
        "type": "select",
        "default": "x",
        "options": [
          {
            "value": "facebook",
            "label": "Facebook"
          },
          {
            "value": "instagram",
            "label": "Instagram"
          },
          {
            "value": "youtube",
            "label": "YouTube"
          },
          {
            "value": "x",
            "label": "X / Twitter"
          },
          {
            "value": "tiktok",
            "label": "TikTok"
          },
          {
            "value": "whatsapp",
            "label": "WhatsApp"
          },
          {
            "value": "telegram",
            "label": "Telegram"
          },
          {
            "value": "threads",
            "label": "Threads"
          },
          {
            "value": "twitch",
            "label": "Twitch"
          }
        ]
      },
      {
        "key": "h2",
        "label": "Social 2 handle",
        "type": "text",
        "default": "your social media here"
      },
      {
        "key": "s3",
        "label": "Social 3",
        "type": "select",
        "default": "instagram",
        "options": [
          {
            "value": "facebook",
            "label": "Facebook"
          },
          {
            "value": "instagram",
            "label": "Instagram"
          },
          {
            "value": "youtube",
            "label": "YouTube"
          },
          {
            "value": "x",
            "label": "X / Twitter"
          },
          {
            "value": "tiktok",
            "label": "TikTok"
          },
          {
            "value": "whatsapp",
            "label": "WhatsApp"
          },
          {
            "value": "telegram",
            "label": "Telegram"
          },
          {
            "value": "threads",
            "label": "Threads"
          },
          {
            "value": "twitch",
            "label": "Twitch"
          }
        ]
      },
      {
        "key": "h3",
        "label": "Social 3 handle",
        "type": "text",
        "default": "your social media here"
      },
      {
        "key": "a",
        "label": "Gradient start",
        "type": "color",
        "default": "#7a2cf5"
      },
      {
        "key": "b",
        "label": "Gradient end",
        "type": "color",
        "default": "#f0641e"
      },
      {
        "key": "c",
        "label": "Badge colour",
        "type": "color",
        "default": "#4b1cf2",
        "shades": true
      },
      {
        "key": "t",
        "label": "Text colour",
        "type": "color",
        "default": "#ffffff"
      }
    ],
    "animation": {
      "in": [
        [
          ".ls-edge",
          "growY",
          0,
          {
            "d": 0.45
          }
        ],
        [
          ".ls-bar",
          "wipeL",
          0.05,
          {
            "d": 0.8
          }
        ],
        [
          ".ls-logo",
          "maskDown",
          0.35,
          {
            "d": 0.5
          }
        ],
        [
          ".ls-live",
          "wipeL",
          0.55,
          {
            "d": 0.45
          }
        ],
        [
          ".ls-live span",
          "pop",
          0.85,
          {
            "d": 0.45
          }
        ],
        [
          ".ls-title",
          "maskUp",
          0.55,
          {
            "d": 0.55
          }
        ],
        [
          ".ls-sub",
          "maskUp",
          0.72,
          {
            "d": 0.5
          }
        ],
        [
          ".ls-strip",
          "growX",
          0.6,
          {
            "d": 0.7
          }
        ],
        [
          ".ls-s",
          "up",
          0.95,
          {
            "d": 0.45,
            "s": 0.12
          }
        ]
      ],
      "out": [
        {
          "sel": ".ls-s",
          "to": {
            "y": 24,
            "opacity": 0
          },
          "at": 0,
          "d": 0.25,
          "e": "power2.in",
          "s": 0.06
        },
        {
          "sel": ".ls-strip",
          "to": {
            "scaleX": 0,
            "transformOrigin": "100% 50%"
          },
          "at": 0.15,
          "d": 0.4,
          "e": "power3.in"
        },
        {
          "sel": ".ls-sub",
          "to": {
            "yPercent": -100,
            "opacity": 0
          },
          "at": 0.05,
          "d": 0.3,
          "e": "power2.in"
        },
        {
          "sel": ".ls-title",
          "to": {
            "yPercent": -100,
            "opacity": 0
          },
          "at": 0.12,
          "d": 0.3,
          "e": "power2.in"
        },
        {
          "sel": ".ls-live",
          "to": {
            "clipPath": "inset(0% 100% 0% 0%)"
          },
          "at": 0.15,
          "d": 0.35,
          "e": "power3.in"
        },
        {
          "sel": ".ls-logo",
          "to": {
            "yPercent": -60,
            "opacity": 0
          },
          "at": 0.25,
          "d": 0.3,
          "e": "power2.in"
        },
        {
          "sel": ".ls-bar",
          "to": {
            "clipPath": "inset(0% 0% 0% 100%)"
          },
          "at": 0.35,
          "d": 0.55,
          "e": "power3.inOut"
        },
        {
          "sel": ".ls-edge",
          "to": {
            "scaleY": 0,
            "transformOrigin": "50% 50%"
          },
          "at": 0.6,
          "d": 0.3,
          "e": "power2.in"
        }
      ],
      "ambient": [
        {
          "sel": ".ls-shine",
          "from": {
            "xPercent": -150
          },
          "to": {
            "xPercent": 700
          },
          "d": 1.6,
          "e": "power2.inOut",
          "repeat": -1,
          "repeatDelay": 3.5
        },
        {
          "sel": ".ls-live span",
          "to": {
            "opacity": 0.55
          },
          "d": 0.9,
          "yoyo": true
        }
      ]
    },
    "css": ".ls{position:relative;width:1500px;height:236px}\n.ls-edge{position:absolute;left:0;top:22px;width:46px;height:206px;border-radius:14px 0 0 14px;background:linear-gradient(90deg,#ffffff 0%,#dcdfe6 70%,#b9bdc8 100%);box-shadow:0 8px 24px rgba(0,0,0,.25)}\n.ls-bar{position:absolute;left:44px;top:22px;width:1456px;height:152px;border-radius:0 26px 0 0;overflow:hidden;background:linear-gradient(90deg,var(--a) 0%,var(--a) 22%,var(--b) 100%);box-shadow:0 12px 32px rgba(0,0,0,.35)}\n.ls-bar:after{content:\"\";position:absolute;inset:0 0 50% 0;background:linear-gradient(180deg,rgba(255,255,255,.16),rgba(255,255,255,0))}\n.ls-shine{position:absolute;top:0;bottom:0;left:0;width:14%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.38),transparent);transform:translateX(-150%)}\n.ls-text{position:absolute;left:440px;right:40px;top:22px;height:152px;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden}\n.ls-title{font:800 64px/1 Montserrat,sans-serif;color:var(--t);letter-spacing:.005em;text-shadow:0 3px 8px rgba(0,0,0,.25);white-space:nowrap}\n.ls-sub{margin-top:10px;font:700 38px/1 Montserrat,sans-serif;color:var(--t);white-space:nowrap}\n.ls-logo{position:absolute;left:44px;top:0;width:376px;height:92px;display:flex;align-items:center;justify-content:center;padding:10px 22px;border-radius:16px 16px 0 0;background:linear-gradient(180deg,#2a2a2e 0%,#0b0b0d 100%);box-shadow:0 6px 18px rgba(0,0,0,.35)}\n.ls-logo .pkg-img{max-height:72px}\n.ls-logo .pkg-fallback{font:800 46px/1 Montserrat,sans-serif;color:#fff;white-space:nowrap}\n.ls-live{position:absolute;left:44px;top:92px;width:376px;height:82px;display:flex;align-items:center;justify-content:center;background:linear-gradient(90deg,var(--c-d) 0%,var(--c) 45%,var(--c-l) 100%)}\n.ls-live span{display:block;font:600 60px/1 Montserrat,sans-serif;color:#fff;letter-spacing:.32em;margin-right:-.32em}\n.ls-strip{position:absolute;left:44px;top:174px;width:1456px;height:58px;background:linear-gradient(180deg,#1c1c1f 0%,#050506 100%);box-shadow:0 10px 24px rgba(0,0,0,.35)}\n.ls-socials{position:absolute;left:44px;top:174px;width:1456px;height:58px;display:flex;align-items:center;justify-content:space-around;padding:0 40px}\n.ls-s{display:flex;align-items:center;gap:14px;font:500 27px/1 Montserrat,sans-serif;color:#fff;white-space:nowrap}\n.ls-s .ic{width:30px;height:30px;color:#fff}",
    "html": "<div class=\"ls\">\n  <div class=\"ls-edge\"></div>\n  <div class=\"ls-bar\"><i class=\"ls-shine\"></i></div>\n  <div class=\"ls-text\">\n    <div class=\"ls-title\">{{title}}</div>\n    {{#subtitle}}<div class=\"ls-sub\">{{subtitle}}</div>{{/subtitle}}\n  </div>\n  <div class=\"ls-strip\"></div>\n  <div class=\"ls-socials\">\n    {{#h1}}<div class=\"ls-s\">{{brands:s1}}<span>{{h1}}</span></div>{{/h1}}\n    {{#h2}}<div class=\"ls-s\">{{brands:s2}}<span>{{h2}}</span></div>{{/h2}}\n    {{#h3}}<div class=\"ls-s\">{{brands:s3}}<span>{{h3}}</span></div>{{/h3}}\n  </div>\n  <div class=\"ls-logo\">{{image:logo|logotext}}</div>\n  <div class=\"ls-live\"><span>{{live}}</span></div>\n</div>"
  },
  {
    "format": "mce-graphic@1",
    "id": "arrow-logo-bar",
    "version": 1,
    "name": "Arrow Logo Bar",
    "category": "branding",
    "description": "Chevron logo block with a gradient arrow bar, social icons and a website strip. The logo punches in, the arrow bar sweeps right, the titles stretch in, the icons pop and the website strip slides out underneath",
    "color": "#f0641e",
    "hold": 10,
    "placement": {
      "x": 110,
      "y": 70,
      "scale": 1
    },
    "fields": [
      {
        "key": "logo",
        "label": "Logo (leave empty to show the logo text)",
        "type": "image",
        "default": ""
      },
      {
        "key": "logotext",
        "label": "Logo text (use | for a new line)",
        "type": "text",
        "default": "LOGO|HERE"
      },
      {
        "key": "title",
        "label": "Title",
        "type": "text",
        "default": "YOUR TITLE GOES HERE"
      },
      {
        "key": "subtitle",
        "label": "Additional text",
        "type": "text",
        "default": "ADDITIONAL TEXT HERE"
      },
      {
        "key": "socials",
        "label": "Social icons",
        "type": "list",
        "options": "brands",
        "default": "facebook,x,instagram"
      },
      {
        "key": "handle",
        "label": "Social handle",
        "type": "text",
        "default": "your social media here"
      },
      {
        "key": "website",
        "label": "Website strip",
        "type": "text",
        "default": "for more updates www.yourwebsite.com"
      },
      {
        "key": "a",
        "label": "Gradient start",
        "type": "color",
        "default": "#7a2cf5"
      },
      {
        "key": "b",
        "label": "Gradient end",
        "type": "color",
        "default": "#f0641e"
      },
      {
        "key": "t",
        "label": "Text colour",
        "type": "color",
        "default": "#ffffff"
      }
    ],
    "animation": {
      "in": [
        [
          ".al-logo",
          "left",
          0,
          {
            "d": 0.55
          }
        ],
        [
          ".al-bar",
          "wipeL",
          0.2,
          {
            "d": 0.85
          }
        ],
        [
          ".al-title",
          "stretch",
          0.75,
          {
            "d": 0.5
          }
        ],
        [
          ".al-sub",
          "maskUp",
          0.95,
          {
            "d": 0.45
          }
        ],
        [
          ".al-icons .ic",
          "pop",
          1.0,
          {
            "d": 0.45,
            "s": 0.1
          }
        ],
        [
          ".al-handle",
          "fade",
          1.3,
          {
            "d": 0.4
          }
        ],
        [
          ".al-web",
          "wipeL",
          0.85,
          {
            "d": 0.6
          }
        ],
        [
          ".al-webtext",
          "left",
          1.15,
          {
            "d": 0.45
          }
        ]
      ],
      "out": [
        {
          "sel": ".al-webtext",
          "to": {
            "opacity": 0
          },
          "at": 0,
          "d": 0.2
        },
        {
          "sel": ".al-web",
          "to": {
            "clipPath": "inset(0% 100% 0% 0%)"
          },
          "at": 0.05,
          "d": 0.4,
          "e": "power3.in"
        },
        {
          "sel": ".al-handle",
          "to": {
            "opacity": 0
          },
          "at": 0,
          "d": 0.2
        },
        {
          "sel": ".al-icons .ic",
          "to": {
            "scale": 0,
            "opacity": 0,
            "transformOrigin": "50% 50%"
          },
          "at": 0,
          "d": 0.25,
          "e": "back.in(2)",
          "s": 0.05
        },
        {
          "sel": ".al-sub",
          "to": {
            "yPercent": 100,
            "opacity": 0
          },
          "at": 0.08,
          "d": 0.28,
          "e": "power2.in"
        },
        {
          "sel": ".al-title",
          "to": {
            "scaleX": 1.5,
            "opacity": 0,
            "filter": "blur(6px)",
            "transformOrigin": "50% 50%"
          },
          "at": 0.12,
          "d": 0.35,
          "e": "power3.in"
        },
        {
          "sel": ".al-bar",
          "to": {
            "clipPath": "inset(0% 100% 0% 0%)"
          },
          "at": 0.35,
          "d": 0.55,
          "e": "power3.inOut"
        },
        {
          "sel": ".al-logo",
          "to": {
            "x": -80,
            "opacity": 0
          },
          "at": 0.7,
          "d": 0.35,
          "e": "power2.in"
        }
      ],
      "ambient": [
        {
          "sel": ".al-shine",
          "from": {
            "xPercent": -150
          },
          "to": {
            "xPercent": 800
          },
          "d": 1.7,
          "e": "power2.inOut",
          "repeat": -1,
          "repeatDelay": 3.5
        }
      ]
    },
    "css": ".al{position:relative;width:1560px;height:236px}\n.al-bar{position:absolute;left:230px;top:0;width:1330px;height:172px;filter:drop-shadow(0 12px 22px rgba(0,0,0,.35))}\n.al-barshape{position:absolute;inset:0;overflow:hidden;clip-path:polygon(0 0,95.2% 0,100% 50%,95.2% 100%,0 100%);background:linear-gradient(90deg,var(--a) 0%,var(--a) 15%,var(--b) 100%)}\n.al-barshape:after{content:\"\";position:absolute;inset:0 0 52% 0;background:linear-gradient(180deg,rgba(255,255,255,.16),rgba(255,255,255,0))}\n.al-shine{position:absolute;top:0;bottom:0;left:0;width:12%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.36),transparent);transform:translateX(-150%)}\n.al-text{position:absolute;left:330px;width:860px;top:0;height:172px;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden}\n.al-title{font:800 62px/1 Montserrat,sans-serif;color:var(--t);text-shadow:0 3px 8px rgba(0,0,0,.25);white-space:nowrap}\n.al-sub{margin-top:10px;font:700 36px/1 Montserrat,sans-serif;color:var(--t);white-space:nowrap}\n.al-right{position:absolute;left:1190px;width:300px;top:0;height:172px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px}\n.al-icons{display:flex;gap:20px;color:var(--t)}\n.al-icons .ic{width:44px;height:44px;color:var(--t)}\n.al-handle{font:500 26px/1 Montserrat,sans-serif;color:var(--t);white-space:nowrap}\n.al-logo{position:absolute;left:0;top:0;width:330px;height:172px;filter:drop-shadow(6px 0 14px rgba(0,0,0,.45))}\n.al-logoshape{position:absolute;inset:0;clip-path:polygon(0 0,80% 0,100% 50%,80% 100%,0 100%);background:linear-gradient(135deg,#3a3a3f 0%,#121214 55%,#000 100%);display:flex;align-items:center;justify-content:center;padding:14px 74px 14px 26px}\n.al-logoshape .pkg-img{max-height:130px}\n.al-logoshape .pkg-fallback{font:800 54px/.98 Montserrat,sans-serif;color:#fff;text-align:center;white-space:nowrap}\n.al-web{position:absolute;left:0;top:180px;width:860px;height:52px;filter:drop-shadow(0 8px 14px rgba(0,0,0,.3))}\n.al-webshape{position:absolute;inset:0;clip-path:polygon(0 0,96.5% 0,100% 50%,96.5% 100%,0 100%);background:linear-gradient(180deg,#ffffff 0%,#e6e8ee 60%,#c9ccd5 100%)}\n.al-webtext{position:absolute;left:28px;top:0;height:52px;display:flex;align-items:center;font:500 27px/1 Montserrat,sans-serif;color:#2b2b33;white-space:nowrap}",
    "html": "<div class=\"al\">\n  <div class=\"al-web\"><div class=\"al-webshape\"></div><div class=\"al-webtext\">{{website}}</div></div>\n  <div class=\"al-bar\"><div class=\"al-barshape\"><i class=\"al-shine\"></i></div></div>\n  <div class=\"al-text\">\n    <div class=\"al-title\">{{title}}</div>\n    {{#subtitle}}<div class=\"al-sub\">{{subtitle}}</div>{{/subtitle}}\n  </div>\n  <div class=\"al-right\">\n    <div class=\"al-icons\">{{brands:socials}}</div>\n    {{#handle}}<div class=\"al-handle\">{{handle}}</div>{{/handle}}\n  </div>\n  <div class=\"al-logo\"><div class=\"al-logoshape\">{{image:logo|logotext}}</div></div>\n</div>"
  },
  {
    "format": "mce-graphic@1",
    "id": "contact-bar",
    "version": 1,
    "name": "Contact Bar",
    "category": "announcements",
    "description": "Two-tier contact bar: a light caption strip above a bold bar with a round icon and your email, phone or handle. The bar wipes in, the caption slides across, the icon pops and the contact rises",
    "color": "#3d0b10",
    "hold": 10,
    "placement": {
      "x": 110,
      "y": 70,
      "scale": 1
    },
    "fields": [
      {
        "key": "caption",
        "label": "Caption",
        "type": "text",
        "default": "For prayer requests, counselling and general enquiries"
      },
      {
        "key": "contact",
        "label": "Email, phone or handle",
        "type": "text",
        "default": "hello@yourchurch.org"
      },
      {
        "key": "icon",
        "label": "Icon",
        "type": "select",
        "options": "icons",
        "default": "mail"
      },
      {
        "key": "bar",
        "label": "Bar colour",
        "type": "color",
        "default": "#3d0b10",
        "shades": true
      },
      {
        "key": "t",
        "label": "Contact text colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "strip",
        "label": "Caption strip colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "stript",
        "label": "Caption text colour",
        "type": "color",
        "default": "#1a1a1a"
      },
      {
        "key": "circle",
        "label": "Icon circle colour",
        "type": "color",
        "default": "#ffffff"
      }
    ],
    "animation": {
      "in": [
        [
          ".cb-bar",
          "wipeL",
          0,
          {
            "d": 0.7
          }
        ],
        [
          ".cb-strip",
          "wipeL",
          0.25,
          {
            "d": 0.6
          }
        ],
        [
          ".cb-cap",
          "left",
          0.55,
          {
            "d": 0.5
          }
        ],
        [
          ".cb-icon",
          "pop",
          0.5,
          {
            "d": 0.5
          }
        ],
        [
          ".cb-contact",
          "maskUp",
          0.6,
          {
            "d": 0.55
          }
        ]
      ],
      "out": [
        {
          "sel": ".cb-contact",
          "to": {
            "yPercent": -100,
            "opacity": 0
          },
          "at": 0,
          "d": 0.3,
          "e": "power2.in"
        },
        {
          "sel": ".cb-cap",
          "to": {
            "x": 40,
            "opacity": 0
          },
          "at": 0,
          "d": 0.25,
          "e": "power2.in"
        },
        {
          "sel": ".cb-icon",
          "to": {
            "scale": 0,
            "opacity": 0,
            "transformOrigin": "50% 50%"
          },
          "at": 0.05,
          "d": 0.3,
          "e": "back.in(2)"
        },
        {
          "sel": ".cb-strip",
          "to": {
            "clipPath": "inset(0% 0% 0% 100%)"
          },
          "at": 0.15,
          "d": 0.4,
          "e": "power3.in"
        },
        {
          "sel": ".cb-bar",
          "to": {
            "clipPath": "inset(0% 0% 0% 100%)"
          },
          "at": 0.3,
          "d": 0.55,
          "e": "power3.inOut"
        }
      ],
      "ambient": [
        {
          "sel": ".cb-shine",
          "from": {
            "xPercent": -150
          },
          "to": {
            "xPercent": 900
          },
          "d": 1.6,
          "e": "power2.inOut",
          "repeat": -1,
          "repeatDelay": 4
        }
      ]
    },
    "css": ".cb{position:relative;width:max-content;min-width:1000px;max-width:1720px}\n.cb-strip{position:relative;height:66px;display:flex;align-items:center;padding:0 34px;background:var(--strip);box-shadow:0 6px 18px rgba(0,0,0,.18)}\n.cb-cap{font:600 34px/1 Montserrat,Arial,sans-serif;color:var(--stript);white-space:nowrap}\n.cb-bar{position:relative;overflow:hidden;height:150px;display:flex;align-items:center;gap:34px;padding:0 64px 0 36px;background:linear-gradient(180deg,var(--bar) 0%,var(--bar) 70%,var(--bar-d) 130%);box-shadow:0 14px 34px rgba(0,0,0,.4)}\n.cb-shine{position:absolute;top:0;bottom:0;left:0;width:10%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.14),transparent);transform:translateX(-150%)}\n.cb-icon{position:relative;flex:0 0 auto;width:108px;height:108px;border-radius:50%;background:var(--circle);display:flex;align-items:center;justify-content:center;color:var(--bar);font-size:66px}\n.cb-contact{position:relative;font:800 84px/1 Montserrat,Arial,sans-serif;color:var(--t);letter-spacing:-0.01em;white-space:nowrap;padding-bottom:6px}",
    "html": "<div class=\"cb\">\n  {{#caption}}<div class=\"cb-strip\"><div class=\"cb-cap\">{{caption}}</div></div>{{/caption}}\n  <div class=\"cb-bar\"><i class=\"cb-shine\"></i>\n    <div class=\"cb-icon\">{{icon:icon}}</div>\n    <div class=\"cb-contact\">{{contact}}</div>\n  </div>\n</div>"
  },
  {
    "format": "mce-graphic@1",
    "id": "testimony-bar",
    "version": 1,
    "name": "Share Your Testimony",
    "category": "announcements",
    "description": "Wide red panel with diagonal stripes, a bold headline and one or two contact boxes. The panel wipes in, the stripes slide in, the headline rises and the boxes grow out one after the other",
    "color": "#9b1414",
    "hold": 10,
    "placement": {
      "x": 110,
      "y": 60,
      "scale": 1
    },
    "fields": [
      {
        "key": "title",
        "label": "Headline",
        "type": "text",
        "default": "SHARE YOUR TESTIMONIES"
      },
      {
        "key": "contact1",
        "label": "First contact",
        "type": "text",
        "default": "testimonies@yourchurch.org"
      },
      {
        "key": "contact2",
        "label": "Second contact (leave empty to hide)",
        "type": "text",
        "default": "share@yourchurch.org"
      },
      {
        "key": "panel",
        "label": "Panel colour",
        "type": "color",
        "default": "#9b1414",
        "shades": true
      },
      {
        "key": "box1",
        "label": "First box colour",
        "type": "color",
        "default": "#7a0e0e"
      },
      {
        "key": "box2",
        "label": "Second box colour",
        "type": "color",
        "default": "#c0392b"
      },
      {
        "key": "t",
        "label": "Text colour",
        "type": "color",
        "default": "#ffffff"
      }
    ],
    "animation": {
      "in": [
        [
          ".tb-panel",
          "wipeL",
          0,
          {
            "d": 0.75
          }
        ],
        {
          "sel": ".tb-stripes",
          "from": {
            "xPercent": 40,
            "opacity": 0
          },
          "to": {
            "xPercent": 0,
            "opacity": 1
          },
          "at": 0.35,
          "d": 0.8,
          "e": "power3.out"
        },
        [
          ".tb-title",
          "maskUp",
          0.45,
          {
            "d": 0.55
          }
        ],
        [
          ".tb-box",
          "growX",
          0.7,
          {
            "d": 0.55,
            "s": 0.15
          }
        ],
        [
          ".tb-box span",
          "fade",
          0.95,
          {
            "d": 0.4,
            "s": 0.15
          }
        ]
      ],
      "out": [
        {
          "sel": ".tb-box span",
          "to": {
            "opacity": 0
          },
          "at": 0,
          "d": 0.2
        },
        {
          "sel": ".tb-box",
          "to": {
            "scaleX": 0,
            "transformOrigin": "100% 50%"
          },
          "at": 0.05,
          "d": 0.35,
          "e": "power3.in",
          "s": 0.08
        },
        {
          "sel": ".tb-title",
          "to": {
            "yPercent": -100,
            "opacity": 0
          },
          "at": 0.05,
          "d": 0.3,
          "e": "power2.in"
        },
        {
          "sel": ".tb-stripes",
          "to": {
            "xPercent": 40,
            "opacity": 0
          },
          "at": 0.1,
          "d": 0.35,
          "e": "power2.in"
        },
        {
          "sel": ".tb-panel",
          "to": {
            "clipPath": "inset(0% 0% 0% 100%)"
          },
          "at": 0.3,
          "d": 0.55,
          "e": "power3.inOut"
        }
      ],
      "ambient": [
        {
          "sel": ".tb-shine",
          "from": {
            "xPercent": -150
          },
          "to": {
            "xPercent": 900
          },
          "d": 1.8,
          "e": "power2.inOut",
          "repeat": -1,
          "repeatDelay": 4.5
        }
      ]
    },
    "css": ".tb{position:relative;width:1700px}\n.tb-panel{position:relative;overflow:hidden;padding:30px 70px 30px;display:flex;flex-direction:column;align-items:center;gap:22px;border-radius:6px;background:linear-gradient(180deg,var(--panel) 0%,var(--panel) 60%,var(--panel-d) 125%);box-shadow:0 14px 34px rgba(0,0,0,.4)}\n.tb-stripes{position:absolute;top:0;right:0;bottom:0;width:30%;background:repeating-linear-gradient(-55deg,rgba(255,255,255,.10) 0 3px,transparent 3px 16px);-webkit-mask-image:linear-gradient(90deg,transparent,#000 60%);mask-image:linear-gradient(90deg,transparent,#000 60%)}\n.tb-shine{position:absolute;top:0;bottom:0;left:0;width:10%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.14),transparent);transform:translateX(-150%)}\n.tb-title{position:relative;font:800 74px/1 Montserrat,Arial,sans-serif;color:var(--t);letter-spacing:.01em;white-space:nowrap;text-shadow:0 3px 8px rgba(0,0,0,.25)}\n.tb-boxes{position:relative;display:flex;gap:24px;justify-content:center;width:100%}\n.tb-box{flex:1 1 0;max-width:760px;display:flex;align-items:center;justify-content:center;padding:16px 26px;border-radius:4px}\n.tb-box1{background:var(--box1)}\n.tb-box2{background:var(--box2)}\n.tb-box span{font:700 38px/1 Montserrat,Arial,sans-serif;color:var(--t);white-space:nowrap}",
    "html": "<div class=\"tb\">\n  <div class=\"tb-panel\"><i class=\"tb-stripes\"></i><i class=\"tb-shine\"></i>\n    <div class=\"tb-title\">{{title}}</div>\n    <div class=\"tb-boxes\">\n      {{#contact1}}<div class=\"tb-box tb-box1\"><span>{{contact1}}</span></div>{{/contact1}}\n      {{#contact2}}<div class=\"tb-box tb-box2\"><span>{{contact2}}</span></div>{{/contact2}}\n    </div>\n  </div>\n</div>"
  },
  {
    "format": "mce-graphic@1",
    "id": "question-bar",
    "version": 1,
    "name": "Question & Answer Bar",
    "category": "service",
    "description": "Sermon point in two tiers: a white question strip above a solid colour bar with the answer in bold capitals. The bar wipes in, the question slides across and the answer rises in",
    "color": "#1d4ed8",
    "hold": 0,
    "placement": {
      "x": 110,
      "y": 60,
      "scale": 1
    },
    "fields": [
      {
        "key": "question",
        "label": "Question / heading",
        "type": "text",
        "default": "YOUR QUESTION HERE"
      },
      {
        "key": "answer",
        "label": "Answer (wraps on its own; press Enter for a new line)",
        "type": "text",
        "default": "YOUR ANSWER OR KEY POINT GOES HERE AND WRAPS ONTO A SECOND LINE",
        "multiline": true
      },
      {
        "key": "size",
        "label": "Answer size",
        "type": "select",
        "default": "l",
        "options": [
          {
            "value": "m",
            "label": "Medium"
          },
          {
            "value": "l",
            "label": "Large"
          },
          {
            "value": "xl",
            "label": "Extra large"
          }
        ]
      },
      {
        "key": "bar",
        "label": "Answer bar colour",
        "type": "color",
        "default": "#1d4ed8",
        "shades": true
      },
      {
        "key": "t",
        "label": "Answer text colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "strip",
        "label": "Question strip colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "stript",
        "label": "Question text colour",
        "type": "color",
        "default": "#000000"
      }
    ],
    "animation": {
      "in": [
        [
          ".qb-bar",
          "wipeL",
          0,
          {
            "d": 0.7
          }
        ],
        [
          ".qb-strip",
          "wipeL",
          0.2,
          {
            "d": 0.55
          }
        ],
        [
          ".qb-q",
          "left",
          0.45,
          {
            "d": 0.45
          }
        ],
        [
          ".qb-a",
          "up",
          0.55,
          {
            "d": 0.6
          }
        ]
      ],
      "out": [
        {
          "sel": ".qb-a",
          "to": {
            "y": -20,
            "opacity": 0
          },
          "at": 0,
          "d": 0.3,
          "e": "power2.in"
        },
        {
          "sel": ".qb-q",
          "to": {
            "x": 40,
            "opacity": 0
          },
          "at": 0,
          "d": 0.25,
          "e": "power2.in"
        },
        {
          "sel": ".qb-strip",
          "to": {
            "clipPath": "inset(0% 0% 0% 100%)"
          },
          "at": 0.12,
          "d": 0.4,
          "e": "power3.in"
        },
        {
          "sel": ".qb-bar",
          "to": {
            "clipPath": "inset(0% 0% 0% 100%)"
          },
          "at": 0.28,
          "d": 0.55,
          "e": "power3.inOut"
        }
      ]
    },
    "css": ".qb{position:relative;width:1700px}\n.qb-strip{position:relative;height:72px;display:flex;align-items:center;padding:0 30px;background:var(--strip);border-radius:6px 6px 0 0;box-shadow:0 6px 18px rgba(0,0,0,.18)}\n.qb-q{font:700 48px/1 Arimo,Arial,Helvetica,sans-serif;color:var(--stript);text-transform:uppercase;white-space:nowrap}\n.qb-bar{position:relative;overflow:hidden;padding:20px 40px 26px;border-radius:0 0 6px 6px;background:var(--bar);box-shadow:0 14px 34px rgba(0,0,0,.4)}\n.qb-a{font:700 78px/1.12 Arimo,Arial,Helvetica,sans-serif;color:var(--t);text-transform:uppercase;white-space:normal;text-shadow:0 2px 4px rgba(0,0,0,.3)}\n.qb-sz-m .qb-a{font:700 62px/1.14 Arimo,Arial,Helvetica,sans-serif}\n.qb-sz-xl .qb-a{font:700 92px/1.08 Arimo,Arial,Helvetica,sans-serif}",
    "html": "<div class=\"qb qb-sz-{{size}}\">\n  {{#question}}<div class=\"qb-strip\"><div class=\"qb-q\">{{question}}</div></div>{{/question}}\n  <div class=\"qb-bar\"><div class=\"qb-a\">{{answer|br}}</div></div>\n</div>"
  },
  {
    "format": "mce-graphic@1",
    "id": "quote-card",
    "version": 1,
    "name": "Quote",
    "category": "quotes",
    "description": "Quote graphic for a lower third or the full screen. Letters track in one by one, highlight or underline bars sweep across each line, quote marks snap in and the name follows; on the way out the letters fold away from the end",
    "color": "#e3171c",
    "hold": 0,
    "placement": {
      "x": 120,
      "y": 90,
      "scale": 1
    },
    "fields": [
      {
        "key": "quote",
        "label": "Quote (wraps on its own; press Enter for a new line)",
        "type": "text",
        "multiline": true,
        "default": "Your quote goes here. Keep it short and it will look its best on screen."
      },
      {
        "key": "author",
        "label": "Name",
        "type": "text",
        "default": "Speaker Name"
      },
      {
        "key": "role",
        "label": "Title or source (optional)",
        "type": "text",
        "default": ""
      },
      {
        "key": "layout",
        "label": "Layout",
        "type": "select",
        "default": "lower",
        "options": [
          {
            "value": "lower",
            "label": "Lower third"
          },
          {
            "value": "full",
            "label": "Fullscreen"
          }
        ]
      },
      {
        "key": "look",
        "label": "Style",
        "type": "select",
        "default": "marker",
        "options": [
          {
            "value": "marker",
            "label": "Highlight bars"
          },
          {
            "value": "underline",
            "label": "Underline"
          },
          {
            "value": "clean",
            "label": "Clean"
          }
        ]
      },
      {
        "key": "marks",
        "label": "Quote marks",
        "type": "select",
        "default": "big",
        "options": [
          {
            "value": "big",
            "label": "Big accent marks"
          },
          {
            "value": "inline",
            "label": "Inline quotes only"
          },
          {
            "value": "none",
            "label": "None"
          }
        ]
      },
      {
        "key": "align",
        "label": "Alignment",
        "type": "select",
        "default": "auto",
        "options": [
          {
            "value": "auto",
            "label": "Auto (left, centred on fullscreen)"
          },
          {
            "value": "left",
            "label": "Left"
          },
          {
            "value": "center",
            "label": "Centre"
          }
        ]
      },
      {
        "key": "size",
        "label": "Text size",
        "type": "select",
        "default": "m",
        "options": [
          {
            "value": "s",
            "label": "Small"
          },
          {
            "value": "m",
            "label": "Medium"
          },
          {
            "value": "l",
            "label": "Large"
          }
        ]
      },
      {
        "key": "backing",
        "label": "Lower third backing",
        "type": "select",
        "default": "shade",
        "options": [
          {
            "value": "shade",
            "label": "Soft shade"
          },
          {
            "value": "panel",
            "label": "Dark panel"
          },
          {
            "value": "none",
            "label": "None"
          }
        ]
      },
      {
        "key": "fill",
        "label": "Fullscreen background",
        "type": "select",
        "default": "solid",
        "options": [
          {
            "value": "solid",
            "label": "Solid colour"
          },
          {
            "value": "dim",
            "label": "Dim the video"
          },
          {
            "value": "none",
            "label": "Transparent"
          }
        ]
      },
      {
        "key": "frame",
        "label": "Fullscreen corner frame",
        "type": "select",
        "default": "show",
        "options": [
          {
            "value": "show",
            "label": "Show"
          },
          {
            "value": "hide",
            "label": "Hide"
          }
        ]
      },
      {
        "key": "accent",
        "label": "Accent colour",
        "type": "color",
        "default": "#e3171c",
        "shades": true
      },
      {
        "key": "t",
        "label": "Quote text colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "at",
        "label": "Name colour",
        "type": "color",
        "default": "#d6d6d6"
      },
      {
        "key": "bg",
        "label": "Background colour",
        "type": "color",
        "default": "#151515",
        "shades": true
      }
    ],
    "animation": {
      "in": [
        {
          "sel": ".qt-bg",
          "from": {
            "opacity": 0
          },
          "to": {
            "opacity": 1
          },
          "at": 0,
          "d": 0.5,
          "e": "power1.out"
        },
        {
          "sel": ".qt-c",
          "from": {
            "opacity": 0,
            "scale": 1.35
          },
          "to": {
            "opacity": 1,
            "scale": 1
          },
          "at": 0.1,
          "d": 0.6,
          "e": "expo.out",
          "s": 0.05
        },
        {
          "sel": ".qt-panel",
          "from": {
            "opacity": 0,
            "scaleX": 0.85,
            "transformOrigin": "0% 50%"
          },
          "to": {
            "opacity": 0.94,
            "scaleX": 1
          },
          "at": 0,
          "d": 0.6,
          "e": "expo.out"
        },
        {
          "sel": ".qt-mk i",
          "from": {
            "opacity": 0,
            "y": -26,
            "skewX": -18
          },
          "to": {
            "opacity": 1,
            "y": 0,
            "skewX": 0
          },
          "at": 0.15,
          "d": 0.45,
          "e": "back.out(2)",
          "s": 0.08
        },
        {
          "sel": ".qt-hl",
          "from": {
            "--hw": "0%"
          },
          "to": {
            "--hw": "100%"
          },
          "at": 0.6,
          "d": 0.9,
          "e": "expo.inOut"
        },
        {
          "sel": ".qt-q .ch",
          "from": {
            "opacity": 0,
            "x": 28,
            "scale": 0.45,
            "transformOrigin": "0% 80%"
          },
          "to": {
            "opacity": 1,
            "x": 0,
            "scale": 1
          },
          "at": 0.25,
          "d": 0.55,
          "e": "expo.out",
          "s": 0.022,
          "sa": 1.1
        },
        {
          "sel": ".qt-mk-c i",
          "from": {
            "opacity": 0,
            "y": 26,
            "skewX": -18
          },
          "to": {
            "opacity": 1,
            "y": 0,
            "skewX": 0
          },
          "at": 1.2,
          "d": 0.45,
          "e": "back.out(2)",
          "s": 0.08
        },
        {
          "sel": ".qt-dash",
          "from": {
            "scaleX": 0,
            "transformOrigin": "0% 50%"
          },
          "to": {
            "scaleX": 1
          },
          "at": 1.0,
          "d": 0.5,
          "e": "expo.out"
        },
        {
          "sel": ".qt-by .ch",
          "from": {
            "opacity": 0,
            "x": 16
          },
          "to": {
            "opacity": 1,
            "x": 0
          },
          "at": 1.1,
          "d": 0.45,
          "e": "power3.out",
          "s": 0.025,
          "sa": 0.6
        },
        {
          "sel": ".qt-r",
          "from": {
            "opacity": 0,
            "x": -12
          },
          "to": {
            "opacity": 1,
            "x": 0
          },
          "at": 1.4,
          "d": 0.45,
          "e": "power3.out"
        }
      ],
      "out": [
        {
          "sel": ".qt-r",
          "to": {
            "opacity": 0
          },
          "at": 0,
          "d": 0.2
        },
        {
          "sel": ".qt-by .ch",
          "to": {
            "opacity": 0,
            "y": -10
          },
          "at": 0,
          "d": 0.25,
          "e": "power2.in",
          "s": 0.015,
          "sa": 0.25,
          "fromEnd": true
        },
        {
          "sel": ".qt-dash",
          "to": {
            "scaleX": 0
          },
          "at": 0.1,
          "d": 0.3,
          "e": "power2.in"
        },
        {
          "sel": ".qt-mk-c i, .qt-mk i",
          "to": {
            "opacity": 0,
            "scale": 0.4
          },
          "at": 0,
          "d": 0.25,
          "e": "power2.in",
          "s": 0.04
        },
        {
          "sel": ".qt-q .ch",
          "to": {
            "opacity": 0,
            "y": -16,
            "scale": 0.5
          },
          "at": 0.05,
          "d": 0.3,
          "e": "power2.in",
          "s": 0.012,
          "sa": 0.7,
          "fromEnd": true
        },
        {
          "sel": ".qt-hl",
          "to": {
            "--hw": "0%"
          },
          "at": 0.35,
          "d": 0.5,
          "e": "power3.inOut"
        },
        {
          "sel": ".qt-panel",
          "to": {
            "opacity": 0,
            "scaleX": 0.9
          },
          "at": 0.55,
          "d": 0.4,
          "e": "power2.in"
        },
        {
          "sel": ".qt-c",
          "to": {
            "opacity": 0,
            "scale": 1.3
          },
          "at": 0.5,
          "d": 0.4,
          "e": "power2.in"
        },
        {
          "sel": ".qt-bg",
          "to": {
            "opacity": 0
          },
          "at": 0.7,
          "d": 0.45,
          "e": "power1.in"
        }
      ],
      "ambient": [
        {
          "sel": ".qt-c",
          "to": {
            "scale": 1.025
          },
          "d": 2.4,
          "yoyo": true,
          "e": "sine.inOut"
        }
      ]
    },
    "css": "\n.qt{position:relative;width:max-content;max-width:1280px}\n.qt-bg{display:none}\n.qt-in{position:relative;padding:34px 56px 40px 52px}\n.qt-panel{position:absolute;inset:0;display:none}\n.qt-bk-shade .qt-panel{display:block;inset:-80px -220px -90px -160px;background:radial-gradient(closest-side,rgba(0,0,0,.62),rgba(0,0,0,.38) 55%,rgba(0,0,0,0))}\n.qt-bk-panel .qt-panel{display:block;background:linear-gradient(100deg,var(--bg) 0%,var(--bg) 60%,var(--bg-d) 100%);opacity:.94;box-shadow:0 18px 40px rgba(0,0,0,.45);border-left:8px solid var(--accent)}\n.qt-mk{position:relative;display:flex;gap:9px;height:44px;margin:0 0 14px 4px}\n.qt-mk i,.qt-mk-c i{display:block;width:22px;height:40px;background:var(--accent);transform:skewX(-16deg);border-radius:2px}\n.qt-mk-c{display:inline-flex;gap:7px;height:30px;margin-left:16px;vertical-align:-0.02em}\n.qt-mk-c i{width:16px;height:30px}\n.qt-mk-none .qt-mk,.qt-mk-none .qt-mk-c,.qt-mk-inline .qt-mk,.qt-mk-inline .qt-mk-c{display:none}\n.qt-mk-none .qt-q .qt-oq{display:none}\n.qt-q{position:relative;font:700 56px/1.26 'Saira Semi Condensed',Arial,sans-serif;color:var(--t);letter-spacing:.005em;white-space:normal;text-shadow:0 2px 4px rgba(0,0,0,.28)}\n.qt-q .w{display:inline-block;white-space:nowrap}\n.qt-q .ch{display:inline-block}\n.qt-hl{--hw:100%;padding:0 .16em;margin:0 -.16em;background-repeat:no-repeat;background-position:0 0;-webkit-box-decoration-break:clone;box-decoration-break:clone}\n.qt-lk-marker .qt-hl{background-image:linear-gradient(var(--accent),var(--accent));background-size:var(--hw) 100%;text-shadow:none}\n.qt-lk-underline .qt-hl{background-image:linear-gradient(var(--accent),var(--accent));background-position:0 92%;background-size:var(--hw) 6px}\n.qt-sz-s .qt-q{font-size:44px}\n.qt-sz-l .qt-q{font-size:68px}\n.qt-by{position:relative;display:flex;align-items:center;gap:14px;margin-top:20px;font:400 30px/1 Roboto,Arial,sans-serif;color:var(--at);letter-spacing:.06em;white-space:nowrap}\n.qt-by .w{display:inline-block}\n.qt-by .ch{display:inline-block}\n.qt-dash{display:block;flex:none;width:38px;height:3px;background:var(--accent)}\n.qt-a{font-weight:500}\n.qt-r{opacity:.75;font-size:.82em;padding-left:14px;border-left:2px solid rgba(255,255,255,.35)}\n.qt-al-center,.qt-l-full.qt-al-auto{text-align:center}\n.qt-al-center .qt-mk,.qt-l-full.qt-al-auto .qt-mk{justify-content:center;margin-left:0}\n.qt-al-center .qt-by,.qt-l-full.qt-al-auto .qt-by{justify-content:center}\n\n.qt-l-full{width:1920px;max-width:none;height:1080px;display:flex;align-items:center;justify-content:center}\n.qt-l-full .qt-bg{display:block;position:absolute;inset:0}\n.qt-l-full.qt-fl-solid .qt-bg{background:radial-gradient(ellipse at 50% 45%,var(--bg-l) 0%,var(--bg) 55%,var(--bg-d) 120%)}\n.qt-l-full.qt-fl-dim .qt-bg{background:radial-gradient(ellipse at 50% 50%,rgba(0,0,0,.55),rgba(0,0,0,.82))}\n.qt-l-full .qt-panel{display:none!important}\n.qt-l-full .qt-in{max-width:1440px;padding:0}\n.qt-l-full .qt-q{font-size:92px;line-height:1.22;text-wrap:balance}\n.qt-l-full.qt-sz-s .qt-q{font-size:74px}\n.qt-l-full.qt-sz-l .qt-q{font-size:112px}\n.qt-l-full .qt-mk{height:66px;gap:13px;margin-bottom:26px}\n.qt-l-full .qt-mk i{width:32px;height:62px}\n.qt-l-full .qt-mk-c{height:46px;gap:10px;margin-left:24px}\n.qt-l-full .qt-mk-c i{width:24px;height:46px}\n.qt-l-full .qt-by{font-size:42px;margin-top:36px;gap:20px}\n.qt-l-full .qt-dash{width:56px;height:4px}\n.qt-l-full.qt-lk-underline .qt-hl{background-size:var(--hw) 9px}\n.qt-c{position:absolute;width:64px;height:64px;border:0 solid rgba(255,255,255,.75)}\n.qt-c1{left:56px;top:56px;border-width:4px 0 0 4px;transform-origin:0 0}\n.qt-c2{right:56px;top:56px;border-width:4px 4px 0 0;transform-origin:100% 0}\n.qt-c3{left:56px;bottom:56px;border-width:0 0 4px 4px;transform-origin:0 100%}\n.qt-c4{right:56px;bottom:56px;border-width:0 4px 4px 0;transform-origin:100% 100%}\n.qt-fr-hide .qt-c{display:none}\n",
    "html": "\n<div class=\"qt qt-l-{{layout}} qt-lk-{{look}} qt-mk-{{marks}} qt-al-{{align}} qt-sz-{{size}} qt-bk-{{backing}} qt-fl-{{fill}} qt-fr-{{frame}}\">\n  <div class=\"qt-bg pkg-fullscreen\"><i class=\"qt-c qt-c1\"></i><i class=\"qt-c qt-c2\"></i><i class=\"qt-c qt-c3\"></i><i class=\"qt-c qt-c4\"></i></div>\n  <div class=\"qt-in\">\n    <div class=\"qt-panel\"></div>\n    <div class=\"qt-mk\"><i></i><i></i></div>\n    <div class=\"qt-q\"><span class=\"qt-hl\"><span class=\"w qt-oq\"><span class=\"ch\">“</span></span>{{quote|chars}}<span class=\"w qt-oq\"><span class=\"ch\">”</span></span></span><span class=\"qt-mk-c\"><i></i><i></i></span></div>\n    {{#author}}<div class=\"qt-by\"><span class=\"qt-dash\"></span><span class=\"qt-a\">{{author|chars}}</span>{{#role}}<span class=\"qt-r\">{{role}}</span>{{/role}}</div>{{/author}}\n  </div>\n</div>\n"
  },
  {
    "format": "mce-graphic@1",
    "version": 2,
    "category": "quotes",
    "hold": 0,
    "placement": {
      "x": 120,
      "y": 90,
      "scale": 1
    },
    "id": "quote-tag-box",
    "name": "Quote · Tag Box",
    "color": "#0f9d58",
    "description": "Name tag sits on a solid colour box holding the quote in capitals; big quote marks snap onto the bottom corner. The tag and box wipe across, the words rise and the marks pop",
    "fields": [
      {
        "key": "quote",
        "label": "Quote (wraps on its own; press Enter for a new line)",
        "type": "text",
        "default": "Your quote goes here. Keep it short and it will look its best on screen.",
        "multiline": true
      },
      {
        "key": "author",
        "label": "Name",
        "type": "text",
        "default": "Author Name"
      },
      {
        "key": "accent",
        "label": "Box colour",
        "type": "color",
        "default": "#0f9d58",
        "shades": true
      },
      {
        "key": "t",
        "label": "Quote colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "tag",
        "label": "Name tag colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "tagt",
        "label": "Name colour",
        "type": "color",
        "default": "#111111"
      },
      {
        "key": "mk",
        "label": "Quote marks colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "layout",
        "label": "Layout",
        "type": "select",
        "default": "full",
        "options": [
          {
            "value": "full",
            "label": "Full screen (centred)"
          },
          {
            "value": "lower",
            "label": "Lower third"
          }
        ]
      },
      {
        "key": "fit",
        "label": "Size (full screen)",
        "type": "select",
        "default": "0.76",
        "options": [
          {
            "value": "0.6",
            "label": "Medium"
          },
          {
            "value": "0.76",
            "label": "Large"
          },
          {
            "value": "0.9",
            "label": "Extra large"
          }
        ]
      }
    ],
    "html": "\n<div class=\"q1\" data-pkg-layout=\"{{layout}}\" data-pkg-fit=\"{{fit}}\">\n  {{#author}}<div class=\"q1-tag\"><span>{{author}}</span></div>{{/author}}\n  <div class=\"q1-box\"><div class=\"q1-t\">{{quote|words}}</div></div>\n  <div class=\"q1-mk\"><svg viewBox=\"0 0 100 80\" fill=\"currentColor\"><path d=\"M6 0h38v38c0 22-12 38-34 42l-4-12c11-4 16-12 16-22H6z\"/><path d=\"M56 0h38v38c0 22-12 38-34 42l-4-12c11-4 16-12 16-22H56z\"/></svg></div>\n</div>",
    "css": "\n.q1{position:relative;width:max-content;max-width:1100px;padding:0 54px 40px 0}\n.q1-tag{display:inline-block;background:var(--tag);padding:8px 14px 7px}\n.q1-tag span{display:block;font:800 27px/1 Montserrat,Arial,sans-serif;color:var(--tagt);text-transform:uppercase;letter-spacing:.02em;white-space:nowrap}\n.q1-box{position:relative;background:var(--accent);padding:18px 30px 26px 18px}\n.q1-t{font:800 41px/1.22 Montserrat,Arial,sans-serif;color:var(--t);text-transform:uppercase;white-space:normal}\n.q1-t .w{display:inline-block}\n.q1-mk{position:absolute;right:0;bottom:0;width:96px;color:var(--mk);filter:drop-shadow(0 3px 6px rgba(0,0,0,.3))}\n.q1-mk svg{display:block;width:100%}\n",
    "animation": {
      "in": [
        [
          ".q1-box",
          "wipeL",
          0,
          {
            "d": 0.6
          }
        ],
        [
          ".q1-tag",
          "wipeL",
          0.25,
          {
            "d": 0.45
          }
        ],
        [
          ".q1-tag span",
          "left",
          0.4,
          {
            "d": 0.4
          }
        ],
        {
          "sel": ".q1-t .w",
          "from": {
            "y": 26,
            "opacity": 0
          },
          "to": {
            "y": 0,
            "opacity": 1
          },
          "at": 0.35,
          "d": 0.5,
          "e": "power3.out",
          "s": 0.05,
          "sa": 0.7
        },
        [
          ".q1-mk",
          "pop",
          0.8,
          {
            "d": 0.5
          }
        ]
      ],
      "out": [
        {
          "sel": ".q1-mk",
          "to": {
            "scale": 0,
            "opacity": 0
          },
          "at": 0,
          "d": 0.25,
          "e": "back.in(2)"
        },
        {
          "sel": ".q1-t .w",
          "to": {
            "y": -16,
            "opacity": 0
          },
          "at": 0,
          "d": 0.28,
          "e": "power2.in",
          "s": 0.02,
          "sa": 0.3,
          "fromEnd": true
        },
        {
          "sel": ".q1-tag",
          "to": {
            "clipPath": "inset(0% 0% 0% 100%)"
          },
          "at": 0.1,
          "d": 0.3,
          "e": "power2.in"
        },
        {
          "sel": ".q1-box",
          "to": {
            "clipPath": "inset(0% 0% 0% 100%)"
          },
          "at": 0.3,
          "d": 0.45,
          "e": "power3.inOut"
        }
      ]
    }
  },
  {
    "format": "mce-graphic@1",
    "version": 2,
    "category": "quotes",
    "hold": 0,
    "placement": {
      "x": 120,
      "y": 90,
      "scale": 1
    },
    "id": "quote-corner-frame",
    "name": "Quote · Corner Frame",
    "color": "#0f9d58",
    "description": "A thin outline frame draws itself around the quote, with a big opening mark on the top-left corner and a closing mark on the bottom-right. The words fade up inside and the name follows",
    "fields": [
      {
        "key": "quote",
        "label": "Quote (wraps on its own; press Enter for a new line)",
        "type": "text",
        "default": "Your quote goes here. Keep it short and it will look its best on screen.",
        "multiline": true
      },
      {
        "key": "author",
        "label": "Name",
        "type": "text",
        "default": "Author Name"
      },
      {
        "key": "accent",
        "label": "Frame colour",
        "type": "color",
        "default": "#0f9d58"
      },
      {
        "key": "t",
        "label": "Quote colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "mk",
        "label": "Quote marks colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "at",
        "label": "Name colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "layout",
        "label": "Layout",
        "type": "select",
        "default": "full",
        "options": [
          {
            "value": "full",
            "label": "Full screen (centred)"
          },
          {
            "value": "lower",
            "label": "Lower third"
          }
        ]
      },
      {
        "key": "fit",
        "label": "Size (full screen)",
        "type": "select",
        "default": "0.76",
        "options": [
          {
            "value": "0.6",
            "label": "Medium"
          },
          {
            "value": "0.76",
            "label": "Large"
          },
          {
            "value": "0.9",
            "label": "Extra large"
          }
        ]
      }
    ],
    "html": "\n<div class=\"q2\" data-pkg-layout=\"{{layout}}\" data-pkg-fit=\"{{fit}}\">\n  <i class=\"q2-b q2-bt\"></i><i class=\"q2-b q2-br\"></i><i class=\"q2-b q2-bb\"></i><i class=\"q2-b q2-bl\"></i>\n  <div class=\"q2-o\"><svg viewBox=\"0 0 100 80\" fill=\"currentColor\" class=\"mk-flip\"><path d=\"M6 0h38v38c0 22-12 38-34 42l-4-12c11-4 16-12 16-22H6z\"/><path d=\"M56 0h38v38c0 22-12 38-34 42l-4-12c11-4 16-12 16-22H56z\"/></svg></div>\n  <div class=\"q2-c\"><svg viewBox=\"0 0 100 80\" fill=\"currentColor\"><path d=\"M6 0h38v38c0 22-12 38-34 42l-4-12c11-4 16-12 16-22H6z\"/><path d=\"M56 0h38v38c0 22-12 38-34 42l-4-12c11-4 16-12 16-22H56z\"/></svg></div>\n  <div class=\"q2-t\">{{quote|words}}</div>\n  {{#author}}<div class=\"q2-a\">{{author|chars}}</div>{{/author}}\n</div>",
    "css": "\n.q2{position:relative;width:max-content;max-width:1000px;margin:34px 30px 30px 26px;padding:34px 40px 30px 40px}\n.q2-b{position:absolute;background:var(--accent)}\n.q2-bt{left:56px;right:0;top:0;height:3px}\n.q2-br{right:0;top:0;bottom:44px;width:3px}\n.q2-bb{left:0;right:56px;bottom:0;height:3px}\n.q2-bl{left:0;top:44px;bottom:0;width:3px}\n.q2-o{position:absolute;left:-26px;top:-34px;width:70px;color:var(--mk)}\n.q2-c{position:absolute;right:-30px;bottom:-30px;width:70px;color:var(--mk)}\n.q2-o svg,.q2-c svg{display:block;width:100%}\n.q2-t{font:600 39px/1.3 Montserrat,Arial,sans-serif;color:var(--t);white-space:normal;text-shadow:0 2px 4px rgba(0,0,0,.35)}\n.q2-t .w{display:inline-block}\n.q2-a{margin-top:14px;font:800 32px/1 Montserrat,Arial,sans-serif;color:var(--at);white-space:nowrap}\n.q2-a .w,.q2-a .ch{display:inline-block}\n.mk-flip{transform:scale(-1,-1)}\n",
    "animation": {
      "in": [
        {
          "sel": ".q2-bt",
          "from": {
            "scaleX": 0,
            "transformOrigin": "100% 50%"
          },
          "to": {
            "scaleX": 1
          },
          "at": 0,
          "d": 0.5,
          "e": "power3.inOut"
        },
        {
          "sel": ".q2-br",
          "from": {
            "scaleY": 0,
            "transformOrigin": "50% 0%"
          },
          "to": {
            "scaleY": 1
          },
          "at": 0.25,
          "d": 0.4,
          "e": "power3.inOut"
        },
        {
          "sel": ".q2-bb",
          "from": {
            "scaleX": 0,
            "transformOrigin": "0% 50%"
          },
          "to": {
            "scaleX": 1
          },
          "at": 0,
          "d": 0.5,
          "e": "power3.inOut"
        },
        {
          "sel": ".q2-bl",
          "from": {
            "scaleY": 0,
            "transformOrigin": "50% 100%"
          },
          "to": {
            "scaleY": 1
          },
          "at": 0.25,
          "d": 0.4,
          "e": "power3.inOut"
        },
        [
          ".q2-o",
          "pop",
          0.45,
          {
            "d": 0.45
          }
        ],
        [
          ".q2-c",
          "pop",
          0.6,
          {
            "d": 0.45
          }
        ],
        {
          "sel": ".q2-t .w",
          "from": {
            "y": 26,
            "opacity": 0
          },
          "to": {
            "y": 0,
            "opacity": 1
          },
          "at": 0.4,
          "d": 0.5,
          "e": "power3.out",
          "s": 0.05,
          "sa": 0.7
        },
        {
          "sel": ".q2-a .ch",
          "from": {
            "opacity": 0,
            "x": 14
          },
          "to": {
            "opacity": 1,
            "x": 0
          },
          "at": 0.9,
          "d": 0.4,
          "e": "power3.out",
          "s": 0.03,
          "sa": 0.45
        }
      ],
      "out": [
        {
          "sel": ".q2-a",
          "to": {
            "opacity": 0
          },
          "at": 0,
          "d": 0.2
        },
        {
          "sel": ".q2-t .w",
          "to": {
            "y": -16,
            "opacity": 0
          },
          "at": 0,
          "d": 0.28,
          "e": "power2.in",
          "s": 0.02,
          "sa": 0.3,
          "fromEnd": true
        },
        {
          "sel": ".q2-o, .q2-c",
          "to": {
            "scale": 0,
            "opacity": 0
          },
          "at": 0.1,
          "d": 0.25,
          "e": "back.in(2)"
        },
        {
          "sel": ".q2-bt, .q2-bb",
          "to": {
            "scaleX": 0
          },
          "at": 0.3,
          "d": 0.4,
          "e": "power3.inOut"
        },
        {
          "sel": ".q2-br, .q2-bl",
          "to": {
            "scaleY": 0
          },
          "at": 0.25,
          "d": 0.35,
          "e": "power3.inOut"
        }
      ]
    }
  },
  {
    "format": "mce-graphic@1",
    "version": 2,
    "category": "quotes",
    "hold": 0,
    "placement": {
      "x": 120,
      "y": 90,
      "scale": 1
    },
    "id": "quote-solid-box",
    "name": "Quote · Solid Box",
    "color": "#0f9d58",
    "description": "Clean colour box with the quote in capitals and the name in small caps underneath, with a quote mark hanging off the left edge. The box wipes in, then the words and the name",
    "fields": [
      {
        "key": "quote",
        "label": "Quote (wraps on its own; press Enter for a new line)",
        "type": "text",
        "default": "Your quote goes here. Keep it short and it will look its best on screen.",
        "multiline": true
      },
      {
        "key": "author",
        "label": "Name",
        "type": "text",
        "default": "Author Name"
      },
      {
        "key": "accent",
        "label": "Box colour",
        "type": "color",
        "default": "#0f9d58",
        "shades": true
      },
      {
        "key": "t",
        "label": "Quote colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "at",
        "label": "Name colour",
        "type": "color",
        "default": "#e9fff2"
      },
      {
        "key": "mk",
        "label": "Quote mark colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "layout",
        "label": "Layout",
        "type": "select",
        "default": "full",
        "options": [
          {
            "value": "full",
            "label": "Full screen (centred)"
          },
          {
            "value": "lower",
            "label": "Lower third"
          }
        ]
      },
      {
        "key": "fit",
        "label": "Size (full screen)",
        "type": "select",
        "default": "0.76",
        "options": [
          {
            "value": "0.6",
            "label": "Medium"
          },
          {
            "value": "0.76",
            "label": "Large"
          },
          {
            "value": "0.9",
            "label": "Extra large"
          }
        ]
      }
    ],
    "html": "\n<div class=\"q3\" data-pkg-layout=\"{{layout}}\" data-pkg-fit=\"{{fit}}\">\n  <div class=\"q3-mk\"><svg viewBox=\"0 0 100 80\" fill=\"currentColor\" class=\"mk-flip\"><path d=\"M6 0h38v38c0 22-12 38-34 42l-4-12c11-4 16-12 16-22H6z\"/><path d=\"M56 0h38v38c0 22-12 38-34 42l-4-12c11-4 16-12 16-22H56z\"/></svg></div>\n  <div class=\"q3-box\">\n    <div class=\"q3-t\">{{quote|words}}</div>\n    {{#author}}<div class=\"q3-a\">{{author}}</div>{{/author}}\n  </div>\n</div>",
    "css": "\n.q3{position:relative;width:max-content;max-width:1100px;padding:26px 0 0 0}\n.q3-box{position:relative;background:linear-gradient(180deg,var(--accent-l) -40%,var(--accent) 40%,var(--accent-d) 160%);padding:22px 34px 20px 34px;box-shadow:0 12px 28px rgba(0,0,0,.35)}\n.q3-mk{position:absolute;left:-18px;top:0;width:60px;color:var(--mk);z-index:1;filter:drop-shadow(0 3px 6px rgba(0,0,0,.35))}\n.q3-mk svg{display:block;width:100%}\n.q3-t{font:800 37px/1.25 Montserrat,Arial,sans-serif;color:var(--t);text-transform:uppercase;white-space:normal}\n.q3-t .w{display:inline-block}\n.q3-a{margin-top:10px;font:700 24px/1 Montserrat,Arial,sans-serif;color:var(--at);text-transform:uppercase;letter-spacing:.12em;white-space:nowrap}\n.mk-flip{transform:scale(-1,-1)}\n",
    "animation": {
      "in": [
        [
          ".q3-box",
          "wipeR",
          0,
          {
            "d": 0.6
          }
        ],
        {
          "sel": ".q3-t .w",
          "from": {
            "y": 26,
            "opacity": 0
          },
          "to": {
            "y": 0,
            "opacity": 1
          },
          "at": 0.3,
          "d": 0.5,
          "e": "power3.out",
          "s": 0.05,
          "sa": 0.7
        },
        [
          ".q3-a",
          "maskUp",
          0.8,
          {
            "d": 0.45
          }
        ],
        [
          ".q3-mk",
          "spin",
          0.5,
          {
            "d": 0.6
          }
        ]
      ],
      "out": [
        {
          "sel": ".q3-mk",
          "to": {
            "scale": 0,
            "rotation": 90,
            "opacity": 0
          },
          "at": 0,
          "d": 0.3,
          "e": "back.in(2)"
        },
        {
          "sel": ".q3-a",
          "to": {
            "opacity": 0
          },
          "at": 0,
          "d": 0.2
        },
        {
          "sel": ".q3-t .w",
          "to": {
            "y": -16,
            "opacity": 0
          },
          "at": 0,
          "d": 0.28,
          "e": "power2.in",
          "s": 0.02,
          "sa": 0.3,
          "fromEnd": true
        },
        {
          "sel": ".q3-box",
          "to": {
            "clipPath": "inset(0% 100% 0% 0%)"
          },
          "at": 0.3,
          "d": 0.45,
          "e": "power3.inOut"
        }
      ]
    }
  },
  {
    "format": "mce-graphic@1",
    "version": 2,
    "category": "quotes",
    "hold": 0,
    "placement": {
      "x": 120,
      "y": 90,
      "scale": 1
    },
    "id": "quote-clean",
    "name": "Quote · Clean",
    "color": "#ffffff",
    "description": "No box, just type: big quote marks, the quote in sentence case and a bold name. The marks fade down, each word rises in turn and the name slides up out of a mask",
    "fields": [
      {
        "key": "quote",
        "label": "Quote (wraps on its own; press Enter for a new line)",
        "type": "text",
        "default": "Your quote goes here. Keep it short and it will look its best on screen.",
        "multiline": true
      },
      {
        "key": "author",
        "label": "Name",
        "type": "text",
        "default": "Author Name"
      },
      {
        "key": "t",
        "label": "Quote colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "mk",
        "label": "Quote marks colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "at",
        "label": "Name colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "shade",
        "label": "Soft shade behind",
        "type": "select",
        "default": "show",
        "options": [
          {
            "value": "show",
            "label": "Show"
          },
          {
            "value": "hide",
            "label": "Hide"
          }
        ]
      },
      {
        "key": "layout",
        "label": "Layout",
        "type": "select",
        "default": "full",
        "options": [
          {
            "value": "full",
            "label": "Full screen (centred)"
          },
          {
            "value": "lower",
            "label": "Lower third"
          }
        ]
      },
      {
        "key": "fit",
        "label": "Size (full screen)",
        "type": "select",
        "default": "0.76",
        "options": [
          {
            "value": "0.6",
            "label": "Medium"
          },
          {
            "value": "0.76",
            "label": "Large"
          },
          {
            "value": "0.9",
            "label": "Extra large"
          }
        ]
      }
    ],
    "html": "\n<div class=\"q4 q4-sh-{{shade}}\" data-pkg-layout=\"{{layout}}\" data-pkg-fit=\"{{fit}}\">\n  <div class=\"q4-sh\"></div>\n  <div class=\"q4-mk\"><svg viewBox=\"0 0 100 80\" fill=\"currentColor\"><path d=\"M6 0h38v38c0 22-12 38-34 42l-4-12c11-4 16-12 16-22H6z\"/><path d=\"M56 0h38v38c0 22-12 38-34 42l-4-12c11-4 16-12 16-22H56z\"/></svg></div>\n  <div class=\"q4-t\">{{quote|words}}</div>\n  {{#author}}<div class=\"q4-ar\"><div class=\"q4-a\">{{author}}</div></div>{{/author}}\n</div>",
    "css": "\n.q4{position:relative;width:max-content;max-width:800px}\n.q4-sh{position:absolute;inset:-70px -200px -70px -120px;background:radial-gradient(closest-side,rgba(0,0,0,.55),rgba(0,0,0,.25) 60%,rgba(0,0,0,0))}\n.q4-sh-hide .q4-sh{display:none}\n.q4-mk{position:relative;width:92px;color:var(--mk);margin-bottom:14px}\n.q4-mk svg{display:block;width:100%}\n.q4-t{position:relative;font:500 41px/1.18 Montserrat,Arial,sans-serif;color:var(--t);white-space:normal}\n.q4-t .w{display:inline-block}\n.q4-ar{position:relative;overflow:hidden;margin-top:14px}\n.q4-a{font:800 49px/1.1 Montserrat,Arial,sans-serif;color:var(--at);white-space:nowrap}\n",
    "animation": {
      "in": [
        [
          ".q4-sh",
          "fade",
          0,
          {
            "d": 0.5
          }
        ],
        [
          ".q4-mk",
          "down",
          0,
          {
            "d": 0.5
          }
        ],
        {
          "sel": ".q4-t .w",
          "from": {
            "y": 26,
            "opacity": 0
          },
          "to": {
            "y": 0,
            "opacity": 1
          },
          "at": 0.15,
          "d": 0.5,
          "e": "power3.out",
          "s": 0.05,
          "sa": 0.9
        },
        [
          ".q4-a",
          "slideUp",
          0.7,
          {
            "d": 0.55
          }
        ]
      ],
      "out": [
        {
          "sel": ".q4-a",
          "to": {
            "yPercent": 105
          },
          "at": 0,
          "d": 0.3,
          "e": "power2.in"
        },
        {
          "sel": ".q4-t .w",
          "to": {
            "y": -16,
            "opacity": 0
          },
          "at": 0.05,
          "d": 0.28,
          "e": "power2.in",
          "s": 0.02,
          "sa": 0.3,
          "fromEnd": true
        },
        {
          "sel": ".q4-mk",
          "to": {
            "y": -20,
            "opacity": 0
          },
          "at": 0.3,
          "d": 0.3,
          "e": "power2.in"
        },
        {
          "sel": ".q4-sh",
          "to": {
            "opacity": 0
          },
          "at": 0.35,
          "d": 0.35
        }
      ]
    }
  },
  {
    "format": "mce-graphic@1",
    "version": 2,
    "category": "quotes",
    "hold": 0,
    "placement": {
      "x": 120,
      "y": 90,
      "scale": 1
    },
    "id": "quote-centred-tag",
    "name": "Quote · Centred Tag",
    "color": "#0f9d58",
    "description": "Centred quote in capitals with a colour quote mark above, a thin rule underneath and the name in a colour tag. The rule draws out from the middle and the name spreads in letter by letter",
    "fields": [
      {
        "key": "quote",
        "label": "Quote (wraps on its own; press Enter for a new line)",
        "type": "text",
        "default": "Your quote goes here. Keep it short and it will look its best on screen.",
        "multiline": true
      },
      {
        "key": "author",
        "label": "Name",
        "type": "text",
        "default": "Author Name"
      },
      {
        "key": "accent",
        "label": "Accent colour",
        "type": "color",
        "default": "#0f9d58"
      },
      {
        "key": "t",
        "label": "Quote colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "tagt",
        "label": "Name colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "rule",
        "label": "Rule under the quote",
        "type": "select",
        "default": "show",
        "options": [
          {
            "value": "show",
            "label": "Show"
          },
          {
            "value": "hide",
            "label": "Hide"
          }
        ]
      },
      {
        "key": "layout",
        "label": "Layout",
        "type": "select",
        "default": "full",
        "options": [
          {
            "value": "full",
            "label": "Full screen (centred)"
          },
          {
            "value": "lower",
            "label": "Lower third"
          }
        ]
      },
      {
        "key": "fit",
        "label": "Size (full screen)",
        "type": "select",
        "default": "0.76",
        "options": [
          {
            "value": "0.6",
            "label": "Medium"
          },
          {
            "value": "0.76",
            "label": "Large"
          },
          {
            "value": "0.9",
            "label": "Extra large"
          }
        ]
      }
    ],
    "html": "\n<div class=\"q5 q5-r-{{rule}}\" data-pkg-layout=\"{{layout}}\" data-pkg-fit=\"{{fit}}\">\n  <div class=\"q5-mk\"><svg viewBox=\"0 0 100 80\" fill=\"currentColor\"><path d=\"M6 0h38v38c0 22-12 38-34 42l-4-12c11-4 16-12 16-22H6z\"/><path d=\"M56 0h38v38c0 22-12 38-34 42l-4-12c11-4 16-12 16-22H56z\"/></svg></div>\n  <div class=\"q5-t\">{{quote|words}}</div>\n  <i class=\"q5-rule\"></i>\n  {{#author}}<div class=\"q5-tag\"><span>&ndash; {{author|chars}}</span></div>{{/author}}\n</div>",
    "css": "\n.q5{position:relative;width:max-content;max-width:940px;display:flex;flex-direction:column;align-items:center;text-align:center}\n.q5-mk{width:68px;color:var(--accent);margin-bottom:12px}\n.q5-mk svg{display:block;width:100%}\n.q5-t{font:800 39px/1.18 Montserrat,Arial,sans-serif;color:var(--t);text-transform:uppercase;white-space:normal;text-shadow:0 2px 4px rgba(0,0,0,.35)}\n.q5-t .w{display:inline-block}\n.q5-rule{display:block;width:100%;height:4px;margin-top:12px;background:var(--accent)}\n.q5-r-hide .q5-rule{display:none}\n.q5-tag{margin-top:10px;padding:8px 20px 9px;background:var(--accent)}\n.q5-tag span{display:block;font:800 37px/1 Montserrat,Arial,sans-serif;color:var(--tagt);text-transform:uppercase;white-space:nowrap}\n.q5-tag .w,.q5-tag .ch{display:inline-block}\n",
    "animation": {
      "in": [
        [
          ".q5-mk",
          "pop",
          0,
          {
            "d": 0.45
          }
        ],
        {
          "sel": ".q5-t .w",
          "from": {
            "y": 26,
            "opacity": 0
          },
          "to": {
            "y": 0,
            "opacity": 1
          },
          "at": 0.15,
          "d": 0.5,
          "e": "power3.out",
          "s": 0.05,
          "sa": 0.7
        },
        {
          "sel": ".q5-rule",
          "from": {
            "scaleX": 0,
            "transformOrigin": "50% 50%"
          },
          "to": {
            "scaleX": 1
          },
          "at": 0.5,
          "d": 0.6,
          "e": "expo.out"
        },
        [
          ".q5-tag",
          "wipeC",
          0.7,
          {
            "d": 0.5
          }
        ],
        {
          "sel": ".q5-tag .ch",
          "from": {
            "opacity": 0,
            "x": 22
          },
          "to": {
            "opacity": 1,
            "x": 0
          },
          "at": 0.85,
          "d": 0.4,
          "e": "power3.out",
          "s": 0.03,
          "sa": 0.4
        }
      ],
      "out": [
        {
          "sel": ".q5-tag .ch",
          "to": {
            "opacity": 0,
            "x": 20
          },
          "at": 0,
          "d": 0.25,
          "e": "power2.in",
          "s": 0.02,
          "sa": 0.25,
          "fromEnd": true
        },
        {
          "sel": ".q5-tag",
          "to": {
            "clipPath": "inset(0% 50% 0% 50%)"
          },
          "at": 0.2,
          "d": 0.35,
          "e": "power3.in"
        },
        {
          "sel": ".q5-rule",
          "to": {
            "scaleX": 0
          },
          "at": 0.25,
          "d": 0.35,
          "e": "power3.in"
        },
        {
          "sel": ".q5-t .w",
          "to": {
            "y": -16,
            "opacity": 0
          },
          "at": 0.05,
          "d": 0.28,
          "e": "power2.in",
          "s": 0.02,
          "sa": 0.3,
          "fromEnd": true
        },
        {
          "sel": ".q5-mk",
          "to": {
            "scale": 0,
            "opacity": 0
          },
          "at": 0.35,
          "d": 0.25,
          "e": "back.in(2)"
        }
      ]
    }
  },
  {
    "format": "mce-graphic@1",
    "version": 2,
    "category": "quotes",
    "hold": 0,
    "placement": {
      "x": 120,
      "y": 90,
      "scale": 1
    },
    "id": "quote-mark-block",
    "name": "Quote · Mark Block",
    "color": "#0f9d58",
    "description": "A colour square with a huge quote mark grows from a thin line, the quote in capitals slides out from behind it and the name lands in a colour tag underneath",
    "fields": [
      {
        "key": "quote",
        "label": "Quote (wraps on its own; press Enter for a new line)",
        "type": "text",
        "default": "Your short quote goes here",
        "multiline": true
      },
      {
        "key": "author",
        "label": "Name",
        "type": "text",
        "default": "Author Name"
      },
      {
        "key": "accent",
        "label": "Accent colour",
        "type": "color",
        "default": "#0f9d58",
        "shades": true
      },
      {
        "key": "mk",
        "label": "Quote mark colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "t",
        "label": "Quote colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "tagt",
        "label": "Name colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "layout",
        "label": "Layout",
        "type": "select",
        "default": "full",
        "options": [
          {
            "value": "full",
            "label": "Full screen (centred)"
          },
          {
            "value": "lower",
            "label": "Lower third"
          }
        ]
      },
      {
        "key": "fit",
        "label": "Size (full screen)",
        "type": "select",
        "default": "0.76",
        "options": [
          {
            "value": "0.6",
            "label": "Medium"
          },
          {
            "value": "0.76",
            "label": "Large"
          },
          {
            "value": "0.9",
            "label": "Extra large"
          }
        ]
      }
    ],
    "html": "\n<div class=\"q6\" data-pkg-layout=\"{{layout}}\" data-pkg-fit=\"{{fit}}\">\n  <div class=\"q6-blk\"><div class=\"q6-mk\"><svg viewBox=\"0 0 100 80\" fill=\"currentColor\"><path d=\"M6 0h38v38c0 22-12 38-34 42l-4-12c11-4 16-12 16-22H6z\"/><path d=\"M56 0h38v38c0 22-12 38-34 42l-4-12c11-4 16-12 16-22H56z\"/></svg></div></div>\n  <div class=\"q6-side\">\n    <div class=\"q6-t\">{{quote|words}}</div>\n    {{#author}}<div class=\"q6-tag\"><span>{{author}}</span></div>{{/author}}\n  </div>\n</div>",
    "css": "\n.q6{position:relative;display:flex;align-items:stretch;gap:20px;width:max-content;max-width:1300px}\n.q6-blk{position:relative;flex:none;width:200px;min-height:180px;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,var(--accent-l) -20%,var(--accent) 50%,var(--accent-d) 150%);box-shadow:0 12px 26px rgba(0,0,0,.35)}\n.q6-mk{width:124px;color:var(--mk)}\n.q6-mk svg{display:block;width:100%}\n.q6-side{display:flex;flex-direction:column;justify-content:center;align-items:flex-start;overflow:hidden;padding:4px 0}\n.q6-t{font:800 37px/1.3 Montserrat,Arial,sans-serif;color:var(--t);text-transform:uppercase;white-space:normal;max-width:940px;text-shadow:0 2px 4px rgba(0,0,0,.35)}\n.q6-t .w{display:inline-block}\n.q6-tag{margin-top:12px;padding:8px 16px 9px;background:var(--accent)}\n.q6-tag span{display:block;font:800 41px/1 Montserrat,Arial,sans-serif;color:var(--tagt);text-transform:uppercase;white-space:nowrap}\n",
    "animation": {
      "in": [
        {
          "sel": ".q6-blk",
          "from": {
            "scaleX": 0.03,
            "transformOrigin": "100% 50%"
          },
          "to": {
            "scaleX": 1
          },
          "at": 0,
          "d": 0.55,
          "e": "expo.inOut"
        },
        [
          ".q6-mk",
          "pop",
          0.4,
          {
            "d": 0.5
          }
        ],
        {
          "sel": ".q6-t .w",
          "from": {
            "y": 26,
            "opacity": 0
          },
          "to": {
            "y": 0,
            "opacity": 1
          },
          "at": 0.4,
          "d": 0.5,
          "e": "power3.out",
          "s": 0.05,
          "sa": 0.5
        },
        [
          ".q6-tag",
          "wipeL",
          0.75,
          {
            "d": 0.45
          }
        ],
        [
          ".q6-tag span",
          "left",
          0.85,
          {
            "d": 0.4
          }
        ]
      ],
      "out": [
        {
          "sel": ".q6-tag",
          "to": {
            "clipPath": "inset(0% 100% 0% 0%)"
          },
          "at": 0,
          "d": 0.3,
          "e": "power2.in"
        },
        {
          "sel": ".q6-t .w",
          "to": {
            "y": -16,
            "opacity": 0
          },
          "at": 0.05,
          "d": 0.28,
          "e": "power2.in",
          "s": 0.02,
          "sa": 0.3,
          "fromEnd": true
        },
        {
          "sel": ".q6-mk",
          "to": {
            "scale": 0,
            "opacity": 0
          },
          "at": 0.2,
          "d": 0.25,
          "e": "back.in(2)"
        },
        {
          "sel": ".q6-blk",
          "to": {
            "scaleX": 0.03,
            "opacity": 0
          },
          "at": 0.35,
          "d": 0.45,
          "e": "expo.inOut"
        }
      ]
    }
  },
  {
    "format": "mce-graphic@1",
    "version": 2,
    "category": "quotes",
    "hold": 0,
    "placement": {
      "x": 120,
      "y": 90,
      "scale": 1
    },
    "id": "quote-outline-box",
    "name": "Quote · Outline Box",
    "color": "#0f9d58",
    "description": "A colour outline box draws itself in, a quote mark drops onto its top-left corner, the quote types in word by word and the name appears centred underneath",
    "fields": [
      {
        "key": "quote",
        "label": "Quote (wraps on its own; press Enter for a new line)",
        "type": "text",
        "default": "Your quote goes here. Keep it short and it will look its best on screen.",
        "multiline": true
      },
      {
        "key": "author",
        "label": "Name",
        "type": "text",
        "default": "Author Name"
      },
      {
        "key": "accent",
        "label": "Outline colour",
        "type": "color",
        "default": "#0f9d58"
      },
      {
        "key": "t",
        "label": "Quote colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "mk",
        "label": "Quote mark colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "at",
        "label": "Name colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "fill",
        "label": "Box fill",
        "type": "select",
        "default": "dim",
        "options": [
          {
            "value": "dim",
            "label": "Dark tint"
          },
          {
            "value": "none",
            "label": "None"
          }
        ]
      },
      {
        "key": "layout",
        "label": "Layout",
        "type": "select",
        "default": "full",
        "options": [
          {
            "value": "full",
            "label": "Full screen (centred)"
          },
          {
            "value": "lower",
            "label": "Lower third"
          }
        ]
      },
      {
        "key": "fit",
        "label": "Size (full screen)",
        "type": "select",
        "default": "0.76",
        "options": [
          {
            "value": "0.6",
            "label": "Medium"
          },
          {
            "value": "0.76",
            "label": "Large"
          },
          {
            "value": "0.9",
            "label": "Extra large"
          }
        ]
      }
    ],
    "html": "\n<div class=\"q7 q7-f-{{fill}}\" data-pkg-layout=\"{{layout}}\" data-pkg-fit=\"{{fit}}\">\n  <div class=\"q7-mk\"><svg viewBox=\"0 0 100 80\" fill=\"currentColor\"><path d=\"M6 0h38v38c0 22-12 38-34 42l-4-12c11-4 16-12 16-22H6z\"/><path d=\"M56 0h38v38c0 22-12 38-34 42l-4-12c11-4 16-12 16-22H56z\"/></svg></div>\n  <div class=\"q7-box\">\n    <div class=\"q7-bg\"></div>\n    <i class=\"q7-b q7-bt\"></i><i class=\"q7-b q7-br\"></i><i class=\"q7-b q7-bb\"></i><i class=\"q7-b q7-bl\"></i>\n    <div class=\"q7-t\">{{quote|words}}</div>\n  </div>\n  {{#author}}<div class=\"q7-a\">{{author|words}}</div>{{/author}}\n</div>",
    "css": "\n.q7{position:relative;width:max-content;max-width:1050px;display:flex;flex-direction:column;align-items:stretch}\n.q7-mk{width:74px;color:var(--mk);margin:0 0 10px 6px}\n.q7-mk svg{display:block;width:100%}\n.q7-box{position:relative;padding:18px 26px 20px}\n.q7-bg{position:absolute;inset:0;background:rgba(0,0,0,.35)}\n.q7-f-none .q7-bg{display:none}\n.q7-b{position:absolute;background:var(--accent)}\n.q7-bt{left:0;right:0;top:0;height:4px}\n.q7-bb{left:0;right:0;bottom:0;height:4px}\n.q7-bl{left:0;top:0;bottom:0;width:4px}\n.q7-br{right:0;top:0;bottom:0;width:4px}\n.q7-t{position:relative;font:700 39px/1.2 Montserrat,Arial,sans-serif;color:var(--t);white-space:normal}\n.q7-t .w{display:inline-block}\n.q7-a{margin-top:14px;text-align:center;font:800 39px/1 Montserrat,Arial,sans-serif;color:var(--at);white-space:nowrap;text-shadow:0 2px 4px rgba(0,0,0,.35)}\n.q7-a .w{display:inline-block}\n",
    "animation": {
      "in": [
        {
          "sel": ".q7-br",
          "from": {
            "scaleY": 0,
            "transformOrigin": "50% 0%"
          },
          "to": {
            "scaleY": 1
          },
          "at": 0,
          "d": 0.35,
          "e": "power2.inOut"
        },
        {
          "sel": ".q7-bb",
          "from": {
            "scaleX": 0,
            "transformOrigin": "100% 50%"
          },
          "to": {
            "scaleX": 1
          },
          "at": 0.25,
          "d": 0.4,
          "e": "power2.inOut"
        },
        {
          "sel": ".q7-bl",
          "from": {
            "scaleY": 0,
            "transformOrigin": "50% 100%"
          },
          "to": {
            "scaleY": 1
          },
          "at": 0.55,
          "d": 0.3,
          "e": "power2.inOut"
        },
        {
          "sel": ".q7-bt",
          "from": {
            "scaleX": 0,
            "transformOrigin": "0% 50%"
          },
          "to": {
            "scaleX": 1
          },
          "at": 0.75,
          "d": 0.4,
          "e": "power2.inOut"
        },
        [
          ".q7-bg",
          "fade",
          0.3,
          {
            "d": 0.5
          }
        ],
        [
          ".q7-mk",
          "down",
          0.6,
          {
            "d": 0.45
          }
        ],
        {
          "sel": ".q7-t .w",
          "from": {
            "opacity": 0
          },
          "to": {
            "opacity": 1
          },
          "at": 0.55,
          "d": 0.2,
          "e": "none",
          "s": 0.06,
          "sa": 0.9
        },
        {
          "sel": ".q7-a .w",
          "from": {
            "opacity": 0,
            "y": 10
          },
          "to": {
            "opacity": 1,
            "y": 0
          },
          "at": 1.2,
          "d": 0.4,
          "e": "power2.out",
          "s": 0.15
        }
      ],
      "out": [
        {
          "sel": ".q7-a",
          "to": {
            "opacity": 0
          },
          "at": 0,
          "d": 0.2
        },
        {
          "sel": ".q7-t .w",
          "to": {
            "opacity": 0
          },
          "at": 0,
          "d": 0.15,
          "s": 0.02,
          "sa": 0.3,
          "fromEnd": true
        },
        {
          "sel": ".q7-mk",
          "to": {
            "y": -20,
            "opacity": 0
          },
          "at": 0.1,
          "d": 0.25,
          "e": "power2.in"
        },
        {
          "sel": ".q7-bg",
          "to": {
            "opacity": 0
          },
          "at": 0.25,
          "d": 0.3
        },
        {
          "sel": ".q7-bt, .q7-bb",
          "to": {
            "scaleX": 0
          },
          "at": 0.3,
          "d": 0.35,
          "e": "power2.in"
        },
        {
          "sel": ".q7-bl, .q7-br",
          "to": {
            "scaleY": 0
          },
          "at": 0.4,
          "d": 0.3,
          "e": "power2.in"
        }
      ]
    }
  },
  {
    "format": "mce-graphic@1",
    "version": 2,
    "category": "quotes",
    "hold": 0,
    "placement": {
      "x": 120,
      "y": 90,
      "scale": 1
    },
    "id": "quote-title-pill",
    "name": "Quote · Title Pill",
    "color": "#0f9d58",
    "description": "Short title inside a rounded outline with quote marks on either side and a small subtitle under the box. The outline grows from the centre, the marks fly in from the sides and the title spreads out",
    "fields": [
      {
        "key": "title",
        "label": "Title",
        "type": "text",
        "default": "YOUR TITLE HERE"
      },
      {
        "key": "sub",
        "label": "Subtitle (optional)",
        "type": "text",
        "default": "SUBTITLE"
      },
      {
        "key": "accent",
        "label": "Outline colour",
        "type": "color",
        "default": "#0f9d58"
      },
      {
        "key": "t",
        "label": "Title colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "mk",
        "label": "Quote marks colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "st",
        "label": "Subtitle colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "layout",
        "label": "Layout",
        "type": "select",
        "default": "full",
        "options": [
          {
            "value": "full",
            "label": "Full screen (centred)"
          },
          {
            "value": "lower",
            "label": "Lower third"
          }
        ]
      },
      {
        "key": "fit",
        "label": "Size (full screen)",
        "type": "select",
        "default": "0.76",
        "options": [
          {
            "value": "0.6",
            "label": "Medium"
          },
          {
            "value": "0.76",
            "label": "Large"
          },
          {
            "value": "0.9",
            "label": "Extra large"
          }
        ]
      }
    ],
    "html": "\n<div class=\"q8\" data-pkg-layout=\"{{layout}}\" data-pkg-fit=\"{{fit}}\">\n  <div class=\"q8-row\">\n    <div class=\"q8-o\"><svg viewBox=\"0 0 100 80\" fill=\"currentColor\" class=\"mk-flip\"><path d=\"M6 0h38v38c0 22-12 38-34 42l-4-12c11-4 16-12 16-22H6z\"/><path d=\"M56 0h38v38c0 22-12 38-34 42l-4-12c11-4 16-12 16-22H56z\"/></svg></div>\n    <div class=\"q8-pill\"><span>{{title|chars}}</span></div>\n    <div class=\"q8-c\"><svg viewBox=\"0 0 100 80\" fill=\"currentColor\"><path d=\"M6 0h38v38c0 22-12 38-34 42l-4-12c11-4 16-12 16-22H6z\"/><path d=\"M56 0h38v38c0 22-12 38-34 42l-4-12c11-4 16-12 16-22H56z\"/></svg></div>\n  </div>\n  {{#sub}}<div class=\"q8-sub\">{{sub}}</div>{{/sub}}\n</div>",
    "css": "\n.q8{position:relative;width:max-content;display:flex;flex-direction:column;align-items:center}\n.q8-row{position:relative;display:flex;align-items:center;gap:12px}\n.q8-o,.q8-c{width:56px;color:var(--mk)}\n.q8-o{align-self:flex-start;margin-top:-14px}\n.q8-c{align-self:flex-end;margin-bottom:-16px}\n.q8-o svg,.q8-c svg{display:block;width:100%}\n.q8-pill{padding:16px 40px 15px;border:3px solid var(--accent);border-radius:10px;background:rgba(0,0,0,.25)}\n.q8-pill span{display:block;font:800 41px/1 Montserrat,Arial,sans-serif;color:var(--t);text-transform:uppercase;white-space:nowrap}\n.q8-pill .w,.q8-pill .ch{display:inline-block}\n.q8-sub{margin-top:10px;font:600 22px/1 Montserrat,Arial,sans-serif;color:var(--st);letter-spacing:.14em;text-transform:uppercase;white-space:nowrap;opacity:.9}\n.mk-flip{transform:scale(-1,-1)}\n",
    "animation": {
      "in": [
        {
          "sel": ".q8-pill",
          "from": {
            "scaleX": 0,
            "opacity": 0,
            "transformOrigin": "50% 50%"
          },
          "to": {
            "scaleX": 1,
            "opacity": 1
          },
          "at": 0,
          "d": 0.55,
          "e": "expo.out"
        },
        {
          "sel": ".q8-o",
          "from": {
            "x": 80,
            "opacity": 0
          },
          "to": {
            "x": 0,
            "opacity": 1
          },
          "at": 0.2,
          "d": 0.5,
          "e": "back.out(1.6)"
        },
        {
          "sel": ".q8-c",
          "from": {
            "x": -80,
            "opacity": 0
          },
          "to": {
            "x": 0,
            "opacity": 1
          },
          "at": 0.2,
          "d": 0.5,
          "e": "back.out(1.6)"
        },
        {
          "sel": ".q8-pill .ch",
          "from": {
            "opacity": 0,
            "scale": 0.3
          },
          "to": {
            "opacity": 1,
            "scale": 1
          },
          "at": 0.35,
          "d": 0.4,
          "e": "back.out(2)",
          "s": 0.03,
          "sa": 0.5
        },
        [
          ".q8-sub",
          "up",
          0.7,
          {
            "d": 0.45
          }
        ]
      ],
      "out": [
        {
          "sel": ".q8-sub",
          "to": {
            "opacity": 0,
            "y": 10
          },
          "at": 0,
          "d": 0.2
        },
        {
          "sel": ".q8-pill .ch",
          "to": {
            "opacity": 0,
            "scale": 0.3
          },
          "at": 0,
          "d": 0.25,
          "e": "power2.in",
          "s": 0.015,
          "sa": 0.25,
          "fromEnd": true
        },
        {
          "sel": ".q8-o",
          "to": {
            "x": 80,
            "opacity": 0
          },
          "at": 0.2,
          "d": 0.3,
          "e": "power2.in"
        },
        {
          "sel": ".q8-c",
          "to": {
            "x": -80,
            "opacity": 0
          },
          "at": 0.2,
          "d": 0.3,
          "e": "power2.in"
        },
        {
          "sel": ".q8-pill",
          "to": {
            "scaleX": 0,
            "opacity": 0
          },
          "at": 0.3,
          "d": 0.4,
          "e": "expo.in"
        }
      ]
    }
  },
  {
    "format": "mce-graphic@1",
    "version": 1,
    "id": "giving-accounts-board",
    "name": "Giving Accounts Board",
    "category": "giving",
    "color": "#6e1116",
    "hold": 0,
    "description": "Fullscreen board for bank transfer giving: a gold title plaque, up to six banks in two columns with logo, bank name and account number, and the account name on a white panel at the bottom. The plaque opens from the centre, accounts drop in one by one and the bottom panel rises",
    "placement": {
      "x": 0,
      "y": 0,
      "scale": 1
    },
    "fields": [
      {
        "key": "title",
        "label": "Title",
        "type": "text",
        "default": "WAYS TO GIVE"
      },
      {
        "key": "bank1",
        "label": "Account 1 – bank name (left column; leave empty to hide)",
        "type": "text",
        "default": "BANK NAME"
      },
      {
        "key": "num1",
        "label": "Account 1 – account number",
        "type": "text",
        "default": "000 000 0000"
      },
      {
        "key": "logo1",
        "label": "Account 1 – bank logo (optional)",
        "type": "image",
        "default": ""
      },
      {
        "key": "bank2",
        "label": "Account 2 – bank name (right column; leave empty to hide)",
        "type": "text",
        "default": "BANK NAME"
      },
      {
        "key": "num2",
        "label": "Account 2 – account number",
        "type": "text",
        "default": "000 000 0000"
      },
      {
        "key": "logo2",
        "label": "Account 2 – bank logo (optional)",
        "type": "image",
        "default": ""
      },
      {
        "key": "bank3",
        "label": "Account 3 – bank name (left column; leave empty to hide)",
        "type": "text",
        "default": "BANK NAME"
      },
      {
        "key": "num3",
        "label": "Account 3 – account number",
        "type": "text",
        "default": "000 000 0000"
      },
      {
        "key": "logo3",
        "label": "Account 3 – bank logo (optional)",
        "type": "image",
        "default": ""
      },
      {
        "key": "bank4",
        "label": "Account 4 – bank name (right column; leave empty to hide)",
        "type": "text",
        "default": "BANK NAME"
      },
      {
        "key": "num4",
        "label": "Account 4 – account number",
        "type": "text",
        "default": "000 000 0000"
      },
      {
        "key": "logo4",
        "label": "Account 4 – bank logo (optional)",
        "type": "image",
        "default": ""
      },
      {
        "key": "bank5",
        "label": "Account 5 – bank name (left column; leave empty to hide)",
        "type": "text",
        "default": "BANK NAME"
      },
      {
        "key": "num5",
        "label": "Account 5 – account number",
        "type": "text",
        "default": "000 000 0000"
      },
      {
        "key": "logo5",
        "label": "Account 5 – bank logo (optional)",
        "type": "image",
        "default": ""
      },
      {
        "key": "bank6",
        "label": "Account 6 – bank name (right column; leave empty to hide)",
        "type": "text",
        "default": "BANK NAME"
      },
      {
        "key": "num6",
        "label": "Account 6 – account number",
        "type": "text",
        "default": "000 000 0000"
      },
      {
        "key": "logo6",
        "label": "Account 6 – bank logo (optional)",
        "type": "image",
        "default": ""
      },
      {
        "key": "footer",
        "label": "Bottom line (leave empty to hide)",
        "type": "text",
        "default": "ACCOUNT NAME: YOUR CHURCH NAME"
      },
      {
        "key": "logo",
        "label": "Church logo, top-left (optional)",
        "type": "image",
        "default": ""
      },
      {
        "key": "bg",
        "label": "Background colour",
        "type": "color",
        "default": "#6e1116",
        "shades": true
      },
      {
        "key": "plaque",
        "label": "Title plaque colour",
        "type": "color",
        "default": "#f2dc9b",
        "shades": true
      },
      {
        "key": "plaquet",
        "label": "Title colour",
        "type": "color",
        "default": "#5b0c10"
      },
      {
        "key": "t",
        "label": "Bank name colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "nt",
        "label": "Account number colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "tile",
        "label": "Logo tile colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "ic",
        "label": "Logo placeholder icon colour",
        "type": "color",
        "default": "#6e1116"
      },
      {
        "key": "foot",
        "label": "Bottom panel colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "foott",
        "label": "Bottom text colour",
        "type": "color",
        "default": "#4a0b0e"
      }
    ],
    "html": "\n<div class=\"gb\">\n  <div class=\"gb-bg pkg-fullscreen\"><i class=\"gb-glow\"></i></div>\n  {{#logo}}<div class=\"gb-church\">{{image:logo}}</div>{{/logo}}\n  <div class=\"gb-plaque\"><i class=\"gb-shine\"></i><i class=\"gb-dot\"></i><span class=\"gb-title\">{{title|chars}}</span><i class=\"gb-dot\"></i></div>\n  <div class=\"gb-grid\">\n    {{#bank1}}<div class=\"gb-e\"><div class=\"gb-h\"><span class=\"gb-logo\">{{icon=bank}}{{image:logo1}}</span><span class=\"gb-name\">{{bank1}}</span></div><div class=\"gb-nr\"><div class=\"gb-num\">{{num1}}</div></div></div>{{/bank1}}\n    {{#bank2}}<div class=\"gb-e\"><div class=\"gb-h\"><span class=\"gb-logo\">{{icon=bank}}{{image:logo2}}</span><span class=\"gb-name\">{{bank2}}</span></div><div class=\"gb-nr\"><div class=\"gb-num\">{{num2}}</div></div></div>{{/bank2}}\n    {{#bank3}}<div class=\"gb-e\"><div class=\"gb-h\"><span class=\"gb-logo\">{{icon=bank}}{{image:logo3}}</span><span class=\"gb-name\">{{bank3}}</span></div><div class=\"gb-nr\"><div class=\"gb-num\">{{num3}}</div></div></div>{{/bank3}}\n    {{#bank4}}<div class=\"gb-e\"><div class=\"gb-h\"><span class=\"gb-logo\">{{icon=bank}}{{image:logo4}}</span><span class=\"gb-name\">{{bank4}}</span></div><div class=\"gb-nr\"><div class=\"gb-num\">{{num4}}</div></div></div>{{/bank4}}\n    {{#bank5}}<div class=\"gb-e\"><div class=\"gb-h\"><span class=\"gb-logo\">{{icon=bank}}{{image:logo5}}</span><span class=\"gb-name\">{{bank5}}</span></div><div class=\"gb-nr\"><div class=\"gb-num\">{{num5}}</div></div></div>{{/bank5}}\n    {{#bank6}}<div class=\"gb-e\"><div class=\"gb-h\"><span class=\"gb-logo\">{{icon=bank}}{{image:logo6}}</span><span class=\"gb-name\">{{bank6}}</span></div><div class=\"gb-nr\"><div class=\"gb-num\">{{num6}}</div></div></div>{{/bank6}}\n    <i class=\"gb-div\"></i>\n  </div>\n  {{#footer}}<div class=\"gb-foot\"><span>{{footer}}</span></div>{{/footer}}\n</div>",
    "css": "\n.gb{position:relative;width:1920px;height:1080px;display:flex;flex-direction:column;align-items:center}\n.gb-bg{position:absolute;inset:0;overflow:hidden;background:radial-gradient(ellipse 70% 60% at 50% 18%,var(--bg-l) 0%,var(--bg) 45%,var(--bg-d) 100%)}\n.gb-glow{position:absolute;left:-20%;top:-30%;width:70%;height:90%;background:radial-gradient(closest-side,rgba(255,180,140,.16),rgba(255,180,140,0));transform:translateX(0)}\n.gb-church{position:absolute;left:56px;top:46px;width:200px;height:120px;display:flex;align-items:flex-start}\n.gb-church .pkg-img{max-height:120px;max-width:200px}\n.gb-plaque{position:relative;overflow:hidden;margin-top:58px;display:flex;align-items:center;gap:34px;padding:18px 54px 16px;background:linear-gradient(180deg,var(--plaque-l) 0%,var(--plaque) 45%,var(--plaque-d) 140%);clip-path:polygon(16px 0,calc(100% - 16px) 0,100% 16px,100% calc(100% - 16px),calc(100% - 16px) 100%,16px 100%,0 calc(100% - 16px),0 16px);box-shadow:0 10px 30px rgba(0,0,0,.35)}\n.gb-shine{position:absolute;top:0;bottom:0;left:0;width:14%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.55),transparent);transform:translateX(-150%)}\n.gb-dot{position:relative;display:block;width:14px;height:14px;border-radius:50%;background:var(--plaquet)}\n.gb-title{position:relative;font:700 92px/1 Tinos,'Times New Roman',serif;color:var(--plaquet);letter-spacing:.01em;text-transform:uppercase;white-space:nowrap}\n.gb-title .w,.gb-title .ch{display:inline-block}\n.gb-grid{position:relative;flex:1;width:1560px;display:grid;grid-template-columns:1fr 1fr;align-content:center;row-gap:46px;padding:20px 0 30px}\n.gb-div{position:absolute;left:50%;top:56px;bottom:62px;width:3px;margin-left:-1.5px;background:linear-gradient(180deg,rgba(255,255,255,0),rgba(255,255,255,.75) 12%,rgba(255,255,255,.75) 88%,rgba(255,255,255,0))}\n.gb-e{display:flex;flex-direction:column;align-items:center}\n.gb-e:only-of-type{grid-column:1/-1;align-self:center}\n.gb-e:only-of-type~.gb-div{display:none}\n.gb-h{display:flex;align-items:center;gap:20px}\n.gb-logo{position:relative;flex:none;width:76px;height:76px;border-radius:10px;overflow:hidden;background:var(--tile);color:var(--ic);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,.3)}\n.gb-logo .ic{width:46px;height:46px}\n.gb-logo .pkg-img{position:absolute;inset:0;width:100%;height:100%;max-width:none;max-height:none;object-fit:cover;background:var(--tile)}\n.gb-name{font:700 50px/1 Montserrat,Arial,sans-serif;color:var(--t);text-transform:uppercase;white-space:nowrap}\n.gb-nr{overflow:hidden;margin-top:14px;padding:0 8px}\n.gb-num{font:900 92px/1.05 Montserrat,Arial,sans-serif;color:var(--nt);letter-spacing:.01em;white-space:nowrap;text-shadow:0 4px 14px rgba(0,0,0,.35)}\n.gb-foot{position:relative;width:1560px;padding:30px 40px 34px;background:var(--foot);border-radius:46px 46px 0 0;text-align:center;box-shadow:0 -8px 30px rgba(0,0,0,.25)}\n.gb-foot span{display:block;font:800 42px/1 Montserrat,Arial,sans-serif;color:var(--foott);text-transform:uppercase;white-space:nowrap}\n",
    "animation": {
      "in": [
        [
          ".gb-bg",
          "fade",
          0,
          {
            "d": 0.6
          }
        ],
        [
          ".gb-church",
          "fade",
          0.3,
          {
            "d": 0.6
          }
        ],
        {
          "sel": ".gb-plaque",
          "from": {
            "scaleX": 0,
            "opacity": 0,
            "transformOrigin": "50% 50%"
          },
          "to": {
            "scaleX": 1,
            "opacity": 1
          },
          "at": 0.15,
          "d": 0.6,
          "e": "expo.out"
        },
        [
          ".gb-dot",
          "pop",
          0.45,
          {
            "d": 0.4
          }
        ],
        {
          "sel": ".gb-title .ch",
          "from": {
            "opacity": 0,
            "y": 18
          },
          "to": {
            "opacity": 1,
            "y": 0
          },
          "at": 0.35,
          "d": 0.45,
          "e": "power3.out",
          "s": 0.03,
          "sa": 0.45
        },
        {
          "sel": ".gb-div",
          "from": {
            "scaleY": 0,
            "transformOrigin": "50% 0%"
          },
          "to": {
            "scaleY": 1
          },
          "at": 0.5,
          "d": 0.8,
          "e": "power3.inOut"
        },
        {
          "sel": ".gb-logo",
          "from": {
            "scale": 0,
            "opacity": 0,
            "transformOrigin": "50% 50%"
          },
          "to": {
            "scale": 1,
            "opacity": 1
          },
          "at": 0.6,
          "d": 0.45,
          "e": "back.out(2)",
          "s": 0.1
        },
        {
          "sel": ".gb-name",
          "from": {
            "x": -24,
            "opacity": 0
          },
          "to": {
            "x": 0,
            "opacity": 1
          },
          "at": 0.65,
          "d": 0.45,
          "e": "power3.out",
          "s": 0.1
        },
        {
          "sel": ".gb-num",
          "from": {
            "yPercent": 105
          },
          "to": {
            "yPercent": 0
          },
          "at": 0.75,
          "d": 0.55,
          "e": "expo.out",
          "s": 0.1
        },
        {
          "sel": ".gb-foot",
          "from": {
            "yPercent": 110
          },
          "to": {
            "yPercent": 0
          },
          "at": 1.0,
          "d": 0.6,
          "e": "expo.out"
        },
        [
          ".gb-foot span",
          "fade",
          1.25,
          {
            "d": 0.4
          }
        ]
      ],
      "out": [
        {
          "sel": ".gb-foot",
          "to": {
            "yPercent": 110
          },
          "at": 0,
          "d": 0.4,
          "e": "power2.in"
        },
        {
          "sel": ".gb-num",
          "to": {
            "yPercent": -105
          },
          "at": 0,
          "d": 0.3,
          "e": "power2.in",
          "s": 0.05,
          "fromEnd": true
        },
        {
          "sel": ".gb-name, .gb-logo",
          "to": {
            "opacity": 0
          },
          "at": 0.1,
          "d": 0.25,
          "s": 0.03,
          "fromEnd": true
        },
        {
          "sel": ".gb-div",
          "to": {
            "scaleY": 0
          },
          "at": 0.2,
          "d": 0.4,
          "e": "power2.in"
        },
        {
          "sel": ".gb-title .ch, .gb-dot",
          "to": {
            "opacity": 0
          },
          "at": 0.2,
          "d": 0.2,
          "s": 0.01
        },
        {
          "sel": ".gb-plaque",
          "to": {
            "scaleX": 0,
            "opacity": 0
          },
          "at": 0.35,
          "d": 0.4,
          "e": "expo.in"
        },
        {
          "sel": ".gb-church",
          "to": {
            "opacity": 0
          },
          "at": 0.4,
          "d": 0.3
        },
        {
          "sel": ".gb-bg",
          "to": {
            "opacity": 0
          },
          "at": 0.6,
          "d": 0.45
        }
      ],
      "ambient": [
        {
          "sel": ".gb-shine",
          "from": {
            "xPercent": -150
          },
          "to": {
            "xPercent": 800
          },
          "d": 1.6,
          "e": "power2.inOut",
          "repeat": -1,
          "repeatDelay": 4
        },
        {
          "sel": ".gb-glow",
          "to": {
            "x": 700,
            "y": 160
          },
          "d": 9,
          "yoyo": true,
          "e": "sine.inOut"
        }
      ]
    }
  },
  {
    "format": "mce-graphic@1",
    "version": 1,
    "category": "quotes",
    "hold": 0,
    "placement": {
      "x": 120,
      "y": 760,
      "scale": 1
    },
    "id": "quote-highlight-card",
    "name": "Quote · Highlight Card",
    "color": "#1d4ed8",
    "description": "A clean quote card with inline colour highlights: wrap a word in *asterisks* to make it stand out, or *[#hex]word* to give it its own colour — same markup as the Scripture overlays. A speaker name sits below.",
    "fields": [
      {
        "key": "quote",
        "label": "Quote (wrap words in *asterisks*, or *[#hex]word* for a colour; Enter = new line)",
        "type": "text",
        "default": "This is the day *the Lord* has made; let us *rejoice* and be glad in it.",
        "multiline": true
      },
      {
        "key": "speaker",
        "label": "Speaker",
        "type": "text",
        "default": "Pastor Firstname Lastname"
      },
      {
        "key": "accent",
        "label": "Accent colour",
        "type": "color",
        "default": "#1d4ed8",
        "shades": true
      },
      {
        "key": "t",
        "label": "Quote colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "sp",
        "label": "Speaker colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "layout",
        "label": "Layout",
        "type": "select",
        "default": "lower",
        "options": [
          {
            "value": "full",
            "label": "Full screen (centred)"
          },
          {
            "value": "lower",
            "label": "Lower third"
          }
        ]
      },
      {
        "key": "fit",
        "label": "Size (full screen)",
        "type": "select",
        "default": "0.76",
        "options": [
          {
            "value": "0.6",
            "label": "Medium"
          },
          {
            "value": "0.76",
            "label": "Large"
          },
          {
            "value": "0.9",
            "label": "Extra large"
          }
        ]
      }
    ],
    "html": "\n<div class=\"qh\" data-pkg-layout=\"{{layout}}\" data-pkg-fit=\"{{fit}}\">\n  <i class=\"qh-bar\"></i>\n  <div class=\"qh-body\">\n    <div class=\"qh-mk\">&ldquo;</div>\n    <p class=\"qh-t\">{{quote|rich}}</p>\n    {{#speaker}}<div class=\"qh-sp\">{{speaker}}</div>{{/speaker}}\n  </div>\n</div>",
    "css": "\n.qh{position:relative;display:flex;align-items:stretch;width:max-content;max-width:1200px;background:rgba(10,12,18,.72);border-radius:4px;overflow:hidden;box-shadow:0 16px 36px rgba(0,0,0,.4)}\n.qh-bar{flex:none;width:10px;background:linear-gradient(180deg,var(--accent-l,var(--accent)),var(--accent))}\n.qh-body{position:relative;padding:26px 36px 24px}\n.qh-mk{font:900 54px/.6 Montserrat,Arial,sans-serif;color:var(--accent);margin-bottom:10px}\n.qh-t{font:600 38px/1.32 Montserrat,Arial,sans-serif;color:var(--t);white-space:normal;max-width:1000px}\n.qh-t .hl{color:var(--accent);font-weight:800}\n.qh-sp{margin-top:14px;font:800 26px/1 Montserrat,Arial,sans-serif;color:var(--sp);text-transform:uppercase;letter-spacing:.04em}\n",
    "animation": {
      "in": [
        [
          ".qh-bar",
          "slideUp",
          0,
          { "d": 0.4 }
        ],
        [
          ".qh-mk",
          "down",
          0.1,
          { "d": 0.4 }
        ],
        [
          ".qh-t",
          "up",
          0.2,
          { "d": 0.55 }
        ],
        [
          ".qh-sp",
          "up",
          0.4,
          { "d": 0.45 }
        ]
      ],
      "out": [
        {
          "sel": ".qh-sp",
          "to": { "y": -12, "opacity": 0 },
          "at": 0,
          "d": 0.25,
          "e": "power2.in"
        },
        {
          "sel": ".qh-t",
          "to": { "y": -12, "opacity": 0 },
          "at": 0.08,
          "d": 0.28,
          "e": "power2.in"
        },
        {
          "sel": ".qh-mk",
          "to": { "opacity": 0 },
          "at": 0.2,
          "d": 0.25
        },
        {
          "sel": ".qh-bar",
          "to": { "scaleY": 0 },
          "at": 0.3,
          "d": 0.3,
          "e": "power2.in"
        }
      ]
    }
  },
  {
    "format": "mce-graphic@1",
    "id": "sermon-portrait-card",
    "version": 1,
    "name": "Sermon Quote · Portrait Card",
    "category": "quotes",
    "description": "Full-screen sermon quote: a warm card with the speaker's round photo on top, the quote with *emphasised* words in the highlight colour, and the name below.",
    "color": "#3b2a24",
    "hold": 0,
    "placement": {
      "x": 0,
      "y": 0,
      "scale": 1
    },
    "fields": [
      {
        "key": "quote",
        "label": "Quote (wrap words in *asterisks* to make them stand out; Enter = new line)",
        "type": "text",
        "default": "Your *tomorrow* is not cancelled. The God who started this good work will *finish what He began* in you.",
        "multiline": true
      },
      {
        "key": "ref",
        "label": "Scripture reference (optional)",
        "type": "text",
        "default": "(Phil. 1:6)"
      },
      {
        "key": "name",
        "label": "Speaker",
        "type": "text",
        "default": "Pastor Firstname Lastname"
      },
      {
        "key": "photo",
        "label": "Speaker photo (optional)",
        "type": "image",
        "default": ""
      },
      {
        "key": "size",
        "label": "Text size",
        "type": "select",
        "default": "m",
        "options": [
          {
            "value": "s",
            "label": "Small"
          },
          {
            "value": "m",
            "label": "Medium"
          },
          {
            "value": "l",
            "label": "Large"
          },
          {
            "value": "xl",
            "label": "Extra large"
          }
        ]
      },
      {
        "key": "bg",
        "label": "Card colour",
        "type": "color",
        "default": "#3b2a24"
      },
      {
        "key": "hl",
        "label": "Highlight colour (*words*)",
        "type": "color",
        "default": "#f4a52a"
      }
    ],
    "animation": {
      "in": [
        [
          ".sq-card",
          "fade",
          0,
          {
            "d": 0.5
          }
        ],
        [
          ".sq-photo",
          "pop",
          0.2,
          {
            "d": 0.5
          }
        ],
        [
          ".sq-mark",
          "up",
          0.3,
          {
            "d": 0.5
          }
        ],
        [
          ".sq-quote",
          "up",
          0.4,
          {
            "d": 0.7
          }
        ],
        [
          ".sq-name",
          "up",
          0.6,
          {
            "d": 0.6
          }
        ]
      ]
    },
    "css": ".sq{position:relative;width:1920px;height:1080px;overflow:hidden;font-family:Montserrat,'Segoe UI',Arial,sans-serif}\n.sq .hl{color:var(--hl);font-weight:800}\n.sq .sq-ref{color:var(--hl);font-weight:800}\n.sq p{margin:0}\n.sq .pkg-img{display:block;width:100%;height:100%;object-fit:cover}\n\n.sq-a{background:#f6f4f1}\n.sq-a::before{content:\"\";position:absolute;inset:0;opacity:.55;background-image:radial-gradient(circle at 30% 30%,transparent 38px,#e7e2dc 39px,#e7e2dc 46px,transparent 47px);background-size:150px 150px}\n.sq-a .sq-card{position:absolute;left:220px;right:220px;top:140px;bottom:70px;background:var(--bg);border-radius:56px;box-shadow:0 30px 70px rgba(30,20,10,.28);padding:60px 130px;display:flex;flex-direction:column;justify-content:center;gap:22px}\n.sq-a.has-photo .sq-card{top:230px;padding-top:160px}\n.sq-a .sq-mark{font:900 180px/.55 Montserrat,Arial,sans-serif;color:#fff;height:80px}\n.sq-a .sq-photo{position:absolute;left:50%;top:70px;width:330px;height:330px;margin-left:-165px;border-radius:50%;border:16px solid #fff;overflow:hidden;background:var(--hl);box-shadow:0 18px 40px rgba(0,0,0,.25);z-index:2}\n.sq-a .sq-quote{color:#fff;font-weight:600;line-height:1.35;text-align:left;text-wrap:pretty;font-size:54px}\n.sq-sz-s.sq-a .sq-quote{font-size:44px}.sq-sz-l.sq-a .sq-quote{font-size:62px}.sq-sz-xl.sq-a .sq-quote{font-size:72px}\n.sq-a .sq-ref{display:block;font-size:.8em;margin-top:18px}\n.sq-a .sq-name{color:#fff;font:800 50px Montserrat,Arial,sans-serif;text-align:center;letter-spacing:.01em}\n",
    "html": "<div class=\"sq sq-a sq-sz-{{size}} pkg-fullscreen {{#photo}}has-photo{{/photo}}\">\n  <div class=\"sq-card\"><div class=\"sq-mark\">&ldquo;</div>\n    <p class=\"sq-quote\">{{quote|rich}}{{#ref}}<span class=\"sq-ref\">{{ref}}</span>{{/ref}}</p>\n    {{#name}}<div class=\"sq-name\">~{{name}}~</div>{{/name}}</div>\n  {{#photo}}<div class=\"sq-photo\">{{image:photo}}</div>{{/photo}}\n</div>"
  },
  {
    "format": "mce-graphic@1",
    "id": "sermon-clean-panel",
    "version": 1,
    "name": "Sermon Quote · Clean Panel",
    "category": "quotes",
    "description": "Full-screen sermon quote on a white panel over a colour field, with an optional round photo and social handle. *Asterisk* words use the highlight colour.",
    "color": "#0f2470",
    "hold": 0,
    "placement": {
      "x": 0,
      "y": 0,
      "scale": 1
    },
    "fields": [
      {
        "key": "quote",
        "label": "Quote (wrap words in *asterisks* to make them stand out; Enter = new line)",
        "type": "text",
        "default": "Your *tomorrow* is not cancelled. The God who started this good work will *finish what He began* in you.",
        "multiline": true
      },
      {
        "key": "ref",
        "label": "Scripture reference (optional)",
        "type": "text",
        "default": "(Phil. 1:6)"
      },
      {
        "key": "name",
        "label": "Speaker",
        "type": "text",
        "default": "Pastor Firstname Lastname"
      },
      {
        "key": "handle",
        "label": "Social handle (optional)",
        "type": "text",
        "default": "@yourchurchmedia"
      },
      {
        "key": "photo",
        "label": "Speaker photo (optional)",
        "type": "image",
        "default": ""
      },
      {
        "key": "size",
        "label": "Text size",
        "type": "select",
        "default": "m",
        "options": [
          {
            "value": "s",
            "label": "Small"
          },
          {
            "value": "m",
            "label": "Medium"
          },
          {
            "value": "l",
            "label": "Large"
          },
          {
            "value": "xl",
            "label": "Extra large"
          }
        ]
      },
      {
        "key": "bg",
        "label": "Background colour",
        "type": "color",
        "default": "#0f2470",
        "shades": true
      },
      {
        "key": "hl",
        "label": "Highlight colour (*words*)",
        "type": "color",
        "default": "#e0362c"
      }
    ],
    "animation": {
      "in": [
        [
          ".sq-panel",
          "fade",
          0,
          {
            "d": 0.5
          }
        ],
        [
          ".sq-photo",
          "pop",
          0.2,
          {
            "d": 0.5
          }
        ],
        [
          ".sq-quote",
          "up",
          0.3,
          {
            "d": 0.7
          }
        ],
        [
          ".sq-name",
          "up",
          0.5,
          {
            "d": 0.6
          }
        ],
        [
          ".sq-foot",
          "up",
          0.7,
          {
            "d": 0.6
          }
        ]
      ]
    },
    "css": ".sq{position:relative;width:1920px;height:1080px;overflow:hidden;font-family:Montserrat,'Segoe UI',Arial,sans-serif}\n.sq .hl{color:var(--hl);font-weight:800}\n.sq .sq-ref{color:var(--hl);font-weight:800}\n.sq p{margin:0}\n.sq .pkg-img{display:block;width:100%;height:100%;object-fit:cover}\n\n.sq-b{background:radial-gradient(120% 90% at 50% 0%,var(--bg-l) 0%,var(--bg) 70%)}\n.sq-b .sq-panel{position:absolute;left:330px;right:330px;top:150px;bottom:240px;background:#fff;border-radius:48px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:70px 110px;gap:46px;box-shadow:0 30px 80px rgba(0,0,30,.35)}\n.sq-b .sq-quote{color:var(--bg);font:700 70px/1.22 Montserrat,Arial,sans-serif;text-align:center;text-wrap:balance}\n.sq-sz-s.sq-b .sq-quote{font-size:56px}.sq-sz-m.sq-b .sq-quote{font-size:64px}.sq-sz-xl.sq-b .sq-quote{font-size:82px}\n.sq-b .sq-ref{display:block;font-size:.72em;margin-top:16px}\n.sq-b .sq-name{display:flex;align-items:center;gap:30px;color:#1b1b1f;font:700 48px Montserrat,Arial,sans-serif}\n.sq-b .sq-name::before,.sq-b .sq-name::after{content:\"\";border:18px solid transparent}\n.sq-b .sq-name::before{border-right:26px solid #1b1b1f;border-left:0}\n.sq-b .sq-name::after{border-left:26px solid #1b1b1f;border-right:0}\n.sq-b .sq-photo{position:absolute;left:180px;top:120px;width:200px;height:200px;border-radius:50%;border:10px solid #fff;overflow:hidden;background:var(--hl);z-index:2}\n.sq-b .sq-foot{position:absolute;left:0;right:0;bottom:120px;text-align:center;color:var(--hl);font:700 40px Montserrat,Arial,sans-serif;letter-spacing:.02em}\n",
    "html": "<div class=\"sq sq-b sq-sz-{{size}} pkg-fullscreen\">\n  {{#photo}}<div class=\"sq-photo\">{{image:photo}}</div>{{/photo}}\n  <div class=\"sq-panel\"><p class=\"sq-quote\">{{quote|rich}}{{#ref}}<span class=\"sq-ref\">{{ref}}</span>{{/ref}}</p>\n    {{#name}}<div class=\"sq-name\">{{name}}</div>{{/name}}</div>\n  {{#handle}}<div class=\"sq-foot\">{{handle}}</div>{{/handle}}\n</div>"
  },
  {
    "format": "mce-graphic@1",
    "id": "sermon-scripture-highlight",
    "version": 1,
    "name": "Sermon Quote · Scripture Highlight",
    "category": "quotes",
    "description": "Full-screen sermon quote in a black box with a white frame, a name plate underneath and an optional round photo. *Asterisk* words use the highlight colour.",
    "color": "#b3221d",
    "hold": 0,
    "placement": {
      "x": 0,
      "y": 0,
      "scale": 1
    },
    "fields": [
      {
        "key": "quote",
        "label": "Quote (wrap words in *asterisks* to make them stand out; Enter = new line)",
        "type": "text",
        "default": "Your *tomorrow* is not cancelled. The God who started this good work will *finish what He began* in you.",
        "multiline": true
      },
      {
        "key": "ref",
        "label": "Scripture reference (optional)",
        "type": "text",
        "default": "(Phil. 1:6)"
      },
      {
        "key": "name",
        "label": "Speaker (name plate)",
        "type": "text",
        "default": "Pastor Firstname Lastname"
      },
      {
        "key": "photo",
        "label": "Speaker photo (optional)",
        "type": "image",
        "default": ""
      },
      {
        "key": "size",
        "label": "Text size",
        "type": "select",
        "default": "m",
        "options": [
          {
            "value": "s",
            "label": "Small"
          },
          {
            "value": "m",
            "label": "Medium"
          },
          {
            "value": "l",
            "label": "Large"
          },
          {
            "value": "xl",
            "label": "Extra large"
          }
        ]
      },
      {
        "key": "bg",
        "label": "Background colour",
        "type": "color",
        "default": "#b3221d"
      },
      {
        "key": "hl",
        "label": "Highlight colour (*words*)",
        "type": "color",
        "default": "#3ee0e6"
      }
    ],
    "animation": {
      "in": [
        [
          ".sq-box",
          "fade",
          0,
          {
            "d": 0.5
          }
        ],
        [
          ".sq-quote",
          "up",
          0.3,
          {
            "d": 0.7
          }
        ],
        [
          ".sq-plate",
          "up",
          0.5,
          {
            "d": 0.6
          }
        ],
        [
          ".sq-photo",
          "pop",
          0.6,
          {
            "d": 0.5
          }
        ]
      ]
    },
    "css": ".sq{position:relative;width:1920px;height:1080px;overflow:hidden;font-family:Montserrat,'Segoe UI',Arial,sans-serif}\n.sq .hl{color:var(--hl);font-weight:800}\n.sq .sq-ref{color:var(--hl);font-weight:800}\n.sq p{margin:0}\n.sq .pkg-img{display:block;width:100%;height:100%;object-fit:cover}\n\n.sq-c{background:var(--bg)}\n.sq-c::before{content:\"\";position:absolute;inset:0;background:radial-gradient(60% 70% at 85% 20%,rgba(255,255,255,.12),transparent 60%),repeating-linear-gradient(115deg,rgba(0,0,0,.08) 0 3px,transparent 3px 14px)}\n.sq-c .sq-box{position:absolute;left:240px;right:240px;top:110px;bottom:230px;background:rgba(10,10,12,.92);border:10px solid #f3f3f3;border-radius:60px;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:60px 120px;box-shadow:0 30px 60px rgba(0,0,0,.4)}\n.sq-c .sq-quote{color:#fff;font:600 66px/1.32 Montserrat,Arial,sans-serif;text-align:center;text-wrap:balance}\n.sq-sz-s.sq-c .sq-quote{font-size:52px}.sq-sz-m.sq-c .sq-quote{font-size:60px}.sq-sz-xl.sq-c .sq-quote{font-size:78px}\n.sq-c .sq-ref{display:block;margin-top:18px}\n.sq-c .sq-plate{position:absolute;left:50%;bottom:120px;transform:translateX(-50%);background:#fff;color:var(--bg);font:800 44px 'Saira Semi Condensed',Montserrat,Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;padding:18px 54px;border-radius:6px;box-shadow:0 12px 30px rgba(0,0,0,.35);white-space:nowrap}\n.sq-c .sq-photo{position:absolute;right:120px;bottom:40px;width:290px;height:290px;border-radius:50%;border:10px solid #fff;overflow:hidden;background:var(--hl);box-shadow:0 14px 30px rgba(0,0,0,.4)}\n",
    "html": "<div class=\"sq sq-c sq-sz-{{size}} pkg-fullscreen\">\n  <div class=\"sq-box\"><p class=\"sq-quote\">{{quote|rich}}{{#ref}}<span class=\"sq-ref\">{{ref}}</span>{{/ref}}</p></div>\n  {{#name}}<div class=\"sq-plate\">{{name}}</div>{{/name}}\n  {{#photo}}<div class=\"sq-photo\">{{image:photo}}</div>{{/photo}}\n</div>"
  },
  {
    "format": "mce-graphic@1",
    "id": "sermon-split-portrait",
    "version": 1,
    "name": "Sermon Quote · Split Portrait",
    "category": "quotes",
    "description": "Full-screen sermon quote with a large photo on the left and bold type on the right. *Asterisk* words get a highlighted block in the highlight colour.",
    "color": "#14161b",
    "hold": 0,
    "placement": {
      "x": 0,
      "y": 0,
      "scale": 1
    },
    "fields": [
      {
        "key": "quote",
        "label": "Quote (wrap words in *asterisks* to make them stand out; Enter = new line)",
        "type": "text",
        "default": "Your *tomorrow* is not cancelled. The God who started this good work will *finish what He began* in you.",
        "multiline": true
      },
      {
        "key": "ref",
        "label": "Scripture reference (optional)",
        "type": "text",
        "default": "(Phil. 1:6)"
      },
      {
        "key": "name",
        "label": "Speaker",
        "type": "text",
        "default": "Pastor Firstname Lastname"
      },
      {
        "key": "title",
        "label": "Title / church (optional)",
        "type": "text",
        "default": "Lead Pastor, Your Church Name"
      },
      {
        "key": "series",
        "label": "Series label (optional)",
        "type": "text",
        "default": "Sunday Service · Week 3"
      },
      {
        "key": "photo",
        "label": "Speaker photo (optional)",
        "type": "image",
        "default": ""
      },
      {
        "key": "size",
        "label": "Text size",
        "type": "select",
        "default": "m",
        "options": [
          {
            "value": "s",
            "label": "Small"
          },
          {
            "value": "m",
            "label": "Medium"
          },
          {
            "value": "l",
            "label": "Large"
          },
          {
            "value": "xl",
            "label": "Extra large"
          }
        ]
      },
      {
        "key": "bg",
        "label": "Background colour",
        "type": "color",
        "default": "#14161b"
      },
      {
        "key": "hl",
        "label": "Highlight colour (*words*)",
        "type": "color",
        "default": "#ffcf3f"
      }
    ],
    "animation": {
      "in": [
        [
          ".sq-ph",
          "fade",
          0,
          {
            "d": 0.6
          }
        ],
        [
          ".sq-series",
          "up",
          0.2,
          {
            "d": 0.5
          }
        ],
        [
          ".sq-quote",
          "up",
          0.35,
          {
            "d": 0.7
          }
        ],
        [
          ".sq-name",
          "up",
          0.55,
          {
            "d": 0.6
          }
        ]
      ]
    },
    "css": ".sq{position:relative;width:1920px;height:1080px;overflow:hidden;font-family:Montserrat,'Segoe UI',Arial,sans-serif}\n.sq .hl{color:var(--hl);font-weight:800}\n.sq .sq-ref{color:var(--hl);font-weight:800}\n.sq p{margin:0}\n.sq .pkg-img{display:block;width:100%;height:100%;object-fit:cover}\n\n.sq-d{background:var(--bg);color:#fff}\n.sq-d .sq-ph{position:absolute;left:0;top:0;bottom:0;width:820px;background:#2a2d33}\n.sq-d .sq-ph .pkg-img{position:absolute;inset:0}\n.sq-d .sq-ph::after{content:\"\";position:absolute;inset:0;background:linear-gradient(90deg,transparent 45%,var(--bg) 100%)}\n.sq-d .sq-content{position:absolute;left:200px;right:200px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;gap:48px}\n.sq-d.has-photo .sq-content{left:820px;right:140px}\n.sq-d .sq-series{display:flex;align-items:center;gap:18px;font:700 30px Montserrat,Arial,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:var(--hl)}\n.sq-d .sq-series::before{content:\"\";width:70px;height:6px;background:var(--hl)}\n.sq-d .sq-quote{font:700 84px/1.3 'Saira Semi Condensed',Montserrat,Arial,sans-serif;text-wrap:balance}\n.sq-sz-s.sq-d .sq-quote{font-size:64px}.sq-sz-m.sq-d .sq-quote{font-size:76px}.sq-sz-xl.sq-d .sq-quote{font-size:100px}\n.sq-d .sq-quote .hl{color:var(--bg);background:var(--hl);padding:0 .14em;box-decoration-break:clone;-webkit-box-decoration-break:clone;font-weight:700}\n.sq-d .sq-ref{display:block;font:700 40px Montserrat,Arial,sans-serif;color:var(--hl);margin-top:26px}\n.sq-d .sq-name{font:800 50px Montserrat,Arial,sans-serif}\n.sq-d .sq-name small{display:block;font:500 34px Montserrat,Arial,sans-serif;color:rgba(255,255,255,.7);margin-top:8px}\n",
    "html": "<div class=\"sq sq-d sq-sz-{{size}} pkg-fullscreen {{#photo}}has-photo{{/photo}}\">\n  {{#photo}}<div class=\"sq-ph\">{{image:photo}}</div>{{/photo}}\n  <div class=\"sq-content\">\n    {{#series}}<div class=\"sq-series\">{{series}}</div>{{/series}}\n    <p class=\"sq-quote\">{{quote|rich}}{{#ref}}<span class=\"sq-ref\">{{ref}}</span>{{/ref}}</p>\n    {{#name}}<div class=\"sq-name\">{{name}}{{#title}}<small>{{title}}</small>{{/title}}</div>{{/name}}\n  </div>\n</div>"
  },
  {
    "format": "mce-graphic@1",
    "id": "speaker-bar-strip",
    "version": 1,
    "name": "Speaker · Bar and Strip",
    "category": "speaker",
    "description": "Name on a solid bar with the title on a white strip below it. The bar wipes in from the left, the strip follows and each line slides into place",
    "color": "#0f6e8c",
    "hold": 5,
    "placement": {
      "x": 110,
      "y": 90,
      "scale": 1
    },
    "fields": [
      {
        "key": "name",
        "label": "Name",
        "type": "text",
        "default": "Your Name"
      },
      {
        "key": "title",
        "label": "Title",
        "type": "text",
        "default": "Your Title"
      },
      {
        "key": "plate",
        "label": "Bar colour",
        "type": "color",
        "default": "#0f6e8c",
        "shades": true
      },
      {
        "key": "plate2",
        "label": "Second bar colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "t",
        "label": "Name colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "t2",
        "label": "Title colour",
        "type": "color",
        "default": "#0b2230"
      }
    ],
    "animation": {
      "in": [
        [
          ".s1-name",
          "wipeL",
          0,
          {
            "d": 0.6
          }
        ],
        [
          ".s1-name span",
          "left",
          0.25,
          {
            "d": 0.5
          }
        ],
        [
          ".s1-title",
          "wipeL",
          0.35,
          {
            "d": 0.55
          }
        ],
        [
          ".s1-title span",
          "left",
          0.55,
          {
            "d": 0.45
          }
        ]
      ]
    },
    "css": ".s1{display:inline-flex;flex-direction:column;align-items:flex-start}\n.s1-name{background:var(--plate);padding:16px 36px 18px;overflow:hidden}\n.s1-name span{display:block;font:800 58px/1 Montserrat,\"MCE Archivo\",Arial,sans-serif;color:var(--t);white-space:nowrap}\n.s1-title{background:var(--plate2);padding:11px 36px 12px;overflow:hidden}\n.s1-title span{display:block;font:700 32px/1 Montserrat,\"MCE Archivo\",Arial,sans-serif;color:var(--t2);white-space:nowrap}",
    "html": "<div class=\"s1\">\n  <div class=\"s1-name\"><span>{{name}}</span></div>\n  {{#title}}<div class=\"s1-title\"><span>{{title}}</span></div>{{/title}}\n</div>"
  },
  {
    "format": "mce-graphic@1",
    "id": "speaker-offset-strip",
    "version": 1,
    "name": "Speaker · Offset Strip",
    "category": "speaker",
    "description": "Name bar with the title strip set off to the right underneath, like a step. The bar wipes in, then the strip wipes the other way",
    "color": "#0f6e8c",
    "hold": 5,
    "placement": {
      "x": 110,
      "y": 90,
      "scale": 1
    },
    "fields": [
      {
        "key": "name",
        "label": "Name",
        "type": "text",
        "default": "Your Name"
      },
      {
        "key": "title",
        "label": "Title",
        "type": "text",
        "default": "Your Title"
      },
      {
        "key": "plate",
        "label": "Bar colour",
        "type": "color",
        "default": "#0f6e8c",
        "shades": true
      },
      {
        "key": "plate2",
        "label": "Second bar colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "t",
        "label": "Name colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "t2",
        "label": "Title colour",
        "type": "color",
        "default": "#0b2230"
      }
    ],
    "animation": {
      "in": [
        [
          ".s2-name",
          "wipeL",
          0,
          {
            "d": 0.6
          }
        ],
        [
          ".s2-name span",
          "maskUp",
          0.3
        ],
        [
          ".s2-title",
          "wipeR",
          0.4,
          {
            "d": 0.55
          }
        ],
        [
          ".s2-title span",
          "right",
          0.6,
          {
            "d": 0.45
          }
        ]
      ]
    },
    "css": ".s2{display:inline-flex;flex-direction:column;align-items:flex-end}\n.s2-name{background:var(--plate);padding:14px 40px 16px;margin-right:64px;overflow:hidden}\n.s2-name span{display:block;font:800 56px/1 Montserrat,\"MCE Archivo\",Arial,sans-serif;color:var(--t);white-space:nowrap}\n.s2-title{background:var(--plate2);padding:9px 30px 10px;overflow:hidden;min-width:60%}\n.s2-title span{display:block;font:700 30px/1 Montserrat,\"MCE Archivo\",Arial,sans-serif;color:var(--t2);white-space:nowrap;text-align:right}",
    "html": "<div class=\"s2\">\n  <div class=\"s2-name\"><span>{{name}}</span></div>\n  {{#title}}<div class=\"s2-title\"><span>{{title}}</span></div>{{/title}}\n</div>"
  },
  {
    "format": "mce-graphic@1",
    "id": "speaker-underline-duo",
    "version": 1,
    "name": "Speaker · Underlines",
    "category": "speaker",
    "description": "First and last name in capitals over thin rules, the last name larger and stepped to the right. No box, just lines that draw across and letters that rise",
    "color": "#0f6e8c",
    "hold": 5,
    "placement": {
      "x": 110,
      "y": 90,
      "scale": 1
    },
    "fields": [
      {
        "key": "firstName",
        "label": "First name",
        "type": "text",
        "default": "Your"
      },
      {
        "key": "lastName",
        "label": "Last name",
        "type": "text",
        "default": "Name"
      },
      {
        "key": "title",
        "label": "Title",
        "type": "text",
        "default": "Your Title"
      },
      {
        "key": "t",
        "label": "Name colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "line",
        "label": "Line colour",
        "type": "color",
        "default": "#ffffff"
      }
    ],
    "animation": {
      "in": [
        [
          ".s3-r1 .s3-rule",
          "growX",
          0,
          {
            "d": 0.6
          }
        ],
        [
          ".s3-r2 .s3-rule",
          "growX",
          0.15,
          {
            "d": 0.6
          }
        ],
        [
          ".s3-r1 .s3-tx span",
          "maskUp",
          0.3
        ],
        [
          ".s3-r2 .s3-tx span",
          "maskUp",
          0.42
        ],
        [
          ".s3-title",
          "fade",
          0.7
        ]
      ]
    },
    "css": ".s3{display:inline-flex;flex-direction:column;align-items:flex-start}\n.s3-row{position:relative;display:inline-block;padding:0 26px 10px 4px}\n.s3-r2{margin-left:90px;margin-top:6px}\n.s3-tx{overflow:hidden}\n.s3-r1 .s3-tx span{display:block;font:700 46px/1 Montserrat,\"MCE Archivo\",Arial,sans-serif;color:var(--t);text-transform:uppercase;letter-spacing:.02em;white-space:nowrap}\n.s3-r2 .s3-tx span{display:block;font:800 74px/1 Montserrat,\"MCE Archivo\",Arial,sans-serif;color:var(--t);text-transform:uppercase;letter-spacing:.01em;white-space:nowrap}\n.s3-rule{position:absolute;left:0;right:0;bottom:0;height:4px;background:var(--line)}\n.s3-title{margin:14px 0 0 94px;font:600 28px/1 Montserrat,\"MCE Archivo\",Arial,sans-serif;color:var(--t);white-space:nowrap;text-shadow:0 2px 6px rgba(0,0,0,.45)}\n.s3-tx span{text-shadow:0 2px 8px rgba(0,0,0,.4)}",
    "html": "<div class=\"s3\">\n  <div class=\"s3-row s3-r1\"><div class=\"s3-tx\"><span>{{firstName}}</span></div><i class=\"s3-rule\"></i></div>\n  <div class=\"s3-row s3-r2\"><div class=\"s3-tx\"><span>{{lastName}}</span></div><i class=\"s3-rule\"></i></div>\n  {{#title}}<div class=\"s3-title\">{{title}}</div>{{/title}}\n</div>"
  },
  {
    "format": "mce-graphic@1",
    "id": "speaker-solid-box",
    "version": 1,
    "name": "Speaker · Solid Box",
    "category": "speaker",
    "description": "Name in bold capitals with the title underneath, together in one solid box. The box wipes up and the words rise inside it",
    "color": "#0f6e8c",
    "hold": 5,
    "placement": {
      "x": 110,
      "y": 90,
      "scale": 1
    },
    "fields": [
      {
        "key": "name",
        "label": "Name",
        "type": "text",
        "default": "Your Name"
      },
      {
        "key": "title",
        "label": "Title",
        "type": "text",
        "default": "Your Title"
      },
      {
        "key": "plate",
        "label": "Bar colour",
        "type": "color",
        "default": "#0f6e8c",
        "shades": true
      },
      {
        "key": "t",
        "label": "Name colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "t2",
        "label": "Title colour",
        "type": "color",
        "default": "#ffffff"
      }
    ],
    "animation": {
      "in": [
        [
          ".s4",
          "wipeU",
          0,
          {
            "d": 0.55
          }
        ],
        [
          ".s4-name span",
          "maskUp",
          0.25
        ],
        [
          ".s4-title span",
          "maskUp",
          0.4
        ]
      ]
    },
    "css": ".s4{display:inline-block;background:var(--plate);padding:18px 38px 20px;overflow:hidden;box-shadow:0 12px 30px rgba(0,0,0,.28)}\n.s4-name,.s4-title{overflow:hidden}\n.s4-name span{display:block;font:800 54px/1 Montserrat,\"MCE Archivo\",Arial,sans-serif;color:var(--t);text-transform:uppercase;white-space:nowrap}\n.s4-title span{display:block;margin-top:8px;font:600 30px/1 Montserrat,\"MCE Archivo\",Arial,sans-serif;color:var(--t2);white-space:nowrap}",
    "html": "<div class=\"s4\"><div class=\"s4-name\"><span>{{name}}</span></div>{{#title}}<div class=\"s4-title\"><span>{{title}}</span></div>{{/title}}</div>"
  },
  {
    "format": "mce-graphic@1",
    "id": "speaker-bold-outline",
    "version": 1,
    "name": "Speaker · Bold Outline",
    "category": "speaker",
    "description": "A big name in capitals inside a white outline, the title tucked in at the bottom right. The frame opens from the middle and the name sweeps in",
    "color": "#0f6e8c",
    "hold": 5,
    "placement": {
      "x": 110,
      "y": 90,
      "scale": 1
    },
    "fields": [
      {
        "key": "name",
        "label": "Name",
        "type": "text",
        "default": "Your Name"
      },
      {
        "key": "title",
        "label": "Title",
        "type": "text",
        "default": "Your Title"
      },
      {
        "key": "t",
        "label": "Name colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "line",
        "label": "Line colour",
        "type": "color",
        "default": "#ffffff"
      }
    ],
    "animation": {
      "in": [
        [
          ".s5-frame",
          "wipeC",
          0,
          {
            "d": 0.6
          }
        ],
        [
          ".s5-name",
          "blurL",
          0.3
        ],
        [
          ".s5-title",
          "fade",
          0.55
        ]
      ]
    },
    "css": ".s5{position:relative;display:inline-flex;flex-direction:column;align-items:flex-start;padding:14px 30px 14px 24px}\n.s5-frame{position:absolute;inset:0;border:4px solid var(--line)}\n.s5-name{font:900 84px/0.95 Montserrat,\"MCE Archivo\",Arial,sans-serif;color:var(--t);text-transform:uppercase;white-space:nowrap;text-shadow:0 2px 10px rgba(0,0,0,.35)}\n.s5-title{align-self:flex-end;margin-top:4px;font:600 28px/1 Montserrat,\"MCE Archivo\",Arial,sans-serif;color:var(--t);white-space:nowrap}",
    "html": "<div class=\"s5\"><i class=\"s5-frame\"></i><div class=\"s5-name\">{{name}}</div>{{#title}}<div class=\"s5-title\">{{title}}</div>{{/title}}</div>"
  },
  {
    "format": "mce-graphic@1",
    "id": "speaker-wide-box",
    "version": 1,
    "name": "Speaker · Wide Box",
    "category": "speaker",
    "description": "Name and title on one wide coloured box with generous room. The box stretches out from the left and both lines rise in",
    "color": "#0f6e8c",
    "hold": 5,
    "placement": {
      "x": 110,
      "y": 90,
      "scale": 1
    },
    "fields": [
      {
        "key": "name",
        "label": "Name",
        "type": "text",
        "default": "Your Name"
      },
      {
        "key": "title",
        "label": "Title",
        "type": "text",
        "default": "Your Title"
      },
      {
        "key": "plate",
        "label": "Bar colour",
        "type": "color",
        "default": "#0f6e8c",
        "shades": true
      },
      {
        "key": "t",
        "label": "Name colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "t2",
        "label": "Title colour",
        "type": "color",
        "default": "#ffffff"
      }
    ],
    "animation": {
      "in": [
        [
          ".s6",
          "growX",
          0,
          {
            "d": 0.65
          }
        ],
        [
          ".s6-name span",
          "maskUp",
          0.3
        ],
        [
          ".s6-title span",
          "maskUp",
          0.45
        ]
      ]
    },
    "css": ".s6{display:inline-block;min-width:560px;background:var(--plate);padding:20px 70px 22px 40px;overflow:hidden}\n.s6-name,.s6-title{overflow:hidden}\n.s6-name span{display:block;font:800 56px/1 Montserrat,\"MCE Archivo\",Arial,sans-serif;color:var(--t);white-space:nowrap}\n.s6-title span{display:block;margin-top:6px;font:600 32px/1 Montserrat,\"MCE Archivo\",Arial,sans-serif;color:var(--t2);white-space:nowrap}",
    "html": "<div class=\"s6\"><div class=\"s6-name\"><span>{{name}}</span></div>{{#title}}<div class=\"s6-title\"><span>{{title}}</span></div>{{/title}}</div>"
  },
  {
    "format": "mce-graphic@1",
    "id": "speaker-stacked-pair",
    "version": 1,
    "name": "Speaker · Stacked Pair",
    "category": "speaker",
    "description": "Name on a coloured bar stacked on a white title bar of the same width. The bars wipe in one after the other and the text rises",
    "color": "#0f6e8c",
    "hold": 5,
    "placement": {
      "x": 110,
      "y": 90,
      "scale": 1
    },
    "fields": [
      {
        "key": "name",
        "label": "Name",
        "type": "text",
        "default": "Your Name"
      },
      {
        "key": "title",
        "label": "Title",
        "type": "text",
        "default": "Your Title"
      },
      {
        "key": "plate",
        "label": "Bar colour",
        "type": "color",
        "default": "#0f6e8c",
        "shades": true
      },
      {
        "key": "plate2",
        "label": "Second bar colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "t",
        "label": "Name colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "t2",
        "label": "Title colour",
        "type": "color",
        "default": "#0b2230"
      }
    ],
    "animation": {
      "in": [
        [
          ".s7-name",
          "wipeL",
          0,
          {
            "d": 0.55
          }
        ],
        [
          ".s7-title",
          "wipeL",
          0.18,
          {
            "d": 0.55
          }
        ],
        [
          ".s7-name span",
          "maskUp",
          0.35
        ],
        [
          ".s7-title span",
          "fade",
          0.55
        ]
      ]
    },
    "css": ".s7{display:inline-grid}\n.s7-name{background:var(--plate);padding:12px 30px 12px;overflow:hidden}\n.s7-name span{display:block;font:800 52px/1 Montserrat,\"MCE Archivo\",Arial,sans-serif;color:var(--t);white-space:nowrap}\n.s7-title{background:var(--plate2);padding:8px 30px 9px;overflow:hidden}\n.s7-title span{display:block;font:700 28px/1 Montserrat,\"MCE Archivo\",Arial,sans-serif;color:var(--t2);white-space:nowrap}",
    "html": "<div class=\"s7\"><div class=\"s7-name\"><span>{{name}}</span></div>{{#title}}<div class=\"s7-title\"><span>{{title}}</span></div>{{/title}}</div>"
  },
  {
    "format": "mce-graphic@1",
    "id": "speaker-split-name",
    "version": 1,
    "name": "Speaker · Split Name",
    "category": "speaker",
    "description": "First name on a coloured block, last name on a white block beside it, both in heavy capitals. The blocks wipe towards each other",
    "color": "#0f6e8c",
    "hold": 5,
    "placement": {
      "x": 110,
      "y": 90,
      "scale": 1
    },
    "fields": [
      {
        "key": "firstName",
        "label": "First name",
        "type": "text",
        "default": "Your"
      },
      {
        "key": "lastName",
        "label": "Last name",
        "type": "text",
        "default": "Name"
      },
      {
        "key": "title",
        "label": "Title",
        "type": "text",
        "default": "Your Title"
      },
      {
        "key": "plate",
        "label": "Bar colour",
        "type": "color",
        "default": "#0f6e8c",
        "shades": true
      },
      {
        "key": "plate2",
        "label": "Second bar colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "t",
        "label": "Name colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "t2",
        "label": "Last name colour",
        "type": "color",
        "default": "#0b2230"
      }
    ],
    "animation": {
      "in": [
        [
          ".s8-first",
          "wipeR",
          0,
          {
            "d": 0.55
          }
        ],
        [
          ".s8-last",
          "wipeL",
          0.15,
          {
            "d": 0.55
          }
        ],
        [
          ".s8-first span",
          "maskUp",
          0.35
        ],
        [
          ".s8-last span",
          "maskUp",
          0.45
        ],
        [
          ".s8-title",
          "up",
          0.65,
          {
            "d": 0.45
          }
        ]
      ]
    },
    "css": ".s8{display:inline-flex;align-items:stretch}\n.s8-first{background:var(--plate);padding:12px 22px 10px 28px;overflow:hidden}\n.s8-last{background:var(--plate2);padding:12px 28px 10px 22px;overflow:hidden}\n.s8-first span{display:block;font:900 66px/1 Montserrat,\"MCE Archivo\",Arial,sans-serif;color:var(--t);text-transform:uppercase;white-space:nowrap}\n.s8-last span{display:block;font:900 66px/1 Montserrat,\"MCE Archivo\",Arial,sans-serif;color:var(--t2);text-transform:uppercase;white-space:nowrap}\n.s8-title{margin-top:10px;font:600 28px/1 Montserrat,\"MCE Archivo\",Arial,sans-serif;color:#fff;white-space:nowrap;text-shadow:0 2px 6px rgba(0,0,0,.45)}",
    "html": "<div class=\"s8\"><div class=\"s8-first\"><span>{{firstName}}</span></div><div class=\"s8-last\"><span>{{lastName}}</span></div></div>{{#title}}<div class=\"s8-title\">{{title}}</div>{{/title}}"
  },
  {
    "format": "mce-graphic@1",
    "id": "speaker-thin-frame",
    "version": 1,
    "name": "Speaker · Thin Frame",
    "category": "speaker",
    "description": "Name and title inside a thin white frame. A light, open look that suits busy pictures. The frame opens from the middle and the words slide in",
    "color": "#0f6e8c",
    "hold": 5,
    "placement": {
      "x": 110,
      "y": 90,
      "scale": 1
    },
    "fields": [
      {
        "key": "name",
        "label": "Name",
        "type": "text",
        "default": "Your Name"
      },
      {
        "key": "title",
        "label": "Title",
        "type": "text",
        "default": "Your Title"
      },
      {
        "key": "t",
        "label": "Name colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "line",
        "label": "Line colour",
        "type": "color",
        "default": "#ffffff"
      }
    ],
    "animation": {
      "in": [
        [
          ".s9-frame",
          "wipeC",
          0,
          {
            "d": 0.6
          }
        ],
        [
          ".s9-name",
          "left",
          0.3,
          {
            "d": 0.5
          }
        ],
        [
          ".s9-title",
          "left",
          0.45,
          {
            "d": 0.5
          }
        ]
      ]
    },
    "css": ".s9{position:relative;display:inline-block;min-width:440px;padding:16px 60px 18px 24px}\n.s9-frame{position:absolute;inset:0;border:3px solid var(--line)}\n.s9-name{font:700 44px/1 Montserrat,\"MCE Archivo\",Arial,sans-serif;color:var(--t);white-space:nowrap;text-shadow:0 2px 8px rgba(0,0,0,.4)}\n.s9-title{margin-top:6px;font:600 26px/1 Montserrat,\"MCE Archivo\",Arial,sans-serif;color:var(--t);white-space:nowrap;text-shadow:0 2px 6px rgba(0,0,0,.4)}",
    "html": "<div class=\"s9\"><i class=\"s9-frame\"></i><div class=\"s9-name\">{{name}}</div>{{#title}}<div class=\"s9-title\">{{title}}</div>{{/title}}</div>"
  },
  {
    "format": "mce-graphic@1",
    "id": "speaker-clean-text",
    "version": 1,
    "name": "Speaker · Clean Text",
    "category": "speaker",
    "description": "Just the name and title, no box. Bold white type with a soft shadow so it reads over any picture. Each line rises out of a mask",
    "color": "#0f6e8c",
    "hold": 5,
    "placement": {
      "x": 110,
      "y": 90,
      "scale": 1
    },
    "fields": [
      {
        "key": "name",
        "label": "Name",
        "type": "text",
        "default": "Your Name"
      },
      {
        "key": "title",
        "label": "Title",
        "type": "text",
        "default": "Your Title"
      },
      {
        "key": "t",
        "label": "Name colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "t2",
        "label": "Title colour",
        "type": "color",
        "default": "#ffffff"
      }
    ],
    "animation": {
      "in": [
        [
          ".s10-name",
          "maskUp",
          0,
          {
            "d": 0.55
          }
        ],
        [
          ".s10-title",
          "maskUp",
          0.22,
          {
            "d": 0.55
          }
        ]
      ]
    },
    "css": ".s10{display:inline-block}\n.s10-l{overflow:hidden;padding:0 8px 4px 0}\n.s10-name{display:block;font:800 60px/1 Montserrat,\"MCE Archivo\",Arial,sans-serif;color:var(--t);white-space:nowrap;text-shadow:0 3px 12px rgba(0,0,0,.55)}\n.s10-title{display:block;margin-top:2px;font:700 32px/1 Montserrat,\"MCE Archivo\",Arial,sans-serif;color:var(--t2);white-space:nowrap;text-shadow:0 2px 8px rgba(0,0,0,.55)}",
    "html": "<div class=\"s10\"><div class=\"s10-l\"><span class=\"s10-name\">{{name}}</span></div>{{#title}}<div class=\"s10-l\"><span class=\"s10-title\">{{title}}</span></div>{{/title}}</div>"
  },
  {
    "format": "mce-graphic@1",
    "id": "speaker-spaced-caps",
    "version": 1,
    "name": "Speaker · Spaced Capitals",
    "category": "speaker",
    "description": "Name in widely spaced capitals on a coloured bar with the title centred on a small white strip below. The letters settle into place as the bar opens from the middle",
    "color": "#0f6e8c",
    "hold": 5,
    "placement": {
      "x": 110,
      "y": 90,
      "scale": 1
    },
    "fields": [
      {
        "key": "name",
        "label": "Name",
        "type": "text",
        "default": "Your Name"
      },
      {
        "key": "title",
        "label": "Title",
        "type": "text",
        "default": "Your Title"
      },
      {
        "key": "plate",
        "label": "Bar colour",
        "type": "color",
        "default": "#0f6e8c",
        "shades": true
      },
      {
        "key": "plate2",
        "label": "Second bar colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "t",
        "label": "Name colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "t2",
        "label": "Title colour",
        "type": "color",
        "default": "#0b2230"
      }
    ],
    "animation": {
      "in": [
        [
          ".s11-name",
          "wipeC",
          0,
          {
            "d": 0.6
          }
        ],
        {
          "sel": ".s11-name span",
          "from": {
            "letterSpacing": "0.5em",
            "opacity": 0
          },
          "to": {
            "letterSpacing": "0.12em",
            "opacity": 1
          },
          "at": 0.2,
          "d": 0.8,
          "e": "expo.out"
        },
        [
          ".s11-title",
          "wipeC",
          0.45,
          {
            "d": 0.5
          }
        ],
        [
          ".s11-title span",
          "fade",
          0.6
        ]
      ]
    },
    "css": ".s11{display:inline-flex;flex-direction:column;align-items:center}\n.s11-name{background:var(--plate);padding:12px 34px 13px;overflow:hidden}\n.s11-name span{display:block;font:800 48px/1 Montserrat,\"MCE Archivo\",Arial,sans-serif;color:var(--t);text-transform:uppercase;letter-spacing:.12em;white-space:nowrap}\n.s11-title{background:var(--plate2);padding:7px 26px 8px;margin-top:6px;overflow:hidden}\n.s11-title span{display:block;font:700 24px/1 Montserrat,\"MCE Archivo\",Arial,sans-serif;color:var(--t2);letter-spacing:.14em;white-space:nowrap}",
    "html": "<div class=\"s11\"><div class=\"s11-name\"><span>{{name}}</span></div>{{#title}}<div class=\"s11-title\"><span>{{title}}</span></div>{{/title}}</div>"
  },
  {
    "format": "mce-graphic@1",
    "id": "speaker-two-tone-tag",
    "version": 1,
    "name": "Speaker · Two-Tone and Tag",
    "category": "speaker",
    "description": "A large first name on a coloured block, the last name on a white block beside it and the title on a small coloured tag underneath. Each piece wipes in in turn",
    "color": "#0f6e8c",
    "hold": 5,
    "placement": {
      "x": 110,
      "y": 90,
      "scale": 1
    },
    "fields": [
      {
        "key": "firstName",
        "label": "First name",
        "type": "text",
        "default": "Your"
      },
      {
        "key": "lastName",
        "label": "Last name",
        "type": "text",
        "default": "Name"
      },
      {
        "key": "title",
        "label": "Title",
        "type": "text",
        "default": "Your Title"
      },
      {
        "key": "plate",
        "label": "Bar colour",
        "type": "color",
        "default": "#0f6e8c",
        "shades": true
      },
      {
        "key": "plate2",
        "label": "Second bar colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "t",
        "label": "Name colour",
        "type": "color",
        "default": "#ffffff"
      },
      {
        "key": "t2",
        "label": "Title colour",
        "type": "color",
        "default": "#0b2230"
      }
    ],
    "animation": {
      "in": [
        [
          ".s12-first",
          "wipeL",
          0,
          {
            "d": 0.55
          }
        ],
        [
          ".s12-last",
          "wipeL",
          0.2,
          {
            "d": 0.5
          }
        ],
        [
          ".s12-tag",
          "wipeL",
          0.38,
          {
            "d": 0.45
          }
        ],
        [
          ".s12-first span",
          "maskUp",
          0.3
        ],
        [
          ".s12-last span",
          "maskUp",
          0.42
        ],
        [
          ".s12-tag span",
          "fade",
          0.6
        ]
      ]
    },
    "css": ".s12{display:inline-flex;flex-direction:column;align-items:flex-start}\n.s12-row{display:inline-flex;align-items:flex-end}\n.s12-first{background:var(--plate);padding:8px 22px 8px 26px;overflow:hidden}\n.s12-first span{display:block;font:800 72px/1 Montserrat,\"MCE Archivo\",Arial,sans-serif;color:var(--t);white-space:nowrap}\n.s12-last{background:var(--plate2);padding:6px 20px 6px 18px;overflow:hidden;margin-bottom:6px}\n.s12-last span{display:block;font:700 42px/1 Montserrat,\"MCE Archivo\",Arial,sans-serif;color:var(--t2);white-space:nowrap}\n.s12-tag{background:var(--plate);padding:6px 24px 7px;margin-left:56px;overflow:hidden}\n.s12-tag span{display:block;font:600 26px/1 Montserrat,\"MCE Archivo\",Arial,sans-serif;color:var(--t);white-space:nowrap}",
    "html": "<div class=\"s12\"><div class=\"s12-row\"><div class=\"s12-first\"><span>{{firstName}}</span></div><div class=\"s12-last\"><span>{{lastName}}</span></div></div>{{#title}}<div class=\"s12-tag\"><span>{{title}}</span></div>{{/title}}</div>"
  }
];
