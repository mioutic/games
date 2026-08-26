#!/usr/bin/env python3
"""Convert the self-contained bundle into an Artifact-ready fragment.

The Artifact host supplies its own <!doctype>/<head>/<body> skeleton, so this
strips ours and keeps the title, styles and body content.

    python3 arcade/tools/build-bundle.py /tmp/bundle.html
    python3 arcade/tools/build-artifact.py /tmp/bundle.html /tmp/artifact.html
"""

import re
import sys

if len(sys.argv) != 3:
    sys.exit(__doc__)

src, dst = sys.argv[1], sys.argv[2]

with open(src, encoding="utf-8") as f:
    page = f.read()

head = re.search(r"<head>(.*?)</head>", page, re.S).group(1)
body = re.search(r"<body>(.*?)</body>", page, re.S).group(1)

title = re.search(r"<title>.*?</title>", head, re.S).group(0)
style = re.search(r"<style>.*?</style>", head, re.S).group(0)
# The bundle payload lives in the first body-adjacent script tag in <head>? No —
# it sits just above the launcher script in <body>, so it comes along with body.

with open(dst, "w", encoding="utf-8", newline="\n") as f:
    f.write(title + "\n" + style + "\n" + body.strip() + "\n")

print("wrote %s" % dst)
