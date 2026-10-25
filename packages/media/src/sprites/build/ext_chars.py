"""Extension cast for the persona registry, built on the design-foundation renderer (assets/pixel/composed/scripts).
The foundation files are read-only: install() patches the in-memory CAST / HAIR / PORT_OPTS / portrait hooks only.
Every colour is a master-palette NAME. Roles the foundation lacks: cubbie (mascot), rival, 3 more experts, students 02-06."""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '../../../../..'))
FOUND = os.path.join(ROOT, 'assets/pixel/composed/scripts')
if FOUND not in sys.path: sys.path.insert(0, FOUND)
import characters_data as D
import characters_side as SIDE
import characters_portrait as PT
from characters_side import line
from characters_data import SK_LT, SK_MD, SK_DK, hair, chain, glasses, beard, hat, cap

# ---------------------------------------------------------------- extra side-view hair patterns (see characters_side.HAIR: (oy, rows), col i = head-local x i-2)
EXT_HAIR = {
 # bear fur cap with two round ears, darker fur at the back of the head
 'bear': (-3, ["...HHH.HHH", "...HLH.HLH", "..HHHHHHHH", "..HHHHHHHHh", "..HHHHHHhh", "..HHHH", "..HHH", "..HH"]),
 # swept-back spikes (forward-lean energy): spikes trail behind the head
 'swept': (-3, ["..H..H.H", ".HHHHHHHH", ".LHHHHHHHH", "HHHHHHHHHh", ".HHHHHHHh", "..HHH", "..HH"]),
 # big round afro
 'afro': (-4, ["...LHHHH", "..LHHHHHHH", ".LHHHHHHHHH", ".HHHHHHHHHH", ".HHHHHHHHHH", ".HHHHHHHHh", ".HHHHH", ".HHH", "..HH"]),
 # forward pompadour quiff
 'quiff': (-3, ["....HHHH", "...LHHHHHH", "..LHHHHHHHH", "..HHHHHHHHH", "..HHHHHHHh", "..HHH", "..HH"]),
 # short crop with a ponytail swinging off the back
 'ponytail': (-1, ["...LHHHH", "..LHHHHHHH", ".HHHHHHHHHH", "HHHHHHHHHh", "HHHH", "HHH", ".HH", ".hh", ".h"]),
}

# ---------------------------------------------------------------- sprite accessories (side view, see characters_data for g keys)
def hoodie(main, shade, light, lace='glow'):
    def torso(c, g):
        hx, hy, cx, top = g['hx'], g['hy'], g['cx'], g['top']
        c.R(hx - 2, hy + 3, hx + 1, hy + 4, shade); c.R(hx - 1, hy + 5, hx + 1, top + 2, shade)
        c.R(g['fx'] - 1, top + 2, g['fx'] - 1, top + 3, lace)
        c.R(cx - 2, g['hip'] - 3, cx + 1, g['hip'] - 3, shade)
    return torso

SPECS = {}
# ---- cubbie: bear (brown fur, round ears, cream muzzle + nose, gold scarf, round tail, paw-held lantern)
def cubbie_head(c, g):
    hx, hy = g['hx'], g['hy']
    c.R(hx + 6, hy + 4, hx + 8, hy + 7, 'skin-lt'); c.R(hx + 9, hy + 4, hx + 9, hy + 6, 'skin-lt'); c.R(hx + 6, hy + 7, hx + 8, hy + 7, 'wood-lit')
    c.R(hx + 8, hy + 4, hx + 9, hy + 4, 'ink')
    if g['pose'].get('mouth') == 'open': c.R(hx + 7, hy + 6, hx + 8, hy + 6, 'roof-shade')
    else: c.R(hx + 7, hy + 6, hx + 7, hy + 6, 'wood-dark')
def cubbie_back(c, g):
    cx, hip = g['cx'], g['hip']
    c.R(cx - 6, hip - 4, cx - 4, hip - 2, 'wood'); c.P(cx - 6, hip - 4, 'wood-lit'); c.P(cx - 6, hip - 2, 'wood-dark')
