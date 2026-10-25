"""Cast definitions (palette-name colours) + hand-pixeled accessory overlays."""
from characters_side import line
SK_LT = ('skin-lt', 'wood-lit'); SK_MD = ('wood-lit', 'wood'); SK_DK = ('wood', 'wood-dark')

def hair(b, s, l=None): return (b, s, l)

# ---------------- accessories: f(c, g) ; g has cx,top,hx,hy,hip,fx,pose,hand
def student_torso(c, g):
    cx, top, hx, hy = g['cx'], g['top'], g['hx'], g['hy']
    c.R(hx - 2, hy + 3, hx + 1, hy + 4, 'roof-wine'); c.R(hx - 1, hy + 5, hx + 1, top + 2, 'roof-wine')
    c.R(hx - 2, hy + 3, hx - 2, hy + 4, 'roof-shade'); c.R(hx - 1, top + 1, hx + 1, top + 2, 'roof-shade'); c.P(hx - 1, hy + 5, 'alert')
    c.R(hx + 2, top, hx + 6, top, 'alert')
    c.P(g['fx'] - 1, top + 2, 'glow-core'); c.P(g['fx'] - 1, top + 3, 'glow')
    c.R(g['cx'] - 2, g['hip'] - 3, g['cx'] + 1, g['hip'] - 3, 'roof-shade')
def student_head(c, g):
    hx, hy = g['hx'], g['hy']
    c.R(hx + 1, hy - 1, hx + 5, hy - 1, 'roof-wine'); c.P(hx + 5, hy - 1, 'alert')

def glasses(ring='wood-dark'):
    def f(c, g):
        hx, hy = g['hx'], g['hy']
        c.R(hx + 4, hy + 3, hx + 6, hy + 4, 'cloud-hi'); c.P(hx + 5, hy + 4, 'ink'); c.P(hx + 6, hy + 3, 'ink')
        c.P(hx + 3, hy + 3, ring); c.P(hx + 7, hy + 3, ring)
    return f
def mustache(col):
    def f(c, g):
        hx, hy = g['hx'], g['hy']; c.R(hx + 6, hy + 5, hx + 7, hy + 5, col)
        if g['pose'].get('mouth') == 'open': c.R(hx + 6, hy + 6, hx + 7, hy + 6, 'roof-shade')
    return f
def beard(col, shade):
    def f(c, g):
        hx, hy = g['hx'], g['hy']
        for x in range(3, 8): c.P(hx + x, hy + 5, col)
        for x in range(3, 8): c.P(hx + x, hy + 6, col)
        for x in range(4, 8): c.P(hx + x, hy + 7, shade)
        for x in range(5, 7): c.P(hx + x, hy + 8, shade)
        c.P(hx + 8, hy + 5, 'skin-lt')
        if g['pose'].get('mouth') == 'open': c.R(hx + 6, hy + 6, hx + 7, hy + 6, 'roof-shade')
    return f
def chain(*fs):
    def f(c, g):
        for x in fs: x(c, g)
    return f

def dean_torso(c, g):
    cx, top = g['cx'], g['top']; fx = g['fx']
    c.R(fx - 1, top, fx, top + 3, 'cloud-hi'); c.P(fx - 1, top + 1, 'roof-wine'); c.P(fx - 1, top + 2, 'roof-wine')
    c.P(fx - 1, top + 5, 'glow')
    for y in range(top + 4, g['hip']): c.P(fx - 1, y, 'wood')
def expert_torso(c, g):
    cx, top, hip, fx = g['cx'], g['top'], g['hip'], g['fx']
    c.R(fx - 1, top, fx, top + 1, 'cloud-hi')
    for (x, y) in line(fx - 1, top + 1, cx - 3, hip - 3): c.P(x, y, 'wood-dark')
def expert_hand(c, g):
    x, y = g['hand']
    c.R(x - 1, y - 3, x + 2, y, 'alert'); c.R(x - 1, y, x + 2, y, 'cloud-hi'); c.P(x - 1, y - 3, 'roof-wine'); c.P(x, y - 2, 'glow')
    c.R(x, y + 1, x + 1, y + 1, 'wood')
def expert_front(c, g):
    cx, hip = g['cx'], g['hip']
    c.R(cx - 5, hip - 4, cx - 1, hip, 'wood-lit'); c.R(cx - 5, hip - 4, cx - 1, hip - 3, 'wood'); c.R(cx - 5, hip, cx - 1, hip, 'wood')
    c.P(cx - 3, hip - 3, 'glow')

