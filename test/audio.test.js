// Sound cannot be judged by ear from here, so this checks what is checkable:
// that no AudioContext is built before a user gesture (one created early lands
// 'suspended' on iOS and never recovers), that the atmosphere actually runs,
// and that switching sound off pulls the master gain to zero rather than just
// flipping a label. Where a game has a bespoke cue driver, that cue is fired
// too. Timbre is the user's call, not this file's.
//
//   node test_audio.js [slug ...]
const { launch, devices } = require('./lib/browser');
const fs = require('fs');
const path = require('path');
const http = require('http');

const GAMES = path.join(__dirname, '..', 'arcade', 'games');
const ALL = ['barrow', 'covenant', 'curveball', 'ossuary', 'reliquary', 'set-piece', 'snake', 'reflex', 'thirst'];
const server = http.createServer((q, r) => {
  if (/favicon\.ico$/.test(q.url)) { r.writeHead(204); return r.end(); }   // Edge asks; answer with nothing, quietly
  const s = decodeURIComponent(q.url).replace(/^\/|\/$/g, '').split('/')[0];
  const f = path.join(GAMES, s, 'index.html');
  if (!fs.existsSync(f)) { r.writeHead(204); return r.end(); }
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end(fs.readFileSync(f));
});
const sleep = (m) => new Promise((r) => setTimeout(r, m));
let fail = 0;
const check = (n, c, g) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : `\n        got: ${JSON.stringify(g)}`}`); if (!c) fail++; };

const SPY = () => {
  window.__spy = { ctxs: 0, osc: 0, src: 0, started: 0, peak: 0,
                   state: () => null, master: () => null, firstGain: null };
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const oOsc = AC.prototype.createOscillator, oSrc = AC.prototype.createBufferSource,
        oGain = AC.prototype.createGain;
  const Ctor = function (...a) {
    const c = new AC(...a);
    window.__spy.ctxs++; window.__spy.state = () => c.state;
    return c;
  };
  Ctor.prototype = AC.prototype;
  AC.prototype.createOscillator = function () {
    const o = oOsc.call(this); window.__spy.osc++;
    const st = o.start.bind(o); o.start = (...x) => { window.__spy.started++; return st(...x); };
    return o;
  };
  AC.prototype.createBufferSource = function () {
    const s = oSrc.call(this); window.__spy.src++;
    const st = s.start.bind(s); s.start = (...x) => { window.__spy.started++; return st(...x); };
    return s;
  };
  AC.prototype.createGain = function () {
    const g = oGain.call(this);
    // The first gain a context builds is the master, and its value IS the mute.
    if (!window.__spy.firstGain) {
      window.__spy.firstGain = g;
      window.__spy.master = () => g.gain.value;
    }
    for (const m of ['exponentialRampToValueAtTime', 'linearRampToValueAtTime']) {
      const orig = g.gain[m].bind(g.gain);
      g.gain[m] = (v, t) => { window.__spy.peak = Math.max(window.__spy.peak, v); return orig(v, t); };
    }
    return g;
  };
  window.AudioContext = Ctor; window.webkitAudioContext = Ctor;
};

// Open settings without knowing each game's button id.
const OPEN_SETTINGS = async () => {
  const b = [...document.querySelectorAll('button')].filter((x) => x.offsetParent !== null)
    .find((x) => /settings/i.test((x.textContent || '') + ' ' + (x.getAttribute('aria-label') || '')));
  if (b) { b.click(); return true; }
  return false;
};

// Games with a cue that can be fired deliberately.
const DRIVERS = {
  'set-piece': async () => {
    // The shot handler ignores touches unless a run is live, so start one.
    const play = document.getElementById('btnPlay');
    if (play && play.offsetParent !== null) { play.click(); await new Promise((r) => setTimeout(r, 700)); }
    const d = window.__dbg;
    if (d) { d.state.phase = 'aim'; d.state.settle = 0; }
    const el = document.getElementById('stage');
    const W = innerWidth, H = innerHeight;
    const from = { x: W * 0.5, y: H * 0.86 }, to = { x: W * 0.5, y: H * 0.42 };
    const mk = (type, x, y) => {
      const t = new Touch({ identifier: 31, target: el, clientX: x, clientY: y });
      const e = type === 'touchend';
      return new TouchEvent(type, { touches: e ? [] : [t], targetTouches: e ? [] : [t],
        changedTouches: [t], bubbles: true, cancelable: true });
    };
    el.dispatchEvent(mk('touchstart', from.x, from.y));
    for (let i = 1; i <= 16; i++) {
      const q = i / 16;
      window.dispatchEvent(mk('touchmove', from.x + (to.x - from.x) * q, from.y + (to.y - from.y) * q));
      await new Promise((r) => requestAnimationFrame(r));
    }
    window.dispatchEvent(mk('touchend', to.x, to.y));
    await new Promise((r) => setTimeout(r, 250));
  },
};

(async () => {
  await new Promise((r) => server.listen(0, r));
  const slugs = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
  const browser = await launch();

  for (const slug of slugs) {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2,
      isMobile: true, hasTouch: true, userAgent: devices['iPhone 13 Pro'].userAgent });
    await ctx.addInitScript(SPY);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    console.log(`\n=== ${slug} ===`);
    await page.goto(`http://127.0.0.1:${server.address().port}/${slug}/`, { waitUntil: 'load' });
    await sleep(1100);

    const cold = await page.evaluate(() => window.__spy.ctxs);
    check('no AudioContext built before any gesture', cold === 0, cold);

    await page.touchscreen.tap(215, 300);
    await sleep(500);
    const warm = await page.evaluate(() => ({ ctxs: window.__spy.ctxs, state: window.__spy.state(),
                                              osc: window.__spy.osc, master: window.__spy.master() }));
    check('the first touch builds a running context', warm.ctxs >= 1 && warm.state === 'running', warm);
    // Most games start their atmosphere on the first touch, so it is already
    // there on the menu. Thirst runs its own richer Snd — a compressor, and
    // separate ambient()/music() channels with their own toggle — and starts
    // ambience when a run begins instead. That is a choice, not a gap, so the
    // menu-bed check does not apply to it.
    if (slug !== 'thirst') check('the room starts breathing', warm.osc >= 2, warm);
    else console.log('  SKIP  menu bed — Thirst starts ambience at run start by design');
    check('master is open', warm.master > 0.5, warm);

    if (DRIVERS[slug]) {
      const b4 = await page.evaluate(() => ({ s: window.__spy.started, p: window.__spy.peak }));
      await page.evaluate(DRIVERS[slug]);
      await sleep(250);
      const af = await page.evaluate(() => ({ s: window.__spy.started, p: window.__spy.peak }));
      check('a real cue starts nodes with an audible envelope',
            af.s > b4.s && af.p > 0.02, { b4, af });
    }

    const off = await page.evaluate(async (open) => {
      const fn = new Function('return (' + open + ')')();
      await fn();
      await new Promise((r) => setTimeout(r, 300));
      const sw = document.getElementById('swSound');
      if (!sw) return { noSwitch: true };
      const was = sw.getAttribute('aria-checked');
      sw.click();
      await new Promise((r) => setTimeout(r, 450));
      return { was, now: sw.getAttribute('aria-checked'), master: window.__spy.master() };
    }, OPEN_SETTINGS.toString());
    check('the switch flips off', !off.noSwitch && off.was === 'true' && off.now === 'false', off);
    check('and the master gain actually closes', off.master !== null && off.master < 0.05, off);

    const on = await page.evaluate(async () => {
      const sw = document.getElementById('swSound');
      const n0 = window.__spy.started;
      sw.click();
      await new Promise((r) => setTimeout(r, 450));
      return { n0, n1: window.__spy.started, master: window.__spy.master(),
               checked: sw.getAttribute('aria-checked') };
    });
    check('back on reopens the master', on.checked === 'true' && on.master > 0.5, on);
    check('and confirms itself audibly', on.n1 > on.n0, on);

    if (errors.length) { console.log('  ERRORS: ' + [...new Set(errors)].slice(0, 3).join(' | ')); fail += errors.length; }
    await ctx.close();
  }

  console.log(fail ? `\n${fail} FAILED\n` : '\nALL PASS\n');
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
