"""Council cast (Chill, Grind, Advisor, Chair): original art for the Round Table help panel and scene.

Same renderer, palette and 32x32 right-facing cell as the rest of the composed cast (characters_side.draw_side), with
hand-pixeled props that follow the near hand (mug, books + coffee, clipboard, gavel). Deterministic: no randomness.
Extra animations over the base cast: idle x4 (breath + blink), talk x4, think x4 (thought dots), plus busts (idle/talk/think x4).
Ids are 'cast-chill', 'cast-grind', 'cast-advisor', 'cast-chair' (so the older council-* personas keep working)."""
from characters_side import Canvas, line

IDS = ['cast-chill', 'cast-grind', 'cast-advisor', 'cast-chair']
NAMES = {'cast-chill': 'Chill', 'cast-grind': 'Grind', 'cast-advisor': 'Advisor', 'cast-chair': 'Chairman'}
TONE = {'cast-chill': 'ok', 'cast-grind': 'ember', 'cast-advisor': 'violet', 'cast-chair': 'wall-lit'}
SK_LT = ('skin-lt', 'wood-lit'); SK_MD = ('wood-lit', 'wood'); SK_DK = ('wood', 'wood-dark')
def hair(b, s, l=None): return (b, s, l)

def steam(c, x, y, f):
    """Two wisps that swap every frame; (x, y) is the point just above the cup rim."""
    a = f % 2
    c.P(x + a, y, 'cloud-hi'); c.P(x + 1 - a, y - 2, 'cloud-hi')
    if f % 4 >= 2: c.P(x + a, y - 3, 'cloud-lo')

# ---------------- Chill: sleepy green hoodie, blanket, tea, moon charm
def chill_back(c, g):
    cx, top = g['cx'], g['top']; sw = 1 if g['bob'] > 0 else 0
    c.R(cx - 7, top, cx - 4, top + 9 - sw, 'wall-lit'); c.R(cx - 7, top + 3, cx - 4, top + 3, 'ok'); c.R(cx - 7, top + 6, cx - 4, top + 6, 'ok')
    c.R(cx - 7, top + 8 - sw, cx - 5, top + 9 - sw, 'wall-mid'); c.R(cx - 7, top, cx - 7, top + 9 - sw, 'cloud-lo')
def chill_torso(c, g):
    cx, top, fx = g['cx'], g['top'], g['fx']
    c.R(cx - 2, g['hip'] - 4, cx + 3, g['hip'] - 4, 'leaf-lit')            # hoodie pocket line
    for y in range(top + 1, top + 5): c.P(cx + 1, y, 'cloud-hi') if y in (top + 2, top + 4) else None
    c.P(cx + 1, top + 2, 'moon'); c.P(cx + 1, top + 3, 'moon'); c.P(cx + 1, top + 4, 'moon'); c.P(cx + 2, top + 2, 'moon'); c.P(cx + 2, top + 4, 'moon')
def chill_behind_head(c, g):
    hx, hy = g['hx'], g['hy']; c.R(hx - 1, hy + 6, hx + 3, hy + 10, 'ok'); c.R(hx - 1, hy + 9, hx + 3, hy + 10, 'leaf-lit'); c.P(hx + 2, hy + 8, 'cloud-hi')
def chill_hand(c, g):
    x, y = g['hand']; f = g['pose'].get('f', 0)
    c.R(x, y - 2, x + 3, y + 1, 'cloud-hi'); c.R(x, y - 1, x + 3, y - 1, 'ok'); c.R(x + 3, y + 1, x + 3, y + 1, 'cloud-lo')
    c.P(x + 4, y - 1, 'cloud-hi'); c.P(x + 4, y, 'cloud-hi')
    steam(c, x + 1, y - 4, f)

