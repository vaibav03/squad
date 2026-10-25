"""Landmarks composed from Autumn Town parts + hand-pixeled additions. Each fn(lit) -> (Image, meta)."""
import math
from buildings_kit import *

def council_hall(lit=True):
    c = Cv(176, 124); cx = 88; G = 120
    steps(c, 20, 156, G, n=2, h=3)
    # body & columns
    wall(c, 30, 62, 146, G - 6, tone='pale', split=.6, fleck=False)
    bricks(c, 30, 100, 146, G - 6)       # plinth course
    # back wall dark between columns
    for y in range(64, 101):
        for x in range(33, 144): c.p(x, y, 'wall-shade' if x < 100 else 'hill-mid')
    for ccx in (33, 55, 77, 99, 121, 143):
        pass
    # windows in bays
    for bx in (44, 66, 110, 132):
        window(c, bx - 4, 78, 9, 16, lit, arched=True)
    # door
    door(c, cx - 7, 70, 14, 30, lit, arched=True)
    # frame the door with a lit step glow
    for k in range(3): c.hline(cx - 9 + k, cx + 9 - k, 100 + k - 0, 'wall-lit' if k == 0 else 'wall-mid')
    for x in (33, 55, 77, 99, 121, 143): col(c, x - 2, 64, 108)
    # entablature
    c.rect(26, 56, 150, 62, 'wall-mid'); c.hline(26, 150, 56, 'wall-lit'); c.hline(26, 150, 62, 'wall-shade'); c.hline(26, 150, 60, 'violet')
    for x in range(30, 150, 6): c.p(x, 58, 'wall-shade')
    c.rect(27, 63, 149, 63, 'ink')
    # drum
    for y in range(34, 57):
        k = 0 if y > 38 else (39 - y) // 2
        for x in range(54 + k, 123 - k): c.p(x, y, 'wall-mid' if x < 96 else 'wall-shade')
        c.p(54 + k, y, 'wall-lit')
    c.hline(52, 124, 54, 'wall-lit'); c.hline(52, 124, 55, 'wall-shade')
    for wx in (65, 83, 101):
        c.rect(wx - 1, 40, wx + 5, 51, 'ink'); glow_rect(c, wx, 41, wx + 4, 50, lit, mull=False)
        if lit:
            for y in range(41, 51):
                for x in range(wx, wx + 5): c.p(x, y, 'cloud-hi' if y < 43 else 'violet' if y < 49 else 'wall-lit' if False else 'violet')
        c.hline(wx - 1, wx + 5, 52, 'wall-lit')
    # dome
    for y in range(12, 36):
        t = (36 - y) / 24.0; half = int(round(34 * math.sqrt(max(0, 1 - t * t))))
        for x in range(cx - half, cx + half + 1):
            c.p(x, y, 'roof-wine' if x < cx - 4 else 'roof-shade')
        c.p(cx - half, y, 'wood-lit' if y % 2 else 'roof-wine')
    for rx in (-24, -14, -6, 2, 12, 22):
        for y in range(16, 35):
            t = (36 - y) / 24.0; half = 34 * math.sqrt(max(0, 1 - t * t))
            x = int(round(cx + rx * half / 34.0))
            if abs(x - cx) < half - 1: c.p(x, y, 'roof-shade' if x < cx - 4 else 'ink')
    c.hline(cx - 35, cx + 35, 35, 'violet'); c.hline(cx - 35, cx + 35, 36, 'wall-shade')
    for x in range(cx - 33, cx + 34, 4): c.p(x, 35, 'cloud-hi')
    # cupola + magic orb
    c.rect(cx - 3, 6, cx + 3, 13, 'wall-mid'); c.rect(cx + 2, 6, cx + 3, 13, 'wall-shade'); c.hline(cx - 4, cx + 4, 6, 'wall-lit'); c.hline(cx - 4, cx + 4, 13, 'wall-shade')
    c.ellipse(cx, 4, 2, 2, 'violet'); c.p(cx - 1, 3, 'cloud-hi'); c.p(cx, 3, 'cloud-hi'); c.vline(cx, -1, 1, 'ink')
    # lanterns
    for lx in (66, 110, 44, 132): lantern(c, lx, 67, lit, 'violet', chain=3)
    for lx in (cx - 12, cx + 12): lantern(c, lx, 74, lit, 'violet', chain=0)
    c.outline('ink')
    if lit:
        halo(c, cx, 4, 6, 'violet')
    return c.im, dict(door=[cx - 7, 70, cx + 6, 99], note='council magic = violet')

