#!/usr/bin/env python3
"""Deterministic pixel portrait builder: python3 packages/media/src/portraits/build_portraits.py
Faceset (CC0 Ninja Adventure) -> master palette (+ per-persona swaps shared with the sprite) -> transparent bg,
1px ink outline, cool moon rim on the upper-left, integer upscales and a card frame."""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '../../../..'))
sys.path.insert(0, os.path.join(ROOT, 'assets/pixel/composed/scripts'))
sys.path.insert(0, os.path.join(ROOT, 'packages/media/src/sprites/build'))
from palette import RGB, NAMES, LAB, rgb2lab, quantize, sheet
from PIL import Image
from cast import CAST
import portrait_accessories

SRC = os.path.join(ROOT, 'assets/pixel/characters/ninja-adventure-npcs-16px')
OUT = os.path.join(ROOT, 'assets/sprites')
NATIVE = 40            # 38px Faceset + 1px ink outline margin
SCALES = (2, 3, 4, 6)
BG = (20, 27, 27)
FACE_OVERRIDE = {}     # persona id -> source folder name, when the cast source has no usable Faceset
INV = {v: k for k, v in RGB.items()}

def lift_name(name, dl=0.09):
    """Next lighter palette colour with a similar hue (used for the moon rim)."""
    L, a, b = LAB[name]; best, bd = name, 9
    for k in NAMES:
        if k in ('ink', 'moon', 'glow-core'): continue
        L2, a2, b2 = LAB[k]
        if L2 <= L + 0.03: continue
        d = (L2 - (L + dl)) ** 2 * 3 + (a2 - a) ** 2 + (b2 - b) ** 2
        if d < bd: bd, best = d, k
    return best

def transparent_bg(im):
    im = im.copy(); px = im.load(); w, h = im.size
    seen = set(); stack = [(x, y) for x in range(w) for y in (0, h-1)] + [(x, y) for y in range(h) for x in (0, w-1)]
    while stack:
        x, y = stack.pop()
        if (x, y) in seen or not (0 <= x < w and 0 <= y < h): continue
        seen.add((x, y))
        if px[x, y][:3] == BG:
            px[x, y] = (0, 0, 0, 0)
            stack += [(x+1, y), (x-1, y), (x, y+1), (x, y-1)]
    return im

def outline_and_rim(im):
    w, h = im.size; out = Image.new('RGBA', (NATIVE, NATIVE), (0, 0, 0, 0)); out.alpha_composite(im, (1, 1))
    src = out.copy(); sp = src.load(); op = out.load(); ink = RGB['ink'] + (255,)
    for y in range(NATIVE):
        for x in range(NATIVE):
            if sp[x, y][3]: continue
            if any(0 <= x+dx < NATIVE and 0 <= y+dy < NATIVE and sp[x+dx, y+dy][3] for dx, dy in ((1,0),(-1,0),(0,1),(0,-1))):
                op[x, y] = ink
    # moon rim: opaque non-ink pixels whose up or left neighbour is outline/transparent (upper-left edge)
    for y in range(NATIVE):
        for x in range(NATIVE):
            p = sp[x, y]
            if not p[3] or INV.get(p[:3]) == 'ink': continue
            up = sp[x, y-1] if y else (0, 0, 0, 0); lf = sp[x-1, y] if x else (0, 0, 0, 0)
            if not up[3] or not lf[3]:
                n = INV.get(p[:3])
                if n: op[x, y] = RGB[lift_name(n)] + (255,)
    return out

def card(im, scale):
    s = im.resize((im.width*scale, im.height*scale), Image.NEAREST)
    pad = 2*scale; bw = scale
    c = Image.new('RGBA', (s.width + 2*pad + 2*bw + 2*scale, s.height + 2*pad + 2*bw + 2*scale), RGB['ink'] + (255,))
    d = Image.new('RGBA', (c.width - 4*scale, c.height - 4*scale), RGB['wall-mid'] + (255,)); c.alpha_composite(d, (2*scale, 2*scale))
    f = Image.new('RGBA', (d.width - 2*scale, d.height - 2*scale), RGB['sky-deep'] + (255,)); c.alpha_composite(f, (3*scale, 3*scale))
    c.alpha_composite(s, (c.width//2 - s.width//2, c.height//2 - s.height//2)); return c

def swap_img(im, swap):
    """Palette-name swap on a quantized RGBA image."""
    if not swap: return im
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            p = px[x, y]
            if p[3] and INV.get(p[:3]) in swap: px[x, y] = RGB[swap[INV[p[:3]]]] + (255,)
    return im

def build(c, swap_img=swap_img):
    src = FACE_OVERRIDE.get(c['id'], c['src'])
    p = os.path.join(SRC, src, 'Faceset.png')
    if not os.path.exists(p): raise SystemExit(f"no Faceset for {c['id']} ({src}); add FACE_OVERRIDE")
    im = Image.open(p).convert('RGBA'); im = transparent_bg(im)
    im = swap_img(quantize(im), c['swap'])
    im = portrait_accessories.apply(im, c['acc'])
    return outline_and_rim(im)

def check(im):
    assert im.size == (NATIVE, NATIVE)
    pal = set(RGB.values())
    for p in im.getdata():
        assert p[3] in (0, 255), 'alpha'
        if p[3]: assert p[:3] in pal, ('off palette', p)

def main():
    items = []
    for c in CAST:
        im = build(c, swap_img); check(im)
        d = os.path.join(OUT, c['id']); os.makedirs(d, exist_ok=True)
        im.save(os.path.join(d, 'portrait.png'), optimize=True)
        for s in SCALES: im.resize((NATIVE*s, NATIVE*s), Image.NEAREST).save(os.path.join(d, f'portrait@{s}x.png'), optimize=True)
        card(im, 4).save(os.path.join(d, 'portrait-card@4x.png'), optimize=True)
        items.append((c['id'], im))
    sheet(items, os.path.join(OUT, '_contact-portraits.png'), scale=3, cols=6, bg='sky-deep')
    print('portraits', len(items))

if __name__ == '__main__': main()
