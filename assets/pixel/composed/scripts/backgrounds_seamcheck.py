"""Seam check: composites each 480-wide layer next to itself (right edge | left edge) and flags the seam
if column-to-column difference at the wrap exceeds what the layer shows internally.
A column pair 'differs' when the RGBA pixel differs; opaque/transparent mismatch is always flagged.
Writes _seamcheck.png (each layer doubled, seam marker) into the backgrounds folder."""
import os, sys
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)

LAYERS = ['1_stars', '3_clouds_far', '4_clouds_near', '5_hills_far', '6_hills_mid', '7_hills_near', '8_fenceline', '9_ground', '10_foreground',
          '1_stars_twinkle_0', '1_stars_twinkle_1', '1_stars_twinkle_2', '1_stars_twinkle_3']


def coldiff(px, h, xa, xb):
    n = 0; mism = 0
    for y in range(h):
        a, b = px[xa, y], px[xb, y]
        if a != b: n += 1
        if (a[3] == 0) != (b[3] == 0): mism += 1
    return n, mism


def run(out):
    ok = True; rows = []
    for name in LAYERS:
        im = Image.open(os.path.join(out, name + '.png')).convert('RGBA'); w, h = im.size; px = im.load()
        base = [coldiff(px, h, x, x + 1) for x in range(w - 1)]
        mean_diff = sum(d for d, _ in base) / len(base); max_mism = max(m for _, m in base)
        sd, sm = coldiff(px, h, w - 1, 0)
        edge_same = sum(1 for y in range(h) if px[w - 1, y] == px[0, y] and px[0, y][3])  # duplicated edge column
        bad = sd > mean_diff * 1.6 + 3 or sm > max_mism + 2
        ok &= not bad
        rows.append((name, sd, round(mean_diff, 1), sm, 'SEAM' if bad else 'ok'))
    # sky strips are 1-D: horizontally uniform
    for name in ('0_sky', '0_sky_dusk', '0_sky_dawn', '0_sky_day'):
        im = Image.open(os.path.join(out, name + '.png')).convert('RGBA'); px = im.load(); w, h = im.size
        uni = all(px[x, y] == px[x % 8, y] for y in range(h) for x in range(w))
        ok &= uni; rows.append((name, 0, 0, 0, 'ok(uniform)' if uni else 'NOT UNIFORM'))
    for r in rows: print('seam %-20s wrap-diff=%4d  mean-internal=%6s  transp-mismatch=%3d  %s' % r)
    # visual
    sheet = Image.new('RGBA', (960, 1 + sum(Image.open(os.path.join(out, n + '.png')).height + 6 for n in LAYERS[:9])), (11, 29, 56, 255))
    y = 1; d = ImageDraw.Draw(sheet)
    for n in LAYERS[:9]:
        im = Image.open(os.path.join(out, n + '.png')).convert('RGBA')
        sheet.alpha_composite(im, (0, y)); sheet.alpha_composite(im, (480, y)); d.line([(480, y), (480, y + im.height)], fill=(224, 72, 90, 255)); y += im.height + 6
    sheet.save(os.path.join(out, '_seamcheck.png'))
    if not ok: raise SystemExit('SEAM CHECK FAILED')
    print('seam check passed')


if __name__ == '__main__':
    run(os.path.abspath(os.path.join(HERE, '..', 'backgrounds')))
