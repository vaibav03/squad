#!/usr/bin/env python3
"""Deterministic cast builder. Run: python3 packages/media/src/sprites/build/build_cast.py
Draws the 19 personas procedurally (bodies.py + accessories.py, one body kit, one outline, one moon), applies a shared
moonlight pass, synthesises idle/walk/talk frames, validates them, then writes assets/sprites/** (per-persona strips,
frames.json, cast atlas, contact sheets). No randomness, no timestamps: re-runs are byte-identical."""
import os, sys, json
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '../../../../..'))
sys.path.insert(0, os.path.join(ROOT, 'assets/pixel/composed/scripts'))
sys.path.insert(0, HERE)
from palette import PALETTE, RGB, quantize, sheet
from PIL import Image
from cast import CAST
import bodies, accessories

SRC = os.path.join(ROOT, 'assets/pixel/characters/ninja-adventure-npcs-16px')
OUT = os.path.join(ROOT, 'assets/sprites')
CELL = 24
ANCHORS = {'feet': {'x': 12, 'y': 23}, 'head': {'x': 12, 'y': 9}, 'bubble': {'x': 12, 'y': 5}, 'hand': {'x': 17, 'y': 17}}
ANIMS = [('idle', 2, 2, True), ('walk', 4, 8, True), ('talk', 2, 8, True)]
INV = {v: k for k, v in RGB.items()}

def swap_img(im, swap):
    """Palette-name swap on a quantized RGBA image (also used by the portrait builder)."""
    if not swap: return im
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            p = px[x, y]
            if p[3] and INV.get(p[:3]) in swap: px[x, y] = RGB[swap[INV[p[:3]]]] + (255,)
    return im

# ------------------------------------------------------------------ shared moonlight
# One treatment for the whole cast: a 1 px cool rim on the upper-left edge pixels just inside the ink outline, a deeper
# cool shade on the lower-right ones. Tables are hand-tuned so faces stay readable and nothing goes muddy.
RIM = {'sky-deep': 'sky-mid', 'sky-mid': 'hill-mid', 'sky-low': 'cloud-lo', 'cloud-lo': 'cloud-hi', 'hill-far': 'cloud-lo',
       'hill-mid': 'hill-far', 'hill-near': 'hill-mid', 'ground': 'hill-near', 'leaf-dark': 'leaf-lit', 'leaf-lit': 'cloud-lo',
       'wall-mid': 'wall-lit', 'wall-shade': 'wall-mid', 'roof-wine': 'wall-shade', 'roof-shade': 'roof-wine', 'wood-dark': 'hill-near',
       'wood': 'wall-shade', 'wood-lit': 'wall-mid',  'glow': 'glow-core', 'ember': 'glow', 'alert': 'ember',
       'ok': 'cloud-hi', 'violet': 'cloud-hi'}
SHADE = {'skin-lt': 'wood-lit', 'wall-lit': 'wall-mid', 'cloud-hi': 'cloud-lo', 'moon': 'cloud-hi', 'glow-core': 'glow', 'glow': 'ember',
         'ember': 'wood', 'alert': 'roof-wine', 'ok': 'leaf-lit', 'violet': 'wall-shade', 'wall-mid': 'wall-shade',
         'wall-shade': 'hill-near', 'roof-wine': 'roof-shade', 'roof-shade': 'sky-deep', 'wood-lit': 'wood', 'wood': 'wood-dark',
         'wood-dark': 'sky-deep', 'leaf-lit': 'leaf-dark', 'leaf-dark': 'sky-deep', 'hill-far': 'hill-mid', 'hill-mid': 'hill-near',
         'hill-near': 'ground', 'ground': 'sky-deep', 'sky-low': 'sky-mid', 'sky-mid': 'sky-deep', 'cloud-lo': 'hill-far'}

def moonlight(g):
    """g: {(x,y): name}. Returns a new dict. Outline = ink pixels touching empty space."""
    def at(x, y): return g.get((x, y))
    outline = {p for p, c in g.items() if c == 'ink' and any(at(p[0] + dx, p[1] + dy) is None for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))}
    out = dict(g)
    for (x, y), c in g.items():
        if c == 'ink': continue
        rim = (x - 1, y) in outline or (x, y - 1) in outline
        shd = (x + 1, y) in outline or (x, y + 1) in outline
        if rim and not shd: out[(x, y)] = RIM.get(c, c)
        elif shd and not rim: out[(x, y)] = SHADE.get(c, c)
    return out

