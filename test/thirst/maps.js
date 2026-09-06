// For each map: an overview of the whole authored world (painted once at
// quarter scale) and a gameplay frame a few seconds in. Scratch copy with an
// entry hook, per PLATFORM.md; never shipped.
const { launch, devices } = require('../lib/browser');
const fs = require('fs'), path = require('path'), http = require('http');
fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
const sleep = (m) => new Promise((r) => setTimeout(r, m));
const SRC = path.join(__dirname, '..', '..', 'arcade', 'games', 'thirst', 'index.html');
let src = fs.readFileSync(SRC, 'utf8');
const anchor = '  /* ---------------- loop ---------------- */';
if (!src.includes(anchor)) throw new Error('anchor');
src = src.replace(anchor, `  window.__go = function (m) { meta.maps[m] = 1; paintHub(); };
  window.__overview = function (id) { var w = worldFor(id), S = 0.28, c = document.createElement('canvas'); c.width = Math.ceil(w.w*S); c.height = Math.ceil(w.h*S);
    var q = c.getContext('2d'); q.scale(S, S); q.fillStyle = '#050203'; q.fillRect(0, 0, w.w, w.h); paintWorld(q, w, 0, 0, w.w, w.h);
    q.strokeStyle = '#e9d8c5'; q.lineWidth = 6; q.strokeRect(0, 0, w.w, w.h);
    q.fillStyle = '#ff5470'; q.beginPath(); q.arc(w.start.x, w.start.y, 18, 0, 6.283); q.fill();
    return { data: c.toDataURL('image/png'), w: c.width, h: c.height, solids: w.solids.length, props: w.props.length, lights: w.lights.length }; };
  window.__keys = function () { return keys; }; window.__st = function () { return { x: Math.round(P.x), y: Math.round(P.y), foes: foes.length, cam: [Math.round(camX), Math.round(camY)], run: !!run && !run.over }; };
` + anchor);
fs.writeFileSync(path.join(__dirname, 'out', 'thirst-maps.html'), src);
(async () => {
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(path.join(__dirname, 'out', 'thirst-maps.html'))); });
  await new Promise((r) => srv.listen(0, r));
  const b = await launch();
  for (const id of ['street', 'nave', 'undercity']) {
    const c = await b.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices['iPhone 13 Pro'].userAgent });
    const p = await c.newPage(); const errs = new Set(); p.on('pageerror', (e) => errs.add((e.stack || e.message).split('\n').slice(0, 3).join(' | ')));
    await p.goto(`http://127.0.0.1:${srv.address().port}/`, { waitUntil: 'load' }); await sleep(1200);
    await p.touchscreen.tap(215, 400); await sleep(200);
    const ov = await p.evaluate((id) => window.__overview(id), id);
    fs.writeFileSync(path.join(__dirname, 'out', `map-${id}.png`), Buffer.from(ov.data.split(',')[1], 'base64'));
    await p.evaluate((id) => window.__go(id), id); await sleep(300);
    await p.click('.map[data-id="' + id + '"]'); await sleep(200); await p.click('#bHunt'); await sleep(1400);
    // Walk a little so collision and the camera clamp get exercised.
    const st0 = await p.evaluate(() => window.__st());
    await p.evaluate(() => { window.__keys().a = true; }); await sleep(2500); await p.evaluate(() => { window.__keys().a = false; window.__keys().w = true; }); await sleep(2500); await p.evaluate(() => { window.__keys().w = false; });
    console.log('   walked from', JSON.stringify([st0.x, st0.y]));
    const st = await p.evaluate(() => window.__st());
    await p.screenshot({ path: path.join(__dirname, 'out', `play-${id}.png`) });
    console.log(id.padEnd(10), 'overview', ov.w + 'x' + ov.h, 'solids', ov.solids, 'props', ov.props, 'lights', ov.lights, '| play', JSON.stringify(st), '| errors:', errs.size ? [...errs].join(' || ') : 'none');
    await c.close();
  }
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