def debate_stage(lit=True):
    D = load(TOWN_DAY); s = night_grade(largest_component(D.crop((11, 526, 208, 650))))
    W, H = s.size; PADT = 22
    c = Cv(W, H + PADT); c.paste(s, 0, PADT); G0 = PADT
    # moon rim along left edges of the structure
    # lecterns on the platform edge (platform band ~ y 95..104 of source)
    def lectern(x):
        y = PADT + 95
        c.rect(x, y - 24, x + 15, y, 'ink')
        c.rect(x + 1, y - 22, x + 14, y - 1, 'wood')
        c.rect(x + 1, y - 22, x + 1, y - 1, 'wood-lit')
        c.rect(x + 12, y - 22, x + 14, y - 1, 'wood-dark')
        # sloped desk top
        for i in range(18): c.p(x - 2 + i, y - 26 + (0 if i > 2 else 1), 'wood-lit')
        c.hline(x - 2, x + 17, y - 25, 'wood-lit'); c.hline(x - 2, x + 17, y - 24, 'ink')
        c.rect(x + 4, y - 18, x + 11, y - 14, 'wood-dark'); c.rect(x + 5, y - 17, x + 10, y - 15, 'ink')
        # mic + paper + lamp glow
        c.vline(x + 7, y - 33, y - 26, 'ink'); c.p(x + 7, y - 34, 'cloud-hi'); c.p(x + 6, y - 34, 'wall-mid')
        c.rect(x + 2, y - 27, x + 5, y - 26, 'cloud-hi')
    lectern(40); lectern(142)
    # violet vote lanterns hanging under the roof
    bunting(c, 38, 166, PADT + 31, sag=3, cols=('violet', 'glow', 'cloud-hi', 'ember'))
    for lx in (24, 172): lantern(c, lx, PADT + 36, lit, 'violet', chain=4)
    # banner on top
    c.rect(78, 2, 120, 16, 'ink'); c.rect(79, 3, 119, 15, 'roof-shade'); c.hline(79, 119, 3, 'violet')
    for k in range(5): c.p(88 + k * 7, 9, 'cloud-hi'); c.p(89 + k * 7, 9, 'cloud-hi')
    c.vline(82, 16, PADT + 5, 'wood-dark'); c.vline(116, 16, PADT + 5, 'wood-dark')
    c.outline('ink')
    return c.im, dict()

