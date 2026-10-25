# Typography

```json
{
  "pixel": {
    "family": "Jersey 10",
    "css": "\"Jersey 10\"",
    "license": "SIL OFL 1.1 (Jersey 10 Project Authors, Sarah Cadigan-Fried)",
    "files": {
      "ttf": "assets/fonts/jersey-10/Jersey10-Regular.ttf",
      "woff2-latin": "assets/fonts/jersey-10/Jersey10-latin.woff2",
      "woff2-latin-ext": "assets/fonts/jersey-10/Jersey10-latin-ext.woff2",
      "license": "assets/fonts/jersey-10/OFL.txt"
    },
    "unitsPerEm": 1400, "artPixelEm": 9.3333, "sizesPx": [18.667, 28, 37.333, 56],
    "weights": [400], "case": "mixed"
  },
  "pixelMicro": {
    "family": "Silkscreen",
    "css": "\"Silkscreen\"",
    "license": "SIL OFL 1.1 (Jason Kottke)",
    "files": {
      "ttf": "assets/fonts/silkscreen/Silkscreen-Regular.ttf",
      "woff2-latin": "assets/fonts/silkscreen/Silkscreen-latin.woff2",
      "license": "assets/fonts/silkscreen/OFL.txt"
    },
    "sizesPx": [8, 16, 24], "weights": [400], "case": "caps only (lowercase renders as small caps)"
  },
  "ui": {
    "family": "Inter Variable",
    "css": "\"Inter Variable\"",
    "license": "SIL OFL 1.1 (The Inter Project Authors)",
    "files": {
      "ttf": "assets/fonts/inter/InterVariable.ttf",
      "woff2-latin": "assets/fonts/inter/InterVariable-latin.woff2",
      "woff2-latin-ext": "assets/fonts/inter/InterVariable-latin-ext.woff2",
      "license": "assets/fonts/inter/OFL.txt"
    },
    "weightAxis": "100 900"
  },
  "stacks": {
    "pixel": "\"Jersey 10\", \"Jersey 10 Fallback\", ui-monospace, Menlo, Consolas, monospace",
    "pixelMicro": "\"Silkscreen\", \"Jersey 10\", ui-monospace, Menlo, monospace",
    "ui": "\"Inter Variable\", \"Inter Fallback\", system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif"
  },
  "network": "OK. Sources: github.com/google/fonts (ttf, OFL.txt) and npm @fontsource (woff2 latin splits)."
}
```

## Decision

- **Pixel font: Jersey 10** (mixed case, OFL). Chosen because digits and letters stay unambiguous: `5` is not `S`, `2` is not `Z`, `Q`/`O`/`0` differ. Its art pixel is 150/1400 em = **em/9.333**, so the clean sizes are integer multiples of 9.333 px: **9.33 (1x), 18.67 (2x), 28 (3x), 37.33, 56**. It was the only mixed-case candidate that held up at every size tested.
- **Micro caps: Silkscreen** at exactly **8 / 16 / 24 px** (1 font pixel = 1 art pixel at 8). Caps only, so use it for 1-2 word tags (LIVE, REPLAY, STEP 2) where the 8px grid matches the world art. Optional; drop it if you want a single pixel family.
- **UI sans: Inter Variable, kept.** The Nook clone already ships it, and in `_type-specimens/pairing-3x.png` it sits well beside Jersey 10 (neutral, big x-height, no competing personality). Geist/Manrope not worth the switch.

## Rejected (see specimens)

| Font | Why |
|---|---|
| Pixelify Sans (`pixelify-sans.png`) | Nice shapes, but `5` reads as `S` ("ChS", "Q2 of S") and `2` as `Z`; not on a strict grid (curved variable outlines), soft at 12 px. |
| Micro5 (`micro5.png`) | `C` renders like `[` ("[ouncil"); cramped 5px cap height. |
| VT323 (`vt323.png`) | Thin strokes, terminal feel, off-brand next to chunky outlined art. |
| Ninja Adventure font (`ninja-adventure.png`) | No `·` or several accented glyphs (tofu boxes), word spacing collapses ("Waitingforyoures"), 16px-art scale mismatch. Keep only as a last-resort fallback. |
| Press Start 2P | Too wide (60-char bubble ~ 480 px), caps-like blocky; probed only (`_type-specimens/` has no sheet). |
| Tiny5 | Only ships as a multi-axis variable font (BLED/JITT/ROND); not probed further. |

