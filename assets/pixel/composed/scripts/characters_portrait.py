"""32x32 head-and-shoulders portraits (front/three-quarter), native 1x, palette only. Opaque background tile with ink frame."""
from characters_side import Canvas, line
from characters_data import CAST

def hair_front(c, style, hy, cols, back=False):
    b, s, l = cols; l = l or b
    if style in ('short', 'slick', 'bob', 'long', 'bun', 'fluff', 'spiky'):
        if back:
            if style == 'long':
                c.R(8, hy + 2, 23, hy + 17, b); c.R(8, hy + 14, 10, hy + 17, s); c.R(21, hy + 14, 23, hy + 17, s)
            if style == 'bob':
                c.R(8, hy + 2, 23, hy + 10, b); c.R(8, hy + 9, 23, hy + 10, s)
            return
        c.R(9, hy - 1, 22, hy + 2, b); c.R(10, hy - 2, 21, hy - 2, b); c.R(12, hy - 3, 19, hy - 3, b)
        c.R(11, hy - 2, 15, hy - 2, l); c.R(9, hy + 2, 10, hy + 5, b); c.R(21, hy + 2, 22, hy + 5, b)
        c.R(9, hy + 2, 22, hy + 2, s) if style != 'fluff' else None
        if style == 'slick': c.R(9, hy + 2, 22, hy + 2, b); c.R(12, hy + 1, 22, hy + 1, l)
        if style in ('short', 'bob', 'long'):
            for x in (11, 12, 14, 15, 17, 19, 20): c.P(x, hy + 3, b)
            c.R(10, hy + 3, 12, hy + 3, b); c.R(18, hy + 3, 21, hy + 3, b); c.P(14, hy + 3, b); c.P(16, hy + 3, b)
        if style == 'bun': c.R(14, hy - 6, 17, hy - 4, b); c.R(14, hy - 6, 15, hy - 6, l); c.R(16, hy - 4, 17, hy - 4, s); c.R(12, hy - 3, 19, hy - 3, b)
        if style == 'fluff':
            for x in (10, 13, 16, 19): c.P(x, hy - 3, b)
            c.R(11, hy - 4, 12, hy - 4, b); c.R(17, hy - 4, 18, hy - 4, b); c.R(11, hy + 2, 20, hy + 3, b); c.R(9, hy + 3, 10, hy + 5, b); c.R(21, hy + 3, 22, hy + 5, b)
            for x in (11, 13, 15, 17, 19): c.P(x, hy + 4, b)
        if style == 'spiky':
            for x in (10, 13, 16, 19): c.R(x, hy - 5, x, hy - 3, b)
            c.R(14, hy - 4, 15, hy - 4, b); c.R(17, hy - 4, 18, hy - 4, b); c.R(11, hy - 3, 20, hy - 3, b); c.R(10, hy + 3, 13, hy + 3, b); c.R(18, hy + 3, 21, hy + 3, b)
    elif style == 'gray':
        if back: return
        c.R(11, hy - 1, 20, hy - 1, b); c.R(9, hy, 22, hy, b); c.R(9, hy + 1, 10, hy + 7, b); c.R(21, hy + 1, 22, hy + 7, b)
        c.R(12, hy - 1, 15, hy - 1, l); c.R(9, hy + 6, 10, hy + 7, s); c.R(21, hy + 6, 22, hy + 7, s)

