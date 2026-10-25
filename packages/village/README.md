# @squad/village (world half: village-world)

Phaser 3.90 side-view pixel night world. This section covers the world shell (boot, loader, scene manager, parallax, character, input, camera, HUD). Scenes, mesh view, adapter and sources have their own sections from their workstreams. Contracts: `docs/village-api.md`, types in `src/world/api.ts`.

## Run

```
pnpm --filter @squad/village dev        # Vite dev harness at http://localhost:5190/ (serves repo assets/ at /assets)
# params: ?time=night|dusk|dawn|day|auto  ?calm=1  ?cam=left|mid|right|zoom  ?x=<world x>
pnpm --filter @squad/village test       # unit tests (pure logic)
pnpm --filter @squad/village test:smoke # headless boot via Playwright (skips if chromium is missing)
node packages/village/scripts/shot.mjs out.png 1280 720 1 "cam=mid" 1500   # screenshot + fps (harness must be running)
node packages/village/scripts/verify.mjs                                    # walking speed, tap-to-walk, camera presets, calm
```

Embed: `const { mountVillage } = await import('@squad/village'); const h = mountVillage({ parent, source, onOverlay, assetBase: '/assets' });` The host must serve repo `assets/` at `assetBase`.

## Design decisions

- Art scale per `docs/design/DESIGN.md`: 270 px tall layer set, bottom-anchored camera, 3x zoom at css width >= 900 else 2x, device-pixel aligned for fractional DPR, `image-rendering: pixelated`. The HUD Zoom button is one integer step (3x to 4x), never a fractional camera zoom.
- Walking: 42 px/s (3 px stride x 14 fps, no foot sliding), constant, instant start, 80 ms ease-out stop, whole-pixel render; keyboard read per frame (no input lag). Calm mode: tap-to-walk becomes teleport with a 120 ms fade.
- Day/night: composed layers crossfade with ramps baked from `ramps.json`; default pinned night; `auto` follows the local clock.
- Keyboard focus lives on the stage element; Phaser's keyboard plugin is off so page typing is never hijacked.

## Known gaps

`assets/asset-manifest.json` is read tolerantly if present, but boot always also queues the module-owned `ASSETS` lists (parallax, character, dressing). Windmill art is not in the composed set yet.
