#!/usr/bin/env python3
"""Regenerates every prop/fx/ui sprite + contact sheets + provenance. Run: python3 make_props.py"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from props_draw import *
import props_fx, props_ui, props_world as W

EMOTE = os.path.join(PIX, 'ui/ninja-adventure/Emote')
EMOTES = {'alert': 21, 'question': 23, 'heart': 27, 'zzz': 28, 'dots': 20, 'smile': 11}
def emotes():
    out = {}
    allowed = ['ink', 'wall-lit', 'wall-mid', 'wall-shade', 'alert', 'roof-wine', 'skin-lt', 'wood-dark']
    for k, n in EMOTES.items():
        src = load(os.path.join(EMOTE, f'emote{n}.png'))
        from palette import quantize
        q = quantize(src, allowed=allowed)
        c = new(16, 16); c.alpha_composite(q, ((16 - q.width) // 2, 16 - q.height))
        # bubble fill -> wall-lit so it matches the speech bubbles; dark glyph -> ink
        p = c.load()
        for y in range(16):
            for x in range(16):
                r = p[x, y]
                if r[3] and r[:3] == RGB['skin-lt']: p[x, y] = RGB['wall-lit'] + (255,)
                elif r[3] and r[:3] == RGB['wood-dark']: p[x, y] = RGB['ink'] + (255,)
        out[k] = c
        write(f'ui/emote-{k}.png', c, source=f'assets/pixel/ui/ninja-adventure/Emote/emote{n}.png requantized', license='CC0 Ninja Adventure', native='16px, 2x coarser than scene art: use ONLY at scale 1, above characters', anchor='bottom-center')
    return out

def sheets(R):
    S = os.path.join(ROOT)
    fx = R['fx']
    items = [(f'fire{i}', f) for i, f in enumerate(fx['fire'])] + [('base', fx['base'])] + [(f'camp{i}', f) for i, f in enumerate(fx['comb'][:3])] + [('light', fx['light'])] + \
            [(f'sp{i}', f) for i, f in enumerate(fx['sparks'])] + [(f'smoke{i}', f) for i, f in enumerate(fx['smoke'])] + [(f'star{k}{i}', im) for k, s in enumerate(fx['stars']) for i, im in enumerate(s)]
    sheet(items, os.path.join(S, '_contact-fx.png'), scale=3, cols=8)
    u = R['ui']; it = [('env', u['env'][0])] + [(f'pop{i}', f) for i, f in enumerate(u['env'][1:])] + [('lock', u['pl']), ('unlock', u['pu'])] + [(f'ring{i}', f) for i, f in enumerate(u['rs'])] + \
        [('check', u['ck']), ('!', u['mk'][0]), ('?', u['mk'][1])]
    for n, fr in u['lan'].items(): it += [(f'{n}{i}', f) for i, f in enumerate(fr)]
    it += [(f'z{i}', f) for i, f in enumerate(u['zz'])] + [(f'note{i}', f) for i, f in enumerate(u['nt'])]
    for nm in ('wall', 'moon'):
        it += [(f'bub-{nm}', u['bub'][nm])] + [(f't{i}', t) for i, t in enumerate(u['bub'][nm + 't'])]
    it += [('withheld', u['wb']), ('board', u['bd']), ('board-lit', u['bl'])] + [('card-' + k, v) for k, v in u['cards'].items()] + [('door-closed', u['door'][0]), ('door-open', u['door'][1])] + [('emote-' + k, v) for k, v in R['emo'].items()]
    sheet(it, os.path.join(S, '_contact-ui.png'), scale=4, cols=8)
    w = R['world']
    it = list(w['pack'].items()) + [('lamp-halo', w['lamp_halo'])] + list(w['forest'].items()) + [(f'tree{i+1}', t) for i, t in enumerate(w['trees'])] + [(f'pine{i+1}', t) for i, t in enumerate(w['pines'])] + \
        [(f'bush{i+1}', t) for i, t in enumerate(w['bushes'])] + [(f'flower{i+1}', t) for i, t in enumerate(w['flowers'])] + [('fence', w['fence']), ('fence2', strip([w['fence']] * 3)), ('mailbox', w['mailbox'])] + \
        [('win-' + k, v) for k, v in w['win'].items()] + list(w['indoor'].items()) + [('van0', W.van(0)), ('van1', W.van(1)), ('luggage0', W.van(0, True)), ('road', strip([w['road']] * 2)), ('door', R['ui']['door'][0])]
    sheet(it, os.path.join(S, '_contact-props.png'), scale=3, cols=8)

def preview(R):
    from palette import PALETTE
    SC = 3; Wd, Hd = 320, 150
    bg = new(Wd, Hd)
    # sky gradient bands + hills
    cols = ['sky-deep'] * 40 + ['sky-mid'] * 35 + ['sky-low'] * 25
    for y in range(Hd): hline(bg, 0, Wd - 1, y, cols[y] if y < len(cols) else 'sky-low')
    import random; rnd = random.Random(3)
    for i in range(26):
        x, y = rnd.randrange(Wd), rnd.randrange(55); s = R['fx']['stars'][i % 4][i % 3]; bg.alpha_composite(s, (x, y))
    for x in range(Wd):
        h1 = 82 + int(8 * math.sin(x / 31)); hline_ = h1
        for y in range(h1, 110): put(bg, x, y, 'hill-far' if y > h1 else 'cloud-lo')
        h2 = 92 + int(6 * math.sin(x / 17 + 2))
        for y in range(h2, 110): put(bg, x, y, 'hill-mid' if y > h2 else 'hill-far')
    rect(bg, 0, 108, Wd - 1, 149, 'hill-near'); hline(bg, 0, Wd - 1, 108, 'cloud-hi')
    # road
    rt = R['world']['road']
    for i in range(0, Wd, 32): bg.alpha_composite(rt, (i, 134))
    w = R['world']; fx = R['fx']
    def put_s(im, x, y): bg.alpha_composite(im, (x - im.width // 2, y - im.height))
    for i, x in enumerate((20, 62, 270, 300)): put_s(w['trees'][i], x, 112)
    put_s(w['pines'][0], 120, 110); put_s(w['pines'][1], 205, 108)
    for x in (90, 235): put_s(w['bushes'][0], x, 114)
    for i in range(0, 320, 16):
        if i < 40 or i > 280: pass
    # plaza: light pool, campfire, benches, board, lanterns
    pool = fx['light']; bg.alpha_composite(pool, (160 - pool.width // 2, 116 - pool.height // 2 + 4)) if False else None
    cf = fx['comb'][0]
    # light pool with checker mix: draw ember bands only where background is hill-near (keeps it 'additive-friendly')
    px = pool.load(); bp = bg.load()
    for y in range(pool.height):
        for x in range(pool.width):
            if px[x, y][3]:
                gx, gy = 160 - pool.width // 2 + x, 118 - pool.height // 2 + y
                if 0 <= gx < Wd and 0 <= gy < Hd and bp[gx, gy][:3] in (RGB['hill-near'], RGB['ground']) and dither(gx, gy, .45): bp[gx, gy] = px[x, y]
    put_s(w['pack']['bench'], 118, 124); bg.alpha_composite(flip(w['pack']['bench']), (178, 114))
    bg.alpha_composite(fx['base'], (144, 108)); put_s(fx['comb'][1], 160, 124)
    bg.alpha_composite(fx['sparks'][1], (156, 90)); 
    put_s(R['ui']['bd'], 60, 126); bg.alpha_composite(R['ui']['cards']['shared'], (60 - 32 + 7, 126 - 48 + 15)); bg.alpha_composite(R['ui']['cards']['hidden'], (60 - 32 + 24, 126 - 48 + 15)); bg.alpha_composite(R['ui']['cards']['blocked'], (60 - 32 + 41, 126 - 48 + 15)); bg.alpha_composite(R['ui']['cards']['pinned'], (60 - 32 + 7, 126 - 48 + 28))
    put_s(w['pack']['lamp-post-lit'], 205, 126); bg.alpha_composite(w['lamp_halo'], (222 - 28, 100)) if False else None
    bg.alpha_composite(R['ui']['lan']['council'][0], (186, 104)); bg.alpha_composite(R['ui']['lan']['dissent'][1], (130, 100))
    put_s(w['pack']['barrel'], 100, 126); pass
    put_s(w['mailbox'], 20, 128); bg.alpha_composite(R['ui']['mk'][0], (160 - 4, 62)); put_s(R['ui']['door'][0], 295, 128)
    # fence
    for i in range(0, 3): bg.alpha_composite(w['fence'], (240 + i * 16, 110))
    # vehicle on road
    bg.alpha_composite(W.van(0, True), (130, 99 + 0)) if False else None
    bg.alpha_composite(W.van(0, True), (228, 109))
    big = bg.resize((Wd * SC, Hd * SC), Image.NEAREST); save(big, os.path.join(ROOT, '_preview-commons.png'))

if __name__ == '__main__':
    R = {}
    R['fx'] = props_fx.build_fx()
    R['ui'] = props_ui.build_ui({})
    R['emo'] = emotes()
    w = {}
    w['pack'] = W.pack_props(); w['lamp_halo'] = W.lamp_halo(); w['forest'] = W.forest_pack()
    w['trees'] = [W.tree(i) for i in range(6)]; w['pines'] = [W.pine(0), W.pine(1)]; w['bushes'] = [W.bush(0), W.bush(1)]
    w['flowers'] = W.flowers(); w['fence'] = W.fence(); w['mailbox'] = W.mailbox(); w['win'] = {k: W.window(k) for k in ('dark', 'lit', 'curtained')}
    w['indoor'] = {'desk-lamp': W.desk_lamp(), 'desk': W.desk(), 'chair': W.chair(), 'books': W.books(), 'chalkboard': W.chalkboard(), 'chalk-tick': W.chalk_tick(), 'chalk-cross': W.chalk_cross(),
                   'round-table': W.round_table(), 'scroll': W.scroll(), 'map': W.map_sheet(), 'telescope': W.telescope()}
    w['road'] = W.road_tile(); R['world'] = w
    W.build_world(w)
    sheets(R); preview(R)
    json.dump(PROV, open(os.path.join(ROOT, 'props', 'provenance.json'), 'w'), indent=1)
    for g in ('fx', 'ui'):
        json.dump({k: v for k, v in PROV.items() if k.startswith(g + '/')}, open(os.path.join(ROOT, g, 'provenance.json'), 'w'), indent=1)
    json.dump({k: v for k, v in PROV.items() if k.startswith('props/')}, open(os.path.join(ROOT, 'props', 'provenance.json'), 'w'), indent=1)
    verify()