def cubbie_torso(c, g):
    cx, top = g['cx'], g['top']
    c.R(cx + 1, top + 3, cx + 3, top + 6, 'wood-lit'); c.R(cx + 3, top + 3, cx + 3, top + 6, 'wood')
    c.R(cx - 4, top, cx + 3, top + 1, 'glow'); c.R(cx - 4, top + 1, cx + 3, top + 1, 'ember') if False else None
    for x in (cx - 3, cx - 1, cx + 1): c.P(x, top + 1, 'ember')
    c.R(cx - 5, top + 1, cx - 5, top + 4, 'glow'); c.R(cx - 5, top + 4, cx - 5, top + 5, 'ember'); c.P(cx - 4, top + 2, 'glow')
def cubbie_hand(c, g):
    x, y = g['hand']
    c.R(x, y + 1, x + 1, y + 1, 'wood-lit'); c.P(x - 1, y + 2, 'wood-lit'); c.P(x + 2, y + 2, 'wood-lit'); c.R(x, y + 2, x + 1, y + 2, 'wood-lit')
    c.R(x - 1, y + 3, x + 2, y + 5, 'wood-lit'); c.R(x, y + 3, x + 1, y + 5, 'glow'); c.R(x, y + 4, x + 1, y + 4, 'glow-core')
    c.R(x - 1, y + 6, x + 2, y + 6, 'wood-lit'); c.P(x - 2, y + 4, 'glow') if False else None
SPECS['cubbie'] = dict(LL=7, TH=9, SK=1, TW=7, skin=('wood-lit', 'wood'), hair_style='bear', hair=hair('wood', 'wood-dark', 'wood-lit'),
    coat=('wood', 'wood-dark', 'wood-lit'), pants=('wood-dark', 'ink'), boots='wood-dark', boots_sh='ink', eye='dot', tall_eye=True, cheek='ember', armN_fixed=(6, 3),
    acc=dict(back=cubbie_back, torso=cubbie_torso, head=cubbie_head, hand=cubbie_hand))

# ---- rival: icy swept spikes, goggles pushed up, long red scarf streaming behind, smirk
def rival_head(c, g):
    hx, hy = g['hx'], g['hy']
    c.R(hx, hy, hx + 7, hy, 'wood-dark')
    for x0 in (hx + 2, hx + 5):
        c.R(x0, hy - 2, x0 + 1, hy - 1, 'glow'); c.P(x0, hy - 2, 'glow-core'); c.R(x0 - 1, hy - 2, x0 - 1, hy - 1, 'wood-dark'); c.R(x0 + 2, hy - 2, x0 + 2, hy - 1, 'wood-dark')
        c.R(x0, hy - 3, x0 + 1, hy - 3, 'wood-dark')
    c.P(hx + 7, hy + 5, 'wood-lit')
