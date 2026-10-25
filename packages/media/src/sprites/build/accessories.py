"""Code-drawn accessory + prop overlays for the Squad cast.

An accessory is a pair of small ASCII maps, `f` (front) and `r` (side, facing right), in HEAD-LOCAL coordinates:
column 0 = cell x 6 (left edge of the 12 px head), row 0 = the head's top row *of that frame*, so every overlay tracks
walk bob, breathing and talk nods. (top, left) offset the map: hats use negative rows, `left=-1` lets a map overhang.
Colour letters: digits 1/2/3 = persona accent ramp (hi/base/shade, CAST `acc_c`); O ink, w wall-lit, m wall-mid,
n wall-shade, g glow, G glow-core, e ember, r alert, R roof-wine, Q roof-shade, v violet, k sky-deep, i ground,
h hill-near, l wood-lit, o wood, d wood-dark, c cloud-hi, C cloud-lo, f leaf-lit, F leaf-dark, y ok, s skin-lt.
'.' is transparent. Draw order per frame: head, hair, 'under' accessories, mouth, 'over' accessories, prop.
Props (clipboard, coffee, gavel, lantern) are hand-anchored (see PROPS)."""

LEG = {'O': 'ink', 'w': 'wall-lit', 'm': 'wall-mid', 'n': 'wall-shade', 'g': 'glow', 'G': 'glow-core', 'e': 'ember',
       'r': 'alert', 'R': 'roof-wine', 'Q': 'roof-shade', 'v': 'violet', 'k': 'sky-deep', 'i': 'ground', 'h': 'hill-near',
       'l': 'wood-lit', 'o': 'wood', 'd': 'wood-dark', 'c': 'cloud-hi', 'C': 'cloud-lo', 'f': 'leaf-lit', 'F': 'leaf-dark',
       'y': 'ok', 's': 'skin-lt', 'z': 'sky-low', 'x': 'hill-far'}

def A(f, r=None, top=0, left=0, rtop=None, rleft=None, layer='over', anim=False):
    return dict(f=(top, left, f), r=(top if rtop is None else rtop, left if rleft is None else rleft, f if r is None else r),
                layer=layer, anim=anim)

ACC = {
 # ---------------- bear (cubbie) ----------------
 'bear-ears': A(
    [".OOO....OOO.", "O212O..O212O", "O22OOOOOO22O"],
    [".OOO.OOO....", "O212O232O...", "O22OOOO22O.."], top=-2),
 'muzzle': A(
    ["............", "............", "............", "............", "............", "....lOOl....", "...llllll...", "....llll...."],
    ["............", "............", "............", "............", "............", ".........llOO", ".........lllO", "..........llO"], layer='under'),
 # ---------------- examiner ----------------
 'proctor-cap': A(
    ["..OOOOOOOO..", ".O11222222O.", "O2222gg2222O", "O3333333333O"],
    ["..OOOOOOOO...", ".O11222222O...", "O22222222222O.", "O333333333OOOO"], top=-2),
 'specs': A(
    ["............", "............", "..cmm..mmc..", "..m.m..m.m.", "..m.m..m.m.", "..mmm..mmm.."],
    ["............", "............", ".......cmm...", "...mmmmm.m...", ".......m.m...", ".......mmm..."], top=1),
 # ---------------- dean ----------------
 'mortarboard': A(
    [".OOOOOOOOOO.", "O1122222222O", ".OOO3333OOO.", "..O333333O.."],
    None, top=-3),
 'tassel': A(
    ["...........g", "...........g", "...........G"], ["g...........", "g...........", "G..........."], top=-2),
 # ---------------- scholars ----------------
 'owl-specs': A(
    ["..ggg..ggg..", ".gc.cggc.cg.", ".gc.cggc.cg.", "..ggg..ggg.."],
    ["......ggg...", "...ggggc.cg..", "......gc.cg..", "......ggg..."], top=3, rtop=3),
 'beard': A(
    [".mw.wwww.wm.", ".mwwwwwwwwm.", ".mwwwwwwwwm.", "..mwwwwwwm..", "..mwwwwwwm..", "...mwwwwm...", "....mwwm....", ".....mm....."],
    ["............", ".......wwww.", "......wwwwww", ".....mwwwwwm", ".....wwwwwwm", "......mwwwm.", ".......mwm..", "........m..."], top=5, layer='under'),
 'brows': A(["..mmm..mmm.."], ["........mmm."], top=3),
 # ---------------- mage ----------------
 'wizard-hat': A(
    ["....OOOO....", "...O1122O...", "...O1g22O...", "..O112222O..", "..O122222O..", ".O12222223O.", ".OggggggggO.", "O3333333333O"],
    None, top=-7),
 # ---------------- rival ----------------
 'goggles-fh': A(
    [".OOOOOOOOOO.", "OGGOddddOGGO", ".OOO....OOO."],
    ["......OOOOO.", "ddddddOGGGO.", "......OOOOO."], top=1),
 # ---------------- feynman ----------------
 'goggles-big': A(
    ["..ggg..ggg..", ".gCwCggCwCg.", ".gC.CggC.Cg.", ".gC.CggC.Cg.", ".gCCCggCCCg.", "..ggg..ggg.."],
    [".......ggg..", "......gCwCg.", "dddddd.C.Cg.", "......gC.Cg.", "......gCCCg.", ".......ggg.."], top=2),
 'prop-cap': A(
    ["....OOOO....", "...O1222O...", "..O122222O..", ".O22222222O.", "O3333333333O"],
    ["....OOOO....", "...O1222O...", "..O122222O..", ".O22222222O.", "O3333333333OO"], top=-3),
 'propeller': A(
    ["..OGGGGGGO..", "....OggO...."], None, top=-5, anim=True),
 # ---------------- council ----------------
 'headphones': A(
    ["...OOOOOOOO...", "..O22222222O..", ".OO2......2OO.", "OOO........OOO", "O12........21O", "O12........21O", "OOO........OOO"],
    ["...OOOOOOOO...", "..O22222222O..", ".O22........O.", "..O..........."], top=-2, left=-1),
 'headband': A(
    ["OOOOOOOOOOOO", "O2222222222O", "OOOOOOOOOOOO"], None, top=1),
 'headband-tail': A(
    ["............"], ["22..........", ".22.........", "2.2........."], top=2, rleft=-2),
 'monocle': A(
    ["............", "............", "........OOO.", ".......O.cO.", ".......OOO..", "........g...", "........g..."],
    ["............", "............", ".......OOO..", "......O.cO..", ".......OOO..", ".........g..", ".........g.."], top=3),
 'crown': A(
    ["..O..O..O...", ".O1O.O1O1O..", ".O1111111O..", ".O1r1g1r1O..", ".OOOOOOOOO.."], None, top=-4),
}

