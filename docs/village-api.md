# Village API (published by ws/village-world)

Source of truth for types: `packages/village/src/world/api.ts` (type-only, safe to import). World map: `packages/village/src/world/layout.ts`. Everything here is stable; additions are backwards compatible. Questions or change requests go to the village-world lead.

## 1. Coordinate system
- Art layer set is **270 px tall** (docs/design/DESIGN.md section 2). World y: 0 = top of sky, 270 = bottom. The camera is **bottom-anchored**: the view is `viewH <= 270` tall and shows y in [270 - viewH, 270] (240 at 1280x720, 270 on phones), so author everything in world coordinates and never in screen coordinates. View width varies (195 on a 390 px phone, 426 at 1280x720). Zoom is 3x at css width >= 900 else 2x (integer, with device-pixel alignment for fractional DPR); `image-rendering: pixelated`. Every game object sits on **whole art pixels**.
- World is one strip, `WORLD_W = 2950` px. **`GROUND_Y = 250`** is where actors' feet and building bases sit (the grass edge and fence line are at y = 240; the dirt path is y 240..270). Place buildings and actors with **origin (0.5, 1) at y = GROUND_Y**, or use the character atlas anchor (16,31) of its 32x32 cell.
- Regions: Left 0..950 (study), Mid 950..2000 (council + landmark row), Right 2000..2950 (mesh view, trip road).
- **Slot x positions (current; ids are stable, x may be tuned: always read `layout.slot(id)`; widths are the real manifest art widths):** chapter-1 120, chapter-2 280, chapter-3 440, chapter-4 600 (hut 128), exam-oracle 732 (w63), feynman-porch 857 (w114), debate-stage 1048 (w197), round-table 1244 (w124), council-hall 1412 (w139), panic-booth 1532 (w28), devils-ta 1649 (w134), oral-exam-hut 1789 (w73), rubric-courthouse 1924 (w123), notice-board 2050, commons 2160, home-1 2300, home-2 2450, home-3 2600, trip-road 2770, spawn 1490. `WORLD_W` is 2950. Camera presets: left 400, mid 1300, right 2200 (Right shows board + campfire + home-1 in one 427 px view).
- **Slots** (`layout.slot('council-hall')`) are the hand-placed anchors: `chapter-1..4`, `exam-oracle`, `feynman-porch`, `debate-stage`, `round-table`, `council-hall`, `commons`, `panic-booth`, `devils-ta`, `oral-exam-hut`, `rubric-courthouse`, `notice-board`, `home-1..3`, `trip-road`, `spawn`. Each has centre `x`, footprint `w`, optional `door.x`, a `label`. **Render into slots; do not invent x values.** If a slot needs to move or a slot is missing, ask the world lead (the layout file is world-owned).
- Depth: `DEPTH` bands in api.ts (`buildings`=40, `props`=50, `actors`=60, `actorFx`=70, `foreground`=80, `lighting`=90, `worldUi`=100). Never use raw numbers.

## 2. SceneModule: how scenes plug in
Each lead exposes a module and the world discovers it; **nobody edits world files**.
```ts
// packages/village/src/scenes/module.ts   (also mesh-view/module.ts, cutscene/module.ts)
import type { SceneModule } from '../world/api';
const mod: SceneModule = {
  id: 'scenes', order: 100,
  preload(ctx, load) { /* only module-private extra assets */ },
  create(ctx) {
    const s = ctx.layout.slot('chapter-1');
    const house = ctx.scene.add.image(s.x, ctx.layout.groundY, 'house-a').setOrigin(0.5, 1).setDepth(ctx.depth.buildings);
    const glow = ctx.lighting.addGlow({ x: s.x + 8, y: 110, radius: 14 }); // warm window light, follows nightness
    ctx.agents.register({ id: 'expert:ch1', name: 'Ch.1 Expert', kind: 'expert', slotId: s.id });
    ctx.interactables.register({ id: 'enter-ch1', x: s.door!.x, radius: 20, label: 'Open Chapter 1 house', onActivate() {} });
    return { onCommand(cmd) { if (cmd.type === 'setGlow') {/* ... */} }, update(t, dt) {}, destroy() { glow.destroy(); } };
  },
};
export default mod;   // a single module or an array
```
`ctx` (`VillageContext`) gives: `scene` (the persistent world Phaser scene), `layout`, `depth`, `time` (`nightness` 0..1, `clockHours`), `lighting.addGlow`, `agents` (register + `setState`; feeds HUD chips and the a11y list), `player` (`x`, `walkTo`, `teleport`, `lockInput`), `camera` (`panTo`, `setMode`), `assets` (`has`, `url`), `bus`, `interactables` (Enter / tap prompt), `registry`, `me`, `calm`, `motion` curves, `log`.
- Discovery (world-owned `scene-manager/modules.ts`) globs exactly: `../scenes/module.ts`, `../mesh-view/module.ts`, `../cutscene/module.ts`, `../a11y/module.ts`, `../overlay-bridge/module.ts`, `../motion/module.ts`. A missing file is skipped. Modules run `preload` then `create` in ascending `order`; world = 0, scenes = 100, mesh-view = 200, cutscene = 300, a11y = 400.
- Modules must not import `phaser` as a value at module top level if they are also imported by Node tests; import it inside `create`, or use `ctx.scene`/`ctx.game` (preferred: no Phaser import is needed at all).
- Interiors (chapter house, Council Hall cutaway) are launched by a module as a second Phaser scene (`ctx.game.scene.add`/`launch`); on `enter`/`leave` it should `ctx.player.lockInput()` and emit `bus.emit('enter', {slotId})`. The player x is saved in `ctx.registry` ('playerX').

