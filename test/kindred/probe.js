// Kindred probe: does a life hold together, does the village keep itself
// alive, and does the voice fire only for people near the player?
//
//   node kindred/probe.js            # mock voice (no server needed)
//   node kindred/probe.js --live URL # the real /api/brain at URL (e.g. http://127.0.0.1:8124)
//
// A scratch copy with a hook spliced in at the "go" anchor (PLATFORM.md);
// the hook is never shipped. Screenshots land in kindred/out/.
const { launch, devices } = require('../lib/browser');
const fs = require('fs');
const path = require('path');
const http = require('http');

const SRC = path.join(__dirname, '..', '..', 'arcade', 'games', 'kindred', 'index.html');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const liveIx = process.argv.indexOf('--live');
const LIVE = liveIx > 0 ? process.argv[liveIx + 1] : null;

let src = fs.readFileSync(SRC, 'utf8');
const anchor = '  /* ---------------- go ---------------- */';
if (src.split(anchor).length !== 2) throw new Error('go anchor missing');
src = src.replace(anchor, `
  window.__k = {
    W: function () { return W; }, me: function () { return me; },
    living: function () { return living(); }, age: ageOf, cap: capOf, say: say, Mind: Mind, apply: apply,
    hearth: function () { var h = hearth(); return h ? h.o.id : null; },
    step: function (secs) { for (var t = 0; t < secs; t += 0.1) simStep(0.1); },
    keepFed: function () { me.food = capOf(me); }
  };
` + anchor);
fs.writeFileSync(path.join(OUT, 'index.html'), src);

const server = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end(fs.readFileSync(path.join(OUT, 'index.html')));
});
const sleep = (m) => new Promise((r) => setTimeout(r, m));

