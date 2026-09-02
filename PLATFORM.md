# Platform — the device, the budget, and what has already been tested

Everything below was measured on the actual phone this arcade is built for, or
found by breaking something and fixing it. It is here so a future session does
not have to rediscover it. **Do not treat any number in this file as a guess.**

Where this overlaps `DESIGN.md`, that file owns the *look* and this one owns the
*machine*. Rotation and Safari's viewport are documented in DESIGN.md because
they change the layout; the render budget and the WebGL gotchas live here.

---

## The device

| | |
| --- | --- |
| Logical viewport | **430 × 932** portrait, 932 × 430 landscape |
| `devicePixelRatio` | **3**, capped to **2** in every game |
| Safe-area top | **59px** — the Dynamic Island. This is the number that keeps showing up |
| Safe-area bottom | 34px when the toolbar is retracted, 0 when it is not |
| Install | Added to the home screen, runs standalone, `display: "standalone"` |
| Measured performance | **60fps** at 100% render scale, ~17–21 draw calls, 45–80k triangles |

Assume that budget until something on screen says otherwise. It is a real
device number, not a target.

### The 59px, and why it kept coming back

Three separate bugs all produced a stage exactly 59px short of the screen, and
each time it looked like a new problem:

1. `visualViewport.height` under-reports inside an iframe on iOS — it can hand
   back the safe-area height rather than the frame height. Fixed by taking the
   **largest** of `documentElement.clientHeight`, `window.innerHeight`, and
   `visualViewport.height + visualViewport.offsetTop`.
2. `position: fixed; inset: 0` sizes to the **layout** viewport, which is not
   the visible area while a toolbar overlays it. Fixed by setting the covering
   element's width and height from measurement in JS.
3. Even after both, Safari still reported 873 on a 932 screen with nothing
   visibly occupying the band. **Installed to the home screen there is no
   browser chrome that could explain a short viewport**, so the launcher and
   every game now floor their measurement at `screen` size when
   `navigator.standalone` (or `display-mode: standalone`) is true *and* nothing
   is above them. "Nothing above them" means: opened directly, or framed with
   the launcher bar hidden. Framed-and-not-fullscreen must still yield the
   bar's strip, because that is a real occupant.

The general lesson, which is worth more than the specific fix: **when a
measurement disagrees with the physical screen, first work out who could
plausibly own the missing pixels.** If nobody can, the measurement is wrong and
the screen is right.

### Instrument, do not infer

The single most useful thing built in this repo is not a rendering feature, it
is the readout. The launcher has a **Display metrics** panel (caliper icon in
the masthead, and one in the player bar) that reads window / document /
visualViewport / screen, the four safe-area insets off real resolved padding,
and the player and iframe rects — and asks the running game for its own view of
the same numbers over `postMessage`. Its verdict line splits any shortfall into
*above the frame*, *below it*, and *outside the window*, which is the
difference between something the layout can fix and something the system owns.

Every game answers `{type:'arcade:spec?'}` with `{type:'arcade:spec', name,
win, doc, vv, stage, canvas, ins, fps, scale}`. Keep that contract when adding
a game; it costs 20 lines and it is how a viewport bug names itself.

Two corollaries that were learned the hard way:

- **Read the insets off resolved padding, not off the custom property.** A CSS
  variable holding `env(safe-area-inset-top)` does not reliably compute to px
  via `getPropertyValue`. Put the variable on a hidden probe element's
  `padding` and read `getComputedStyle(probe).paddingTop`.
- **Compare against the right axis.** An "unused pixels" readout that always
  compares height against `max(screen.width, screen.height)` reports a ~500px
  phantom gap in landscape. Pick the axis that matches the orientation.

---

## Render budget

Measured, on device, with everything on:

| | |
| --- | --- |
| Triangles | 45–80k sustains 60fps |
| Draw calls | ~20 sustains 60fps |
| Shadow map | one 1024² pass, PCF 3×3 |
| Extra full-scene pass | one (planar reflection at half res) is affordable |
| Bloom | bright-pass at ¼ res + 3 ping-pong blur pairs is affordable |
| Point lights | 8 in the shader loop, picked per frame by distance |

### Adaptive scaling must be driven by fps, not frame time

The obvious scaler watches frame time and drops resolution when it exceeds a
threshold. It does not work: vsync pins frame time at ~16.7ms, which sits
*between* a sensible drop threshold (21ms) and a sensible climb threshold
(13.5ms), so the scale falls once and can never climb back. Drive it off
measured fps instead — drop at `<= 48`, climb at `>= 57`, with a cooldown.

### The harness cannot judge feel

Local Playwright runs use SwiftShader and manage ~20–25fps regardless of what
the code does. It is good for catching exceptions, checking layout geometry,
and looking at a frame — it is worthless for judging frame rate or how movement
feels. Never report a performance conclusion from it. Get the number off the
phone's own diagnostics panel.

To inspect something in the harness that normally requires gameplay (a monster
standing still in front of the camera, a battle in progress), copy the game to
a scratch path, patch in a fixed pose or an entry point, screenshot it, and
delete the copy. Do not ship debug hooks.

