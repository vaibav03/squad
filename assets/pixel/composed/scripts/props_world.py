from props_draw import *
from PIL import ImageDraw
import random

# ---------------- pack props, re-graded ----------------
TOWN = os.path.join(PIX, 'buildings/autumn-town/Props_TownNight_litwindows.png')
FOREST = os.path.join(PIX, 'buildings/autumn-town/Props_ForestNight.png')
WOODR = ['wood-dark', 'wood', 'wood-lit']
R_WOOD = dict(neutral=['wood-dark', 'wood', 'wood', 'wood-lit'], pink=['roof-shade', 'roof-wine', 'alert'], teal=['leaf-dark', 'leaf-lit', 'ok'],
              blue=['leaf-dark', 'leaf-lit'], warm=['ember', 'glow', 'glow-core'])
R_SOFA = dict(neutral=['roof-shade', 'roof-wine', 'roof-wine'], pink=['roof-shade', 'roof-wine', 'alert'], teal=['roof-shade', 'roof-wine', 'roof-wine', 'alert'], blue=['roof-shade', 'roof-wine', 'roof-wine', 'alert'], warm=['glow'])
R_STONE = dict(neutral=['wall-shade', 'wall-mid', 'wall-lit'], pink=['wall-shade', 'wall-mid'], teal=['leaf-dark', 'leaf-lit'], blue=['violet'], warm=['glow'])
R_GRASS = dict(neutral=['leaf-dark', 'leaf-lit'], blue=['leaf-dark', 'leaf-lit'], pink=['leaf-dark', 'leaf-lit'], teal=['leaf-dark', 'leaf-lit'], warm=['glow'])
TOWN_BOX = {'bench': (296, 304, 358, 330), 'barrel': (270, 305, 291, 330), 'stall-bunting': (14, 255, 113, 331), 'stall-awning': (121, 255, 214, 331),
            'bunting-a': (375, 348, 481, 368), 'bunting-b': (489, 348, 529, 364), 'sofa': (212, 596, 309, 650), 'sofa-small': (316, 623, 364, 650),
            'bookshelf': (488, 596, 522, 645), 'signpost-board': (456, 262, 488, 290), 'signpost-arrow': (495, 262, 518, 291), 'stump': (492, 384, 527, 409),
            'shelf-table': (420, 384, 484, 407), 'crate-a': (267, 271, 285, 292), 'crate-b': (287, 271, 305, 292), 'stool': (475, 316, 484, 327)}
def pack_props():
    im = load(TOWN); out = {}
    for k, b in TOWN_BOX.items():
        c = im.crop(b)
        ramps = R_SOFA if k.startswith('sofa') else R_WOOD
        if k == 'shelf-table': ramps = dict(R_WOOD, neutral=['wood-dark', 'wood', 'wood-lit'])
        g = regrade(c, dict(ramps, neutral=['wood', 'wood-lit', 'wood-lit']) if k == 'bench' else ramps, gamma=1.0)
        # moonlit rim: upper-left lit edge pixels of wood become wood-lit
        out[k] = g
    # lamp post (hand pixeled) -- lit variant
    out['lamp-post'] = lamp_post(False); out['lamp-post-lit'] = lamp_post(True)
    return out

def lamp_post(lit):
    im = new(24, 64)
    rect(im, 10, 14, 13, 60, 'ink'); rect(im, 11, 14, 12, 60, 'sky-deep'); vline(im, 11, 14, 60, 'hill-near')
    rect(im, 7, 56, 16, 63, 'ink'); rect(im, 8, 57, 15, 62, 'ground'); hline(im, 8, 15, 57, 'hill-near'); rect(im, 8, 61, 15, 62, 'sky-deep')
    rect(im, 8, 44, 15, 46, 'ink'); rect(im, 9, 45, 14, 45, 'hill-near')                    # collar
    # lantern head
    rect(im, 5, 2, 18, 3, 'ink'); rect(im, 7, 1, 16, 1, 'ink'); rect(im, 6, 2, 17, 2, 'wood-dark')
    rect(im, 4, 4, 19, 15, 'ink')
    rect(im, 5, 4, 18, 14, 'glow' if lit else 'sky-mid')
    if lit:
        rect(im, 8, 6, 15, 12, 'glow-core'); rect(im, 6, 5, 6, 13, 'glow-core') ; rect(im, 5, 14, 18, 14, 'ember')
    else:
        rect(im, 6, 5, 8, 7, 'sky-low'); rect(im, 5, 14, 18, 14, 'sky-deep')
    vline(im, 11, 4, 14, 'ink'); vline(im, 12, 4, 14, 'ink')
    hline(im, 5, 18, 15, 'ink'); rect(im, 8, 16, 15, 17, 'ink'); hline(im, 9, 14, 16, 'wood-dark')
    return im
