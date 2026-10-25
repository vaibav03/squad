from characters_side import draw_side
def sc(S, a):
    k = S.get('arm_scale', 1.0); return (round(a[0] * k), a[1])
def poses(S):
    AL = S.get('AL', 6); d = AL - 1
    walk = [
      dict(bob=0, legN=(3, 0), legF=(-3, 0), armN=(-2, d), armF=(-1, d)),
      dict(bob=-1, legN=(0, 0), legF=(-1, 2), armN=(0, d), armF=(0, d)),
      dict(bob=0, legN=(-3, 0), legF=(3, 0), armN=(3, d), armF=(-3, d)),
      dict(bob=-1, legN=(-1, 2), legF=(0, 0), armN=(0, d), armF=(0, d)),
    ]
    for w in walk:
        w['armN'] = sc(S, w['armN']); w['armF'] = sc(S, w['armF'])
    base = dict(legN=(1, 0), legF=(-1, 0), armN=(1, d), armF=(-1, d))
    idle = [dict(base, bob=0), dict(base, bob=1, blink=False)]
    tk = [dict(base, bob=0, mouth='open', armN=(4, 1), gesture=True), dict(base, bob=0, mouth='closed', armN=(5, -1), gesture=True)]
    sit = [dict(sit=True, bob=0, armN=(2, d), armF=(2, d), mouth='closed'), dict(sit=True, bob=1, armN=(2, d), armF=(2, d), mouth='smile')]
    wave = [dict(base, bob=0, mouth='smile', armN=(8, -4), via=(5, 3), gesture=True, arm_front=True), dict(base, bob=0, mouth='smile', armN=(9, -2), via=(5, 3), gesture=True, arm_front=True)]
    return dict(walk=walk, idle=idle, talk=tk, sit=sit, wave=wave)
def render(S, pose):
    return draw_side(S, pose)
