#!/usr/bin/env python3
"""Deterministic cast builder. Run: python3 packages/media/src/sprites/build/build_cast.py
Reads CC0 Ninja Adventure sheets, quantizes to the master palette, applies per-persona swaps and accessories,
synthesises idle/talk frames, writes assets/sprites/** (per-persona strips, frames.json, cast atlas)."""
import os, sys, json
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '../../../../..'))
sys.path.insert(0, os.path.join(ROOT, 'assets/pixel/composed/scripts'))
sys.path.insert(0, HERE)
from palette import PALETTE, RGB, quantize
from PIL import Image
from cast import CAST
import accessories

SRC = os.path.join(ROOT, 'assets/pixel/characters/ninja-adventure-npcs-16px')
OUT = os.path.join(ROOT, 'assets/sprites')
CELL = 24; OX, OY = 4, 7
DIRS = {'f': 0, 'r': 3}
ANCHORS = {'feet': {'x': 12, 'y': 23}, 'head': {'x': 12, 'y': 9}, 'bubble': {'x': 12, 'y': 5}, 'hand': {'x': 17, 'y': 17}}
ANIMS = [('idle', 2, 2, True), ('walk', 4, 8, True), ('talk', 2, 8, True)]
INV = {v: k for k, v in RGB.items()}

def swap_img(im, swap):
    if not swap: return im
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            p = px[x, y]
            if p[3] and INV.get(p[:3]) in swap: px[x, y] = RGB[swap[INV[p[:3]]]] + (255,)
    return im

def shift_up_half(im, dy):
    """Breathing: upper body (rows above the waist) moves down dy px, join row overwritten."""
    out = Image.new('RGBA', im.size, (0, 0, 0, 0))
    out.alpha_composite(im.crop((0, 8, 16, 16)), (0, 8))
    out.alpha_composite(im.crop((0, 0, 16, 8)), (0, dy))
    # re-draw row 8 from the original so the body stays attached
    return out

def top_row(im):
    bb = im.getbbox(); return bb[1] if bb else 0

def build_persona(c):
    d = os.path.join(SRC, c['src'])
    walk = Image.open(os.path.join(d, 'SpriteSheet.png')).convert('RGBA')  # cols = down,up,left,right; rows 0-3 = walk frames
    idle = walk  # row 0 is the standing pose
    frames = {}
    for dn, col in DIRS.items():
        base_idle = idle.crop((col*16, 0, col*16+16, 16))
        walks = [walk.crop((col*16, r*16, col*16+16, r*16+16)) for r in range(4)]
        prep = lambda im: swap_img(quantize(im), c['swap'])
        base_idle = prep(base_idle); walks = [prep(w) for w in walks]
        sets = {
            'idle': [base_idle, shift_up_half(base_idle, 1)],
            'walk': walks,
            'talk': talk_pair(base_idle, dn),
        }
        for anim, ims in sets.items():
            for i, im in enumerate(ims):
                im = accessories.apply(im, c['acc'], dn, anim, i)
                cell = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0)); cell.alpha_composite(im, (OX, OY))
                frames[f'{anim}_{dn}_{i}'] = cell
    return frames

def talk_pair(base, dn):
    a = base.copy()
    b = shift_up_half(base, 1)
    return [a, mouth_open(b, dn)]

def mouth_open(im, dn):
    """Front: darken a 2px mouth under the eyes. Side: 1px mouth at the face edge. Falls back to a plain bob."""
    im = im.copy(); px = im.load()
    ink = RGB['ink'] + (255,)
    if dn == 'f':
        # find lowest skin-ish row of the face between rows 7..11, centre columns
        for y in (10, 9):
            if px[7, y][3] and px[8, y][3] and INV.get(px[7, y][:3]) in ('skin-lt', 'wood-lit', 'wood', 'ember', 'glow'):
                px[7, y] = ink; px[8, y] = ink; break
    return im

def write_persona(c, frames):
    names = [f'{a}_{d}_{i}' for a, n, _, _ in ANIMS for d in ('r', 'f') for i in range(n)]
    sheet = Image.new('RGBA', (CELL*len(names), CELL), (0, 0, 0, 0))
    fj = {}
    for k, n in enumerate(names):
        sheet.alpha_composite(frames[n], (k*CELL, 0)); fj[n] = dict(x=k*CELL, y=0, w=CELL, h=CELL)
    anims = {}
    for a, n, fps, loop in ANIMS:
        for d in ('r', 'f'):
            anims[f'{a}_{d}'] = dict(frames=[f'{a}_{d}_{i}' for i in range(n)], fps=fps, loop=loop)
    d = os.path.join(OUT, c['id']); os.makedirs(d, exist_ok=True)
    sheet.save(os.path.join(d, 'sheet.png'), optimize=True)
    json.dump(dict(version=1, id=c['id'], cell=dict(w=CELL, h=CELL), image='sheet.png', anchors=ANCHORS, frames=fj, anims=anims),
              open(os.path.join(d, 'frames.json'), 'w'), indent=2); open(os.path.join(d, 'frames.json'), 'a').write('\n')
    return names, anims

def main():
    os.makedirs(OUT, exist_ok=True)
    all_frames = {}; meta = []
    for c in CAST:
        fr = build_persona(c); names, anims = write_persona(c, fr)
        all_frames[c['id']] = (names, fr)
        meta.append(dict(id=c['id'], name=c['name'], role=c['role'], source=c['src'], anims=anims))
    # combined atlas: one row per persona
    maxn = max(len(n) for n, _ in all_frames.values())
    atlas = Image.new('RGBA', (CELL*maxn, CELL*len(CAST)), (0, 0, 0, 0)); hashj = {}
    for row, c in enumerate(CAST):
        names, fr = all_frames[c['id']]
        for k, n in enumerate(names):
            atlas.alpha_composite(fr[n], (k*CELL, row*CELL))
            hashj[f"{c['id']}/{n}"] = dict(frame=dict(x=k*CELL, y=row*CELL, w=CELL, h=CELL), rotated=False, trimmed=False,
                spriteSourceSize=dict(x=0, y=0, w=CELL, h=CELL), sourceSize=dict(w=CELL, h=CELL), pivot=dict(x=0.5, y=round(23/24, 4)))
    atlas.save(os.path.join(OUT, 'cast.png'), optimize=True)
    json.dump(dict(frames=hashj, meta=dict(app='squad-media-art', version='1', image='cast.png', format='RGBA8888',
              size=dict(w=atlas.width, h=atlas.height), scale='1')), open(os.path.join(OUT, 'cast.json'), 'w'), indent=1)
    json.dump(dict(version=1, cell=dict(w=CELL, h=CELL), anchors=ANCHORS, personas=meta), open(os.path.join(OUT, 'cast.meta.json'), 'w'), indent=1)
    print('built', len(CAST), 'personas')

if __name__ == '__main__': main()