def lamp_halo(w=56, h=40):
    """warm pool under a street lamp (dithered)"""
    im = new(w, h); cx, cy = (w - 1) / 2, (h - 1) / 2
    for y in range(h):
        for x in range(w):
            d = math.hypot((x - cx) / (w / 2), (y - cy) / (h / 2))
            if d < .45: put(im, x, y, 'glow')
            elif d < .7 and dither(x, y, 1 - (d - .45) / .25): put(im, x, y, 'glow')
            elif d < .95 and dither(x, y, .35 * (1 - (d - .7) / .25)): put(im, x, y, 'ember')
    return im

def forest_pack():
    im = load(FOREST); out = {}
    boxes = {'rock-big': (462, 329, 503, 352), 'rock-small': (473, 296, 492, 318), 'tuft-a': (62, 274, 92, 296), 'tuft-b': (141, 271, 171, 296),
             'tuft-c': (181, 270, 209, 296), 'tuft-d': (104, 279, 121, 294), 'flower': (230, 268, 240, 293)}
    for k, b in boxes.items():
        c = im.crop(b)
        out[k] = regrade(c, R_STONE if k.startswith('rock') else R_GRASS, gamma=1.0)
        if k == 'flower': out[k] = flower_hand()
    return out

def flower_hand():
    return art(['..g..', '.gGg.', '..g..', '..S..', '..S..', 'lSSSl', '..S..'], dict(g='glow-core', G='glow', S='leaf-lit', l='leaf-dark'))
def flowers():
    out = []
    for i, (hd, st) in enumerate([('glow-core', 'leaf-lit'), ('violet', 'leaf-lit'), ('alert', 'leaf-lit')]):
        out.append(art(['.hhh.' if False else '.hHh.', 'hHhHh' if False else 'hhHhh', '.hHh.', '..S..', '.lS..', '.lSl.', '..S..'],
                       dict(h=hd, H='glow-core' if hd != 'glow-core' else 'glow', S=st, l='leaf-dark')))
    return out

