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
from characters_data import SK_LT, SK_MD, SK_DK, hair, chain, glasses, beard, hat, cap

# ---------------------------------------------------------------- sprite accessories (side view, see characters_data for g keys)
def hoodie(main, shade, light, lace='glow'):
    def torso(c, g):
        hx, hy, cx, top = g['hx'], g['hy'], g['cx'], g['top']
        c.R(hx - 2, hy + 3, hx + 1, hy + 4, shade); c.R(hx - 1, hy + 5, hx + 1, top + 2, shade)
        c.R(g['fx'] - 1, top + 2, g['fx'] - 1, top + 3, lace)
        c.R(cx - 2, g['hip'] - 3, cx + 1, g['hip'] - 3, shade)
    return torso

NONE = lambda c, g: None

SPECS = {}
# ---- cubbie: bear (brown costume, round ears, cream muzzle, gold scarf, lantern)
def cubbie_head(c, g):
    hx, hy = g['hx'], g['hy']
    c.R(hx + 1, hy - 3, hx + 3, hy - 2, 'wood'); c.R(hx + 1, hy - 3, hx + 2, hy - 3, 'wood-lit'); c.P(hx + 2, hy - 2, 'wood-dark')
    c.R(hx + 5, hy - 3, hx + 7, hy - 2, 'wood'); c.R(hx + 5, hy - 3, hx + 6, hy - 3, 'wood-lit'); c.P(hx + 6, hy - 2, 'wood-dark')
    c.R(hx + 6, hy + 4, hx + 8, hy + 6, 'skin-lt'); c.P(hx + 8, hy + 4, 'ink'); c.P(hx + 8, hy + 5, 'ink')
    c.R(hx + 5, hy + 7, hx + 7, hy + 7, 'glow')
def cubbie_torso(c, g):
    cx, top = g['cx'], g['top']
    c.R(cx - 3, top, cx + 2, top, 'glow'); c.R(cx - 4, top + 1, cx - 3, top + 4, 'glow'); c.P(cx - 4, top + 4, 'ember')
def cubbie_hand(c, g):
    x, y = g['hand']
    c.R(x, y + 1, x + 2, y + 4, 'wood-dark'); c.R(x + 1, y + 2, x + 1, y + 3, 'glow-core'); c.P(x + 1, y + 1, 'wood-lit'); c.P(x, y + 2, 'glow'); c.P(x + 2, y + 2, 'glow')
SPECS['cubbie'] = dict(LL=7, TH=9, SK=1, TW=7, skin=('wood-lit', 'wood'), hair_style='short', hair=hair('wood', 'wood-dark', 'wood-lit'),
    coat=('wood', 'wood-dark', 'wood-lit'), pants=('wood-dark', 'ink'), boots='wood-dark', boots_sh='ink', eye='dot', tall_eye=True, cheek='ember',
    acc=dict(torso=cubbie_torso, head=cubbie_head, hand=cubbie_hand))

# ---- rival: red scarf, goggles up, dark jacket
def rival_head(c, g):
    hx, hy = g['hx'], g['hy']
    c.R(hx + 1, hy - 1, hx + 6, hy, 'wood-dark'); c.R(hx + 2, hy - 1, hx + 3, hy - 1, 'cloud-lo'); c.R(hx + 5, hy - 1, hx + 6, hy - 1, 'cloud-lo'); c.P(hx + 3, hy - 1, 'cloud-hi')
def rival_torso(c, g):
    cx, top = g['cx'], g['top']
    c.R(cx - 3, top, cx + 2, top + 1, 'alert'); c.R(cx - 5, top + 1, cx - 3, top + 4, 'alert'); c.R(cx - 5, top + 3, cx - 4, top + 4, 'roof-wine')
SPECS['rival'] = dict(LL=8, TH=9, SK=3, skin=SK_LT, hair_style='spiky', hair=hair('ember', 'alert', 'glow'),
    coat=('wood-dark', 'ink', 'wood'), pants=('ground', 'ink'), boots='alert', boots_sh='roof-wine', eye='wide', tall_eye=False, brow='sly',
    acc=dict(torso=rival_torso, head=rival_head))

# ---- experts: variants of the foundation expert (ada = foundation expert)
def sage_torso(c, g):
    cx, top, fx = g['cx'], g['top'], g['fx']
    c.R(fx - 1, top, fx, top + 1, 'cloud-hi'); c.R(cx - 3, g['hip'] - 4, cx + 2, g['hip'] - 4, 'cloud-hi')
SPECS['expert-sage'] = dict(LL=8, TH=9, SK=5, flare=1, seam=True, skin=SK_LT, hair_style='gray', hair=hair('cloud-hi', 'wall-lit', 'cloud-hi'),
    coat=('leaf-lit', 'leaf-dark', 'ok'), hem='leaf-dark', pants=('leaf-dark', 'ink'), boots='wood-dark', boots_sh='ink', eye='dot', armN_fixed=(3, 2),
    acc=dict(torso=sage_torso, head=chain(beard('cloud-hi', 'wall-lit'), glasses('wood'))))
SPECS['expert-monk'] = dict(LL=8, TH=9, SK=5, flare=1, skin=SK_MD, hair_style='bald', hair=hair('wood-dark', 'ink', 'wood'),
    coat=('ember', 'roof-wine', 'glow'), hem='roof-wine', pants=('roof-wine', 'roof-shade'), boots='wood-dark', boots_sh='ink', eye='sleepy', armN_fixed=(3, 2),
    acc=dict(torso=lambda c, g: c.R(g['cx'] - 3, g['hip'] - 4, g['cx'] + 2, g['hip'] - 4, 'glow')))
