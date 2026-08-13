# games

A pocket arcade, hosted on GitHub Pages and installed to an iPhone home screen.

## Design — read this before touching anything visual

**The house style is Sanguine, and it is binding.** The full brief lives in
[`DESIGN.md`](./DESIGN.md) and is imported below so it loads with this file.
Anything that renders — the launcher, every game, the app icon, the manifest
colours, the splash — follows it. Do not invent a palette, and do not fall back
to a generic dark theme.

@DESIGN.md

The four rules that get broken most often, restated so they are hard to miss:

1. **No emoji. Ever.** Not in game tiles, not as status, not as section markers.
   Draw an SVG glyph or use a typographic mark (❦ ✦ ◆ ◈ ❖ ▸ ‡ §).
2. **The primary accent is bone `#e9d8c5`, not blood.** Crimson is decorative
   only — gradients, bloom, logo. A red primary collides with the error rose and
   the two stop being distinguishable.
3. **Corners are 0–4px, borders are hairlines.** Instrument panel, not SaaS card.
   No 20px pill geometry, no bouncy easing — motion is 120–200ms and mechanical.
4. **Serif for display, sans for body, mono for numerals.** The serif is the
   gothic read; keep it to headers, the wordmark and section titles.
5. **The phone rotates.** Landscape leaves ~390px of height, so every sheet
   caps its height and scrolls, and on-screen controls reposition rather than
   just shrink. A panel that only works in portrait is a broken panel.

## Repo map

```
index.html    root forwarder — Pages advertises /games/, the app is at /games/play/
404.html      same, for any unmatched path (absolute links: depth is unknown)
play/         the deployed build — 4 static files, this is what Pages serves
arcade/       source: launcher, games, tools
  index.html    launcher shell, shared by both builds
  games/<slug>/ one folder per game: index.html + optional game.json
  tools/        build scripts
  VERSION       single source for the build stamp and the SW CACHE_VERSION
```

`play/` and `arcade/games.json` are **generated — never hand-edit them.** CI
rebuilds both on push; to do it locally:

```
python3 arcade/tools/build-index.py    # rescan arcade/games/ -> games.json
python3 arcade/tools/build-pwa.py      # regenerate play/
```

## Working notes

- **`main` is the live site.** Pushing to it publishes immediately, so put
  changes on a branch and merge when they're ready.
- Adding a game = drop a folder into `arcade/games/` with an `index.html`.
  Nothing else to register; the index rebuilds itself.
- Shipping an update = bump `arcade/VERSION`. That one value feeds both the
  on-screen build stamp and the service worker's `CACHE_VERSION`, so phones
  can't get stuck on a stale build.
- Every path in `play/` must be relative (`./x`). Pages serves from the project
  subpath `/games/play/`, where an absolute `/x` resolves to the domain root and
  404s. `build-pwa.py` fails the build if a non-relative path survives.
- Games run in an iframe and must be self-contained: no CDNs, no ES modules,
  `localStorage` for saved progress.
- Live at https://mioutic.github.io/games/play/
