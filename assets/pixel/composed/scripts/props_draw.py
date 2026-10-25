"""Drawing helpers for props/fx/ui: palette-name canvases, ASCII art, outline, regrade of pack sprites."""
import os, sys, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image
from palette import PALETTE, RGB, NAMES, load, save, sheet, rgb2lab, nearest

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
PIX = os.path.abspath(os.path.join(ROOT, '..'))
OUT = {k: os.path.join(ROOT, k) for k in ('props', 'fx', 'ui')}
PROV = {}      # filename -> dict
CHECK = []     # files written, verified at the end

def new(w, h): return Image.new('RGBA', (w, h), (0, 0, 0, 0))
def put(im, x, y, c):
    if 0 <= x < im.width and 0 <= y < im.height:
        im.putpixel((x, y), (0, 0, 0, 0) if c is None else RGB[c] + (255,))
def rect(im, x0, y0, x1, y1, c):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1): put(im, x, y, c)
def hline(im, x0, x1, y, c): rect(im, x0, y, x1, y, c)
def vline(im, x, y0, y1, c): rect(im, x, y0, x, y1, c)
def line(im, x0, y0, x1, y1, c):
    n = max(abs(x1 - x0), abs(y1 - y0), 1)
    for i in range(n + 1): put(im, round(x0 + (x1 - x0) * i / n), round(y0 + (y1 - y0) * i / n), c)
def ellipse(im, cx, cy, rx, ry, c, fill=True):
    for y in range(int(cy - ry - 1), int(cy + ry + 2)):
        for x in range(int(cx - rx - 1), int(cx + rx + 2)):
            d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
            if (d <= 1.0 if fill else 0.62 <= d <= 1.0): put(im, x, y, c)
def art(rows, legend, w=None):
    """ASCII sprite. '.' = transparent. legend maps char -> palette name."""
    h = len(rows); w = w or max(len(r) for r in rows); im = new(w, h)
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch != '.' and ch != ' ': put(im, x, y, legend[ch])
    return im
def paste(dst, src, x, y): dst.alpha_composite(src, (x, y)) if x >= 0 and y >= 0 else dst.paste(src, (x, y), src)
def outline(im, c='ink', pad=1, diag=False):
    """1px outline around opaque pixels; grows canvas by pad on each side."""
    out = new(im.width + 2 * pad, im.height + 2 * pad); out.alpha_composite(im, (pad, pad))
    src = out.copy(); px = src.load(); o = out.load()
    nb = [(1, 0), (-1, 0), (0, 1), (0, -1)] + ([(1, 1), (-1, -1), (1, -1), (-1, 1)] if diag else [])
    for y in range(out.height):
        for x in range(out.width):
            if px[x, y][3]: continue
            for dx, dy in nb:
                xx, yy = x + dx, y + dy
                if 0 <= xx < out.width and 0 <= yy < out.height and px[xx, yy][3]: o[x, y] = RGB[c] + (255,); break
    return out
def strip(frames):
    w = sum(f.width for f in frames); h = max(f.height for f in frames); s = new(w, h); x = 0
    for f in frames: s.alpha_composite(f, (x, h - f.height)); x += f.width
    return s
def flip(im): return im.transpose(Image.FLIP_LEFT_RIGHT)
def dither(x, y, lvl):
    """4x4 ordered dither: True if pixel on for coverage lvl in 0..1"""
    m = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
    return (m[y % 4][x % 4] + 0.5) / 16 < lvl

def write(rel, im, **prov):
    grp, name = rel.split('/', 1); path = os.path.join(OUT[grp], name)
    save(im, path); CHECK.append(path); PROV[rel] = dict(size=[im.width, im.height], **prov)
def verify():
    pal = {v + (255,) for v in RGB.values()}; bad = 0
    for p in CHECK:
        im = Image.open(p).convert('RGBA')
        for px in im.getdata():
            if px[3] == 0: continue
            if px not in pal: bad += 1; print('BAD', p, px); break
    assert not bad, 'non-palette pixels'; print('verified', len(CHECK), 'files palette-only')

# ---- regrade a pack sprite by luminance ramps (night_grade is too muddy for props) ----
def _hue_family(rgb):
    L, a, b = rgb2lab(rgb); C = math.hypot(a, b); H = math.degrees(math.atan2(b, a)) % 360
    if C < 0.045: return 'neutral', L
    if 40 <= H < 110 and C > 0.09: return 'warm', L          # orange / yellow
    if 110 <= H < 200 and C > 0.07: return 'teal', L         # green-teal
    if 200 <= H < 270 and C > 0.07: return 'blue', L
    if (H >= 330 or H < 40) and C > 0.09: return 'pink', L   # magenta/red
    return 'neutral', L
def regrade(src, ramps, ink='ink', edge_ink=True, lo=None, hi=None, gamma=1.0):
    """ramps: dict family -> list of palette names dark->light. Per-family luminance is normalized
    over the sprite, so contrast is always used fully."""
    src = src.convert('RGBA'); px = src.load(); w, h = src.size
    fam = {}; Ls = {}
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 128: continue
            f, L = _hue_family((r, g, b)); fam[(x, y)] = f; Ls.setdefault(f, []).append(L)
    rng = {f: (min(v), max(v)) for f, v in Ls.items()}
    out = new(w, h)
    for (x, y), f in fam.items():
        ramp = ramps.get(f) or ramps['neutral']; L = rgb2lab(px[x, y][:3])[0]
        l0, l1 = rng[f]; t = 0.5 if l1 - l0 < 1e-6 else (L - l0) / (l1 - l0)
        t = max(0, min(0.999, t ** gamma)); put(out, x, y, ramp[int(t * len(ramp))])
    if edge_ink:
        o = out.load(); res = out.copy(); ro = res.load()
        for (x, y) in fam:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                xx, yy = x + dx, y + dy
                if not (0 <= xx < w and 0 <= yy < h) or o[xx, yy][3] == 0:
                    if rgb2lab(px[x, y][:3])[0] < 0.55 and fam[(x, y)] != 'warm': ro[x, y] = RGB[ink] + (255,)
                    break
        out = res
    return out