# ---------------- hand-pixeled night trees ----------------
def canopy(w, h, lobes, seed):
    mask = new(w, h); lit = new(w, h)
    for (cx, cy, r) in lobes: ellipse(mask, cx, cy, r, r * .92, 'leaf-dark')
    mp = mask.load(); out = mask.copy(); op = out.load()
    # lit crescents on upper-left of each lobe, only on pixels inside union and not too deep
    for (cx, cy, r) in lobes:
        for y in range(h):
            for x in range(w):
                if not mp[x, y][3]: continue
                dl = math.hypot(x - cx, (y - cy) / .92)
                if dl > r: continue
                d2 = math.hypot(x - (cx + r * .30), (y - (cy + r * .38)) / .92)
                if d2 > r * .92 and dl < r - .5: op[x, y] = RGB['leaf-lit'] + (255,)
    # dark underside band along bottom for depth
    for y in range(h):
        for x in range(w):
            if mp[x, y][3] and y > 0 and not mp[x, y + 1 if y + 1 < h else y][3] and op[x, y][:3] == RGB['leaf-lit']: op[x, y] = RGB['leaf-dark'] + (255,)
    rnd = random.Random(seed)    # a few lit speckles inside the dark mass
    for _ in range(w * h // 70):
        x, y = rnd.randrange(3, w - 3), rnd.randrange(3, h - 3)
        if op[x, y][:3] == RGB['leaf-dark'] and y < h * .6: op[x, y] = RGB['leaf-lit'] + (255,)
    return out
def tree(variant):
    specs = [(52, 64, [(26, 18, 15), (14, 27, 11), (38, 27, 11), (26, 30, 12), (19, 14, 9), (34, 12, 8)], 11),
             (44, 58, [(22, 17, 13), (11, 26, 10), (33, 26, 10), (22, 28, 11), (16, 12, 7)], 12),
             (60, 72, [(30, 22, 17), (15, 31, 12), (45, 31, 12), (30, 34, 14), (22, 15, 10), (40, 14, 9)], 13),
             (36, 52, [(18, 15, 11), (9, 24, 8), (27, 24, 8), (18, 25, 9)], 14),
             (48, 60, [(24, 16, 14), (12, 25, 10), (36, 25, 11), (24, 28, 11), (30, 10, 7)], 15),
             (40, 56, [(20, 17, 12), (10, 25, 9), (30, 25, 9), (20, 27, 10)], 16)]
    W, H, lobes, seed = specs[variant]
    im = new(W, H)
    cx = W // 2 + (variant % 3 - 1)
    th = H - 30 + (variant % 2) * 4
    # trunk
    tw = 5 + (variant % 3)
    t = new(W, H)
    for y in range(H - th, H):
        k = (y - (H - th)) / th; hw = tw / 2 + k * 1.8
        for x in range(int(cx - hw), int(cx + hw) + 1):
            put(t, x, y, 'wood-dark')
        for x in range(int(cx - hw), int(cx - hw) + max(1, int(hw * .6))): put(t, x, y, 'wood')
    # root flare + branch
    put(t, cx - 5 if False else int(cx - tw / 2 - 3), H - 1, 'wood-dark'); put(t, int(cx + tw / 2 + 3), H - 1, 'wood-dark')
    c = canopy(W, H, lobes, seed)
    base = new(W, H); base.alpha_composite(t); base.alpha_composite(c)
    o = outline(base, 'ink')
    return o

def pine(variant):
    W, H = (28, 60) if variant == 0 else (22, 48)
    im = new(W, H); cx = W // 2; tiers = 4 if variant == 0 else 3
    th = 8; top = 1; bot = H - th
    for k in range(tiers):
        y0 = top + k * (bot - top) // tiers - (2 if k else 0); y1 = top + (k + 1) * (bot - top) // tiers + 4
        wmax = (W // 2 - 1) * (0.45 + 0.55 * (k + 1) / tiers)
        for y in range(y0, min(y1, bot) + 1):
            t = (y - y0) / max(1, y1 - y0); hw = wmax * t if True else 0
            hw = max(.5, hw)
            for x in range(int(cx - hw), int(cx + hw) + 1):
                col = 'leaf-lit' if x < cx - hw * .35 and t > .15 and (y - y0) % 4 < 3 else 'leaf-dark'
                put(im, x, y, col)
        # scalloped hem
        for x in range(int(cx - wmax), int(cx + wmax) + 1):
            if (x + k) % 3 == 0: put(im, x, min(y1, bot) + 1 if min(y1, bot) + 1 < H else bot, 'leaf-dark')
    rect(im, cx - 1, bot + 1, cx + 1, H - 1, 'wood-dark'); put(im, cx - 1, bot + 2, 'wood')
    return outline(im, 'ink')

def bush(v):
    W, H = (22, 14) if v == 0 else (16, 10)
    lobes = [(W * .3, H * .6, H * .45), (W * .62, H * .55, H * .5), (W * .5, H * .4, H * .38)]
    c = canopy(W, H, [(a, b, r) for a, b, r in lobes], 20 + v)
    return outline(c, 'ink')

def fence():
    im = new(16, 16)
    for y in (4, 5, 6): hline(im, 0, 15, y, 'wood')
    for y in (10, 11, 12): hline(im, 0, 15, y, 'wood')
    hline(im, 0, 15, 3, 'ink'); hline(im, 0, 15, 7, 'ink'); hline(im, 0, 15, 9, 'ink'); hline(im, 0, 15, 13, 'ink')
    hline(im, 0, 15, 4, 'wood-lit'); hline(im, 0, 15, 10, 'wood-lit')
    for px in (2, 10):
        rect(im, px - 1, 1, px + 4, 15, 'ink'); rect(im, px, 2, px + 3, 15, 'wood-dark'); vline(im, px, 2, 15, 'wood-lit'); vline(im, px + 1, 4, 15, 'wood')
        put(im, px - 1, 1, None); put(im, px + 4, 1, None); put(im, px, 1, 'ink'); put(im, px + 3, 1, 'ink'); hline(im, px + 1, px + 2, 0, 'ink'); put(im, px, 2, 'ink') if False else None
        put(im, px + 1, 1, 'ink'); put(im, px + 2, 1, 'ink')
        rect(im, px + 1, 2, px + 2, 2, 'wood-lit')
    return im
def mailbox():
    im = new(14, 22)
    rect(im, 6, 10, 7, 21, 'ink'); rect(im, 7, 10, 7, 21, 'ink'); rect(im, 5, 10, 8, 21, 'ink'); rect(im, 6, 11, 7, 21, 'wood'); vline(im, 6, 11, 21, 'wood-lit')
    rect(im, 0, 2, 13, 10, 'ink'); rect(im, 1, 3, 12, 9, 'violet'); hline(im, 1, 12, 3, 'cloud-hi'); hline(im, 1, 12, 9, 'roof-shade') if False else None
    rect(im, 8, 6, 11, 8, 'ink') if False else None
    hline(im, 2, 5, 6, 'ink'); rect(im, 10, 5, 12, 8, 'wall-shade')
    rect(im, 11, 0, 12, 3, 'ink'); rect(im, 12, 0, 12, 2, 'alert'); put(im, 11, 1, 'alert')
    hline(im, 1, 12, 9, 'wall-shade') if False else None
    return im

def window(kind):
    im = new(8, 10); rect(im, 0, 0, 7, 9, 'ink')
    if kind == 'dark':
        rect(im, 1, 1, 6, 8, 'sky-mid'); rect(im, 1, 1, 2, 3, 'sky-low'); put(im, 3, 2, 'sky-low')
        for (x, y) in ((5, 7), (6, 7), (6, 6)): put(im, x, y, 'sky-deep')
    elif kind == 'lit':
        rect(im, 1, 1, 6, 8, 'glow'); rect(im, 2, 2, 5, 6, 'glow-core'); rect(im, 1, 8, 6, 8, 'ember')
    else:
        rect(im, 1, 1, 6, 8, 'glow'); rect(im, 3, 2, 4, 7, 'glow-core'); rect(im, 1, 1, 2, 8, 'roof-wine'); rect(im, 5, 1, 6, 8, 'roof-wine')
        vline(im, 2, 1, 8, 'roof-shade'); vline(im, 5, 1, 8, 'roof-shade'); hline(im, 1, 6, 1, 'roof-shade')
    vline(im, 3, 1, 8, 'ink') if kind != 'curtained' else None
    hline(im, 1, 6, 4, 'ink') if kind != 'curtained' else None
    put(im, 3, 4, 'ink')
    return im

# ---------------- interior / desk props ----------------
def desk_lamp():
    return art(['....IIIIII..', '...IggggggI.', '..IgGGGGGGI.', '..IIIIIIIIII', '.....I......', '....I.......', '...I........', '...I........', '...II.......', '..IwI.......', '.IIIII......', '.IwwwI......'][:12][:12] if False else
               ['...IIIIII...', '..IggggggI..', '.IgGGGGGGGI.', '.IIIIIIIIII.', '.....I......', '....IwI.....', '....IwI.....', '.....I......', '.....I......', '....IwI.....', '..IIIIIII...', '..IwwwwwI...'], dict(I='ink', g='glow-core', G='glow', w='wall-mid'))
def desk():
    im = new(48, 26)
    rect(im, 0, 0, 47, 4, 'ink'); rect(im, 1, 1, 46, 3, 'wood-lit'); hline(im, 1, 46, 3, 'wood'); hline(im, 1, 46, 1, 'wood-lit')
    rect(im, 2, 5, 45, 12, 'ink'); rect(im, 3, 5, 44, 11, 'wood-dark')
    rect(im, 28, 5, 44, 11, 'ink'); rect(im, 29, 6, 43, 10, 'wood'); hline(im, 29, 43, 6, 'wood-lit'); rect(im, 35, 8, 38, 8, 'glow')
    for lx in (2, 40):
        rect(im, lx, 12, lx + 5, 25, 'ink'); rect(im, lx + 1, 12, lx + 4, 25, 'wood-dark'); vline(im, lx + 1, 12, 24, 'wood')
    return im
def chair():
    return art(['.II.........', '.IwI........', '.IwI........', '.IwI........', '.IwI........', '.IwI........', '.IwIIIIIIII.', '.IwwwwwwwwI.', '.IIIIIIIIII.', '..IwI....IwI', '..IwI....IwI', '..IwI....IwI', '..III....III'] if False else
               ['.IIII.........', '.IwwI.........', '.IwwI.........', '.IwwI.........', '.IwwI.........', '.IwwIIIIIIIII.', '.IwwwwwwwwwwI.', '.IIIIIIIIIIII.', '..IwI.....IwI.', '..IwI.....IwI.', '..IwI.....IwI.', '..IwI.....IwI.', '..III.....III.'], dict(I='ink', w='wood'))
def books():
    return art(['..IIIIIIIIII..', '.IvvvvvvvvvvI.', '.IvvvvvvvvvvI.' if False else '.IvIIIIIIIIvI.', 'IIIIIIIIIIIIII', 'IaaaaaaaaaaaaI' if False else 'IlllllllllllI.', '.IIIIIIIIIIII.', '.IdddddddddI..', 'IIIIIIIIIIIIII'][:0] or
               ['IIIIIIIIIIIIII', 'IvvvvvvvvvvvvI', 'IIIIIIIIIIIIII', '.IaaaaaaaaaaI.', '.IIIIIIIIIIII.', '.IwwwwwwwwwwI.', 'IIIIIIIIIIIIII', 'IgggggggggggI.'][:7], dict(I='ink', v='violet', a='alert', w='wall-lit', g='glow')) if False else \
        art(['...IIIIIIIII..', '..IvvvvvvvvvI..', '..IIIIIIIIIII..', '.IaaaaaaaaaaI..', '.IIIIIIIIIIII..', 'IwwwwwwwwwwwI..', 'IIIIIIIIIIIIII.', 'IgggggggggggI..', 'IIIIIIIIIIIII..'], dict(I='ink', v='violet', a='roof-wine', w='wall-lit', g='glow'))
def chalkboard():
    im = new(48, 32); rect(im, 0, 0, 47, 31, 'ink'); rect(im, 1, 1, 46, 30, 'wood-lit'); rect(im, 2, 2, 45, 29, 'wood'); rect(im, 3, 3, 44, 28, 'ink'); rect(im, 4, 4, 43, 27, 'leaf-dark')
    hline(im, 1, 46, 30, 'wood'); vline(im, 1, 1, 30, 'wood-lit')
    for (x, y) in ((8, 8), (20, 14), (33, 20), (12, 22), (38, 9)): put(im, x, y, 'leaf-lit')
    rect(im, 8, 29, 20, 30, 'wall-lit'); rect(im, 24, 29, 26, 30, 'cloud-lo')       # chalk tray bits
    for y in (5, 6): pass
    return im
def chalk_tick():
    return art(['..........cc', '.........cc.', '........cc..', '.......cc...', 'cc....cc....', '.cc..cc.....', '..cccc......', '...cc.......'], dict(c='cloud-hi'))
def chalk_cross():
    return art(['cc......cc', '.cc....cc.', '..cc..cc..', '...cccc...', '...cccc...', '..cc..cc..', '.cc....cc.', 'cc......cc'], dict(c='alert'))
def round_table():
    im = new(34, 22); ellipse(im, 16.5, 5, 16.5, 5, 'ink'); ellipse(im, 16.5, 4.5, 15.5, 4, 'wood-lit'); ellipse(im, 15.5, 4, 11, 2.4, 'wood-lit')
    hline(im, 3, 29, 7, 'wood'); hline(im, 5, 27, 8, 'wood-dark') if False else None
    rect(im, 13, 9, 20, 17, 'ink'); rect(im, 14, 9, 19, 17, 'wood-dark'); vline(im, 14, 9, 17, 'wood')
    rect(im, 8, 18, 25, 21, 'ink'); rect(im, 9, 18, 24, 20, 'wood-dark'); hline(im, 9, 24, 18, 'wood')
    return im
def scroll():
    return art(['..IIIIIIIIIIII..', '.IssssssssssssI.', 'IsIIIIIIIIIIIsI.', 'IsI.........IsI.' if False else 'IssIIIIIIIIIIssI', '.IIsssssssssIII.', '..IIIIIIIIIIII..'], dict(I='ink', s='skin-lt'))
def map_sheet():
    im = art(['IIIIIIIIIIII', 'IsssssssssssI', 'IsIIsssaIsssI', 'IssssIIIssssI', 'IsgIIssssIssI', 'IsssssIIIssI', 'IsssssssssssI', 'IIIIIIIIIIIII'], dict(I='ink', s='skin-lt', g='leaf-lit', a='alert'))
    return im
def telescope():
    im = new(26, 30)
    line(im, 13, 14, 5, 29, 'ink'); line(im, 13, 14, 21, 29, 'ink'); line(im, 13, 14, 13, 29, 'ink')
    line(im, 14, 14, 6, 29, 'wood'); line(im, 12, 14, 20, 29, 'wood')
    tube = new(26, 30)
    for i in range(0, 16):
        x0, y0 = 5 + i, 13 - i // 2
        pass
    d = ImageDraw.Draw(im)
    def seg(p, q, w, c): d.line([p, q], fill=RGB[c] + (255,), width=w)
    seg((20, 4), (6, 12), 5, 'ink'); seg((20, 4), (6, 12), 3, 'violet'); seg((18, 5), (14, 8), 1, 'cloud-hi')
    seg((6, 12), (3, 14), 5, 'ink'); seg((6, 12), (3, 14), 3, 'glow')
    rect(im, 11, 12, 15, 15, 'ink'); rect(im, 12, 13, 14, 14, 'glow')
    return im

# ---------------- vehicle ----------------
def van_body(luggage=False):
    W, H = 52, 40
    im = new(W, H); d = ImageDraw.Draw(im)
    def poly(pts, c): d.polygon(pts, fill=RGB[c] + (255,))
    body = [(1, 14), (38, 14), (38, 13), (40, 13), (46, 22), (51, 23), (51, 33), (1, 33)]
    poly(body, 'wall-lit')
    # roof strip
    d.rectangle([1, 12, 39, 13], fill=RGB['wall-mid'] + (255,))
    d.rectangle([1, 24, 51, 33], fill=RGB['roof-wine'] + (255,)); d.rectangle([1, 23, 46, 23], fill=RGB['wall-mid'] + (255,))
    d.rectangle([1, 32, 51, 33], fill=RGB['roof-shade'] + (255,)); d.rectangle([1, 28, 51, 28], fill=RGB['roof-shade'] + (255,))
    # moonlit top-left rim
    d.rectangle([1, 13, 38, 13], fill=RGB['wall-lit'] + (255,))
    # side window (cosy lit) + curtain
    d.rectangle([4, 16, 19, 21], fill=RGB['ink'] + (255,)); d.rectangle([5, 17, 18, 20], fill=RGB['glow'] + (255,)); d.rectangle([7, 17, 14, 19], fill=RGB['glow-core'] + (255,))
    d.rectangle([5, 17, 6, 20], fill=RGB['roof-wine'] + (255,)); d.rectangle([17, 17, 18, 20], fill=RGB['roof-wine'] + (255,))
    # door + cab window
    d.line([(26, 15), (26, 31)], fill=RGB['ink'] + (255,))
    d.polygon([(28, 16), (37, 16), (41, 22), (28, 22)], fill=RGB['ink'] + (255,)); d.polygon([(29, 17), (36, 17), (39, 21), (29, 21)], fill=RGB['sky-mid'] + (255,))
    d.line([(30, 18), (33, 18)], fill=RGB['sky-low'] + (255,)); d.line([(29, 19), (30, 19)], fill=RGB['sky-low'] + (255,))
    d.rectangle([29, 26, 31, 26], fill=RGB['wood-lit'] + (255,)) ; d.rectangle([29, 25, 31, 25], fill=RGB['ink'] + (255,)) if False else None
    # lights
    d.rectangle([50, 25, 51, 27], fill=RGB['glow-core'] + (255,)); d.rectangle([49, 26, 49, 26], fill=RGB['glow'] + (255,))
    d.rectangle([1, 25, 2, 27], fill=RGB['alert'] + (255,))
    d.rectangle([0, 30, 3, 32], fill=RGB['wall-shade'] + (255,)); d.rectangle([48, 31, 51, 32], fill=RGB['wall-shade'] + (255,))
    # roof rack posts or roof vent
    if not luggage:
        d.rectangle([20, 10, 25, 11], fill=RGB['wall-mid'] + (255,))
    else:
        d.rectangle([6, 11, 8, 11], fill=RGB['wood-dark'] + (255,)); d.rectangle([30, 11, 32, 11], fill=RGB['wood-dark'] + (255,))
        d.rectangle([4, 10, 34, 10], fill=RGB['wood-dark'] + (255,))
        # suitcases
        d.rectangle([6, 3, 18, 9], fill=RGB['wood-lit'] + (255,)); d.rectangle([6, 8, 18, 9], fill=RGB['wood'] + (255,)); d.rectangle([11, 4, 13, 9], fill=RGB['glow'] + (255,))
        d.rectangle([8, 1, 16, 2], fill=RGB['wood-dark'] + (255,))
        d.rectangle([20, 5, 30, 9], fill=RGB['violet'] + (255,)); d.rectangle([20, 8, 30, 9], fill=RGB['wall-shade'] + (255,)); d.rectangle([24, 5, 26, 9], fill=RGB['cloud-hi'] + (255,))
        d.ellipse([31, 6, 34, 9], fill=RGB['roof-wine'] + (255,))
    return im
def wheel(f):
    im = new(12, 12); ellipse(im, 5.5, 5.5, 5.5, 5.5, 'ink'); ellipse(im, 5.5, 5.5, 3.6, 3.6, 'wall-shade'); ellipse(im, 5.5, 5.5, 1.8, 1.8, 'wall-lit')
    if f == 0: vline(im, 5, 1, 10, 'ink'); vline(im, 6, 1, 10, 'ink') if False else None; hline(im, 1, 10, 5, 'ink')
    else: line(im, 2, 2, 9, 9, 'ink'); line(im, 9, 2, 2, 9, 'ink')
    put(im, 5, 5, 'wall-lit'); put(im, 6, 6, 'wall-lit'); put(im, 5, 6, 'wall-mid'); put(im, 6, 5, 'wall-mid')
    return im
def cone(w=12, h=18):
    im = new(w, h)
    for y in range(h):
        for x in range(w):
            t = x / (w - 1); half = 2 + t * (h / 2 - 2)
            if abs(y - h / 2 + .5) <= half:
                lvl = (1 - t) * 0.95
                if dither(x, y, lvl): put(im, x, y, 'glow' if t < .5 else 'ember')
    return im
def van(f, luggage=False, canvas=(64, 40)):
    W, H = canvas; im = new(W, H); cn = cone(12, 18); im.alpha_composite(cn, (52, 20))
    body = van_body(luggage); bob = -1 if f == 1 else 0
    wa = wheel(f)
    # arches
    for wx in (9, 37):
        ellipse(im, wx + 5.5, 33.5 + bob, 7, 7, 'ink')
    im.alpha_composite(body, (0, 0 + bob + 0))
    for wx in (9, 37):
        ellipse(im, wx + 5.5, 33.5 + bob, 7, 7, 'ink')
        ellipse(im, wx + 5.5, 33.5, 6.2, 6.2, 'ink')
        im.alpha_composite(wa, (wx, 28))
    # body bottom cover and underside line
    hline(im, 0, 51, 34 + bob, 'ink') if False else None
    return im
def road_tile():
    im = new(32, 16)
    rect(im, 0, 0, 31, 15, 'ground')
    rect(im, 0, 0, 31, 2, 'hill-near'); hline(im, 0, 31, 3, 'ink')
    for x in range(0, 32):
        if (x * 7) % 5 < 2: put(im, x, 0, 'leaf-dark')
        if x % 6 == 2: put(im, x, 1, 'leaf-lit')
    hline(im, 0, 31, 4, 'cloud-lo')
    rect(im, 4, 9, 15, 10, 'wall-lit')                                 # dashed centre line (12 on, 20 off)
    for x in range(0, 32):
        if dither(x, 5, .5) and x % 3 == 0: put(im, x, 6 + (x % 4), 'hill-near')
        if x % 5 == 1: put(im, x, 13, 'hill-near')
    hline(im, 0, 31, 14, 'hill-near'); hline(im, 0, 31, 15, 'ink')
    return im

def build_world(R):
    for k, im in R['pack'].items():
        write(f'props/{k}.png', im, source='assets/pixel/buildings/autumn-town/Props_TownNight_litwindows.png, regraded to palette ramps (hand-mapped by luminance)' if k not in ('lamp-post', 'lamp-post-lit') else 'hand-pixeled', license='Autumn Town pack (see LICENSES.md)' if k not in ('lamp-post', 'lamp-post-lit') else 'original', anchor='bottom-center')
    write('props/lamp-halo.png', R['lamp_halo'], source='hand-pixeled', license='original', anchor='center', note='dithered warm pool for lit street lamps')
    for k, im in R['forest'].items():
        write(f'props/{k}.png', im, source='assets/pixel/buildings/autumn-town/Props_ForestNight.png regraded' if k != 'flower' else 'hand-pixeled', license='Autumn Town pack' if k != 'flower' else 'original', anchor='bottom-center')
    for i, im in enumerate(R['trees']): write(f'props/tree-{i+1}.png', im, source='hand-pixeled (round dark canopy leaf-dark/leaf-lit, lit from upper-left)', license='original', anchor='bottom-center')
    for i, im in enumerate(R['pines']): write(f'props/pine-{i+1}.png', im, source='hand-pixeled', license='original', anchor='bottom-center')
    for i, im in enumerate(R['bushes']): write(f'props/bush-{i+1}.png', im, source='hand-pixeled', license='original', anchor='bottom-center')
    for i, im in enumerate(R['flowers']): write(f'props/flower-{i+1}.png', im, source='hand-pixeled', license='original', anchor='bottom-center')
    write('props/fence.png', R['fence'], source='hand-pixeled', license='original', tileable='x', frame=[16, 16], anchor='bottom-left')
    write('props/mailbox.png', R['mailbox'], source='hand-pixeled', license='original', anchor='bottom-center')
    for k in ('dark', 'lit', 'curtained'): write(f'props/window-{k}.png', R['win'][k], source='hand-pixeled', license='original', note='8x10 window decal for house builders, same on-wall alignment')
    for k in ('desk-lamp', 'desk', 'chair', 'books', 'chalkboard', 'chalk-tick', 'chalk-cross', 'round-table', 'scroll', 'map', 'telescope'):
        write(f'props/{k}.png', R['indoor'][k], source='hand-pixeled', license='original', anchor='bottom-center', note='chalkboard: empty 48x32 frame; tick/cross are overlays for its slate (inner area x4..43,y4..27)' if k == 'chalkboard' else None)
    for nm, lug in (('van', False), ('van-luggage', True)):
        write(f'props/{nm}.png', strip([van(0, lug), van(1, lug)]), source='hand-pixeled', license='original', frame=[64, 40], count=2, fps=6, anchor='bottom-left (wheels on y=39; front at x=51, headlight cone x52..63)', note='faces right; frame 1 = body bobs 1px + wheel spokes rotate')
    write('props/van-cone.png', cone(24, 20), source='hand-pixeled', license='original', anchor='left-center', note='longer headlight cone if the cutscene wants it')
    write('props/road-tile.png', R['road'], source='hand-pixeled', license='original', tileable='x', frame=[32, 16], note='verge+road edge with dashed centre line, road top at y=4')
