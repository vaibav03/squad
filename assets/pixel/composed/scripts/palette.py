"""Squad Village master palette (28 colors) and shared pixel helpers.

Every composed asset is quantized to PALETTE so the whole world is one palette.
Import from other scripts:  from palette import PALETTE, quantize, night_grade, load, save, sheet
Run `python3 palette.py` to write ../../../../docs/design/palette.json and a swatch PNG.
"""
import json, math, os
from PIL import Image

# name -> hex. Roles in comments. Keep names in sync with docs/design/tokens.css.
PALETTE = {
    "ink":        "#070f1f",  # outlines, deepest shadow, text on light
    "sky-deep":   "#0b1d38",  # zenith, UI night surface
    "sky-mid":    "#0a3a63",  # upper sky band
    "sky-low":    "#0c6e9e",  # horizon sky (primary reference blue)
    "cloud-lo":   "#6fa3b8",  # cloud shade, haze
    "cloud-hi":   "#b4d6da",  # cloud light, snow, moon halo, magic glow
    "moon":       "#fff2c4",  # moon, star, brightest cool-warm
    "hill-far":   "#4a7695",  # far hills
    "hill-mid":   "#2f5f84",  # mid hills
    "hill-near":  "#1c4466",  # near hills
    "ground":     "#122b3f",  # road, soil, UI border on dark
    "leaf-dark":  "#0d3a4f",  # tree mass
    "leaf-lit":   "#22808a",  # tree highlight, grass lit
    "wall-lit":   "#c9d4e4",  # moonlit plaster
    "wall-mid":   "#8c9bb8",  # plaster
    "wall-shade": "#56648a",  # plaster shade
    "roof-wine":  "#7a3552",  # roof tiles, cloth
    "roof-shade": "#4a2440",  # roof shadow
    "wood-lit":   "#b07a52",  # lit wood, medium skin
    "wood":       "#6e4a3c",  # wood, deep skin, hair
    "wood-dark":  "#3a2634",  # door, fence, hair dark
    "glow-core":  "#fff0a8",  # window core, lantern core
    "glow":       "#ffc857",  # window light, accent (brand lantern)
    "ember":      "#f08a3a",  # fire, warm accent, dusk
    "alert":      "#e0485a",  # error, conflict, blocked
    "ok":         "#5fcf8a",  # success, confirmed
    "skin-lt":    "#f3cfae",  # light skin
    "violet":     "#8f7bff",  # council, magic, info accent
}
assert len(PALETTE) == 28

def hex2rgb(h): h = h.lstrip('#'); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
RGB = {k: hex2rgb(v) for k, v in PALETTE.items()}
NAMES = list(PALETTE)

# --- OKLab ---------------------------------------------------------------
def _lin(c): c /= 255.0; return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def _gam(c): c = max(0.0, min(1.0, c)); v = 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055; return int(round(v * 255))
def rgb2lab(rgb):
    r, g, b = (_lin(x) for x in rgb[:3])
    l = 0.4122214708*r + 0.5363325363*g + 0.0514459929*b
    m = 0.2119034982*r + 0.6806995451*g + 0.1073969566*b
    s = 0.0883024619*r + 0.2817188376*g + 0.6299787005*b
    l, m, s = (x ** (1/3) for x in (l, m, s))
    return (0.2104542553*l + 0.7936177850*m - 0.0040720468*s,
            1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
            0.0259040371*l + 0.7827717662*m - 0.8086757660*s)
def lab2rgb(lab):
    L, a, b = lab
    l = (L + 0.3963377774*a + 0.2158037573*b) ** 3
    m = (L - 0.1055613458*a - 0.0638541728*b) ** 3
    s = (L - 0.0894841775*a - 1.2914855480*b) ** 3
    r = 4.0767416621*l - 3.3077115913*m + 0.2309699292*s
    g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s
    bb = -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
    return (_gam(r), _gam(g), _gam(bb))
LAB = {k: rgb2lab(v) for k, v in RGB.items()}
_cache = {}
def nearest(rgb, allowed=None):
    key = (rgb[:3], tuple(allowed) if allowed else None)
    if key in _cache: return _cache[key]
    lab = rgb2lab(rgb); best = None; bd = 1e9
    for k in (allowed or NAMES):
        p = LAB[k]; d = (lab[0]-p[0])**2*1.0 + (lab[1]-p[1])**2 + (lab[2]-p[2])**2
        if d < bd: bd, best = d, k
    _cache[key] = best
    return best