## 3. Events, commands, overlays
- Pipeline: `VillageSource.subscribe(e)` -> world emits `bus 'villageEvent'` -> optional adapter (`src/adapter/module.ts` default-exports `{ createAdapter({me}) -> { adapt(e): SceneCommand[] } }`, `AdapterModule` in api.ts) -> each `SceneCommand` is emitted on `bus 'command'` and delivered to every module's `onCommand`. Commands are `{ type: string, ...}`; the command catalogue is owned by village-mesh (`docs/village-events.md`). Unknown commands are ignored.
- World itself handles `agent.state` (updates `ctx.agents`, so HUD chips move without any module) and nothing else; everything visual is a module's job.
- Overlays: any module emits `bus.emit('overlay', {type:'openCall'|'openQuiz'|'openLedger'|'openConfirm'|'focusAgent'|'closeOverlay', ...})`. The world forwards it to `opts.onOverlay`, locks input and pauses key capture until the host calls `handle.overlayClosed()`.
- Calm mode / reduced motion: read `ctx.calm` (live) or listen on `bus 'calm'`. World parallax, walking teleport-with-fade, etc. follow it; modules apply their own reduced variants (docs/specs/08-village-motion.md).
- Withheld values: `bus 'villageEvent'` carries whatever the source gave; the adapter/modules must never render anything but `field`, `shared`, `'hidden'`.

## 4. Assets and the loader
- Authoritative list: `assets/asset-manifest.json` (design foundation lead). Boot loads EVERY non-font entry. Texture key = manifest `id` (e.g. `house.hut`, `atlas.characters`, `fx.campfire`); variants load as `<id>:<variant>` (`house.hut:dark`); spritesheets use `frame.w/h`; atlases use `atlasJson`. Parallax, character and dressing keep module-owned fallback lists keyed by the same ids. Walk speed is 36 px/s (12 fps, 3 px planted stride).
- Assets are served from `opts.assetBase` (default `/assets`) mapped to the repo `assets/` dir. Hosts: `apps/web-host` must serve repo `assets/` at `/assets` (Vite `publicDir` alias or middleware); the village dev harness (`pnpm --filter @squad/village dev`) does this itself.
- `ctx.assets.url('assets/pixel/fx/campfire-sprite-sheet.png')` resolves a repo path for module-private loads.

## 5. mountVillage
```ts
import type { VillageHandle, MountOptions } from '@squad/village';
const { mountVillage } = await import('@squad/village');   // dynamic only; Phaser never loads on SSR/other routes
const h = mountVillage({ parent: el, source, onOverlay, me: 's_ana', assetBase: '/assets' });
await h.ready; h.setCamera('mid'); h.setCalm(true); h.overlayClosed(); h.destroy();
```
`mountVillage` is synchronous (returns the handle immediately; Phaser is imported lazily inside, `ready` resolves on first rendered frame). `destroy()` is safe at any time (React strict-mode double mount) and removes canvas, HUD, listeners and unsubscribes from the source. Spec text calls the signature `mountVillage(el, opts)`; the call `mountVillage(el, opts)` is also accepted and equals `{parent: el, ...opts}`.
Inside `parent` the world creates: the canvas (integer zoom, `role="img"` + label), the HUD (state chips, Left/Mid/Right/Zoom, Calm, clock; DOM, tap targets >= 44 px), and a visually hidden live region (`bus 'announce'`).

## 6. Overlay events
`OverlayEvent` = `openCall {agent, callId}` | `openQuiz {quizId, chapter}` | `openLedger {taskId}` | `openConfirm {taskId, question}` | `focusAgent {agent}` | `closeOverlay`.

## 7. Test hooks
`handle.debug.ctx()` returns the live `VillageContext`; `handle.debug.fps()` the smoothed fps. Dev harness URL params: `?time=night|dusk|dawn|day|auto`, `?calm=1`, `?cam=mid`.
