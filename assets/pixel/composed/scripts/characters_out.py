import os, json
from PIL import Image, ImageDraw
from palette import RGB
ANIMS = {'idle': ('idle', 2, -1), 'walk': ('walk', 8, -1), 'talk': ('talk', 8, -1), 'sit': ('sit', 2, -1), 'wave': ('wave', 4, -1)}
SEQ = ['idle', 'walk', 'talk', 'sit', 'wave']
LABEL = {'student': 'student', 'dean': 'dean', 'expert': 'expert', 'council-chill': 'chill', 'council-hard': 'hard', 'council-balance': 'balance',
         'chairman': 'chairman', 'examiner': 'examiner', 'freshman': 'freshman', 'mediator': 'mediator', 'ta': 'ta'}
SCR = '/private/tmp/claude-501/-Users-vaibav/6a4226af-e5c0-4256-97da-e402049434bd/scratchpad/chars/'
def bg_tile(w, h, kind='night'):
    im = Image.new('RGBA', (w, h), RGB['sky-deep'] + (255,)); d = ImageDraw.Draw(im)
    bands = [('sky-deep', 0), ('sky-mid', .30), ('sky-low', .62)]
    for name, t in bands: d.rectangle([0, int(h * t), w, h], fill=RGB[name] + (255,))
    return im