def face(c, S, hy, mouth='smile', eyes=None, extras=None):
    sk, ssh = S['skin']
    c.R(10, hy, 21, hy + 12, sk)
    for (x, y) in ((10, hy), (21, hy), (10, hy + 12), (21, hy + 12), (11, hy + 12), (20, hy + 12)): c.p.pop((x, y), None)
    c.R(9, hy + 6, 9, hy + 8, sk); c.R(22, hy + 6, 22, hy + 8, sk); c.P(9, hy + 7, ssh); c.P(22, hy + 7, ssh)
    c.R(21, hy + 1, 21, hy + 10, ssh); c.R(12, hy + 12, 19, hy + 12, ssh); c.R(20, hy + 11, 20, hy + 11, ssh)
    e = S.get('eye', 'dot')
    ey = hy + 6
    def eye(x):
        if e == 'sleepy': c.R(x, ey + 1, x + 1, ey + 1, 'ink'); c.R(x, ey, x + 1, ey, ssh)
        elif e == 'wide' and S.get('skin') and S.get('big_eye'): pass
        else:
            c.R(x, ey, x + 1, ey + 1, 'ink'); c.P(x, ey, 'cloud-hi') if S.get('glint', True) else None
    eye(12); eye(18)
    br = S.get('brow')
    if br == 'stern':
        c.R(11, ey - 2, 14, ey - 2, 'ink'); c.R(17, ey - 2, 20, ey - 2, 'ink'); c.P(14, ey - 1, 'ink'); c.P(17, ey - 1, 'ink')
    elif br == 'sly':
        c.R(11, ey - 2, 14, ey - 2, 'ink'); c.R(18, ey - 3, 20, ey - 3, 'ink')
    c.R(15, hy + 8, 16, hy + 8, ssh)
    my = hy + 10
    if mouth == 'smile': c.R(14, my, 17, my, 'roof-shade'); c.P(13, my - 1, ssh); c.P(18, my - 1, ssh)
    elif mouth == 'flat': c.R(14, my, 17, my, ssh)
    elif mouth == 'smirk': c.R(14, my, 16, my, 'roof-shade'); c.P(17, my - 1, 'roof-shade'); c.P(18, my - 1, ssh)
    elif mouth == 'open': c.R(14, my, 17, my + 1, 'roof-shade'); c.R(15, my + 1, 16, my + 1, 'alert')
    if S.get('cheek'): c.P(11, hy + 9, S['cheek']); c.P(20, hy + 9, S['cheek'])

def body(c, S, top=23):
    coat, csh, chl = S['coat']; sk, ssh = S['skin']
    c.R(14, top - 2, 17, top + 1, sk); c.R(14, top - 1, 17, top - 1, ssh) if False else None
    rows = {0: (10, 21), 1: (7, 24), 2: (5, 26), 3: (4, 27)}
    for y in range(top, 32):
        x0, x1 = rows.get(y - top, (3, 28)); c.R(x0, y, x1, y, coat)
        c.P(x1, y, csh); c.P(x1 - 1, y, csh) if y > top + 1 else None; c.P(x0, y, chl or coat)
    c.R(13, top, 18, top, ssh)

