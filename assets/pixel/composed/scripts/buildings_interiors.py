"""Cutaway room backdrops 224x128, floor line y=112, warm lamp light via ordered-dither ramps."""
import math
from buildings_kit import *

W, H, FLOOR = 224, 128, 112
BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
FURN_UP = {'wood-dark': 'wood', 'wood': 'wood-lit', 'cloud-hi': 'moon', 'leaf-dark': 'leaf-dark', 'roof-wine': 'roof-wine'}
WARM_UP = {'wood-dark': 'wood', 'wood': 'wood-lit', 'wood-lit': 'skin-lt', 'skin-lt': 'glow-core', 'ink': 'wood-dark', 'wall-shade': 'wall-mid', 'wall-mid': 'wall-lit',
           'hill-mid': 'wall-shade', 'hill-near': 'hill-mid', 'sky-deep': 'hill-near', 'roof-wine': 'alert', 'roof-shade': 'roof-wine', 'violet': 'cloud-hi', 'leaf-dark': 'leaf-lit'}

def lamp_light(c, lx, ly, r, mapping=WARM_UP, strength=1.0, y_max=None, core=True, maxsteps=3):
    """ordered-dither warm light: pixels climb the ramp 0..maxsteps steps depending on distance + bayer threshold"""
    for y in range(max(0, ly - r), min(c.h, ly + r + 1)):
        if y_max is not None and y > y_max: continue
        for x in range(max(0, lx - r), min(c.w, lx + r + 1)):
            d = math.hypot((x - lx) * .8, y - ly) / r
            if d >= 1: continue
            f = (1 - d) ** 1.1 * strength * (maxsteps + .3)
            steps = int(f + BAYER[y % 4][x % 4] / 16.0)
            for _ in range(min(steps, maxsteps)):
                n = c.name(x, y)
                if n not in mapping: break
                c.p(x, y, mapping[n])
            if core and d < .16 and c.name(x, y) in ('wood-lit', 'skin-lt'): c.p(x, y, 'glow-core')