def chill_back(c, g):
    cx, top = g['cx'], g['top']; sw = 1 if g['bob'] < 0 else 0
    c.R(cx - 6 - sw, top + 1, cx - 4, top + 3, 'violet')
    c.R(cx - 6 - sw, top + 4, cx - 5, top + 7, 'violet'); c.R(cx - 6 - sw, top + 7, cx - 5, top + 8, 'wall-shade')
def chill_torso(c, g):
    cx, top = g['cx'], g['top']
    c.R(cx - 4, top, cx + 3, top + 2, 'violet'); c.R(cx - 4, top + 2, cx + 3, top + 2, 'wall-shade'); c.P(cx + 3, top, 'violet')
    c.R(cx - 2, top, cx - 1, top, 'cloud-hi')
    c.R(cx - 2, g['hip'] - 4, cx + 1, g['hip'] - 4, 'wall-shade')
def chill_head(c, g):
    hx, hy = g['hx'], g['hy']; c.P(hx + 4, hy + 5, 'alert') if False else None

def hard_torso(c, g):
    cx, top, fx = g['cx'], g['top'], g['fx']
    c.R(fx - 1, top, fx, top + 1, 'cloud-hi'); c.R(fx - 1, top + 1, fx - 1, top + 6, 'alert'); c.P(fx - 1, top + 6, 'roof-wine')
    c.P(cx - 2, top + 1, 'alert'); c.P(cx - 2, top + 2, 'alert')
def balance_torso(c, g):
    cx, top, hip, fx = g['cx'], g['top'], g['hip'], g['fx']
    for (x, y) in line(fx, top, cx - 3, hip - 3): c.P(x, y, 'ok')
    for (x, y) in line(fx, top + 1, cx - 3, hip - 2): c.P(x, y, 'leaf-dark')
    c.P(fx - 1, top, 'cloud-hi')
def balance_head(c, g):
    hx, hy = g['hx'], g['hy']; c.P(hx + 5, hy - 1, 'ok'); c.P(hx + 6, hy, 'ok')

def hat(col, shade, hl, brim=True, band=None, tall=0, mitre=False):
    def f(c, g):
        hx, hy = g['hx'], g['hy']
        top = hy - 1 - tall
        for y in range(top, hy):
            x0, x1 = hx + 1, hx + 6
            if mitre and y == top: x0, x1 = hx + 2, hx + 5
            c.R(x0, y, x1, y, col); c.P(x1, y, shade)
        c.R(hx + 1, top, hx + 2, top, hl or col) if not mitre else c.R(hx + 2, top, hx + 3, top, hl or col)
        if band: c.R(hx + 1, hy - 2, hx + 6, hy - 2, band)
        if brim:
            c.R(hx - 1, hy, hx + 7, hy, col); c.R(hx + 5, hy, hx + 7, hy, shade); c.R(hx + 7, hy, hx + 9, hy, shade)
    return f
def cap(col, shade, hl):
    def f(c, g):
        hx, hy = g['hx'], g['hy']
        c.R(hx, hy - 1, hx + 6, hy + 1, col); c.R(hx + 1, hy - 2, hx + 5, hy - 2, col)
        c.R(hx + 6, hy + 1, hx + 9, hy + 1, shade); c.R(hx, hy + 1, hx + 5, hy + 1, shade)
        c.R(hx + 1, hy - 2, hx + 2, hy - 2, hl); c.P(hx + 6, hy - 1, shade)
    return f

def chairman_torso(c, g):
    cx, top, hip, fx = g['cx'], g['top'], g['hip'], g['fx']
    c.R(cx - 3, top, cx + 2, top + 1, 'violet'); c.R(cx - 3, top + 1, cx + 2, top + 1, 'wall-shade'); c.P(cx - 1, top + 2, 'glow'); c.P(cx, top + 2, 'glow-core')
    c.R(fx, top + 2, fx, hip - 1, 'violet')
    c.R(cx - 3, hip - 2, cx + 2, hip - 2, 'wall-shade')

def examiner_torso(c, g):
    top, fx = g['top'], g['fx']
    c.R(fx - 1, top, fx, top + 2, 'wall-lit'); c.P(fx, top + 1, 'wall-mid')
    c.R(g['cx'] - 2, top + 1, g['cx'] - 2, top + 3, 'alert')