# ------------------------------------------------------------------ poses
def poses(d):
    if d == 'f':
        walk = [dict(legs=('down', 'down'), dy=1), dict(legs=('up', 'down'), dy=0), dict(legs=('down', 'down'), dy=1), dict(legs=('down', 'up'), dy=0)]
        base = ('down', 'down')
    else:
        walk = [dict(legs='contA', dy=1, arm=-1), dict(legs='pass', dy=0, arm=0), dict(legs='contB', dy=1, arm=1), dict(legs='pass', dy=0, arm=0)]
        base = 'stand'
    return {
        'idle': [dict(legs=base, dy=0), dict(legs=base, dy=1)],
        'walk': walk,
        'talk': [dict(legs=base, dy=1, mouth=False), dict(legs=base, dy=0, mouth=True, arm='up')],
    }

def draw_frame(c, d, anim, i):
    spec = c['look']; pose = dict(poses(d)[anim][i])
    has_prop = bool(spec.get('prop'))
    arm = pose.get('arm')
    if has_prop and arm == 'up': pose['arm'] = None            # the free hand stays down; the prop lifts instead
    cv, hy = bodies.render_body(spec, d, pose)
    accessories.apply(cv, c['acc'], d, hy, 'under', spec['acc_c'], i, anim)
    bodies.draw_mouth(cv, spec, d, hy, pose.get('mouth', False))
    accessories.apply(cv, c['acc'], d, hy, 'over', spec['acc_c'], i, anim)
    if has_prop:
        lift = -1 if (arm == 'up') else 0
        if d == 'f': hand = (15, bodies.TORSO_Y + 2 + lift)
        else:
            sw = pose.get('arm', 0); sw = sw if isinstance(sw, int) else 1
            hand = (12 + sw, bodies.TORSO_Y + 2 + lift)
        accessories.apply_prop(cv, spec['prop'], d, hand, i, spec['skin'][0])
    cv = moonlight(cv)
    im = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
    for (x, y), n in cv.items():
        assert 0 <= x < CELL and 0 <= y < CELL, (c['id'], d, anim, i, x, y)
        im.putpixel((x, y), RGB[n] + (255,))
    return im

def build_persona(c):
    frames = {}
    for anim, n, _, _ in ANIMS:
        for d in ('f', 'r'):
            for i in range(n): frames[f'{anim}_{d}_{i}'] = draw_frame(c, d, anim, i)
    return frames

# ------------------------------------------------------------------ automated checks
def check_persona(c, frames):
    pal = {v for v in RGB.values()}
    for name, im in frames.items():
        tag = f"{c['id']}/{name}"
        assert im.size == (CELL, CELL), tag
        bb = im.getbbox(); assert bb, f'{tag}: empty frame'
        px = im.load()
        for y in range(CELL):
            for x in range(CELL):
                p = px[x, y]
                if p[3] == 0: continue
                assert p[3] == 255 and p[:3] in pal, f'{tag}: off-palette pixel at {x},{y}: {p}'
        assert bb[0] >= 1 and bb[2] <= CELL - 1 and bb[1] >= 0 and bb[3] == CELL, f'{tag}: content outside cell / feet off the walk line {bb}'
    for anim, n, _, _ in ANIMS:
        for d in ('f', 'r'):
            seq = [frames[f'{anim}_{d}_{i}'].tobytes() for i in range(n)]
            for i in range(n):
                if n > 1: assert seq[i] != seq[(i + 1) % n], f"{c['id']}/{anim}_{d}: frames {i} and {(i + 1) % n} are identical (dead cycle)"

