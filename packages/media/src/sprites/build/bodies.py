"""Procedural chibi body kit for the Squad cast. Everything is code-drawn from ASCII maps so the whole cast shares
one proportion, one outline and one lighting model. Coordinates are cell pixels (24x24); the figure is 12 px wide
(x 6..17, centre line between x=11 and x=12) and 15 px tall (y 9..23, feet on y=23).

FRONT maps are the LEFT half (6 chars, x = 6+i), mirrored to x = 17-i. SIDE maps are full 12-char rows (x = 6+i),
facing right. Codes: O ink | S skin  s skin-shade  b blush | K/H/h hair hi/base/shade | U/T/t top hi/base/shade |
D/d trim hi/dark | P/p pants base/shade | B shoes | E eye | M mouth | W white."""

HEAD_Y, TORSO_Y, LEG_Y, X0 = 9, 18, 21, 6

# ------------------------------------------------------------------ FRONT (left halves)
F_HEAD = ["..OOOO",
          ".OSSSS",
          "OSSSSS",
          "OSSSSS",
          "OSwESS",
          "OSSESS",
          "OSbSSS",
          ".OSSSS",
          "..OOOO"]
F_TORSO = {
 'std':  [".OTTTT", ".OtTTT", ".OStTT"],
}
F_LEG = {'down': ["..OPPO", "..OBBO", "..OOOO"],
         'up':   ["..OPPO", "..OOOO", "......"]}
F_ROBE = {'down': ["OTTTTT", "ODDDDD", "OOOBBO"],
          'up':   ["OTTTTT", "ODDDDD", "OOOOOO"]}
F_DETAIL = {   # drawn over torso rows b0..b2, left-half chars
 'plain':  None,
 'tie':    ["....DD", ".....D", ".....D"],
 'hoodie': [".OUUUU", "....D.", "....D."],
 'vest':   ["..DDDD", "..d...", "..d..."],
 'scarf':  [".ODDDD", ".ODDDD", "......"],
 'collar': ["..UDDD", "......", "......"],
 'apron':  ["......", "..d...", "..dDDD"],
 'stripe': ["......", "..DDDD", "......"],
 'cape':   [".UUUUU", ".OtTTT", "......"],
 'sash':   ["..tt..", "...DDD", "....DD"],
 'v':      ["..SDDD", "...SDD", "......"],
}

# ------------------------------------------------------------------ SIDE (full rows, facing right)
S_HEAD = ["..OOOOOOOO..",
          ".OSSSSSSSSO.",
          "OSSSSSSSSSSO",
          "OSSSSSSSSSSO",
          "OSSSSSSSESSO",
          "OSSSSsSSESSO",
          "OSSSSSSSSbSO",
          ".OSSSSSSSSO.",
          "..OOOOOOOO.."]
S_TORSO = ["..OTTTTTTO..", "..OTTTTTTO..", "..OTTTTTTO.."]
S_ARM   = ["...tt.", "...tt.", "...St."]          # 6 chars at x = 9+i, shifted by arm swing
S_LEGS = {
 'stand': ["...OPPPPO...", "...OBBBBBO..", "...OOOOOOO.."],
 'pass':  ["...OPPPPO...", "...OBBBBBO..", "...OOOOOOO.."],
 'contA': [".OppO..OPPO.", ".OBBO..OBBBO", ".OOOO..OOOOO"],
 'contB': [".OPPO..OppO.", ".OBBO..OBBBO", ".OOOO..OOOOO"],
}
S_ROBE = {
 'stand': [".OTTTTTTTTO.", ".ODDDDDDDDO.", ".OOOOOOOOBBO"],
 'pass':  [".OTTTTTTTTO.", ".ODDDDDDDDO.", ".OOOOOOOOBBO"],
 'contA': [".OTTTTTTTTO.", ".ODDDDDDDDO.", ".OOBBOOOOBBO"],
 'contB': [".OTTTTTTTTO.", ".ODDDDDDDDO.", ".OOOOBBOOBBO"],
}
S_DETAIL = {
 'plain':  None,
 'tie':    ["..........O.", ".........DD.", ".........D.."],
 'hoodie': ["..UUUU......", "............", "............"],
 'vest':   ["...d........", "...d........", "............"],
 'scarf':  ["..DDDDDDD...", "..DDDDDDD...", ".DD........."],
 'collar': ["..UUUUUU....", "............", "............"],
 'apron':  ["............", "............", "..dDDDDD...."],
 'stripe': ["............", "..DDDDDD....", "............"],
 'cape':   [".UUUUUUUUUU.", "............", "............"],
 'sash':   ["..tt........", "...DDDD.....", "....DDD....."],
 'v':      ["..........S.", ".........S..", "............"],
}