# ---------------- Grind: headband, stack of books, coffee
def grind_head(c, g):
    hx, hy = g['hx'], g['hy']; f = g['pose'].get('f', 0)
    c.R(hx, hy + 1, hx + 7, hy + 2, 'ember'); c.R(hx, hy + 2, hx + 7, hy + 2, 'roof-wine'); c.P(hx + 4, hy + 1, 'glow')
    t = 1 if f % 2 else 0                                                    # headband tails flutter
    c.R(hx - 3, hy + 1 + t, hx, hy + 1 + t, 'ember'); c.R(hx - 2, hy + 2 + t, hx - 1, hy + 3 + t, 'roof-wine')
def grind_torso(c, g):
    cx, top = g['cx'], g['top']
    c.R(cx - 3, top, cx + 2, top, 'glow'); c.R(cx - 3, g['hip'] - 3, cx + 2, g['hip'] - 3, 'roof-shade')
def grind_front(c, g):
    cx, hip, f = g['cx'], g['hip'], g['pose'].get('f', 0)
    b = 1 if f % 4 == 1 else 0
    x0, x1 = cx - 1, cx + 6
    c.R(x0, hip - 3 - b, x1, hip - 1 - b, 'roof-wine'); c.R(x0 + 1, hip - 2 - b, x1 - 1, hip - 2 - b, 'glow')
    c.R(x0 + 1, hip - 5 - b, x1 - 1, hip - 4 - b, 'wall-lit'); c.R(x0 + 1, hip - 4 - b, x1 - 1, hip - 4 - b, 'wall-mid')
    c.R(x0 + 2, hip - 7 - b, x1 - 2, hip - 6 - b, 'ember'); c.R(x0 + 2, hip - 6 - b, x1 - 2, hip - 6 - b, 'roof-wine')
    # coffee cup on top
    cxx = x0 + 3
    c.R(cxx, hip - 11 - b, cxx + 2, hip - 8 - b, 'wood-lit'); c.R(cxx, hip - 11 - b, cxx + 2, hip - 11 - b, 'cloud-hi'); c.P(cxx + 3, hip - 10 - b, 'wood-lit')
    c.R(cxx, hip - 9 - b, cxx + 2, hip - 9 - b, 'wood')
    steam(c, cxx, hip - 13 - b, f)

# ---------------- Advisor: glasses, clipboard checklist
def adv_head(c, g):
    hx, hy = g['hx'], g['hy']
    c.R(hx + 4, hy + 3, hx + 6, hy + 4, 'cloud-hi'); c.P(hx + 5, hy + 4, 'ink'); c.P(hx + 6, hy + 3, 'ink')
    c.P(hx + 3, hy + 3, 'ink'); c.P(hx + 7, hy + 3, 'ink'); c.R(hx + 4, hy + 2, hx + 6, hy + 2, 'ink'); c.R(hx + 4, hy + 5, hx + 6, hy + 5, 'ink')
    c.P(hx + 7, hy + 4, 'ink')
def adv_torso(c, g):
    cx, top, hip, fx = g['cx'], g['top'], g['hip'], g['fx']
    c.R(fx - 1, top, fx, top + 2, 'cloud-hi'); c.P(fx - 1, top + 1, 'violet'); c.R(cx - 1, top + 1, cx, top + 1, 'cloud-hi')
    for y in range(top + 3, top + 7): c.P(cx - 1, y, 'wall-shade')            # lanyard
def adv_hand(c, g):
    x, y = g['hand']; f = g['pose'].get('f', 0); k = (f % 4) // 1
    c.R(x - 1, y - 5, x + 3, y + 1, 'wood'); c.R(x, y - 4, x + 2, y, 'cloud-hi'); c.R(x, y - 5, x + 2, y - 5, 'wall-shade')
    for i, yy in enumerate((y - 3, y - 1)):
        c.P(x, yy, 'ok' if (i == 0 or k >= 2) else 'wall-mid'); c.R(x + 1, yy, x + 2, yy, 'wall-mid')
    c.P(x - 1, y + 1, 'wood-lit'); c.P(x, y + 1, 'wood-lit')