def stars(im, seed=3):
    import random; r = random.Random(seed); px = im.load()
    for _ in range(im.width * im.height // 500):
        x, y = r.randrange(im.width), r.randrange(int(im.height * .5))
        px[x, y] = RGB['moon'] + (255,) if r.random() < .5 else RGB['cloud-hi'] + (255,)
def build(frames, ports, OUT, ROOT, meta):
    import make_characters as M
    from characters_data import ORDER
    atlas_frames = []; N = len(ORDER)
    cols = sum(len(frames[ORDER[0]][k]) for k in SEQ) + 1
    atlas = Image.new('RGBA', (cols * 32, N * 32), (0, 0, 0, 0)); jf = {}; anims = {}
    for r, n in enumerate(ORDER):
        d = os.path.join(OUT, n); os.makedirs(d, exist_ok=True)
        for k in SEQ: M.strip(frames[n][k]).save(os.path.join(d, k + '.png')); M.verify(M.strip(frames[n][k]), n + k)
        ports[n].save(os.path.join(d, 'portrait.png')); M.verify(ports[n], n + 'portrait')
        x = 0; anims[n] = {}
        for k in SEQ:
            names = []
            for i, f in enumerate(frames[n][k]):
                fn = f'{n}/{k}/{i}'; atlas.alpha_composite(f, (x * 32, r * 32))
                jf[fn] = dict(frame=dict(x=x * 32, y=r * 32, w=32, h=32), rotated=False, trimmed=False, spriteSourceSize=dict(x=0, y=0, w=32, h=32),
                              sourceSize=dict(w=32, h=32), pivot=dict(x=0.5, y=1.0))
                names.append(fn); x += 1
            fps = {'idle': 2, 'walk': 8, 'talk': 8, 'sit': 2, 'wave': 4}[k]
            anims[n][k] = dict(frames=names, frameRate=fps, repeat=-1)
        fn = f'{n}/portrait'; atlas.alpha_composite(ports[n], (x * 32, r * 32))
        jf[fn] = dict(frame=dict(x=x * 32, y=r * 32, w=32, h=32), rotated=False, trimmed=False, spriteSourceSize=dict(x=0, y=0, w=32, h=32), sourceSize=dict(w=32, h=32))
    M.verify(atlas, 'atlas'); atlas.save(os.path.join(OUT, 'atlas.png'))
    json.dump(dict(frames=jf, animations=anims, meta=dict(app='squad make_characters.py', image='atlas.png', format='RGBA8888', size=dict(w=atlas.width, h=atlas.height), scale='1',
              anchor=dict(x=16, y=31), facing='right', note='engine flips for left; Phaser: this.anims.create({key, frames: anims[..].frames.map(k=>({key:"characters",frame:k})), frameRate, repeat})')),
              open(os.path.join(OUT, 'atlas.json'), 'w'), indent=1)
    prov = dict(license_note='Characters are hand-pixeled/procedurally drawn for Squad Village (original art, palette-only). Proportions, outline weight and chibi head/body ratio studied from Autumn Town player/NPC sheets (assets/pixel/characters/autumn-town-*, see assets/pixel/LICENSES.md); no source pixels copied.',
                cell=[32, 32], anchor=dict(x=16, y=31), facing='right', walk=dict(frames=4, pattern='contact,passing,contact,passing', stride_px_per_frame=3, note='planted foot moves 3px/frame: set ground speed = 3*fps px/s (24 px/s @8fps) to avoid foot sliding'),
                animations=dict(idle=dict(frames=2, fps=2), walk=dict(frames=4, fps=8), talk=dict(frames=2, fps=8), sit=dict(frames=2, fps=2), wave=dict(frames=2, fps=4)),
                portrait=dict(size=[32, 32], note='opaque tile (sky-mid bg, ink frame), show at 2x/3x'), characters=meta)
    json.dump(prov, open(os.path.join(OUT, 'provenance.json'), 'w'), indent=1)
    contact(frames, ports, ROOT); preview(frames, ROOT)
def contact(frames, ports, ROOT):
    from characters_data import ORDER
    S = 3; N = len(ORDER)
    W = 32 * S * 6 + 40; 
    # lineup
    lw = N * 32 * 2 + 16
    im = Image.new('RGBA', (lw * 3 // 2 if False else 11 * 34 * 3 // 1 + 16, 0 + 1), (0, 0, 0, 0))
    rowh = 32 * S + 14
    H = 60 + (32 * S + 20) + N * rowh // 1 + 8
    W = max(11 * 33 * S // 1 + 16, (4 + 2 + 2 + 2 + 2 + 1) * 33 * 2 + 150)
    im = Image.new('RGBA', (W, H), RGB['sky-deep'] + (255,)); d = ImageDraw.Draw(im)
    # lineup on ground strip
    y0 = 6; gh = 32 * S
    d.rectangle([0, y0 + gh - 2 * S, W, y0 + gh + 14], fill=RGB['ground'] + (255,))
    d.rectangle([0, y0 + gh - 2 * S, W, y0 + gh - 2 * S + 2], fill=RGB['hill-near'] + (255,))
    for i, n in enumerate(ORDER):
        f = frames[n]['idle'][0].resize((32 * S, 32 * S), 0); im.alpha_composite(f, (8 + i * 33 * S, y0))
        d.text((10 + i * 33 * S, y0 + gh + 3), LABEL[n], fill=RGB['cloud-hi'])
    y = y0 + gh + 34
    for n in ORDER:
        x = 6
        d.text((x, y + 2), LABEL[n], fill=RGB['cloud-hi']); x = 70
        for k in ('walk', 'talk', 'sit', 'wave'):
            st = frames[n][k]; w = len(st)
            for f in st:
                im.alpha_composite(f.resize((64, 64), 0), (x, y - 14)); x += 64
            x += 10
        im.alpha_composite(ports[n].resize((64, 64), 0), (x, y - 14))
        y += 52
    im.crop((0, 0, W, y + 8)).save(os.path.join(ROOT, '_contact-characters.png'))
def preview(frames, ROOT):
    from characters_data import ORDER
    import random
    W, H = 400, 120; im = bg_tile(W, H); stars(im); d = ImageDraw.Draw(im); r = random.Random(5)
    # moon
    d.ellipse([340, 12, 356, 28], fill=RGB['moon'] + (255,)); d.ellipse([345, 9, 360, 24], fill=RGB['sky-deep'] + (255,))
    # hills
    for col, base, amp, ph in (('hill-far', 76, 8, 0), ('hill-mid', 84, 7, 2), ('hill-near', 92, 5, 5)):
        for x in range(W):
            import math
            yy = int(base + amp * math.sin(x / 38 + ph)); d.line([x, yy, x, H], fill=RGB[col] + (255,))
    # houses
    def house(x, w, h, wall, roof):
        gy = 100; d.rectangle([x, gy - h, x + w, gy], fill=RGB[wall] + (255,)); d.polygon([(x - 2, gy - h), (x + w // 2, gy - h - 12), (x + w + 2, gy - h)], fill=RGB[roof] + (255,))
        for wx in range(x + 4, x + w - 6, 12):
            d.rectangle([wx, gy - h + 8, wx + 6, gy - h + 16], fill=RGB[r.choice(['glow', 'glow', 'sky-mid'])] + (255,))
        d.rectangle([x + w // 2 - 3, gy - 12, x + w // 2 + 3, gy], fill=RGB['wood-dark'] + (255,))
    house(10, 70, 30, 'wall-shade', 'roof-wine'); house(300, 80, 34, 'wall-mid', 'roof-shade'); house(150, 60, 26, 'wall-shade', 'roof-wine')
    d.rectangle([0, 100, W, H], fill=RGB['ground'] + (255,)); d.rectangle([0, 100, W, 101], fill=RGB['hill-near'] + (255,))
    for x in range(0, W, 24): d.rectangle([x, 112, x + 10, 112], fill=RGB['hill-near'] + (255,))
    # lamp
    d.rectangle([228, 70, 229, 100], fill=RGB['wood-dark'] + (255,)); d.rectangle([225, 66, 232, 71], fill=RGB['glow'] + (255,)); d.rectangle([227, 67, 230, 69], fill=RGB['glow-core'] + (255,))
    xs = [6 + i * 35 for i in range(len(ORDER))]
    for i, n in enumerate(ORDER):
        k = 'walk' if i % 3 == 0 else 'idle'; f = frames[n][k][i % len(frames[n][k])]
        if i % 2 == 1: f = f.transpose(Image.FLIP_LEFT_RIGHT)
        im.alpha_composite(f, (xs[i], 100 - 31 + 4))
    im.resize((W * 3, H * 3), 0).save(os.path.join(ROOT, '_preview-cast.png'))
