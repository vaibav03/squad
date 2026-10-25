# Sprite and portrait API (workstream media-art), format v2

Status: v2 (rebased onto the design-foundation cast; v1 24 px chibi cells are gone). Source of truth is `assets/sprites/**` on `ws/media-art`; consumers read it from `origin/ws/media-art` and stub until merged. The art is the foundation renderer's 32x32 side-view cast plus our extension characters, so one outline, one proportion and one lighting language everywhere. Every pixel is on the 28-colour master palette (`docs/design/palette.json`), alpha is 0 or 255, 1 px ink outline, integer zoom only (DESIGN.md section 2).

## Files

```
assets/sprites/
  cast.png            ONE combined atlas for the whole roster (village loads this)
  cast.json           Phaser JSON Hash atlas + "animations" table (same shape as assets/pixel/composed/characters/atlas.json)
  cast.meta.json      roster: id, role, spec, headTop; anim fps table
  <id>/idle.png walk.png talk.png sit.png wave.png   per-persona strips, 32 px per frame, left to right
  <id>/portrait.png   32x32 native portrait (opaque sky-mid plate with ink frame)
  <id>/portrait@2x.png @3x @4x    nearest-neighbour integer upscales for DOM chrome
  <id>/frames.json    per-persona atlas (below)
  <id>/hello.gif talk.gif   iMessage GIFs
  wall/persona-wall.html, wall-dark.png, wall-light.png   review wall
  _contact-*.png      review contact sheets
```
Rebuild everything deterministically: `pnpm --filter @squad/media build:sprites` (python3 + Pillow; byte-identical output, build asserts palette-only, no empty frames, no dead cycles).

## Cell, anchor, facing

- Every frame is a 32 x 32 cell; the figure is about 28 px tall (Autumn Town scale). Native size, never resample; integer zoom only (`pixelArt:true`, `roundPixels:true`).
- Anchor = feet, `{x:16, y:31}`; Phaser origin `(0.5, 1.0)` (the atlas sets `pivot` for you). Feet sit on the walk line.
- Characters face RIGHT in art; flip with `flipX` for left (the engine flips; light stays upper-left, accepted).
- Per persona `frames.json` also gives `anchors.head` (top-most opaque pixel of idle_0, native cell coords) and `anchors.bubble` (3 px above it): put name tags and speech bubbles there.

## Frame names and animations (identical for every persona)

Atlas keys: `<id>/<anim>/<n>` and `<id>/portrait`. Animation keys: `<id>/<anim>`.

| anim | frames | fps | notes |
|---|---|---|---|
| `idle` | 2 | 2 | breathing, 1 px drop |
| `walk` | 4 | 8 | contact, passing, contact, passing; planted foot moves 3 px per frame, so set ground speed = 24 px/s at 8 fps (no foot slide) |
| `talk` | 2 | 8 | mouth open/closed plus a hand gesture; motion spec adds the 2 px bob and glow ring |
| `sit` | 2 | 2 | seated at a desk/campfire |
| `wave` | 2 | 4 | greeting, used for entrances |

All animations loop (`repeat: -1`). Example keys: `student-03/walk/2`, `cubbie/talk/1`, `dean/portrait`.

## Roster (ids are stable)

`cubbie` (bear mascot), `examiner`, `dean`, `expert-ada` `expert-sage` `expert-monk` `expert-mage` (chapter experts rotate through these four), `rival`, `council-chill` `council-grind` `council-advisor`, `chairman`, `feynman` (the freshman), `student-01`..`student-06` (the six picker avatars), plus the foundation NPCs `mediator` and `ta`.
Mapping to the foundation's own ids (same pixels): `expert-ada` = expert, `council-grind` = council-hard, `council-advisor` = council-balance, `feynman` = freshman, `student-01` = student, `council-chill`/`examiner`/`dean`/`chairman`/`mediator`/`ta` unchanged. Village code may use either atlas; this one is a superset keyed by persona id and is what the registry points at.

## How the village loads it