# ---------------- Chairman: pale grey-blue coat, crest, gavel
def chair_torso(c, g):
    cx, top, hip, fx = g['cx'], g['top'], g['hip'], g['fx']
    c.R(cx - 1, top + 1, cx + 1, top + 4, 'violet'); c.R(cx, top + 2, cx, top + 3, 'glow'); c.P(cx - 1, top + 4, 'wall-shade'); c.P(cx + 1, top + 4, 'wall-shade')  # crest
    c.R(fx - 1, top, fx, top + 1, 'cloud-hi'); c.P(fx, top + 2, 'violet'); c.P(fx, top + 3, 'violet')
    c.R(cx - 3, hip - 2, cx + 2, hip - 2, 'wall-shade')
def chair_hand(c, g):
    x, y = g['hand']; up = g['pose'].get('f', 0) % 2 == 0 and g['pose'].get('strike')
    c.R(x, y - 4, x, y, 'wood'); c.R(x - 1, y - 6, x + 2, y - 4, 'wood-lit'); c.R(x - 1, y - 4, x + 2, y - 4, 'wood'); c.P(x - 1, y - 6, 'wood-dark') if False else None
def chair_head(c, g):
    hx, hy = g['hx'], g['hy']
    for x in range(3, 7): c.P(hx + x, hy + 1, 'wall-mid') if False else None
    c.R(hx + 2, hy + 1, hx + 3, hy + 2, 'wall-mid')                           # silver temple

def specs():
    return {
     'cast-chill': dict(LL=7, TH=10, TW=8, SK=3, flare=1, skin=SK_LT, hair_style='bob', hair=hair('wood', 'wood-dark', 'wood-lit'),
        coat=('ok', 'leaf-lit', 'cloud-hi'), hem='leaf-lit', pants=('wall-mid', 'wall-shade'), boots='wall-lit', boots_sh='wall-mid', eye='sleepy', blink=True,
        armN_fixed=(2, 4), hand_col='skin-lt', acc=dict(back=chill_back, torso=chill_torso, behind_head=chill_behind_head, hand=chill_hand)),
     'cast-grind': dict(LL=8, TH=8, TW=6, SK=1, skin=SK_DK, hair_style='short', hair=hair('wood-dark', 'ink', 'wood'),
        coat=('ember', 'roof-wine', 'glow'), pants=('roof-shade', 'ink'), boots='cloud-hi', boots_sh='cloud-lo', eye='wide', tall_eye=False, blink=True,
        armN_fixed=(3, 2), acc=dict(torso=grind_torso, head=grind_head, front=grind_front)),
     'cast-advisor': dict(LL=8, TH=9, TW=6, SK=3, flare=1, skin=SK_LT, hair_style='bun', hair=hair('wood', 'wood-dark', 'wood-lit'),
        coat=('violet', 'wall-shade', 'cloud-hi'), hem='wall-shade', pants=('wall-shade', 'hill-near'), boots='wood-dark', boots_sh='ink', eye='dot', blink=True,
        armN_fixed=(3, 3), acc=dict(torso=adv_torso, head=adv_head, hand=adv_hand)),
     'cast-chair': dict(LL=8, TH=10, TW=6, SK=4, flare=2, seam=True, skin=SK_MD, hair_style='slick', hair=hair('wood-dark', 'ink', 'wood'),
        coat=('wall-lit', 'wall-mid', 'cloud-hi'), hem='wall-shade', pants=('sky-deep', 'ink'), boots='ink', boots_sh='ink', eye='dot', brow='stern', blink=True,
        armN_fixed=(3, 3), acc=dict(torso=chair_torso, head=chair_head, hand=chair_hand)),
    }

