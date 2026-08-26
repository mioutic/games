// Service worker behaviour, checked against a fake network and cache.
//
//     node test/sw.test.js          (no dependencies, run it after build-pwa.py)
//
// This is not the Playwright harness — it needs no browser. It pins the two
// properties the arcade actually depends on: a weak signal must never hang the
// launch when a cached copy exists, and bumping arcade/VERSION must still force
// every phone onto the new build.
//
// The timeout is rewritten to 60ms so the suite runs fast; the logic is unchanged.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SW_PATH = path.join(__dirname, '..', 'play', 'sw.js');
const TIMEOUT = 60;
const ORIGIN = 'https://mioutic.github.io';
// Read the cache name out of the worker rather than hard-coding it, so bumping
// arcade/VERSION never fails this suite for the wrong reason.
const CACHE = (fs.readFileSync(SW_PATH, 'utf8').match(/CACHE_VERSION = '([^']+)'/) || [])[1];
if (!CACHE) throw new Error('CACHE_VERSION not found in sw.js');
const OLDER = 'arcade-vOLD';   // any cache name that is not the current one

class Res {
  constructor(tag, { ok = true, type = 'basic' } = {}) {
    this.tag = tag; this.ok = ok; this.type = type;
  }
  clone() { return new Res(this.tag, { ok: this.ok, type: this.type }); }
}

function makeCaches() {
  const stores = new Map();
  const cacheFor = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      match: (req) => Promise.resolve(m.get(String(req.url)) || undefined),
      put: (req, res) => { m.set(String(req.url), res); return Promise.resolve(); },
      addAll: (urls) => { urls.forEach((u) => m.set(new URL(u, ORIGIN + '/games/play/').href,
                                                    new Res('shell:' + u))); return Promise.resolve(); },
    };
  };
  return {
    _stores: stores,
    open: (n) => Promise.resolve(cacheFor(n)),
    keys: () => Promise.resolve([...stores.keys()]),
    delete: (n) => { stores.delete(n); return Promise.resolve(true); },
    match: (req) => {
      for (const m of stores.values()) {
        const hit = m.get(String(req.url ?? req)) ||
                    m.get(new URL(String(req.url ?? req), ORIGIN + '/games/play/').href);
        if (hit) return Promise.resolve(hit);
      }
      return Promise.resolve(undefined);
    },
  };
}