def quantize(img, allowed=None, alpha_cut=128):
    """Snap every opaque pixel to the master palette; alpha becomes 0 or 255."""
    img = img.convert('RGBA'); px = img.load(); w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < alpha_cut: px[x, y] = (0, 0, 0, 0); continue
            px[x, y] = RGB[nearest((r, g, b), allowed)] + (255,)
    return img

# Colors a daytime-lit object may become at night (no sky/cloud/glow so walls never glare)
MATERIALS = ["ink","sky-deep","hill-far","hill-mid","hill-near","ground","leaf-dark","leaf-lit","wall-lit","wall-mid","wall-shade",
             "roof-wine","roof-shade","wood-lit","wood","wood-dark","ember","alert","ok","skin-lt","violet","cloud-lo","sky-low","glow"]
def night_grade(img, strength=1.0, alpha_cut=128, keep_warm=True, allowed=None):
    """Day art -> night look: darken, cool the neutrals, keep warm hues readable, then quantize.
    Works in OKLab: lightness is compressed into [0.18, 0.80]; low-chroma pixels (cream plaster, stone)
    are pulled toward periwinkle; saturated warm pixels (roof red, wood, windows) keep their hue."""
    img = img.convert('RGBA'); px = img.load(); w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < alpha_cut: px[x, y] = (0, 0, 0, 0); continue
            L, A, B = rgb2lab((r, g, b)); C = math.hypot(A, B); H = math.atan2(B, A)
            L2 = 0.14 + 0.52 * L ** 2.0
            cool = max(0.0, 1.0 - C / 0.12) * 0.9 * strength          # how neutral is it
            tA, tB = -0.02, -0.07                                     # periwinkle target direction
            A2 = A * (1 - cool) + tA * cool * (0.4 + L); B2 = B * (1 - cool) + tB * cool * (0.4 + L)
            if not keep_warm: A2, B2 = A2 * .5 + tA * .5, B2 * .5 + tB * .5
            px[x, y] = RGB[nearest(lab2rgb((L2, A2, B2)), allowed or MATERIALS)] + (255,)
    return img

def load(path): return Image.open(path).convert('RGBA')
def save(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True); img.save(path)

def sheet(items, path, scale=3, cols=6, bg='sky-deep', pad=8, label=True):
    """Contact sheet: items = [(name, PIL image)], nearest-neighbor scaled, labelled."""
    from PIL import ImageDraw
    cells = [(n, im.resize((im.width*scale, im.height*scale), Image.NEAREST)) for n, im in items]
    cw = max(c[1].width for c in cells) + pad*2; ch = max(c[1].height for c in cells) + pad*2 + (12 if label else 0)
    rows = (len(cells) + cols - 1) // cols
    out = Image.new('RGBA', (cw*cols, ch*rows), RGB[bg] + (255,)); d = ImageDraw.Draw(out)
    for i, (n, im) in enumerate(cells):
        x, y = (i % cols)*cw, (i // cols)*ch
        out.alpha_composite(im, (x + pad, y + pad + (12 if label else 0)))
        if label: d.text((x + pad, y + 2), n[:cw//6], fill=RGB['cloud-hi'])
    save(out, path); return out

if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__)); root = os.path.abspath(os.path.join(here, '../../../..'))
    json.dump(PALETTE, open(os.path.join(root, 'docs/design/palette.json'), 'w'), indent=2)
    sw = Image.new('RGBA', (7*64, 4*64), (0, 0, 0, 255))
    for i, k in enumerate(NAMES):
        sw.paste(RGB[k] + (255,), ((i % 7)*64, (i // 7)*64, (i % 7)*64 + 64, (i // 7)*64 + 64))
    from PIL import ImageDraw; d = ImageDraw.Draw(sw)
    for i, k in enumerate(NAMES):
        l = rgb2lab(RGB[k])[0]; d.text(((i % 7)*64 + 3, (i // 7)*64 + 3), k, fill=(0, 0, 0) if l > .6 else (255, 255, 255))
    sw.save(os.path.join(root, 'docs/design/palette-swatches.png')); print('ok')
