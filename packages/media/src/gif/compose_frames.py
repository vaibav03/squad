#!/usr/bin/env python3
"""Compose upscaled card frames for an iMessage GIF. Usage: compose_frames.py <id> <anim> <scale> <bg> <outdir>
anim: idle | walk | talk | hello. Frames are emitted at 8 fps (one PNG per 125 ms). Deterministic."""
import os, sys, json
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '../../../..'))
sys.path.insert(0, os.path.join(ROOT, 'assets/pixel/composed/scripts'))
from palette import RGB
from PIL import Image

CARD = 160
def load_frames(pid):
    d = os.path.join(ROOT, 'assets/sprites', pid)
    fj = json.load(open(os.path.join(d, 'frames.json'))); sheet = Image.open(os.path.join(d, fj['image'])).convert('RGBA')
    def get(name):
        r = fj['frames'][name]; return sheet.crop((r['x'], r['y'], r['x']+r['w'], r['y']+r['h']))
    return get

def bubble(im):
    """3-dot speech bubble above the head (cell coords), palette colours only."""
    px = im.load(); w = RGB['wall-lit'] + (255,); k = RGB['ink'] + (255,)
    x0, y0 = 15, 1
    for x in range(x0, x0+9):
        for y in range(y0, y0+5):
            edge = x in (x0, x0+8) or y in (y0, y0+4)
            if (x in (x0, x0+8)) and (y in (y0, y0+4)): continue
            px[x, y] = k if edge else w
    for x in (x0+2, x0+4, x0+6): px[x, y0+2] = k
    px[x0+2, y0+5] = k; px[x0+1, y0+6] = k
    return im

def sequence(pid, anim):
    g = load_frames(pid)
    if anim == 'idle': return [g('idle_f_0')]*4 + [g('idle_f_1')]*4
    if anim == 'walk': return [g(f'walk_r_{i}') for i in (0, 1, 2, 3)]*2
    if anim == 'talk': return [bubble(g(f'talk_f_{i}').copy()) for i in (0, 0, 1, 1)]*2
    if anim == 'hello':
        return [g('idle_f_0')]*4 + [g('talk_f_0'), g('talk_f_1')]*4 + [g('idle_f_1')]*2 + [g('idle_f_0')]*2
    raise SystemExit('bad anim')

def card(frame, scale, bg):
    c = Image.new('RGBA', (CARD, CARD), RGB['sky-deep'] + (255,) if bg == 'card' else (0, 0, 0, 0))
    if bg == 'card':
        px = c.load(); 
        # hard-edged ground ellipse (palette colours only) under the feet + a lit rim row
        cx, cy = CARD//2, CARD - 24
        for y in range(cy-5, cy+6):
            for x in range(cx-34, cx+35):
                if ((x-cx)/34)**2 + ((y-cy)/5)**2 <= 1: px[x, y] = RGB['ground'] + (255,)
        for x in range(0, CARD, 1):
            for y in range(CARD-10, CARD): px[x, y] = RGB['ground'] + (255,)
    s = frame.resize((frame.width*scale, frame.height*scale), Image.NEAREST)
    # feet anchor (12,23) -> sits at the ground ellipse centre
    c.alpha_composite(s, (CARD//2 - 12*scale, CARD - 24 - 23*scale + 4*scale//scale*0))
    return c

def main():
    pid, anim, scale, bg, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4], sys.argv[5]
    os.makedirs(out, exist_ok=True)
    for i, fr in enumerate(sequence(pid, anim)): card(fr, scale, bg).save(os.path.join(out, f'f{i:03d}.png'))

if __name__ == '__main__': main()
