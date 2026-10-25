# Sprite and portrait API (workstream media-art)

Status: format v1, frozen unless a consumer asks. Source of truth is `assets/sprites/**` on `ws/media-art`; consumers read it from `origin/ws/media-art` and stub until merged. All art is palette-locked to the 28-colour master palette (`docs/design/palette.json`), 1 px ink outline, integer scaling only.

## Files

```
assets/sprites/
  cast.png            one combined atlas image for the whole cast (village loads this)
  cast.json           Phaser "JSON Hash" atlas for cast.png (load with this.load.atlas)
  cast.meta.json      cast roster: ids, roles, anchors, anim table (same data as below, merged)
  <id>/sheet.png      per-persona strip: frames laid out left-to-right in the order of frames.json
  <id>/frames.json    per-persona atlas, see below
  <id>/portrait.png   native-size pixel portrait, 38x38, transparent background
  <id>/portrait@2x.png  @3x @4x @6x   nearest-neighbour integer upscales, for UI chrome
  wall/persona-wall.html  + wall-light.png, wall-dark.png   review sheets
```

## Cell and anchors

- Every frame is a 24 x 24 cell (the 16 px character stands in the lower-middle, headroom is for hats, props, bubbles).
- Native size: do not resample. Use integer zoom only (Phaser camera zoom or `setScale(n)`), `pixelArt: true`, `roundPixels: true`, CSS `image-rendering: pixelated`.
- Anchors are in cell pixels (origin top-left) and are identical on every frame of one persona:
  - `feet`  {x:12, y:23}  stand point. Phaser origin = (0.5, 23/24). Place this on the walk line.
  - `head`  {x:12, y:9}   top of the head. Name tags and speech bubbles go 3 px above (`bubble` {x:12,y:5}).
  - `hand`  {x:17, y:17}  right-hand point for props (lantern, book).
  - `door`  {x:12, y:23}  same as feet; used when an agent stands at its door.
- `cast.json` frames carry `pivot: {x:0.5, y:0.9583}` so Phaser uses the feet as origin automatically.

## Directions

`r` = side view facing right (flip with `flipX` for left, art is lit from the upper left and the flip is accepted), `f` = front view (facing the viewer; used for talking, doors, portraits-in-world).

## Frame names (stable, identical for every persona)

`<id>/<anim>_<dir>_<n>`

| anim | dir | frames | fps | loop |
|---|---|---|---|---|
| `idle` | r, f | 2 (`_0`, `_1`; breathing, 1 px drop) | 2 | yes |
| `walk` | r, f | 4 (`_0`..`_3`) | 8 | yes |
| `talk` | r, f | 2 (`_0`, `_1`; mouth/hands pair, swap at 8 fps; motion spec adds the 2 px bob and glow) | 8 | yes |

Example: `student-03/walk_r_2`, `cubbie/talk_f_1`. In `cast.json` the key is exactly this string.

## Per-persona `frames.json`

```jsonc
{
  "version": 1,
  "id": "cubbie",
  "cell": { "w": 24, "h": 24 },
  "image": "sheet.png",
  "anchors": { "feet": {"x":12,"y":23}, "head": {"x":12,"y":9}, "bubble": {"x":12,"y":5}, "hand": {"x":17,"y":17} },
  "frames": { "idle_r_0": { "x": 0, "y": 0, "w": 24, "h": 24 } /* ... */ },
  "anims": { "idle_r": { "frames": ["idle_r_0","idle_r_1"], "fps": 2, "loop": true } /* walk_*, talk_* */ }
}
```
`frames` keys in the per-persona file are unprefixed; in `cast.json` they are prefixed with `<id>/`.

## How the village loads it

```ts
// preload
this.load.atlas('cast', '/assets/sprites/cast.png', '/assets/sprites/cast.json');
// create: one helper builds all anims for a persona
import { phaserAnims } from '@squad/media/sprites';   // pure data, no Phaser import
for (const a of phaserAnims('cubbie')) this.anims.create({ ...a, key: a.key });  // key e.g. "cubbie/walk_r"
sprite = this.add.sprite(x, y, 'cast', 'cubbie/idle_r_0').setOrigin(0.5, 23/24);
sprite.play('cubbie/walk_r');          // left: sprite.setFlipX(true)
```
`phaserAnims(id)` returns `{ key, frames: [{key:'cast', frame:'<id>/<name>'}], frameRate, repeat }[]`.
Speaking: swap `talk_f_0/1` (or `talk_r_*`) at 8 fps while `call.caption` audio plays; return to `idle_*` 1 s after audio ends.

## How the web loads it

```tsx
import { listPersonas, getPersona } from '@squad/media/personas';
const p = getPersona('cubbie');
p.portrait       // "assets/sprites/cubbie/portrait.png" (38x38 native; use <img class="pixelated" width={38*4}>) 
p.spriteSheet    // "assets/sprites/cubbie/frames.json"
```
The portrait pack also has `@2x/@3x/@4x/@6x` files; a CSS `image-rendering: pixelated` upscale of `portrait.png` is identical. Fluent 3D art stays available at `assets/fluent-characters/**` and each persona keeps an optional `fluentPortrait` path, but the default portrait is pixel art so the village, picker and ledger share one look. (Deviation from spec 05: portraits are the pack's hand-drawn Faceset art, quantized to the master palette, instead of Fluent 3D stickers. Say so if you need the Fluent default back; it is one field.)

## Roster (ids are stable)

`cubbie`, `examiner`, `dean`, `expert-ada`, `expert-sage`, `expert-monk`, `expert-mage` (chapter experts rotate through these four), `rival`, `council-chill`, `council-grind`, `council-advisor`, `chairman`, `feynman`, `student-01` .. `student-06` (match the six avatars in the persona picker).

## iMessage GIFs

`assets/sprites/<id>/hello.gif` (idle/wave loop) and `talk.gif`, nearest-neighbour 6x, transparent-safe dark card background.

## Determinism

`python3 packages/media/src/sprites/build/build_cast.py` rebuilds everything byte-for-byte (no randomness, no timestamps). `pnpm --filter @squad/media test` validates atlas shape, palette lock, anchors and frame bounds.