def shell(c, wall_kind='wood'):
    """back wall, cut-away side walls, ceiling beam, floor"""
    for y in range(0, FLOOR):
        for x in range(0, W):
            if wall_kind == 'wood':
                c.p(x, y, 'wood-dark' if (x // 8) % 2 == 0 or (x % 8 == 0) else 'wood-dark')
            elif wall_kind == 'stone':
                c.p(x, y, 'hill-near')
    if wall_kind == 'wood':
        for x in range(0, W):
            for y in range(0, FLOOR):
                if x % 14 == 0: c.p(x, y, 'ink')
                elif x % 14 == 1: c.p(x, y, 'wood')
        # wainscot band
        c.rect(0, 84, W - 1, 87, 'wood'); c.hline(0, W - 1, 84, 'wood-lit'); c.hline(0, W - 1, 87, 'ink')
        for y in range(88, FLOOR): 
            for x in range(0, W): c.p(x, y, 'wood-dark' if (x // 7 + y // 24) % 2 else 'hill-near' if False else 'wood-dark')
        for x in range(0, W, 14): c.vline(x, 88, FLOOR - 1, 'ink')
    else:
        for y in range(0, FLOOR):
            r = y // 7
            for x in range(0, W):
                c.p(x, y, 'hill-near')
            if y % 7 == 6:
                c.hline(0, W - 1, y, 'ground')
            else:
                for x in range((0 if r % 2 == 0 else 6), W, 12): c.p(x, y, 'ground')
                for x in range((3 if r % 2 == 0 else 9), W, 12): c.p(x, y, 'hill-mid') if (x + y) % 3 == 0 else None
    # ceiling beam
    c.rect(0, 0, W - 1, 7, 'wood'); c.hline(0, W - 1, 0, 'wood-lit'); c.hline(0, W - 1, 7, 'ink'); c.hline(0, W - 1, 6, 'wood-dark')
    for x in range(10, W, 28): c.rect(x, 0, x + 3, 5, 'wood-dark')
    # floor
    c.rect(0, FLOOR, W - 1, H - 1, 'wood'); c.hline(0, W - 1, FLOOR, 'ink'); c.hline(0, W - 1, FLOOR + 1, 'wood-lit')
    for y in (FLOOR + 6, FLOOR + 12): c.hline(0, W - 1, y, 'wood-dark')
    for y0, off in ((FLOOR + 2, 0), (FLOOR + 7, 14), (FLOOR + 13, 5)):
        for x in range(off, W, 30): c.vline(x, y0, min(y0 + 4, H - 1), 'wood-dark')
    # cut-away side walls (section cut)
    for x in range(0, 6):
        c.vline(x, 0, H - 1, 'ink' if x in (5,) else 'wall-shade' if x > 1 else 'wall-mid')
    for x in range(W - 6, W):
        c.vline(x, 0, H - 1, 'ink' if x == W - 6 else 'wall-shade' if x < W - 2 else 'hill-mid')
    c.vline(0, 0, H - 1, 'ink'); c.vline(W - 1, 0, H - 1, 'ink'); c.hline(0, W - 1, H - 1, 'ink')

def night_window(c, x0, y0, w, h):
    c.rect(x0 - 2, y0 - 2, x0 + w + 1, y0 + h + 1, 'ink'); c.rect(x0 - 1, y0 - 1, x0 + w, y0 + h, 'wood-lit')
    for y in range(y0, y0 + h):
        t = (y - y0) / h
        for x in range(x0, x0 + w): c.p(x, y, 'sky-deep' if t < .5 else 'sky-mid' if t < .78 else 'sky-low')
    # hills + moon + star
    for x in range(x0, x0 + w):
        yy = y0 + h - 5 + int(2 * math.sin((x - x0) / 5.0))
        for y in range(yy, y0 + h): c.p(x, y, 'hill-far' if y == yy else 'hill-mid')
    c.ellipse(x0 + w - 8, y0 + 7, 2, 2, 'moon'); c.p(x0 + 4, y0 + 4, 'moon'); c.p(x0 + 9, y0 + 9, 'cloud-hi')
    c.vline(x0 + w // 2, y0, y0 + h - 1, 'wood'); c.hline(x0, x0 + w - 1, y0 + h // 2, 'wood')
    c.hline(x0 - 3, x0 + w + 2, y0 + h + 2, 'wood-lit'); c.hline(x0 - 3, x0 + w + 2, y0 + h + 3, 'ink')
    # curtains
    c.rect(x0 - 2, y0 - 2, x0 + 3, y0 + h - 2, 'roof-wine'); c.vline(x0 - 1, y0, y0 + h - 3, 'roof-shade'); c.vline(x0 + 1, y0, y0 + h - 3, 'roof-shade')
    c.rect(x0 + w - 4, y0 - 2, x0 + w + 1, y0 + h - 2, 'roof-wine'); c.vline(x0 + w - 2, y0, y0 + h - 3, 'roof-shade'); c.vline(x0 + w, y0, y0 + h - 3, 'roof-shade')
    c.hline(x0 - 3, x0 + w + 2, y0 - 3, 'wood-dark')

def pendant(c, x, ylen=18, kind='glow'):
    c.vline(x, 8, 8 + ylen, 'ink')
    y = 8 + ylen
    c.rect(x - 5, y, x + 5, y + 1, 'ink'); c.hline(x - 4, x + 4, y + 1, 'roof-shade')
    for i in range(4):
        c.hline(x - 4 - i * 0 + (3 - i) * 0, x + 4, y - i, 'roof-wine' if i < 3 else 'roof-wine')
    c.rect(x - 4, y - 3, x + 4, y - 1, 'roof-wine'); c.hline(x - 3, x + 3, y - 4, 'roof-wine'); c.hline(x - 2, x + 2, y - 5, 'ink')
    c.rect(x - 3, y + 2, x + 3, y + 3, 'glow-core'); c.rect(x - 2, y + 4, x + 2, y + 4, 'glow')

def desk(c, x, y, w=36, h=14, lit=True):
    """side-view desk, y = floor"""
    c.rect(x, y - h, x + w, y - h + 2, 'wood-lit'); c.hline(x, x + w, y - h, 'skin-lt' if False else 'wood-lit'); c.hline(x, x + w, y - h + 3, 'ink')
    c.rect(x + 1, y - h + 3, x + w - 1, y - h + 6, 'wood'); 
    c.rect(x + 2, y - h + 4, x + w - 2, y - h + 5, 'wood-dark')
    for lx in (x + 2, x + w - 4): c.rect(lx, y - h + 7, lx + 2, y, 'wood-dark'); c.vline(lx, y - h + 7, y, 'wood')
    c.hline(x - 1, x + w + 1, y - h - 1, 'ink')

def stool_chair(c, x, y):
    c.rect(x, y - 9, x + 10, y - 7, 'wood-lit'); c.hline(x, x + 10, y - 10, 'ink'); c.hline(x, x + 10, y - 6, 'ink')
    c.vline(x + 1, y - 6, y, 'wood-dark'); c.vline(x + 9, y - 6, y, 'wood-dark'); c.vline(x, y - 22, y - 9, 'wood'); c.vline(x + 1, y - 22, y - 9, 'wood-dark')

def book_stack(c, x, y):
    for i, col_ in enumerate(('violet', 'roof-wine', 'ok')):
        c.rect(x, y - 3 * (i + 1), x + 8 - i, y - 3 * i - 1, col_); c.hline(x, x + 8 - i, y - 3 * i - 1, 'ink'); c.hline(x + 1, x + 7 - i, y - 3 * (i + 1), 'cloud-hi')

def bookcase(c, x, y0, w=34, h=52, rows=4):
    c.rect(x, y0, x + w, y0 + h, 'ink'); c.rect(x + 1, y0 + 1, x + w - 1, y0 + h - 1, 'wood-dark')
    colors = ['violet', 'roof-wine', 'ok', 'glow', 'cloud-hi', 'alert', 'ember', 'wood-lit']
    rh = (h - 2) // rows
    for r in range(rows):
        ry = y0 + 1 + r * rh
        c.rect(x + 2, ry + 1, x + w - 2, ry + rh - 2, 'ink')
        bx = x + 2; k = r * 3
        while bx < x + w - 3:
            bw = 2 + (k * 7) % 3; bh = rh - 4 - (k * 5) % 4
            col_ = colors[(k * 3 + r) % len(colors)]
            for yy in range(ry + rh - 2 - bh, ry + rh - 2): 
                for xx in range(bx, min(bx + bw, x + w - 3)): c.p(xx, yy, col_)
            c.vline(bx, ry + rh - 2 - bh, ry + rh - 3, 'wall-lit' if col_ in ('violet', 'glow', 'ok') else col_)
            bx += bw + (1 if (k % 4 == 0) else 0); k += 1
        c.hline(x + 1, x + w - 1, ry + rh - 1, 'wood'); c.hline(x + 1, x + w - 1, ry + rh, 'wood-lit') if r < rows - 1 else None
    c.hline(x - 1, x + w + 1, y0 - 1, 'ink'); c.hline(x - 1, x + w + 1, y0, 'wood-lit')

def rug(c, x0, x1, y, colors=('roof-wine', 'roof-shade', 'violet')):
    for dy in range(0, 3):
        for x in range(x0 + dy * 2, x1 - dy * 2): c.p(x, y + dy, colors[0] if dy < 2 else colors[1])
    for x in range(x0 + 3, x1 - 3, 4): c.p(x, y + 1, colors[2])
    c.hline(x0 + 5, x1 - 5, y + 3, 'ink')

def classroom():
    c = Cv(W, H); shell(c, 'wood')
    night_window(c, 18, 24, 26, 30)
    pendant(c, 58, 16); pendant(c, 166, 16)
    lamp_light(c, 58, 34, 60, strength=1.0); lamp_light(c, 166, 34, 60, strength=1.0); lamp_light(c, 112, 40, 55, strength=.6)
    # chalkboard
    bx, by, bw, bh = 76, 18, 72, 46
    c.rect(bx - 3, by - 3, bx + bw + 2, by + bh + 2, 'ink'); c.rect(bx - 2, by - 2, bx + bw + 1, by + bh + 1, 'wood-lit'); c.rect(bx - 1, by - 1, bx + bw, by + bh, 'wood'); c.rect(bx, by, bx + bw - 1, by + bh - 1, 'leaf-dark')
    c.hline(bx, bx + bw - 1, by, 'leaf-lit'); c.vline(bx, by, by + bh - 1, 'leaf-lit')
    for k, ln in enumerate((40, 30, 36)):
        for x in range(bx + 6, bx + 6 + ln, 3): c.p(x, by + 8 + k * 6, 'cloud-hi'); c.p(x + 1, by + 8 + k * 6, 'cloud-hi')
    # diagram: triangle + arrow
    for i in range(10): c.p(bx + 50 + i, by + 34 - i, 'cloud-hi') ; c.p(bx + 50 + i, by + 34, 'cloud-hi'); c.p(bx + 50, by + 34 - i, 'cloud-hi')
    for k in range(5): c.p(bx + 8 + k, by + 36 - k // 2, 'glow'); 
    c.hline(bx + 6, bx + 24, by + 38, 'glow'); c.p(bx + 25, by + 37, 'glow'); c.p(bx + 25, by + 39, 'glow')
    c.hline(bx - 2, bx + bw + 1, by + bh + 2, 'wood-lit'); c.rect(bx + 6, by + bh + 3, bx + 20, by + bh + 3, 'cloud-hi'); c.rect(bx + 40, by + bh + 3, bx + 44, by + bh + 3, 'alert')
    # shelf with globe on right
    bookcase(c, 168, 46, w=30, h=50, rows=4)
    # clock
    c.ellipse(60, 22, 5, 5, 'ink'); c.ellipse(60, 22, 4, 4, 'cloud-hi'); c.vline(60, 19, 22, 'ink'); c.hline(60, 63, 22, 'ink')
    # expert desk (big, right of board) and student desk (left) + chairs
    desk(c, 150, FLOOR, w=40, h=18); book_stack(c, 156, FLOOR - 18)
    c.rect(168, FLOOR - 29, 174, FLOOR - 24, 'cloud-hi'); c.hline(168, 174, FLOOR - 24, 'wall-mid')
    c.vline(171, FLOOR - 24, FLOOR - 19, 'ink')   # tiny lamp pole
    desk(c, 36, FLOOR, w=24, h=12); stool_chair(c, 30, FLOOR); desk(c, 66, FLOOR, w=24, h=12); stool_chair(c, 92, FLOOR + 0)
    c.rect(40, FLOOR - 15, 46, FLOOR - 13, 'cloud-hi'); c.hline(40, 46, FLOOR - 13, 'wall-mid')
    rug(c, 70, 150, FLOOR + 8)
    lamp_light(c, 58, 34, 70, strength=.5, mapping=FURN_UP, core=False, maxsteps=1); lamp_light(c, 166, 34, 70, strength=.5, mapping=FURN_UP, core=False, maxsteps=1)
    c.hline(1, W - 2, H - 2, 'ink') if False else None
    return c.im, dict(anchors={'chalkboard_center': [bx + bw // 2, by + bh // 2], 'expert_desk': [170, FLOOR], 'student_desk': [48, FLOOR], 'lamp': [112, 40], 'floor_y': FLOOR})

def study():
    c = Cv(W, H); shell(c, 'wood')
    night_window(c, 150, 22, 34, 34)
    pendant(c, 80, 8)
    lamp_light(c, 143, FLOOR - 50, 80, strength=1.0); lamp_light(c, 80, 24, 55, strength=.8)
    bookcase(c, 14, 30, w=34, h=82, rows=6); bookcase(c, 52, 46, w=34, h=66, rows=5)
    # desk under window with lamp
    desk(c, 126, FLOOR, w=76, h=24)
    for i in range(3): pass
    # desk lamp
    lx = 140
    c.vline(lx, FLOOR - 40, FLOOR - 25, 'ink'); c.vline(lx + 1, FLOOR - 40, FLOOR - 25, 'wall-shade'); c.rect(lx - 3, FLOOR - 26, lx + 5, FLOOR - 25, 'ink')
    c.rect(lx - 2, FLOOR - 50, lx + 8, FLOOR - 42, 'ink'); c.rect(lx - 1, FLOOR - 49, lx + 7, FLOOR - 43, 'roof-wine'); c.hline(lx - 1, lx + 7, FLOOR - 49, 'violet')
    c.rect(lx + 1, FLOOR - 41, lx + 5, FLOOR - 40, 'glow-core')
    # laptop-free: open notebook + books + mug
    c.rect(160, FLOOR - 27, 174, FLOOR - 25, 'cloud-hi'); c.vline(167, FLOOR - 27, FLOOR - 25, 'wall-shade'); c.hline(162, 165, FLOOR - 26, 'wall-mid'); c.hline(169, 172, FLOOR - 26, 'wall-mid')
    book_stack(c, 182, FLOOR - 24)
    c.rect(150, FLOOR - 31, 154, FLOOR - 25, 'ink'); c.rect(151, FLOOR - 30, 153, FLOOR - 26, 'wood-lit'); c.p(155, FLOOR - 29, 'ink'); c.p(155, FLOOR - 28, 'ink')
    stool_chair(c, 106, FLOOR)
    # plant + rug + framed pic
    c.rect(98, FLOOR - 12, 106, FLOOR, 'roof-wine') if False else None
    rug(c, 96, 200, FLOOR + 6)
    c.rect(100, 24, 116, 38, 'ink'); c.rect(101, 25, 115, 37, 'wood-lit'); c.rect(103, 27, 113, 35, 'sky-low')
    for x in range(103, 114): c.p(x, 33, 'hill-mid'); c.p(x, 34, 'hill-mid'); c.p(x, 35, 'hill-near')
    c.p(110, 29, 'moon')
    # leafy plant in corner
    c.rect(204, FLOOR - 10, 212, FLOOR, 'roof-wine'); c.hline(204, 212, FLOOR - 10, 'wood-lit'); c.hline(204, 212, FLOOR - 9, 'ink')
    for (dx, dy) in ((0, -14), (-3, -10), (3, -10), (-5, -6), (5, -6), (0, -8)): c.rect(208 + dx - 2, FLOOR - 10 + dy - 2, 208 + dx + 2, FLOOR - 10 + dy + 2, 'leaf-lit'); c.hline(208 + dx - 2, 208 + dx + 2, FLOOR - 10 + dy + 2, 'leaf-dark')
    lamp_light(c, lx + 3, FLOOR - 40, 54, strength=.5, mapping=FURN_UP, core=False, maxsteps=1)
    return c.im, dict(anchors={'desk': [164, FLOOR], 'lamp': [lx + 3, FLOOR - 40], 'chair': [111, FLOOR], 'window': [167, 39], 'floor_y': FLOOR})

def council():
    c = Cv(W, H); shell(c, 'stone'); cx = 112
    STONE_UP = {'hill-near': 'hill-mid', 'hill-mid': 'wall-shade', 'wall-shade': 'wall-mid', 'ground': 'hill-near', 'violet': 'cloud-hi', 'wood': 'wood-lit', 'wood-lit': 'skin-lt', 'wall-mid': 'wall-lit', 'sky-deep': 'hill-near'}
    lamp_light(c, cx, 18, 95, mapping=STONE_UP, strength=.85, core=False, maxsteps=2)
    # arched night windows, left and right
    for wx in (16, 186):
        c.rect(wx - 1, 22, wx + 22, 72, 'ink')
        for y in range(23, 73):
            t_ = (y - 23) / 49.0
            half = 11 if y > 34 else int(round(11 * math.sqrt(max(0, 1 - ((34 - y) / 11.0) ** 2))))
            for x in range(wx + 11 - half, wx + 11 + half + 1): c.p(x, y, 'sky-deep' if t_ < .5 else 'sky-mid' if t_ < .8 else 'sky-low')
        c.vline(wx + 11, 23, 72, 'wall-shade'); c.hline(wx, wx + 22, 50, 'wall-shade')
        c.p(wx + 6, 30, 'moon'); c.p(wx + 15, 42, 'cloud-hi'); c.hline(wx - 2, wx + 24, 73, 'wall-mid'); c.hline(wx - 2, wx + 24, 74, 'ink')
    # pillars
    for px in (54, 166): col(c, px - 3, 12, FLOOR - 2, w=6)
    # council banner behind the chairman (violet, with rune)
    c.rect(cx - 13, 10, cx + 13, 52, 'ink'); c.rect(cx - 12, 11, cx + 12, 50, 'roof-shade'); c.rect(cx - 11, 12, cx + 11, 49, 'violet')
    c.vline(cx + 11, 12, 49, 'roof-wine'); c.vline(cx + 10, 12, 49, 'roof-wine'); c.hline(cx - 11, cx + 11, 12, 'cloud-hi')
    for k in range(-11, 12, 2): c.p(cx + k, 50, 'ink')
    c.ellipse(cx, 30, 6, 6, 'cloud-hi', outline='roof-shade'); c.ellipse(cx, 30, 3, 3, 'violet'); c.p(cx, 30, 'cloud-hi')
    # raised dais (two elliptical steps)
    for (rx, ry, y, col_) in ((92, 7, FLOOR, 'wall-shade'), (78, 6, FLOOR - 6, 'wall-mid')):
        c.ellipse(cx, y - ry + 3, rx, ry, col_, outline='ink')
    for dx in range(-72, 73):
        yy = FLOOR - 10 + int(round(3.2 * math.sqrt(max(0, 1 - (dx / 73.0) ** 2))))
        if dx % 2 == 0: c.p(cx + dx, yy, 'violet')
    c.ellipse(cx, FLOOR - 7, 60, 4, 'wall-lit') if False else None
    def seat(x, y, kind='council'):
        hh = 30 if kind == 'chairman' else 19
        w2 = 8 if kind == 'chairman' else 5
        c.rect(x - w2, y - hh, x + w2, y - 6, 'ink'); c.rect(x - w2 + 1, y - hh + 1, x + w2 - 1, y - 7, 'roof-wine' if kind == 'council' else 'violet')
        c.vline(x - w2 + 1, y - hh + 1, y - 7, 'violet' if kind == 'council' else 'cloud-hi'); c.vline(x + w2 - 1, y - hh + 1, y - 7, 'roof-shade' if kind == 'council' else 'roof-wine')
        c.hline(x - w2, x + w2, y - hh + 1, 'violet' if kind == 'council' else 'cloud-hi')
        c.hline(x - w2 - 1, x + w2 + 1, y - 6, 'ink'); c.rect(x - w2, y - 5, x + w2, y - 3, 'wood'); c.hline(x - w2, x + w2, y - 5, 'wood-lit')
        c.rect(x - w2 + 1, y - 2, x - w2 + 2, y, 'wood-dark'); c.rect(x + w2 - 2, y - 2, x + w2 - 1, y, 'wood-dark')
        if kind == 'chairman':
            c.hline(x - 3, x + 3, y - hh + 4, 'glow'); c.p(x, y - hh + 3, 'glow-core'); c.p(x, y - hh - 1, 'glow-core'); c.p(x - 1, y - hh, 'glow'); c.p(x + 1, y - hh, 'glow')
        return [x, y - 3]
    anchors = {}
    anchors['chairman'] = seat(cx, FLOOR - 20, 'chairman')
    anchors['council_left'] = seat(cx - 62, FLOOR - 6)
    anchors['council_right'] = seat(cx + 62, FLOOR - 6)
    # table (round, side view)
    ty = FLOOR - 24
    c.rect(cx - 5, ty, cx + 5, FLOOR - 7, 'wood-dark'); c.vline(cx - 5, ty, FLOOR - 7, 'wood'); c.rect(cx - 13, FLOOR - 10, cx + 13, FLOOR - 7, 'wood-dark'); c.hline(cx - 13, cx + 13, FLOOR - 10, 'wood')
    c.hline(cx - 13, cx + 13, FLOOR - 6, 'ink')
    c.ellipse(cx, ty - 3, 42, 4, 'wood-lit', outline='ink')
    c.rect(cx - 42, ty - 1, cx + 42, ty + 2, 'wood'); c.hline(cx - 42, cx + 42, ty + 2, 'wood-dark'); c.hline(cx - 41, cx + 41, ty + 3, 'ink')
    for dx in range(-34, 35, 6): c.p(cx + dx, ty - 3, 'violet')
    c.rect(cx - 2, ty - 8, cx + 2, ty - 6, 'cloud-hi'); c.p(cx, ty - 9, 'violet'); c.p(cx - 8, ty - 5, 'skin-lt'); c.p(cx + 9, ty - 5, 'skin-lt')
    anchors['council_front'] = seat(cx, FLOOR + 12)
    # hanging violet lantern (slot) at the top centre
    c.rect(cx - 4, 8, cx + 4, 9, 'wood-dark'); c.vline(cx, 10, 12, 'ink'); c.vline(cx - 2, 10, 12, 'ink'); c.vline(cx + 2, 10, 12, 'ink')
    lantern(c, cx, 13, True, 'violet', chain=0)
    # wall torches (warm), flanking
    for tx in (84, 140):
        c.vline(tx, 72, 80, 'wood-dark'); c.rect(tx - 2, 68, tx + 2, 72, 'ember'); c.p(tx, 65, 'glow'); c.p(tx - 1, 66, 'glow-core'); c.p(tx + 1, 66, 'glow-core'); c.p(tx, 67, 'glow-core'); c.p(tx, 66, 'glow')
        lamp_light(c, tx, 66, 28, mapping={'hill-near': 'hill-mid', 'hill-mid': 'wall-shade', 'wall-shade': 'wall-mid', 'ground': 'hill-near'}, strength=.8, core=False, maxsteps=2)
    return c.im, dict(anchors=dict(seats=anchors, lantern_slot=[cx, 13], table_center=[cx, ty - 3], floor_y=FLOOR))

def oral_room():
    c = Cv(W, H); shell(c, 'stone')
    # barred high window
    c.rect(150, 18, 180, 50, 'ink'); 
    for y in range(19, 50):
        for x in range(151, 180): c.p(x, y, 'sky-deep' if y < 34 else 'sky-mid')
    for x in range(155, 180, 7): c.vline(x, 19, 49, 'ink')
    c.hline(151, 179, 34, 'ink'); c.p(160, 25, 'moon'); c.p(171, 39, 'cloud-hi')
    c.hline(148, 182, 51, 'wall-shade'); c.hline(148, 182, 52, 'ink')
    # strict wall plaque + clock
    c.rect(40, 24, 70, 36, 'ink'); c.rect(41, 25, 69, 35, 'wood'); c.rect(43, 28, 67, 28, 'cloud-hi'); c.rect(46, 31, 64, 31, 'cloud-hi')
    c.ellipse(132, 30, 7, 7, 'ink'); c.ellipse(132, 30, 6, 6, 'cloud-hi'); c.vline(132, 25, 30, 'ink'); c.hline(132, 136, 30, 'ink')
    # spotlight cone on the floor (ceiling lamp)
    cx = 100
    # single chair (centre-left), the only furniture
    x = cx - 8; y = FLOOR
    c.rect(x, y - 30, x + 3, y - 12, 'wood-dark'); c.vline(x, y - 30, y - 12, 'wood'); c.vline(x + 4, y - 30, y - 12, 'ink')
    for yy in range(y - 28, y - 16, 3): c.hline(x, x + 3, yy, 'wood-lit')
    c.rect(x, y - 13, x + 20, y - 10, 'wood'); c.hline(x, x + 20, y - 13, 'wood-lit'); c.hline(x, x + 20, y - 10, 'ink')
    for lx in (x + 1, x + 17): c.rect(lx, y - 9, lx + 2, y, 'wood-dark'); c.vline(lx, y - 9, y, 'wood')
    c.hline(x, x + 20, y - 14, 'ink')
    # examiner's lamp (hanging from the beam, harsh)
    c.vline(cx + 4, 8, 28, 'ink'); c.rect(cx - 4, 26, cx + 12, 29, 'ink'); c.hline(cx - 3, cx + 11, 27, 'wall-mid'); c.hline(cx - 3, cx + 11, 28, 'wall-shade'); c.rect(cx - 1, 30, cx + 9, 31, 'glow-core')
    # spill cone (dither)
    for yy in range(32, FLOOR + 1):
        half = int(5 + (yy - 32) * .55)
        for xx in range(cx + 4 - half, cx + 4 + half + 1):
            n = c.name(xx, yy)
            if n in WARM_UP and ((xx + yy) % 2 == 0 or abs(xx - cx - 4) < half * .4): c.p(xx, yy, WARM_UP[n])
    c.ellipse(cx + 4, FLOOR + 3, 26, 2, 'wood-lit')   # lit floor pool
    for xx in range(cx - 20, cx + 30, 2): c.p(xx, FLOOR + 3, 'glow')
    c.rect(x + 2, y - 16, x + 18, y - 14, 'wood') if False else None
    return c.im, dict(anchors=dict(chair=[x + 10, FLOOR - 12], lamp=[cx + 4, 30], floor_y=FLOOR))
