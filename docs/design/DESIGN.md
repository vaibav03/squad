# Squad Village: design system

Status: v1 (foundation). Owner: design foundation lead. Canonical files in this folder:
`tokens.css` / `tokens.ts` (values), `palette.json` + `palette-swatches.png` (the 28 colors), `typography.md` (fonts, sizes), `asset-manifest.md` + `/assets/asset-manifest.json` (every sprite, frame size, anchor, license), `review-rubric.md` (what reviewers check). Motion is canonical in `docs/specs/08-village-motion.md`; the tokens here mirror it and must not drift. If this file and a spec disagree about motion, 08 wins; about looks, this file wins.

## 1. Art direction

**What it feels like.** A cold, clear night in a small hill town where somebody is still up studying. The sky is a deep cerulean that brightens toward the horizon, with a crescent moon, puffy outlined clouds and pale hills. Everything warm in the scene is a person or a promise: lit windows, a lantern, a campfire. Warmth means "someone is here and awake". The student walks along a quiet road between cottages that each hold an expert, passes the council hall with its violet lanterns, and ends at a campfire commons where agents carry envelopes. The mood is cozy, patient and a little magical, closer to a shipped indie game (Stardew's warmth, Eastward's lighting, the user's cerulean landscape reference) than to an app with a game skin.

**The app around it** is calm, dense-enough and quiet: dark navy glass chips and panels floating over the canvas, hairline borders, one amber accent (the lantern), a UI sans for reading and a pixel font only for labels that live "in the world". Light mode exists for the paper pages (ledger, trip, mastery, setup), but the village itself is always night.

**It must never look like:** a tech demo with a pixel filter; a mashup of packs (two pixel sizes, two outline styles, two palettes in one frame); a "gamified" dashboard (XP bars, streak flames, trophies, confetti, gold coins; spec 08 forbids scores); neon-on-black "cyber" UI; glossy 3D emoji inside the world (Fluent 3D is allowed only as small chrome icons); blurry upscaled sprites; default browser controls; lorem-ipsum or placeholder text; purple-to-blue gradient cards; anything where a pixel font carries paragraphs.

## 2. Pixel discipline (non-negotiable)

1. **One art scale.** All scene art is authored at native 1x with a **16 px grid** (tiles, props) and **32x32 character cells** (figure about 28 px tall, Autumn Town scale). Architecture follows Autumn Town proportions (door about 32 px tall). Nothing drawn at 2x inside another asset: Ninja Adventure 16 px art is allowed only for emotes and the 16 px HUD badges, always at 1x, and never in the scene as a "mini" character.
2. **One display scale.** The game canvas draws the native frame at an **integer zoom**: 3x at CSS width >= 900, else 2x. At 1280x720 the native view is 426x240; at 390 wide it is 195 wide by (height/2). Never use fractional zoom, `Scale.FIT` with free scaling, or CSS `transform: scale()` on the canvas. `pixelArt: true`, `roundPixels: true`, `antialias: false`, CSS `image-rendering: pixelated; image-rendering: crisp-edges`. Camera scroll and all sprite positions are snapped to whole **art** pixels (`tokens.ts: pixel.snap`).
3. **DPR.** Device pixels per art pixel must be an integer. Compute `k = round(zoom * devicePixelRatio)` (minimum 2 at DPR 1... never below `zoom`), set the canvas element's CSS size to `nativeW * k / dpr` by `nativeH * k / dpr`, and fill the leftover few CSS pixels with the sky color (`--sq-sky-deep`) behind the canvas. At DPR 1, 2, 3 this equals plain `zoom`; at 1.25, 1.5 and 1.75 it avoids shimmering rows. Resize with a 150 ms debounce and re-run this; never animate a zoom change.
4. **Phones.** 390 px wide is zoom 2 (195 native columns, about 12 tiles). Landscape phone (844x390) is zoom 2 as well. Vertical: the ground line sits at native y = 240 of a 270-tall layer set anchored to the bottom; any extra height above is the sky gradient column, so tall phones just show more sky and stars. Safe-area insets pad the DOM chrome, never the canvas. Tap-to-walk uses canvas coordinates divided by `k`.
5. **Pixel text in the canvas** is drawn at the font's native size times the integer zoom (see `typography.md`), never at fractional sizes, left or top aligned to whole pixels. Long text never goes in the canvas (spec 09: it lives in DOM overlays).
6. **Sprites in the DOM** (portraits, emotes, door ring in chips) are `<img class="sq-sprite">` or CSS `background` at width = native width x `--px` (2 or 3) with `image-rendering: pixelated`. Their container sizes are multiples of `--px`.
7. **Outlines and shading.** Characters and props carry a 1 px `ink` (or darker local ramp) outline; background layers (hills, clouds, trees) have no outline. Light comes from the moon, upper-left: highlights on the upper-left edges (rim in `wall-lit`/`moon`/`leaf-lit`), shade lower-right. Warm window light adds a 1 to 2 px `glow` spill on adjacent surfaces. No gradients, no blur, no semi-transparent sprite edges (alpha is 0 or 255 in art); soft effects are dithered (2 px checker) or stepped ellipses. Real alpha is allowed only on whole sprites (fades) and light pools via blend mode.

## 3. Master palette (28 colors)

Extracted by script from the primary reference (bottom-left night landscape: median-cut on the crop gave `#0c6e9e #122b3f #075686 #09172b #7e9fa8 #4d91a9 #99c2c9 #4a7695 #275b7c` as the dominant cerulean/teal family), then merged with Autumn Town night and Ninja Adventure reds/oranges/wood for the warm side and tuned by eye. Source of truth: `assets/pixel/composed/scripts/palette.py` (regenerates `palette.json` and `palette-swatches.png`). Every composed asset is verified to contain only these colors.

| Role | Token (`--sq-*`) | Hex | Used for |
|---|---|---|---|
| Ink | `ink` | `#070f1f` | outlines, deepest shadow, page background in dark, text on amber |
| Sky | `sky-deep` | `#0b1d38` | zenith, UI card surface, canvas letterbox |
| | `sky-mid` | `#0a3a63` | upper-mid sky, unlit windows |
| | `sky-low` | `#0c6e9e` | horizon sky (the reference blue), info |
| Cloud / moon | `cloud-lo` | `#6fa3b8` | cloud shade, haze, idle state |
| | `cloud-hi` | `#b4d6da` | cloud light, snow, moon halo, focus ring, magic glow |
| | `moon` | `#fff2c4` | moon, stars, brightest text on navy |
| Hills | `hill-far` / `hill-mid` / `hill-near` | `#4a7695` `#2f5f84` `#1c4466` | three parallax hill layers (lighter = farther) |
| Ground | `ground` | `#122b3f` | road, soil, muted surface |
| Foliage | `leaf-dark` / `leaf-lit` | `#0d3a4f` `#22808a` | tree mass and highlight, lit grass |
| Plaster | `wall-lit` / `wall-mid` / `wall-shade` | `#c9d4e4` `#8c9bb8` `#56648a` | moonlit walls: lit rim, body, shade |
| Roofs / cloth | `roof-wine` / `roof-shade` | `#7a3552` `#4a2440` | tiles, awnings, scarves |
| Wood | `wood-lit` / `wood` / `wood-dark` | `#b07a52` `#6e4a3c` `#3a2634` | timber, doors, fences; also skin and hair |
| Warm light | `glow-core` / `glow` / `ember` | `#fff0a8` `#ffc857` `#f08a3a` | window core, window light and brand accent, fire |
| Semantic | `alert` / `ok` | `#e0485a` `#5fcf8a` | conflict, blocked, error / confirmed, success |
| Skin | `skin-lt` | `#f3cfae` | light skin (medium and deep use `wood-lit`, `wood`) |
| Magic | `violet` | `#8f7bff` | council lanterns, thinking, info |

Rules: 
- **Scene art uses only these 28.** Light, glow and tint effects are drawn with these (stepped, dithered) or applied by the engine as tints from these.
- **Chrome-only derived tints** (documented in `tokens.css`: `--popover`, `--secondary`, `--accent`, `--border`, `--muted-foreground`, light-mode paper) are interpolations between palette entries so the DOM has enough neutrals; they never appear in sprites.
- **Warm vs cool budget.** About 85% of any frame is cool (sky, hills, walls). Warm (`glow`, `ember`, `wood-lit`) is reserved for light sources, doors and people. If a screenshot has more than ~15% warm pixels, something is wrong.
- **Semantic colors never stand alone**: every state also has an icon and a text label (accessibility, and Color Is Never The Only Signal in spec 09).
- Contrast (measured): text `#eef3f8` on `--card` 15.1:1; `--muted-foreground` on `--card` 7.4:1; `ink` on `glow` 12.4:1; `alert` text on dark uses `--destructive-text #ff7d8b`. Light mode: foreground on card 16:1, muted 6.0:1, state colors darkened to at least 4.5:1.

## 4. DOM chrome: light and dark

- **Dark is the identity.** `--background` is `ink`, panels are `sky-deep`, borders are a 1 px `#1d4163` hairline, the only saturated element is the amber primary button and the active state color. Surfaces step up by lightness, not by shadow: page (`ink`) < card (`sky-deep`) < popover (`#102a4a`).
- **The village screen is always dark** in both themes (wrap HUD, side panel, call, quiz and ledger overlays in `.sq-scene`, which pins the night tokens). A light-mode user opening the village still sees night; that is the world, not a theme failure. Overlays that cover the canvas never use light surfaces (they would blow out the scene and break night lighting).
- **Light mode** (Glass Box ledger page, trip view, mastery map, setup, personas): `--background #f4f1e8` moon-cream paper, cards `#fbf9f3`, ink text `#0b1d38`, navy primary button with moon text, hairline borders `#d6d3c6`, shadows are soft navy at 8 to 28% alpha. Accent in light mode is `sky-low` blue for focus and links; amber is used only for the "studying/lit" state dot and in-world art. Pixel sprites sit on paper cards with a 2 px `ink` outline and a `--sq-sky-deep` plate behind them so night art is never placed on white.
- Switching: follow `prefers-color-scheme`; `<html data-theme="light|dark">` overrides. No flash: set the attribute before first paint.
- Focus ring: 2 px `--ring` plus 2 px offset (gap in `--background`), on every interactive element, visible on canvas HUD too. Hover only inside `@media (hover: hover) and (pointer: fine)`.

## 5. Lighting rules

- **Night is default and canonical.** Sky ramp top to bottom: `sky-deep` > `sky-mid` > `sky-low` with 2 px dithered band transitions; clouds `cloud-hi`/`cloud-lo`; hills lighten with distance (haze); all architecture is graded to the plaster/wine/wood ramps.
- **Light sources.** (1) Moon: a cool upper-left rim on silhouettes. (2) Windows (`glow-core` pane, `glow` frame light, `ember` lowest) with a stepped 1 to 2 px spill and a faint pool on the ground below the door. (3) Fire and lanterns: `glow` > `ember`, plus a stepped light-pool sprite blended with `ADD` at 25% alpha. (4) Violet council lanterns: `violet` pane, `cloud-hi` core. A lit window means the agent is awake (`studying`/`in_call`); unlit `sky-mid`/`sky-deep` means idle; a locked building is the `_locked` desaturated variant (hill/wall-shade only, dark windows, padlock sprite).
- **Dusk and dawn** are tints, not repaints, applied only by a full-screen overlay and per-layer tint (values in `assets/pixel/composed/backgrounds/ramps.json`): dusk = sky strip swapped to the `0_sky_dusk` ramp (`ember`/`roof-wine`/`violet` low bands), world tint `roof-wine` at 18%; dawn = `0_sky_dawn` (`cloud-lo`/`glow`/`ember`), tint `glow` at 10%. Window layers are never tinted, so lights stay warm at every hour. Day uses `0_sky_day` with cool tint `cloud-hi` at 8% and window glow off. The transition runs 20 s `ease-in-out`, only at the real dusk/dawn crossing (row 2 of the motion table). Clock follows real time: night 20:00 to 05:30, dawn 05:30 to 07:00, day 07:00 to 17:30, dusk 17:30 to 20:00 (local), and the Replay badge pins night.
- **Interiors** (house cutaway, hall) are warm rooms: `wood`/`wood-lit` floors, `wall-mid` walls lit by `glow` pools, with the dark `ink` frame around the cutaway so the room reads as a lantern-lit box inside the night.
- Never add a black vignette, bloom, or CSS blur to the canvas. The only post effect allowed is the stepped light pool.

## 6. Typography

Two families, strict jobs. Final family choices and exact sizes are recorded in `typography.md` (read it before building text); values below are binding as roles and consistent with `tokens.css`.

- **Pixel font** (`--font-pixel`): in-world and HUD labels only: door signs, chapter signboards, agent name labels, speech and thought bubble text (up to about 60 characters), the clock, chip names, big numerals and screen titles. Sizes are integer multiples of the font's native grid: `--text-pixel-sm` 16, `-md` 24, `-lg` 32 px. Smoothing off (`-webkit-font-smoothing: none`), no letter-spacing, no italics, no bold. Never below 12 px rendered; never for paragraphs, captions longer than a line, ledger body, quiz questions, form fields.
- **UI sans** (`--font-sans`, Inter Variable, shared with the Nook clone): everything that is read: captions with citations, ledger entries, quiz question and answers, panel body, buttons, form fields, toasts. Scale: 12/16 label, 14/20 secondary, 16/24 body (default, and the minimum for anything the student must read in a call or quiz), 18/28 panel title, 22/30 card heading, 28/34 page title. Weights 400 body, 500 labels and buttons, 600 titles; `-0.005em` tracking; tabular numerals for clocks, `Q2 of 5`.
- Text on the canvas is rendered by Phaser `BitmapText` or `Text` with the pixel font at native x zoom. Max one line per label (24 characters), truncated with an ellipsis token, with the full text in the accessible list.
- Copy voice: plain, friendly student voice; sentence case; no jargon ("MoE", "PSI", "mesh"); no exclamation marks except the red "!" marker; times as `Tue 2-4 pm`.

## 7. Tokens at a glance (details in `tokens.css`)

- **Spacing:** 4 px base: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64. Page gutter 16 (390) / 24 (>= 768). Inside HUD chips 8; inside panels 16 (phone) and 20 to 24 (desktop); gap between stacked cards 12.
- **Radius:** `--radius` 10 (cards, panels), 8 (buttons, inputs, chips), 6 (small tags), 12 (sheets), 16 (large overlay), pill (state dots, badges). Pixel-art elements (bubbles, signs, door ring) have stepped corners drawn in the sprite, never CSS rounding.
- **Borders:** 1 px hairline `--border` on chrome; 2 px `ink` outline (`--pixel-outline`) on HUD chips and camera buttons for the game-feel edge.
- **Shadow:** 3 steps; shadows only on things that float over the canvas (HUD, panels, toasts). Flat on pages. `--shadow-glow` (amber hairline plus 16 px warm glow) marks a lit or selected thing in dark mode.
- **Z layers:** canvas 0, scene DOM 1, HUD 10, side panel and dock 20, scrim 30, overlay 40, toast 50, tooltip 60, cutscene skip 70.
- **Motion:** `--ease-out cubic-bezier(0.23,1,0.32,1)` enter and exit; `--ease-in-out cubic-bezier(0.77,0,0.175,1)` movement; `--ease-drawer cubic-bezier(0.32,0.72,0,1)` edge panels; spring `{duration .5, bounce .2}` for rare delight. UI durations: press 100, fast 150, base 200, panel 280 ms. Never ease-in, never `transition: all`, never `scale(0)`, DOM animates `transform` and `opacity` only.
- **Hit targets:** 44 px minimum on touch (the visible chip may be smaller, the hit area extends).

## 8. Component specs

Common: all components sit in `.sq-scene` when over the canvas; every interactive element has a visible focus ring, an accessible name, and keyboard operation; pressed state `transform: scale(0.97)` 100 ms ease-out; hover (fine pointers only) raises surface to `--accent`. Text color `--foreground`. Sprites are pixelated at `--px`.

### 8.1 HUD (top bar)
Layout at 1280: a 56 px bar inset 12 px from top/left/right (`top: calc(12px + var(--safe-top))`), no full-width background: three floating groups (left: agent chips; center: clock; right: camera buttons + Calm mode + Live/Replay badge) separated by space, each group a glass pill `--hud-bg`, `backdrop-filter: blur(8px)`, 1 px `--hud-border`, radius 12, `--shadow-2`. At 390: one row of 48 px: left Replay/Live badge and clock, right menu (opens side panel); agent chips move to the bottom dock; camera buttons and Calm mode live in the menu and as a 44 px single "camera" cycle button. The bar never covers more than the top 56 px of the canvas.

### 8.2 HUD portrait chip (agent)
Size 40 x 40 (hit area 44), radius 10, background `--secondary`, 2 px `ink` outline (`--pixel-outline`) so it reads as a game badge. Contents: the agent's 32x32 portrait at `--px` scaling cropped to a 32 px (css) face window (portrait is 32 native px; at 3x it is clipped to center 12 art px... use `object-fit: none; object-position: center top` and `width: 32px` showing the head at zoom 1; if the sprite is larger than the chip, scale it by 1 only; chips never show a fractional scale). State dot: 10 px circle bottom-right with 2 px `--card` ring, color `--state-*`, plus a 12 px glyph inside the dot area for non-color cue: idle `moon-dash`, studying `lamp`, in call `waveform`, waiting `hourglass`, conflict `!`. Label (desktop only, below at 12/16 `--font-sans` 500, truncate 10 chars; full name in tooltip and `aria-label` "Dean, in a call"). Selected = `--shadow-glow` and outline color `glow`. State change: color and opacity transition 150 ms ease only. A waiting chip shows a 2 px `ember` ring pulsing opacity 0.6 to 0.2, 1.6 s loop ease-out (static ring under reduced motion). Tap/Enter = walk to that agent and focus; long-press/Shift+Enter = open details. Max 9 chips visible, then a "+N" chip opening the side panel.

### 8.3 Camera buttons
Segmented control `Left | Mid | Right | Zoom 1.4x`: four 36 px high buttons joined (shared 2 px ink outline, 8 px outer radius, 0 inner), `--secondary` surface, pixel font 16 px labels in `--foreground`; selected = `--primary` fill with `--primary-foreground` text. Min width 48. Pressed `scale(0.97)`. `Left/Right` pan the camera 400 ms ease-in-out (skippable by another press). Keyboard: Tab into the group, arrow keys move selection, Enter activates; `aria-pressed`. Zoom toggles 1x/1.4x only at integer-safe stops: "Zoom" switches between the base zoom and base+1 (e.g. 3x to 4x), never 1.4 pixel scale; the label reads `Zoom` with a magnifier glyph, not a number. On phone this group collapses to one 44 px button cycling Left > Mid > Right.

### 8.4 Calm mode toggle and clock
Toggle: 36 px pill switch with a leaf glyph, label "Calm mode" (14/20 sans, desktop), `role="switch"`, on = `--primary` track. Applies reduced-motion variants; persisted in `localStorage` (try/catch). Clock chip: pixel font 16 px `HH:MM`, a 12 px moon/sun glyph, `tabular-nums`, `aria-label="Village time 9:41 pm, night"`; updates once a minute (no ticking animation).

### 8.5 Live / Replay badge
24 px high pill, 12/16 sans 600, caps tracking `0.06em`: Live = `ok` dot + "Live"; Replay = `violet` dot + "Replay". Opacity crossfade 150 ms. Never pulses.

### 8.6 Agent dock and side panel
- **Side panel (desktop):** 320 px wide, right edge, inset 12 px, radius 16, `--card`, `--shadow-3`, header "Agents and places" (18/28 600) with a collapse chevron button (44 hit); body is the one accessible `AgentList` (spec 06): rows 56 px: 32 px portrait, name 14/20 500, state line 12/16 `--muted-foreground` with the state glyph, trailing action button ("Join call", "Open"). Collapse is `translateX(calc(100% + 12px))` 280 ms `--ease-drawer`; exit mirrors; reduced motion = opacity only. Focus returns to the toggle.
- **Dock (phone):** bottom, height 64 + safe-bottom, `--hud-bg` blur, top hairline; horizontal scroll-snap strip of 56 px chips (same as 8.2 but 48 px portrait) with 12 px gaps, 16 px side padding, fade mask on the edges (mask-image, no extra layers). Tap = walk and focus; the focused chip lifts 4 px (transform) and shows its label.

### 8.7 Call panel
Over the canvas, `.sq-scene`. Desktop: a 400 px wide card docked bottom-right above the HUD gap (right 24, bottom 24), radius 16, `--card`, 1 px `--border`, `--shadow-3`; phone: full-screen sheet from the bottom (`translateY(100%)` to 0, 280 ms `--ease-drawer`, safe-area padded, drag handle 36x4). Anatomy top to bottom:
1. Header 56 px: 32 px portrait, agent name (18/28 600) and role (12/16 muted), state "Live call" with `ok` dot, close `x` icon button (44 hit).
2. Stage 160 px high (desktop) / 28% of height (phone): the portrait enlarged to exactly 4x or 6x native on a `sky-deep` plate with a stepped rounded frame; while speaking: 2-frame mouth swap at 8 fps, 2 px bob, and a glow ring behind the portrait whose opacity follows smoothed amplitude (opacity only; static ring under reduced motion). Below it a waveform: 32 bars, 3 px wide, 3 px gap, max 28 px high, `--sq-cloud-hi` (speaking) / `--sq-hill-mid` (silent), drawn on canvas or via transform scaleY with 60 ms linear steps; flat line when muted.
3. Captions region (aria-live polite), 16/24 sans, up to 3 lines, `--foreground`; each sentence appears whole and stays at least 1.2 s per 20 chars; a citation chip after the sentence: `slides.pdf p.12` 12/16 sans 500, `--secondary` background, radius 6, 4/8 padding, a 12 px page glyph, focusable, opens the source. Earlier sentences fade to `--muted-foreground` at 150 ms.
4. Controls row 72 px: Mute (toggle, 48 px circle `--secondary`; muted = `alert` glyph and "Muted" label), Raise hand (48 px circle, pressed = `glow` outline), Leave (primary-destructive pill, `--destructive` fill, white text "Leave", 48 px high min width 96). Order: Mute, Raise hand, spacer, Leave. Labels under icons 12/16 on desktop.
Group variant: a row of up to 5 small 24 px student sprites standing on a plank under the stage.
States: connecting (skeleton waveform, "Connecting to Dean..."), agent offline ("Dean is offline. Leave a question and they will answer in iMessage." with a primary button), error (red `--destructive-text` notice with Retry), ended ("Call ended", auto-close after 2 s).

### 8.8 Quiz card
Interior scene or sheet; chalkboard frame is a sprite (48x32 native) placed behind a DOM card so text stays accessible. Card: 560 max width (full width minus 32 on phone), `--card`, radius 16, padding 24 (20 phone). Header row: "Ch 5 · Q2 of 5" (12/16 caps `--muted-foreground`) and a 5-step progress made of 5 pills 16x4 px (filled `--primary`, empty `--border`); no score, no grade, no streak. Question: 22/30 sans 600. Answers: stacked full-width buttons 56 px high (min), radius 10, `--secondary`, 1 px border, 16/24 text, a 28 px leading letter badge (A/B/C/D in pixel font 16). Hover (fine pointers) `--accent`; selected = 2 px `--sq-sky-low` border and `--accent` fill (not amber). After submit: correct/incorrect feedback is a **color change only** over 150 ms (border `--success`/`--destructive`, text stays foreground) plus an icon (check or cross) and the words "Recorded" or "Not quite", never a grade; if the squad setting hides correctness the banner says only "Answer recorded". Free-text variant: a 3-line textarea, 16/24, with "Submit" primary button. "Next" appears after feedback; Enter submits, Esc closes with confirm if unanswered. Chalk tick/cross on the board is the sprite from `composed/props/chalk-tick.png`.

### 8.9 Ledger / notice board (Glass Box)
- **In world:** the notice board sprite (64x48) at the commons; new entries appear as 16x12 cards pinned in a 3-column grid (slots listed in the manifest): shared = green tick card with a 2 px field label, hidden = padlock and a static black bar, blocked = red stop mark. A new card slides in with 200 ms `--ease-out` (translateY 6 px, opacity). Withheld text is never rendered; the bar is a texture, not an animation.
- **Overlay/page:** columns per agent, newest on top. Entry row 56 px: 20 px status icon, field label (14/20 500), shared text (14/20, `--muted-foreground`) or "hidden" with a padlock in `--muted-foreground`; blocked rows have a 3 px `--destructive` left rule and the words "Blocked by privacy gate". Header: "Glass Box" 22/30, task title, live dot, a segmented `Me | Projector` (projector = larger type: 18/28 rows). Empty state: "Nothing shared yet. Agents will post here when they start talking." with the board sprite at 3x. Withheld values must not exist anywhere in the DOM.

### 8.10 Speech and thought bubbles (canvas)
Rendered from the 9-slice sprites in `composed/props/bubble-*.png` (corner 3 px, 1 px `ink` outline, fill `wall-lit` for speech, `moon` for thought, `violet` outline for council thought, `alert` outline for the dissenting bubble). Text: pixel font at native size x zoom, `ink` color, 1 line up to 20 chars wide wrapping to at most 3 lines (max 60 chars shown; the rest in DOM captions), padding 4 art px horizontal and 3 vertical, tail 5x4 art px pointing at the speaker, bubble centered over the head, 6 art px gap, clamped inside the camera view with 4 px margin. Appear: scale 0.95 to 1 and alpha 0 to 1 over 160 ms `ease-out` from the tail point; exit 120 ms; stays at least 1.2 s per 20 characters; pool at most 12. Thought bubbles use two trailing dots instead of a tail. The "!" marker is the 8x14 sprite, spring 0.35 s bounce 0.2, red tint holds; it never names the vetoer.

### 8.11 Door ring (waiting for yes)
A 24x12 art-pixel ellipse ring sprite (3 sizes) in `ember` on the ground in front of the agent's door. Pulse: scale 1 to 1.15 and alpha 0.6 to 0 over 1.6 s `ease-out`, looped; reduced motion: static ring at alpha 0.7 plus a pixel label "waiting" (16 px) above the door. On yes: the ring is replaced by a 12x12 `ok` check revealed by a left-to-right mask in 200 ms `ease-out`, the lock frame swaps to open, and a small tick plays; then the ring is removed. The chip in the HUD shows the matching `waiting` state.

### 8.12 Toasts
Bottom center on desktop (bottom 24 above the dock gap, width up to 420) and above the dock on phone (bottom: dock height + 12). One at a time visible plus one queued; max 4 s (6 s with an action); never auto-dismiss errors with actions. Card `--popover`, 1 px `--border`, `--shadow-2`, radius 12, padding 12 16, 14/20 text, a 16 px state icon (info `violet`, ok, warn `ember`, error `alert`), optional text button ("Undo", "Retry") 44 hit. Enter: `translateY(8px) scale(0.95)` opacity 0 to rest in 200 ms `--ease-out`; exit 150 ms opacity and translateY(4px). `role="status"` (errors `role="alert"`). Paused while hovered or focused.

### 8.13 Buttons, inputs, and other controls
Primary: `--primary` fill, `--primary-foreground` text, radius 8, height 40 (48 touch), 14/20 500. Secondary: `--secondary` fill, 1 px `--border`. Ghost: transparent, `--accent` on hover. Destructive: `--destructive` fill. Disabled: 50% opacity, no pointer. Press: scale 0.97. Loading: label stays, a 14 px spinner replaces the leading icon (spinner is a 2-frame pixel-style dot trio, not a rotating ring). Inputs: height 44, radius 8, `--input` border, `--card` fill, 16 px text (prevents iOS zoom), focus ring 2 px.

### 8.14 Empty, loading, error, offline (all screens)
Each has a designed state with a sprite: loading = campfire 4-frame loop (static under reduced motion) and "Loading village..." with a 3-dot step; empty = the relevant landmark in `_locked` form with a one-line invitation; error = a small red "!" marker with plain cause and a Retry; agent offline = the agent's portrait desaturated (palette-mapped to `hill-*`) with "{Name} is offline".

## 9. Motion (summary; 08 is canonical)
Gate first (frequency tier + one named purpose or no animation). Walking is never eased: constant speed, instant start, 80 ms ease-out stop, whole pixels, 4-frame cycle at 8 fps, no camera lag on keys. Rare delight only: trip cutscene and first arrival. Words never move for style. Three curves only. UI under 300 ms. Everything has a reduced-motion variant (fewer and gentler, not zero) and a Calm mode. Nothing flashes more than 3x per second. Use `tokens.ts` (`easeOut`, `easeInOut`, `easeDrawer`, `springEase`, `walk`) for Phaser tweens and `tokens.css` variables for DOM.

## 10. Do and don't (cheap game-UI clichés)

Don't:
- XP bars, level badges, streak flames, trophies, confetti, coin sprites, "+10!" pops, leaderboards (spec 08, and the product has no scores).
- Fantasy chrome: stone/wood 9-slice frames around modern panels, parchment textures, gold bevels, runic fonts, sword/shield icons.
- Neon outline glows, scanlines, CRT curvature, chromatic aberration, glitch text, "retro" CRT filter on the canvas.
- Pixel font for paragraphs or below its native grid; fake pixel font via CSS `text-shadow`; mixed pixel sizes in one screen.
- Drop shadows on pixel sprites in DOM; rotated sprites (rotation breaks pixels) except the windmill sail strip frames; sub-pixel positions; non-integer zoom; `image-rendering: auto` anywhere.
- Rainbow gradients, glassmorphism on everything, emoji as UI icons, Fluent 3D art inside the world.
- All-caps shouting labels; 'LEVEL UP' energy; "Epic", "Quest" copy; exclamation marks in system text.
- Bouncing, wobbling or shaking idle UI; looping decorative motion on chrome; hover-only affordances on touch.
- Placing night art on white; semi-transparent sprite edges; mixing Ninja Adventure 16 px figures into the scene.
Do:
- Let the world do the delight (smoke, lit windows, the campfire, fireflies at most 6) and keep the chrome quiet.
- Use warm light only for things that are alive or active; use violet only for council/thinking.
- Keep one outline weight, one light direction, one palette; check every new asset beside the street preview.
- Label every state with text and an icon; keep touch targets 44 px; keep text 16 px where it must be read.
- Keep copy plain and kind, and make every empty/error state feel designed.
- Verify with screenshots at 390 and 1280, light and dark, using `review-rubric.md`.

## 11. Ownership and files
- Art (composed): `assets/pixel/composed/**` (buildings, props, fx, ui, characters, backgrounds, `scripts/`). Regenerate everything: `python3 assets/pixel/composed/scripts/make_all.py` (calls each maker).
- Packs and licenses: `assets/pixel/LICENSES.md`; composed art inherits the licenses of its sources (listed per file in `asset-manifest.md`). Credit line: "World art: Nirva (Autumn Town), Pixel-boy and AAA (Ninja Adventure), Kenney, OpenGameArt authors, CC0 or free-to-use; recolored and composed by Squad. UI icons: Microsoft Fluent Emoji 3D (MIT), Lucide (ISC)."
- Changes to the palette or tokens go through this folder only; UI workstreams import `tokens.css`/`tokens.ts`, they do not copy values.