def acc_port(n, c, S, hy):
    coat, csh, chl = S['coat']
    if n == 'student':
        # hood ring behind head & collar, drawstrings
        c.R(12, top0 := 23, 19, 24, 'roof-shade'); c.R(13, 25, 18, 26, 'roof-shade') if False else None
        c.R(14, 23, 17, 23, 'roof-shade'); c.P(13, 24, 'glow-core'); c.P(13, 25, 'glow'); c.P(18, 24, 'glow-core'); c.P(18, 25, 'glow')
        c.R(11, 25, 11, 31, 'roof-shade'); c.R(20, 25, 20, 31, 'roof-shade') if False else None
    elif n == 'dean':
        c.R(13, 23, 18, 25, 'cloud-hi'); c.R(15, 24, 16, 28, 'roof-wine'); c.P(15, 23, 'roof-shade'); c.P(10, 27, 'glow'); c.P(9, 27, 'glow-core')
        c.R(9, 26, 12, 31, 'wood') if False else None
        for y in range(25, 32): c.P(12, y, 'wood'); c.P(19, y, 'wood')
    elif n == 'expert':
        c.R(13, 23, 18, 24, 'cloud-hi'); c.R(14, 25, 17, 25, 'cloud-hi')
        for (x, y) in line(22, 24, 6, 31): c.P(x, y, 'wood-dark'); c.P(x, y + 1, 'wood')
        c.R(5, 28, 9, 31, 'wood-lit') if False else None
    elif n == 'council-chill':
        c.R(7, 23, 24, 26, 'violet'); c.R(7, 26, 24, 26, 'wall-shade'); c.R(9, 27, 13, 31, 'violet'); c.R(9, 30, 13, 31, 'wall-shade'); c.R(10, 24, 12, 24, 'cloud-hi')
        c.R(18, 24, 21, 24, 'cloud-hi')
    elif n == 'council-hard':
        c.R(13, 23, 18, 25, 'cloud-hi'); c.R(15, 25, 16, 30, 'alert'); c.R(15, 25, 16, 25, 'roof-wine'); c.P(15, 31, 'roof-wine')
        c.R(7, 26, 8, 27, 'alert'); c.R(23, 26, 24, 27, 'alert')
        for y in range(25, 32): c.P(12, y, 'ink'); c.P(19, y, 'ink')
    elif n == 'council-balance':
        for (x, y) in line(22, 24, 6, 31): c.P(x, y, 'ok'); c.P(x, y + 1, 'leaf-dark')
        c.R(13, 23, 18, 23, 'cloud-hi'); c.P(8, 26, 'glow')
    elif n == 'chairman':
        c.R(7, 23, 24, 25, 'violet'); c.R(7, 25, 24, 25, 'wall-shade'); c.R(14, 26, 17, 27, 'glow'); c.R(15, 26, 16, 26, 'glow-core')
        c.R(15, 28, 16, 31, 'violet')
    elif n == 'examiner':
        c.R(13, 23, 18, 25, 'wall-lit'); c.P(15, 24, 'wall-mid'); c.P(16, 24, 'wall-mid'); c.P(15, 25, 'wall-mid')
        c.R(7, 27, 9, 28, 'alert')
        c.R(22, 27, 28, 31, 'wood'); c.R(23, 28, 27, 31, 'wall-lit'); c.R(24, 27, 26, 27, 'glow'); c.R(24, 29, 26, 29, 'wall-mid')
    elif n == 'freshman':
        c.R(8, 26, 10, 31, 'roof-wine'); c.R(21, 26, 23, 31, 'roof-wine'); c.R(5, 26, 7, 31, 'ember'); c.R(24, 26, 26, 31, 'ember')
        c.R(13, 23, 18, 24, 'cloud-hi')
    elif n == 'mediator':
        for (x, y) in line(7, 24, 25, 31): c.P(x, y, 'wood-dark'); c.P(x, y + 1, 'wood')
        c.R(19, 28, 27, 31, 'wood'); c.R(19, 28, 27, 29, 'wood-lit'); c.R(21, 30, 25, 31, 'wall-lit'); c.P(23, 30, 'alert')
        c.R(13, 23, 18, 24, 'cloud-hi')
    elif n == 'ta':
        c.R(8, 23, 12, 26, 'ember'); c.R(8, 25, 11, 26, 'roof-wine'); c.R(19, 23, 23, 26, 'ember'); c.R(20, 25, 23, 26, 'roof-wine')
        c.P(14, 27, 'cloud-hi'); c.P(17, 27, 'cloud-hi'); c.P(14, 28, 'cloud-hi'); c.P(17, 28, 'cloud-hi')
        c.R(7, 23, 24, 24, 'wall-shade') if False else None

