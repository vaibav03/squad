"""Side-view (right-facing) 32x32 character renderer for Squad Village.
Proportions studied from the Autumn Town player/NPC sheets (chibi, big head, ~24px figure, 1px ink outline);
bodies are re-pixeled parametrically so every cast member has a clean 4-pose walk cycle (contact/passing/contact/passing)
and per-character silhouettes.  All colours are palette NAMES; resolved to RGB at export."""
CX = 16

class Canvas:
    def __init__(s): s.p = {}
    def P(s, x, y, c):
        if c and 0 <= x < 32 and 0 <= y < 32: s.p[(x, y)] = c
    def R(s, x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1): s.P(x, y, c)
    def has(s, x, y): return (x, y) in s.p
    def outline(s):
        add = {}
        for (x, y) in s.p:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                q = (x + dx, y + dy)
                if q not in s.p and 0 <= q[0] < 32 and 0 <= q[1] < 32: add[q] = 'ink'
        s.p.update(add)

def line(x0, y0, x1, y1):
    pts = []; dx = abs(x1 - x0); dy = -abs(y1 - y0); sx = 1 if x0 < x1 else -1; sy = 1 if y0 < y1 else -1; e = dx + dy
    while True:
        pts.append((x0, y0))
        if x0 == x1 and y0 == y1: break
        e2 = 2 * e
        if e2 >= dy: e += dy; x0 += sx
        if e2 <= dx: e += dx; y0 += sy
    return pts

HAIR = {  # ox=-2 : string idx0 == head-local x -2 ; (oy, rows)
 'short': (-1, ["...LHHHH", "..LHHHHHHH", "..HHHHHHHH", "..HHHHHHHh", "..HHH", "..HH"]),
 'slick': (-1, ["...LHHHH", "..LHHHHHHH", "..HHHHHHHH", "..HHHHHH", "..HHH", "..HH"]),
 'long': (-1, ["...LHHHH", "..LHHHHHHH", "..HHHHHHHH", ".HHHHHHHHh", ".HHHH", ".HHHH", ".HHH", ".HHh", ".hh"]),
 'bun': (-3, ["..hHHH", ".HHHHH", "..HHHHHH", "..LHHHHHHH", "..HHHHHHHH", "..HHHHHHHh", "..HHH", "..HH"]),
 'gray': (0, ["...LHHHHH", "..HHH", "..HHH", "..HH", "..H"]),
 'spiky': (-3, ["...H..H.H", "...HHHHHH", "..HHHHHHHH", "..LHHHHHHH", "..HHHHHHHH", "..HHHHHHhh", "..HHH", "..HH"]),
 'bob': (-1, ["...LHHHH", "..LHHHHHHH", "..HHHHHHHH", ".HHHHHHHHh", ".HHH", ".HHH", ".Hh"]),
 'fluff': (-2, ["...HH.HH", "..LHHHHHH", "..HHHHHHHH", "..HHHHHHHH", ".HHHHHHHHh", "..HHH", "..HH"]),
}
def paint_pattern(c, hx, hy, pat, cols):
    oy, rows = pat; base, shade, hl = cols
    m = {'H': base, 'h': shade, 'L': hl or base}
    for r, s in enumerate(rows):
        for i, ch in enumerate(s):
            if ch in m: c.P(hx + i - 2, hy + oy + r, m[ch])

