# village-scenes: buildings half of the village (ws/village-scenes)

Owner: village-scenes lead. Code: `packages/village/src/scenes/**` (nothing else). Phaser-free core + a thin Phaser module (`scenes/module.ts`) that plugs into the world per `docs/village-api.md`.

## Model
A building is a `SceneDef<S>` (`scenes/contract.ts`): pure `init`, `handles`, `mapEvent` (VillageEvent -> `SceneCommand[]`), `reduce` (command -> state, with a timestamp), `paint(state, view, {t, calm}) -> Raster` for `exterior` and `interior`, and `describe` (one plain sentence, feeds the a11y list). Frames are a pure function of (state, view, t): deterministic, so frame capture and tests are exact. Shared state/reducer: `model/base.ts`. Event routing: `routing.ts` + `model/events.ts`.

## Art rules (the bar)
- Pixel art painted in code with `pixel/raster.ts`: master palette only (28 colours, `pixel/palette.ts`); opaque pixels must be on-palette (`offPalette(raster) === 0` for the BASE art; translucent light/glow passes are allowed on top).
- 1 logical px = 1 world px; whole pixels only; ink (#070f1f) 1px outline on silhouettes; light from the warm windows/lamps (glow/glow-core/ember) against the cool night (sky/hill/wall-shade). Reference: `docs/design/references/collage-user-references.png` bottom-left (the night house with lit windows and chimney smoke) and the pixel office (bottom-right) for interiors: dense, tidy, cosy, props everywhere, readable at a glance.
- Each building has a DISTINCT silhouette (roof shape, height, materials) readable as a black cut-out at 25% size. Sizes: exterior sprite width = slot footprint + up to 8 px overhang, height <= 96. Feet on the bottom row; `door` anchor on the bottom row.
- Interiors are cutaways (front view, back wall + floor + side walls cut open), 192x112 up to 256x136, floor line obvious, furniture on the floor, NPCs 12x17 from `art/npc.ts` (use `npc(spec,pose,frame)`), bubbles from `art/bubble.ts`.
- Text on signs/chalkboards uses `pixel/font.ts` (3x5) only, short (<= 12 chars on signs).
- Motion per `docs/specs/08-village-motion.md`: curves from `curves.ts` only (ease-out, ease-in-out, ease-drawer), walking/loops use `frameAt` (idle 2 fps, work 8 fps), window flicker alpha 0.85..1 over 4 s, lantern 3-frame 2 s loop, ring 1.6 s, bubbles 160 ms in / 120 ms out, words never move, bubble hold >= 1.2 s per 20 chars. `calm: true` => steady lights, no bob, no pulse (fade-only). Never flash more than 3 times a second.
- Locked/dimmed until relevant: `access` 'locked' = shutters/boards across windows, no light, padlock-free (a plain shuttered look); 'dim' = visible but cold and unlit; 'open' = alive. A building becomes 'open' when its first relevant event arrives (mapEvent emits `setAccess open` first).
- Privacy: bubbles/signs/chalk show only text carried by the event's public fields. Never render withheld values; `ledger.entry` is not ours. Tests assert a sentinel (use `@squad/core` sentinel helper if present, else "$180" / "therapy") never reaches a painted text or `describe`.
- No placeholder boxes, no "TODO", no lorem. Chapter ids and names come from events; fall back to "Chapter N" derived from the id.

## Layout of each family (you own your dir only)
`scenes/<family>/index.ts` exports `bundle(s)`: `SceneBundle` (def + `shots`) and the def. Put tests in `scenes/<family>/*.test.ts` (vitest, no Phaser, no DOM). Do NOT edit `scenes/index.ts`, `contract.ts`, `model/*`, `pixel/*`, `art/{npc,bubble,backdrop}.ts`, `routing.ts` (lead-owned); if you need a change, put the request in your final report. You MAY add new files under `art/` named `art/<yourfamily>-*.ts` for your own helpers, and new shared pieces under your own dir. Do not git commit or push; the lead commits.

## Required tests per scene
1. `mapEvent` unit tests for every relevant VillageEvent (exact commands), plus ignoring unrelated events and malformed ones (never throw).
2. `reduce`/`paint` determinism: same inputs => same `raster.hash()`; different states (lit vs dim, glow low vs high, bubble present vs absent, locked vs open) => different hashes in both views.
3. Palette lock for base art; no withheld sentinel; `describe` returns a non-empty sentence per state.
4. calm: `paint(..., {calm:true})` identical at t=0 and t=1000 for ambient loops.

## Frames
`pnpm --filter @squad/village capture <sceneId>` (after the lead wires your bundle into `scenes/index.ts`; until then run your own script via `npx tsx` using `scenes/tools/capture.ts` `captureBundle(bundle, outDir)`). Write scratch frames to the session scratchpad or `docs/design/shots/village-scenes/<family>/`. Open the PNG with the Read tool and critique it like an art director against the reference; iterate at least 3 rounds (silhouette, light, props density, palette harmony, edge pixels, text legibility). Shots (`ShotDef`) must cover: exterior locked/dim/open, lit and mastery low/mid/high (houses), interior idle and in-call, bubbles mid-sequence, and the night glow.

## Agent id conventions (routing.ts)
`expert:<chapter>` chapter house; `council:quizkey` Council Hall; `council:planner` Round Table; `council:debate` Debate Stage; `expert:feynman` Feynman Porch; `expert:stepdiff|panic` Panic Line; `expert:oral|examiner` Oral Exam Hut; `expert:rubric` Rubric Courthouse; `expert:oracle` Exam Oracle; `expert:devil|devils-ta` Devil's TA. Members: planner chill/grind/advisor + chair; quizkey solver-a/b/c + chair.

## Composed art (supersedes "Art rules" about procedural sprites)
The village uses the design foundation's art (`assets/pixel/composed/**`, ids in `assets/asset-manifest.json`), native 1x, one scale: door ~32 px, cast 32x32 cells (figure ~28 px, faces right, anchor [16,31]), interiors 224x128 canvases with the floor line at y=112. Painters compose Rasters from `PaintOpts.assets` (`scenes/assets.ts`):
- `assets.image('landmark.council-hall' | 'house.hut', variant?)` -> `{r, ax, ay}`; variants: houses `lit|dark`, landmarks `active|locked` (booth `off|glow|locked`); `assets.frame(persona, anim, n)` cast frame (personas: student, dean, expert, council-chill, council-hard, council-balance, chairman, examiner, mediator, ta, freshman; anims idle/walk/talk/sit/wave); `assets.sheet('fx.chimney-smoke', n)`; `put(raster, asset, x, y, {flipX, alpha})` blits with the anchor on (x,y).
- Exterior raster = the base sprite's box (+ margin for overlays); bottom row is the ground. Interior raster = 224x128. `SceneDef.exterior/interior/door/entry` must match.
- States: open = active/lit art; dim = active art through `raster.remap(DIM)` (cached clone, no warm lights); locked = `locked` variant + `ui.padlock` at the door. Lit window flicker = crossfade the lit variant over the dark one, alpha 0.85..1 over 4 s (calm: steady).
- UI sprites from the manifest (`ui.lantern-*`, `ui.marker-*`, `ui.door-ring*`, `ui.check`, `ui.bubble-*`, `prop.chalkboard`, `prop.chalk-tick|cross`, ...) before drawing anything yourself. Anything you still draw must be on-palette and match the 1x scale (nothing at 2x). Interiors without a composed asset (debate stage, courthouse, oracle, devil's cave) are composed from props + cast frames on a painted 224x128 room (floor y=112).
- Tests/captures: `po(t, calm)` from `testkit.ts` gives PaintOpts with the real art loaded from disk (node PNG decoder); `paintShot` uses it.
