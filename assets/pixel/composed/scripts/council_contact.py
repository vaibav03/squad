#!/usr/bin/env python3
"""Contact sheets of every council-cast frame (reads the generated strips). Run after make_characters.py.
Writes docs/design/shots/castart/contact-bodies.png and contact-busts.png (4x, nearest)."""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from PIL import Image, ImageDraw
from palette import RGB
from characters_council import IDS, NAMES
ROOT = os.path.abspath(os.path.join(HERE, '..'))
OUT = os.path.abspath(os.path.join(HERE, '../../../../docs/design/shots/castart'))
S = 4; os.makedirs(OUT, exist_ok=True)
BG = RGB['sky-deep'] + (255,); INK = RGB['cloud-hi']
ANIMS = ('idle', 'talk', 'think', 'walk', 'sit', 'wave')
def strips(n):
    return {a: Image.open(os.path.join(ROOT, 'characters', n, a + '.png')) for a in ANIMS}
def bodies():
    cols = 4 + 4 + 4 + 4 + 2 + 2
    im = Image.new('RGBA', (cols * 32 * S + 110, len(IDS) * (32 * S + 20) + 24), BG); d = ImageDraw.Draw(im)
    x0 = 100
    for a_i, a in enumerate(ANIMS):
        pass
    for r, n in enumerate(IDS):
        y = 22 + r * (32 * S + 20); d.text((6, y + 60), NAMES[n], fill=INK); x = x0
        for a in ANIMS:
            st = strips(n)[a]
            if r == 0: d.text((x, 4), a, fill=INK)
            for i in range(st.width // 32):
                im.alpha_composite(st.crop((i * 32, 0, i * 32 + 32, 32)).resize((32 * S, 32 * S), 0), (x, y)); x += 32 * S
            x += 0
    im.save(os.path.join(OUT, 'contact-bodies.png'))
def busts():
    im = Image.new('RGBA', (12 * 32 * S + 110, len(IDS) * (32 * S + 8) + 24), BG); d = ImageDraw.Draw(im)
    for r, n in enumerate(IDS):
        y = 22 + r * (32 * S + 8); d.text((6, y + 60), NAMES[n], fill=INK)
        b = Image.open(os.path.join(ROOT, 'characters', n, 'bust.png'))
        for k in range(3):
            if r == 0: d.text((100 + k * 4 * 32 * S, 4), ('idle', 'talk', 'think')[k], fill=INK)
            for i in range(4):
                im.alpha_composite(b.crop((i * 32, k * 32, i * 32 + 32, k * 32 + 32)).resize((32 * S, 32 * S), 0), (100 + (k * 4 + i) * 32 * S, y))
    im.save(os.path.join(OUT, 'contact-busts.png'))
if __name__ == '__main__': bodies(); busts(); print('ok', OUT)
