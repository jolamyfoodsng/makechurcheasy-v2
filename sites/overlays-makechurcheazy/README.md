# Church Overlays (overlays.makechurcheazy.com)

Static site, no build step and no backend. Free live-stream overlays for churches: pick a design, customize it, copy a link into OBS as a Browser Source.

## Files

- `index.html` — landing page, overlay gallery and the customizer dialog.
- `overlay.html` — the page OBS loads. Everything it shows is read from the link's query string.
- `assets/overlays.js` — template registry and renderer (add new overlays here).
- `assets/overlays.css` — overlay styles on a 1920×1080 stage.
- `assets/site.js`, `assets/site.css` — gallery and customizer UI.

## Run locally

```bash
python3 -m http.server 8765
```

Open http://localhost:8765/. To test an overlay on its own: `overlay.html?t=lower-third-clean&bg=dark` (`bg` = `dark`, `green` or `checker`; leave it off in OBS so the background stays transparent).

## Add an overlay

Push an entry onto `T` in `assets/overlays.js` with an `id`, `name`, `category`, `fields`, and an `html(params)` function. Escape every value with `esc()`. Add its styles to `assets/overlays.css`. Show and hide are driven by the `in` class on the root, so put hidden states in the base rule and visible states under `.ov.in`.

## Deploy to the subdomain

Publish this folder as-is on any static host and point `overlays.makechurcheazy.com` at it (DNS CNAME to the host, then add the domain in the host's settings). `index.html` already uses `https://overlays.makechurcheazy.com/` as its canonical URL.

## Not in this version

- Changing an overlay live from a phone or Stream Deck (needs a backend).
- Per-church subdomains and saved accounts.
- Image upload for logos (the logo field takes a public https link).
