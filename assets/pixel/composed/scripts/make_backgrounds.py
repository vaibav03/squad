#!/usr/bin/env python3
"""Squad Village parallax backgrounds (native 1x, palette-only, horizontally tileable).

Run:  python3 make_backgrounds.py   (from any cwd). Deterministic. Also runs the seam check
(backgrounds_seamcheck.py) and builds _preview-parallax.png / _contact-backgrounds.png.

Layer contract: 480x270 RGBA, ground line y=240, transparent where empty, bottom-anchored by the engine.
Exceptions: 0_sky* are 16x270 repeating column strips, 9_ground is 480x30 (rows below the line).
Every drawing call wraps x modulo 480, so tiling is seamless by construction.
"""
import json, math, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from PIL import Image
from palette import PALETTE, RGB

OUT = os.path.abspath(os.path.join(HERE, '..', 'backgrounds'))
W, H, GL = 480, 270, 240
TAU = math.pi * 2
INV = {v + (255,): k for k, v in RGB.items()}


class Cv:
    """Wrapping pixel canvas holding palette names (None = transparent)."""
    def __init__(self, w=W, h=H, wrap=True):
        self.w, self.h, self.wrap = w, h, wrap
        self.p = [[None] * w for _ in range(h)]
    def put(self, x, y, c):
        if 0 <= y < self.h:
            if self.wrap: x %= self.w
            elif not 0 <= x < self.w: return
            self.p[y][x] = c
    def get(self, x, y):
        if not 0 <= y < self.h: return None
        return self.p[y][x % self.w if self.wrap else x] if (self.wrap or 0 <= x < self.w) else None
    def rect(self, x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1): self.put(x, y, c)
    def img(self):
        im = Image.new('RGBA', (self.w, self.h), (0, 0, 0, 0)); px = im.load()
        for y in range(self.h):
            for x in range(self.w):
                c = self.p[y][x]
                if c: px[x, y] = RGB[c] + (255,)
        return im


def checker(x, y, ph=0): return (x + y + ph) % 2 == 0


# ----------------------------------------------------------------------------- sky strips
def sky_strip(bands, w=16, h=H):
    """bands: [(y_start, color)]; each boundary gets 6 rows of 2px ordered dither (25/50/75%)."""
    c = Cv(w, h, wrap=False)
    for y in range(h):
        i = max(k for k, (ys, _) in enumerate(bands) if ys <= y)
        for x in range(w): c.p[y][x] = bands[i][1]
    BAY = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
    for k in range(1, len(bands)):
        b, col = bands[k]
        L = min(10, b - (bands[k - 1][0] + 2)) if k else 24
        for r in range(L, 0, -1):
            y = b - r
            if y < 0: continue
            prob = 1 - (r - 1) / L     # 0 -> 1 across the transition
            y2 = (y - (b - L)) // 2
            for x in range(w):
                if BAY[y2 % 4][(x // 2) % 4] / 16.0 + 1 / 32 < prob: c.p[y][x] = col
    return c


SKY_NIGHT = [(0, 'sky-deep'), (70, 'sky-mid'), (104, 'sky-low'), (178, 'cloud-lo')]
SKY_DUSK = [(0, 'sky-deep'), (50, 'sky-mid'), (84, 'violet'), (87, 'roof-shade'), (112, 'roof-wine'), (142, 'ember'), (168, 'glow')]
SKY_DAWN = [(0, 'sky-deep'), (36, 'sky-mid'), (78, 'sky-low'), (112, 'cloud-lo'), (140, 'cloud-hi'), (162, 'glow'), (180, 'ember')]
SKY_DAY = [(0, 'sky-low'), (84, 'cloud-lo'), (150, 'cloud-hi')]


def fix_violet(c):
    """dusk: violet band is only a thin dithered streak, not a solid band"""
    for y in range(c.h):
        if c.p[y][0] == 'violet' and not (112 <= y < 124): pass
    return c


# ----------------------------------------------------------------------------- stars / moon
def stars():
    rnd = random.Random(7)
    pts = []
    # jittered grid so stars are even but not tiled-looking; denser toward the zenith
    for gx in range(0, W, 12):
        for gy in range(0, 156, 12):
            dens = 0.8 - gy / 156 * 0.7
            if rnd.random() < dens:
                pts.append((gx + rnd.randrange(12), gy + rnd.randrange(12)))
    rnd.shuffle(pts)
    sparkles = pts[:9]; twinklers = pts[9:9 + 34]; steady = pts[9 + 34:]
    return sparkles, twinklers, steady


def stars_frames():
    sparkles, twinklers, steady = stars()
    rnd = random.Random(11)
    ph = {p: rnd.randrange(4) for p in sparkles + twinklers}
    def frame(k):
        c = Cv()
        for i, (x, y) in enumerate(steady):
            c.put(x, y, 'cloud-hi' if i % 3 else 'moon')
        for (x, y) in twinklers:
            s = (ph[(x, y)] + k) % 4
            c.put(x, y, ['moon', 'cloud-hi', 'cloud-lo', None][s])
        for (x, y) in sparkles:
            s = (ph[(x, y)] + k) % 4
            if s == 0:
                c.put(x, y, 'moon')
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)): c.put(x + dx, y + dy, 'cloud-hi')
            elif s in (1, 3):
                c.put(x, y, 'moon')
            else:
                c.put(x, y, 'cloud-hi')
        return c
    def mask():
        c = Cv()
        for (x, y) in twinklers: c.put(x, y, 'moon')
        for (x, y) in sparkles:
            c.put(x, y, 'moon')
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)): c.put(x + dx, y + dy, 'cloud-hi')
        return c
    return [frame(k) for k in range(4)], mask()


