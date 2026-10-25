#!/usr/bin/env python3
"""Deterministic cast builder for the persona registry, on top of the design-foundation renderer.
Run: python3 packages/media/src/sprites/build/build_cast.py
Writes assets/sprites/<id>/{idle,walk,talk,sit,wave}.png strips, portrait*.png, frames.json, and the combined
cast.png + cast.json (Phaser atlas) + cast.meta.json. All pixels master-palette; no randomness, no timestamps."""
import os, sys, json
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ext_chars
from ext_chars import ROOT, FOUND
ext_chars.install()
from PIL import Image
from palette import RGB
import characters_data as D
from characters_poses import poses, render
import characters_portrait as PT

OUT = os.path.join(ROOT, 'assets/sprites')
CELL = 32
ANCHOR = dict(x=16, y=31)
SEQ = ['idle', 'walk', 'talk', 'sit', 'wave']
FPS = dict(idle=2, walk=8, talk=8, sit=2, wave=4)
# registry id -> (render spec name, display role). Specs named like a foundation character reuse its pixels.
ROSTER = [
    ('cubbie', 'cubbie', 'cubbie'), ('examiner', 'examiner', 'examiner'), ('dean', 'dean', 'dean'),
    ('expert-ada', 'expert', 'expert'), ('expert-sage', 'expert-sage', 'expert'), ('expert-monk', 'expert-monk', 'expert'), ('expert-mage', 'expert-mage', 'expert'),
    ('rival', 'rival', 'rival'),
    ('council-chill', 'council-chill', 'council'), ('council-grind', 'council-hard', 'council'), ('council-advisor', 'council-balance', 'council'),
    ('chairman', 'chairman', 'council'), ('feynman', 'freshman', 'feynman'),
    ('student-01', 'student', 'student'), ('student-02', 'student-02', 'student'), ('student-03', 'student-03', 'student'),
    ('student-04', 'student-04', 'student'), ('student-05', 'student-05', 'student'), ('student-06', 'student-06', 'student'),
    ('mediator', 'mediator', 'mediator'), ('ta', 'ta', 'ta'),
]
NAMES = {'cubbie': 'Cubbie', 'examiner': 'The Examiner', 'dean': 'The Dean', 'expert-ada': 'Prof. Ada', 'expert-sage': 'Sage', 'expert-monk': 'Brother Bit',
         'expert-mage': 'Mage Moda', 'rival': 'The Rival', 'council-chill': 'Chill', 'council-grind': 'Grind', 'council-advisor': 'Advisor', 'chairman': 'The Chairman',
         'feynman': 'Feynman Freshman', 'student-01': 'Student 1', 'student-02': 'Student 2', 'student-03': 'Student 3', 'student-04': 'Student 4',
         'student-05': 'Student 5', 'student-06': 'Student 6', 'mediator': 'The Mediator', 'ta': 'The TA'}
PAL = {v + (255,) for v in RGB.values()}

def to_img(cv):
    im = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0)); px = im.load()
    for (x, y), n in cv.p.items(): px[x, y] = RGB[n] + (255,)
    return im
def strip(frames):
    im = Image.new('RGBA', (CELL * len(frames), CELL), (0, 0, 0, 0))
    for i, f in enumerate(frames): im.alpha_composite(f, (CELL * i, 0))
    return im
def check(im, name):
    assert im.width % CELL == 0 and im.height % CELL == 0, name
    for p in im.getdata():
        assert p[3] in (0, 255), (name, 'alpha', p)
        if p[3]: assert p in PAL, (name, 'off palette', p)
def nonempty(f, name):
    n = sum(1 for p in f.getdata() if p[3]); assert n > 40, (name, 'empty frame'); bb = f.getbbox()
    assert bb[3] <= 32 and bb[2] <= 32, (name, 'out of cell')

def build_one(rid, spec):
    S = D.CAST[spec]; P = poses(S)
    frames = {k: [to_img(render(S, p)) for p in pl] for k, pl in P.items()}
    for k, fs in frames.items():
        for i, f in enumerate(fs): nonempty(f, f'{rid}/{k}/{i}')
        for a, b in zip(fs, fs[1:]): assert a.tobytes() != b.tobytes(), (rid, k, 'dead cycle')
    port = to_img(PT.portrait(spec))
    return frames, port