SPECS['expert-mage'] = dict(LL=8, TH=9, SK=7, flare=2, skin=SK_LT, hair_style='long', hair=hair('wall-lit', 'wall-mid', 'cloud-hi'),
    coat=('violet', 'wall-shade', 'cloud-hi'), hem='wall-shade', pants=('wall-shade', 'sky-deep'), boots='glow', boots_sh='ember', eye='wide', armN_fixed=(3, 2),
    acc=dict(head=hat('violet', 'wall-shade', 'cloud-hi', band='glow', tall=4)))

# ---- students 02-06: hoodie variants with distinct hair, skin and colours
def student(skin, hair_style, hair_cols, coat, pants, boots, lace='glow'):
    return dict(LL=8, TH=9, SK=1, skin=skin, hair_style=hair_style, hair=hair(*hair_cols), coat=coat, pants=pants, boots=boots[0], boots_sh=boots[1],
                eye='dot', tall_eye=True, acc=dict(torso=hoodie(coat[0], coat[1], coat[2], lace)))
SPECS['student-02'] = student(SK_DK, 'short', ('ink', 'ink', 'wood-dark'), ('glow', 'ember', 'glow-core'), ('hill-mid', 'hill-near'), ('wall-lit', 'wall-mid'))
SPECS['student-03'] = student(SK_MD, 'long', ('wood-dark', 'ink', 'wood'), ('ok', 'leaf-lit', 'cloud-hi'), ('hill-near', 'ground'), ('wood-dark', 'ink'))
SPECS['student-04'] = student(SK_LT, 'bun', ('glow', 'ember', 'glow-core'), ('violet', 'wall-shade', 'cloud-hi'), ('hill-mid', 'hill-near'), ('cloud-hi', 'cloud-lo'))
SPECS['student-05'] = student(SK_MD, 'bob', ('roof-wine', 'roof-shade', 'alert'), ('cloud-hi', 'wall-mid', 'wall-lit'), ('wall-shade', 'hill-near'), ('wood-dark', 'ink'), 'alert')
SPECS['student-06'] = student(SK_LT, 'spiky', ('violet', 'wall-shade', 'cloud-hi'), ('sky-low', 'sky-mid', 'cloud-hi'), ('ground', 'ink'), ('alert', 'roof-shade'))

# ---------------------------------------------------------------- portraits: hooks keyed by name
PORT_OPTS = {
    'cubbie': dict(mouth='smile', hy=10), 'rival': dict(mouth='smirk', hy=9), 'expert-sage': dict(mouth='smile', hy=9), 'expert-monk': dict(mouth='flat', hy=9),
    'expert-mage': dict(mouth='smile', hy=11), 'student-02': dict(mouth='smile', hy=9), 'student-03': dict(mouth='smile', hy=9), 'student-04': dict(mouth='smile', hy=9),
    'student-05': dict(mouth='smirk', hy=9), 'student-06': dict(mouth='smile', hy=9),
}
def _port_acc(n, c, S, hy):
    coat = S['coat']
    if n == 'cubbie':
        c.R(13, 23, 18, 24, 'glow'); c.R(14, 25, 17, 25, 'ember')
    elif n == 'rival':
        c.R(8, 23, 23, 25, 'alert'); c.R(8, 25, 23, 25, 'roof-wine'); c.R(9, 26, 12, 29, 'alert')
    elif n == 'expert-sage':
        c.R(13, 23, 18, 24, 'cloud-hi')
    elif n == 'expert-monk':
        c.R(12, 24, 19, 25, 'glow')
    elif n == 'expert-mage':
        c.R(10, 26, 21, 27, 'cloud-hi'); c.R(14, 28, 17, 29, 'glow')
    elif n.startswith('student-'):
        c.R(12, 23, 19, 24, coat[1]); c.P(13, 25, 'glow'); c.P(18, 25, 'glow')
def _port_head(n, c, hy):
    if n == 'cubbie':
        c.R(8, hy - 5, 12, hy - 1, 'wood'); c.R(9, hy - 4, 11, hy - 2, 'wood-lit'); c.R(19, hy - 5, 23, hy - 1, 'wood'); c.R(20, hy - 4, 22, hy - 2, 'wood-lit')
        c.R(13, hy + 7, 18, hy + 11, 'skin-lt'); c.R(14, hy + 7, 17, hy + 8, 'skin-lt'); c.R(15, hy + 7, 16, hy + 8, 'ink'); c.R(14, hy + 10, 17, hy + 10, 'roof-shade')
    elif n == 'rival':
        c.R(9, hy - 3, 22, hy - 1, 'wood-dark'); c.R(11, hy - 3, 14, hy - 2, 'cloud-lo'); c.R(17, hy - 3, 20, hy - 2, 'cloud-lo'); c.R(12, hy - 3, 13, hy - 3, 'cloud-hi')
    elif n == 'expert-sage':
        c.R(10, hy + 8, 21, hy + 11, 'cloud-hi'); c.R(12, hy + 12, 19, hy + 13, 'cloud-hi'); c.R(14, hy + 9, 17, hy + 9, 'wall-mid')
    elif n == 'expert-mage':
        for y in range(hy - 12, hy - 1):
            w = 2 + (y - (hy - 12)) // 2; c.R(16 - w, y, 15 + w, y, 'violet')
        c.R(9, hy - 2, 22, hy - 1, 'violet'); c.R(11, hy - 4, 20, hy - 4, 'glow'); c.R(15, hy - 9, 16, hy - 8, 'glow-core')

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
    D.CAST.update(SPECS)
    PT.PORT_OPTS.update(PORT_OPTS)
    PT.acc_port, PT.head_acc = _wrap_acc, _wrap_head
    _installed = True
