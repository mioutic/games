# Arcade

A phone-first launcher for the games in this repo. Built to be bookmarked or
added to the iPhone home screen, where it runs full screen with no Safari chrome.

Live at **https://mioutic.github.io/games/arcade/** once GitHub Pages is enabled
(Settings → Pages → Deploy from a branch). Note that Pages only serves a private
repo on a paid plan — on the free plan the repo has to be public.

## Adding a game

Drop a folder into `arcade/games/` with an `index.html` inside, then push:

```
arcade/games/my-game/
  index.html
  game.json      # optional
```

That's the whole process — there is no index to hand-edit. Pushing triggers the
`Rebuild arcade index` workflow, which regenerates `games.json`; the launcher
reads that from its own origin, so listing games needs no token and no API call.
Pull down on the grid to refresh.

If `games.json` is ever missing, the launcher falls back to listing folders
through the GitHub contents API, which only works while the repo is public.

### game.json

Every field is optional. Without the file, the title comes from the folder name
and the channel-strip ink is picked from the folder name's hash.

```json
{
  "name": "My Game",
  "glyph": "bolt",
  "description": "One line, shown under the title.",
  "ink": "#6fb3ab",
  "stat": { "key": "mygame.best", "label": "Best", "format": "int" },
  "entry": "index.html"
}
```

- `glyph` names a line icon drawn by the launcher — `bolt`, `serpent`, `grid`,
  or `default` (a diamond). **No emoji**: the house style forbids it, and
  `build-index.py` warns if a `game.json` still carries an `emoji` field. To add
  a glyph, put its SVG path in the `GLYPHS` table in `arcade/index.html`.
- `ink` is the 2px channel strip along the card's top edge. Keep it to the
  categorical ramp in `DESIGN.md` — it is the only per-game colour on screen.
- `stat` points at the `localStorage` key holding the personal best, so the card
  can show it as a readout. `format` is `int` or `ms`.

## Notes for game authors

Games load in an iframe, so keep them self-contained — relative paths only, no
external CDNs if you want them working offline. For a phone, these help:

- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">`
- `touch-action: none` on anything you drag or swipe over
- `env(safe-area-inset-*)` padding so nothing hides under the home indicator
- `localStorage` for high scores — it persists per game

`games/reflex/` and `games/snake/` are working examples of all of the above.

## The installable build

`play/` is the version to host: four static files, everything inlined, no build
step needed to serve it. It installs to the iPhone home screen as a standalone
app and works offline through a network-first service worker.

```
play/index.html     launcher + every game inlined
play/manifest.json
play/sw.js
play/icon-180.png
```

CI regenerates it alongside `games.json`, so adding a game updates the
installable app too. To ship an update, bump `arcade/VERSION` — that single
value becomes both the on-screen build stamp and the service worker's
`CACHE_VERSION`, so they cannot drift and phones cannot get stuck on a stale
build. The refresh button checks for a new worker and reloads.

## Tools

```
python3 arcade/tools/build-index.py                 # regenerate games.json (CI does this for you)
python3 arcade/tools/build-pwa.py                   # regenerate play/ (CI does this for you)
python3 arcade/tools/build-bundle.py out.html       # inline everything into one offline file
python3 arcade/tools/build-artifact.py in.html out.html   # strip the wrapper for an Artifact publish
```