# ------------------------------------------------------------------ HAIR overlays: (top_row_offset, rows)
HAIR = {
 'none': dict(f=(0, []), r=(0, [])),
 'short': dict(
    f=(0, ["..OOOO", ".OHHKK", "OHHKHH", "OHHHHS", "OH....", "......"]),
    r=(0, ["..OOOOOOOO..", ".OHHKKHHHHO.", "OHHHHHHHHHHO", "OHHHHHHHHHHO", "OHHHHH......", "OHHH........", "OH.........."])),
 'bowl': dict(
    f=(0, ["..OOOO", ".OHHKK", "OHHKHH", "OHHHHH", "OHH...", "OH....", "OH...."]),
    r=(0, ["..OOOOOOOO..", ".OHHKKHHHHO.", "OHHHHHHHHHHO", "OHHHHHHHHHHO", "OHHHHHHH....", "OHHHHH......", "OHH........."])),
 'spiky': dict(
    f=(-2, ["..O.O.", ".OHOHO", ".OHHHH", "OHHKHH", "OHHHHH", "OHHHHS", "OH...."]),
    r=(-2, ["..O.O.O.O...", ".OHOHOHOHO..", ".OHHHHHHHHO.", "OHHHHHHHHHHO", "OHHHHHHHHHHO", "OHHHHHHH....", "OHHH........", "OH.........."])),
 'long': dict(
    f=(0, ["..OOOO", ".OHHKK", "OHHKHH", "OHHHHS", "OHH...", "OHH...", "OHH...", "OHH...", "OHH...", "OHHH..", ".OOH.."]),
    r=(0, ["..OOOOOOOO..", ".OHHKKHHHHO.", "OHHHHHHHHHHO", "OHHHHHHHHHHO", "OHHHHHH.....", "OHHHHH......", "OHHHHH......", "OHHHHH......", "OHHHHH......", ".OHHHH......", "..OOOO......"])),
 'bun': dict(
    f=(-3, ["....OO", "...OHH", "...OHH", "..OOOO", ".OHHKK", "OHHKHH", "OHHHHH", "OHHHHS", "OH....", "......"]),
    r=(-3, ["..OOO.......", ".OHHHO......", ".OHHHO......", "..OOOOOOOO..", ".OHHKKHHHHO.", "OHHHHHHHHHHO", "OHHHHHHHHHHO", "OHHHHH......", "OHHH........", "OH.........."])),
 'curly': dict(
    f=(-1, ["..OOOO", ".OHKHH", "OHHHHH", "OHKHHH", "OHHHHS", "OHH...", "OHH...", "OH...."]),
    r=(-1, ["..OOOOOOOO..", ".OHHKHHKHHO.", "OHHHHHHHHHHO", "OHKHHHHHHHHO", "OHHHHHHHHHHO", "OHHHHHH.....", "OHHHH.......", "OHH........."])),
 'ponytail': dict(
    f=(0, ["..OOOO", ".OHHKK", "OHHKHH", "OHHHHS", "OH....", "......"]),
    r=(0, ["..OOOOOOOO..", ".OHHKKHHHHO.", "OHHHHHHHHHHO", "OHHHHHHHHHHO", "OHHHHH......", "OHHH........", "OH.........."]),
    tail=True),
 'monk': dict(
    f=(0, ["......", "......", "......", "OH....", "OH....", "......"]),
    r=(0, ["............", "............", "............", "OHHHH.......", "OHHH........", "OH.........."])),
 'mohawk': dict(
    f=(-3, ["....OO", "...OHH", "..OHHH", ".OSHHH", "OSSHHH"]),
    r=(-3, ["....OOOO....", "...OHHHHO...", "..OHHHHHHO..", "..OHHKHHHO.."])),
}
PONY = ["O.....", "HO....", "HHO...", ".HHO..", "..OO.."]   # drawn behind the head on side view, x = 3+i from row 4