def moon():
    S = 80; cx = cy = S // 2
    c = Cv(S, S, wrap=False)
    for y in range(S):
        for x in range(S):
            d = math.hypot(x - cx + .5, y - cy + .5)
            if d <= 26: c.p[y][x] = 'sky-mid' if d <= 24 or checker(x, y) else None
            if d <= 20: c.p[y][x] = 'sky-low' if d <= 18.5 or checker(x, y) else c.p[y][x]
    # dim earthshine on the dark side of the disc
    R = 14.5
    for y in range(S):
        for x in range(S):
            d = math.hypot(x - cx + .5, y - cy + .5)
            if d <= R:
                dc = math.hypot(x - (cx + 7) + .5, y - (cy - 3) + .5)
                if dc > 12.5:
                    c.p[y][x] = 'moon'
                    # inner terminator + lower limb shading
                    if dc < 14.5 or d > R - 1.2: c.p[y][x] = 'cloud-hi' if (dc < 14.5 and d > 6) or d > R - 1.2 else 'moon'
                else:
                    c.p[y][x] = 'cloud-hi' if d <= R - 1 and checker(x, y) and dc > 10.5 else 'cloud-lo' if d > R - 2 else 'cloud-lo'
    # re-light: outer limb bright, keep cloud-hi only as a thin terminator
    for y in range(S):
        for x in range(S):
            d = math.hypot(x - cx + .5, y - cy + .5); dc = math.hypot(x - (cx + 7) + .5, y - (cy - 3) + .5)
            if d <= R and dc > 12.5:
                c.p[y][x] = 'cloud-hi' if (dc < 14.2 or d > R - 1.1) and d > 3 else 'moon'
    for (x, y) in ((cx - 9, cy + 3), (cx - 8, cy + 4), (cx - 7, cy - 6), (cx - 11, cy - 1)):
        if c.p[y][x] == 'moon': c.p[y][x] = 'cloud-hi'
    return c


# ----------------------------------------------------------------------------- clouds
def cloud_shape(seed, w, h_peak, far):
    """returns (Cv sprite). Puffy union of circles with a flat-ish base; top-lit, darker underside."""
    rnd = random.Random(seed)
    pad = 3
    Wd, Hd = w + pad * 2, h_peak + pad * 2 + 4
    base = Hd - pad - 2
    circles = []
    n = 3 if w < 50 else 4
    xs = sorted(rnd.uniform(0.12, 0.88) for _ in range(n)) if False else [0.16 + 0.68 * i / (n - 1) for i in range(n)]
    big = rnd.randrange(1, n - 1)
    for i, t in enumerate(xs):
        r = h_peak * (0.62 if i == big else rnd.uniform(0.42, 0.52))
        circles.append((pad + t * w + rnd.uniform(-2, 2), base - r + rnd.uniform(-1, 2), r))
    circles.append((pad + 2 + h_peak * 0.2, base - h_peak * 0.2, h_peak * 0.24))
    circles.append((pad + w - 2 - h_peak * 0.2, base - h_peak * 0.2, h_peak * 0.24))
    body_y0 = base - h_peak * 0.38
    m = [[False] * Wd for _ in range(Hd)]
    for y in range(Hd):
        for x in range(Wd):
            if y > base: continue
            if any((x + .5 - cx) ** 2 + (y + .5 - cy) ** 2 <= r * r for cx, cy, r in circles) or (y >= body_y0 and pad + 3 <= x < Wd - pad - 3): m[y][x] = True
    def inm(x, y): return 0 <= x < Wd and 0 <= y < Hd and m[y][x]
    c = Cv(Wd, Hd, wrap=False)
    fill, shade, hi = ('cloud-lo', 'hill-far', 'cloud-hi') if far else ('cloud-hi', 'cloud-lo', 'cloud-hi')
    out_top = 'cloud-lo' if not far else 'hill-far'
    for y in range(Hd):
        for x in range(Wd):
            if m[y][x]:
                edge = not (inm(x - 1, y) and inm(x + 1, y) and inm(x, y - 1) and inm(x, y + 1))
                underside = (not inm(x, y + 3)) or (not inm(x + 2, y + 1) and not inm(x - 1, y + 4))
                under_deep = not inm(x, y + 2)
                lit = (not inm(x - 2, y - 2)) and (not inm(x - 3, y - 3) or True)
                if far:
                    col = fill
                    if lit and not edge: col = hi if checker(x, y) or not inm(x - 3, y - 3) else fill
                    if underside: col = shade if (under_deep or checker(x, y)) else fill
                else:
                    col = fill
                    if underside: col = shade if (under_deep or checker(x, y)) else fill
                    if edge and not inm(x, y + 1): col = 'hill-far'
                    elif edge and not underside: col = fill
                c.p[y][x] = col
    # outline (outside the shape) top/sides: soft
    for y in range(Hd):
        for x in range(Wd):
            if not m[y][x] and (inm(x, y + 1) or inm(x - 1, y) or inm(x + 1, y)) and y <= base + 1:
                if inm(x, y - 1) and not inm(x, y + 1): c.p[y][x] = 'hill-far'  # shouldn't happen
                else: c.p[y][x] = out_top if not far else None
    # flat underline
    for x in range(Wd):
        if m[base][x] if base < Hd else False: c.p[base + 1][x] = 'hill-far' if not far else 'hill-far'
    return c