---

## WebGL2 — the bugs that have actually happened

Each of these cost real time. They are listed in the order they bite.

**Feedback loop, `INVALID_OPERATION` (1282).** A texture bound to a sampler
while rendering *into* it errors even if the shader never samples it. Bind a
1×1 dummy texture during any pass that writes to a target the shader normally
reads.

**`transpose(inverse(mat3(model)))` in the vertex shader** is what lets
instanced geometry carry an arbitrary rotation. It is already there; arbitrary
limb orientation works because of it.

**Instance transforms silently produce nothing when a field is undefined.** A
rig helper that failed to copy one field (`hipR`) made every hip solve to NaN;
the instances were still counted in the draw and were invisible on screen. If
geometry is in the buffer but not on screen, dump the actual numbers before
theorising — a degenerate transform looks identical to "not drawn".

**Material flags must be exclusive ranges, not thresholds.** `mode > 2.5` for
one behaviour and `mode > 1.5` for another means mode 4 silently gets both.
Bracket them: `mode > 2.5 && mode < 3.5`.

**A light inside an object blows it to white.** Point attenuation is
`1/max(dot(d,d), 0.06)`, so anything within ~0.25m of a light is nuked. The
player's carried lantern sits inside the player's own body in third person.
Solve it with a material flag that skips light 0, not by dimming the lantern
(which would change the whole scene) and not by moving it (which changes where
the light comes from).

**Screen-space bump scatters a mirror.** Procedural normals from `fwidth`
derivatives look right on stone and destroy a planar reflection. Damp the
normal perturbation hard for the reflective material.

**Low-poly meshes for high-count instances.** A 560-triangle sphere used for
dust motes cost 24k triangles on its own. Keep a separate cheap mesh (a
`sphereMesh(6,4)` or `(10,7)`) for anything there are dozens of.

---

## Structure that every game here follows

- **One `#stage` element**, `position: fixed; top: 0; left: 0`, sized in JS.
  Everything else is `position: absolute` inside it. Re-measure on `resize`, on
  `visualViewport`'s `resize` and `scroll`, and on `orientationchange` — the
  last one several times over ~600ms, because Safari reports the pre-rotation
  size during the rotation.
- **Self-contained.** No CDNs, no ES modules, no build step. `localStorage` for
  saves. The launcher inlines every game into one file for the offline build,
  so a game that fetches anything breaks that build.
- **Settings sheet** capped with `max-height: 100%; overflow-y: auto`, closable
  by tapping the scrim, with a **Leave to Arcade** button that posts
  `{type:'arcade:exit'}`. That button is the *only* way out in fullscreen —
  the launcher deliberately shows no chrome of its own there — so a game that
  can enter fullscreen must always be able to open its settings.
- **Fullscreen contract:** the game posts `{type:'arcade:fullscreen', on}`. When
  framed and *not* fullscreen the launcher bar already absorbs the top inset,
  so the game must set its own `--safe-t` to `0px` or the strip is paid for
  twice.
- **On-screen controls reposition in landscape, they do not just shrink.** Both
  thumbs reach the bottom corners in either orientation.

---

## Saves on iPhone

Safari and the home-screen app are **two different storage worlds**: `localStorage`,
IndexedDB and cookies are not shared between them, so a save made in one is
invisible in the other. **Cache Storage is shared.** Thirst keeps its save in
both — `localStorage` as the primary, a `caches.open('thirst-save')` entry as
the mirror — and on load takes whichever carries the newer `savedAt`. It also
exports the whole save as a text "sigil" from its settings sheet, which is the
only route between two phones. Any game with progress worth keeping should do
the same; the mirror is twenty lines.

## Shipping

- `arcade/VERSION` is the single source for the on-screen build stamp *and* the
  service worker's `CACHE_VERSION`. Bump it on every change that should reach
  the phone, or the old build stays cached.
- **The worker is network-first with a 2.5s timeout, not plain network-first.**
  Offline was always fine — `fetch` rejects at once and the cache answers. The
  case that hurt was a *weak* signal, where a bare network-first blocks the
  launch until iOS times out tens of seconds later while a complete copy sits
  in the cache. The network now races a timer and whichever loses refreshes the
  cache in the background. This does not weaken the freshness guarantee: a new
  worker is fetched outside the fetch handler, so bumping `VERSION` still forces
  every phone onto the new build.
- `play/` and `arcade/games.json` are generated. CI rebuilds both on push;
  locally run `arcade/tools/build-index.py` then `arcade/tools/build-pwa.py`.
- Every path in `play/` must be relative. `build-pwa.py` fails the build if a
  non-relative path survives, because Pages serves from `/games/play/` where an
  absolute `/x` resolves to the domain root.
- The site root `/games/` is a forwarder to `/games/play/`; `404.html` forwards
  anything else. Pages advertises the root URL, so it cannot be left to 404.
- `main` is live. Confirm a deploy by fetching
  `https://mioutic.github.io/games/play/sw.js` and checking `CACHE_VERSION`.
