#!/usr/bin/env python3
"""Emit ../../play/ — the installable, self-contained GitHub Pages build.

Four files, all static, no build step needed to host them:

    play/index.html     launcher + every game inlined
    play/manifest.json
    play/sw.js
    play/icon-180.png

Regenerate after changing anything under arcade/:

    python3 arcade/tools/build-index.py
    python3 arcade/tools/build-pwa.py

The version stamped into the page and into the service worker's CACHE_VERSION
both come from arcade/VERSION, so they can never drift apart. Bump that one
file to ship an update.

Every emitted path is relative ("./x"), because Pages serves this from a
project subpath (/games/play/), where an absolute "/x" would resolve to the
domain root and 404.
"""

import json
import os
import re
import shutil
import sys
from urllib.parse import quote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # arcade/
REPO = os.path.dirname(ROOT)
OUT = os.path.join(REPO, "play")


def read(*parts):
    with open(os.path.join(*parts)) as f:
        return f.read()


def sub_once(text, old, new, what):
    """Replace exactly once, and fail loudly if the anchor moved."""
    if text.count(old) != 1:
        sys.exit("build-pwa: expected exactly one %s in index.html, found %d"
                 % (what, text.count(old)))
    return text.replace(old, new, 1)


def build_index(version):
    games = json.loads(read(ROOT, "games.json"))["games"]
    html = {}
    for g in games:
        html[g["slug"]] = read(ROOT, "games", g["slug"], g["entry"])

    page = read(ROOT, "index.html")

    # Point the head at the files this build actually ships.
    page = sub_once(page,
                    '<link rel="manifest" href="manifest.webmanifest">',
                    '<link rel="manifest" href="./manifest.json">',
                    "manifest link")
    page = sub_once(page,
                    '<link rel="apple-touch-icon" href="icon-180.png">',
                    '<link rel="apple-touch-icon" href="./icon-180.png">',
                    "apple-touch-icon link")
    # Inlined rather than shipped as a file: without a favicon the browser probes
    # favicon.ico, which 404s through the service worker and dirties the console.
    favicon = "data:image/svg+xml," + quote(read(ROOT, "icon.svg"), safe="")
    page = sub_once(page,
                    '<link rel="icon" href="icon.svg" type="image/svg+xml">',
                    '<link rel="icon" href="%s" type="image/svg+xml">' % favicon,
                    "svg icon link")

    payload = {"games": games, "html": html}
    boot = (
        "<script>\n"
        "window.__ARCADE_BUNDLE__ = %s;\n"
        "window.__ARCADE_VERSION__ = %s;\n"
        "window.__ARCADE_SW__ = true;\n"
        "</script>\n"
    ) % (
        json.dumps(payload, ensure_ascii=False).replace("</script>", "<\\/script>"),
        json.dumps(version),
    )

    page = sub_once(page, "<script>\n(function () {", boot + "<script>\n(function () {",
                    "launcher script")

    leftover = re.findall(r'(?:href|src)="(?!\./|#|data:|about:)([^"]+)"', page)
    leftover = [p for p in leftover if not p.startswith(("http:", "https:"))]
    if leftover:
        sys.exit("build-pwa: non-relative path(s) left in output: %s" % leftover)

    return page, games


SW = '''// Bump CACHE_VERSION on EVERY update, or phones keep serving the old build.
// It is generated from arcade/VERSION — change that file and re-run
// arcade/tools/build-pwa.py, or edit both by hand if you are not regenerating.
const CACHE_VERSION = 'arcade-v%(version)s';

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

// Network first: always try for a fresh copy, fall back to cache when offline.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => {
        if (hit) return hit;
        // A navigation that missed the cache still gets the app shell.
        if (req.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      }))
  );
});
'''


def main():
    version = read(ROOT, "VERSION").strip()

    page, games = build_index(version)

    os.makedirs(OUT, exist_ok=True)

    with open(os.path.join(OUT, "index.html"), "w") as f:
        f.write(page)

    manifest = {
        "name": "Arcade",
        "short_name": "Arcade",
        "description": "A pocket arcade.",
        "start_url": "./",
        "scope": "./",
        "display": "standalone",
        "orientation": "portrait",
        # Sanguine surface-0; the splash and status bar must not flash a
        # different ground than the app itself (DESIGN.md).
        "background_color": "#0b0609",
        "theme_color": "#0b0609",
        "icons": [{
            "src": "./icon-180.png",
            "sizes": "180x180",
            "type": "image/png",
            "purpose": "any",
        }],
    }
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")

    with open(os.path.join(OUT, "sw.js"), "w") as f:
        f.write(SW % {"version": version})

    shutil.copyfile(os.path.join(ROOT, "icon-180.png"), os.path.join(OUT, "icon-180.png"))

    size = os.path.getsize(os.path.join(OUT, "index.html")) / 1024
    print("play/ built at v%s — %d game(s), index.html %.0f KB"
          % (version, len(games), size))


if __name__ == "__main__":
    main()