def head_acc(n, c, hy):
    if n == 'chairman':
        for y in range(hy - 11, hy - 1):
            x0, x1 = (13, 18) if y == hy - 11 else (11, 20)
            c.R(x0, y, x1, y, 'violet'); c.P(x1, y, 'wall-shade')
        c.R(13, hy - 11, 14, hy - 11, 'cloud-hi'); c.R(11, hy - 3, 20, hy - 3, 'glow'); c.R(15, hy - 7, 16, hy - 6, 'glow')
        c.R(9, hy - 1, 22, hy - 1, 'violet'); c.R(9, hy - 1, 22, hy - 1, 'violet'); c.R(20, hy - 1, 22, hy - 1, 'wall-shade')
    if n in ('examiner', 'mediator'):
        col, sh, hl = ('ground', 'ink', 'hill-near') if n == 'examiner' else ('wall-shade', 'sky-mid', 'wall-mid')
        c.R(9, hy - 2, 22, hy + 1, col); c.R(11, hy - 3, 20, hy - 3, col); c.R(11, hy - 3, 14, hy - 3, hl)
        c.R(9, hy + 1, 22, hy + 1, sh); c.R(8, hy + 1, 8, hy + 1, sh); c.R(23, hy + 1, 23, hy + 1, sh)
    if n == 'ta':
        c.R(9, hy - 4, 22, hy - 4, 'wall-shade') if False else None
        c.R(10, hy - 3, 21, hy - 3, 'wall-shade'); c.R(9, hy - 2, 9, hy + 5, 'wall-shade'); c.R(22, hy - 2, 22, hy + 5, 'wall-shade')
        c.R(7, hy + 4, 9, hy + 8, 'cloud-hi'); c.R(22, hy + 4, 24, hy + 8, 'cloud-hi'); c.R(7, hy + 8, 9, hy + 8, 'cloud-lo'); c.R(22, hy + 8, 24, hy + 8, 'cloud-lo')
    if n == 'student':
        c.R(9, hy - 1, 22, hy + 0, 'roof-wine'); c.R(8, hy + 1, 8, hy + 10, 'roof-wine'); c.R(23, hy + 1, 23, hy + 10, 'roof-shade')
        c.R(10, hy - 2, 21, hy - 2, 'roof-wine'); c.R(12, hy - 3, 19, hy - 3, 'roof-wine'); c.R(12, hy - 3, 15, hy - 3, 'alert')
        c.R(9, hy + 1, 22, hy + 1, 'roof-shade'); c.R(10, hy + 2, 21, hy + 3, 'wood'); c.R(10, hy + 3, 11, hy + 4, 'wood'); c.R(14, hy + 3, 16, hy + 3, 'wood-dark') ; c.R(12, hy + 3, 13, hy + 3, 'wood-dark'); c.P(16, hy + 4, 'wood'); c.R(20, hy + 3, 21, hy + 4, 'wood')
    if n == 'dean':
        c.R(10, hy + 5, 15, hy + 8, 'cloud-hi') if False else None
        for (x0, x1) in ((11, 14), (17, 20)): c.R(x0, hy + 5, x1, hy + 8, 'wood-dark'); c.R(x0 + 1, hy + 6, x1 - 1, hy + 7, 'cloud-hi')
        c.R(15, hy + 6, 16, hy + 6, 'wood-dark')
        c.P(13, hy + 7, 'ink'); c.P(18, hy + 7, 'ink')
        c.R(13, hy + 9, 18, hy + 9, 'wall-mid'); c.R(14, hy + 10, 17, hy + 10, 'wall-mid') if False else None
    if n == 'chairman':
        c.R(10, hy + 8, 21, hy + 11, 'cloud-hi'); c.R(12, hy + 12, 19, hy + 13, 'cloud-hi'); c.R(14, hy + 14, 17, hy + 14, 'wall-lit')
        c.R(10, hy + 8, 11, hy + 8, 'skin-lt'); c.R(20, hy + 8, 21, hy + 8, 'skin-lt'); c.R(13, hy + 9, 18, hy + 9, 'cloud-hi')
        c.R(14, hy + 10, 17, hy + 10, 'wall-mid'); c.R(15, hy + 8, 16, hy + 8, 'wall-lit')
    if n == 'council-balance':
        c.R(15, hy - 3, 16, hy - 2, 'ok'); c.P(16, hy - 3, 'ok')

PORT_OPTS = {
 'student': dict(mouth='smile', hy=9), 'dean': dict(mouth='flat', hy=9), 'expert': dict(mouth='smile', hy=9, glint=True),
 'council-chill': dict(mouth='smirk', hy=9), 'council-hard': dict(mouth='flat', hy=9), 'council-balance': dict(mouth='smile', hy=9),
 'chairman': dict(mouth='flat', hy=12), 'examiner': dict(mouth='flat', hy=10), 'freshman': dict(mouth='open', hy=10),
 'mediator': dict(mouth='smile', hy=10), 'ta': dict(mouth='smirk', hy=10),
}
def portrait(n, mouth=None):
    S = dict(CAST[n]); o = PORT_OPTS[n]; hy = o['hy']; c = Canvas()
    c.R(0, 0, 31, 31, 'sky-mid'); c.R(0, 20, 31, 31, 'sky-mid')
    for (x, y) in ((6, 5), (26, 8), (4, 14), (28, 3), (24, 17)): c.P(x, y, 'sky-low')
    c.R(1, 1, 30, 30, 'sky-mid')
    bg = dict(c.p)
    hair_front(c, S['hair_style'], hy, S['hair'], back=True)
    # shift body so that shoulders sit under chin
    body(c, S, top=min(24, hy + 14) if n != 'chairman' else 26)
    acc_port(n, c, S, hy) if n != 'chairman' else (c.__setattr__('p', c.p) or acc_port_shift(n, c, S, hy))
    face(c, S, hy, mouth or o['mouth'])
    hair_front(c, S['hair_style'], hy, S['hair'])
    head_acc(n, c, hy)
    # ink frame
    for i in range(32):
        for p in ((i, 0), (i, 31), (0, i), (31, i)): c.P(p[0], p[1], 'ink')
    for p in ((0, 0), (31, 0), (0, 31), (31, 31)): c.p.pop(p, None)
    return c
def acc_port_shift(n, c, S, hy):
    # chairman: body starts 2px lower
    pass
