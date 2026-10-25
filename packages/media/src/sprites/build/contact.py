"""Contact sheets for review: still lineup, animation grid, portraits (all on master palette backgrounds)."""
import os
from PIL import Image, ImageDraw
from palette import RGB
def _bg(w, h, c): return Image.new('RGBA', (w, h), RGB[c] + (255,))
def make(built, ROSTER, OUT):
    cell = 32
    for scale in (2, 3):
        for theme, bg, fg in (('dark', 'sky-deep', 'cloud-hi'), ('light', 'wall-lit', 'ink')):
            cols = 7; rows = (len(ROSTER) + cols - 1) // cols; cw, ch = cell * scale * 2 + 20, cell * scale + 30
            im = _bg(cols * cw, rows * ch, bg); d = ImageDraw.Draw(im)
            for i, (rid, spec, role) in enumerate(ROSTER):
                x, y = (i % cols) * cw, (i // cols) * ch; fr, port = built[rid]
                d.text((x + 6, y + 4), rid, fill=RGB[fg]); im.alpha_composite(fr['idle'][0].resize((cell * scale,) * 2, Image.NEAREST), (x + 6, y + 18))
                im.alpha_composite(port.resize((cell * scale,) * 2, Image.NEAREST), (x + 10 + cell * scale, y + 18))
            im.save(os.path.join(OUT, f'_contact-cast-{scale}x-{theme}.png'))
    # animation grid at 3x: walk(4) talk(2) sit(2) wave(2) per persona
    s = 3; per = 4 + 2 + 2 + 2; im = _bg(per * cell * s + 120, len(ROSTER) * (cell * s + 4), 'sky-deep'); d = ImageDraw.Draw(im)
    for r, (rid, spec, role) in enumerate(ROSTER):
        fr, port = built[rid]; x = 4; y = r * (cell * s + 4); d.text((4, y + 40), rid, fill=RGB['cloud-hi']); x = 110
        for k in ('walk', 'talk', 'sit', 'wave'):
            for f in fr[k]: im.alpha_composite(f.resize((cell * s,) * 2, Image.NEAREST), (x, y)); x += cell * s
    im.save(os.path.join(OUT, '_contact-anims.png'))