CLOUD_SPECS_FAR = [(101, 36, 13), (102, 28, 10), (103, 44, 14), (104, 32, 11), (105, 40, 12), (106, 26, 9)]
CLOUD_SPECS_NEAR = [(201, 56, 22), (202, 44, 17), (203, 66, 24), (204, 48, 19), (205, 58, 21)]
# (x, y) of sprite top-left in the 480 layer. Irregular rhythm, both heights.
CLOUD_POS_FAR = [(72, 134), (128, 118), (196, 80), (286, 104), (352, 88), (430, 112)]
CLOUD_POS_NEAR = [(4, 100), (148, 52), (236, 46), (336, 66), (410, 44)]


def clouds_layer(specs, pos, far):
    c = Cv(); sprites = []
    for (seed, w, h), (px, py) in zip(specs, pos):
        s = cloud_shape(seed, w, h, far); sprites.append(s)
        for y in range(s.h):
            for x in range(s.w):
                if s.p[y][x]: c.put(px + x, py + y, s.p[y][x])
    return c, sprites


# ----------------------------------------------------------------------------- hills
def ridge(base, comps, seed):
    rnd = random.Random(seed)
    ph = [rnd.uniform(0, TAU) for _ in comps]
    return [base + sum(a * math.sin(TAU * k * x / W + p) for (k, a), p in zip(comps, ph)) for x in range(W)]


def rr(R, x): return int(round(R[x % W]))


def snow_ridge(c, R, body, lo, hi, seed, thick=1.0, ph=0.0):
    for x in range(W):
        top = rr(R, x); slope = R[(x + 3) % W] - R[(x - 3) % W]
        lit = slope < -0.5; shadow = slope > 1.2
        drift = 2.4 * math.sin(TAU * 11 * x / W + ph) + 1.8 * math.sin(TAU * 17 * x / W + seed)
        t_hi = (2.5 + min(5, max(0, -slope * 1.2)) + max(0, drift)) * thick
        for y in range(top, H):
            d = y - top
            if d < t_hi - 1: col = hi
            elif d < t_hi + 1 and checker(x, y): col = hi
            elif d < t_hi + 4: col = lo
            elif d < t_hi + 7: col = lo if checker(x, y) else body
            else: col = body
            if d > 40 and body == 'hill-far': col = 'hill-mid'
            elif d > 30 and body == 'hill-far' and checker(x, y): col = 'hill-mid'
            c.p[y][x] = col


def hills_far():
    R1 = ridge(170, [(1, 7), (2, 6), (3, 4), (6, 2), (9, 1)], 12)    # back ridge, taller peaks
    R2 = ridge(192, [(1, 6), (2, 6), (3, 4), (5, 2.5), (8, 1.2)], 5)  # front ridge
    c = Cv()
    # back ridge: paler, hazier
    for x in range(W):
        top = rr(R1, x); slope = R1[(x + 3) % W] - R1[(x - 3) % W]
        t_hi = 3 + min(5, max(0, -slope * 1.2)) + max(0, 2.0 * math.sin(TAU * 13 * x / W + 2))
        for y in range(top, H):
            d = y - top
            col = 'cloud-hi' if d < t_hi - 1 or (d < t_hi + 1 and checker(x, y)) else 'cloud-lo' if d < t_hi + 5 else 'hill-far'
            if d >= t_hi + 5 and d < t_hi + 8 and checker(x, y): col = 'cloud-lo'
            c.p[y][x] = col
    snow_ridge(c, R2, 'hill-far', 'cloud-lo', 'cloud-hi', 1.7, 1.0, 1.3)
    return c, R2


