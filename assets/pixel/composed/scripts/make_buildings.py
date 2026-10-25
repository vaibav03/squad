#!/usr/bin/env python3
"""Regenerates every night building sprite, interior, contact sheet and provenance. `python3 make_buildings.py`"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from buildings_common import *
import buildings_houses as BH, buildings_windmill as BW, buildings_landmarks as BL, buildings_interiors as BI
from buildings_kit import *

PROV = {}
SPR = []   # (name, image) for the contact sheet
SRC_TOWN = 'assets/pixel/buildings/autumn-town/Props_TownDay.png'
LIC_TOWN = 'Autumn Town (Nirva) - free to use/edit, no credit required (see assets/pixel/LICENSES.md)'

def out(rel, im, **meta):
    verify_palette(im, rel)
    path = os.path.join(OUT, rel); save(im, path)
    meta.update(file='assets/pixel/composed/buildings/' + rel, size=[im.width, im.height])
    PROV[rel] = meta
    return im

def sprite(rel, im, source, license_, anchor=None, sheet_=True, **meta):
    """trim, anchor = bottom-centre of trimmed bbox unless given"""
    im, a = trim_anchor(im)
    out(rel, im, anchor=list(anchor or a), anchor_note='bottom-center ground anchor in px from sprite top-left', source=source, license=license_, **meta)
    if sheet_: SPR.append((rel[:-4], im))
    return im

LOCK_SET = ['ink', 'sky-deep', 'hill-near', 'hill-mid', 'wall-shade']

def locked_from(img):
    im = quantize(img, allowed=LOCK_SET)
    p = im.load()   # keep outline crisp: darkest of set for former-ink handled by quantize; add soft cool rim
    return im

def padlock():
    c = Cv(8, 8)
    c.rect(2, 0, 5, 0, 'ink'); c.vline(1, 1, 3, 'ink'); c.vline(6, 1, 3, 'ink'); c.vline(2, 1, 3, 'wall-lit'); c.vline(5, 1, 3, 'wall-mid')
    c.rect(0, 3, 7, 7, 'ink'); c.rect(1, 4, 6, 6, 'glow'); c.hline(1, 6, 4, 'glow-core'); c.hline(1, 6, 6, 'ember'); c.p(3, 5, 'ink'); c.p(4, 5, 'ink')
    return c.im

def signboard():
    c = Cv(32, 14)
    c.rect(0, 0, 4, 1, 'wood-dark'); c.p(0, 0, 'ink'); c.hline(0, 4, 2, 'ink')
    c.vline(4, 2, 4, 'ink'); c.vline(27, 2, 4, 'ink'); c.hline(4, 27, 1, 'ink') if False else None
    c.hline(0, 31, 0, 'ink'); c.hline(0, 31, 1, 'wood-dark'); c.hline(0, 31, 2, 'ink')
    for x in (4, 27): c.vline(x, 3, 4, 'wall-mid')
    c.rect(1, 5, 30, 13, 'ink'); c.rect(2, 6, 29, 12, 'wood'); c.hline(2, 29, 6, 'wood-lit'); c.hline(2, 29, 12, 'wood-dark')
    c.p(3, 7, 'wood-dark'); c.p(28, 7, 'wood-dark'); c.p(3, 11, 'wood-dark'); c.p(28, 11, 'wood-dark')
    return c.im

def lamp_post(lit=True):
    D = load(TOWN_DAY); im = largest_component(D.crop((396, 236, 419, 331)))
    g = night_grade(im); c = Cv(g.width, g.height); c.paste(g, 0, 0)
    px = im.load(); gp = g.load()
    for y in range(g.height):
        for x in range(g.width):
            s = px[x, y]
            if s[3] and s[0] > 235 and s[1] > 235 and y < 24: c.p(x, y, 'glow-core' if lit else 'wall-mid')
    for y in range(0, 26):
        for x in range(g.width):
            n = c.name(x, y)
            if n in ('wall-lit', 'cloud-hi', 'cloud-lo', 'skin-lt') and lit: c.p(x, y, 'glow')
    if lit:
        pass
    return c.im

def main():
    D = load(TOWN_DAY)
    # ---------------- houses
    for n in BH.HOUSES:
        for lit in (0, 1):
            im, meta = BH.build(n, D, lit)
            nm = 'house_%s_%s.png' % (n, 'lit' if lit else 'dark')
            sprite('houses/' + nm, im, SRC_TOWN + ' (cut-out box %s, re-graded by hand-tuned night ramp, windows/chimney/sign plank added)' % (BH.HOUSES[n]['box'],), LIC_TOWN,
                   variant='lit' if lit else 'dark', windows=meta['windows'], sign_slot=meta['sign_slot'], chimney_x=meta['chimney_top'][0],
                   role='chapter house silhouette: ' + n, pad_top=meta['pad_top'])
    sprite('houses/signboard_empty.png', signboard(), 'hand-pixeled (this project)', 'project-original CC0-equivalent', note='hanging sign 32x14, flat plank region x2..29,y6..12 for text overlay')
    # ---------------- windmill
    for lit in (0, 1):
        sprite('windmill/windmill_%s.png' % ('lit' if lit else 'dark'), BW.body(lit), 'hand-pixeled (this project); 128px vector windmill rejected: isometric, does not match side-view scale', 'project-original',
               anchor=None, hub=[BW.HUB[0] - BW.body(1).getbbox()[0], BW.HUB[1] - BW.body(1).getbbox()[1]], note='tower body without sails; hub = sail pivot in px from sprite top-left')
    strip, frames = BW.sail_strip(8)
    out('windmill/windmill_sails_strip.png', strip, source='hand-pixeled (rasterised procedurally, palette only)', license='project-original',
        frame_size=[BW.SS, BW.SS], frames=8, angle_step_deg=11.25, base_angle_deg=22.5, cycle_deg=90, pivot=[BW.SS // 2, BW.SS // 2],
        usage='rotate frames 0..7 for a spin loop (4-fold symmetric: 8 frames cover the full 90deg cycle). Place sprite so pivot sits on windmill hub; hub offset in windmill_*.png is its hub field.')
    for i, f in enumerate(frames[:1]): pass
    # ---------------- landmarks (active + locked)
    LM = [('council_hall', BL.council_hall), ('debate_stage', BL.debate_stage), ('round_table_pavilion', BL.round_table),
          ('feynman_porch', BL.feynman_porch), ('oral_exam_hut', BL.oral_hut), ('rubric_courthouse', BL.rubric_courthouse),
          ('exam_oracle', BL.exam_oracle), ('devils_ta_cave', BL.devils_ta_cave), ('classroom_house', BL.classroom_house)]
    for name, fn in LM:
        im, m = fn(True); dk, _ = fn(False)
        src = 'hand-pixeled landmark composed in Autumn Town style'
        if name == 'debate_stage': src = SRC_TOWN + ' (stage with curtains, night re-grade) + hand-pixeled lecterns/bunting/banner'
        if name == 'devils_ta_cave': src = 'assets/pixel/buildings/autumn-town/Props_ForestDay.png (cave rock) + hand-pixeled mouth, chalkboard, glints'
        lic = LIC_TOWN if name in ('debate_stage', 'devils_ta_cave') else 'project-original (Autumn Town palette-matched style)'
        a = sprite('landmarks/%s.png' % name, im, src, lic, variant='active', **{k: v for k, v in m.items()})
        # locked: from dark render, same trimmed box as active
        bb = im.getbbox(); lk = locked_from(dk.crop(bb))
        sprite('landmarks/%s_locked.png' % name, lk, src + ' -> locked remap', lic, variant='locked', anchor=[a.width // 2, a.height - 1], note='remap to ink/sky-deep/hill-near/hill-mid/wall-shade only; windows dark; same pixel size/anchor as active')
    # phone booth
    off, _ = BL.panic_booth(False); glow, _ = BL.panic_booth(True)
    bb = glow.getbbox()
    sprite('landmarks/panic_booth_off.png', off.crop(bb), 'hand-pixeled landmark', 'project-original', variant='off')
    sprite('landmarks/panic_booth_glow.png', glow.crop(bb), 'hand-pixeled landmark', 'project-original', variant='glow', note='glowing at 2am; halo dither included in canvas')
    sprite('landmarks/panic_booth_locked.png', locked_from(off.crop(bb)), 'hand-pixeled landmark -> locked remap', 'project-original', variant='locked')
    sprite('landmarks/padlock_8x8.png', padlock(), 'hand-pixeled', 'project-original', anchor=[4, 7], note='overlay centred on a locked landmark door')
    sprite('props/lamp_post_lit.png', lamp_post(True), SRC_TOWN + ' (lamp post box 396,236,419,331) night re-graded', LIC_TOWN, variant='lit')
    # ---------------- interiors
    ints = []
    for n, fn in (('interior_classroom', BI.classroom), ('interior_study', BI.study), ('interior_council', BI.council), ('interior_oral_exam', BI.oral_room)):
        im, m = fn()
        out('interiors/%s.png' % n, im, source='hand-pixeled (Autumn Town prop style, palette-only)', license='project-original', floor_y=BI.FLOOR, **m)
        ints.append((n, im))
    sheet(ints, os.path.join(COMP, '_contact-interiors.png'), scale=2, cols=2, pad=6)
    # ---------------- sheets
    sheet(SPR, os.path.join(COMP, '_contact-buildings.png'), scale=2, cols=6, pad=6)
    street(D)
    with open(os.path.join(OUT, 'provenance.json'), 'w') as f: json.dump(PROV, f, indent=1)
    # final verification over every PNG
    n = 0
    for dp, _, fs in os.walk(OUT):
        for fn in fs:
            if fn.endswith('.png'): verify_palette(Image.open(os.path.join(dp, fn)).convert('RGBA'), fn); n += 1
    print('ok: %d pngs palette-clean' % n)

def street(D):
    W, H = 880, 270; G = 252
    c = Cv(W, H)
    for y in range(H):
        t = y / G
        for x in range(W): c.p(x, y, 'sky-deep' if t < .3 else 'sky-mid' if t < .62 else 'sky-low')
    # dither bands
    for y in range(int(G * .3) - 2, int(G * .3) + 2):
        for x in range(W):
            if (x + y) % 2: c.p(x, y, 'sky-mid')
    for y in range(int(G * .62) - 2, int(G * .62) + 2):
        for x in range(W):
            if (x + y) % 2: c.p(x, y, 'sky-low')
    import math
    for (x, y) in ((40, 20), (120, 40), (200, 12), (260, 50), (330, 24), (420, 36), (500, 14), (560, 52), (90, 70), (470, 76)): c.p(x, y, 'moon' if (x + y) % 3 else 'cloud-hi')
    c.ellipse(520, 34, 9, 9, 'moon'); c.ellipse(524, 31, 8, 8, 'sky-deep') if False else None
    c.ellipse(515, 34, 9, 9, 'moon'); c.ellipse(520, 31, 8, 8, 'sky-mid')
    for x in range(W):
        y1 = G - 100 + int(18 * math.sin(x / 70.0) + 8 * math.sin(x / 23.0))
        for y in range(y1, G): c.p(x, y, 'hill-far')
        c.p(x, y1, 'cloud-lo')
    for x in range(W):
        y1 = G - 64 + int(12 * math.sin(x / 55.0 + 2) + 5 * math.sin(x / 17.0))
        for y in range(y1, G): c.p(x, y, 'hill-mid')
        c.p(x, y1, 'hill-far'); 
    for x in range(W):
        y1 = G - 28 + int(5 * math.sin(x / 40.0 + 1))
        for y in range(y1, G): c.p(x, y, 'hill-near')
        c.p(x, y1, 'hill-mid')
    c.rect(0, G, W - 1, H - 1, 'ground'); c.hline(0, W - 1, G, 'hill-near')
    for x in range(0, W, 9): c.p(x, G + 6, 'hill-near'); c.p(x + 4, G + 11, 'hill-near')
    # place sprites: (rel, x_center)
    def put(rel, cx, dy=0):
        im = Image.open(os.path.join(OUT, rel)).convert('RGBA'); c.paste(im, cx - im.width // 2, G + 2 - im.height + dy)
    put('windmill/windmill_lit.png', 60)
    wm = Image.open(os.path.join(OUT, 'windmill/windmill_lit.png')).convert('RGBA'); sf = frames_cache()[1]
    c.paste(sf, 60 - BW.SS // 2, G + 2 - wm.height + BW.HUB[1] - BW.SS // 2)
    put('houses/house_hut_lit.png', 172)
    put('houses/house_tenement_lit.png', 300)
    put('props/lamp_post_lit.png', 392)
    put('houses/house_shop_lit.png', 500)
    put('props/lamp_post_lit.png', 612)
    put('houses/house_cottage_lit.png', 736)
    put('props/lamp_post_lit.png', 862)
    im = c.im; verify_palette(im, 'street')
    save(im, os.path.join(COMP, '_preview-street-1x.png'))
    save(im.resize((W * 3, H * 3), Image.NEAREST), os.path.join(COMP, '_preview-street.png'))

_fc = {}
def frames_cache():
    if not _fc: _fc[1] = BW.sails_frame(22.5 + 2 * 11.25), BW.sails_frame(22.5 + 2 * 11.25)
    return _fc[1]

if __name__ == '__main__': main()
