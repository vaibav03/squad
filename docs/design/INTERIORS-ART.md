# Interiors art direction (Squad Campus)

Status: plan, pairs with `docs/specs/10-interior-campus.md`. Replaces section 1 (night village mood) and the world palette of `DESIGN.md` **for the world canvas only**. The HUD, overlays and pages keep the existing `tokens.css` / `tokens.ts`, type and motion rules unchanged.

## Reference
The owner's image: a cozy classroom/daycare, seen from above at a slight three-quarter angle (walls show their front face, floors are flat). Tiled floor, wooden desks, low shelves, play mats, round tables, potted plants, a chalkboard, small characters, rooms divided by walls with doorways. Daylight, soft and warm, no harsh shadows. It should feel lived-in and tidy, never sterile.

## Scale
- **16 px tile grid**, characters about 16x32 (one tile wide, two tall; head about 12 px). Doors are 2 tiles tall in the wall face. Never mix 16 and 32 px sprites in one frame; no sprite is scaled inside the atlas.
- Display: integer zoom only (3x at CSS width >= 900, else 2x), `pixelArt: true`, `roundPixels: true`, CSS `image-rendering: pixelated`, DPR rule from `DESIGN.md` section 2 item 3. At 1280x720 and zoom 3 the view is about 426x240 native: a 14x8 tile room fills the screen.
- Camera follows the player with whole-pixel positions; room-bounds clamp so the view never shows void beyond the outer wall.

## Palette discipline
- **World art uses only the pack's own colors** (Modern Interiors is a soft, slightly desaturated warm palette: cream and tan floors, warm wood, muted teal and pastel accents, dark brown-purple outlines). Task I-0 extracts it to `docs/design/palette-interiors.json` (median-cut over the free sample, capped at about 48 colors); that file, not hand-picked hex, is the source of truth.
- **No recoloring beyond what the pack ships**: use its variants (floor and wall sets, furniture colorways). Tints by the engine are limited to a 4-step daylight/dusk overlay.
- **The 28-color night palette is retired for the world**; it stays for DOM chrome. Do not paint world sprites with `sky-deep` etc.
- **Fallback tiers** (CC0 assets, placeholder tileset) are dev/CI only; they must not be screenshotted for the README or demo.
- Warm/cool budget: floors and wood warm, walls and cloth cool accents, roughly 60/40. Semantic marks (red "!", green confirm, lock icon) reuse `--sq-alert` / `--sq-ok` / `--sq-glow` at 1 px ink outline so they read on any floor.
- Each room gets one **accent color family** (classroom teal, library deep wood and green, cafeteria warm orange, infirmary soft white and mint, council violet touches) from pack variants, so rooms are recognizable from the doorway.

## Lighting
- Default is daytime ambient: no per-pixel lighting, no hard cast shadows. Furniture uses the pack's baked soft shadow (the "shadowless" variants exist; use shadowed for props on floors, shadowless where props overlap).
- Light cues are sprite-level: lit lamps and windows (2-frame glow), the chalkboard glowing when a quiz is open, classroom lamp brightness for mastery (3 steps), Infirmary and Panic Line lit warmly only at the student's late hours, and a dim vignette in locked private rooms.
- Night is a **whole-map overlay**: multiply tint (`ink` at about 25%) plus window glow, optional, tied to the real clock and Calm mode off. Never darken the HUD.

## Characters
- 4 directions, 6-frame walk at 8 fps with the planted foot moving a constant amount per frame (no sliding), idle (2 frames), read, sit, talk, wave. Generated from the pack's body, outfit, hairstyle layers (in that order) by script; one outfit palette per agent role so roles read at a glance (experts in teacher-style outfits, council in matching jackets, mediator in a distinct tabard color).
- Students/personas are distinguished by hair and outfit; names and state chips live in the DOM HUD, not baked into sprites. A 1 px dark outline (the pack's) stays; never add white outlines.
- Held objects (envelope, book) are separate 1-tile overlay sprites on the hands so they can be reused for any agent.

## Rooms and dressing
- Every room: wall face along the top edge (2 tiles), floor, a clear 3-tile path from each doorway to its focal prop, a rug or mat under the focal prop, 2 plants, one window or poster per wall. Props sit on the grid; no half-tile offsets except rugs.
- Focal props: classroom = chalkboard plus teacher desk and rows of desks; Council = round table with 4 seats; Debate Hall = two lecterns and tiered seating; Library = tall shelves and a reading nook; Cafeteria = long tables; Infirmary = bed and phone; Exam Room = one chair, examiner desk; Reception = front desk and a large notice board (the ledger, where the DOM overlay anchors).
- Keep corridors and the Commons uncluttered so pathfinding looks natural; leave 1-tile clearance around doors.

## HUD, overlays and tokens
- Canvas is only the world. HUD chips, camera/zoom buttons, Calm toggle, call, quiz, ledger and the Go-to menu are DOM and keep the existing dark glass tokens (`--sq-*`, `--popover`, hairline borders, amber accent), type (`typography.md`), and motion (08). The dark glass floats over bright interiors; verify contrast over the lightest floor (add the existing 1 px hairline and a subtle backdrop if needed).
- Pixel font only for in-world labels (door signs, notice-board header) at integer art pixels; long text stays in DOM.
- Overlay panels open from the same edges as in 08; the canvas dims by at most 40% behind a modal sheet, no blur.
- Credits line in the footer: "World art: Modern Interiors by LimeZu" when the pack is active (else the active CC0 pack names).

## Review checklist (for the design prompt's E step)
One tile size; palette matches `palette-interiors.json`; no sprite taller than 2 tiles except furniture meant to be; y-sort correct at every doorway; characters never clip walls; every room recognizable from its doorway; HUD readable over the lightest and darkest floor; Calm and reduced-motion variants exist; no scores or streaks anywhere.