def round_table(lit=True):
    c = Cv(124, 96); G = 92
    # back wall (dim interior)
    for y in range(30, G - 6):
        for x in range(12, 112): c.p(x, y, 'sky-deep' if x % 25 else 'hill-near')
    # deck
    c.rect(4, G - 8, 119, G, 'wood'); c.hline(4, 119, G - 8, 'wood-lit'); c.hline(4, 119, G - 7, 'wood-lit'); c.hline(4, 119, G, 'wood-dark')
    for x in range(10, 119, 12): c.vline(x, G - 6, G - 1, 'wood-dark')
    # roof (hip)
    for y in range(8, 30):
        t = (y - 8) / 21.0; half = int(24 + 36 * t)
        for x in range(62 - half, 62 + half + 1): c.p(x, y, 'roof-wine' if x < 58 else 'roof-shade')
        c.p(62 - half, y, 'wood-lit')
        if y % 3 == 2:
            for x in range(62 - half + 2, 62 + half - 1, 2): c.p(x, y, 'roof-shade' if x < 58 else 'ink')
    c.hline(0, 124, 30, 'wood-dark'); c.hline(2, 122, 29, 'roof-shade')
    c.rect(10, 31, 113, 34, 'wood'); c.hline(10, 113, 31, 'wood-lit'); c.hline(10, 113, 34, 'wood-dark')
    c.rect(60, 2, 63, 8, 'wood-lit'); c.p(61, 0, 'violet'); c.p(61, 1, 'violet'); c.vline(62, 2, 7, 'wood-dark')
    # posts
    for px in (11, 38, 82, 108):
        c.rect(px, 34, px + 3, G - 8, 'wood'); c.vline(px, 34, G - 8, 'wood-lit'); c.vline(px + 3, 34, G - 8, 'wood-dark')
        c.rect(px - 1, G - 10, px + 4, G - 8, 'wood-dark'); 
    # wall map (framed)
    c.rect(44, 40, 79, 62, 'ink'); c.rect(45, 41, 78, 61, 'wood'); c.rect(46, 42, 77, 60, 'skin-lt')
    for (x, y) in ((50, 50), (51, 49), (52, 49), (53, 50), (54, 52), (55, 53), (56, 53), (60, 46), (61, 45), (62, 45), (63, 46), (64, 47), (66, 52), (67, 53), (68, 54), (69, 55), (70, 55)):
        c.p(x, y, 'hill-mid')
    c.hline(48, 56, 56, 'hill-far'); c.hline(66, 75, 48, 'hill-far')
    route = [(50, 56), (53, 54), (57, 52), (61, 50), (64, 48), (68, 47), (72, 49), (74, 52)]
    for (x, y) in route: c.p(x, y, 'alert')
    c.rect(49, 55, 51, 57, 'ok'); c.p(50, 56, 'ink'); c.rect(72, 51, 75, 53, 'violet'); c.p(73, 52, 'cloud-hi')
    c.hline(46, 77, 42, 'cloud-hi')
    # lantern + warm light
    lantern(c, 62, 40, lit, 'glow', chain=5)
    # table (seen from the side)
    cy = G - 28
    c.rect(59, cy + 4, 65, G - 8, 'wood-dark'); c.vline(59, cy + 4, G - 8, 'wood'); 
    c.rect(54, G - 10, 70, G - 8, 'wood-dark')
    c.ellipse(62, cy, 27, 3, 'wood-lit', outline='ink')
    c.rect(36, cy + 2, 88, cy + 4, 'wood'); c.hline(36, 88, cy + 4, 'wood-dark'); c.hline(36, 88, cy + 5, 'ink')
    # map on table
    for x in range(44, 81): c.p(x, cy - 1, 'skin-lt')
    for x in range(48, 78, 3): c.p(x, cy - 1, 'alert')
    c.rect(60, cy - 4, 62, cy - 2, 'violet'); c.p(61, cy - 4, 'cloud-hi')
    # three stools
    for sx in (20, 94):
        c.rect(sx, G - 20, sx + 10, G - 18, 'wood-lit'); c.hline(sx, sx + 10, G - 20, 'wood-lit'); c.hline(sx, sx + 10, G - 17, 'ink')
        c.vline(sx + 2, G - 17, G - 8, 'wood-dark'); c.vline(sx + 8, G - 17, G - 8, 'wood-dark')
    c.rect(52, G - 6, 72, G - 4, 'roof-wine'); c.hline(52, 72, G - 6, 'violet'); c.hline(50, 74, G - 3, 'ink')
    c.rect(54, G - 3, 56, G - 1, 'wood-dark'); c.rect(68, G - 3, 70, G - 1, 'wood-dark')
    bunting(c, 14, 108, 36, sag=2)
    c.outline('ink')
    if lit: lightwash(c, 62, 42, 22, {'sky-deep': 'hill-near', 'hill-near': 'hill-mid', 'wood': 'wood-lit', 'wood-lit': 'skin-lt'})
    return c.im, dict(seats=[[27, G - 20], [99, G - 20], [62, G - 6]])