def rival_back(c, g):
    cx, top = g['cx'], g['top']; n = 5 if g['bob'] == 0 else 6; y = top + (0 if g['bob'] == 0 else -1)
    c.R(cx - 4 - n, y + 1, cx - 4, y + 2, 'alert'); c.R(cx - 4 - n, y + 2, cx - 4, y + 2, 'roof-wine'); c.R(cx - 4 - n, y, cx - 4 - n + 1, y, 'alert')
    c.R(cx - 5 - n // 2, y + 4, cx - 4, y + 4, 'alert'); c.R(cx - 5 - n // 2, y + 5, cx - 4, y + 5, 'roof-wine')
def rival_torso(c, g):
    cx, top, fx = g['cx'], g['top'], g['fx']
    c.R(cx - 3, top, cx + 3, top + 1, 'alert'); c.R(cx - 3, top + 1, cx + 3, top + 1, 'roof-wine'); c.P(cx + 3, top - 1, 'alert')
    c.R(fx - 1, top + 2, fx - 1, g['hip'] - 2, 'alert'); c.P(cx - 2, top + 3, 'alert'); c.R(cx - 3, g['hip'] - 3, cx + 2, g['hip'] - 3, 'sky-deep')
SPECS['rival'] = dict(LL=8, TH=9, SK=3, skin=SK_LT, hair_style='swept', hair=hair('sky-low', 'sky-mid', 'cloud-lo'),
    coat=('wall-shade', 'sky-deep', 'wall-mid'), pants=('sky-deep', 'ink'), boots='alert', boots_sh='roof-wine', eye='wide', tall_eye=False, brow='sly',
    acc=dict(back=rival_back, torso=rival_torso, head=rival_head))

# ---- experts: variants of the foundation expert (ada = foundation expert)
def sage_torso(c, g):
    cx, top, fx = g['cx'], g['top'], g['fx']
    c.R(fx - 1, top, fx, top + 1, 'cloud-hi'); c.R(cx - 3, g['hip'] - 4, cx + 2, g['hip'] - 4, 'cloud-hi'); c.P(fx - 1, top + 2, 'ok'); c.P(fx - 1, top + 3, 'leaf-dark')
def sage_hand(c, g):
    x, y = g['hand']
    c.R(x - 1, y - 1, x + 3, y + 1, 'cloud-hi'); c.R(x - 1, y + 1, x + 3, y + 1, 'cloud-lo'); c.P(x - 1, y - 1, 'alert'); c.P(x + 3, y - 1, 'alert'); c.P(x + 3, y + 1, 'roof-wine'); c.R(x, y, x + 2, y, 'wall-mid')
    c.P(x, y + 2, 'skin-lt') if False else None
SPECS['expert-sage'] = dict(LL=8, TH=9, SK=5, flare=1, seam=True, skin=SK_LT, hair_style='gray', hair=hair('cloud-hi', 'wall-lit', 'cloud-hi'),
    coat=('leaf-lit', 'leaf-dark', 'ok'), hem='leaf-dark', pants=('leaf-dark', 'ink'), boots='wood-dark', boots_sh='ink', eye='dot', armN_fixed=(3, 2),
    acc=dict(torso=sage_torso, hand=sage_hand, head=chain(beard('cloud-hi', 'wall-lit'), glasses('wood'))))
def monk_torso(c, g):
    cx, top, hip, fx = g['cx'], g['top'], g['hip'], g['fx']
    for (x, y) in line(fx - 1, top, cx - 3, hip - 3): c.P(x, y, 'roof-wine')
    c.R(cx - 3, hip - 4, cx + 2, hip - 4, 'glow'); c.R(fx - 1, top, fx, top + 1, 'wood-lit')
    for (x, y) in ((fx - 1, top + 2), (fx - 2, top + 3), (fx - 2, top + 4)): c.P(x, y, 'glow-core')
def monk_hat(c, g):  # wide straw kasa: low cone with a broad brim, a silhouette no other character has
    hx, hy = g['hx'], g['hy']
    for i, (x0, x1) in enumerate([(hx + 2, hx + 5), (hx + 1, hx + 6), (hx, hx + 7)]):
        y = hy - 3 + i; c.R(x0, y, x1, y, 'glow'); c.P(x1, y, 'wood-lit')
    c.R(hx - 2, hy, hx + 9, hy, 'wood-lit'); c.R(hx + 5, hy, hx + 9, hy, 'wood'); c.P(hx - 2, hy, 'wood')
    c.R(hx, hy - 1, hx + 7, hy - 1, 'roof-wine')
SPECS['expert-monk'] = dict(LL=8, TH=9, SK=5, flare=1, skin=SK_MD, hair_style='bald', hair=hair('wood-dark', 'ink', 'wood'),
    coat=('ember', 'roof-wine', 'glow'), hem='roof-wine', pants=('roof-wine', 'roof-shade'), boots='wood-dark', boots_sh='ink', eye='sleepy', armN_fixed=(3, 2),
    acc=dict(torso=monk_torso, head=monk_hat))

# ---- mage: teal star hat with wide brim, long silver hair (no beard), plum robe + cape, glowing-orb staff
def mage_hat(c, g):
    hx, hy = g['hx'], g['hy']
    rows = [(hx, hx + 7), (hx + 1, hx + 7), (hx + 1, hx + 6), (hx, hx + 5), (hx, hx + 4), (hx - 1, hx + 2)]
    for i, (x0, x1) in enumerate(rows):
        y = hy - 1 - i; c.R(x0, y, x1, y, 'leaf-lit'); c.P(x1, y, 'leaf-dark'); c.P(x1 - 1, y, 'leaf-dark') if x1 - x0 > 3 else None
    c.P(hx - 2, hy - 7, 'leaf-lit'); c.P(hx - 2, hy - 6, 'leaf-dark')
    c.R(hx, hy - 1, hx + 7, hy - 1, 'glow'); c.P(hx + 7, hy - 1, 'ember')
    c.P(hx + 2, hy - 3, 'glow-core'); c.P(hx + 4, hy - 5, 'glow-core'); c.P(hx + 5, hy - 2, 'glow-core') if False else None
    c.R(hx - 2, hy, hx + 9, hy, 'leaf-lit'); c.R(hx + 5, hy, hx + 9, hy, 'leaf-dark'); c.P(hx - 2, hy, 'leaf-dark')
def mage_back(c, g):
    cx, top, hip, SKl = g['cx'], g['top'], g['hip'], 7
    sw = 1 if g['bob'] < 0 else 0
    c.R(cx - 6 - sw, top, cx - 4, hip + SKl - 1, 'roof-shade'); c.R(cx - 7 - sw, top + 4, cx - 6 - sw, hip + SKl - 1, 'roof-shade')
    c.R(cx - 7 - sw, hip + SKl - 2, cx - 4, hip + SKl - 1, 'roof-wine'); c.P(cx - 5 - sw, top + 3, 'glow-core')
def mage_torso(c, g):
    cx, top, hip, fx = g['cx'], g['top'], g['hip'], g['fx']
    c.R(cx - 3, top, cx + 2, top, 'glow'); c.P(fx - 1, top + 1, 'glow-core'); c.R(fx - 1, top + 2, fx - 1, hip - 1, 'ember')
    c.R(cx - 3, hip - 3, cx + 2, hip - 3, 'glow')
    for (x, y) in ((cx - 2, top + 3), (cx, top + 5), (cx - 2, hip - 2)): c.P(x, y, 'glow-core')
def mage_hand(c, g):
    x = g['cx'] + 6; y = g['hand'][1]
    c.R(x, 6, x, 30, 'wood-lit'); c.R(x + 1, 6, x + 1, 30, 'wood')
    c.R(x - 1, 2, x + 2, 5, 'glow'); c.R(x, 1, x + 1, 6, 'glow'); c.R(x, 3, x + 1, 4, 'glow-core'); c.P(x - 1, 2, 'glow-core') if False else None
    c.R(x - 1, 6, x + 2, 6, 'wood-dark')
SPECS['expert-mage'] = dict(LL=8, TH=9, SK=7, flare=2, skin=SK_DK, hair_style='long', hair=hair('wall-lit', 'wall-mid', 'cloud-hi'),
    coat=('roof-wine', 'roof-shade', 'alert'), hem='roof-shade', pants=('roof-shade', 'ink'), boots='glow', boots_sh='ember', eye='wide', armN_fixed=(7, 2),
    acc=dict(back=mage_back, torso=mage_torso, hand=mage_hand, head=mage_hat))

# ---- students 02-06: hoodie variants, each with its own hair silhouette, skin tone, colour and ONE accessory
def student(skin, hair_style, hair_cols, coat, pants, boots, lace='glow', head=None, back=None):
    acc = dict(torso=hoodie(coat[0], coat[1], coat[2], lace))
    if head: acc['head'] = head
    if back: acc['back'] = back
    return dict(LL=8, TH=9, SK=1, skin=skin, hair_style=hair_style, hair=hair(*hair_cols), coat=coat, pants=pants, boots=boots[0], boots_sh=boots[1],
                eye='dot', tall_eye=True, acc=acc)
def headphones(c, g):
    hx, hy = g['hx'], g['hy']
    c.R(hx, hy - 5, hx + 6, hy - 5, 'cloud-hi'); c.R(hx - 1, hy - 4, hx - 1, hy + 1, 'cloud-hi'); c.R(hx + 7, hy - 4, hx + 7, hy - 2, 'cloud-hi')
    c.R(hx, hy + 1, hx + 3, hy + 5, 'cloud-hi'); c.R(hx + 1, hy + 2, hx + 3, hy + 4, 'glow'); c.R(hx + 2, hy + 3, hx + 3, hy + 3, 'glow-core'); c.R(hx, hy + 5, hx + 3, hy + 5, 'cloud-lo')
def pack(c, g):
    cx, top, hip = g['cx'], g['top'], g['hip']
    c.R(cx - 8, top - 1, cx - 4, hip, 'roof-wine'); c.R(cx - 8, hip - 1, cx - 4, hip, 'roof-shade'); c.R(cx - 8, top - 1, cx - 7, top - 1, 'alert')
    c.R(cx - 7, top + 2, cx - 5, top + 4, 'roof-shade'); c.P(cx - 6, top + 3, 'glow')
def pack_strap(c, g):
    cx, top = g['cx'], g['top']; c.R(cx - 3, top, cx - 2, top + 1, 'roof-shade'); c.R(cx - 3, top + 2, cx - 3, top + 5, 'roof-shade'); c.P(cx - 3, top + 5, 'glow')
def beanie(c, g):
    hx, hy = g['hx'], g['hy']
    c.R(hx, hy - 2, hx + 7, hy, 'ember'); c.R(hx + 1, hy - 3, hx + 6, hy - 3, 'ember'); c.R(hx + 1, hy - 3, hx + 2, hy - 3, 'glow')
    c.R(hx - 1, hy + 1, hx + 7, hy + 1, 'roof-wine'); c.P(hx + 7, hy + 1, 'roof-shade'); c.P(hx + 4, hy + 1, 'alert') if False else None
    c.R(hx + 2, hy - 5, hx + 4, hy - 4, 'glow-core'); c.P(hx + 4, hy - 4, 'glow')
    for x in (hx + 1, hx + 3, hx + 5): c.P(x, hy - 1, 'roof-wine')
def cap06(c, g):  # snapback worn backwards: visor trails behind the head (unlike the foundation's forward caps)
    hx, hy = g['hx'], g['hy']
    c.R(hx, hy - 3, hx + 5, hy - 1, 'cloud-hi'); c.R(hx + 1, hy - 4, hx + 4, hy - 4, 'cloud-hi'); c.R(hx + 1, hy - 4, hx + 2, hy - 4, 'moon')
    c.R(hx, hy, hx + 5, hy, 'cloud-lo'); c.R(hx + 5, hy - 3, hx + 5, hy - 1, 'cloud-lo'); c.R(hx - 3, hy, hx - 1, hy, 'cloud-lo'); c.R(hx - 3, hy - 1, hx - 1, hy - 1, 'cloud-hi')
    c.R(hx + 2, hy - 3, hx + 3, hy - 2, 'ember')
SPECS['student-02'] = student(SK_DK, 'afro', ('wood-dark', 'ink', 'wood'), ('glow', 'ember', 'glow-core'), ('hill-mid', 'hill-near'), ('wall-lit', 'wall-mid'), head=headphones)
SPECS['student-03'] = student(SK_MD, 'ponytail', ('wood-dark', 'ink', 'wood'), ('cloud-hi', 'wall-mid', 'wall-lit'), ('hill-near', 'ground'), ('wood-dark', 'ink'), 'alert', back=pack)
SPECS['student-03']['acc']['torso'] = chain(hoodie('cloud-hi', 'wall-mid', 'wall-lit', 'alert'), pack_strap)
SPECS['student-04'] = student(SK_LT, 'bob', ('glow', 'ember', 'glow-core'), ('violet', 'wall-shade', 'cloud-hi'), ('hill-mid', 'hill-near'), ('cloud-hi', 'cloud-lo'), head=beanie)
SPECS['student-05'] = student(SK_DK, 'quiff', ('roof-wine', 'roof-shade', 'alert'), ('ok', 'leaf-lit', 'cloud-hi'), ('wall-shade', 'hill-near'), ('wood-dark', 'ink'), 'cloud-hi', head=glasses('glow'))
SPECS['student-06'] = student(SK_MD, 'short', ('wood', 'wood-dark', 'wood-lit'), ('sky-low', 'sky-mid', 'cloud-hi'), ('ground', 'ink'), ('alert', 'roof-shade'), head=cap06)

# ---------------------------------------------------------------- portraits: hooks keyed by name
PORT_OPTS = {
    'cubbie': dict(mouth='smile', hy=10), 'rival': dict(mouth='smirk', hy=9), 'expert-sage': dict(mouth='smile', hy=9), 'expert-monk': dict(mouth='flat', hy=9),
    'expert-mage': dict(mouth='smile', hy=11), 'student-02': dict(mouth='smile', hy=9), 'student-03': dict(mouth='smile', hy=9), 'student-04': dict(mouth='smile', hy=9),
    'student-05': dict(mouth='smirk', hy=9), 'student-06': dict(mouth='smile', hy=9),
}
def _hair_ext(c, style, hy, cols, back=False):
    b, s, l = cols; l = l or b
    if style == 'bear':
        if back:
            c.R(8, hy - 5, 13, hy - 1, 'wood'); c.R(9, hy - 4, 12, hy - 2, 'roof-wine'); c.R(18, hy - 5, 23, hy - 1, 'wood'); c.R(19, hy - 4, 22, hy - 2, 'roof-wine')
            c.R(8, hy - 5, 9, hy - 4, 'wood-dark') if False else None
            return
        c.R(9, hy - 1, 22, hy + 1, 'wood'); c.R(10, hy - 2, 21, hy - 2, 'wood'); c.R(11, hy - 2, 15, hy - 2, 'wood-lit'); c.R(9, hy + 2, 10, hy + 9, 'wood'); c.R(21, hy + 2, 22, hy + 9, 'wood-dark')
        c.R(9, hy + 8, 10, hy + 10, 'wood-lit'); c.R(21, hy + 8, 22, hy + 10, 'wood')
        c.R(12, hy + 1, 19, hy + 1, 'wood'); c.R(14, hy + 2, 17, hy + 2, 'wood-lit') if False else None
    elif style == 'swept':
        if back: return
        for x in (9, 12, 15, 18, 21): c.R(x, hy - 6, x + 1, hy - 3, b)
        for x in (10, 13, 16, 19): c.R(x, hy - 4, x, hy - 2, l) if False else None
        c.R(9, hy - 3, 22, hy + 1, b); c.R(8, hy - 1, 9, hy + 3, b); c.R(9, hy + 2, 12, hy + 3, b); c.R(17, hy + 2, 22, hy + 3, b); c.R(9, hy - 3, 22, hy - 3, s) if False else None
        c.R(14, hy + 1, 20, hy + 1, s); c.R(12, hy - 2, 14, hy - 2, l); c.R(21, hy + 2, 22, hy + 5, b)
    elif style == 'afro':
        if back:
            c.R(11, hy - 6, 20, hy - 6, b); c.R(9, hy - 5, 22, hy - 5, b); c.R(7, hy - 4, 24, hy + 5, b); c.R(8, hy + 6, 9, hy + 8, b); c.R(22, hy + 6, 23, hy + 8, b)
            c.R(13, hy - 6, 16, hy - 6, l); c.R(8, hy - 3, 9, hy - 3, l); c.R(8, hy + 4, 9, hy + 5, s); c.R(22, hy + 4, 23, hy + 5, s)
            return
        c.R(9, hy - 2, 22, hy + 1, b); c.R(10, hy - 3, 21, hy - 3, b); c.R(9, hy + 2, 10, hy + 4, b); c.R(21, hy + 2, 22, hy + 4, b)
        c.R(11, hy - 3, 15, hy - 2, l) if False else None; c.R(11, hy - 3, 14, hy - 3, l); c.R(12, hy + 2, 19, hy + 2, b); c.R(16, hy + 1, 19, hy + 1, s) if False else None
    elif style == 'quiff':
        if back: return
        c.R(9, hy - 1, 22, hy + 1, b); c.R(10, hy - 2, 22, hy - 2, b); c.R(12, hy - 4, 22, hy - 3, b); c.R(15, hy - 5, 21, hy - 5, b); c.R(13, hy - 4, 17, hy - 3, l) if False else None
        c.R(13, hy - 4, 16, hy - 4, l); c.R(11, hy - 2, 13, hy - 2, l); c.R(9, hy + 2, 10, hy + 6, b); c.R(21, hy + 2, 22, hy + 3, b); c.R(10, hy + 2, 12, hy + 2, s)
    elif style == 'ponytail':
        if back:
            c.R(6, hy + 1, 9, hy + 4, b); c.R(5, hy + 5, 8, hy + 12, b); c.R(5, hy + 10, 7, hy + 13, s); c.R(6, hy + 3, 7, hy + 4, l)
            return
        _ORIG_HAIR(c, 'short', hy, cols, False); c.R(9, hy + 2, 11, hy + 4, b)
_ORIG_HAIR = PT.hair_front
def _wrap_hair(c, style, hy, cols, back=False):
    if style in ('bear', 'swept', 'afro', 'ponytail', 'quiff'): _hair_ext(c, style, hy, cols, back)
    else: _ORIG_HAIR(c, style, hy, cols, back)
def _port_acc(n, c, S, hy):
    coat = S['coat']
    if n == 'cubbie':
        c.R(11, 23, 20, 25, 'glow'); c.R(11, 25, 20, 25, 'ember'); c.R(12, 26, 15, 29, 'glow'); c.R(12, 29, 15, 29, 'ember'); c.P(13, 27, 'ember')
        c.R(21, 26, 27, 31, 'wood-dark'); c.R(22, 27, 26, 30, 'glow'); c.R(23, 28, 25, 29, 'glow-core'); c.R(23, 25, 25, 25, 'wood-dark')
        c.P(24, 24, 'wood-dark') if False else None
    elif n == 'rival':
        c.R(8, 23, 23, 25, 'alert'); c.R(8, 25, 23, 25, 'roof-wine'); c.R(9, 26, 12, 29, 'alert'); c.R(9, 29, 12, 29, 'roof-wine'); c.R(10, 26, 10, 28, 'roof-wine')
        c.R(21, 26, 21, 31, 'sky-deep')
    elif n == 'expert-sage':
        c.R(13, 23, 18, 24, 'cloud-hi')
    elif n == 'expert-monk':
        c.R(12, 24, 19, 25, 'glow')
        for (x, y) in line(24, 24, 9, 31): c.P(x, y, 'roof-wine'); c.P(x, y + 1, 'roof-shade')
        for (x, y) in ((11, 26), (12, 27), (13, 28), (15, 28), (17, 28), (18, 27), (19, 26)): c.P(x, y, 'glow-core')
    elif n == 'expert-mage':
        c.R(6, 24, 25, 31, 'roof-shade'); c.R(10, 26, 21, 27, 'glow'); c.R(15, 28, 16, 29, 'glow-core')
        c.R(25, 20, 29, 24, 'glow'); c.R(26, 19, 28, 25, 'glow'); c.R(26, 21, 28, 23, 'glow-core'); c.R(25, 25, 29, 31, 'wood-lit') if False else None
    elif n.startswith('student-'):
        c.R(12, 23, 19, 24, coat[1]); c.P(13, 25, 'glow'); c.P(18, 25, 'glow')
        if n == 'student-03':
            c.R(10, 24, 11, 31, 'roof-shade'); c.R(20, 24, 21, 31, 'roof-shade'); c.P(11, 28, 'glow'); c.P(20, 28, 'glow')
def _port_head(n, c, hy):
    if n == 'cubbie':
        # muzzle (cream) with nose and smile, fur cheeks
        c.R(12, hy + 8, 19, hy + 11, 'skin-lt'); c.R(13, hy + 7, 18, hy + 7, 'skin-lt'); c.R(13, hy + 12, 18, hy + 12, 'skin-lt')
        c.R(14, hy + 8, 17, hy + 8, 'ink'); c.R(15, hy + 9, 16, hy + 9, 'ink'); c.R(15, hy + 10, 16, hy + 10, 'wood-dark')
        c.P(14, hy + 11, 'wood-dark'); c.P(17, hy + 11, 'wood-dark'); c.R(15, hy + 11, 16, hy + 11, 'roof-shade'); c.P(13, hy + 10, 'wood-dark'); c.P(18, hy + 10, 'wood-dark')
    elif n == 'rival':
        # goggles pushed up on the hair, band-aid on cheek
        c.R(8, hy - 1, 23, hy, 'wood-dark')
        for x0 in (10, 17):
            c.R(x0, hy - 4, x0 + 4, hy - 1, 'wood-dark'); c.R(x0 + 1, hy - 3, x0 + 3, hy - 2, 'glow'); c.P(x0 + 1, hy - 3, 'glow-core'); c.P(x0 + 2, hy - 3, 'glow-core')
    elif n == 'expert-sage':
        c.R(10, hy + 8, 21, hy + 11, 'cloud-hi'); c.R(12, hy + 12, 19, hy + 13, 'cloud-hi'); c.R(14, hy + 9, 17, hy + 9, 'wall-mid')
        for (x0, x1) in ((11, 14), (17, 20)): c.R(x0, hy + 5, x1, hy + 8, 'wood'); c.R(x0 + 1, hy + 6, x1 - 1, hy + 7, 'cloud-hi')
        c.R(15, hy + 6, 16, hy + 6, 'wood'); c.P(13, hy + 7, 'ink'); c.P(18, hy + 7, 'ink')
    elif n == 'expert-mage':
        for i, (x0, x1) in enumerate([(8, 23), (9, 22), (10, 22), (10, 20), (9, 18), (9, 16), (8, 14), (7, 12)]):
            pass
        rows = [(9, 22), (10, 22), (10, 21), (10, 20), (9, 18), (9, 17), (8, 15), (7, 13)]
        for i, (x0, x1) in enumerate(rows):
            y = hy - 3 - i; c.R(x0, y, x1, y, 'leaf-lit'); c.R(x1 - 2, y, x1, y, 'leaf-dark')
        c.R(5, hy - 2, 26, hy - 1, 'leaf-lit'); c.R(16, hy - 1, 26, hy - 1, 'leaf-dark'); c.R(9, hy - 3, 22, hy - 3, 'glow'); c.R(5, hy - 1, 6, hy - 1, 'leaf-dark')
        c.R(14, hy - 6, 14, hy - 4, 'glow-core'); c.R(13, hy - 5, 15, hy - 5, 'glow-core'); c.P(18, hy - 8, 'glow-core'); c.P(12, hy - 8, 'glow') if False else None
        c.P(19, hy - 5, 'glow-core'); c.P(11, hy - 7, 'glow')
    elif n == 'student-02':
        c.R(8, hy - 6, 23, hy - 6, 'cloud-hi'); c.R(7, hy - 5, 8, hy + 3, 'cloud-hi'); c.R(23, hy - 5, 24, hy + 3, 'cloud-hi')
        c.R(6, hy + 4, 10, hy + 9, 'cloud-hi'); c.R(7, hy + 5, 9, hy + 8, 'glow'); c.R(7, hy + 5, 8, hy + 6, 'glow-core'); c.R(6, hy + 9, 10, hy + 9, 'cloud-lo')
        c.R(21, hy + 4, 25, hy + 9, 'cloud-hi'); c.R(22, hy + 5, 24, hy + 8, 'glow'); c.R(23, hy + 5, 24, hy + 6, 'glow-core'); c.R(21, hy + 9, 25, hy + 9, 'cloud-lo')
    elif n == 'student-04':
        c.R(9, hy - 4, 22, hy + 0, 'ember'); c.R(11, hy - 5, 20, hy - 5, 'ember'); c.R(11, hy - 5, 14, hy - 5, 'glow'); c.R(8, hy + 1, 23, hy + 2, 'roof-wine'); c.R(21, hy + 1, 23, hy + 2, 'roof-shade')
        c.R(13, hy - 9, 18, hy - 6, 'glow-core'); c.R(15, hy - 10, 16, hy - 10, 'glow-core'); c.R(17, hy - 6, 18, hy - 6, 'glow')
        for x in (11, 14, 17, 20): c.P(x, hy + 1, 'ember')
    elif n == 'student-05':
        for (x0, x1) in ((10, 14), (17, 21)): c.R(x0, hy + 5, x1, hy + 8, 'glow'); c.R(x0 + 1, hy + 6, x1 - 1, hy + 7, 'cloud-hi')
        c.R(15, hy + 6, 16, hy + 6, 'glow'); c.P(12, hy + 6, 'ink'); c.P(12, hy + 7, 'ink'); c.P(18, hy + 6, 'ink'); c.P(18, hy + 7, 'ink')
        c.R(8, hy + 5, 9, hy + 6, 'glow') if False else None
    elif n == 'student-06':
        c.R(9, hy - 3, 22, hy - 1, 'cloud-hi'); c.R(11, hy - 4, 20, hy - 4, 'cloud-hi'); c.R(11, hy - 4, 14, hy - 4, 'moon'); c.R(9, hy, 22, hy, 'cloud-lo'); c.R(13, hy - 3, 18, hy - 2, 'ember')
        c.R(21, hy - 3, 22, hy, 'cloud-lo'); c.R(15, hy - 3, 16, hy - 3, 'alert')

_orig_acc, _orig_head = PT.acc_port, PT.head_acc
def _wrap_acc(n, c, S, hy):
    (_port_acc if n in SPECS else _orig_acc)(n, c, S, hy)
def _wrap_head(n, c, hy):
    (_port_head if n in SPECS else _orig_head)(n, c, hy)

_installed = False
def install():
    global _installed
    if _installed: return
    SIDE.HAIR['bald'] = (0, [])
    SIDE.HAIR.update(EXT_HAIR)
    D.CAST.update(SPECS)
    PT.PORT_OPTS.update(PORT_OPTS)
    PT.acc_port, PT.head_acc, PT.hair_front = _wrap_acc, _wrap_head, _wrap_hair
    _installed = True
