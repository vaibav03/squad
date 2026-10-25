from props_draw import *
import random

def flame_frame(f, n=6, W=16, H=22):
    im = new(W, H); cx = W // 2
    rnd = random.Random(7 + f); ph = f / n * 2 * math.pi
    layers = [('ember', 1.0, 0), ('glow', 0.72, 0), ('glow-core', 0.4, 0)]
    for name, s, _ in layers:
        top = H - 1 - int((H - 3) * (0.86 + 0.14 * math.sin(ph * 1 + (0 if name == 'ember' else 1.2))) * s ** 0.8) if name != 'glow-core' else H - 1 - int(9 + 1.5 * math.sin(ph + 2))
        base = H - 1
        for y in range(top, base + 1):
            t = (y - top) / max(1, base - top)           # 0 tip .. 1 base
            hw = (W / 2 - 1.2) * s * (math.sin(t * math.pi / 2) ** 0.9) * (0.75 + 0.25 * t) + 0.9 * math.sin(y * 1.9 + ph * 2 + (s * 3)) * min(1, (1 - t) * 3) * t * 2
            sway = math.sin(ph + t * 2.2) * (1 - t) * 3.4 * s
            c0 = cx + sway
            for x in range(W):
                if abs(x + 0.5 - c0 - 0.5) <= hw: put(im, x, y, name)
    # side tongues
    tx = cx + (-4 if f % 2 == 0 else 3); ty = H - 9 - (f % 3)
    for k in range(4): put(im, tx + (k // 2) * (1 if tx > cx else -1), ty + k, 'ember')
    # alert (red) pixels at base edges, glow-core base
    for x in range(cx - 4, cx + 4):
        if dither(x, 0, .5): put(im, x, H - 1, 'alert')
    for x in range(cx - 2, cx + 2): put(im, x, H - 1, 'glow-core')
    # lick: remove isolated stray pixels at tip by keeping as is (reads as ember spark)
    return im

def log_base():
    """Stone ring + 2 crossed logs, 32x14, anchor bottom-center. fire sits at (8,-18)."""
    im = new(32, 14)
    ellipse(im, 15.5, 9, 15, 4.2, 'ink'); ellipse(im, 15.5, 8.5, 13.6, 3.4, 'ground')
    # logs
    line(im, 7, 10, 24, 5, 'wood-dark'); line(im, 7, 9, 24, 4, 'wood'); line(im, 7, 8, 24, 3, 'wood-lit')
    line(im, 8, 5, 23, 10, 'wood-dark'); line(im, 8, 4, 23, 9, 'wood'); line(im, 8, 3, 23, 8, 'wood-lit')
    # stones around the rim
    stones = [(2, 9), (5, 12), (10, 13), (16, 13), (22, 13), (27, 11), (29, 8), (28, 5), (24, 3), (7, 3), (3, 6), (13, 2), (19, 2)]
    for sx, sy in stones:
        back = sy <= 4
        rect(im, sx - 2, sy - 2, sx + 2, sy + 1, 'ink'); rect(im, sx - 1, sy - 1, sx + 1, sy, 'wall-mid'); rect(im, sx - 1, sy - 1, sx, sy - 1, 'wall-lit' if not back else 'wall-mid')
        put(im, sx + 1, sy - 1, 'wall-mid' if not back else 'wall-shade'); put(im, sx, sy, 'wall-shade'); put(im, sx - 1, sy, 'wall-shade')
    # warm firelight on the logs / inner ground
    for x in range(10, 22):
        if dither(x, 3, .5): put(im, x, 6, 'ember')
    return im

def campfire_frame(fire, base):
    im = new(32, 34); paste(im, base, 0, 20); paste(im, fire, 8, 20 - fire.height + 8)
    front = base.crop((0, 8, 32, 14)); im.alpha_composite(front, (0, 28)); return im

def light_pool(w=112, h=44):
    """stepped ellipses glow/ember, dither at each band edge, no semi-transparency."""
    im = new(w, h); cx, cy = (w - 1) / 2, (h - 1) / 2
    bands = [(1.0, 'ember'), (0.74, 'glow'), (0.48, 'glow-core'), ]
    # outermost wide dithered ember fringe, then glow, then core
    for y in range(h):
        for x in range(w):
            d = math.hypot((x - cx) / (w / 2), (y - cy) / (h / 2))
            col = None
            if d < 0.30: col = 'glow-core'
            elif d < 0.31 + 0.0 and dither(x, y, .5): col = 'glow-core'
            elif d < 0.55: col = 'glow'
            elif d < 0.62: col = 'glow' if dither(x, y, .5) else 'ember'
            elif d < 0.82: col = 'ember'
            elif d < 1.0: col = 'ember' if dither(x, y, 1 - (d - .82) / .18 * .9) else None
            if col: put(im, x, y, col)
    return im

def sparks():
    fr = []
    seqs = [[(3, 10, 'glow-core'), (6, 7, 'glow'), (2, 4, 'ember'), (5, 1, 'ember')],
            [(4, 9, 'glow'), (3, 6, 'glow-core'), (6, 3, 'ember'), (2, 0, 'ember')],
            [(3, 8, 'ember'), (5, 5, 'glow'), (2, 2, 'glow-core'), (6, 0, 'ember')]]
    for s in seqs:
        im = new(8, 12)
        for x, y, c in s: put(im, x, y, c)
        fr.append(im)
    return fr

def smoke_frames(n=8, W=24, H=40):
    fr = []
    puffs = 3
    for f in range(n):
        im = new(W, H); t0 = f / n
        order = sorted(range(puffs), key=lambda i: -((t0 + i / puffs) % 1))
        for i in order:
            t = (t0 + i / puffs) % 1
            r = (2.4 + 3.6 * t) * (1.0 if t < .75 else max(0.15, 1 - (t - .75) / .25)); cy = H - 5 - t * (H - 12); cx = 6 + t * 10 + math.sin(t * 5 + i * 2) * 2.2
            keep = 1.0
            lay = new(W, H)
            ellipse(lay, cx, cy, r, r * .9, 'cloud-lo'); ellipse(lay, cx - .6, cy - .6, r - 1, (r - 1) * .9, 'cloud-hi')
            
            p = lay.load()
            for y in range(H):
                for x in range(W):
                    if p[x, y][3] and not dither(x, y, keep + (0.0 if keep < 1 else 1)): p[x, y] = (0, 0, 0, 0)
            im.alpha_composite(lay)
        fr.append(im)
    return fr

def stars():
    v = [
        [['..#..'] , ],  # placeholder
    ]
    out = []
    def mk(kind, f):
        im = new(5, 5)
        if kind == 0:   # 1px dot twinkling between moon and cloud-hi / gone
            put(im, 2, 2, ['moon', 'cloud-hi', 'moon'][f])
        elif kind == 1:  # plus 3x3
            c = ['moon', 'cloud-hi', 'moon'][f]; put(im, 2, 2, 'moon' if f != 1 else 'cloud-hi')
            if f != 1:
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)): put(im, 2 + dx, 2 + dy, 'cloud-hi')
        elif kind == 2:  # long cross 5px
            put(im, 2, 2, 'moon')
            L = [2, 1, 2][f]
            for k in range(1, L + 1):
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)): put(im, 2 + dx * k, 2 + dy * k, 'moon' if k == 1 else 'cloud-hi')
        else:            # diamond sparkle
            put(im, 2, 2, 'moon')
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)): put(im, 2 + dx, 2 + dy, 'cloud-hi' if f != 2 else 'cloud-lo')
            if f == 1:
                for dx, dy in ((1, 1), (-1, 1), (1, -1), (-1, -1)): put(im, 2 + dx, 2 + dy, 'cloud-lo')
        return im
    return [[mk(k, f) for f in range(3)] for k in range(4)]