# ---------------------------------------------------------------- props
# (rows, ox, oy) relative to the hand pixel. front hand = (15, 20); side hand = (12 + swing, arm_y + 2).
PROPS = {   # 'S' = the holding hand (persona skin); drawn right of the arm
 'clipboard': dict(f=(["oooo.", "owwo.", "ommo.", "owwo.", "ommoS", "oooo."], 2, -4), r=(["oooo", "owwo", "ommo", "owwo", "ommo", "oooo"], 1, -4), hand=(4, 4)),
 'coffee':    dict(f=([".c...", ".c...", "OOOO.", "OwwOO", "OwwOS", "OOOO."], 2, -4), r=([".c..", ".c..", "OOOO", "OwwO", "OwwO", "OOOO"], 1, -4), anim=True),
 'gavel':     dict(f=(["OOOO.", "OooOS", "OOdO.", ".Od..", ".Od..", ".OO.."], 2, -4), r=(["OOOO", "OooO", "OOdO", ".Od.", ".Od.", ".OO."], 1, -4)),
 'lantern':   dict(f=([".OO..", ".dS..", "OggO.", "OGGO.", "OggO.", ".OO.."], 2, -3), r=([".OO.", ".d..", "OggO", "OGGO", "OggO", ".OO."], 1, -3), anim=True),
}

def _px(cv, rows, x, y, accent, skin='skin-lt'):
    for dy, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch == '.': continue
            if ch == 'S': c = skin
            elif ch in '123': c = accent[int(ch) - 1]
            else: c = LEG[ch]
            cv[(x + i, y + dy)] = c

def apply(cv, names, d, hy, layer, accent, idx=0, anim=''):
    for n in names:
        a = ACC.get(n)
        if not a or a['layer'] != layer: continue
        top, left, rows = a[d]
        if a['anim'] and idx % 2 == 1:
            rows = [r.replace('GGGGGG', 'gGGGGg') for r in rows] if n == 'propeller' else rows
        _px(cv, rows, 6 + left, hy + top, accent)

def apply_prop(cv, name, d, hand, idx=0, skin='skin-lt'):
    if not name: return
    p = PROPS[name]; rows, ox, oy = p[d]
    if p.get('anim') and idx % 2 == 1: rows = [r.replace('c', '.') if r.startswith('.c') else r for r in rows]; rows = rows[:]
    _px(cv, rows, hand[0] + ox, hand[1] + oy, ('white', 'white', 'white'), skin)
