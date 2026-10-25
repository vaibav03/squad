"""Hand-pixeled night windmill (side view) + separate rotating sail strip."""
import math
from buildings_common import *

W, H = 48, 84
HUB = (24, 25)          # sail axle in body coords

def glow_fill(c, x0, y0, x1, y1, lit, dark_top='sky-mid'):
    hh = y1 - y0 + 1
    for y in range(y0, y1 + 1):
        t = (y - y0) / max(hh - 1, 1)
        for x in range(x0, x1 + 1):
            if lit: c.p(x, y, 'glow-core' if t < .12 else 'glow' if t < .85 else 'ember')
            else: c.p(x, y, dark_top if t < .15 else 'sky-deep')

def body(lit):
    c = Cv(W, H); cx = 24
    # --- stone base (y 66..83), light from upper-left: left lit, right shaded
    for y in range(66, 84):
        t = (y - 66) / 17; x0 = round(7 - 3 * t); x1 = round(40 + 3 * t)
        for x in range(x0, x1 + 1):
            c.p(x, y, 'wall-shade' if x < cx + 3 else 'hill-mid')
        row = (y - 66) // 4; off = 0 if row % 2 == 0 else 3
        if (y - 66) % 4 == 3:
            for x in range(x0, x1 + 1): c.p(x, y, 'hill-near' if x >= cx + 3 else 'hill-mid')
        else:
            for x in range(x0 + 1 + off, x1, 6): c.p(x, y, 'hill-near' if x >= cx + 3 else 'hill-mid')
        c.p(x0, y, 'wall-lit' if (y - 66) % 4 != 3 else 'wall-mid')
    # stone cap ledge
    c.hline(5, 42, 65, 'wall-mid'); c.hline(5, 42, 64, 'wall-shade')
    # --- tower body (y 26..64): trapezoid
    for y in range(26, 65):
        t = (y - 26) / 38; x0 = round(12 - 4 * t); x1 = round(35 + 4 * t)
        for x in range(x0, x1 + 1):
            c.p(x, y, 'wall-shade' if x <= cx + 1 else 'hill-mid')
        c.p(x0, y, 'wall-lit' if y % 5 else 'wall-mid')
        c.p(x0 + 1, y, 'wall-mid')
    # plaster flecks
    for (x, y) in ((16, 36), (17, 37), (22, 52), (14, 55), (21, 29), (30, 38), (31, 39), (28, 56)):
        c.p(x, y, 'wall-mid' if x <= cx + 1 else 'hill-near')
    # timber bands + corner posts
    for y in (44, 45):
        t = (y - 26) / 38; x0 = round(12 - 4 * t); x1 = round(35 + 4 * t)
        c.hline(x0, x1, y, 'wood' if y == 44 else 'wood-dark'); 
    c.hline(round(12 - 4 * 18 / 38), round(35 + 4 * 18 / 38), 43, 'wood-lit')
    for y in range(26, 65):
        t = (y - 26) / 38; x0 = round(12 - 4 * t); x1 = round(35 + 4 * t)
        c.p(x1, y, 'wood-dark'); c.p(x1 - 1, y, 'wood')
        c.p(x0, y, 'wood-lit'); 
    for y in range(62, 65):
        t = (y - 26) / 38; c.hline(round(12 - 4 * t), round(35 + 4 * t), y, 'wood' if y < 64 else 'wood-dark')
    # --- windows
    # big window on the lit face
    c.rect(14, 31, 22, 42, 'ink'); c.rect(15, 32, 21, 41, 'wood-dark')
    glow_fill(c, 16, 33, 20, 40, lit)
    c.vline(18, 33, 40, 'wood-dark'); c.hline(16, 20, 36, 'wood-dark')
    c.hline(13, 23, 43, 'wood-lit'); c.hline(13, 23, 44, 'wood')
    # small round loft window on the shade face
    c.rect(28, 51, 32, 56, 'ink'); glow_fill(c, 29, 52, 31, 55, lit, 'sky-deep')
    c.p(30, 52, 'glow-core' if lit else 'sky-mid'); c.hline(28, 32, 57, 'wood')
    # --- door in base
    c.rect(18, 72, 28, 83, 'ink'); c.rect(19, 71, 27, 71, 'ink'); c.rect(19, 72, 27, 83, 'wood-dark')
    for y in range(72, 84):
        c.p(22, y, 'wood'); c.p(25, y, 'wood')
    c.p(20, 73, 'wood'); c.p(26, 73, 'wood')
    c.hline(19, 27, 78, 'wood'); c.p(26, 79, 'wood-lit')
    if lit:
        for y in range(73, 84): c.p(23, y, 'glow'); c.p(24, y, 'glow') if y > 74 else None
        c.p(23, 73, 'glow-core'); c.p(24, 74, 'glow-core')
    # --- cap (cone roof) y 4..25
    for y in range(4, 26):
        half = round(1.4 + (y - 4) * (16.6 / 21))
        for x in range(cx - half, cx + half + 1):
            c.p(x, y, 'roof-wine' if x <= cx + 1 else 'roof-shade')
        # shingle texture
        if y % 3 == 0:
            for x in range(cx - half + 1, cx + half): 
                if (x + y) % 3 == 0: c.p(x, y, 'roof-shade' if x <= cx + 1 else 'ink')
        c.p(cx - half, y, 'wood-lit' if y % 2 else 'roof-wine')
    c.hline(cx - 18, cx + 18, 25, 'roof-shade'); c.hline(cx - 17, cx + 17, 24, 'roof-wine')
    c.hline(cx - 18, cx + 18, 26, 'wood-dark'); c.hline(cx - 17, cx + 17, 25, 'wood')
    c.p(cx, 2, 'wood-lit'); c.p(cx, 3, 'wood'); c.p(cx, 1, 'wood-lit')   # finial
    # axle head housing
    c.rect(cx - 2, 22, cx + 2, 28, 'wood'); c.rect(cx - 2, 22, cx - 2, 28, 'wood-lit'); c.rect(cx + 2, 22, cx + 2, 28, 'wood-dark')
    c.outline('ink')
    return c.im

