"""Autumn Town houses -> night cut-out sprites, _dark and _lit variants."""
from buildings_common import *

STREAK = {(255, 244, 247)}
def is_pane(c):
    r, g, b = c[:3]
    return (r, g, b) == (255, 224, 180) or (g >= 245 and b >= 235 and r <= 236 and b >= r)

def is_curtain(c):
    r, g, b = c[:3]
    return (g > 150 and b > 150 and r < 90) or (r > 200 and g < 110 and b < 110)

# name: (bbox in Props_TownDay, clear-rects (sheet coords), chimney x offset fraction, sign slot hint)
HOUSES = {
    'tenement': dict(box=(10, 10, 170, 231), clear=[], sign=None),
    'shop':     dict(box=(184, 59, 382, 231), clear=[], sign=None),
    'hut':      dict(box=(397, 98, 525, 231), clear=[], sign=None),
    'cottage':  dict(box=(13, 347, 249, 508), clear=[(152, 340, 262, 420)], sign=None),
    'brick':    dict(box=(268, 342, 462, 509), clear=[(366, 342, 465, 440)], sign=None),
}

def cut(name, D):
    h = HOUSES[name]; x0, y0, x1, y1 = h['box']
    c = D.crop(h['box']).copy(); px = c.load()
    for (a, b, cc, d) in h['clear']:
        for y in range(max(b - y0, 0), min(d - y0, c.height)):
            for x in range(max(a - x0, 0), min(cc - x0, c.width)): px[x, y] = (0, 0, 0, 0)
    return largest_component(c)

def build_core(name, D, lit):
    src = cut(name, D); w, h = src.size; sp = src.load()
    base = night_grade(src); bp = base.load()
    pane = set(); curt = set(); streak = set()
    for y in range(h):
        for x in range(w):
            c = sp[x, y]
            if c[3] < 128: continue
            if is_pane(c): pane.add((x, y))
            elif c[:3] in STREAK: streak.add((x, y))
            elif is_curtain(c) and name != 'shop': curt.add((x, y))
    # drop tiny curtain-coloured specks (laundry pegs etc.)
    keep = set()
    for (a, b, c_, d, n) in components(curt, w, h, merge=1):
        if n >= 40: keep |= {p for p in curt if a <= p[0] <= c_ and b <= p[1] <= d}
    curt = keep
    # --- wall tone remap: darker night plaster, moonlit rim on lit edges (light from upper-left)
    remap = {'wall-lit': 'wall-mid', 'wall-mid': 'wall-shade', 'cloud-lo': 'wall-shade'}
    for y in range(h):
        for x in range(w):
            if bp[x, y][3] and (x, y) not in pane:
                n = REV.get(bp[x, y][:3])
                if n in remap: bp[x, y] = C(remap[n])
    # moon rim: a wall-mid pixel whose left neighbour is outline/wood/transparent gets wall-lit (1px left rim)
    out = base.copy(); op = out.load()
    for y in range(h):
        for x in range(w):
            n = REV.get(bp[x, y][:3]) if bp[x, y][3] else None
            if n == 'wall-mid':
                l = REV.get(bp[x - 1, y][:3]) if x > 0 and bp[x - 1, y][3] else None
                u = REV.get(bp[x, y - 1][:3]) if y > 0 and bp[x, y - 1][3] else None
                if l in (None, 'ink', 'wood-dark', 'wood', 'roof-shade', 'roof-wine') or u in ('wood', 'wood-dark', 'roof-shade'):
                    op[x, y] = C('wall-lit')
    # --- window cells
    wins = components(pane | streak | curt, w, h, merge=1)
    cells = components(pane | curt, w, h, merge=1)
    for (cx0, cy0, cx1, cy1, n) in cells:
        ch = cy1 - cy0 + 1
        for y in range(cy0, cy1 + 1):
            for x in range(cx0, cx1 + 1):
                if (x, y) not in pane and (x, y) not in curt and (x, y) not in streak: continue
                t = (y - cy0) / max(ch - 1, 1)
                if lit:
                    c = 'glow-core' if t < .12 else ('glow' if t < .88 else 'ember')
                    if (x, y) in curt: c = 'ember' if t > .3 else 'glow'
                    if (x, y) in streak: c = 'glow-core'
                else:
                    c = 'sky-deep'
                    if (x, y) in streak: c = 'sky-mid'
                    elif t < .2 and (x, y) in pane: c = 'sky-mid'
                    if (x, y) in curt: c = 'roof-shade'
                op[x, y] = C(c)
    for (x, y) in streak:
        if not any(a <= x <= c_ and b <= y <= d for (a, b, c_, d, n) in cells):
            op[x, y] = C('glow-core' if lit else 'sky-mid')
    meta = dict(windows=[[a, b, c_, d] for (a, b, c_, d, n) in wins])
    if lit:
        spill(out, wins)
    return out, meta

def spill(im, wins):
    """soft 1-2px warm spill on wall pixels around each lit window"""
    p = im.load(); w, h = im.size; snap = im.copy(); sp = snap.load()
    WALL = {'wall-shade': 'wall-mid', 'wall-mid': 'skin-lt', 'wall-lit': 'skin-lt'}
    for (a, b, c_, d, n) in wins:
        for y in range(b - 3, d + 4):
            for x in range(a - 3, c_ + 4):
                if not (0 <= x < w and 0 <= y < h) or sp[x, y][3] == 0: continue
                dx = max(a - x, 0, x - c_); dy = max(b - y, 0, y - d); dist = max(dx, dy)
                if dist == 0 or dist > 2: continue
                nm = REV.get(sp[x, y][:3])
                if nm not in WALL: continue
                if dist == 1: p[x, y] = C('skin-lt' if (x + y) % 2 == 0 else 'wall-lit') if nm != 'wall-lit' else C('skin-lt')
                elif dist == 2 and (x + y) % 2 == 0: p[x, y] = C('wall-mid' if nm == 'wall-shade' else 'wall-lit')