def feynman_porch(lit=True):
    c = Cv(116, 100); G = 96
    # cottage body
    wall(c, 46, 42, 108, G, tone='plaster', split=.6)
    gable(c, 44, 110, 42, 14, over=3)
    c.rect(44, 40, 112, 44, 'wood-dark'); c.hline(44, 112, 40, 'wood')
    # round attic window
    c.ellipse(77, 30, 4, 4, 'ink'); c.ellipse(77, 30, 3, 3, 'wood-dark')
    for y in range(28, 33):
        for x in range(75, 80): c.p(x, y, 'glow-core' if (lit and y < 29) else 'glow' if lit else 'sky-deep')
    c.vline(77, 27, 33, 'wood-dark'); c.hline(74, 80, 30, 'wood-dark')
    window(c, 88, 54, 11, 15, lit)
    door(c, 62, 66, 13, 30, lit, arched=False)
    c.rect(60, 94, 77, 96, 'wood-lit'); c.hline(60, 77, 94, 'wood-lit')
    # chimney
    c.rect(95, 8, 101, 26, 'wall-shade'); c.rect(95, 8, 95, 26, 'wall-mid'); c.rect(100, 8, 101, 26, 'hill-mid'); c.hline(94, 102, 8, 'wall-lit'); c.hline(94, 102, 9, 'wall-mid')
    for y in range(12, 26, 3): c.hline(95, 101, y, 'wall-shade' if False else 'hill-mid')
    # porch deck + roof
    c.rect(4, G - 8, 50, G, 'wood'); c.hline(4, 50, G - 8, 'wood-lit'); c.hline(4, 50, G - 7, 'wood-lit'); c.hline(4, 50, G, 'wood-dark')
    for x in range(10, 50, 9): c.vline(x, G - 5, G - 1, 'wood-dark')
    c.rect(6, G - 4, 12, G, 'wood-dark')  # step
    steps(c, 0, 14, G, n=2, h=3) if False else None
    for px in (8, 44):
        c.rect(px, 48, px + 3, G - 8, 'wood'); c.vline(px, 48, G - 8, 'wood-lit'); c.vline(px + 3, 48, G - 8, 'wood-dark')
    shed_roof(c, 4, 52, 42, thick=7, over=2)
    c.rect(4, 49, 52, 51, 'wood-dark'); c.hline(4, 52, 49, 'wood')
    # rocking chair
    x = 18; y = G - 8
    c.rect(x, y - 20, x + 2, y - 8, 'wood-dark'); c.vline(x, y - 20, y - 8, 'wood-lit')
    c.rect(x, y - 9, x + 12, y - 7, 'wood'); c.hline(x, x + 12, y - 9, 'wood-lit')
    c.rect(x + 3, y - 12, x + 10, y - 10, 'roof-wine'); c.hline(x + 3, x + 10, y - 12, 'violet')
    c.vline(x + 12, y - 16, y - 9, 'wood-dark'); c.hline(x - 1, x + 14, y - 5, 'wood-dark'); c.hline(x - 1, x + 14, y - 4, 'ink')
    c.vline(x + 3, y - 6, y - 5, 'wood'); c.vline(x + 10, y - 6, y - 5, 'wood')
    # side table + lantern + book
    c.rect(34, y - 12, 41, y - 11, 'wood-lit'); c.vline(35, y - 10, y - 1, 'wood-dark'); c.vline(40, y - 10, y - 1, 'wood-dark')
    c.rect(36, y - 15, 39, y - 13, 'cloud-hi'); c.hline(36, 39, y - 14, 'wall-mid')
    lantern(c, 28, 56, lit, 'glow', chain=5)
    # "why?" speech tag over the porch: a small violet question sign
    c.rect(9, 20, 21, 31, 'ink'); c.rect(10, 21, 20, 30, 'wall-lit'); c.hline(10, 20, 30, 'wall-mid')
    for (x, y) in ((13, 23), (14, 22), (15, 22), (16, 22), (17, 23), (17, 24), (16, 25), (15, 26), (15, 27)): c.p(x, y, 'violet')
    c.p(15, 29, 'violet'); c.p(14, 31, 'ink'); c.p(13, 32, 'ink'); c.p(14, 32, 'ink')
    c.outline('ink')
    if lit: halo(c, 28, 60, 9, 'glow')
    return c.im, dict(sign_slot=[76, 44, 100, 51])

def panic_booth(glow=False):
    c = Cv(40, 62); ox = 8; G = 58
    # base plinth
    c.rect(ox, G - 3, ox + 23, G, 'wall-shade'); c.hline(ox, ox + 23, G - 3, 'wall-mid')
    # roof cap
    c.rect(ox - 1, 4, ox + 24, 6, 'roof-wine'); c.rect(ox + 1, 2, ox + 22, 3, 'roof-wine'); c.hline(ox + 3, ox + 20, 1, 'roof-wine'); c.hline(ox - 1, ox + 24, 6, 'roof-shade')
    c.hline(ox + 1, ox + 22, 2, 'alert'); c.hline(ox + 3, ox + 20, 1, 'alert')
    # sign
    c.rect(ox + 2, 7, ox + 21, 11, 'ink'); c.rect(ox + 3, 8, ox + 20, 10, 'glow' if glow else 'wall-shade')
    if glow:
        for x in range(ox + 4, ox + 20, 3): c.p(x, 9, 'glow-core')
    else:
        for x in range(ox + 4, ox + 20, 3): c.p(x, 9, 'hill-mid')
    # frame
    c.rect(ox, 12, ox + 23, G - 4, 'alert'); c.vline(ox + 23, 12, G - 4, 'roof-wine'); c.vline(ox + 22, 12, G - 4, 'roof-wine'); c.vline(ox, 12, G - 4, 'alert')
    c.vline(ox + 1, 12, G - 4, 'ember') if False else None
    # panes: 2 cols x 3 rows
    pane_y = [13, 25, 37]
    for yi, py in enumerate(pane_y):
        for px in (ox + 2, ox + 12):
            hh = 9
            for y in range(py, py + hh):
                for x in range(px, px + 8):
                    t = (y - py) / hh
                    if glow: c.p(x, y, 'glow-core' if t < .25 else 'glow' if t < .85 else 'ember')
                    else: c.p(x, y, 'sky-mid' if t < .2 else 'sky-deep')
            if not glow: c.p(px + 1, py + 1, 'hill-far'); c.p(px + 2, py + 2, 'hill-far'); c.p(px + 5, py + 4, 'sky-mid')
    # phone silhouette inside (handset + body)
    px, py = ox + 4, 29
    c.rect(px, py, px + 3, py + 5, 'ink'); c.rect(px + 4, py - 1, px + 5, py + 2, 'ink') ; c.p(px + 2, py - 2, 'ink'); c.p(px + 3, py - 2, 'ink')
    for yy in range(G - 15, G - 4): pass
    c.rect(ox + 1, G - 9, ox + 22, G - 4, 'alert'); c.hline(ox + 1, ox + 22, G - 9, 'ember'); c.rect(ox + 12, G - 9, ox + 22, G - 4, 'roof-wine'); c.hline(ox + 12, ox + 22, G - 9, 'alert')
    c.outline('ink')
    if glow:
        halo(c, ox + 12, 30, 17, 'glow')
        for dx in range(-14, 15):
            if (dx % 2 == 0): c.p(ox + 12 + dx, G + 1, 'glow')
    return c.im, dict()