def pine(c, x, base, h, body, hi=None, sub=None):
    """pixel pine: tiered triangle, trunk 1-2px, optional lit left edge"""
    tiers = max(3, h // 6); th = h / tiers
    for r in range(h):
        i = int(r // th); j = r - i * th
        hw = int(0.6 + (i + 0.55 + j / th * 0.9) * (h * 0.33 / tiers))
        hw = max(hw, 0)
        for dx in range(-hw, hw + 1):
            col = body
            if hi and dx <= -hw + 0 and hw >= 1: col = hi
            c.put(x + dx, base - h + r, col)
    for y in range(base - 2, base + 2):
        c.put(x, y, 'wood-dark');
    return c


def hills_mid():
    R = ridge(203, [(3, 5), (4, 3), (7, 3), (10, 1.5), (1, 2)], 21)
    c = Cv()
    for x in range(W):
        top = rr(R, x); slope = R[(x + 3) % W] - R[(x - 3) % W]
        for y in range(top, H):
            d = y - top
            col = 'hill-mid'
            if d == 0: col = 'hill-far'
            elif d == 1 and (slope < 0 or checker(x, y)): col = 'hill-far'
            elif d == 2 and slope < -0.7 and checker(x, y): col = 'hill-far'
            if d > 22 and (y > 226): col = 'hill-mid' if d < 28 or not checker(x, y) else 'hill-near'
            if d > 30: col = 'hill-near'
            c.p[y][x] = col
    rnd = random.Random(33)
    # pine clusters, irregular rhythm
    xs = [9, 22, 31, 77, 96, 103, 171, 180, 187, 195, 253, 331, 340, 349, 421, 433, 441]
    for x in xs:
        h = rnd.randrange(18, 32)
        pine(c, x, rr(R, x) + 3, h, 'leaf-dark', None)
        # moon rim: lit pixel run on left edge (1px) via cloud-lo dots near tips
        c.put(x - 1, rr(R, x) + 3 - h + 3, 'leaf-lit')
    return c, R


def round_tree(c, cx, base, rad, rnd):
    """big round canopy: leaf-dark mass, ink outline, leaf-lit upper-left highlight clumps, trunk"""
    n = 5
    circles = [(cx, base - rad * 1.55, rad)]
    for i in range(n - 1):
        a = TAU * i / (n - 1) + .4
        circles.append((cx + math.cos(a) * rad * .62, base - rad * 1.45 + math.sin(a) * rad * .5, rad * .62))
    x0, x1 = int(cx - rad * 1.5) - 2, int(cx + rad * 1.5) + 2
    y0, y1 = int(base - rad * 3) - 2, int(base)
    inside = {}
    for y in range(y0, y1):
        for x in range(x0, x1):
            inside[(x, y)] = any((x + .5 - a) ** 2 + (y + .5 - b) ** 2 <= r * r for a, b, r in circles)
    # trunk
    tw = max(2, rad // 5)
    for y in range(int(base - rad * 1.0), base + 2):
        for dx in range(-tw // 2, tw - tw // 2 + 1):
            c.put(cx + dx, y, 'wood-dark')
    for (x, y), v in inside.items():
        if v: c.put(x, y, 'leaf-dark')
    for (x, y), v in inside.items():
        if not v and any(inside.get((x + dx, y + dy)) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            c.put(x, y, 'ink')
    # highlight clumps: pixels whose down-right neighbour (3px) is inside and up-left is outside
    for (x, y), v in inside.items():
        if not v: continue
        ul = inside.get((x - 2, y - 2)); ul2 = inside.get((x - 4, y - 4))
        if not ul2 and inside.get((x + 3, y + 3)):
            if ((x * 7 + y * 13) % 5) < 3 and checker(x, y): c.put(x, y, 'leaf-lit')
        elif not ul and ((x * 3 + y * 5) % 7 == 0): c.put(x, y, 'leaf-lit')
    # leafy sparkle clumps on the mass
    for _ in range(int(rad * 1.4)):
        a = rnd.uniform(0, TAU); d = rnd.uniform(.1, .85) * rad
        x = int(cx + math.cos(a) * d * 1.2 - rad * .2); y = int(base - rad * 1.55 + math.sin(a) * d)
        if inside.get((x, y)) and (x + y) % 2 == 0 and inside.get((x - 2, y - 1)):
            c.put(x, y, 'leaf-lit'); c.put(x + 1, y, 'leaf-lit')
    # underside shade dither
    for (x, y), v in inside.items():
        if v and not inside.get((x, y + 3)) and checker(x, y) and c.get(x, y) == 'leaf-dark': c.put(x, y, 'ink')


def hills_near():
    R = ridge(219, [(1, 3), (2, 4), (3, 3), (5, 1.8), (7, 1.0)], 41)
    c = Cv()
    for x in range(W):
        top = rr(R, x); slope = R[(x + 3) % W] - R[(x - 3) % W]
        for y in range(top, H):
            d = y - top
            col = 'hill-near'
            if d == 0: col = 'hill-mid'
            elif d == 1 and (slope < 0.3 or checker(x, y)): col = 'hill-mid'
            elif d == 2 and slope < -0.5 and checker(x, y): col = 'hill-mid'
            if d > 9: col = 'hill-near' if d < 14 or not checker(x, y) else 'ground'
            if d > 15: col = 'ground'
            c.p[y][x] = col
    rnd = random.Random(55)
    for x, rad in ((30, 16), (112, 10), (189, 14), (251, 9), (338, 19), (433, 12)):
        round_tree(c, x, rr(R, x) + 2, rad, rnd)
    for x, h in ((84, 34), (168, 26), (262, 38), (366, 28), (452, 34)):
        pine(c, x, rr(R, x) + 3, h, 'leaf-dark', 'leaf-lit' if False else None)
        c.put(x - 1, rr(R, x) + 3 - h + 4, 'leaf-lit'); c.put(x - 2, rr(R, x) + 3 - h + 9, 'leaf-lit')
    return c, R


# ----------------------------------------------------------------------------- fence
def fence():
    c = Cv()
    rnd = random.Random(77)
    px = []
    x = 6
    while x < W - 12:
        px.append(x); x += 24 + rnd.choice((-2, 0, 0, 2))
    # adjust last gap so the spacing wraps cleanly
    gap = (px[0] + W - px[-1])
    if gap < 20 or gap > 28: px.pop()
    top_rail, low_rail = 230, 236
    n = len(px)
    for i, x in enumerate(px):
        nxt = px[(i + 1) % n] + (W if i == n - 1 else 0)
        # rails (2px thick, rim-lit on top row) with a broken/missing section
        skip = (i == 7)
        for rail in (top_rail, low_rail):
            if skip and rail == top_rail: continue
            wob = rnd.choice((0, 0, 0, 1)) if False else 0
            for xx in range(x + 1, nxt):
                c.put(xx, rail, 'wood' if (xx - x) % 9 in (3, 4, 5, 6) else 'wood-dark')
                c.put(xx, rail + 1, 'wood-dark')
                c.put(xx, rail + 2, 'ink' if (xx + rail) % 3 else 'wood-dark') if False else None
        # post: 3 wide, top at varied height, pointed cap
        h = rnd.choice((15, 16, 17, 16)); top = GL - h
        lean = rnd.choice((0, 0, 0, 1))
        for y in range(top, GL + 1):
            xl = x + (lean if y < top + 5 else 0)
            c.put(xl, y, 'wood'); c.put(xl + 1, y, 'wood-dark'); c.put(xl + 2, y, 'wood-dark'); c.put(xl + 3, y, 'ink')
            if y >= GL - 1: c.put(xl, y, 'wood-dark')
        xl = x + lean
        c.put(xl + 1, top - 1, 'cloud-lo'); c.put(xl, top, 'cloud-lo'); c.put(xl + 1, top, 'wood')
        c.put(xl, top + 1, 'cloud-lo'); c.put(xl, top + 2, 'wood'); c.put(xl + 2, top, 'wood-dark')
        for y in range(top + 3, top + 8, 2): c.put(xl, y, 'wood-lit')
        # shadow tuft at foot
        c.put(x - 1, GL, 'ink'); c.put(x + 3, GL, 'ink')
    return c


# ----------------------------------------------------------------------------- ground (480x30)
def ground():
    c = Cv(W, 30)
    rnd = random.Random(91)
    def et_(x): return 2 + int(round(1.0 * math.sin(TAU * 3 * x / W + .5) + 0.7 * math.sin(TAU * 7 * x / W + 2)))
    def eb_(x): return 22 + int(round(1.0 * math.sin(TAU * 4 * x / W + 1.1) + 0.6 * math.sin(TAU * 9 * x / W)))
    for x in range(W):
        et, eb = et_(x), eb_(x)
        for y in range(30):
            if y < et: col = 'leaf-dark'
            elif y <= eb: col = 'wood-dark'
            else: col = 'leaf-dark'
            c.p[y][x] = col
        # grass lip along the ground line
        c.p[0][x] = 'leaf-lit'
        c.p[1][x] = 'leaf-lit' if x % 3 == 0 else 'leaf-dark'
        # path: lit upper edge, shaded lower half, dark bottom edge
        c.p[et][x] = 'wood-lit'
        if et + 1 <= eb: c.p[et + 1][x] = 'wood' if checker(x, et) else 'wood-lit'
        for y in range(et + 2, et + 6):
            c.p[y][x] = 'wood' if (y == et + 2 or checker(x, y)) else 'wood-dark'
        c.p[eb][x] = 'wood-dark'
        for y in range(eb + 1, 30):
            c.p[y][x] = 'leaf-dark' if y > eb + 1 else 'ink'
    for _ in range(70):
        x = rnd.randrange(W); y = rnd.randrange(6, 20)
        if c.p[y][x] == 'wood-dark':
            c.p[y][x] = 'wood' if rnd.random() < .7 else 'wood-lit'
    # wheel ruts
    for x in range(W):
        for y in (13, 18):
            if c.p[y][x] == 'wood-dark' and (x // 3) % 4 != 0: c.p[y][x] = 'ground'
    # sparse grass tufts: top lawn and bottom verge
    def tuft(x, y, t):
        for dx, hh in ((-1, t - 1), (0, t), (1, t - 1)):
            for k in range(hh): c.put(x + dx, y - k, 'leaf-lit' if k == hh - 1 else 'leaf-dark')
    for x in range(8, W, 31):
        x += rnd.randrange(-6, 7); tuft(x, 2, 3)
    for x in range(14, W, 23):
        x += rnd.randrange(-5, 6); tuft(x, 29, 3) if rnd.random() < .7 else None
    # flowers (few, readable)
    for i in range(14):
        x = rnd.randrange(W); y = rnd.choice((2, 26, 27))
        col = rnd.choice(('moon', 'cloud-hi', 'violet', 'glow'))
        c.put(x, y, col); c.put(x, y + 1, 'leaf-lit')
    # pebbles on the lane
    for _ in range(9):
        x = rnd.randrange(W); y = rnd.randrange(8, 19)
        c.put(x, y, 'cloud-lo'); c.put(x + 1, y, 'wall-shade'); c.put(x, y + 1, 'wall-shade'); c.put(x + 1, y + 1, 'wood-dark')
    return c


# ----------------------------------------------------------------------------- foreground
def foreground():
    c = Cv()
    rnd = random.Random(123)
    def blade(x, base, h, lean, col):
        for k in range(h):
            xx = x + int(lean * (k / max(1, h)) * 3)
            c.put(xx, base - k, col)
            if k < h * 0.55: c.put(xx + 1, base - k, col)
    def bush(x, base, w, hgt):
        for dx in range(-w, w + 1):
            hh = int(hgt * math.sqrt(max(0, 1 - (dx / (w + .5)) ** 2)) * (0.85 + 0.3 * abs(math.sin(dx * 1.7))))
            for k in range(hh): c.put(x + dx, base - k, 'ink' if k < hh - 1 or dx % 2 else 'leaf-dark')
        for k in range(3):
            c.put(x - w // 3 + k * 2, base - hgt + 1 + k, 'leaf-dark')
    clusters = [(24, 'bush', 9, 9), (86, 'tuft', 0, 0), (140, 'tuft', 0, 0), (196, 'bush', 7, 7), (262, 'tuft', 0, 0),
                (322, 'bush', 11, 10), (388, 'tuft', 0, 0), (440, 'tuft', 0, 0)]
    for x, kind, w, hgt in clusters:
        if kind == 'bush': bush(x, H - 1, w, hgt)
        else:
            for i in range(rnd.randrange(5, 8)):
                blade(x + rnd.randrange(-6, 7), H - 1, rnd.randrange(5, 14), rnd.uniform(-1, 1), 'ink' if i % 3 else 'leaf-dark')
    # a low continuous fringe at the very bottom so the screen edge feels grounded
    for x in range(W):
        hh = 2 + int(1.2 * (math.sin(TAU * 31 * x / W) + 1)) + (1 if x % 5 == 0 else 0)
        for k in range(hh): c.put(x, H - 1 - k, 'ink')
    # few lit glints (moon rim) on blade tips
    for x in range(0, W, 37):
        c.put(x, H - 6 - (x % 4), 'leaf-dark')
    # a pair of bones (no skulls): tiny, bottom-left of the path
    for (bx, by) in ((150, H - 5), (352, H - 4)):
        for k in range(6): c.put(bx + k, by, 'cloud-lo' if k % 5 else 'cloud-hi')
        c.put(bx - 1, by - 1, 'cloud-hi'); c.put(bx - 1, by + 1, 'cloud-hi'); c.put(bx + 6, by - 1, 'cloud-lo'); c.put(bx + 6, by + 1, 'cloud-lo')
    return c


# ----------------------------------------------------------------------------- write / verify
PAL_RGBA = {v + (255,) for v in RGB.values()}


def verify(path):
    im = Image.open(path).convert('RGBA'); bad = 0
    for p in im.get_flattened_data() if hasattr(im,'get_flattened_data') else im.getdata():
        if p[3] == 0: continue
        if p not in PAL_RGBA: bad += 1
    if bad: raise SystemExit(f'PALETTE VIOLATION {path}: {bad} px')


def put_file(rel, im, files):
    p = os.path.join(OUT, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    im.save(p); verify(p); files.append((rel, im.size))


def main():
    files = []
    sf = lambda rel, c: put_file(rel, c.img() if isinstance(c, Cv) else c, files)
    sf('0_sky.png', sky_strip(SKY_NIGHT))
    sf('0_sky_dusk.png', sky_strip(SKY_DUSK))
    sf('0_sky_dawn.png', sky_strip(SKY_DAWN))
    sf('0_sky_day.png', sky_strip(SKY_DAY))
    frames, mask = stars_frames()
    sf('1_stars.png', frames[0])
    for k, f in enumerate(frames): sf(f'1_stars_twinkle_{k}.png', f)
    sf('1_stars_twinkle_mask.png', mask)
    sf('2_moon.png', moon())
    far, far_sp = clouds_layer(CLOUD_SPECS_FAR, CLOUD_POS_FAR, True)
    near, near_sp = clouds_layer(CLOUD_SPECS_NEAR, CLOUD_POS_NEAR, False)
    sf('3_clouds_far.png', far); sf('4_clouds_near.png', near)
    for i, s in enumerate(far_sp): sf(f'clouds/far_{i}.png', s)
    for i, s in enumerate(near_sp): sf(f'clouds/near_{i}.png', s)
    sf('5_hills_far.png', hills_far()[0]); sf('6_hills_mid.png', hills_mid()[0]); sf('7_hills_near.png', hills_near()[0])
    sf('8_fenceline.png', fence()); sf('9_ground.png', ground()); sf('10_foreground.png', foreground())
    write_meta(files)
    import backgrounds_seamcheck, backgrounds_preview
    backgrounds_seamcheck.run(OUT)
    backgrounds_preview.run(OUT)
    print('ok', len(files), 'files')


def write_meta(files):
    scroll = {'0_sky': 0, '1_stars': 0.02, '2_moon': 0.02, '3_clouds_far': 0.1, '4_clouds_near': 0.2, '5_hills_far': 0.3,
              '6_hills_mid': 0.45, '7_hills_near': 0.6, '8_fenceline': 0.9, '9_ground': 1.0, '10_foreground': 1.2}
    prov = {
        'license': 'Original hand-pixeled procedural art generated by make_backgrounds.py (no third-party sources); palette-only.',
        'tile': {'width': W, 'height': H, 'ground_line_y': GL, 'anchor': 'bottom', 'x_wrap': True},
        'layers': {
            '0_sky': {'file': '0_sky.png', 'size': [16, H], 'scrollFactor': 0, 'repeat': 'x (stretch/tile 16px column)', 'note': 'banded 2px-dither gradient; also 0_sky_dusk/dawn/day'},
            '1_stars': {'file': '1_stars.png', 'size': [W, H], 'scrollFactor': 0.02, 'twinkle': ['1_stars_twinkle_0..3.png (cycle ~400ms/frame)', '1_stars_twinkle_mask.png (pixels that animate)']},
            '2_moon': {'file': '2_moon.png', 'size': [80, 80], 'scrollFactor': 0.02, 'origin': [0.5, 0.5], 'note': 'anchored sprite; crescent 29px, halo r=33; suggest position (86,56) of a 427x240 view'},
            '3_clouds_far': {'file': '3_clouds_far.png', 'size': [W, H], 'scrollFactor': 0.1, 'sprites': 'clouds/far_*.png', 'drift': 'slow +x'},
            '4_clouds_near': {'file': '4_clouds_near.png', 'size': [W, H], 'scrollFactor': 0.2, 'sprites': 'clouds/near_*.png', 'drift': 'slow +x'},
            '5_hills_far': {'file': '5_hills_far.png', 'size': [W, H], 'scrollFactor': 0.3},
            '6_hills_mid': {'file': '6_hills_mid.png', 'size': [W, H], 'scrollFactor': 0.45},
            '7_hills_near': {'file': '7_hills_near.png', 'size': [W, H], 'scrollFactor': 0.6},
            '8_fenceline': {'file': '8_fenceline.png', 'size': [W, H], 'scrollFactor': 0.9, 'note': 'posts stand on y=240'},
            '9_ground': {'file': '9_ground.png', 'size': [W, 30], 'scrollFactor': 1.0, 'origin_y': 'top at y=240 (== bottom-anchored in a 270 world)'},
            '10_foreground': {'file': '10_foreground.png', 'size': [W, H], 'scrollFactor': 1.2, 'depth': 'in front of characters; content only in bottom ~25px'},
        },
        'scrollFactors': scroll,
        'generator': 'assets/pixel/composed/scripts/make_backgrounds.py',
    }
    json.dump(prov, open(os.path.join(OUT, 'provenance.json'), 'w'), indent=2)
    ramps = {
        'description': ('Time-of-day support. The engine keeps the same layer art and (a) swaps the sky strip, (b) multiplies a flat tint overlay '
                        'on listed layers: tint = {color: palette name, alpha: 0..1} drawn with normal blend over the layer (clipped to its opaque '
                        'pixels). DUSK overlays ember (low alpha) and roof-wine on hills/clouds; DAWN overlays cloud-hi and glow. Window/light '
                        'layers (buildings with glowing windows, lanterns, chimney smoke glow) are NEVER tinted. Stars fade to alpha 0 at day, '
                        'moon is hidden at day (dusk: moon visible, dawn: moon low alpha 0.6). Only palette colors are used.'),
        'sky': {'night': '0_sky.png', 'dusk': '0_sky_dusk.png', 'dawn': '0_sky_dawn.png', 'day': '0_sky_day.png'},
        'day_replace_colors': {'sky-deep': 'sky-low', 'sky-mid': 'cloud-lo', 'sky-low': 'cloud-hi', 'note': 'applies to buildings/props that use sky colors for unlit windows'},
        'layers': {
            '1_stars':      {'dusk': {'alpha': 0.5}, 'dawn': {'alpha': 0.35}, 'day': {'alpha': 0.0}},
            '2_moon':       {'dusk': {'alpha': 1.0}, 'dawn': {'alpha': 0.6}, 'day': {'alpha': 0.0}},
            '3_clouds_far': {'dusk': {'tint': 'roof-wine', 'alpha': 0.35}, 'dawn': {'tint': 'cloud-hi', 'alpha': 0.25}, 'day': {'tint': 'cloud-hi', 'alpha': 0.45}},
            '4_clouds_near': {'dusk': {'tint': 'ember', 'alpha': 0.30}, 'dawn': {'tint': 'glow', 'alpha': 0.22}, 'day': {'tint': 'cloud-hi', 'alpha': 0.35}},
            '5_hills_far':  {'dusk': {'tint': 'roof-wine', 'alpha': 0.35}, 'dawn': {'tint': 'cloud-hi', 'alpha': 0.28}, 'day': {'tint': 'cloud-lo', 'alpha': 0.30}},
            '6_hills_mid':  {'dusk': {'tint': 'roof-shade', 'alpha': 0.25}, 'dawn': {'tint': 'cloud-lo', 'alpha': 0.22}, 'day': {'tint': 'hill-far', 'alpha': 0.28}},
            '7_hills_near': {'dusk': {'tint': 'roof-shade', 'alpha': 0.20}, 'dawn': {'tint': 'cloud-lo', 'alpha': 0.16}, 'day': {'tint': 'hill-mid', 'alpha': 0.22}},
            '8_fenceline':  {'dusk': {'tint': 'ember', 'alpha': 0.18}, 'dawn': {'tint': 'glow', 'alpha': 0.15}, 'day': {'tint': 'wood-lit', 'alpha': 0.20}},
            '9_ground':     {'dusk': {'tint': 'ember', 'alpha': 0.12}, 'dawn': {'tint': 'glow', 'alpha': 0.10}, 'day': {'tint': 'leaf-lit', 'alpha': 0.18}},
            '10_foreground': {'dusk': {'tint': 'roof-shade', 'alpha': 0.15}, 'dawn': {'tint': 'sky-mid', 'alpha': 0.10}, 'day': {'tint': 'leaf-dark', 'alpha': 0.10}},
        },
        'never_tint': ['windows', 'lanterns', 'chimney-smoke-glow', 'ui'],
        'sky_overlay': {'dusk': {'color': 'ember', 'alpha': 0.0, 'note': 'sky strip already carries the dusk bands'}, 'dawn': {'color': 'glow', 'alpha': 0.0}},
        'transition': 'crossfade the sky strips over ~6s (alpha); tint alphas lerp linearly; palette-only at rest.',
    }
    json.dump(ramps, open(os.path.join(OUT, 'ramps.json'), 'w'), indent=2)


if __name__ == '__main__':
    main()