## What I saw (specimens, night palette: moon on sky-deep, ink on wall-lit bubble)

- `jersey10.png` (9.33 / 18.67 / 28 px, shown 2x): at 18.67 and 28 every test string is crisp and legible, including `Ch5 Expert · in a call`, `Q2 of 5`, `shared: Tue 2-4 pm`, accents and `! ? . ,`. At 9.33 it is readable only for short labels (Council Hall, Live, Replay); the 60-char caption is a mush. Non-multiple sizes (14, 19 in my first probe) break stems: avoid.
- `silkscreen.png` (8 / 16 px, 3x): very crisp, ideal for tags, but all-caps makes `Waiting for your yes` and the 60-char line tiring; accents are cramped.
- `pairing-3x.png`: Jersey 10 titles/bubble/numerals above an Inter ledger panel. Reads as one system; Inter body is clearly the right choice for the ledger. (PIL renders Inter unhinted/aliased; browsers will be smoother.)
- Probe sheets in this folder are not committed; `make_specimens.py <scratch-with-ttf/>` regenerates the sheets.

## Where the pixel font is allowed / forbidden

Allowed: in-world labels (names, door and signboard text), HUD chip name labels, speech-bubble text **up to 60 characters, max 2 lines**, big numerals (Q2 of 5, countdowns, scores), screen titles and button labels of 1-3 words in game chrome.
Forbidden: paragraph text, any caption longer than one line, the ledger body, quiz questions and answers, form fields and placeholders, legal copy, error explanations, anything with rendered size below **18.67 px (Jersey) / 8 px (Silkscreen)** or below 12 px in any font. Inside bubbles, wrap at 28 chars/line.

## Rendering rules

- **DOM**: pixel font only at the sizes in the table (never fractional scale, never `transform: scale()` with non-integer). Set `font-synthesis: none; font-kerning: none; text-rendering: optimizeSpeed; -webkit-font-smoothing: none` (the last is macOS-only, may be ignored; expect slight AA on Retina, which is acceptable). Align text on integer px (no `translate(.5px)`). `font-smooth: never` is non-standard; harmless to include.
- **Phaser**: render text in a UI scene at camera zoom 1 with `fontSize = 9.333 * k * S` px where S = game scale (2 phone, 3 desktop) and k = 1 (chips/short labels), 2 (bubbles/titles), 3-6 (numerals). Set `fontFamily: '"Jersey 10"'`, `resolution: 1`, `roundPixels: true`, game config `pixelArt: true`, `antialias: false`, `roundPixels: true`; position text at integer coordinates; wait for `document.fonts.load('28px "Jersey 10"')` before creating text. Do **not** put text inside a zoomed world camera (blurry); project the anchor to screen px instead. Colors only from the palette: `moon` on sky-deep, `ink` on `wall-lit` bubbles, `glow` for emphasis, `alert`/`ok` only as fills with ink text.
- Outline for text on busy backgrounds: 1 art-pixel `ink` stroke (`stroke: '#070f1f', strokeThickness: S`).

## Type scale

DOM (rem = 16 px):

| Token | Family | Size / line-height px | Weight | Letter-spacing | Use |
|---|---|---|---|---|---|
| --text-xs | ui | 12 / 16 | 500 | 0.01em | meta, timestamps, "shared:" lines |
| --text-sm | ui | 14 / 20 | 400 | 0 | captions, helper, table cells |
| --text-base | ui | 16 / 24 | 400 | 0 | body, ledger, quiz questions, forms |
| --text-lg | ui | 18 / 28 | 500 | 0 | lead text, card titles |
| --text-xl | ui | 22 / 30 | 600 | -0.01em | panel headings |
| --text-2xl | ui | 28 / 34 | 650 | -0.02em | page headings |
| --text-btn | ui | 14 / 20 | 600 | 0.01em | buttons, chips (non-game) |
| --pixel-tag | Silkscreen | 8 / 8 (or 16 / 16) | 400 | 1px | LIVE, REPLAY tags, caps only |
| --pixel-sm | Jersey 10 | 18.667 / 20 | 400 | 0 | chip names, game button labels (2x art) |
| --pixel-md | Jersey 10 | 28 / 30 | 400 | 0 | bubble text on desktop, signs (3x) |
| --pixel-display | Jersey 10 | 37.333 / 40 | 400 | 0 | titles |
| --pixel-numeral | Jersey 10 | 56 / 56 | 400 | 0 | Q2 of 5, countdowns |

