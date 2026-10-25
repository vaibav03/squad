from props_draw import *

def envelope(w=16, h=12, seal=True, pin=False):
    im = new(w, h); rect(im, 0, 0, w - 1, h - 1, 'ink'); rect(im, 1, 1, w - 2, h - 2, 'wall-lit')
    rect(im, 1, h - 3, w - 2, h - 2, 'wall-mid')
    for i in range(1, w // 2):   # flap V
        yy = 1 + int(i * (h * .55) / (w / 2)); put(im, i, yy, 'wall-shade'); put(im, w - 1 - i, yy, 'wall-shade')
    if w >= 10 and seal: put(im, w // 2 - 1, 1 + int(h * .5), 'alert'); put(im, w // 2, 1 + int(h * .5), 'alert')
    if w >= 10 and seal: put(im, w // 2 - 1, int(h * .5), 'alert'); put(im, w // 2, int(h * .5), 'alert')
    if pin: put(im, w // 2 - 1, 0, 'alert'); put(im, w // 2, 0, 'alert')
    return im

def envelope_pop():
    fr = []
    for (w, h) in [(6, 5), (12, 9), (18, 14), (16, 12)]:
        e = envelope(w, h); c = new(18, 14); c.alpha_composite(e, ((18 - w) // 2, 14 - h)); fr.append(c)
    return fr

LK = dict(I='ink', G='glow', g='glow-core', E='ember', W='wall-mid', w='wall-lit', S='wall-shade')
def padlock(open_=False, col=None):
    if not open_:
        rows = ['..IIII..', '.I....I.', '.I....I.', 'IIIIIIII', 'IGgGGGEI', 'IGGIIGEI', 'IGGIIGEI', 'IIIIIIII']
    else:
        rows = ['.IIII...', 'I....I..', 'I....I..', 'IIIIIIII', 'IGgGGGEI', 'IGGIIGEI', 'IGGIIGEI', 'IIIIIIII']
    return art(rows, LK)

def ring(w, h, c='glow', c2='ember'):
    im = new(w, h); cx, cy = (w - 1) / 2, (h - 1) / 2
    for y in range(h):
        for x in range(w):
            d = math.hypot((x - cx) / (w / 2 - .3), (y - cy) / (h / 2 - .3))
            if .80 <= d <= 1.0: put(im, x, y, c)
            elif .66 <= d < .80 and dither(x, y, .5): put(im, x, y, c2)
    return im

def check(c='ok'):
    rows = ['..........II', '.........IcI', '........IccI', '.......IccI.', 'II....IccI..', 'IcI..IccI...', 'IccIIccI....', '.IccccI.....', '..IccI......', '...II.......']
    return art(rows, dict(I='ink', c=c), w=12).convert('RGBA')

def marker(ch):
    if ch == '!':
        rows = ['.IIII.', 'IaaaaI', 'IaAAaI', 'IaAAaI', 'IaAAaI', 'IaAAaI', '.IaAI.', '..II..', '.IaaI.', 'IaAAaI', 'IaAAaI', '.IIII.']
        rows = ['..IIII..', '.IaaaaI.', '.IaAAaI.', '.IaAAaI.', '.IaAAaI.', '.IaAAaI.', '.IaAAaI.', '..IaAI..', '..IIII..', '.IaaaaI.', '.IaAAaI.', '.IaAAaI.', '..IIII..']
        rows = rows + ['........']
        return art(rows, dict(I='ink', a='alert', A='roof-wine')) if False else art(['..IIII..', '.IaaaaI.', '.IaaaaI.', '.IaaaaI.', '.IaaaaI.', '.IaaaaI.', '.IaaaaI.', '..IaaI..', '..IIII..', '.IaaaaI.', '.IaaaaI.', '.IIIIII.', '........', '........'], dict(I='ink', a='alert'))
    rows = ['..IIII..', '.IggggI.', 'IgIIIIgI', 'IIIIIgGI', '....IgGI', '...IgGI.', '..IgGI..', '..IgGI..', '..IIII..', '.IggggI.', '.IggggI.', '.IIIIII.', '........', '........']
    return art(rows, dict(I='ink', g='glow', G='ember'))

def lantern(body, core, glass_hi, flick, accent='ink'):
    """10x16, hanging from top-center. flick 0..2 changes core size + glow pixels."""
    im = new(10, 16)
    put(im, 4, 0, 'ink'); put(im, 5, 0, 'ink'); put(im, 3, 1, 'ink'); put(im, 6, 1, 'ink'); hline(im, 3, 6, 2, 'ink')
    rect(im, 1, 3, 8, 3, 'ink'); rect(im, 2, 3, 7, 3, 'wood-dark')                    # cap
    rect(im, 0, 4, 9, 4, 'ink'); rect(im, 1, 4, 8, 4, 'wood')
    rect(im, 0, 5, 0, 12, 'ink'); rect(im, 9, 5, 9, 12, 'ink')
    rect(im, 1, 5, 8, 12, body)
    c = [(3, 6, 6, 11), (3, 7, 6, 10), (4, 7, 5, 11)][flick]
    rect(im, c[0], c[1], c[2], c[3], core)
    if flick != 1: put(im, 2, 6, glass_hi); put(im, 7, 6, glass_hi)
    put(im, 1, 5, glass_hi); put(im, 1, 12, 'ink')
    rect(im, 0, 13, 9, 13, 'ink'); rect(im, 1, 13, 8, 13, 'wood'); rect(im, 2, 14, 7, 14, 'ink'); put(im, 4, 15, 'ink'); put(im, 5, 15, 'ink')
    return im

def zzz():
    fr = []
    for f in range(3):
        im = new(14, 18)
        for k, (x, y, s) in enumerate([(1, 15, 3), (4, 10, 4), (8, 4, 5)]):
            if k > f: continue
            yy = y - (f - k)
            z = new(s + 2, s + 2)
            hline(z, 1, s, 1, 'ink'); hline(z, 1, s, s, 'ink'); line(z, s, 1, 1, s, 'ink')
            hline(z, 1, s, 1, 'cloud-hi'); hline(z, 1, s, s, 'cloud-hi'); line(z, s, 1, 1, s, 'cloud-hi')
            z = outline(z, 'ink') if False else z
            im.alpha_composite(z, (x, max(0, yy)))
        fr.append(im)
    return fr

def note(k):
    if k == 0:
        rows = ['...III..', '...IIII.', '...I.III', '...I..II', '...I....', '.III....', 'IvvI....', 'IvvI....', '.II.....']
    else:
        rows = ['...IIIIII', '...IggggI', '...I....I', '...I....I', '...I....I', '.III..III', 'IvvI.IvvI', 'IvvI.IvvI', '.II...II.']
    return art(rows, dict(I='ink', g='glow-core', v='violet'))

# ---- bubbles ----
def bubble9(fill='wall-lit', shade='wall-mid', n=5, size=24):
    im = new(size, size)
    rect(im, 0, 0, size - 1, size - 1, 'ink'); rect(im, 1, 1, size - 2, size - 2, fill)
    for (x, y) in ((0, 0), (size - 1, 0), (0, size - 1), (size - 1, size - 1)): put(im, x, y, None)
    for (x, y) in ((1, 1), (size - 2, 1), (1, size - 2), (size - 2, size - 2)): put(im, x, y, 'ink')
    for (x, y) in ((1, 0), (0, 1)): put(im, x, y, 'ink')
    for (x, y) in ((size - 2, 0), (size - 1, 1)): put(im, x, y, 'ink')
    for (x, y) in ((0, size - 2), (1, size - 1)): put(im, x, y, 'ink')
    for (x, y) in ((size - 1, size - 2), (size - 2, size - 1)): put(im, x, y, 'ink')
    # fix: corner pixels need rounder look: make (1,1) fill again, outline on diagonal
    for (x, y) in ((1, 1), (size - 2, 1), (1, size - 2), (size - 2, size - 2)): put(im, x, y, 'ink')
    for (x, y) in ((2, 2), (size - 3, 2), (2, size - 3), (size - 3, size - 3)): put(im, x, y, fill)
    # inner shade: bottom + right edge
    hline(im, 3, size - 4, size - 2, shade); vline(im, size - 2, 3, size - 4, shade)
    put(im, 2, size - 3, shade); put(im, size - 3, size - 3, shade)
    return im

def tail(side, fill='wall-lit'):
    rows = ['.FFFFFF.', 'IFFFFFI.', 'IFFFFI..', 'IFFI....', 'IFI.....', 'II......']
    t = art(rows, dict(I='ink', F=fill))
    return t if side == 'left' else flip(t)

def thought_dots(fill='wall-lit'):
    rows = ['..IIII..', '.IFFFFI.', '.IFFFFI.', '..IIII..', 'IIII....', 'IFFI....', 'IIII....', '.II.....', '.II.....']
    rows = ['IIII....', 'IFFI....', 'IFFI....', 'IIII....', '..II....', '..II....', '...II...', '....II..']
    big = ['..IIII..', '.IFFFFI.', '.IFFFFI.', '..IIII..']
    d = new(8, 11)
    d.alpha_composite(art(['.III..', 'IFFFI.', 'IFFFI.', '.III..'], dict(I='ink', F=fill)), (0, 0))
    d.alpha_composite(art(['III.', 'IFI.', 'III.'], dict(I='ink', F=fill)), (3, 5)) if False else None
    d.alpha_composite(art(['III', 'IFI', 'III'], dict(I='ink', F=fill)), (4, 5))
    d.alpha_composite(art(['II', 'II'], dict(I='ink')), (6, 9))
    return d

def withheld_bar(w=16, h=8):
    im = new(w, h); rect(im, 0, 0, w - 1, h - 1, 'ink')
    for x in range(0, w, 4):
        put(im, x, 1, 'sky-deep'); put(im, x + 2, h - 2, 'sky-deep')
    return im

# ---- notice board ----
SLOTS = [[x, y] for y in (15, 28) for x in (5, 23, 41)]
def board(lit=False):
    W, H = 64, 48; im = new(W, H)
    # backing board (frame) x3..60, y12..42
    rect(im, 3, 12, 60, 43, 'ink'); rect(im, 4, 13, 59, 42, 'wood-lit'); hline(im, 4, 59, 42, 'wood'); vline(im, 59, 13, 42, 'wood')
    # face x6..57 y14..41 (slots at 7..56)
    rect(im, 6, 14, 57, 41, 'wood')
    for y in (21, 28, 35): hline(im, 6, 57, y, 'wood-dark')
    hline(im, 6, 57, 14, 'wood-dark'); hline(im, 6, 57, 41, 'wood-dark')
    for (x, y) in [(10, 18), (31, 17), (50, 19), (18, 24), (40, 25), (54, 31), (12, 32), (28, 38), (46, 37), (36, 30)]: put(im, x, y, 'wood-lit'); put(im, x + 1, y, 'wood-lit')
    # posts (in front) x0..5 and 58..63, y4..47
    for px in (0, 58):
        rect(im, px, 5, px + 5, 47, 'ink'); rect(im, px + 1, 6, px + 4, 46, 'wood')
        vline(im, px + 1, 6, 46, 'wood-lit'); vline(im, px + 4, 6, 46, 'wood-dark')
        rect(im, px, 3, px + 5, 5, 'ink'); rect(im, px + 1, 4, px + 4, 5, 'wood-lit'); rect(im, px + 1, 5, px + 4, 5, 'wood')
        rect(im, px, 45, px + 5, 47, 'ink'); rect(im, px + 1, 45, px + 4, 46, 'wood-dark')
    # nails
    for (x, y) in ((4, 16), (4, 38), (59, 16), (59, 38)): pass
    # arm from left post for the lantern hook
    hline(im, 6, 15, 0, 'ink'); hline(im, 6, 15, 1, 'wood-lit') if False else None
    rect(im, 5, 0, 16, 1, 'ink'); rect(im, 6, 0, 15, 0, 'wood-lit'); rect(im, 6, 1, 15, 1, 'wood')
    rect(im, 0, 0, 5, 3, 'ink'); rect(im, 1, 1, 4, 3, 'wood-lit'); rect(im, 1, 3, 4, 3, 'wood'); rect(im, 5, 0, 16, 1, 'ink'); rect(im, 6, 0, 15, 0, 'wood-lit'); rect(im, 6, 1, 15, 1, 'wood')
    if lit:
        lan = lantern('glow', 'glow-core', 'cloud-hi', 0)
        im.alpha_composite(lan, (10, 2))
        for y in range(14, 42):
            for x in range(6, 58):
                d = math.hypot(x - 15, (y - 17) * 1.15)
                c = im.getpixel((x, y))[:3]
                if d < 9:
                    if c == RGB['wood']: put(im, x, y, 'wood-lit')
                    elif c == RGB['wood-dark']: put(im, x, y, 'wood')
                    elif c == RGB['wood-lit']: put(im, x, y, 'glow')
                elif d < 17:
                    if c == RGB['wood'] and dither(x, y, .5): put(im, x, y, 'wood-lit')
        rect(im, 6, 0, 15, 0, 'wood-lit')
    return im

def card(kind):
    im = new(16, 12); rect(im, 0, 0, 15, 11, 'ink'); rect(im, 1, 1, 14, 10, 'wall-lit'); hline(im, 1, 14, 10, 'wall-mid')
    if kind == 'shared':
        for (x, y) in ((2, 6), (3, 7), (4, 6), (5, 5), (6, 4)): put(im, x, y, 'ok')
        for (x, y) in ((2, 5), (3, 6)): put(im, x, y, 'ok')
        hline(im, 8, 13, 3, 'wall-shade'); hline(im, 8, 12, 5, 'wall-shade'); hline(im, 8, 13, 7, 'wall-shade')
    elif kind == 'hidden':
        small = art(['.III.', 'I...I', 'IGGGI', 'IGIGI', 'IGGGI'], dict(I='ink', G='glow'))
        im.alpha_composite(small, (2, 3)); rect(im, 8, 3, 13, 6, 'ink'); hline(im, 8, 12, 8, 'wall-shade')
    elif kind == 'blocked':
        ellipse(im, 4.5, 5.5, 3.6, 3.6, 'ink'); ellipse(im, 4.5, 5.5, 2.6, 2.6, 'alert'); hline(im, 3, 6, 5, 'wall-lit'); hline(im, 3, 6, 6, 'wall-lit')
        hline(im, 9, 13, 3, 'wall-shade'); hline(im, 9, 12, 5, 'wall-shade'); hline(im, 9, 13, 7, 'wall-shade')
    elif kind == 'pinned':
        im = envelope(16, 12, pin=True)
    return im

def door_sign():
    W, H = 32, 40
    def leaf(x0, x1, open_=False):
        pass
    cl = new(W, H)
    # arched frame
    ellipse(cl, 15.5, 13, 15.5, 13.5, 'ink'); rect(cl, 0, 13, 31, 39, 'ink')
    ellipse(cl, 15.5, 13, 14.5, 12.5, 'wood-dark'); rect(cl, 1, 13, 30, 39, 'wood-dark')
    # door leaf
    ellipse(cl, 15.5, 13.5, 12.5, 11.5, 'wood'); rect(cl, 3, 13, 28, 38, 'wood')
    for x in range(5, 28, 5): vline(cl, x, 4 if 8 < x < 24 else 9, 38, 'wood-dark')
    for (x, y) in [(6, 20), (11, 28), (17, 24), (22, 32), (8, 34)]: put(cl, x, y, 'wood-lit')
    # moon rim on left
    vline(cl, 3, 14, 38, 'wood-lit')
    # knob
    rect(cl, 23, 25, 24, 26, 'glow'); put(cl, 23, 25, 'glow-core')
    # suitcase plaque
    rect(cl, 10, 9, 21, 17, 'ink'); rect(cl, 11, 10, 20, 16, 'wall-lit')
    suit = art(['...III...', '..I...I..', '.IIIIIII.' if False else 'IIIIIIIII', 'IwwwwwwwI', 'IwGGGGGwI', 'IwwwwwwwI', 'IIIIIIIII'], dict(I='ink', w='wood-lit', G='glow'))
    suit = art(['...III...', '..I...I..', 'IIIIIIIII', 'IvvgvgvvI', 'IvvvvvvvI', 'IvvgvgvvI', 'IIIIIIIII'], dict(I='ink', v='wood-lit', g='glow'))
    cl.alpha_composite(suit, (11, 9))
    hline(cl, 0, 31, 39, 'ink')
    # step
    rect(cl, 0, 38, 31, 39, 'ground'); hline(cl, 0, 31, 39, 'ink')
    op = new(W, H)
    ellipse(op, 15.5, 13, 15.5, 13.5, 'ink'); rect(op, 0, 13, 31, 39, 'ink')
    ellipse(op, 15.5, 13, 14.5, 12.5, 'wood-dark'); rect(op, 1, 13, 30, 39, 'wood-dark')
    # warm interior
    ellipse(op, 15.5, 13.5, 12.5, 11.5, 'glow'); rect(op, 3, 13, 28, 38, 'glow')
    ellipse(op, 17, 16, 7, 7, 'glow-core'); rect(op, 10, 16, 24, 38, 'glow-core')
    for y in range(25, 38):
        for x in range(3, 29):
            if x < 10 or x > 24: 
                if dither(x, y, .5): put(op, x, y, 'glow')
    # floor shadow + door swung open (narrow leaf on left)
    for x in range(3, 8):
        for y in range(8 + (x - 3), 38): put(op, x, y, 'wood')
    vline(op, 3, 10, 38, 'ink'); vline(op, 7, 13, 38, 'ink'); vline(op, 5, 12, 37, 'wood-dark'); put(op, 6, 25, 'glow')
    # silhouette of small suitcase on floor
    rect(op, 17, 33, 22, 37, 'ink'); rect(op, 18, 34, 21, 36, 'wood-lit'); hline(op, 19, 20, 32, 'ink')
    rect(op, 0, 38, 31, 39, 'ground'); hline(op, 0, 31, 39, 'ink')
    return cl, op

def build_ui(sheetmeta):
    R = {}
    env = envelope(); write('ui/envelope.png', env, source='hand-pixeled', license='original', anchor='bottom-center')
    pop = envelope_pop(); write('ui/envelope-pop.png', strip(pop), source='hand-pixeled', license='original', frame=[18, 14], count=4, fps=22, anchor='bottom-center', note='180ms ease-out pop: sizes 6x5, 12x9, 18x14 overshoot, 16x12 final')
    R['env'] = [env] + pop
    pl = padlock(); pu = padlock(True); write('ui/padlock.png', pl, source='hand-pixeled', license='original'); write('ui/padlock-open.png', pu, source='hand-pixeled', license='original')
    rings = [ring(24, 12), ring(28, 14), ring(32, 16)]
    rs = [ ]
    for r in rings:
        c = new(32, 16); c.alpha_composite(r, ((32 - r.width) // 2, (16 - r.height) // 2)); rs.append(c)
    write('ui/door-ring.png', strip(rs), source='hand-pixeled', license='original', frame=[32, 16], count=3, anchor='center', note='3 sizes 24x12/28x14/32x16 centred in 32x16 frames; pulse by scale/alpha tween per motion row 10')
    write('ui/door-ring-ok.png', ring(24, 12, 'ok', 'ok'), source='hand-pixeled', license='original', note='ok-coloured ring')
    ck = check(); write('ui/check.png', ck, source='hand-pixeled', license='original')
    mk1, mk2 = marker('!'), marker('?'); write('ui/marker-alert.png', mk1, source='hand-pixeled', license='original', anchor='bottom-center'); write('ui/marker-question.png', mk2, source='hand-pixeled', license='original', anchor='bottom-center')
    lan = {}
    for nm, body, core, hi in (('council', 'violet', 'cloud-hi', 'wall-lit'), ('dissent', 'alert', 'glow-core', 'glow'), ('street', 'glow', 'glow-core', 'cloud-hi')):
        fr = [lantern(body, core, hi, f) for f in range(3)]; lan[nm] = fr
        write(f'ui/lantern-{nm}.png', strip(fr), source='hand-pixeled', license='original', frame=[10, 16], count=3, fps=6 if nm != 'street' else 3, anchor='top-center (5,0)', note='3-frame flicker; hangs from the top')
    zz = zzz(); write('ui/zzz.png', strip(zz), source='hand-pixeled', license='original', frame=[14, 18], count=3, fps=2, anchor='bottom-left')
    nt = [note(0), note(1)]; write('ui/notes.png', strip(nt), source='hand-pixeled', license='original', frame=[9, 8], count=2, fps=3)
    # bubbles
    bub = {}
    for nm, fill, shade in (('wall', 'wall-lit', 'wall-mid'), ('moon', 'moon', 'glow-core')):
        b = bubble9(fill, shade); bub[nm] = b
        write(f'ui/bubble-{nm}.png', b, source='hand-pixeled', license='original', nineslice=dict(corner=5, size=[24, 24], stretch_center=[5, 5, 14, 14]))
        tl, tr = tail('left', fill), tail('right', fill)
        write(f'ui/bubble-{nm}-tail-left.png', tl, source='hand-pixeled', license='original', anchor='top-left', note='top row overlaps the bubble bottom border; x offset from bubble left >= 6')
        write(f'ui/bubble-{nm}-tail-right.png', tr, source='hand-pixeled', license='original', anchor='top-right', note='mirror of left; top row overlaps bottom border')
        td = thought_dots(fill); write(f'ui/thought-{nm}-dots.png', td, source='hand-pixeled', license='original', anchor='top-left', note='2 trailing dots; place below the bubble bottom border')
        bub[nm + 't'] = (tl, tr, td)
    wb = withheld_bar(); write('ui/withheld-bar.png', wb, source='hand-pixeled', license='original', nineslice=dict(corner=2, size=[16, 8]), note='static black bar; stretch horizontally; never animated')
    bd, bl = board(False), board(True)
    write('ui/notice-board.png', bd, source='hand-pixeled', license='original', anchor='bottom-center', slots=dict(size=[16, 12], origin_xy=SLOTS, face_rect=[4, 15, 56, 26], note='6 slots 3x2'))
    write('ui/notice-board-lit.png', bl, source='hand-pixeled', license='original', anchor='bottom-center', slots=dict(size=[16, 12], origin_xy=SLOTS, face_rect=[4, 15, 56, 26]))
    cards = {k: card(k) for k in ('shared', 'hidden', 'blocked', 'pinned')}
    for k, c in cards.items(): write(f'ui/card-{k}.png', c, source='hand-pixeled', license='original', note={'shared': 'green tick', 'hidden': 'padlock + black bar', 'blocked': 'red stop mark', 'pinned': 'pinned envelope'}[k])
    cl, op = door_sign(); write('ui/trip-door.png', strip([cl, op]), source='hand-pixeled', license='original', frame=[32, 40], count=2, anchor='bottom-center', note='frame 0 closed, 1 open')
    R.update(pl=pl, pu=pu, rings=rings, ck=ck, mk=[mk1, mk2], lan=lan, zz=zz, nt=nt, bub=bub, wb=wb, bd=bd, bl=bl, cards=cards, door=[cl, op], rs=rs)
    return R