(async () => {
  await new Promise((r) => server.listen(0, r));
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, userAgent: devices['iPhone 13 Pro'].userAgent });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const scenes = [];
  await page.route('**/api/brain**', async (route) => {
    const req = route.request();
    if (LIVE) {
      const u = LIVE + new URL(req.url()).pathname;
      let rec = null;
      if (req.method() === 'POST' && !req.url().endsWith('/warm')) { rec = { scene: JSON.parse(req.postData()).scene, reply: '(pending)', t0: Date.now() }; scenes.push(rec); }
      const res = await fetch(u, { method: req.method(), headers: { 'Content-Type': 'application/json' }, body: req.method() === 'POST' ? req.postData() : undefined });
      const body = await res.text();
      if (rec) { rec.reply = body; rec.ms = Date.now() - rec.t0; }
      return route.fulfill({ status: res.status, contentType: 'application/json', body });
    }
    if (req.method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, binary: true, model: 'mock' }) });
    if (req.url().endsWith('/warm')) return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
    const d = JSON.parse(req.postData());
    const names = [...d.scene.matchAll(/^- ([A-Z]+) /gm)].map((m) => m[1]);
    scenes.push({ scene: d.scene, names });
    const lines = names.length ? [{ who: names[0], say: /not yet named/.test(d.scene) ? 'YOU ARE TESSA' : 'I HEAR YOU', do: 'none' }] : [];
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, text: JSON.stringify({ lines }), model: 'mock' }) });
  });

  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'load' });
  await sleep(800);
  await page.screenshot({ path: path.join(OUT, '0-intro.png') });
  await page.click('#btnPlay');
  await sleep(LIVE ? 8000 : 4500);       // the birth event should reach the voice
  const born = await page.evaluate(() => {
    const k = window.__k, me = k.me(), mom = k.W().people.find((p) => p.id === me.mother);
    return { age: k.age(me), carried: !!me.carriedBy, name: me.name, mother: mom && mom.name, living: k.living().length, hearth: k.hearth() };
  });
  await page.screenshot({ path: path.join(OUT, '1-born.png') });
  console.log('born:', JSON.stringify(born));
  console.log('scenes after birth:', scenes.length, scenes[0] ? '\n--- first scene ---\n' + scenes[0].scene + '\n--- reply ---\n' + (scenes[0].reply || JSON.stringify(scenes[0].names)) : '');

  // The baby speaks: F. A scene should go out within a few seconds, carrying it.
  const before = scenes.length;
  await page.evaluate(() => { const k = window.__k; const t = k.say(k.me(), 'F'); k.Mind.playerSaid(t); });
  await sleep(LIVE ? 7000 : 4000);
  const fScene = scenes.slice(before).find((s) => /said: "F"/.test(s.scene));
  console.log('F reached the voice:', !!fScene, fScene && fScene.reply ? '\n  reply: ' + fScene.reply.slice(0, 300) : '');

  // Two years pass. The mother should keep the baby alive.
  await page.evaluate(() => window.__k.step(130));
  const two = await page.evaluate(() => { const k = window.__k, me = k.me(); return { alive: me.alive, age: +k.age(me).toFixed(1), food: me.food, cap: k.cap(me), name: me.name }; });
  console.log('after 130s:', JSON.stringify(two));

  // Far from everyone: no calls at all.
  await page.evaluate(() => { const k = window.__k, me = k.me(); if (me.carriedBy) { const h = k.W().people.find((p) => p.id === me.carriedBy); h.carry = 0; me.carriedBy = 0; } me.x = 5.5; me.y = 5.5; me.path = null; me.pending = null; });
  const farBefore = scenes.length;
  await page.evaluate(() => { const k = window.__k; k.say(k.me(), 'HI'); k.Mind.playerSaid('HI'); });
  await sleep(5000);
  console.log('calls while alone (want 0):', scenes.length - farBefore);

  // The village on its own for fifteen minutes of village time, player kept alive and away.
  const village = await page.evaluate(() => {
    const k = window.__k, W = k.W(), snaps = [];
    for (let m = 0; m < 15; m++) {
      for (let s = 0; s < 6; s++) { k.keepFed(); k.step(10); }
      const l = k.living().filter((p) => p !== k.me());
      snaps.push({ min: m + 1, pop: l.length, hungry: l.filter((p) => p.food <= 3).length, hearth: k.hearth(),
                   jobs: l.map((p) => p.job ? p.job.kind : p.carry ? 'carry' : p.working ? 'relight' : '-').join(',') });
    }
    return { snaps, lives: W.lives.map((x) => x.name + ' ' + x.age + 'y ' + x.cause) };
  });
  village.snaps.forEach((s) => console.log('  min', String(s.min).padStart(2), 'pop', s.pop, 'hungry', s.hungry, 'hearth', s.hearth, '|', s.jobs));
  console.log('deaths:', village.lives.length ? village.lives.join('; ') : 'none');

  // Back by the fire, at night, for a look.
  await page.evaluate(() => { const k = window.__k, W = k.W(), me = k.me(); me.x = W.camp.x + 1.5; me.y = W.camp.y + 2.5; W.T = Math.ceil(W.T / 360) * 360 + 180; });
  await sleep(1500);
  await page.screenshot({ path: path.join(OUT, '2-night-hearth.png') });
  await page.evaluate(() => { const W = window.__k.W(); W.T += 180; });
  await sleep(800);
  await page.screenshot({ path: path.join(OUT, '3-day-hearth.png') });

  // Landscape: the HUD and buttons must still fit.
  await page.setViewportSize({ width: 932, height: 430 });
  await sleep(900);
  const land = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => {
    const q = b.getBoundingClientRect(); return b.offsetParent !== null && q.width > 0 && (q.right > innerWidth + 1 || q.bottom > innerHeight + 1); }).map((b) => b.id));
  await page.screenshot({ path: path.join(OUT, '4-landscape.png') });
  console.log('landscape offscreen buttons:', land.length ? land.join(',') : 'none');

  console.log('total voice calls:', scenes.length);
  if (LIVE) scenes.forEach((x, i) => {
    let t = x.reply; try { t = JSON.parse(x.reply).text || x.reply; } catch (e) {}
    const ev = (x.scene.split('Just now:')[1] || '').split('\n\n')[0].trim().replace(/\n/g, ' / ');
    console.log('#' + i, (x.ms || '?') + 'ms', '| event:', ev.slice(0, 120), '\n    ->', String(t).replace(/\s+/g, ' ').slice(0, 260));
  });
  console.log('errors:', errors.length ? errors.join('\n') : 'none');
  await browser.close(); server.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