# ---------------------------------------------------------------- hand additions
SIGN = {  # sign slot rect on the original (un-padded) sprite: x0,y0,x1,y1  (flat plank painted here)
    'tenement': (66, 158, 94, 168), 'shop': (85, 112, 113, 121), 'hut': (22, 24, 50, 33),
    'cottage': (31, 101, 60, 110), 'brick': (135, 127, 153, 136),
}
CHIM = {'tenement': 118, 'shop': 132, 'hut': 104, 'cottage': 96, 'brick': 76}

def plank(im, r, lit):
    x0, y0, x1, y1 = r; c = Cv(im.width, im.height); c.im = im; c.px = im.load()
    c.rect(x0, y0, x1, y1, 'wood'); c.hline(x0, x1, y0, 'wood-lit'); c.hline(x0, x1, y1, 'wood-dark')
    c.vline(x0, y0, y1, 'wood-dark'); c.vline(x1, y0, y1, 'wood-dark')
    c.frame(x0 - 1, y0 - 1, x1 + 1, y1 + 1, 'ink')
    c.p(x0 + 1, y0 + 1, 'wood-dark'); c.p(x1 - 1, y0 + 1, 'wood-dark')
    # little iron hangers above plank
    c.p(x0 + 2, y0 - 2, 'ink'); c.p(x1 - 2, y0 - 2, 'ink')

def chimney(im, cx, lit):
    """pad top by 16px and draw a brick chimney whose base is buried in the roof surface at column cx"""
    pad = 16; out = Image.new('RGBA', (im.width, im.height + pad), (0, 0, 0, 0)); out.alpha_composite(im, (0, pad))
    c = Cv(out.width, out.height); c.im = out; c.px = out.load()
    cols = range(cx - 3, cx + 4)
    surf = []
    for x in cols:
        y = next((y for y in range(c.h) if c.get(x, y)[3]), c.h - 1); surf.append(y)
    base = max(surf) + 3; top = min(surf) - 11
    for y in range(top, base + 1):
        for x in cols:
            if c.get(x, y)[3] and y > min(surf) + 1 and y >= surf[x - (cx - 3)] + 2 and False: continue
            edge = x in (cx - 3, cx + 3)
            col = 'wall-shade'
            if x == cx - 2: col = 'wall-mid'
            if (y + (x // 2)) % 3 == 0 and not edge: col = 'wood-dark' if x > cx else col
            if (y - top) % 3 == 2 and not edge: col = 'roof-shade'
            c.p(x, y, 'ink' if edge else col)
    c.hline(cx - 4, cx + 4, top, 'ink'); c.hline(cx - 3, cx + 3, top + 1, 'wall-mid'); c.hline(cx - 4, cx + 4, top + 2, 'ink')
    c.hline(cx - 3, cx + 3, top + 1, 'wall-mid'); c.p(cx - 3, top + 1, 'wall-lit'); c.p(cx - 2, top + 1, 'wall-lit')
    # chimney foot shadow where it meets the roof
    for x in cols: c.p(x, base, 'ink')
    return out, pad, top

def hut_extras(im, lit):
    c = Cv(im.width, im.height); c.im = im; c.px = im.load()
    # small side window (right wall) + hanging lantern-ish door slit
    x0, y0 = 97, 62
    c.rect(x0 - 1, y0 - 1, x0 + 12, y0 + 15, 'ink'); c.rect(x0, y0, x0 + 11, y0 + 14, 'wood')
    for y in range(y0 + 1, y0 + 14):
        for x in range(x0 + 1, x0 + 11):
            t = (y - y0) / 14
            c.p(x, y, ('glow-core' if t < .35 else 'glow' if t < .85 else 'ember') if lit else ('sky-mid' if t < .18 else 'sky-deep'))
    c.vline(x0 + 5, y0 + 1, y0 + 13, 'wood-dark'); c.hline(x0 + 1, x0 + 10, y0 + 6, 'wood-dark')
    c.hline(x0 - 1, x0 + 12, y0 + 16, 'wood-lit'); c.hline(x0 - 1, x0 + 12, y0 + 17, 'ink')
    if lit:  # door slit light
        for y in range(80, 128): c.p(40, y, 'glow'); 
        for y in range(84, 126): c.p(41, y, 'ember')
        spill(im, [(x0, y0, x0 + 11, y0 + 14, 0)])


def build(name, D, lit):
    im, meta = build_core(name, D, lit)
    if name == 'hut': hut_extras(im, lit)
    plank(im, SIGN[name], lit)
    out, pad, ctop = chimney(im, CHIM[name], lit)
    meta['pad_top'] = pad
    meta['sign_slot'] = [SIGN[name][0], SIGN[name][1] + pad, SIGN[name][2], SIGN[name][3] + pad]
    meta['windows'] = [[a, b + pad, c, d + pad] for a, b, c, d in meta['windows']]
    meta['chimney_top'] = [CHIM[name], 0]
    return out, meta
