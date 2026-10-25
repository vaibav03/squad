# Council Chamber skin (optional, local only)

An optional indoor skin for the Council Hall interior, built from the licensed Modern Interiors pack by LimeZu. Without the local art the app keeps the classic Council Hall art and logs nothing.

## Licence rules

Modern Interiors may be used and edited by the licensee but not redistributed. So the repo carries only code, a recipe that names tiles by pack-relative path and rectangle, and seat anchor data. All derived art is written to the gitignored `assets/vendor/interiors/`. A guard test (`packages/village/src/scenes/skins/skins.test.ts`) fails if `git ls-files assets/vendor` is not empty or any tracked image or archive carries a pack name. A public deployment that serves the composed layers to browsers is distribution; check the licence with LimeZu before one. Credit line: "World art: Modern Interiors by LimeZu" (docs/CREDITS.md, and in the room panel while the skin is active).

## Run it

```
export MODERN_INTERIORS_ZIP=/path/to/moderninteriors-win.zip   # optional: default is vendor-local/moderninteriors/ in this checkout or a parent folder
pnpm interior:import --dry-run     # checks every named tile exists, writes nothing
pnpm interior:import               # composes assets/vendor/interiors/council-chamber/{bg,mid}.png + skin.json + index.json
```

Also `--zip file`, `--dir extracted-folder` (or `MODERN_INTERIORS_DIR`), `--out`, `--recipe`. Output outside `assets/vendor/` is refused. Reload the app: the dev server adds `<meta name="squad-interior-skin">` when `index.json` exists. `?skin=off` forces the classic art, `?skin=modern-interiors` probes even without the marker.

## Files

- `packages/village/src/scenes/skins/recipes/council-chamber.json`: sheets, sprite rectangles, layer ops (`bg`, `mid`, `fg`) and `layout` (seat anchors, chairman, bubble row, lantern, plan sheet). No pixels.
- `importer.ts`, `cli.ts`, `zip.ts`, `compose.ts`, `recipe.ts`: importer (zip reader without `unzip`, deterministic composer, validation).
- `runtime.ts`: mode detection, manifest fetch (never throws), active-skin record for the DOM credit.
- Painter: `council-hall/interior.ts` reads anchors from `hallLayout(skin)`; hit zones use the same data through `roomSeats(..., skin.layout)`. Layer order: background, chairman, `mid` (table), members, `fg`.

## Gaps

Round Table and other rooms are not skinned (the recipe format supports more scenes). The credit shows in the room panel, there is no global footer. Cast sprites keep their existing art.
