#!/usr/bin/env python3
"""Generate Liftlog's install icons from the same barbell mark the header uses.

Standard library only (zlib + struct), on purpose: the repo has no build step
and no dependencies, and generating a handful of PNGs is no reason to acquire
either. Re-run after changing the mark or the colours:

    python3 tools/make-icons.py

Outputs are committed, so nobody needs to run this to work on the app.
"""
import os
import struct
import zlib

BG = (0x20, 0x24, 0x2a)   # --text in the light theme, i.e. the ink colour
FG = (0xfb, 0xfb, 0xf9)   # --bg in the light theme

# The header mark (index.html, .wordmark svg) in its own 24x24 viewBox:
# round-capped segments of stroke width 2.4.
STROKE = 2.4
SEGMENTS = [
    (2.0, 12.0, 4.0, 12.0),      # left collar
    (20.0, 12.0, 22.0, 12.0),    # right collar
    (6.5, 7.0, 6.5, 17.0),       # left plate
    (17.5, 7.0, 17.5, 17.0),     # right plate
    (6.5, 12.0, 17.5, 12.0),     # the bar
]


def dist_to_segment(px, py, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    span = dx * dx + dy * dy
    if span == 0:
        return ((px - x1) ** 2 + (py - y1) ** 2) ** 0.5
    t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / span))
    return ((px - (x1 + t * dx)) ** 2 + (py - (y1 + t * dy)) ** 2) ** 0.5


def render(size, content):
    """content: fraction of the canvas the 24-unit viewBox spans.

    Coverage is computed analytically from the distance to the nearest stroke
    rather than by supersampling — same antialiasing, a fraction of the work.
    """
    scale = size * content / 24.0
    offset = (size - 24.0 * scale) / 2.0
    half_px = STROKE * scale / 2.0
    rows = []
    for y in range(size):
        row = bytearray()
        py = (y + 0.5 - offset) / scale
        for x in range(size):
            px = (x + 0.5 - offset) / scale
            nearest = min(dist_to_segment(px, py, *seg) for seg in SEGMENTS)
            cover = half_px - nearest * scale + 0.5
            cover = 0.0 if cover < 0.0 else (1.0 if cover > 1.0 else cover)
            for i in range(3):
                row.append(int(round(BG[i] + (FG[i] - BG[i]) * cover)))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    raw = b''.join(b'\x00' + row for row in rows)

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data +
                struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

    png = (b'\x89PNG\r\n\x1a\n' +
           chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) +
           chunk(b'IDAT', zlib.compress(raw, 9)) +
           chunk(b'IEND', b''))
    with open(path, 'wb') as fh:
        fh.write(png)


# content ratios: generous for the plain icons, tucked well inside the safe
# circle for the maskable one (a launcher may crop anything outside it).
ICONS = [
    ('icons/icon-192.png', 192, 0.86),
    ('icons/icon-512.png', 512, 0.86),
    ('icons/icon-maskable-512.png', 512, 0.58),
    ('icons/apple-touch-icon-180.png', 180, 0.74),
]

if __name__ == '__main__':
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.makedirs(os.path.join(root, 'icons'), exist_ok=True)
    for name, size, content in ICONS:
        path = os.path.join(root, name)
        write_png(path, size, render(size, content))
        print('%s  %dx%d  %d bytes' % (name, size, size, os.path.getsize(path)))
