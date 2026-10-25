"""Preview composite (427x240 viewport at 3x) and contact sheet for the parallax layers."""
import os, sys
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from palette import sheet, RGB


def L(out, n): return Image.open(os.path.join(out, n + '.png')).convert('RGBA')


def compose(out, sky='0_sky', cam=26, vw=427, vh=240, tw=None):
    view = Image.new('RGBA', (vw, vh), (0, 0, 0, 255))
    top = 270 - vh
    def place(im, x, y, factor=1.0, tile=True):
        ox = -int(cam * factor)
        if tile:
            sx = ox % im.width - im.width
            while sx < vw:
                view.alpha_composite(im, (sx, y - top)) if True else None
                sx += im.width
        else: view.alpha_composite(im, (x + ox, y - top))
    strip = L(out, sky)
    for x in range(0, vw, strip.width): view.alpha_composite(strip.crop((0, top, strip.width, 270)), (x, 0))
    if sky != '0_sky_day': place(L(out, '1_stars'), 0, 0, .02)
    if sky != '0_sky_day': view.alpha_composite(L(out, '2_moon'), (86 - 40, 56 - 40 - top))
    for n, f in (('3_clouds_far', .1), ('4_clouds_near', .2), ('5_hills_far', .3), ('6_hills_mid', .45), ('7_hills_near', .6), ('8_fenceline', .9)):
        place(L(out, n), 0, 0, f)
    place(L(out, '9_ground'), 0, 240, 1.0)
    place(L(out, '10_foreground'), 0, 0, 1.0)
    return view


def run(out):
    v = compose(out); v.resize((v.width * 3, v.height * 3), Image.NEAREST).save(os.path.join(out, '_preview-parallax.png'))
    # time-of-day strip preview into scratch-free location: reuse sheet items
    items = []
    for n in ('0_sky', '0_sky_dusk', '0_sky_dawn', '0_sky_day'):
        s = L(out, n); items.append((n, s.resize((s.width * 4, 270))))
    for n in ('1_stars', '3_clouds_far', '4_clouds_near', '5_hills_far', '6_hills_mid', '7_hills_near', '8_fenceline', '9_ground', '10_foreground'):
        items.append((n, L(out, n)))
    items.append(('2_moon', L(out, '2_moon')))
    sheet(items, os.path.join(out, '_contact-backgrounds.png'), scale=1, cols=3, bg='sky-deep', pad=6)
    # time-of-day previews
    for tod in ('dusk', 'dawn', 'day'):
        t = compose(out, sky='0_sky_' + tod); t.resize((t.width * 2, t.height * 2), Image.NEAREST).save(os.path.join(out, f'_preview-{tod}-raw.png'))


if __name__ == '__main__':
    run(os.path.abspath(os.path.join(HERE, '..', 'backgrounds')))