def examiner_hand(c, g):
    x, y = g['hand']
    c.R(x - 1, y - 4, x + 3, y + 1, 'wood'); c.R(x, y - 3, x + 2, y, 'wall-lit')
    c.R(x, y - 4, x + 2, y - 4, 'glow'); c.R(x, y - 2, x + 2, y - 2, 'wall-mid'); c.P(x, y, 'wall-mid'); c.P(x + 1, y, 'wall-mid')
    c.P(x - 1, y + 1, 'wood-lit'); c.P(x, y + 1, 'wood-lit')

def fresh_back(c, g):
    cx, top, hip = g['cx'], g['top'], g['hip']
    c.R(cx - 9, top - 1, cx - 3, hip + 1, 'ember'); c.R(cx - 9, hip, cx - 3, hip + 1, 'roof-wine'); c.R(cx - 3, top - 1, cx - 3, hip + 1, 'roof-wine')
    c.R(cx - 9, top + 1, cx - 7, top + 1, 'glow'); c.R(cx - 8, top + 4, cx - 5, hip - 1, 'roof-wine'); c.R(cx - 8, top + 4, cx - 5, top + 4, 'ember')
    c.R(cx - 7, top - 2, cx - 5, top - 2, 'roof-wine')
    c.P(cx - 8, top + 5, 'glow') if hip - top > 5 else None
def fresh_torso(c, g):
    cx, top, hip = g['cx'], g['top'], g['hip']
    c.R(cx - 2, top, cx - 2, hip - 2, 'roof-wine')

def med_torso(c, g):
    cx, top, hip, fx = g['cx'], g['top'], g['hip'], g['fx']
    for (x, y) in line(fx - 1, top, cx - 3, hip - 3): c.P(x, y, 'wood-dark')
def med_front(c, g):
    cx, hip = g['cx'], g['hip']
    c.R(cx - 6, hip - 4, cx - 1, hip + 1, 'wood'); c.R(cx - 6, hip - 4, cx - 1, hip - 3, 'wood-lit')
    c.R(cx - 5, hip - 2, cx - 2, hip, 'wall-lit'); c.P(cx - 4, hip - 1, 'alert'); c.P(cx - 3, hip - 2, 'wall-mid'); c.P(cx - 5, hip - 2, 'wall-mid')

def ta_torso(c, g):
    cx, top, hip = g['cx'], g['top'], g['hip']
    c.R(cx - 5, top - 1, cx - 2, top + 2, 'ember'); c.R(cx - 5, top + 1, cx - 3, top + 2, 'roof-wine')
    c.R(cx - 2, hip - 3, cx + 1, hip - 3, 'roof-shade'); c.P(g['fx'] - 1, top + 2, 'cloud-hi'); c.P(g['fx'] - 1, top + 3, 'cloud-hi')
def ta_head(c, g):
    hx, hy = g['hx'], g['hy']
    for x in range(2, 6): c.P(hx + x, hy - 1, 'wall-shade') if False else None
    c.R(hx + 1, hy - 1, hx + 4, hy - 1, 'wall-shade'); c.R(hx + 1, hy, hx + 1, hy + 4, 'wall-shade')
    c.R(hx + 2, hy + 4, hx + 3, hy + 6, 'cloud-hi'); c.R(hx + 2, hy + 6, hx + 3, hy + 6, 'cloud-lo')

