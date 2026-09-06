// Every game, framed the way the launcher frames it on the phone: does the
// stage cover 430x932, is dpr capped at 2, does the canvas match, and does the
// game answer the launcher's {type:'arcade:spec?'} question (PLATFORM.md).
//
//   node audit.js [slug ...]
const { launch, devices } = require('./lib/browser');
const path = require('path');
const fs = require('fs');
const http = require('http');

const GAMES = path.join(__dirname, '..', 'arcade', 'games');
const ALL = fs.readdirSync(GAMES).filter((s) => fs.existsSync(path.join(GAMES, s, 'index.html')));
const sleep = (m) => new Promise((r) => setTimeout(r, m));

const server = http.createServer((q, r) => {
  const s = decodeURIComponent(q.url).replace(/^\/|\/$/g, '').split('/')[0];
  const f = path.join(GAMES, s, 'index.html');
  if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(f));
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const slugs = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
  const browser = await launch();
  const rows = [];
  let fail = 0;
  for (const slug of slugs) {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2,
      isMobile: true, hasTouch: true, userAgent: devices['iPhone 13 Pro'].userAgent });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // Ask the launcher's question from the parent side by posting to the page
    // itself: games answer to window.parent, which is the page when unframed.
    await page.addInitScript(() => {
      window.__spec = null;
      window.addEventListener('message', (e) => { if (e.data && e.data.type === 'arcade:spec') window.__spec = e.data; });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/${slug}/`, { waitUntil: 'load' });
    await sleep(1400);
    await page.touchscreen.tap(215, 300);
    await sleep(400);
    const r = await page.evaluate(async () => {
      window.postMessage({ type: 'arcade:spec?' }, '*');
      await new Promise((res) => setTimeout(res, 300));
      const st = document.getElementById('stage');
      const sr = st ? st.getBoundingClientRect() : null;
      const cv = document.querySelector('canvas');
      const offscreen = [...document.querySelectorAll('button')].filter((b) => {
        const q = b.getBoundingClientRect(); return b.offsetParent !== null && q.width > 0 && (q.right > innerWidth + 1 || q.bottom > innerHeight + 1 || q.left < -1 || q.top < -1); }).map((b) => b.id || b.textContent.trim().slice(0, 14));
      return {
        stage: sr ? Math.round(sr.width) + 'x' + Math.round(sr.height) : '-',
        cover: sr ? +((sr.width * sr.height) / (innerWidth * innerHeight)).toFixed(2) : '-',
        canvas: cv ? cv.width + 'x' + cv.height : '-',
        dpr: cv ? +(cv.width / innerWidth).toFixed(1) : '-',
        spec: window.__spec ? window.__spec.name : null,
        offscreen,
      };
    });
    const issues = [];
    if (r.stage !== '430x932') issues.push('stage ' + r.stage);
    if (r.dpr !== '-' && r.dpr > 2.05) issues.push('dpr ' + r.dpr);
    if (!r.spec) issues.push('no arcade:spec answer');
    if (r.offscreen.length) issues.push('offscreen: ' + r.offscreen.join(','));
    if (errors.length) issues.push('errors: ' + errors[0].slice(0, 60));
    if (issues.length) fail++;
    rows.push([slug, r.stage, r.canvas, r.dpr, r.cover, r.spec || '-', issues.length ? issues.join('; ') : 'ok']);
    await ctx.close();
  }
  const w = [11, 9, 10, 4, 6, 10];
  console.log(['GAME', 'stage', 'canvas', 'dpr', 'cover', 'spec', 'issues'].map((h, i) => (w[i] ? h.padEnd(w[i]) : h)).join(' '));
  rows.forEach((row) => console.log(row.map((c, i) => (w[i] ? String(c).padEnd(w[i]) : c)).join(' ')));
  console.log(fail ? `\n${fail} game(s) with issues` : '\nall clean');
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