# ------------------------------------------------------------------ sails
SS = 72; CEN = (SS // 2, SS // 2); LEN = 33

def sails_frame(deg):
    c = Cv(SS, SS); a0 = math.radians(deg)
    blades = [a0 + k * math.pi / 2 for k in range(4)]
    for y in range(SS):
        for x in range(SS):
            dx, dy = x + .5 - CEN[0], y + .5 - CEN[1]
            for a in blades:
                u = dx * math.sin(a) - dy * math.cos(a)      # along blade (blade 0 points up)
                v = dx * math.cos(a) + dy * math.sin(a)      # perpendicular (+ = trailing side, to the right)
                if 3 <= u <= LEN and abs(v) <= 1.0:
                    c.p(x, y, 'wood-lit' if v < 0 else 'wood'); 
                elif 8 <= u <= LEN - 1 and 1.0 < v <= 8.5:
                    edge = v > 7.4 or u > LEN - 2.2 or u < 9.1
                    lat = int(u) % 5 == 0
                    c.p(x, y, 'wood-lit' if edge else ('wall-lit' if lat else ('wall-mid' if v < 4.6 else 'wall-shade')))
    # hub
    c.ellipse(CEN[0], CEN[1], 3, 3, 'wood-lit'); c.ellipse(CEN[0], CEN[1], 1, 1, 'wood-dark')
    c.outline('ink')
    return c.im

def sail_strip(n=8):
    frames = [sails_frame(22.5 + k * 90 / n) for k in range(n)]
    strip = Image.new('RGBA', (SS * n, SS), (0, 0, 0, 0))
    for i, f in enumerate(frames): strip.alpha_composite(f, (i * SS, 0))
    return strip, frames