def main():
    os.makedirs(OUT, exist_ok=True)
    built = {rid: build_one(rid, spec) for rid, spec, _ in ROSTER}
    cols = sum(len(built[ROSTER[0][0]][0][k]) for k in SEQ) + 1
    atlas = Image.new('RGBA', (cols * CELL, len(ROSTER) * CELL), (0, 0, 0, 0)); jf = {}; anims = {}; meta = []
    for r, (rid, spec, role) in enumerate(ROSTER):
        frames, port = built[rid]; d = os.path.join(OUT, rid); os.makedirs(d, exist_ok=True)
        fj = {}; per_anims = {}; x = 0
        for k in SEQ:
            st = strip(frames[k]); check(st, rid + k); st.save(os.path.join(d, k + '.png'), optimize=True); names = []
            for i, f in enumerate(frames[k]):
                fn = f'{rid}/{k}/{i}'; atlas.alpha_composite(f, (x * CELL, r * CELL))
                jf[fn] = dict(frame=dict(x=x * CELL, y=r * CELL, w=CELL, h=CELL), rotated=False, trimmed=False, spriteSourceSize=dict(x=0, y=0, w=CELL, h=CELL), sourceSize=dict(w=CELL, h=CELL), pivot=dict(x=0.5, y=1.0))
                names.append(fn); x += 1
            per_anims[k] = dict(frames=names, frameRate=FPS[k], repeat=-1)
        check(port, rid + 'portrait'); port.save(os.path.join(d, 'portrait.png'), optimize=True)
        for s in (2, 3, 4): port.resize((CELL * s, CELL * s), Image.NEAREST).save(os.path.join(d, f'portrait@{s}x.png'), optimize=True)
        atlas.alpha_composite(port, (x * CELL, r * CELL))
        jf[f'{rid}/portrait'] = dict(frame=dict(x=x * CELL, y=r * CELL, w=CELL, h=CELL), rotated=False, trimmed=False, spriteSourceSize=dict(x=0, y=0, w=CELL, h=CELL), sourceSize=dict(w=CELL, h=CELL))
        # per-persona frames.json (strip-relative rects, stable key names '<anim>/<n>')
        sheet_x = 0; pf = {}; pa = {}
        for k in SEQ:
            pa[k] = dict(frames=[f'{k}/{i}' for i in range(len(frames[k]))], frameRate=FPS[k], repeat=-1)
            for i in range(len(frames[k])): pf[f'{k}/{i}'] = dict(strip=f'{k}.png', x=i * CELL, y=0, w=CELL, h=CELL)
        top = frames['idle'][0].getbbox()[1]
        json.dump(dict(version=2, id=rid, cell=dict(w=CELL, h=CELL), facing='right', anchors=dict(feet=ANCHOR, head=dict(x=16, y=top), bubble=dict(x=16, y=max(top - 3, 0))),
                       portrait='portrait.png', frames=pf, anims=pa), open(os.path.join(d, 'frames.json'), 'w'), indent=2)
        open(os.path.join(d, 'frames.json'), 'a').write('\n')
        anims[rid] = per_anims; meta.append(dict(id=rid, name=NAMES[rid], role=role, spec=spec, headTop=top))
    check(atlas, 'atlas'); atlas.save(os.path.join(OUT, 'cast.png'), optimize=True)
    json.dump(dict(frames=jf, animations=anims, meta=dict(app='squad media-art build_cast.py', image='cast.png', format='RGBA8888', size=dict(w=atlas.width, h=atlas.height), scale='1',
              anchor=ANCHOR, facing='right', note='engine flips for left; keys <id>/<anim>/<n>, anims idle walk talk sit wave, plus <id>/portrait')), open(os.path.join(OUT, 'cast.json'), 'w'), indent=1)
    json.dump(dict(version=2, cell=dict(w=CELL, h=CELL), anchor=ANCHOR, anims=FPS, personas=meta), open(os.path.join(OUT, 'cast.meta.json'), 'w'), indent=1)
    print('built', len(ROSTER), 'personas')
    import contact; contact.make(built, ROSTER, OUT)

if __name__ == '__main__': main()