def oral_hut(lit=True):
    c = Cv(84, 84); G = 80; cx = 42
    wall(c, 12, 34, 72, G, tone='stone', split=.6, fleck=False)
    bricks(c, 12, 34, 72, G)
    gable(c, 10, 74, 34, 8, over=3)
    c.rect(9, 32, 75, 35, 'wood-dark'); c.hline(9, 75, 32, 'wood')
    # tiny barred window (left)
    c.rect(17, 44, 28, 58, 'ink'); glow_rect(c, 18, 45, 27, 57, lit, mull=False)
    for x in (20, 23, 26): c.vline(x, 45, 57, 'ink')
    c.hline(16, 29, 59, 'wall-lit')
    # open door: interior, single chair, examiner's desk-less
    x0, y0, w, h = 38, 42, 22, 38
    c.rect(x0 - 2, y0 - 2, x0 + w + 1, G, 'ink'); c.rect(x0 - 1, y0 - 1, x0 + w, G, 'wood-dark')
    for y in range(y0, G + 1):
        t = (y - y0) / (G - y0)
        for x in range(x0, x0 + w - 5):
            c.p(x, y, ('glow-core' if t < .1 else 'glow' if t < .6 else 'ember') if lit else ('hill-near' if t < .6 else 'ground'))
    # open door leaf swung inward (right side)
    for y in range(y0, G + 1): 
        for x in range(x0 + w - 5, x0 + w): c.p(x, y, 'wood' if x < x0 + w - 1 else 'wood-dark')
    c.vline(x0 + w - 5, y0, G, 'wood-lit'); c.p(x0 + w - 3, y0 + 18, 'wood-lit')
    # floor + chair silhouette (single chair)
    c.hline(x0, x0 + w - 6, G - 1, 'wood-dark'); c.hline(x0, x0 + w - 6, G, 'ink')
    chair(c, x0 + 4, G - 2, 'wood')
    # strict sign-plank above door
    c.rect(36, 30 - 0, 62, 30, 'ink')
    # lantern by the door
    lantern(c, 66, 52, lit, 'glow', chain=4)
    # step
    c.rect(33, G - 1, 66, G, 'wall-mid'); c.hline(33, 66, G - 1, 'wall-lit')
    # small chimney
    c.rect(56, 6, 62, 20, 'wall-shade'); c.vline(56, 6, 20, 'wall-mid'); c.vline(62, 6, 20, 'hill-mid'); c.hline(55, 63, 6, 'wall-lit'); c.hline(55, 63, 7, 'wall-mid')
    # strict plaque
    c.rect(30, 38, 36, 38, 'ink') if False else None
    c.rect(18, 36, 28, 40, 'ink'); c.rect(19, 37, 27, 39, 'wood-lit'); c.p(21, 38, 'wood-dark'); c.p(24, 38, 'wood-dark'); c.p(26, 38, 'wood-dark')
    c.outline('ink')
    if lit: halo(c, 48, 62, 14, 'glow')
    return c.im, dict(chair=[x0 + 8, G - 2])

