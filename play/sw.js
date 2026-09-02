// Bump CACHE_VERSION on EVERY update, or phones keep serving the old build.
// It is generated from arcade/VERSION — change that file and re-run
// arcade/tools/build-pwa.py, or edit both by hand if you are not regenerating.
const CACHE_VERSION = 'arcade-v1.23.0';

// Relative paths only: this worker is scoped to a Pages project subpath.
const SHELL = ['./', './index.html', './manifest.json', './icon-180.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// The refresh button asks a waiting worker to take over immediately.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Network first, but only for as long as a phone will actually wait.
//
// Being offline was never the problem: fetch rejects immediately and the cache
// answers. The bad case is a weak signal — a bar of service, a captive portal,
// a tunnel — where a plain network-first hangs the launch until iOS gives up
// tens of seconds later, with a complete copy of the app sitting in the cache
// the whole time. So the network races a short timer: whichever answers first
// is served, and the network keeps running either way to refresh the cache.
//
// Freshness still comes from CACHE_VERSION, not from this: a new worker is
// fetched outside the fetch handler, installs its own SHELL, and reloads the
// page. Serving a cached build for one launch cannot strand a phone on it.
const NET_TIMEOUT_MS = 2500;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  const network = fetch(req).then((res) => {
    if (res && res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
    }
    return res;
  });

  event.respondWith(
    // Matched inside this build's cache, not across all of them, so a version
    // still awaiting cleanup can never answer for the current one.
    caches.open(CACHE_VERSION)
      .then((cache) => cache.match(req))
      .then((hit) => {
        // Nothing cached: the network is the only answer there is, so wait.
        if (!hit) {
          return network.catch(() => {
            // A navigation that missed the cache still gets the app shell.
            if (req.mode === 'navigate') return caches.match('./index.html');
            return Response.error();
          });
        }
        // Cached: let the refresh finish regardless of which one we serve.
        event.waitUntil(network.catch(() => {}));
        return new Promise((resolve) => {
          const timer = setTimeout(() => resolve(hit), NET_TIMEOUT_MS);
          network.then(
            (res) => { clearTimeout(timer); resolve(res); },
            () => { clearTimeout(timer); resolve(hit); }
          );
        });
      })
  );
});
