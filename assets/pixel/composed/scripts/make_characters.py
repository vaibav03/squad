#!/usr/bin/env python3
import os, sys, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from PIL import Image
from palette import RGB, PALETTE
from characters_data import CAST, ORDER
from characters_poses import poses, render
from characters_council import IDS as COUNCIL, council_poses, dots, bust_frames
ROOT = os.path.abspath(os.path.join(HERE, '..'))
OUT = os.path.join(ROOT, 'characters')
def to_img(cv, size=32):
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0)); px = im.load()
    for (x, y), n in cv.p.items(): px[x, y] = RGB[n] + (255,)
    return im
def strip(frames):
    im = Image.new('RGBA', (32 * len(frames), 32), (0, 0, 0, 0))
    for i, f in enumerate(frames): im.alpha_composite(f, (32 * i, 0))
    return im
def verify(im, name):
    pal = {v + (255,) for v in RGB.values()}
    for p in im.getdata():
        if p[3] == 0: continue
        assert p in pal, (name, p)
ROLES = {'student': 'player', 'dean': 'dean', 'expert': 'chapter expert', 'council-chill': 'council member (chill)', 'council-hard': 'council member (hard)',
         'council-balance': 'council member (balance)', 'chairman': 'chairman', 'examiner': 'examiner', 'freshman': 'freshman NPC', 'mediator': 'mediator', 'ta': 'teaching assistant', 'cast-chill': 'council cast: Chill', 'cast-grind': 'council cast: Grind', 'cast-advisor': 'council cast: Advisor', 'cast-chair': 'council cast: Chairman'}
def main():
    os.makedirs(OUT, exist_ok=True); frames = {}
    for n in ORDER:
        S = CAST[n]; frames[n] = {}
        if n in COUNCIL:
            for k, pl in council_poses(S).items():
                frames[n][k] = []
                for i, p in enumerate(pl):
                    cv = render(S, p)
                    if k == 'think': dots(cv, (1, 2, 3, 2)[i])
                    frames[n][k].append(to_img(cv))
        else:
            for k, pl in poses(S).items(): frames[n][k] = [to_img(render(S, p)) for p in pl]
    from characters_portrait import portrait
    busts = {n: {k: [to_img(f) for f in fs] for k, fs in bust_frames(n, CAST[n]).items()} for n in COUNCIL}
    ports = {n: busts[n]['idle'][0] if n in COUNCIL else to_img(portrait(n)) for n in ORDER}
    meta = {n: dict(skin=CAST[n]['skin'][0], hair=CAST[n]['hair'][0], outfit=CAST[n]['coat'][0], role=ROLES[n]) for n in ORDER}
    import characters_out; characters_out.build(frames, ports, OUT, ROOT, meta, busts)
if __name__ == '__main__': main()
