"""Hand-pixel kit in the Autumn Town night style (two-tone walls, ink outline, light from upper-left)."""
from buildings_common import *

def wall(c, x0, y0, x1, y1, tone='plaster', split=.58, fleck=True):
    lit, shade = ('wall-shade', 'hill-mid') if tone == 'plaster' else ('wall-mid', 'wall-shade')
    sx = x0 + int((x1 - x0) * split)
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1): c.p(x, y, lit if x <= sx else shade)
    rim = 'wall-lit' if tone != 'plaster' else 'wall-mid'
    c.vline(x0, y0, y1, rim)
    if fleck:
        n = 0
        for y in range(y0 + 3, y1 - 2, 5):
            for x in range(x0 + 2, x1 - 2, 7):
                if (x * 7 + y * 13) % 11 < 3:
                    c.p(x, y, 'wall-mid' if x <= sx else 'hill-near'); c.p(x + 1, y, 'wall-mid' if x <= sx else 'hill-near')

def bricks(c, x0, y0, x1, y1, tone='stone'):
    lit, shade = ('wall-mid', 'wall-shade')
    mortar, mortar2 = 'wall-shade', 'hill-mid'
    for y in range(y0, y1 + 1):
        r = (y - y0) // 4
        for x in range(x0, x1 + 1):
            c.p(x, y, lit if (x - x0) < (x1 - x0) * .6 else shade)
        if (y - y0) % 4 == 3:
            for x in range(x0, x1 + 1): c.p(x, y, mortar if (x - x0) < (x1 - x0) * .6 else mortar2)
        else:
            for x in range(x0 + (0 if r % 2 == 0 else 3), x1 + 1, 6): c.p(x, y, mortar if (x - x0) < (x1 - x0) * .6 else mortar2)
    c.vline(x0, y0, y1, 'wall-lit')