(The brief's "24/32, 32/40" display sizes are off-grid for Jersey 10; use 28/30 and 37.333/40. For Silkscreen, 24/32 is on grid and allowed.)

Canvas (Phaser fontSize px = 9.333 x k x S):

| Role | k | S=2 (phone) | S=3 (desktop) | Max chars |
|---|---|---|---|---|
| Chip/world label | 1 | 18.67 | 28 | 16 |
| Door/sign | 1-2 | 18.67-37.33 | 28-56 | 20 |
| Speech bubble | 1 | 18.67 | 28 | 60 (2 lines of 28) |
| Title/banner | 2 | 37.33 | 56 | 24 |
| Numerals | 3 | 56 | 84 | 6 |
| Micro tag (Silkscreen) | - | 16 | 24 | 10 |

Line height in canvas: `lineSpacing = 2 * S` px extra.

## CSS

```css
@font-face { font-family: "Jersey 10"; font-style: normal; font-weight: 400; font-display: swap;
  src: url("/assets/fonts/jersey-10/Jersey10-latin.woff2") format("woff2"), url("/assets/fonts/jersey-10/Jersey10-Regular.ttf") format("truetype");
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: "Jersey 10"; font-weight: 400; font-display: swap;
  src: url("/assets/fonts/jersey-10/Jersey10-latin-ext.woff2") format("woff2");
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF; }
@font-face { font-family: "Silkscreen"; font-weight: 400; font-display: swap;
  src: url("/assets/fonts/silkscreen/Silkscreen-latin.woff2") format("woff2"), url("/assets/fonts/silkscreen/Silkscreen-Regular.ttf") format("truetype");
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+2000-206F, U+20AC, U+2122; }
@font-face { font-family: "Inter Variable"; font-weight: 100 900; font-style: normal; font-display: swap;
  src: url("/assets/fonts/inter/InterVariable-latin.woff2") format("woff2-variations");
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: "Inter Variable"; font-weight: 100 900; font-display: swap;
  src: url("/assets/fonts/inter/InterVariable-latin-ext.woff2") format("woff2-variations");
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF; }
/* Fallbacks tuned to limit layout shift (verify in DevTools; tweak after first real render) */
@font-face { font-family: "Inter Fallback"; src: local("Arial"); size-adjust: 107%; ascent-override: 90%; descent-override: 22%; line-gap-override: 0%; }
@font-face { font-family: "Jersey 10 Fallback"; src: local("Courier New"); size-adjust: 78%; ascent-override: 80%; descent-override: 27%; }
```

Preload (only the two above-the-fold latin files; others load on demand):
`<link rel="preload" as="font" type="font/woff2" crossorigin href="/assets/fonts/jersey-10/Jersey10-latin.woff2">` and the same for `InterVariable-latin.woff2`. Do not preload Silkscreen or latin-ext. Total preload about 62 KB.

Phaser gate: `await Promise.all([document.fonts.load('28px "Jersey 10"'), document.fonts.load('8px "Silkscreen"')])` in the boot scene before any `add.text`.

## Caveats for the lead

- The `size-adjust` fallback numbers are estimates, not measured in a browser. The specimens were rendered with PIL (no Playwright installed) in non-antialiased mode, so DOM rendering will be softer on Retina.
- Jersey 10's cap height is 750/1400 em (about 5 art pixels at 1x). Do not use it for 1x text below 18.67 px on phones.
- Latin-ext woff2 for Jersey 10 comes from Fontsource's subset; accents in the `latin` file cover French/Spanish/German.
