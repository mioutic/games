#!/usr/bin/env python3
"""Regenerate arcade/games.json from the folders in arcade/games/.

The launcher reads that file from its own origin, so listing games needs no
GitHub API call, no token and no rate limit — which is what makes this work on
a private repo. CI runs this on every push; run it by hand if you like.
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAMES = os.path.join(ROOT, "games")
OUT = os.path.join(ROOT, "games.json")

PALETTE = ["#7c5cff", "#ff5c9d", "#3ecf8e", "#ffb020", "#4aa8ff", "#ff6b5c", "#c05cff", "#2fd8c6"]


def titleize(slug):
    return re.sub(r"\b\w", lambda m: m.group().upper(), slug.replace("-", " ").replace("_", " "))


def color_for(slug):
    h = 0
    for ch in slug:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return PALETTE[h % len(PALETTE)]


def main():
    entries = []
    for slug in sorted(os.listdir(GAMES)) if os.path.isdir(GAMES) else []:
        d = os.path.join(GAMES, slug)
        if not os.path.isdir(d) or slug.startswith("."):
            continue

        meta = {}
        mp = os.path.join(d, "game.json")
        if os.path.exists(mp):
            try:
                with open(mp) as f:
                    meta = json.load(f)
            except (ValueError, OSError) as e:
                print("warning: bad game.json in %s: %s" % (slug, e), file=sys.stderr)

        entry = meta.get("entry", "index.html")
        if not os.path.exists(os.path.join(d, entry)):
            print("warning: skipping %s, no %s" % (slug, entry), file=sys.stderr)
            continue

        entries.append({
            "slug": slug,
            "name": meta.get("name") or titleize(slug),
            "emoji": meta.get("emoji", "🎮"),
            "description": meta.get("description", ""),
            "color": meta.get("color") or color_for(slug),
            "entry": entry,
        })

    with open(OUT, "w") as f:
        json.dump({"games": entries}, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print("indexed %d game(s): %s" % (len(entries), ", ".join(e["slug"] for e in entries)))


if __name__ == "__main__":
    main()