function loadSW(fetchImpl) {
  let src = fs.readFileSync(SW_PATH, 'utf8');
  src = src.replace(/const NET_TIMEOUT_MS = \d+;/, `const NET_TIMEOUT_MS = ${TIMEOUT};`);
  if (!/const NET_TIMEOUT_MS = \d+;/.test(fs.readFileSync(SW_PATH, 'utf8'))) {
    throw new Error('NET_TIMEOUT_MS not found in sw.js');
  }
  const listeners = {};
  const caches = makeCaches();
  const self = {
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    location: { origin: ORIGIN },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };
  const ctx = {
    self, caches, fetch: fetchImpl, URL, Response: { error: () => new Res('ERROR', { ok: false }) },
    setTimeout, clearTimeout, Promise, console,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { listeners, caches, self };
}

function fire(listeners, request) {
  const ev = { request, _res: null, _waits: [] };
  ev.respondWith = (p) => { ev._res = p; };
  ev.waitUntil = (p) => { ev._waits.push(p); };
  listeners.fetch.forEach((fn) => fn(ev));
  return ev;
}

const req = (url, { method = 'GET', mode = 'navigate' } = {}) => ({ url, method, mode });
const delay = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
const PAGE = ORIGIN + '/games/play/index.html';

let fail = 0;
const check = (name, cond, got) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `\n        got: ${JSON.stringify(got)}`}`);
  if (!cond) fail++;
};

(async () => {
  // ── install populates the shell ────────────────────────────────────────────
  console.log('\n[install] shell is cached under the versioned key');
  {
    const { listeners, caches } = loadSW(() => Promise.resolve(new Res('net')));
    const ev = { waitUntil: (p) => { ev._p = p; } };
    listeners.install.forEach((fn) => fn(ev));
    await ev._p;
    const names = await caches.keys();
    check('one versioned cache created', names.length === 1 && /^arcade-v/.test(names[0]), names);
  }

  // ── the case this change exists for ───────────────────────────────────────
  console.log('\n[A] weak signal + a cached copy  (the launch hang)');
  {
    const { listeners, caches } = loadSW(() => delay(3000, new Res('net')));
    const c = await caches.open((await caches.keys())[0] || CACHE);
    await c.put(req(PAGE), new Res('cached'));
    const t0 = Date.now();
    const out = await fire(listeners, req(PAGE))._res;
    const dt = Date.now() - t0;
    check('served the cached copy', out.tag === 'cached', out.tag);
    check(`did not wait for the network (${dt}ms < 3000ms)`, dt < 500, dt);
    check('gave the network its head start first', dt >= TIMEOUT - 15, dt);
  }

  console.log('\n[B] good signal + a cached copy');
  {
    const { listeners, caches } = loadSW(() => delay(5, new Res('net')));
    const c = await caches.open(CACHE);
    await c.put(req(PAGE), new Res('cached'));
    const out = await fire(listeners, req(PAGE))._res;
    check('fresh copy wins the race', out.tag === 'net', out.tag);
  }

  console.log('\n[C] fully offline + a cached copy');
  {
    const { listeners, caches } = loadSW(() => Promise.reject(new Error('offline')));
    const c = await caches.open(CACHE);
    await c.put(req(PAGE), new Res('cached'));
    const t0 = Date.now();
    const out = await fire(listeners, req(PAGE))._res;
    const dt = Date.now() - t0;
    check('served the cached copy', out.tag === 'cached', out.tag);
    check(`answered at once, not after the timeout (${dt}ms)`, dt < TIMEOUT, dt);
  }

  console.log('\n[D] nothing cached  (first ever launch)');
  {
    const { listeners } = loadSW(() => delay(200, new Res('net')));
    const out = await fire(listeners, req(PAGE))._res;
    check('waits for the network however long it takes', out.tag === 'net', out.tag);
  }
  {
    const { listeners, caches } = loadSW(() => delay(5, new Res('net')));
    const ev = fire(listeners, req(PAGE));
    await ev._res;
    await delay(20);
    const c = await caches.open(CACHE);
    check('and the response is cached for next time',
          (await c.match(req(PAGE)))?.tag === 'net');
  }

  console.log('\n[E] offline with an empty cache');
  {
    const { listeners, caches } = loadSW(() => Promise.reject(new Error('offline')));
    const ev = { waitUntil: (p) => { ev._p = p; } };
    listeners.install.forEach((fn) => fn(ev));
    await ev._p;                                     // shell present, this URL is not
    const out = await fire(listeners, req(ORIGIN + '/games/play/deep/link'))._res;
    check('a navigation still falls back to the app shell',
          typeof out?.tag === 'string' && out.tag.includes('index.html'), out && out.tag);
  }
  {
    const { listeners } = loadSW(() => Promise.reject(new Error('offline')));
    const out = await fire(listeners, req(ORIGIN + '/games/play/x.png', { mode: 'no-cors' }))._res;
    check('a non-navigation errors rather than hanging', out.tag === 'ERROR', out.tag);
  }

  console.log('\n[F] requests the worker must not touch');
  {
    const { listeners } = loadSW(() => Promise.resolve(new Res('net')));
    check('POST is passed through', fire(listeners, req(PAGE, { method: 'POST' }))._res === null);
    check('cross-origin is passed through',
          fire(listeners, req('https://elsewhere.test/a.js'))._res === null);
  }

  // ── the freshness guarantee the arcade depends on ─────────────────────────
  console.log('\n[G] a version bump still evicts the old build');
  {
    const { listeners, caches } = loadSW(() => Promise.resolve(new Res('net')));
    (await caches.open(OLDER)).put(req(PAGE), new Res('stale'));
    const ev = { waitUntil: (p) => { ev._p = p; } };
    listeners.activate.forEach((fn) => fn(ev));
    await ev._p;
    check('old caches deleted on activate', !(await caches.keys()).includes(OLDER),
          await caches.keys());

    const c = await caches.open(CACHE);
    await c.put(req(PAGE), new Res('current'));
    (await caches.open(OLDER)).put(req(PAGE), new Res('stale'));
    const out = await fire(listeners, req(PAGE))._res;
    check('a leftover cache can never answer for the current build',
          out.tag !== 'stale', out.tag);
  }

  console.log(fail ? `\n${fail} FAILED\n` : '\nALL PASS\n');
  process.exit(fail ? 1 : 0);
})();
