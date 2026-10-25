"""Council crests: deterministic head-and-shoulders busts cropped from the repo's own village sprite frames.

Inputs : assets/pixel/composed/characters/<sprite>/idle.png (original, palette-only art; see ../../LICENSES.md).
Output : assets/pixel/composed/characters/crests/<crest>.png (32x32, RGBA) and crests/crests.json.
Method : take idle frame 0, find the opaque bounding box, crop a 16x16 window around the head and shoulders, scale it 2x
         with nearest neighbour (integer, pixelated), and set it on a crest tile built only from PALETTE colours
         (sky gradient, ink border, cloud-lo inner hairline). No third-party pixels; nothing from Modern Interiors.
Run    : python3 assets/pixel/composed/scripts/crests.py   (same input -> byte-identical output)
"""
import json, os, sys
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from palette import PALETTE  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
CHARS = os.path.join(HERE, "..", "characters")
OUT = os.path.join(CHARS, "crests")

# crest id -> village sprite folder. Participants without cast bust art (Chill/Grind/Advisor/Chairman have busts).
CRESTS = {
    "skeptic": "council-hard",
    "teacher": "ta",
    "practitioner": "expert",
    "solver-a": "student",
    "solver-b": "freshman",
    "solver-c": "council-balance",
    "debate-pro": "council-chill",
    "debate-con": "mediator",
    "judge": "dean",
    "examiner": "examiner",
}


def hex_rgb(name):
    h = PALETTE[name].lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def crest(sprite):
    frame = Image.open(os.path.join(CHARS, sprite, "idle.png")).convert("RGBA").crop((0, 0, 32, 32))
    x0, y0, x1, y1 = frame.getbbox()
    cx = (x0 + x1) // 2
    # head + shoulders: 16 rows from the top of the figure (hats and hair included), 16 columns around the centre line
    left = max(0, min(32 - 16, cx - 8))
    win = frame.crop((left, y0 - 1 if y0 > 0 else 0, left + 16, (y0 - 1 if y0 > 0 else 0) + 16))
    big = win.resize((32, 32), Image.NEAREST)
    top, bot = hex_rgb("sky-mid"), hex_rgb("sky-deep")
    tile = Image.new("RGBA", (32, 32))
    px = tile.load()
    for y in range(32):
        row = lerp(top, bot, y / 31)
        for x in range(32):
            px[x, y] = row + (255,)
    tile.alpha_composite(big)
    px = tile.load()
    ink, hair = hex_rgb("ink") + (255,), hex_rgb("cloud-lo") + (255,)
    for i in range(32):
        for (x, y) in ((i, 0), (i, 31), (0, i), (31, i)):
            px[x, y] = ink
        for (x, y) in ((i, 1), (i, 30), (1, i), (30, i)):
            if 1 < i < 30:
                px[x, y] = tuple(round(c * 0.55 + k * 0.45) for c, k in zip(px[x, y][:3], hair[:3])) + (255,)
    return tile


def main():
    os.makedirs(OUT, exist_ok=True)
    for cid, sprite in CRESTS.items():
        crest(sprite).save(os.path.join(OUT, f"{cid}.png"), optimize=False)
    with open(os.path.join(OUT, "crests.json"), "w") as f:
        json.dump(
            {"cell": [32, 32], "derivedFrom": "assets/pixel/composed/characters/<sprite>/idle.png frame 0", "crests": CRESTS},
            f,
            indent=1,
            sort_keys=True,
        )
        f.write("\n")
    print("wrote", len(CRESTS), "crests to", os.path.relpath(OUT))


if __name__ == "__main__":
    main()
