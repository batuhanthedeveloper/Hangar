#!/usr/bin/env python3
"""Generate placeholder phone screenshots for the UI preview harness.

These stand in for real TestFlight screenshots so the panel can be judged at
realistic proportions without shipping anyone's actual app screens.
"""

import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "test" / "assets"

W, H = 430, 932

THEMES = [
    ((250, 250, 252), (28, 28, 32), (0, 113, 227)),
    ((255, 252, 248), (32, 26, 22), (222, 118, 38)),
    ((246, 250, 248), (22, 32, 27), (24, 148, 96)),
]


def canvas(bg):
    return [[bg for _ in range(W)] for _ in range(H)]


def fill(px, x0, y0, x1, y1, color):
    for y in range(max(0, y0), min(H, y1)):
        row = px[y]
        for x in range(max(0, x0), min(W, x1)):
            row[x] = color


def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def render(theme):
    bg, ink, accent = theme
    px = canvas(bg)
    faint = mix(bg, ink, 0.08)
    mid = mix(bg, ink, 0.22)

    fill(px, 0, 0, W, 54, mix(bg, ink, 0.03))          # status bar
    fill(px, 24, 20, 96, 30, mid)                       # clock
    fill(px, W - 96, 20, W - 24, 30, mid)               # indicators

    fill(px, 24, 76, 250, 104, ink)                     # title
    fill(px, 24, 118, 340, 132, faint)                  # subtitle

    y = 170
    for index in range(5):                              # list rows
        fill(px, 24, y, W - 24, y + 92, faint)
        fill(px, 40, y + 18, 96, y + 74, mid)           # avatar
        fill(px, 112, y + 24, 300, y + 40, mid)
        fill(px, 112, y + 52, 240, y + 64, mix(bg, ink, 0.14))
        y += 108

    fill(px, 0, H - 92, W, H - 90, mix(bg, ink, 0.12))  # tab bar
    fill(px, 0, H - 90, W, H, mix(bg, ink, 0.02))

    for index in range(4):                              # tab items
        cx = 54 + index * 108
        color = accent if index == 0 else mid
        fill(px, cx - 16, H - 66, cx + 16, H - 38, color)

    return px


def write_png(path, px):
    raw = bytearray()

    for row in px:
        raw.append(0)
        for pixel in row:
            raw += bytes(pixel)

    def chunk(tag, data):
        body = tag + data
        return (
            struct.pack(">I", len(data))
            + body
            + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
        )

    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 6))
        + chunk(b"IEND", b"")
    )


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    for index, theme in enumerate(THEMES, start=1):
        path = OUT / f"shot-{index}.png"
        write_png(path, render(theme))
        print(f"{path.relative_to(OUT.parent.parent)}  {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