def rubric_courthouse(lit=True):
    c = Cv(148, 112); G = 108; cx = 72
    steps(c, 12, 132, G, n=3, h=3)
    # body
    wall(c, 20, 52, 124, G - 9, tone='pale', split=.6, fleck=False)
    for y in range(54, G - 9):
        for x in range(24, 121): c.p(x, y, 'wall-shade' if x < 82 else 'hill-mid')
    for wx in (34, 52, 93, 111):
        window(c, wx - 4, 66, 9, 18, lit, arched=False)
    door(c, cx - 8, 66, 16, 33, lit, arched=False)
    # columns
    for x in (26, 46, 74 - 2 - 18, 74 + 16, 100, 118): pass
    for x in (25, 43, 62, 83, 102, 120): col(c, x - 2, 54, G - 11, w=5)
    # entablature + pediment
    c.rect(16, 46, 128, 52, 'wall-mid'); c.hline(16, 128, 46, 'wall-lit'); c.hline(16, 128, 52, 'wall-shade'); c.hline(16, 128, 50, 'wall-shade')
    for y in range(18, 46):
        t = (y - 18) / 27.0; half = int(58 * t) + 1
        for x in range(cx - half, cx + half + 1): c.p(x, y, 'wall-mid' if x < cx + 6 else 'wall-shade')
        c.p(cx - half, y, 'wall-lit'); c.p(cx + half, y, 'ink')
        c.p(cx - half + 1, y, 'wall-lit') if y > 22 else None
    # inner tympanum
    for y in range(24, 44):
        t = (y - 24) / 20.0; half = int(46 * t) + 1
        for x in range(cx - half, cx + half + 1): c.p(x, y, 'wall-shade' if x < cx + 6 else 'hill-mid')
    # scales of justice sign (glow)
    gold = 'glow' if lit else 'wall-lit'
    c.vline(cx, 27, 41, gold); c.hline(cx - 14, cx + 14, 29, gold); c.p(cx, 26, 'glow-core' if lit else 'wall-lit'); c.hline(cx - 5, cx + 5, 42, gold); c.hline(cx - 3, cx + 3, 41, gold)
    for sx in (cx - 14, cx + 14):
        c.line(sx, 30, sx - 5, 37, 'wall-lit'); c.line(sx, 30, sx + 5, 37, 'wall-lit')
        c.hline(sx - 6, sx + 6, 38, gold); c.hline(sx - 5, sx + 5, 39, gold); c.hline(sx - 4, sx + 4, 40, 'ember' if lit else 'wall-mid')
    c.hline(cx - 59, cx + 59, 45, 'wall-lit')
    c.hline(cx - 59, cx + 59, 46, 'ink') if False else None
    # lanterns
    for lx in (cx - 20, cx + 20): lantern(c, lx, 56, lit, 'glow', chain=2)
    # acroterion
    c.rect(cx - 2, 14, cx + 2, 18, 'wall-mid'); c.p(cx, 12, 'violet'); c.p(cx, 13, 'violet')
    c.outline('ink')
    return c.im, dict(door=[cx - 8, 66, cx + 7, 98])

