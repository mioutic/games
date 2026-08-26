#!/usr/bin/env python3
"""Inline the launcher and every game into a single self-contained HTML file.

Useful for handing someone a working copy before any hosting exists — the
output needs no server, no network and no repo access. It is a snapshot, so a
bundle does not pick up games added later; rebuild it, or use the hosted site.

    python3 arcade/tools/build-bundle.py [out.html]
"""

import base64
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAMES = os.path.join(ROOT, "games")


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "arcade-bundle.html")

    index_path = os.path.join(ROOT, "games.json")
    if not os.path.exists(index_path):
        sys.exit("run build-index.py first — %s is missing" % index_path)
    with open(index_path, encoding="utf-8") as f:
        games = json.load(f)["games"]

    html = {}
    for g in games:
        with open(os.path.join(GAMES, g["slug"], g["entry"]), encoding="utf-8") as f:
            html[g["slug"]] = f.read()

    with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as f:
        page = f.read()

    # Inline the icon so the bundle pulls in no sibling files.
    with open(os.path.join(ROOT, "icon-180.png"), "rb") as f:
        icon = "data:image/png;base64," + base64.b64encode(f.read()).decode()
    page = page.replace('href="icon-180.png"', 'href="%s"' % icon)
    page = page.replace('<link rel="manifest" href="manifest.webmanifest">', "")
    page = page.replace('<link rel="icon" href="icon.svg" type="image/svg+xml">', "")

    bundle = "<script>window.__ARCADE_BUNDLE__ = %s;</script>\n" % json.dumps(
        {"games": games, "html": html}
    ).replace("</script>", "<\\/script>")

    marker = "<script>\n(function () {"
    if marker not in page:
        sys.exit("could not find the launcher script in index.html")
    page = page.replace(marker, bundle + marker, 1)

    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write(page)

    print("wrote %s (%.0f KB, %d game(s))" % (out, os.path.getsize(out) / 1024, len(games)))


if __name__ == "__main__":
    main()