# ---------------- spec table
BOOT_D = 'wood-dark'
CAST = {
 'student': dict(LL=8, TH=9, SK=1, skin=SK_MD, hair_style='short', hair=hair('wood', 'wood-dark', 'wood-lit'),
    coat=('roof-wine', 'roof-shade', 'alert'), pants=('hill-mid', 'hill-near'), boots='wood-dark', boots_sh='ink', eye='dot', tall_eye=True,
    acc=dict(torso=student_torso, head=student_head)),
 'dean': dict(LL=8, TH=9, SK=6, flare=1, seam=True, skin=SK_LT, hair_style='gray', hair=hair('wall-mid', 'wall-shade', 'wall-lit'),
    coat=('wood-lit', 'wood', 'glow'), hem='wood', pants=('wood', 'wood-dark'), boots='wood-dark', boots_sh='ink', eye='dot',
    acc=dict(torso=dean_torso, head=chain(mustache('wall-lit'), glasses()))),
 'expert': dict(LL=8, TH=9, SK=3, skin=SK_DK, hair_style='bun', hair=hair('wood-dark', 'ink', 'wood'),
    coat=('hill-far', 'hill-mid', 'cloud-lo'), pants=('wall-shade', 'hill-near'), boots='wood', boots_sh='wood-dark', eye='dot', armN_fixed=(3, 2),
    acc=dict(torso=expert_torso, hand=expert_hand, front=expert_front)),
 'council-chill': dict(LL=8, TH=9, SK=3, flare=1, skin=SK_LT, hair_style='long', hair=hair('wood-dark', 'ink', 'wood'),
    coat=('wall-mid', 'wall-shade', 'wall-lit'), pants=('hill-far', 'hill-mid'), boots='wall-lit', boots_sh='wall-mid', eye='sleepy', hideF=True,
    armN_fixed=(1, 3), hand_col='wall-shade', acc=dict(back=chill_back, torso=chill_torso)),
 'council-hard': dict(LL=8, TH=9, SK=2, TW=7, skin=SK_MD, hair_style='slick', hair=hair('wood-dark', 'ink', 'wood'),
    rim='roof-wine', coat=('roof-shade', 'ink', 'roof-wine'), pants=('roof-shade', 'ink'), boots='wood-dark', boots_sh='ink', eye='wide', tall_eye=False, brow='stern', arm_scale=0.5,
    acc=dict(torso=hard_torso)),
 'council-balance': dict(LL=8, TH=9, SK=4, flare=1, skin=SK_DK, hair_style='bob', hair=hair('wall-lit', 'wall-mid', 'cloud-hi'),
    coat=('leaf-lit', 'leaf-dark', 'ok'), hem='leaf-dark', pants=('leaf-dark', 'ink'), boots='wood-dark', boots_sh='ink', eye='dot',
    acc=dict(torso=balance_torso, head=balance_head)),
 'chairman': dict(LL=8, TH=9, SK=7, flare=2, skin=SK_LT, hair_style='gray', hair=hair('cloud-hi', 'wall-lit', 'cloud-hi'),
    coat=('sky-mid', 'sky-deep', 'sky-low'), hem='violet', pants=('sky-deep', 'ink'), boots='violet', boots_sh='wall-shade', eye='dot', arm_scale=0.6,
    acc=dict(torso=chairman_torso, head=chain(beard('cloud-hi', 'wall-lit'), hat('violet', 'wall-shade', 'cloud-hi', band='glow', tall=5, mitre=True)))),
 'examiner': dict(LL=8, TH=9, SK=6, flare=1, seam=True, skin=SK_MD, hair_style='slick', hair=hair('wood-dark', 'ink', 'wood'),
    rim='hill-mid', coat=('hill-near', 'ground', 'hill-mid'), hem='ground', pants=('ground', 'ink'), boots='ink', boots_sh='ink', eye='wide', tall_eye=False, brow='stern', armN_fixed=(3, 2),
    acc=dict(torso=examiner_torso, hand=examiner_hand, head=cap('ground', 'ink', 'hill-near'))),
 'freshman': dict(LL=5, TH=7, TW=5, SK=1, AL=5, skin=SK_LT, hair_style='fluff', hair=hair('glow', 'ember', 'glow-core'),
    coat=('ok', 'leaf-lit', 'cloud-hi'), pants=('hill-mid', 'hill-near'), boots='cloud-hi', boots_sh='cloud-lo', eye='wide', cheek='ember',
    acc=dict(back=fresh_back, torso=fresh_torso)),
 'mediator': dict(LL=8, TH=9, SK=3, skin=SK_DK, hair_style='short', hair=hair('wood-dark', 'ink', 'wood'),
    coat=('wall-lit', 'wall-mid', 'cloud-hi'), pants=('wall-shade', 'hill-near'), boots='wood-dark', boots_sh='ink', eye='dot',
    acc=dict(torso=med_torso, front=med_front, head=cap('wall-shade', 'sky-mid', 'wall-mid'))),
 'ta': dict(LL=8, TH=9, SK=2, skin=SK_MD, hair_style='spiky', hair=hair('wood-dark', 'ink', 'wood'),
    coat=('ember', 'roof-wine', 'glow'), pants=('wall-shade', 'hill-near'), boots='cloud-hi', boots_sh='cloud-lo', eye='dot', brow='sly',
    acc=dict(torso=ta_torso, head=ta_head)),
}
ORDER = ['student', 'dean', 'expert', 'council-chill', 'council-hard', 'council-balance', 'chairman', 'examiner', 'freshman', 'mediator', 'ta']

# council cast art (Chill / Grind / Advisor / Chair), see characters_council.py
from characters_council import register as _reg_council
_reg_council(CAST, ORDER)
