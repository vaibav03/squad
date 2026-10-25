"""Shared helpers for the buildings pipeline: palette-name drawing canvas, house grading, glow/spill, verification."""
import os, sys, json
from collections import deque
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from PIL import Image
from palette import PALETTE, RGB, NAMES, quantize, night_grade, load, save, sheet, nearest

ROOT = os.path.abspath(os.path.join(HERE, '../../../..'))
PIX = os.path.join(ROOT, 'assets/pixel')
OUT = os.path.join(PIX, 'composed/buildings')
COMP = os.path.join(PIX, 'composed')
TOWN_DAY = os.path.join(PIX, 'buildings/autumn-town/Props_TownDay.png')
FOREST_DAY = os.path.join(PIX, 'buildings/autumn-town/Props_ForestDay.png')

REV = {v: k for k, v in RGB.items()}
def C(name): return RGB[name] + (255,)

class Cv:
    """Tiny palette-name canvas. All drawing uses palette names so output is palette-clean by construction."""
    def __init__(self, w, h): self.im = Image.new('RGBA', (w, h), (0, 0, 0, 0)); self.px = self.im.load(); self.w, self.h = w, h
    def p(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[x, y] = (0, 0, 0, 0) if c is None else C(c)
    def get(self, x, y):
        return self.px[x, y] if 0 <= x < self.w and 0 <= y < self.h else (0, 0, 0, 0)
    def name(self, x, y):
        r = self.get(x, y); return None if r[3] < 128 else REV.get(r[:3])
    def rect(self, x0, y0, x1, y1, c):  # inclusive
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1): self.p(x, y, c)
    def frame(self, x0, y0, x1, y1, c):
        for x in range(x0, x1 + 1): self.p(x, y0, c); self.p(x, y1, c)
        for y in range(y0, y1 + 1): self.p(x0, y, c); self.p(x1, y, c)
    def hline(self, x0, x1, y, c):
        for x in range(x0, x1 + 1): self.p(x, y, c)
    def vline(self, x, y0, y1, c):
        for y in range(y0, y1 + 1): self.p(x, y, c)
    def line(self, x0, y0, x1, y1, c):
        dx, dy = abs(x1 - x0), -abs(y1 - y0); sx = 1 if x0 < x1 else -1; sy = 1 if y0 < y1 else -1; e = dx + dy
        while True:
            self.p(x0, y0, c)
            if x0 == x1 and y0 == y1: break
            e2 = 2 * e
            if e2 >= dy: e += dy; x0 += sx
            if e2 <= dx: e += dx; y0 += sy
    def ellipse(self, cx, cy, rx, ry, c, fill=True, outline=None):
        for y in range(cy - ry - 1, cy + ry + 2):
            for x in range(cx - rx - 1, cx + rx + 2):
                d = ((x - cx) / (rx + .5)) ** 2 + ((y - cy) / (ry + .5)) ** 2
                if d <= 1.0: self.p(x, y, c)
        if outline:
            for y in range(cy - ry - 2, cy + ry + 3):
                for x in range(cx - rx - 2, cx + rx + 3):
                    d = ((x - cx) / (rx + .5)) ** 2 + ((y - cy) / (ry + .5)) ** 2
                    if d > 1.0 and d <= 1.0 + 2.6 / max(rx, ry) and self.get(x, y)[3] == 0: self.p(x, y, outline)
    def paste(self, im, x, y):
        self.im.alpha_composite(im, (x, y)); self.px = self.im.load()
    def outline(self, c='ink'):
        """1px outline around opaque silhouette (outside)."""
        src = self.im.copy(); sp = src.load()
        for y in range(self.h):
            for x in range(self.w):
                if sp[x, y][3] == 0:
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < self.w and 0 <= ny < self.h and sp[nx, ny][3] > 0: self.p(x, y, c); break

def largest_component(im):
    a = im.split()[3].load(); w, h = im.size; seen = [[0] * w for _ in range(h)]; best = []
    for y in range(h):
        for x in range(w):
            if a[x, y] > 0 and not seen[y][x]:
                q = deque([(x, y)]); seen[y][x] = 1; comp = []
                while q:
                    cx, cy = q.popleft(); comp.append((cx, cy))
                    for dx in (-1, 0, 1):
                        for dy in (-1, 0, 1):
                            nx, ny = cx + dx, cy + dy
                            if 0 <= nx < w and 0 <= ny < h and a[nx, ny] > 0 and not seen[ny][nx]: seen[ny][nx] = 1; q.append((nx, ny))
                if len(comp) > len(best): best = comp
    out = Image.new('RGBA', im.size, (0, 0, 0, 0)); sp = im.load(); op = out.load()
    for x, y in best: op[x, y] = sp[x, y]
    return out.crop(out.getbbox())

def components(mask, w, h, merge=2):
    """connected components of a boolean mask (set of (x,y)), merging within `merge` px -> list of bboxes."""
    pts = set(mask); seen = set(); boxes = []
    for p in sorted(pts):
        if p in seen: continue
        q = deque([p]); seen.add(p); xs = []; ys = []
        while q:
            cx, cy = q.popleft(); xs.append(cx); ys.append(cy)
            for dx in range(-merge, merge + 1):
                for dy in range(-merge, merge + 1):
                    n = (cx + dx, cy + dy)
                    if n in pts and n not in seen: seen.add(n); q.append(n)
        boxes.append((min(xs), min(ys), max(xs), max(ys), len(xs)))
    return boxes

def verify_palette(im, label=''):
    px = im.convert('RGBA').load(); bad = 0
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a == 0: continue
            if a != 255 or (r, g, b) not in REV: bad += 1
    if bad: raise SystemExit('PALETTE VIOLATION %s: %d px' % (label, bad))
    return True

def trim_anchor(im):
    """crop to bbox, return (img, anchor=(bottom-center x, bottom y)) in cropped coords"""
    bb = im.getbbox(); im = im.crop(bb); return im, (im.width // 2, im.height - 1)