def build_fx():
    fire = [flame_frame(f) for f in range(6)]
    write('fx/campfire-fire.png', strip(fire), source='hand-pixeled (procedural flame; palette ember/glow/glow-core/alert), reference fx/campfire-sprite-sheet.png', license='original',
          frame=[16, 22], count=6, fps=9, anchor='bottom-center (8,21)', note='fire only; place over campfire-base.png with fire bottom at base ring centre')
    base = log_base()
    write('fx/campfire-base.png', base, source='hand-pixeled', license='original', anchor='bottom-center (16,13)', note='log ring + stones + crossed logs; draw fire with its bottom ~ y=9 of this sprite')
    comb = [campfire_frame(f, base) for f in fire]
    write('fx/campfire.png', strip(comb), source='composite of campfire-fire + campfire-base', license='original', frame=[32, 34], count=6, fps=9, anchor='bottom-center (16,33)')
    write('fx/campfire-light.png', light_pool(), source='hand-pixeled', license='original', anchor='center', note='additive-friendly lighting pool, centre it on the fire at ground level; 4 stepped bands glow-core/glow/ember with dithered edges, no alpha')
    sp = sparks()
    write('fx/campfire-sparks.png', strip(sp), source='hand-pixeled', license='original', frame=[8, 12], count=3, fps=6, anchor='bottom-center')
    sm = smoke_frames()
    write('fx/chimney-smoke.png', strip(sm), source='hand-pixeled puffs (assets/pixel/fx/chimney_smoke.png is dithered noise cone, did not fit the outlined-cloud look)', license='original', frame=[24, 40], count=8, fps=5, anchor='bottom-left (6,35): place so (6,35) sits on the chimney top centre')
    for k, fr in enumerate(stars()):
        write(f'fx/star-{k+1}.png', strip(fr), source='hand-pixeled', license='original', frame=[5, 5], count=3, fps=2, anchor='center (2,2)')
    return dict(fire=fire, base=base, comb=comb, light=light_pool(), sparks=sp, smoke=sm, stars=stars())