def glow_rect(c, x0, y0, x1, y1, lit, mull=True):
    hh = y1 - y0 + 1
    for y in range(y0, y1 + 1):
        t = (y - y0) / max(hh - 1, 1)
        for x in range(x0, x1 + 1):
            if lit: c.p(x, y, 'glow-core' if t < .12 else 'glow' if t < .86 else 'ember')
            else: c.p(x, y, 'sky-mid' if t < .15 else 'sky-deep')
    if mull and x1 - x0 >= 4:
        mx = (x0 + x1) // 2; c.vline(mx, y0, y1, 'wood-dark')
        if hh >= 8: c.hline(x0, x1, y0 + hh // 2 - 1, 'wood-dark')

def window(c, x0, y0, w, h, lit, arched=False, color='glow', sill=True):
    x1, y1 = x0 + w - 1, y0 + h - 1
    c.rect(x0 - 1, y0 - 1, x1 + 1, y1 + 1, 'ink'); c.rect(x0, y0, x1, y1, 'wood-dark')
    glow_rect(c, x0 + 1, y0 + 1, x1 - 1, y1 - 1, lit)
    if arched:
        for (dx, dy) in ((0, 0), (1, 0), (0, 1)): c.p(x0 + 1 + dx, y0 + 1 + dy, 'wood-dark'); c.p(x1 - 1 - dx, y0 + 1 + dy, 'wood-dark')
    if sill: c.hline(x0 - 2, x1 + 2, y1 + 2, 'ink'); c.hline(x0 - 1, x1 + 1, y1 + 1, 'wood-lit')
    if lit: c.p(x0 - 1, y0 - 1, 'ink')

def door(c, x0, y0, w, h, lit=True, arched=True, open_=False):
    x1, y1 = x0 + w - 1, y0 + h - 1
    c.rect(x0 - 1, y0 - 1, x1 + 1, y1, 'ink')
    if arched:
        for (dx, dy) in ((0, 0), (1, 0), (2, 0), (0, 1), (1, 1), (0, 2)): c.p(x0 - 1 + dx, y0 - 1 + dy, None); c.p(x1 + 1 - dx, y0 - 1 + dy, None)
        for (dx, dy) in ((1, 0), (2, 0), (0, 1), (0, 2)): pass
        c.hline(x0 + 2, x1 - 2, y0 - 1, 'ink'); c.p(x0 + 1, y0, 'ink'); c.p(x1 - 1, y0, 'ink'); c.p(x0, y0 + 1, 'ink'); c.p(x1, y0 + 1, 'ink')
    c.rect(x0, y0, x1, y1, 'wood-dark')
    if arched:
        for (dx, dy) in ((0, 0), (1, 0), (0, 1)): c.p(x0 + dx, y0 + dy, 'ink'); c.p(x1 - dx, y0 + dy, 'ink')
    for x in range(x0 + 2, x1, 3): c.vline(x, y0 + 2, y1, 'wood')
    c.hline(x0, x1, y0 + h // 2, 'wood-dark'); c.hline(x0, x1, y0 + h // 2 + 1, 'wood')
    c.p(x1 - 2, y0 + h // 2 + 3, 'wood-lit')
    if lit:
        c.vline(x0 + w // 2, y0 + 3, y1, 'glow'); c.vline(x0 + w // 2 - 1, y0 + 4, y1, 'ember') if w > 6 else None
        c.p(x0 + w // 2, y0 + 3, 'glow-core')

def door_open_lit(c, x0, y0, w, h):
    """open door: warm interior seen through the opening"""
    x1, y1 = x0 + w - 1, y0 + h - 1
    c.rect(x0 - 1, y0 - 1, x1 + 1, y1, 'ink')
    c.rect(x0, y0, x1, y1, 'ember')
    for y in range(y0, y1 + 1):
        t = (y - y0) / max(h - 1, 1)
        for x in range(x0, x1 + 1): c.p(x, y, 'glow' if t < .6 else 'ember')
    c.hline(x0, x1, y0, 'glow-core'); c.hline(x0, x1, y1 - 1, 'wood-lit')

def gable(c, x0, x1, ybase, yapex, shade_split=.5, over=2):
    """symmetric gable roof; returns apex x"""
    cx = (x0 + x1) // 2; hh = ybase - yapex
    for y in range(yapex, ybase + 1):
        t = (y - yapex) / max(hh, 1); half = int((cx - x0 + over) * t)
        for x in range(cx - half, cx + half + 1):
            c.p(x, y, 'roof-wine' if x <= cx + 1 else 'roof-shade')
        c.p(cx - half, y, 'wood-lit' if y % 2 else 'roof-wine')
        if (y - yapex) % 3 == 2:
            for x in range(cx - half + 2, cx + half - 1, 2): c.p(x, y, 'roof-shade' if x <= cx + 1 else 'ink')
    c.hline(cx - (cx - x0 + over), cx + (cx - x0 + over), ybase, 'wood-dark')
    return cx

def shed_roof(c, x0, x1, y, thick=4, over=2, tone='wine'):
    for yy in range(y, y + thick):
        for x in range(x0 - over, x1 + over + 1):
            c.p(x, yy, 'roof-wine' if yy < y + thick - 1 else 'roof-shade')
        if (yy - y) % 2 == 1:
            for x in range(x0 - over + 1, x1 + over, 3): c.p(x, yy, 'roof-shade')
    c.hline(x0 - over, x1 + over, y, 'wood-lit')
    c.hline(x0 - over, x1 + over, y + thick, 'wood-dark')

def col(c, x, y0, y1, w=5, tone='pale'):
    for y in range(y0, y1 + 1):
        for i in range(w):
            c.p(x + i, y, 'wall-lit' if i == 0 else ('wall-mid' if i < w - 2 else 'wall-shade' if i == w - 2 else 'hill-mid'))
    for i in range(w + 2): c.p(x - 1 + i, y0, 'wall-lit' if i < 3 else 'wall-mid'); c.p(x - 1 + i, y0 + 1, 'wall-mid' if i < 3 else 'wall-shade')
    for i in range(w + 2): c.p(x - 1 + i, y1, 'wall-mid' if i < 3 else 'wall-shade'); c.p(x - 1 + i, y1 - 1, 'wall-mid' if i < 3 else 'wall-shade')
    c.vline(x + w, y0, y1, 'ink'); c.vline(x - 1, y0 + 2, y1 - 2, 'ink')

def lantern(c, x, y, lit=True, color='glow', chain=3):
    c.vline(x, y - chain, y - 1, 'ink')
    c.rect(x - 1, y, x + 1, y + 3, 'ink')
    core = 'cloud-hi' if color == 'violet' else 'glow-core'
    mid = 'violet' if color == 'violet' else 'glow'
    c.rect(x, y + 1, x, y + 2, core if lit else 'sky-mid'); 
    if lit:
        c.p(x - 1, y + 1, mid); c.p(x + 1, y + 1, mid); c.p(x - 1, y + 2, mid); c.p(x + 1, y + 2, mid)
    else:
        for (dx, dy) in ((-1, 1), (1, 1), (-1, 2), (1, 2)): c.p(x + dx, y + dy, 'sky-deep')

def halo(c, x, y, r, color='glow', skip=None):
    """sparse dither halo on transparent pixels only (checker near the source, quarter-dots outside)"""
    for yy in range(y - r, y + r + 1):
        for xx in range(x - r, x + r + 1):
            d = ((xx - x) ** 2 + (yy - y) ** 2) ** .5
            if d > r or c.get(xx, yy)[3] != 0: continue
            if (d < r * .55 and (xx + yy) % 2 == 0) or (d >= r * .55 and xx % 2 == 0 and yy % 2 == 0): c.p(xx, yy, color)

def lightwash(c, x, y, r, base_to):
    """dither lighter on existing pixels: base_to = {name: lighter name}"""
    for yy in range(y - r, y + r + 1):
        for xx in range(x - r, x + r + 1):
            d = ((xx - x) ** 2 + (yy - y) ** 2) ** .5
            n = c.name(xx, yy)
            if d > r or n not in base_to: continue
            if (d < r * .55) or (xx + yy) % 2 == 0: c.p(xx, yy, base_to[n])

def bunting(c, x0, x1, y, sag=3, cols=('violet', 'glow', 'ok', 'alert', 'cloud-hi')):
    n = x1 - x0; i = 0
    for x in range(x0, x1 + 1):
        t = (x - x0) / max(n, 1); yy = y + int(round(4 * sag * t * (1 - t)))
        c.p(x, yy, 'ink')
        if (x - x0) % 4 == 2:
            col_ = cols[i % len(cols)]; i += 1
            c.p(x, yy + 1, col_); c.p(x - 1, yy + 1, col_); c.p(x + 1, yy + 1, col_); c.p(x, yy + 2, col_)

def steps(c, x0, x1, y, n=2, h=3):
    for i in range(n):
        yy = y - (n - 1 - i) * h
        a = x0 + (n - 1 - i) * 3; b = x1 - (n - 1 - i) * 3
        for k in range(h):
            for x in range(a, b + 1): c.p(x, yy + k, 'wall-mid' if k < h - 1 else 'wall-shade')
        c.hline(a, b, yy, 'wall-lit')

def chair(c, x, y, tone='wood', lit=False):
    """small side-view chair, y = floor line, x = left of seat"""
    c.rect(x, y - 14, x + 1, y - 7, 'wood-dark'); c.rect(x, y - 7, x + 8, y - 6, tone)
    c.vline(x + 1, y - 5, y, 'wood-dark'); c.vline(x + 7, y - 5, y, 'wood-dark'); c.vline(x + 8, y - 5, y, 'wood-dark')
    c.hline(x, x + 8, y - 7, 'wood-lit'); c.vline(x, y - 14, y - 8, 'wood')

def apply_halo_lit(c, cx, cy, r):
    halo(c, cx, cy, r)
