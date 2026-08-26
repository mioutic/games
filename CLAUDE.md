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
