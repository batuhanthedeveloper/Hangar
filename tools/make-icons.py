#!/usr/bin/env python3
"""Generate the extension's PNG icons.

Chrome only accepts raster icons, so they are rendered here rather than
shipped as SVG. Supersampled 4x and box-filtered for smooth edges.

Usage: python3 tools/make-icons.py
"""

import struct
import zlib
from pathlib import Path

SIZES = (16, 32, 48, 128)
SUPERSAMPLE = 4

BACKGROUND = (17, 17, 20, 255)
GLYPH = (10, 132, 255, 255)

OUT_DIR = Path(__file__).resolve().parent.parent / "icons"


def rounded_rect(x, y, radius):
    """Point-in-rounded-unit-square test."""
    cx = min(max(x, radius), 1 - radius)
    cy = min(max(y, radius), 1 - radius)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= radius * radius


def in_rect(x, y, x0, y0, x1, y1):
    return x0 <= x <= x1 and y0 <= y <= y1


def in_triangle(px, py, a, b, c):
    def cross(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])

    d1 = cross(a, b, (px, py))
    d2 = cross(b, c, (px, py))
    d3 = cross(c, a, (px, py))
    has_neg = d1 < 0 or d2 < 0 or d3 < 0
    has_pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (has_neg and has_pos)


def sample(x, y):
    """Return RGBA for a point in the unit square, or None for transparent."""
    if not rounded_rect(x, y, 0.22):
        return None

    # Downward arrow: stem, head, and the line it lands on.
    if in_rect(x, y, 0.435, 0.19, 0.565, 0.47):
        return GLYPH
    if in_triangle(x, y, (0.29, 0.44), (0.71, 0.44), (0.5, 0.68)):
        return GLYPH
    if in_rect(x, y, 0.25, 0.76, 0.75, 0.84):
        return GLYPH

    return BACKGROUND


def render(size):
    hi = size * SUPERSAMPLE
    rows = []

    for py in range(size):
        row = bytearray()

        for px in range(size):
            acc = [0, 0, 0, 0]

            for sy in range(SUPERSAMPLE):
                for sx in range(SUPERSAMPLE):
                    fx = (px * SUPERSAMPLE + sx + 0.5) / hi
                    fy = (py * SUPERSAMPLE + sy + 0.5) / hi
                    pixel = sample(fx, fy) or (0, 0, 0, 0)

                    # Premultiply so transparent edges do not darken.
                    alpha = pixel[3] / 255
                    acc[0] += pixel[0] * alpha
                    acc[1] += pixel[1] * alpha
                    acc[2] += pixel[2] * alpha
                    acc[3] += pixel[3]

            count = SUPERSAMPLE * SUPERSAMPLE
            a = acc[3] / count

            if a == 0:
                row += bytes((0, 0, 0, 0))
            else:
                scale = count * (a / 255)
                row += bytes(
                    (
                        min(255, round(acc[0] / scale)),
                        min(255, round(acc[1] / scale)),
                        min(255, round(acc[2] / scale)),
                        round(a),
                    )
                )

        rows.append(bytes(row))

    return rows


def write_png(path, size, rows):
    raw = b"".join(b"\x00" + row for row in rows)

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(
            ">I", zlib.crc32(body) & 0xFFFFFFFF
        )

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )

    path.write_bytes(png)


def main():
    OUT_DIR.mkdir(exist_ok=True)

    for size in SIZES:
        path = OUT_DIR / f"icon-{size}.png"
        write_png(path, size, render(size))
        print(f"{path.name}  {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
