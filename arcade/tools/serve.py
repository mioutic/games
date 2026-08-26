#!/usr/bin/env python3
"""Serve this repo to the phone over Tailscale, so testing needs no deploy.

    python3 arcade/tools/serve.py            # port 8123
    python3 arcade/tools/serve.py --port 9000

Then open the printed URL on the phone. Both devices are on the tailnet, so
nothing is exposed to the internet and there is no push, no Pages wait and no
service-worker cache to fight.

**Test against /arcade/, not /play/.** `arcade/` is the source build: it fetches
games.json and loads each game straight from its own folder, so editing
`arcade/games/<slug>/index.html` and pulling to refresh shows the change
immediately — no build step at all. `play/` is the generated offline build; it
is what ships, but it inlines every game, so testing it means rebuilding first.

Everything is served `no-store`. A stale copy on the phone is the single most
expensive bug in this project's history — it looks exactly like a broken game,
and it is why "the controls are dead" was chased through three sessions.

## A note on what plain HTTP costs you

Over `http://` on a tailnet address the page is not a secure context, so:

  - service workers do not register (fine here — `arcade/` has none, and not
    caching is the point while testing)
  - `DeviceOrientationEvent.requestPermission` is unavailable, so tilt controls
    (Ossuary) cannot work. Touch-stick games like Barrow are unaffected.

To get a real secure context, enable HTTPS certificates once in the Tailscale
admin console (https://login.tailscale.com/admin/dns), then instead of this
script run:

    tailscale serve --bg 8123

which fronts this server at https://<machine>.<tailnet>.ts.net/ with a genuine
certificate. Sensors and service workers then behave exactly as they do on Pages.
"""

import argparse
import http.server
import os
import socket
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

EXTRA_TYPES = {
    ".webmanifest": "application/manifest+json",
    ".json": "application/json",
    ".mjs": "text/javascript",
    ".svg": "image/svg+xml",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        # The whole point of serving locally is that a refresh shows the edit.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        if ext in EXTRA_TYPES:
            return EXTRA_TYPES[ext]
        t = super().guess_type(path)
        if t in ("text/html", "text/javascript", "application/javascript", "text/css"):
            return t + "; charset=utf-8"
        return t

    def log_message(self, fmt, *args):
        # One line per request, without the date noise the base class adds.
        sys.stdout.write("  %s\n" % (fmt % args))


def tailscale_host():
    """This machine's MagicDNS name and tailnet IP, if Tailscale is up."""
    exe = None
    for cand in (r"C:\Program Files\Tailscale\tailscale.exe", "tailscale"):
        if os.path.exists(cand) or cand == "tailscale":
            exe = cand
            break
    name = ip = None
    try:
        out = subprocess.run([exe, "status", "--json"], capture_output=True,
                             text=True, timeout=6)
        if out.returncode == 0:
            import json
            d = json.loads(out.stdout)
            self_ = d.get("Self") or {}
            dns = (self_.get("DNSName") or "").rstrip(".")
            name = dns or None
            ips = self_.get("TailscaleIPs") or []
            ip = next((a for a in ips if ":" not in a), None)
    except Exception:
        pass
    return name, ip


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return None
    finally:
        s.close()


def main():
    ap = argparse.ArgumentParser(description="Serve the arcade to the phone over Tailscale.")
    ap.add_argument("--port", "-p", type=int, default=8123)
    args = ap.parse_args()

    if not os.path.exists(os.path.join(ROOT, "arcade", "games.json")):
        print("note: arcade/games.json is missing — run arcade/tools/build-index.py once\n")

    name, ip = tailscale_host()
    lan = lan_ip()

    print("\n  Serving %s" % ROOT)
    print("  Everything no-store, so a refresh always shows the edit.\n")
    print("  On the phone (Tailscale):")
    if name:
        print("    http://%s:%d/arcade/        <- test here, no build needed" % (name, args.port))
    if ip:
        print("    http://%s:%d/arcade/" % (ip, args.port))
    if not name and not ip:
        print("    (Tailscale not detected — is it running and logged in?)")
    if lan:
        print("\n  Same wifi, no Tailscale:")
        print("    http://%s:%d/arcade/" % (lan, args.port))
    print("\n  Here:")
    print("    http://localhost:%d/arcade/" % args.port)
    print("    http://localhost:%d/play/     (the shipped build; rebuild first)" % args.port)
    print("\n  Ctrl+C to stop. Windows may ask to allow this through the firewall\n"
          "  the first time — allow it on private networks.\n")

    http.server.ThreadingHTTPServer.allow_reuse_address = True
    try:
        srv = http.server.ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    except OSError as e:
        sys.exit("could not bind port %d: %s" % (args.port, e))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n  stopped\n")


if __name__ == "__main__":
    main()