def exam_oracle(lit=True):
    c = Cv(84, 132); G = 128; cx = 42
    # base
    steps(c, 12, 72, G, n=2, h=3)
    # tower: slightly tapered
    for y in range(52, G - 5):
        t = (y - 52) / (G - 57.0); half = int(15 + 5 * t)
        for x in range(cx - half, cx + half + 1): c.p(x, y, 'wall-shade' if x < cx + 4 else 'hill-mid')
        c.p(cx - half, y, 'wall-lit'); c.p(cx - half + 1, y, 'wall-mid')
        if (y - 52) % 12 == 11:
            c.hline(cx - half, cx + half, y, 'wall-mid'); c.hline(cx - half, cx + half, y + 1, 'ink')
    # stone texture
    for y in range(56, G - 8, 6):
        for x in range(cx - 18, cx + 18, 7):
            if (x * 3 + y) % 5 < 2: c.p(x, y, 'wall-mid' if x < cx + 4 else 'hill-near')
    # windows
    window(c, cx - 11, 66, 6, 10, lit, arched=True)
    window(c, cx + 6, 84, 6, 10, lit, arched=True)
    door(c, cx - 6, 108, 12, 20, lit, arched=True)
    # balcony ring below dome
    c.rect(cx - 21, 48, cx + 21, 52, 'wall-mid'); c.hline(cx - 21, cx + 21, 48, 'wall-lit'); c.hline(cx - 21, cx + 21, 52, 'wall-shade')
    for x in range(cx - 19, cx + 20, 4): c.vline(x, 45, 47, 'wall-shade')
    c.hline(cx - 20, cx + 20, 44, 'wall-mid')
    # observatory drum + dome
    for y in range(30, 44):
        for x in range(cx - 16, cx + 17): c.p(x, y, 'wall-mid' if x < cx + 4 else 'wall-shade')
        c.p(cx - 16, y, 'wall-lit')
    for y in range(8, 31):
        t = (30 - y) / 22.0; half = int(round(18 * math.sqrt(max(0, 1 - t * t))))
        for x in range(cx - half, cx + half + 1): c.p(x, y, 'roof-wine' if x < cx - 2 else 'roof-shade')
        c.p(cx - half, y, 'wood-lit' if y % 2 else 'roof-wine')
    # telescope slit (glowing violet/cloud-hi), cut across the dome
    for y in range(9, 30):
        for x in range(cx + 2, cx + 6): c.p(x, y, ('cloud-hi' if lit else 'sky-mid') if (y - 9) < 8 else ('violet' if lit else 'sky-deep'))
        c.p(cx + 1, y, 'ink'); c.p(cx + 6, y, 'ink')
    # telescope tube peeking out
    c.line(cx + 4, 22, cx + 16, 6, 'ink'); c.line(cx + 5, 22, cx + 17, 6, 'wood-lit'); c.line(cx + 6, 22, cx + 18, 6, 'wood'); c.line(cx + 7, 22, cx + 19, 6, 'ink')
    c.rect(cx + 17, 3, cx + 20, 5, 'wall-lit'); c.p(cx + 19, 3, 'cloud-hi' if lit else 'wall-mid')
    c.hline(cx - 18, cx + 18, 30, 'violet'); c.hline(cx - 18, cx + 18, 31, 'ink')
    for x in range(cx - 16, cx + 17, 4): c.p(x, 30, 'cloud-hi' if lit else 'wall-mid')
    # star + finial
    c.vline(cx - 6, 3, 8, 'wood-dark'); c.p(cx - 6, 2, 'violet'); c.p(cx - 7, 3, 'violet'); c.p(cx - 5, 3, 'violet')
    # lantern by door
    lantern(c, cx + 11, 112, lit, 'violet', chain=3)
    c.outline('ink')
    if lit: halo(c, cx + 4, 18, 14, 'violet')
    return c.im, dict(door=[cx - 6, 108, cx + 5, 127], slit=[cx + 2, 9, cx + 5, 29])

def devils_ta_cave(lit=True):
    F = load(FOREST_DAY)
    rock = largest_component(F.crop((305, 262, 440, 360)))
    rock = night_grade(rock); W, H = rock.size
    c = Cv(W + 24, H + 24); ox, oy = 12, 20; c.paste(rock, ox, oy); G = oy + H - 1
    # darken & cool the rock toward hill ramps
    mp = {'cloud-lo': 'wall-shade', 'hill-far': 'wall-shade'}
    for y in range(c.h):
        for x in range(c.w):
            n = c.name(x, y)
            if n in mp: c.p(x, y, mp[n])
    # cave mouth
    mx = ox + W // 2 - 6; my = G - 40
    for y in range(my, G + 1):
        t = (y - my) / 40.0
        half = int(round(17 * math.sqrt(min(1, max(0.0, (y - my + 8) / 20.0)))))
        half = min(half, 17)
        for x in range(mx + 6 - half, mx + 6 + half + 1): c.p(x, y, 'ink' if abs(x - (mx + 6)) > half - 4 else 'sky-deep')
    # chalkboard inside, on easel
    bx, by = mx - 6, G - 30
    c.rect(bx - 1, by - 1, bx + 17, by + 13, 'ink'); c.rect(bx, by, bx + 16, by + 12, 'wood-dark'); c.rect(bx + 1, by + 1, bx + 15, by + 11, 'leaf-dark')
    for x in range(bx + 3, bx + 12, 2): c.p(x, by + 3, 'cloud-hi')
    for x in range(bx + 3, bx + 9, 2): c.p(x, by + 5, 'cloud-hi')
    c.p(bx + 4, by + 8, 'cloud-hi'); c.p(bx + 5, by + 8, 'cloud-hi'); c.p(bx + 6, by + 8, 'cloud-hi')
    # the hidden mistake: red cross
    for k in range(4): c.p(bx + 10 + k, by + 6 + k, 'alert'); c.p(bx + 13 - k, by + 6 + k, 'alert')
    c.vline(bx + 3, by + 12, G, 'wood-dark'); c.vline(bx + 13, by + 12, G, 'wood-dark')
    c.hline(bx - 1, bx + 17, by + 13, 'wood')
    # red alert glints (eyes in the dark) + torch embers
    ex, ey = mx + 18, my + 14
    for (dx, dy) in ((0, 0), (7, 1)):
        c.rect(ex + dx, ey + dy, ex + dx + 2, ey + dy + 1, 'alert'); c.p(ex + dx + 1, ey + dy, 'glow-core') if lit else None
    c.p(mx + 2, my + 6, 'alert'); c.p(mx + 11, my + 4, 'alert') if lit else None
    # warning-ish torch at entrance
    c.vline(mx - 12, G - 14, G - 4, 'wood-dark'); c.rect(mx - 14, G - 18, mx - 11, G - 15, 'ember'); c.p(mx - 13, G - 19, 'glow'); c.p(mx - 13, G - 17, 'glow-core')
    c.vline(mx + 26, G - 14, G - 4, 'wood-dark'); c.rect(mx + 24, G - 18, mx + 27, G - 15, 'ember'); c.p(mx + 25, G - 19, 'glow'); c.p(mx + 25, G - 17, 'glow-core')
    # pennant sign "TA" crooked
    sy = next(y for y in range(c.h) if c.get(mx + 8, y)[3])
    c.rect(mx + 2, sy - 15, mx + 14, sy - 8, 'ink'); c.rect(mx + 3, sy - 14, mx + 13, sy - 9, 'roof-shade'); c.hline(mx + 3, mx + 13, sy - 14, 'alert')
    c.p(mx + 6, sy - 12, 'cloud-hi'); c.p(mx + 7, sy - 12, 'cloud-hi'); c.p(mx + 9, sy - 12, 'cloud-hi'); c.p(mx + 10, sy - 12, 'cloud-hi'); c.p(mx + 8, sy - 11, 'cloud-hi')
    c.vline(mx + 8, sy - 7, sy + 1, 'wood-dark')
    c.outline('ink')
    if lit: halo(c, ex + 3, ey, 10, 'alert')
    return c.im, dict(glints=[ex, ey])