def paint(cv, rows, x, y, lg, mirror=False, only=None):
    """only: None | 'L' | 'R' (front half maps: paint just one side)."""
    for dy, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch == '.' or ch not in lg: continue
            c = lg[ch]
            if mirror:
                if only != 'R': cv[(x + i, y + dy)] = c
                if only != 'L': cv[(2 * X0 + 11 - (x + i), y + dy)] = c
            else:
                cv[(x + i, y + dy)] = c

def legend_for(spec):
    sk = spec['skin']; hr = spec['hair_c']; tp = spec['top_c']; tr = spec['trim_c']; pc = spec['pants_c']
    return {'O': 'ink', 'S': sk[0], 's': sk[1], 'b': sk[2], 'E': 'ink',
            'K': hr[0], 'H': hr[1], 'h': hr[2], 'U': tp[0], 'T': tp[1], 't': tp[2],
            'D': tr[0], 'd': tr[1], 'P': pc[0], 'p': pc[1], 'B': spec['shoes'], 'W': 'wall-lit', 'w': 'wall-lit', 'M': 'ink'}

def render_body(spec, d, pose):
    """Body + head + hair (no accessories, no mouth). Returns (cv, head_y). pose: dy, legs, arm, mouth."""
    cv = {}; lg = legend_for(spec); dy = pose.get('dy', 0) + spec.get('base_dy', 0)
    robe = spec['top'] == 'robe'; detail = spec.get('detail', 'plain'); hair = HAIR[spec['hair']]
    hy = HEAD_Y + dy
    if d == 'f':
        lm, rm = pose['legs']          # 'down'/'up' for left / right foot (viewer's left / right)
        tab = F_ROBE if robe else F_LEG
        paint(cv, tab[lm], X0, LEG_Y, lg, True, 'L'); paint(cv, tab[rm], X0, LEG_Y, lg, True, 'R')
        paint(cv, F_TORSO['std'], X0, TORSO_Y, lg, True)
        if detail != 'plain' and F_DETAIL[detail]: paint(cv, F_DETAIL[detail], X0, TORSO_Y, lg, True)
        if pose.get('arm') == 'up':      # viewer-right hand lifted beside the head
            cv[(15, TORSO_Y + 2)] = lg['t']; cv[(15, TORSO_Y + 1)] = lg['t']
            cv[(16, TORSO_Y + 1)] = lg['S']; cv[(16, TORSO_Y)] = lg['S']; cv[(16, TORSO_Y - 1)] = 'ink'; cv[(17, TORSO_Y)] = 'ink'; cv[(17, TORSO_Y + 1)] = 'ink'
            cv[(16, TORSO_Y + 2)] = 'ink'
        paint(cv, F_HEAD, X0, hy, lg, True)
        top, rows = hair['f']; paint(cv, rows, X0, hy + top, lg, True)
    else:
        tab = S_ROBE if robe else S_LEGS
        paint(cv, tab[pose['legs']], X0, LEG_Y, lg)
        if hair.get('tail'): paint(cv, PONY, X0 - 3, hy + 4, lg)
        paint(cv, S_TORSO, X0, TORSO_Y, lg)
        if detail != 'plain' and S_DETAIL[detail]: paint(cv, S_DETAIL[detail], X0, TORSO_Y, lg)
        sw = pose.get('arm', 0)
        ax = 9 + (sw if isinstance(sw, int) else 1); ay = TORSO_Y - (1 if sw == 'up' else 0)
        paint(cv, S_ARM, ax, ay, lg)
        paint(cv, S_HEAD, X0, hy, lg)
        top, rows = hair['r']; paint(cv, rows, X0, hy + top, lg)
    return cv, hy

def draw_mouth(cv, spec, d, hy, open_):
    sh = spec['skin'][1]
    if d == 'f':
        if open_:
            for x in (11, 12): cv[(x, hy + 6)] = 'ink'; cv[(x, hy + 7)] = 'alert'
        else:
            for x in (11, 12): cv[(x, hy + 6)] = sh
    else:
        if open_:
            cv[(15, hy + 6)] = 'ink'; cv[(16, hy + 6)] = 'ink'; cv[(16, hy + 7)] = 'alert'
        else:
            cv[(16, hy + 6)] = sh
