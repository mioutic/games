# test

Headless Playwright checks. They catch exceptions, measure layout and take
screenshots; they cannot judge frame rate or feel (SwiftShader manages ~25fps
whatever the code does), so perf numbers from here are relative only. The
real number is the game's own diagnostics readout on the phone.

```
cd test && npm install        # once. No `npx playwright install` needed: see below.
node audit.js                 # every game: stage 430x932, dpr, cover, arcade:spec answers
node sw.test.js               # service worker: network-first with a 2.5s timeout
node audio.test.js [slug]     # audio unlocks on a gesture; mute closes the master
node haptics.test.js          # buzz is gated by the switch
node thirst/pool.test.js      # upgrade pool never degrades to gold
node thirst/world.test.js     # collision, wall pockets, spawn placement, all maps
node thirst/path.test.js      # a foe behind a wall reaches the player
node thirst/probe.js          # a kiting bot plays ~3 min; level / kills / frame times
node thirst/maps.js           # overview PNG of each authored world + a play frame
node thirst/perf.js           # before/after p50; put the old build at thirst/out/before.html
```

Every suite opens its browser through `lib/browser.js`, which prefers the
system **Edge**, then Chrome, then Playwright's bundled Chromium. The bundled
build (1243, Playwright 1.63) crashes at the first page on this machine
whatever the flags; Edge is on every Windows 11 install and needs no download.
`PW_CHANNEL=chromium` forces the bundled one if that ever changes.

Outputs land in `out/` (ignored). To inspect something that needs play, the
pattern is: copy the game to a scratch path, splice a `window.__hook` at the
`/* ---------------- loop ---------------- */` anchor, drive it, screenshot,
never ship it. `thirst/probe.js` is the worked example. Thirst's move keys
are WASD.
