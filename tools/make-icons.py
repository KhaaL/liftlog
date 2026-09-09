#!/usr/bin/env python3
"""Generate Liftlog's install icons from tools/source-icon.png.

Standard library only (zlib + struct), on purpose: the repo has no build step
and no dependencies, so a plain PNG decoder/resizer is used instead of
pulling in an image library for a handful of PNGs. Re-run after replacing
the source artwork:

    python3 tools/make-icons.py

Outputs are committed, so nobody needs to run this to work on the app.
"""
import os
import struct
import zlib

SOURCE = 'tools/source-icon.png'

# Fraction of the canvas the artwork occupies once centred on the maskable
# icon: launchers may crop anything outside the ~66%-diameter safe circle,
# so this is scaled well inside it.
MASKABLE_CONTENT = 0.80


def read_png(path):
    with open(path, 'rb') as fh:
        data = fh.read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'not a PNG'
    pos = 8
    width = height = bit_depth = color_type = None
    idat = bytearray()
    while pos < len(data):
        length = struct.unpack('>I', data[pos:pos + 4])[0]
        tag = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if tag == b'IHDR':
            width, height, bit_depth, color_type, _, _, interlace = \
                struct.unpack('>IIBBBBB', chunk)
            assert bit_depth == 8 and interlace == 0, 'expected 8-bit, non-interlaced PNG'
            assert color_type in (2, 6), 'expected RGB or RGBA source'
        elif tag == b'IDAT':
            idat += chunk
        elif tag == b'IEND':
            break
    channels = 3 if color_type == 2 else 4
    raw = zlib.decompress(bytes(idat))
    stride = width * channels
    rows = []
    prev = bytearray(stride)
    pos = 0
    for _ in range(height):
        ftype = raw[pos]
        pos += 1
        line = bytearray(raw[pos:pos + stride])
        pos += stride
        for i in range(stride):
            a = line[i - channels] if i >= channels else 0
            b = prev[i]
            c = prev[i - channels] if i >= channels else 0
            if ftype == 1:
                line[i] = (line[i] + a) & 0xff
            elif ftype == 2:
                line[i] = (line[i] + b) & 0xff
            elif ftype == 3:
                line[i] = (line[i] + (a + b) // 2) & 0xff
            elif ftype == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xff
        prev = line
        if channels == 4:
            rgb = bytearray(width * 3)
            rgb[0::3] = line[0::4]
            rgb[1::3] = line[1::4]
            rgb[2::3] = line[2::4]
            rows.append(bytes(rgb))
        else:
            rows.append(bytes(line))
    return width, height, rows


def sample_background(rows, width):
    """Average a strip of the top edge, away from the rounded corners and
    the artwork, to recover the flat background colour."""
    x0, x1 = int(width * 0.4), int(width * 0.6)
    r = g = b = n = 0
    for y in range(8, 18):
        row = rows[y]
        for x in range(x0, x1):
            i = x * 3
            r += row[i]
            g += row[i + 1]
            b += row[i + 2]
            n += 1
    return r // n, g // n, b // n


def corner_radius(rows, size, bg, tol=40):
    """Source is a full-bleed rounded square; find the corner radius by
    walking the top edge out from x=0 until it matches the background."""
    row = rows[0]
    for x in range(size):
        i = x * 3
        if (abs(row[i] - bg[0]) <= tol and abs(row[i + 1] - bg[1]) <= tol
                and abs(row[i + 2] - bg[2]) <= tol):
            return x
    return 0


def flatten_corners(rows, size, radius, bg):
    """Fill the four rounded-corner cutouts with the background colour so
    the result is a plain full-bleed square (the OS applies its own icon
    mask, so pre-rounded corners would just get masked twice).

    A small buffer eats into the true curve so the anti-aliased ring at the
    original edge (a blend of the corner white and the fill blue) is fully
    replaced rather than left as a visible hairline."""
    buffer = max(2, round(size * 0.006))
    rows = [bytearray(row) for row in rows]
    centers = {
        'tl': (radius, radius, 0, 0),
        'tr': (size - radius, radius, size - radius, 0),
        'bl': (radius, size - radius, 0, size - radius),
        'br': (size - radius, size - radius, size - radius, size - radius),
    }
    r2 = (radius - buffer) ** 2
    for cx, cy, x0, y0 in centers.values():
        for y in range(y0, y0 + radius):
            row = rows[y]
            dy = y - cy
            for x in range(x0, x0 + radius):
                dx = x - cx
                if dx * dx + dy * dy > r2:
                    i = x * 3
                    row[i:i + 3] = bytes(bg)
    return [bytes(row) for row in rows]


def resize_box(rows, src_size, dst_size):
    """Downsample by averaging each output pixel's source block. Source is
    always much larger than any output icon, so a box filter is enough."""
    out = []
    for oy in range(dst_size):
        y0 = oy * src_size // dst_size
        y1 = max(y0 + 1, (oy + 1) * src_size // dst_size)
        row_out = bytearray(dst_size * 3)
        for ox in range(dst_size):
            x0 = ox * src_size // dst_size
            x1 = max(x0 + 1, (ox + 1) * src_size // dst_size)
            rs = gs = bs = 0
            for yy in range(y0, y1):
                row = rows[yy]
                for xx in range(x0, x1):
                    i = xx * 3
                    rs += row[i]
                    gs += row[i + 1]
                    bs += row[i + 2]
            n = (y1 - y0) * (x1 - x0)
            i = ox * 3
            row_out[i:i + 3] = bytes((rs // n, gs // n, bs // n))
        out.append(bytes(row_out))
    return out


def solid_square(size, color):
    row = bytes(color) * size
    return [row] * size


def paste_center(canvas, canvas_size, inner, inner_size):
    canvas = list(canvas)
    off = (canvas_size - inner_size) // 2
    for y in range(inner_size):
        row = bytearray(canvas[off + y])
        row[off * 3:(off + inner_size) * 3] = inner[y]
        canvas[off + y] = bytes(row)
    return canvas


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


ICONS = [
    ('icons/icon-192.png', 192),
    ('icons/icon-512.png', 512),
    ('icons/apple-touch-icon-180.png', 180),
]

if __name__ == '__main__':
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.makedirs(os.path.join(root, 'icons'), exist_ok=True)

    src_w, src_h, rows = read_png(os.path.join(root, SOURCE))
    assert src_w == src_h, 'source artwork must be square'
    bg = sample_background(rows, src_w)
    radius = corner_radius(rows, src_w, bg)
    full_bleed = flatten_corners(rows, src_w, radius, bg)

    for name, size in ICONS:
        path = os.path.join(root, name)
        write_png(path, size, resize_box(full_bleed, src_w, size))
        print('%s  %dx%d  %d bytes' % (name, size, size, os.path.getsize(path)))

    maskable_size = 512
    inner_size = round(maskable_size * MASKABLE_CONTENT)
    inner = resize_box(full_bleed, src_w, inner_size)
    canvas = paste_center(solid_square(maskable_size, bg), maskable_size, inner, inner_size)
    path = os.path.join(root, 'icons/icon-maskable-512.png')
    write_png(path, maskable_size, canvas)
    print('icons/icon-maskable-512.png  %dx%d  %d bytes' %
          (maskable_size, maskable_size, os.path.getsize(path)))