```ts
// preload
this.load.atlas('cast', '/assets/sprites/cast.png', '/assets/sprites/cast.json');
// create (pure data helper, no Phaser import)
import { phaserAnims } from '@squad/media/sprites';
for (const a of phaserAnims('cubbie')) this.anims.create(a);            // keys: "cubbie/walk", "cubbie/talk", ...
const s = this.add.sprite(x, y, 'cast', 'cubbie/idle/0').setOrigin(0.5, 1);
s.play('cubbie/walk');  s.setFlipX(goingLeft);                          // ground speed 24 px/s
```
`phaserAnims(id)` returns `{ key, frames: [{ key: 'cast', frame: '<id>/<anim>/<n>' }], frameRate, repeat }[]`; `cast.json.animations` carries the same data for plain JSON consumers.
Speaking: alternate `talk` (8 fps) while a `call.caption` audio plays, back to `idle` 1 s after the audio ends; the glow ring, 2 px bob and bubble come from the motion spec.

## How the web loads it

```tsx
import { getPersona } from '@squad/media/personas';
const p = getPersona('cubbie');
p.portrait;    // "assets/sprites/cubbie/portrait.png" (32x32; render at 2x/3x with image-rendering: pixelated)
p.spriteSheet; // "assets/sprites/cubbie/frames.json"
```
Portraits are opaque tiles; per DESIGN.md light pages, show them on their own `sky-deep` plate (the portrait already carries its own plate and ink frame). `fluentPortrait` (optional) points at the Fluent 3D art in `assets/fluent-characters/**` for small chrome icons only; the default is the pixel portrait so village, picker and ledger share one look (deviation from spec 05, one field to flip).
DOM sprite animation without Phaser: CSS `background-image: url(walk.png)` at `width: 32*px`, `animation: steps(4)`, see `assets/sprites/wall/persona-wall.html`.

## Per-persona `frames.json`

```jsonc
{ "version": 2, "id": "cubbie", "cell": {"w":32,"h":32}, "facing": "right",
  "anchors": { "feet": {"x":16,"y":31}, "head": {"x":16,"y":3}, "bubble": {"x":16,"y":0} },
  "portrait": "portrait.png",
  "frames": { "walk/0": { "strip": "walk.png", "x": 0, "y": 0, "w": 32, "h": 32 } /* ... */ },
  "anims":  { "walk": { "frames": ["walk/0","walk/1","walk/2","walk/3"], "frameRate": 8, "repeat": -1 } } }
```

## iMessage GIFs

`<id>/hello.gif` (wave, then talk, ~2 s loop) and `<id>/talk.gif` (talk pair with a speech-bubble), nearest-neighbour integer scale on a `sky-deep` card, under 400 KB, built from the frames with ffmpeg: `pnpm --filter @squad/media build:gifs`.

## Top-down campus readiness (format v3, planned move from the side-view village)

The owner will later move to a top-down interior campus (Modern Interiors style, 4-direction walking). Nothing top-down is drawn yet; the pipeline, schema and registry are ready.

- **Atlas schema.** `FramesFileSchema` accepts `version: 2 | 3`. A v2 file is `view: "side"` (default, faces right, anims keyed `walk`). A v3 `view: "topdown4"` file lists `directions` (all of `down`, `up`, `left`, `right`), keys anims `<anim>/<dir>` (`walk/down`, `idle/left`, ...) and names frames `<anim>/<dir>/<n>`. Validation requires `idle/<dir>` and `walk/<dir>` for every direction. `animKey(file, 'walk', dir)` returns the right key for either view, so scene code can be written once. Cell size is free (Modern Interiors is 16x32 per frame); anchor `feet` still marks the ground point, `head`/`bubble` still place tags.
- **Registry.** `MediaPersona.spriteSource` (optional) is `{kind:'generated', view}` (default, the cast in `assets/sprites`) or `{kind:'imported', view, path:'assets/vendor/<pack>/...', framesFile}`. `path` must start with `assets/vendor/`, which is gitignored (local licensed packs only, never committed). `spriteSheet` remains the generated fallback.
- **Resolver.** `resolveSprites(id, persona.spriteSource)` from `@squad/media/sprites` returns `{framesPath, fellBack}`; a missing vendor pack falls back to the generated side cast so a fresh clone never breaks.
- **Import recipe.** Drop the pack in `assets/vendor/<pack>/`, write a v3 `frames.json` next to it (a small script mapping the pack's rows to `walk/down` etc.), then set `spriteSource` on the personas (via `upsertPersona` or `data.ts`). Portraits stay the pixel portraits.
- Tests: `src/sprites/topdown.test.ts` covers v2 compatibility, a synthetic 4-direction v3 file, missing-direction rejection, fallback and the vendor-path rule.
