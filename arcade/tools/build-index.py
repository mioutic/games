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

# Sanguine's categorical ramp — muted, gaslit (DESIGN.md). Used only for the
# 2px channel strip along the top of a card, never for large fills.
INKS = ["#6fb3ab", "#8a8fc9", "#a884c9", "#c96a8e"]


def titleize(slug):
    return re.sub(r"\b\w", lambda m: m.group().upper(), slug.replace("-", " ").replace("_", " "))


def ink_for(slug):
    h = 0
    for ch in slug:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return INKS[h % len(INKS)]


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
                with open(mp, encoding="utf-8") as f:
                    meta = json.load(f)
            except (ValueError, OSError) as e:
                print("warning: bad game.json in %s: %s" % (slug, e), file=sys.stderr)

        entry = meta.get("entry", "index.html")
        if not os.path.exists(os.path.join(d, entry)):
            print("warning: skipping %s, no %s" % (slug, entry), file=sys.stderr)
            continue

        entry_meta = {
            "slug": slug,
            "name": meta.get("name") or titleize(slug),
            "glyph": meta.get("glyph", "default"),
            "description": meta.get("description", ""),
            "ink": meta.get("ink") or ink_for(slug),
            "entry": entry,
        }
        if meta.get("stat"):
            entry_meta["stat"] = meta["stat"]
        # Optional. Lower comes first; unset sorts after everything that set one.
        entry_meta["_order"] = meta.get("order", 100)
        if meta.get("emoji"):
            print("warning: %s sets 'emoji' — Sanguine forbids emoji, use 'glyph' (see DESIGN.md)"
                  % slug, file=sys.stderr)
        entries.append(entry_meta)

    entries.sort(key=lambda e: (e["_order"], e["slug"]))
    for e in entries:
        del e["_order"]

    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"games": entries}, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print("indexed %d game(s): %s" % (len(entries), ", ".join(e["slug"] for e in entries)))


if __name__ == "__main__":
    main()
