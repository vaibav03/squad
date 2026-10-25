#!/usr/bin/env python3
"""Compose upscaled card frames for an iMessage GIF (format v2 sprites, 32 px cells, faces right).
Usage: compose_frames.py <id> <anim> <scale> <bg:card|transparent> <outdir>
anim: idle | walk | talk | wave | hello. One PNG per 125 ms (8 fps). Deterministic, master-palette pixels only."""
import os, sys, json
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '../../../..'))
sys.path.insert(0, os.path.join(ROOT, 'assets/pixel/composed/scripts'))
from palette import RGB
from PIL import Image

CELL = 32; CARD_ART = 38           # card is 38 art pixels square (headroom for the bubble), scaled by `scale`

def loader(pid):
    d = os.path.join(ROOT, 'assets/sprites', pid); fj = json.load(open(os.path.join(d, 'frames.json'))); cache = {}
    def get(name):
        r = fj['frames'][name]
        if r['strip'] not in cache: cache[r['strip']] = Image.open(os.path.join(d, r['strip'])).convert('RGBA')
        return cache[r['strip']].crop((r['x'], r['y'], r['x'] + r['w'], r['y'] + r['h']))
    return get, fj

def bubble(card, head, ox, oy):
    """3-dot speech bubble at art coords (card space), drawn after the frame so it may exceed the cell."""
    px = card.load(); w = RGB['wall-lit'] + (255,); k = RGB['ink'] + (255,)
    x0 = ox + head['x'] + 4; y0 = oy + max(head['y'] - 9, 1)
    for x in range(x0, x0 + 9):
        for y in range(y0, y0 + 5):
            if x in (x0, x0 + 8) and y in (y0, y0 + 4): continue
            px[x, y] = k if (x in (x0, x0 + 8) or y in (y0, y0 + 4)) else w
    for x in (x0 + 2, x0 + 4, x0 + 6): px[x, y0 + 2] = k
    px[x0 + 2, y0 + 5] = k; px[x0 + 1, y0 + 6] = k

def sequence(get, anim):
    f = lambda a, n: get(f'{a}/{n}')
    if anim == 'idle': return [(f('idle', 0), False)] * 4 + [(f('idle', 1), False)] * 4
    if anim == 'walk': return [(f('walk', i), False) for i in (0, 1, 2, 3)] * 2
    if anim == 'wave': return [(f('wave', i), False) for i in (0, 1)] * 4
    if anim == 'talk': return [(f('talk', i), True) for i in (0, 0, 1, 1)] * 2
    if anim == 'hello':
        return [(f('idle', 0), False)] * 2 + [(f('wave', i), False) for i in (0, 1)] * 3 + [(f('talk', i), True) for i in (0, 1)] * 2 + [(f('idle', 1), False)] * 2
    raise SystemExit('bad anim')

def render(frame, show_bubble, head, scale, bg):
    art = Image.new('RGBA', (CARD_ART, CARD_ART), RGB['sky-deep'] + (255,) if bg == 'card' else (0, 0, 0, 0)); px = art.load()
    ox, oy = (CARD_ART - CELL) // 2, CARD_ART - CELL - 2
    if bg == 'card':
        gy = oy + 31                                          # ground line at the feet
        for y in range(gy + 1, CARD_ART):
            for x in range(CARD_ART): px[x, y] = RGB['ground'] + (255,)
        for x in range(CARD_ART): px[x, gy + 1] = RGB['hill-near'] + (255,)
        for x in range(ox + 6, ox + 27):                     # hard-edged shadow ellipse on the ground
            px[x, gy] = RGB['ground'] + (255,)
        for x in range(0, CARD_ART, 4): px[x, gy + 3] = RGB['hill-near'] + (255,) if gy + 3 < CARD_ART else None
    art.alpha_composite(frame, (ox, oy))
    if show_bubble: bubble(art, head, ox, oy)
    return art.resize((CARD_ART * scale, CARD_ART * scale), Image.NEAREST)

def main():
    pid, anim, scale, bg, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4], sys.argv[5]
    os.makedirs(out, exist_ok=True); get, fj = loader(pid); head = fj['anchors']['head']
    for i, (fr, b) in enumerate(sequence(get, anim)): render(fr, b, head, scale, bg).save(os.path.join(out, f'f{i:03d}.png'))
if __name__ == '__main__': main()