def classroom_house(lit=True):
    c = Cv(132, 112); G = 108; cx = 66
    wall(c, 16, 46, 116, G, tone='plaster', split=.6)
    gable(c, 14, 118, 46, 18, over=3)
    c.rect(13, 44, 119, 48, 'wood-dark'); c.hline(13, 119, 44, 'wood')
    # bell cupola
    c.rect(cx - 6, 4, cx + 6, 16, 'wood-dark'); c.rect(cx - 5, 5, cx + 5, 15, 'sky-deep'); c.hline(cx - 7, cx + 7, 3, 'roof-wine'); c.hline(cx - 6, cx + 6, 2, 'roof-wine'); c.hline(cx - 4, cx + 4, 1, 'roof-wine')
    c.rect(cx - 2, 7, cx + 2, 12, 'glow'); c.p(cx - 1, 8, 'glow-core'); c.p(cx, 13, 'ink'); c.vline(cx, 4, 7, 'ink')
    # big chalkboard on facade
    bx, by = cx - 20, 54
    c.rect(bx - 2, by - 2, bx + 41, by + 25, 'ink'); c.rect(bx - 1, by - 1, bx + 40, by + 24, 'wood-lit'); c.rect(bx, by, bx + 39, by + 23, 'wood'); c.rect(bx + 1, by + 1, bx + 38, by + 22, 'leaf-dark')
    c.hline(bx + 1, bx + 38, by + 1, 'leaf-lit')
    for k, ln in enumerate((30, 24, 20)):
        for x in range(bx + 4, bx + 4 + ln, 3): c.p(x, by + 5 + k * 5, 'cloud-hi'); c.p(x + 1, by + 5 + k * 5, 'cloud-hi')
    for (x, y) in ((28, 16), (29, 17), (30, 18), (31, 17), (32, 16), (33, 15), (34, 14)): c.p(bx + x, by + y, 'ok')
    c.hline(bx, bx + 39, by + 23, 'wood-dark'); c.rect(bx + 4, by + 24, bx + 12, by + 24, 'cloud-hi')  # chalk tray
    # windows flank
    window(c, 24, 58, 12, 18, lit); window(c, 96, 58, 12, 18, lit)
    door(c, cx - 7, 82, 14, 26, lit, arched=False)
    c.rect(cx - 9, 106, cx + 9, 108, 'wood-lit')
    # chimney
    c.rect(98, 12, 105, 32, 'wall-shade'); c.vline(98, 12, 32, 'wall-mid'); c.vline(104, 12, 32, 'hill-mid'); c.hline(97, 106, 12, 'wall-lit'); c.hline(97, 106, 13, 'wall-mid')
    bunting(c, 20, 112, 47, sag=1)
    lantern(c, 46, 84, lit, 'glow', chain=4); lantern(c, 86, 84, lit, 'glow', chain=4)
    c.outline('ink')
    return c.im, dict(door=[cx - 7, 82, cx + 6, 107], chalkboard=[bx, by, bx + 39, by + 27])