def draw_side(S, pose):
    c = Canvas(); cx = CX
    LL, TH, TW, SK = S['LL'], S['TH'], S.get('TW', 6), S.get('SK', 1)
    sit = pose.get('sit'); bob = pose.get('bob', 0)
    hip = 31 - LL if not sit else 31 - max(4, LL - 3)
    top = hip - TH + bob
    hx, hy = cx - 3, top - 7
    if S.get('big_head'): pass
    skin, skin_sh = S['skin']; coat, coat_sh, coat_hl = S['coat']; pant, pant_sh = S['pants']; boot = S['boots']
    g = dict(fx=cx - 3 + TW - 1, cx=cx, top=top, hx=hx, hy=hy, hip=hip, bob=bob, sit=sit, pose=pose, LL=LL, TH=TH, TW=TW)
    acc = S.get('acc', {})
    def A(stage):
        f = acc.get(stage)
        if f: f(c, g)
    # --- far arm (behind torso)
    def arm(dx, dy, sx, sy, sleeve, sleeve_sh, hand=True, hand_col=None, via=None):
        pts = line(sx, sy, sx + dx, sy + dy) if not via else line(sx, sy, sx + via[0], sy + via[1])[:-1] + line(sx + via[0], sy + via[1], sx + dx, sy + dy)
        horiz = abs(dx) >= abs(dy)
        cells = set()
        for (x, y) in pts: cells.add((x, y)); cells.add((x, y + 1) if horiz else (x + 1, y))
        hand_cells = set()
        if hand:
            hx_, hy_ = pts[-1]; hand_cells = {(hx_, hy_), ((hx_, hy_ + 1) if horiz else (hx_ + 1, hy_))}
            if len(pts) > 2 and S.get('big_hand', True) is False: pass
        for (x, y) in sorted(cells, key=lambda q: (q[1], q[0])):
            col = sleeve_sh if ((x, y - 1) not in cells or (x - 1, y) not in cells) and (x, y) not in hand_cells else sleeve
            if (x, y) in hand_cells: col = hand_col or skin
            c.P(x, y, col)
        return pts[-1]
    AL = S.get('AL', 6)
    sx_f, sy_f = cx + 1, top + 1
    fa = pose.get('armF', (-1, AL - 1))
    if not (pose.get('hideF') or S.get('hideF')): arm(fa[0], fa[1], sx_f, sy_f, coat_sh, coat_sh, hand_col=skin_sh)
    A('back')
    # --- legs
    def leg(x0, dx, lift, col, bcol):
        L = LL - lift
        for r in range(L):
            t = r / max(L - 1, 1); xo = round(dx * t)
            c.R(x0 + xo, hip + r, x0 + xo + 1, hip + r, col)
        fy = hip + L - 1; fx = x0 + round(dx)
        c.R(fx, fy - 1, fx + 1, fy - 1, bcol); c.R(fx, fy, fx + 2, fy, bcol)
    if not sit:
        lf = pose.get('legF', (0, 0)); ln = pose.get('legN', (0, 0))
        leg(cx - 1, lf[0], lf[1], pant_sh, S['boots_sh']); leg(cx - 1, ln[0], ln[1], pant, boot)
    else:
        sh0 = hip + 2
        c.R(cx - 2, hip, cx + 4, hip + 1, pant)
        c.R(cx - 2, hip + 1, cx + 4, hip + 1, pant_sh)
        c.R(cx + 3, sh0, cx + 4, 30, pant)
        c.R(cx + 3, 29, cx + 4, 29, boot); c.R(cx + 3, 30, cx + 5, 30, boot)
        c.R(cx + 2, sh0, cx + 2, 28, pant_sh)
    # --- coat skirt / hem
    if SK > 1 or sit:
        ln_ = pose.get('legN', (0, 0)); lf_ = pose.get('legF', (0, 0)); fl = S.get('flare', 1)
        dxs = [ln_[0], lf_[0]]
        mx, mn = max(dxs), min(dxs)
        for i in range(SK):
            t = i / max(SK - 1, 1)
            l = cx - 3 - round(fl * t) + round(mn / 3 * t); rr = cx + 2 + round(fl * t) + round(mx / 3 * t)
            if sit: l = cx - 3; rr = cx + 2 + (3 if i < 2 else 0) + (1 if i >= 2 else 0)
            y = hip + i
            if sit and i >= 2: l = cx + 2; rr = cx + 5
            c.R(l, y, rr, y, coat); c.P(rr, y, coat_sh)
            if S.get('seam') and not sit: c.P(cx + 1, y, coat_sh)
            if i == SK - 1: c.R(l, y, rr, y, S.get('hem') or coat_sh)
    # --- torso
    tx0 = cx - 3
    c.R(tx0, top, tx0 + TW - 1, hip - 1, coat)
    c.R(tx0 + TW - 1, top, tx0 + TW - 1, hip - 1, coat_sh)
    c.R(tx0, hip - 1, tx0 + TW - 1, hip - 1, coat_sh)
    c.R(tx0, top, tx0 + 1, top, coat_hl or coat)
    if S.get('rim'): c.R(tx0, top, tx0, hip - 2, S['rim'])
    A('torso')
    # --- near arm
    na = pose.get('armN', (1, AL - 1))
    if S.get('armN_fixed') and not pose.get('gesture'): na = S['armN_fixed']
    if not pose.get('arm_front'):
        hand = arm(na[0], na[1], cx - 2, top + 1, coat, coat_sh, hand_col=S.get('hand_col'))
        g['hand'] = hand
        A('hand')
    # --- head
    c.R(hx, hy, hx + 7, hy + 7, skin)
    for (x, y) in ((0, 0), (7, 0), (0, 7), (7, 7)): c.p.pop((hx + x, hy + y), None)
    c.R(hx + 1, hy + 7, hx + 6, hy + 7, skin_sh); c.P(hx + 8, hy + 5, skin)  # chin shade + nose
    c.P(hx + 3, hy + 5, skin_sh)  # ear
    A('behind_head')
    # face
    eye = S.get('eye', 'dot'); ec = 'ink'
    mouth = pose.get('mouth', 'closed')
    if eye == 'dot': c.P(hx + 5, hy + 4, ec); c.P(hx + 5, hy + 3, ec) if S.get('tall_eye') else None
    elif eye == 'sleepy': c.R(hx + 5, hy + 4, hx + 6, hy + 4, ec)
    elif eye == 'wide': c.P(hx + 5, hy + 4, ec); c.P(hx + 5, hy + 5, ec) if S.get('tall_eye', True) else None
    if S.get('blink') and pose.get('blink'): c.R(hx + 5, hy + 4, hx + 6, hy + 4, ec)
    brow = S.get('brow')
    if brow == 'stern': c.R(hx + 5, hy + 3, hx + 7, hy + 3, 'ink')
    elif brow == 'sly': c.P(hx + 6, hy + 3, 'ink'); c.P(hx + 5, hy + 2, 'ink') if False else None
    if mouth == 'open': c.R(hx + 6, hy + 6, hx + 7, hy + 6, 'roof-shade'); c.P(hx + 7, hy + 6, 'ink') if False else None
    elif mouth == 'smile': c.R(hx + 5, hy + 6, hx + 6, hy + 6, skin_sh); c.P(hx + 7, hy + 5, skin_sh) if S.get('smirk') else None
    else: c.P(hx + 6, hy + 6, skin_sh)
    if S.get('cheek'): c.P(hx + 4, hy + 5, S['cheek'])
    # hair
    paint_pattern(c, hx, hy, HAIR[S['hair_style']], S['hair'])
    if pose.get('arm_front'):
        hand = arm(na[0], na[1], cx - 2, top + 1, coat, coat_sh, via=pose.get('via')); g['hand'] = hand
    A('head')
    A('front')
    c.outline()
    return c
