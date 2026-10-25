#!/usr/bin/env python3
"""Deterministic synthetic fixtures for live:verify (original content, no copyrighted material).

Writes into scripts/live/fixtures/:
  stepdiff-a.png   handwritten-style solution of 2x + 6 = 14, correct
  stepdiff-b.png   same problem, first divergence at step 2 (14 + 6 instead of 14 - 6)
  scanned-page.pdf one image-only PDF page (no text layer) holding two original sentences

Run: pnpm live:images   (needs Pillow). Output is byte-stable for a given Pillow + font.
"""
import os
import random
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
os.makedirs(OUT, exist_ok=True)

FONTS = [
    "/System/Library/Fonts/Supplemental/Bradley Hand Bold.ttf",
    "/System/Library/Fonts/Noteworthy.ttc",
    "/System/Library/Fonts/Supplemental/Chalkboard.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def font(size):
    for p in FONTS:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                pass
    return ImageFont.load_default(size)


def solution(path, lines, seed):
    rnd = random.Random(seed)
    img = Image.new("RGB", (900, 120 + 130 * len(lines)), (250, 248, 240))
    d = ImageDraw.Draw(img)
    for y in range(60, img.height, 44):  # faint ruled paper
        d.line([(0, y), (img.width, y)], fill=(215, 225, 240), width=1)
    d.text((40, 24), "Solve: 2x + 6 = 14", font=font(40), fill=(30, 30, 90))
    f = font(54)
    for i, text in enumerate(lines):
        tile = Image.new("RGBA", (820, 90), (0, 0, 0, 0))
        ImageDraw.Draw(tile).text((10, 10), f"{i + 1})  {text}", font=f, fill=(20, 20, 20, 255))
        tile = tile.rotate(rnd.uniform(-1.6, 1.6), resample=Image.BICUBIC, expand=False)
        img.paste(tile, (50 + rnd.randint(-6, 6), 100 + 130 * i + rnd.randint(-5, 5)), tile)
    img.save(path)


solution(os.path.join(OUT, "stepdiff-a.png"), ["2x + 6 = 14", "2x = 14 - 6", "2x = 8", "x = 4"], 11)
solution(os.path.join(OUT, "stepdiff-b.png"), ["2x + 6 = 14", "2x = 14 + 6", "2x = 20", "x = 10"], 12)

page = Image.new("RGB", (1240, 700), (255, 255, 255))
d = ImageDraw.Draw(page)
d.text((90, 80), "Coin flips", font=font(60), fill=(0, 0, 0))
body = font(44)
for i, line in enumerate([
    "A fair coin lands heads with probability one half.",
    "Two independent flips both land heads with probability one quarter.",
    "Independence means one flip does not change the other.",
]):
    d.text((90, 200 + 90 * i), line, font=body, fill=(0, 0, 0))
page.save(os.path.join(OUT, "scanned-page.pdf"), "PDF", resolution=150.0)
print("wrote", sorted(os.listdir(OUT)))
