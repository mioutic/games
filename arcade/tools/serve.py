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
import ipaddress
import json
import os
import subprocess
import sys
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

EXTRA_TYPES = {
    ".webmanifest": "application/manifest+json",
    ".json": "application/json",
    ".mjs": "text/javascript",
    ".svg": "image/svg+xml",
}

# Filled in by main(). Helios reads /api/status to decide whether this app is
# running, and the phone URL it hands back is the one worth copying.
STATE = {"port": None, "url": None, "urls": [], "root": ROOT}
SERVER = {"srv": None}

# Kindred's villagers speak through this (arcade/games/kindred/brain.py, kept
# with the game it belongs to): one short line
# from Haiku via the Claude Code CLI login. None until main() builds it, and
# None for good with --no-brain.
BRAIN = {"b": None}

# Only this PC and the tailnet may connect, never the LAN/Wi-Fi.
TAILNET = (ipaddress.ip_network("100.64.0.0/10"), ipaddress.ip_network("fd7a:115c:a1e0::/48"))


def client_ip_allowed(client_ip):
    """True for loopback and tailnet callers (::ffff:-mapped forms included)."""
    try:
        ip = ipaddress.ip_address(str(client_ip or "").split("%")[0])
        if getattr(ip, "ipv4_mapped", None):
            ip = ip.ipv4_mapped
    except ValueError:
        return False
    return ip.is_loopback or any(ip in n for n in TAILNET)


class Server(http.server.ThreadingHTTPServer):
    allow_reuse_address = True

    def verify_request(self, request, client_address):
        # Runs before any request is parsed, so it covers every method and path.
        if client_ip_allowed(client_address[0]):
            return True
        if sys.stdout is not None:
            try:
                print("  refused %s (not loopback/tailnet)" % client_address[0])
            except Exception:
                pass
        return False


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    # ── the small API Helios speaks ────────────────────────────────────────
    def _json(self, obj, code=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]
        # Helios's LNK button copies the bare root (http://host:port), so the
        # root has to be the thing worth opening. Sending it to the source
        # build means the copied link lands on the launcher, ready to test,
        # instead of on a directory listing of the repo.
        if path == "/":
            self.send_response(302)
            self.send_header("Location", "/arcade/")
            self.end_headers()
            return
        if path == "/api/brain":
            b = BRAIN["b"]
            return self._json(b.status() if b else {"ok": False, "error": "brain off"})
        if path == "/api/status":
            return self._json({
                "ok": True, "app": "arcade", "status": "running",
                "port": STATE["port"], "url": STATE["url"], "urls": STATE["urls"],
                "root": STATE["root"],
            })
        return super().do_GET()

    def _body(self, cap=20000):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > cap:
            return None
        try:
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            return None

    def do_OPTIONS(self):
        # A game served from another origin (Pages, through `tailscale serve`)
        # preflights its JSON POST. The tailnet check has already run.
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        path = self.path.split("?")[0]
        if path in ("/api/brain", "/api/brain/warm"):
            b = BRAIN["b"]
            if not b:
                return self._json({"ok": False, "error": "brain off"}, 503)
            d = self._body()
            if not isinstance(d, dict):
                return self._json({"ok": False, "error": "bad body"}, 400)
            if path == "/api/brain/warm":
                return self._json(b.warmup(d.get("system")))
            return self._json(b.ask(d.get("system"), d.get("scene")))
        if path == "/api/shutdown":
            self._json({"ok": True, "stopping": True})
            # Answer first, then stop: shutdown() blocks until the loop exits,
            # so calling it inline would deadlock this handler's own thread.
            threading.Thread(target=lambda: SERVER["srv"] and SERVER["srv"].shutdown(),
                             daemon=True).start()
            return
        self.send_error(405, "only /api/shutdown and /api/brain accept POST")

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
        #
        # Launched by Helios through pythonw there is no console at all and
        # sys.stdout is None. print() tolerates that (it returns early), but a
        # bare sys.stdout.write does not — and since this runs per request, it
        # took down every response while the socket still accepted connections.
        # A server that listens and answers nothing is the worst failure shape
        # available, so this stays defensive.
        if sys.stdout is None:
            return
        try:
            print("  %s" % (fmt % args))
        except Exception:
            pass


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


def main():
    ap = argparse.ArgumentParser(description="Serve the arcade to the phone over Tailscale.")
    ap.add_argument("--port", "-p", type=int, default=8123)
    ap.add_argument("--no-brain", action="store_true",
                    help="don't offer /api/brain (Kindred's villagers fall back to stock lines)")
    args = ap.parse_args()

    if not os.path.exists(os.path.join(ROOT, "arcade", "games.json")):
        print("note: arcade/games.json is missing — run arcade/tools/build-index.py once\n")

    name, ip = tailscale_host()

    # The tailnet name first: it survives a changed IP, and it is the one to copy.
    # No LAN address: the server refuses everything but this PC and the tailnet.
    STATE["port"] = args.port
    STATE["urls"] = ["http://%s:%d/arcade/" % (h, args.port)
                     for h in (name, ip) if h]
    STATE["url"] = STATE["urls"][0] if STATE["urls"] else \
        "http://localhost:%d/arcade/" % args.port

    print("\n  Serving %s" % ROOT)
    print("  Everything no-store, so a refresh always shows the edit.\n")
    print("  On the phone (Tailscale):")
    if name:
        print("    http://%s:%d/arcade/        <- test here, no build needed" % (name, args.port))
    if ip:
        print("    http://%s:%d/arcade/" % (ip, args.port))
    if not name and not ip:
        print("    (Tailscale not detected — is it running and logged in?)")
    print("\n  Here:")
    print("    http://localhost:%d/arcade/" % args.port)
    print("    http://localhost:%d/play/     (the shipped build; rebuild first)" % args.port)
    print("\n  Ctrl+C to stop. Windows may ask to allow this through the firewall\n"
          "  the first time — allow it on private networks.\n")

    try:
        srv = Server(("0.0.0.0", args.port), Handler)
    except OSError as e:
        sys.exit("could not bind port %d: %s" % (args.port, e))
    SERVER["srv"] = srv
    if not args.no_brain:
        try:
            sys.path.insert(0, os.path.join(ROOT, "arcade", "games", "kindred"))
            import brain
            BRAIN["b"] = brain.Brain()
            print("  Villager voice: %s via %s" % (brain.MODEL, BRAIN["b"].exe or "(claude.exe not found)"))
        except Exception as e:
            print("  Villager voice off: %s" % e)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    if BRAIN["b"]:
        BRAIN["b"].close()
    print("\n  stopped\n")


if __name__ == "__main__":
    main()