def council_poses(S):
    d = S.get('AL', 6) - 1
    base = dict(legN=(1, 0), legF=(-1, 0), armN=(1, d), armF=(-1, d))
    idle = [dict(base, bob=b, f=i, blink=(i == 2), mouth='closed') for i, b in enumerate((0, 0, 1, 1))]
    fx = S.get('armN_fixed', (3, 2))
    talk = [dict(base, bob=0, f=0, mouth='open', armN=(fx[0] + 1, fx[1] - 3), gesture=True, strike=True),
            dict(base, bob=0, f=1, mouth='closed', armN=(fx[0], fx[1] - 1), gesture=True),
            dict(base, bob=0, f=2, mouth='open', armN=(fx[0] + 1, fx[1] - 2), gesture=True, strike=True),
            dict(base, bob=1, f=3, mouth='closed', armN=(fx[0], fx[1] - 1), gesture=True)]
    think = [dict(base, bob=b, f=i, mouth='closed', blink=(i == 3)) for i, b in enumerate((0, 1, 1, 0))]
    walk = [dict(bob=0, legN=(3, 0), legF=(-3, 0), armN=(-2, d), armF=(-1, d), f=0), dict(bob=-1, legN=(0, 0), legF=(-1, 2), armN=(0, d), armF=(0, d), f=1),
            dict(bob=0, legN=(-3, 0), legF=(3, 0), armN=(3, d), armF=(-3, d), f=2), dict(bob=-1, legN=(-1, 2), legF=(0, 0), armN=(0, d), armF=(0, d), f=3)]
    sit = [dict(sit=True, bob=0, f=0, armN=(2, d), armF=(2, d), mouth='closed'), dict(sit=True, bob=1, f=1, armN=(2, d), armF=(2, d), mouth='smile')]
    wave = [dict(base, bob=0, f=0, mouth='smile', armN=(8, -4), via=(5, 3), gesture=True, arm_front=True), dict(base, bob=0, f=1, mouth='smile', armN=(9, -2), via=(5, 3), gesture=True, arm_front=True)]
    return dict(idle=idle, walk=walk, talk=talk, think=think, sit=sit, wave=wave)

def dots(c, n, x0=22, y0=8):
    """Thought dots rising to the upper right of the head: n = 1..3 (growing). Painted over the finished sprite."""
    pts = [(x0, y0 + 6, 1), (x0 + 2, y0 + 3, 2), (x0 + 4, y0, 3)][:n]
    for (x, y, s) in pts:
        for yy in range(y - 1, y + s + 1):
            for xx in range(x - 1, x + s + 1): c.P(xx, yy, 'ink')
        c.R(x, y, x + s - 1, y + s - 1, 'cloud-hi')
    return c