# ------------------------------------------------------------------ output
def write_persona(c, frames):
    names = [f'{a}_{d}_{i}' for a, n, _, _ in ANIMS for d in ('r', 'f') for i in range(n)]
    strip = Image.new('RGBA', (CELL * len(names), CELL), (0, 0, 0, 0)); fj = {}
    for k, n in enumerate(names):
        strip.alpha_composite(frames[n], (k * CELL, 0)); fj[n] = dict(x=k * CELL, y=0, w=CELL, h=CELL)
    anims = {}
    for a, n, fps, loop in ANIMS:
        for d in ('r', 'f'):
            anims[f'{a}_{d}'] = dict(frames=[f'{a}_{d}_{i}' for i in range(n)], fps=fps, loop=loop)
    d = os.path.join(OUT, c['id']); os.makedirs(d, exist_ok=True)
    strip.save(os.path.join(d, 'sheet.png'), optimize=True)
    with open(os.path.join(d, 'frames.json'), 'w') as f:
        json.dump(dict(version=1, id=c['id'], cell=dict(w=CELL, h=CELL), image='sheet.png', anchors=ANCHORS, frames=fj, anims=anims), f, indent=2); f.write('\n')
    return names, anims

def contact_sheets(allf):
    still = lambda c, d: allf[c['id']][f'idle_{d}_0']
    items = []
    for c in CAST:
        items.append((c['id'] + ' f', still(c, 'f'))); items.append((c['id'] + ' r', still(c, 'r')))
    sheet(items, os.path.join(OUT, '_contact-cast-2x.png'), scale=2, cols=10, bg='sky-deep', pad=6)
    sheet(items, os.path.join(OUT, '_contact-cast-3x.png'), scale=3, cols=8, bg='sky-deep', pad=6)
    # all walk + talk frames: 8 walk (4 f + 4 r) then 4 talk (2 f + 2 r) per persona = 12 per row
    rows = []
    for c in CAST:
        fr = allf[c['id']]
        rows += [(f"{c['id'][:9]} w{d}{i}", fr[f'walk_{d}_{i}']) for d in 'fr' for i in range(4)]
        rows += [(f"talk {d}{i}", fr[f'talk_{d}_{i}']) for d in 'fr' for i in range(2)]
    sheet(rows, os.path.join(OUT, '_contact-anims.png'), scale=3, cols=12, bg='sky-deep', pad=3)

def main():
    os.makedirs(OUT, exist_ok=True)
    all_frames = {}; allf = {}; meta = []
    for c in CAST:
        fr = build_persona(c); check_persona(c, fr); names, anims = write_persona(c, fr)
        all_frames[c['id']] = (names, fr); allf[c['id']] = fr
        meta.append(dict(id=c['id'], name=c['name'], role=c['role'], source='procedural (squad-art, CC0 pack for portraits)', anims=anims))
    maxn = max(len(n) for n, _ in all_frames.values())
    atlas = Image.new('RGBA', (CELL * maxn, CELL * len(CAST)), (0, 0, 0, 0)); hashj = {}
    for row, c in enumerate(CAST):
        names, fr = all_frames[c['id']]
        for k, n in enumerate(names):
            atlas.alpha_composite(fr[n], (k * CELL, row * CELL))
            hashj[f"{c['id']}/{n}"] = dict(frame=dict(x=k * CELL, y=row * CELL, w=CELL, h=CELL), rotated=False, trimmed=False,
                spriteSourceSize=dict(x=0, y=0, w=CELL, h=CELL), sourceSize=dict(w=CELL, h=CELL), pivot=dict(x=0.5, y=round(23 / 24, 4)))
    atlas.save(os.path.join(OUT, 'cast.png'), optimize=True)
    with open(os.path.join(OUT, 'cast.json'), 'w') as f:
        json.dump(dict(frames=hashj, meta=dict(app='squad-media-art', version='1', image='cast.png', format='RGBA8888',
                  size=dict(w=atlas.width, h=atlas.height), scale='1')), f, indent=1)
    with open(os.path.join(OUT, 'cast.meta.json'), 'w') as f:
        json.dump(dict(version=1, cell=dict(w=CELL, h=CELL), anchors=ANCHORS, personas=meta), f, indent=1)
    contact_sheets(allf)
    print('built', len(CAST), 'personas; all frames validated')

if __name__ == '__main__': main()
