"""Verify every PNG under assets/pixel/composed uses only the 28 master palette colors and alpha 0/255.
Usage: python3 check_assets.py [--quiet]   Exit code 1 if any violation. Contact sheets/previews (_*.png) are skipped."""
import os, sys
from PIL import Image
from palette import RGB
ok_rgb = set(RGB.values())
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
bad = 0; n = 0
for dp, _, fs in os.walk(root):
    for f in sorted(fs):
        if not f.lower().endswith('.png') or f.startswith('_'): continue
        p = os.path.join(dp, f); n += 1
        im = Image.open(p).convert('RGBA'); colors = im.getcolors(1 << 20) or []
        off = {c for _, c in colors if c[3] == 255 and c[:3] not in ok_rgb}
        semi = sum(k for k, c in colors if 0 < c[3] < 255)
        if off or semi:
            bad += 1
            if '--quiet' not in sys.argv: print(f"FAIL {os.path.relpath(p, root)}: {len(off)} off-palette colors, {semi} semi-transparent px")
print(f"checked {n} PNGs, {bad} failing"); sys.exit(1 if bad else 0)