# ---------------- busts (32x32 opaque tile, same frame as the other portraits)
def bust(n, S, mouth='smile', blink=False, bob=0, ndots=0, hy=9):
    from characters_portrait import hair_front, face, body
    c = Canvas()
    c.R(0, 0, 31, 31, 'sky-mid')
    for (x, y) in ((6, 5), (26, 8), (4, 14), (28, 3), (24, 17)): c.P(x, y, 'sky-low')
    hair_front(c, S['hair_style'], hy + bob, S['hair'], back=True)
    body(c, S, top=min(24, hy + 14) + bob)
    sk, ssh = S['skin']
    if n == 'cast-chill':
        c.R(7, 23 + bob, 24, 26 + bob, 'ok'); c.R(7, 26 + bob, 24, 26 + bob, 'leaf-lit'); c.R(9, 27 + bob, 13, 31, 'ok'); c.R(11, 29 + bob, 13, 31, 'leaf-lit')
        c.R(18, 24 + bob, 21, 24 + bob, 'cloud-hi'); c.R(21, 27 + bob, 24, 29 + bob, 'moon'); c.R(22, 27 + bob, 23, 29 + bob, 'ok'); c.P(24, 28 + bob, 'ok')
        c.R(3, 26 + bob, 6, 31, 'wall-lit'); c.R(3, 29 + bob, 6, 29 + bob, 'ok')
    elif n == 'cast-grind':
        c.R(7, 26 + bob, 8, 27 + bob, 'glow'); c.R(23, 26 + bob, 24, 27 + bob, 'glow'); c.R(13, 23 + bob, 18, 23 + bob, 'glow')
        c.R(22, 27 + bob, 28, 31, 'roof-wine'); c.R(22, 29 + bob, 28, 29 + bob, 'glow'); c.R(23, 25 + bob, 27, 26 + bob, 'wall-lit'); c.R(23, 27 + bob, 27, 27 + bob, 'wall-mid')
    elif n == 'cast-advisor':
        c.R(13, 23 + bob, 18, 25 + bob, 'cloud-hi'); c.P(15, 24 + bob, 'violet'); c.P(16, 24 + bob, 'violet')
        c.R(22, 25 + bob, 28, 31, 'wood'); c.R(23, 26 + bob, 27, 31, 'cloud-hi'); c.R(24, 24 + bob, 26, 25 + bob, 'wall-shade'); c.P(23, 27 + bob, 'ok'); c.R(24, 27 + bob, 26, 27 + bob, 'wall-mid'); c.P(23, 29 + bob, 'ok'); c.R(24, 29 + bob, 26, 29 + bob, 'wall-mid')
        for y in range(25 + bob, 31): c.P(15, y, 'wall-shade') if False else None
    elif n == 'cast-chair':
        c.R(13, 23 + bob, 18, 26 + bob, 'cloud-hi'); c.R(15, 24 + bob, 16, 31, 'violet'); c.R(7, 23 + bob, 24, 23 + bob, 'wall-lit')
        c.R(21, 26 + bob, 24, 30 + bob, 'violet'); c.R(22, 27 + bob, 23, 28 + bob, 'glow'); c.P(21, 30 + bob, 'wall-shade'); c.P(24, 30 + bob, 'wall-shade')
    # head
    c.R(14, hy + bob + 13, 17, hy + bob + 14, sk) if False else None
    ox = c.p
    c2 = Canvas(); face(c2, S, hy + bob, mouth)
    c.p.update(c2.p)
    if blink:
        ey = hy + bob + 6
        for x in (12, 13, 18, 19): c.P(x, ey, sk); c.P(x, ey + 1, 'ink')
    if S.get('eye') == 'sleepy' and not blink:
        pass
    hair_front(c, S['hair_style'], hy + bob, S['hair'])
    h = hy + bob
    if n == 'cast-grind':
        c.R(9, h + 2, 22, h + 3, 'ember'); c.R(9, h + 3, 22, h + 3, 'roof-wine'); c.P(15, h + 2, 'glow'); c.R(6, h + 3, 9, h + 3, 'ember'); c.R(7, h + 4, 8, h + 5, 'roof-wine')
    if n == 'cast-advisor':
        for (x0, x1) in ((11, 14), (17, 20)): c.R(x0, h + 5, x1, h + 8, 'ink'); c.R(x0 + 1, h + 6, x1 - 1, h + 7, 'cloud-hi')
        c.R(15, h + 6, 16, h + 6, 'ink'); c.P(13, h + 7, 'ink'); c.P(18, h + 7, 'ink')
    if n == 'cast-chair':
        c.R(10, h + 1, 10, h + 3, 'wall-mid'); c.R(21, h + 1, 21, h + 3, 'wall-mid')
    if ndots: dots(c, ndots, x0=22, y0=4)
    for i in range(32):
        for p in ((i, 0), (i, 31), (0, i), (31, i)): c.P(p[0], p[1], 'ink')
    for p in ((0, 0), (31, 0), (0, 31), (31, 31)): c.p.pop(p, None)
    return c

def bust_frames(n, S):
    m = ('smile', 'flat', 'smirk')[0]
    base_m = 'smirk' if n == 'cast-chill' else ('smile' if n != 'cast-chair' else 'flat')
    idle = [bust(n, S, base_m, bob=b, blink=(i == 2)) for i, b in enumerate((0, 0, 1, 1))]
    talk = [bust(n, S, mo, bob=b) for mo, b in (('open', 0), ('smile', 0), ('open', 0), ('flat', 1))]
    think = [bust(n, S, 'flat', bob=b, ndots=k, blink=(i == 3)) for i, (b, k) in enumerate(((0, 1), (1, 2), (1, 3), (0, 2)))]
    return dict(idle=idle, talk=talk, think=think)

def register(CAST, ORDER):
    for k, v in specs().items():
        CAST[k] = v; ORDER.append(k)
