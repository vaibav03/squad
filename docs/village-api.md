# Village API (published by ws/village-world)

Source of truth for types: `packages/village/src/world/api.ts` (type-only, safe to import). World map: `packages/village/src/world/layout.ts`. Everything here is stable; additions are backwards compatible. Questions or change requests go to the village-world lead.

## 1. Coordinate system
- Logical resolution: height **180 px**, width varies (320 on 16:9, ~195 on a 390 px phone). The canvas buffer is logical size and is shown at an **integer CSS zoom** (2x at 390 px wide, 3x at 1280 px, 4x on large screens) with `image-rendering: pixelated`. Every game object sits on **whole logical pixels** (roundPixels is on; never use fractional x/y for sprites).
- World is one strip, `WORLD_W = 2560` px. `GROUND_Y = 148` is the feet line; place buildings and actors with **origin (0.5, 1) at y = GROUND_Y** (props that stand on the ground do the same).
- Regions: Left 0..800 (study), Mid 800..1760 (council, commons), Right 1760..2560 (mesh neighbours, board, trip road).
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
- Overlays: any module emits `bus.emit('overlay', {type:'openCall'|'openQuiz'|'openLedger'|'focusAgent'|'closeOverlay', ...})`. The world forwards it to `opts.onOverlay`, locks input and pauses key capture until the host calls `handle.overlayClosed()`.
- Calm mode / reduced motion: read `ctx.calm` (live) or listen on `bus 'calm'`. World parallax, walking teleport-with-fade, etc. follow it; modules apply their own reduced variants (docs/specs/08-village-motion.md).
- Withheld values: `bus 'villageEvent'` carries whatever the source gave; the adapter/modules must never render anything but `field`, `shared`, `'hidden'`.

## 4. Assets and the loader
- Authoritative list: `assets/asset-manifest.json` (design foundation lead). Boot reads it, queues every entry flagged for the village, and exposes `ctx.assets.has(key)`. Texture keys are the manifest `key` field. Until the manifest lands, boot uses a built-in stub of `assets/pixel/backgrounds/generated-village/*` and Autumn Town sprites (keys prefixed `bg-`, `player-`).
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

## 6. Test hooks
`handle.debug.ctx()` returns the live `VillageContext`; `handle.debug.fps()` the smoothed fps. Dev harness URL params: `?time=night|dusk|dawn|day|auto`, `?calm=1`, `?cam=mid`.
