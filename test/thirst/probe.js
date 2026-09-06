// Baseline + regression probe for Thirst.
//
// Absolute fps from SwiftShader is meaningless (PLATFORM.md says so plainly).
// What IS meaningful is the SAME harness on the SAME machine before and after a
// change: entity counts, frame-time distribution and allocation pressure are
// comparable across runs even when the absolute numbers are not device numbers.
//
//   node probe_thirst.js [outfile.json]
const { launch, devices } = require('../lib/browser');
const fs = require('fs');
const path = require('path');
const http = require('http');

const SRC = path.join(__dirname, '..', '..', 'arcade', 'games', 'thirst', 'index.html');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

// A scratch copy with an entry point patched in, per PLATFORM.md. Never shipped.
let src = fs.readFileSync(SRC, 'utf8');
const anchor = '  /* ---------------- loop ---------------- */';
if (!src.includes(anchor)) throw new Error('loop anchor missing');
src = src.replace(anchor,
  '  window.__t = {\n' +
  '    run: function () { return run; }, P: function () { return P; },\n' +
  '    ents: function () { return { foes: foes.length, shots: shots.length, motes: motes.length,\n' +
  '      parts: parts.length, nums: nums.length, zones: zones.length, hazards: hazards.length,\n' +
  '      decals: decals.length }; },\n' +
  '    meta: function () { return meta; },\n' +
  '    start: function (c, m) { selChar = c || selChar; selMap = m || selMap; startRunNow(false); },\n' +
  '    warp: function (secs) { if (run) { run.t += secs; run.min = Math.floor(run.t / 60); } },\n' +
  '    lv: function (n) { if (run) { pendingLevels += n; } },\n' +
  '    keys: function () { return keys; },\n' +
  '    flee: function () {\n' +
  '      var dx = 0, dy = 0, n = 0;\n' +
  '      for (var i = 0; i < foes.length; i++) { var f = foes[i]; if (f.dead) continue;\n' +
  '        var ax = P.x - f.x, ay = P.y - f.y, d2 = ax*ax + ay*ay;\n' +
  '        if (d2 > 40000 || d2 < 1) continue;\n' +
  '        var w = 1 / d2; dx += ax * w; dy += ay * w; n++; }\n' +
  '      var m = Math.hypot(dx, dy);\n' +
  '      return n && m > 0 ? { x: dx/m, y: dy/m, n: n } : { x: 0, y: 0, n: 0 };\n' +
  '    },\n' +
  '  };\n' + anchor);
fs.writeFileSync(path.join(OUT, 'index.html'), src);

const server = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end(fs.readFileSync(path.join(OUT, 'index.html')));
});
const sleep = (m) => new Promise((r) => setTimeout(r, m));

(async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, userAgent: devices['iPhone 13 Pro'].userAgent });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(url, { waitUntil: 'load' });
  await sleep(1600);
  await page.touchscreen.tap(215, 400);          // unlock audio the way a player would
  await sleep(300);

  const boot = await page.evaluate(() => ({
    hasHook: !!window.__t,
    stage: (() => { const s = document.getElementById('stage').getBoundingClientRect();
                    return Math.round(s.width) + 'x' + Math.round(s.height); })(),
    canvas: (() => { const c = document.querySelector('canvas'); return c ? c.width + 'x' + c.height : null; })(),
  }));

  // Start a run, then sample the game at a series of elapsed times.
  await page.evaluate(() => window.__t.start());
  await sleep(1500);

  // An in-page kiting bot, at frame rate: steer away from the weighted centroid
  // of nearby foes and answer every sheet the run puts up. A level-up pauses the
  // sim until something picks, so the run only advances if both halves work.
  await page.evaluate(() => {
    const K = window.__t.keys();
    const clear = () => { K.a = K.d = K.w = K.s = false; };
    window.__auto = setInterval(() => {
      const pick = document.querySelector('#levelup button.pick');
      if (pick && pick.offsetParent !== null) { pick.click(); return; }
      const ok = document.getElementById('bChestOk');
      if (ok && ok.offsetParent !== null && !ok.disabled) { ok.click(); return; }
      const res = document.getElementById('bResume');
      if (res && res.offsetParent !== null) { res.click(); return; }
      const f = window.__t.flee();
      clear();
      if (!f.n) { K.d = true; return; }
      if (f.x > 0.35) K.d = true; else if (f.x < -0.35) K.a = true;
      if (f.y > 0.35) K.s = true; else if (f.y < -0.35) K.w = true;
    }, 60);
  });

  const marks = [];
  for (const target of [30, 75, 135, 210]) {
    // Real elapsed play, not a warped clock: the sim only advances with frames.
    for (let guard = 0; guard < 400; guard++) {
      const r = await page.evaluate(() => { const r = window.__t.run(); return r ? { t: r.t, over: r.over } : null; });
      if (!r || r.over || r.t >= target) break;
      await sleep(500);
    }

    const sample = await page.evaluate(async () => {
      // Frame-time distribution over ~90 frames, plus peak entity load.
      const ts = [];
      let peak = null;
      await new Promise((res) => {
        let last = performance.now(), n = 0;
        const tick = () => {
          const now = performance.now();
          ts.push(now - last); last = now;
          const e = window.__t.ents();
          const tot = Object.values(e).reduce((a, b) => a + b, 0);
          if (!peak || tot > peak._tot) { peak = { ...e, _tot: tot }; }
          if (++n >= 90) return res();
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      ts.sort((a, b) => a - b);
      const r = window.__t.run(), P = window.__t.P();
      return {
        t: r ? Math.round(r.t) : null, min: r ? r.min : null, lv: r ? r.lv : null,
        kills: r ? r.kills : null, over: r ? r.over : null,
        hp: P ? Math.round(P.hp) : null, weapons: P ? P.weapons.length : null,
        ents: peak,
        frameMs: { p50: +ts[45].toFixed(2), p90: +ts[81].toFixed(2), p99: +ts[89].toFixed(2) },
        mem: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      };
    });
    marks.push({ target, ...sample });
    console.log(`  t=${String(sample.t).padStart(3)}s  lv=${String(sample.lv).padStart(2)}  ` +
                `kills=${String(sample.kills).padStart(4)}  hp=${String(sample.hp).padStart(4)}  ` +
                `ents=${sample.ents ? sample.ents._tot : '?'} (foes ${sample.ents ? sample.ents.foes : '?'})  ` +
                `frame p50/p90/p99 = ${sample.frameMs.p50}/${sample.frameMs.p90}/${sample.frameMs.p99}ms` +
                (sample.mem ? `  heap ${sample.mem}MB` : ''));
    if (target === 300) await page.screenshot({ path: path.join(__dirname, 'out', 'thirst-t300.png') });
    if (sample.over) { console.log('  (run ended)'); break; }
  }

  const out = { boot, marks, errors: [...new Set(errors)] };
  const file = process.argv[2] || path.join(__dirname, 'out', 'thirst-baseline.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  console.log('\nboot:', JSON.stringify(boot));
  if (out.errors.length) console.log('ERRORS:\n  ' + out.errors.slice(0, 6).join('\n  '));
  else console.log('no runtime errors');
  console.log('wrote', file);

  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
