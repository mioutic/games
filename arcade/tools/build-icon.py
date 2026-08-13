#!/usr/bin/env python3
"""Render arcade/icon-180.png — the Sanguine home-screen emblem.

An instrument bezel in bone over an oxblood ground, lit from within by a
crimson bloom, with an arterial drop at the centre. No emoji, no gradient
mush: hairline ring, machined tick marks, one saturated element.

Supersampled 4x for clean edges. Pure stdlib — writes the PNG by hand.
"""

import math
import struct
import sys
import zlib

S, SS = 180, 4
W = S * SS

# Sanguine tokens (see DESIGN.md)
S_0 = (0x0b, 0x06, 0x09)
S_3 = (0x24, 0x11, 0x19)
BONE = (0xe9, 0xd8, 0xc5)
BLOOD = (0xb8, 0x1d, 0x3a)

CX, CY = 0.5, 0.5
RING_OUT, RING_IN = 0.375, 0.347
TICK_IN, TICK_OUT = 0.398, 0.436
TICK_HALF = math.radians(1.6)
DROP_CX, DROP_CY, DROP_R = 0.5, 0.565, 0.113
DROP_APEX = 0.325


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c1, c2, t):
    return tuple(lerp(c1[i], c2[i], t) for i in range(3))


def ring(x, y):
    d = math.hypot(x - CX, y - CY)
    return RING_IN <= d <= RING_OUT


def ticks(x, y):
    d = math.hypot(x - CX, y - CY)
    if not (TICK_IN <= d <= TICK_OUT):
        return 0.0
    a = math.atan2(y - CY, x - CX)
    for i in range(12):
        target = -math.pi / 2 + i * math.pi / 6
        delta = abs((a - target + math.pi) % (2 * math.pi) - math.pi)
        if delta <= TICK_HALF:
            cardinal = i % 3 == 0
            # Short ticks stop early; the four cardinals run the full length.
            if not cardinal and d > TICK_IN + (TICK_OUT - TICK_IN) * 0.55:
                return 0.0
            return 1.0 if cardinal else 0.72
    return 0.0


def drop(x, y):
    if y >= DROP_CY:
        return math.hypot(x - DROP_CX, y - DROP_CY) <= DROP_R
    t = (y - DROP_APEX) / (DROP_CY - DROP_APEX)
    if t < 0:
        return False
    return abs(x - DROP_CX) <= DROP_R * (t ** 0.72)


def shade(px, py):
    x, y = px / W, py / W

    # Ground: oxblood cast, darkest at the top-left.
    base = mix(S_0, S_3, min(1.0, (x + y) / 2 * 1.25))

    # Lit from within — a restrained crimson bloom behind the drop. Kept low:
    # the ground has to stay near-black or the whole thing reads as pink.
    d = math.hypot(x - CX, y - CY)
    base = mix(base, BLOOD, 0.15 * math.exp(-(d / 0.22) ** 2))

    # Vignette back down at the corners so the bezel reads.
    base = mix(base, S_0, min(1.0, max(0.0, (d - 0.34) / 0.26)))

    if drop(x, y):
        return BLOOD
    if ring(x, y):
        return BONE
    t = ticks(x, y)
    if t:
        return mix(base, BONE, t)
    return base


def main(out):
    rows = []
    for oy in range(S):
        row = bytearray([0])
        for ox in range(S):
            r = g = b = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    c = shade(ox * SS + sx + 0.5, oy * SS + sy + 0.5)
                    r += c[0]; g += c[1]; b += c[2]
            n = SS * SS
            row += bytes((int(r / n), int(g / n), int(b / n)))
        rows.append(bytes(row))

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", S, S, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(b"".join(rows), 9))
           + chunk(b"IEND", b""))

    with open(out, "wb") as f:
        f.write(png)
    print("wrote %s (%d bytes)" % (out, len(png)))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "arcade/icon-180.png")
