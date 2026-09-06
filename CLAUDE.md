# games

A pocket arcade, hosted on GitHub Pages and installed to an iPhone home screen.

## The two links

| | |
| --- | --- |
| **Live** (what the phone has installed) | https://mioutic.github.io/games/play/ |
| **Local** (source build, no deploy needed) | http://100.93.221.36:8123/arcade/ or http://desktop-2nm2pol.tail9e6fa0.ts.net:8123/arcade/ |

The local one is `arcade/tools/serve.py` on the tailnet, started from the
Helios tray/phone panel (app id `arcade`) or by `python3 arcade/tools/serve.py`.
It serves `arcade/` straight from the working tree with `no-store`, so an edit
shows on the phone on refresh. It is only up while the server is running;
`GET /api/status` on it says. The live link updates a minute or so after a
push to `main`; confirm with `CACHE_VERSION` in
https://mioutic.github.io/games/play/sw.js.

**Both are how work gets checked.** The owner reads these sessions from a
phone, often away from the desk, so every change that is meant to be seen gets
pushed to `main` and the live link is where it is tried. "Push so I can test"
is the standing instruction, not a request to be waited for.

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

## Platform — read this before writing a renderer or a layout

[`PLATFORM.md`](./PLATFORM.md) is imported below. It holds the measured device
numbers (430×932, dpr 3 capped to 2, a 59px Dynamic Island inset, 60fps at
45–80k triangles and ~20 draws), the render budget, and a list of the WebGL2
and iOS-viewport bugs that have already been hit here — with their fixes. Read
it before guessing at a limit; every number in it came off the actual phone.

@PLATFORM.md

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

## A new game — the contract

"Make a new arcade game" means a folder under `arcade/games/<slug>/` holding
one self-contained `index.html` (plus optional `game.json`) that:

1. **Follows Sanguine** (DESIGN.md) — bone accent, oxblood surfaces, serif
   display, 0–4px corners, no emoji, motion 120–200ms.
2. **Has one `#stage`** sized in JS from `visualViewport` with the standalone
   floor, everything else `position:absolute` inside it, re-measured on
   `resize`, `visualViewport` resize/scroll and `orientationchange` (several
   times over ~600ms). Caps `dpr` at 2. Works at 380px of height.
3. **Speaks the launcher contract** over `postMessage`: answers
   `{type:'arcade:spec?'}` with `{type:'arcade:spec', name, win, doc, vv,
   stage, canvas, ins, fps, scale}`; posts `{type:'arcade:fullscreen', on}`
   when it goes full screen and sets its own `--safe-t` to `0px` when framed
   and not fullscreen; posts `{type:'arcade:exit'}` from a **Leave to Arcade**
   button in its settings sheet, which is the only way out in fullscreen.
4. **Settings sheet** capped `max-height:100%; overflow-y:auto`, closable by
   tapping the scrim, with sound / haptics / fullscreen switches (the audio
   context is built on the first user gesture, never at boot, or iOS ships it
   mute).
5. **Touch first.** Sticks or drag in the bottom corners, repositioned (not
   shrunk) in landscape; a keyboard mapping (WASD + arrows, space) for desktop
   testing.
6. **Saves** in `localStorage`, mirrored to `caches.open('<slug>-save')`
   because Safari and the home-screen app do not share storage; export as
   text from settings if progress matters.
7. **Self-contained:** no CDNs, no ES modules, no fetches. `build-pwa.py`
   inlines it into the offline build.
8. **Ships the same way every time:** branch → check on the local link →
   `build-index.py` + `build-pwa.py` → bump `arcade/VERSION` → commit → push
   the branch → merge to `main` (the repo's habit is a `--no-ff` merge) → push
   → confirm `sw.js` on the live link → give the owner the link.

The launcher tile takes `game.json` (`name`, `glyph`, `description`, `ink`,
`stat`); see `arcade/README.md`. Thirst (`arcade/games/thirst/`) is the fullest
reference for all of the above: a designed bounded world baked into chunks, a
flow-field nav grid, an upgrade pool, a save mirror, a diagnostics readout.

## Testing without the phone

`test/` holds the Playwright harness (`npm install` in `test/` once; it pulls
Playwright and Chromium). It runs headless with SwiftShader, which is good for
**exceptions, layout geometry and a screenshot** and worthless for **frame rate
or feel** — never report a performance conclusion from it, only a relative
before/after on the same machine, and send the owner to the game's own fps
readout for the real number.

```
cd test
node audit.js              # every game: stage 430x932, dpr, cover, arcade:spec answers
node sw.test.js            # the service worker's network-first-with-timeout logic
node audio.test.js [slug]  # no AudioContext before a gesture; mute really mutes
node thirst/pool.test.js   # the upgrade pool never degrades to gold
node thirst/world.test.js  # collision, wall ejection, spawn placement on all maps
node thirst/path.test.js   # a foe behind a wall reaches the player
node thirst/probe.js       # a kiting bot plays 3-4 minutes and reports pacing
```

To look at something that normally needs play (a boss, a level-up sheet), the
pattern is: copy the game to a scratch path, splice a `window.__hook` in at the
`/* ---- loop ---- */` anchor, drive it, screenshot, and never ship the hook.
`test/thirst/probe.js` is the worked example.

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
- **Testing does not need a deploy.** `python3 arcade/tools/serve.py` serves the
  repo on the tailnet; open the printed `/arcade/` URL on the phone. `arcade/`
  is the source build — it fetches `games.json` and loads each game from its own
  folder, so an edit shows on refresh with no build, no commit and no push.
  Everything is sent `no-store`, because a stale copy on the phone looks exactly
  like a broken game and has cost this project more time than any real bug.
  Reserve `play/` for confirming the shipped build before merging.
- Over plain HTTP on a tailnet address the page is **not a secure context**: no
  service worker (which is the point while testing) and no
  `DeviceOrientationEvent.requestPermission`, so tilt controls cannot work there.
  Touch-stick games are unaffected. Enabling HTTPS certificates once in the
  Tailscale admin console and running `tailscale serve --bg 8123` fronts it at
  `https://<machine>.<tailnet>.ts.net/` with a real certificate, where sensors
  and service workers behave as they do on Pages.
- **Helios can start it.** The repo is registered as the `arcade` app
  (`Misc/Global Bridge/apps.json`, `type: python-server`, port 8123, icon
  `src/icons/arcade.png`). Start/stop it from the Helios tray or phone panel;
  its **LNK** button copies the tailnet URL. `start.bat` launches
  `arcade/tools/serve.py` under `pythonw`, and the server answers
  `GET /api/status` (Helios's liveness check) and `POST /api/shutdown` (its
  polite stop). `/` redirects to `/arcade/` because the LNK button copies the
  bare root and there is no field for a path.
  See `Global Bridge/docs/SERVED_APPS.md` for the whole contract — including the
  `pythonw` trap, where `sys.stdout` is `None` and a bare `sys.stdout.write` in
  a per-request path kills every response while the port stays open.
- Live at https://mioutic.github.io/games/play/
