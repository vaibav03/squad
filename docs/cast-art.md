# Council cast art

Four original pixel characters for the Round Table: **Chill** (green hoodie, blanket, tea mug, moon charm), **Grind** (orange headband, stack of books, coffee),
**Advisor** (purple, glasses, clipboard checklist), **Chairman** (pale grey-blue coat, violet crest, gavel). Same 28-colour palette, 32x32 right-facing cell,
1px ink outline as the rest of the composed cast.

## Where things live

| What | Path |
| --- | --- |
| Generator (deterministic, no randomness) | `assets/pixel/composed/scripts/characters_council.py`, run by `make_characters.py` |
| Atlas (Phaser, frames `cast-chill/idle/0` ...) | `assets/pixel/composed/characters/atlas.png` + `atlas.json` |
| Per-character strips and busts | `assets/pixel/composed/characters/cast-*/{idle,talk,think,walk,sit,wave}.png`, `bust.png` (128x96), `portrait.png` |
| Manifest | `assets/asset-manifest.json` (`persona.cast-*`, loaded through `atlas.characters`); built by `build_manifest.py` |
| Contact sheets | `docs/design/shots/castart/` (`python3 assets/pixel/composed/scripts/council_contact.py`) |
| Round Table scene | `packages/village/src/scenes/landmarks/round-table/interior.ts` (chill/grind/advisor map to `cast-*`, chair to `cast-chair`) |
| Web component | `packages/web/src/components/cast-avatar/` |

Regenerate: `python3 assets/pixel/composed/scripts/make_characters.py && python3 assets/pixel/composed/scripts/build_manifest.py`.
Frames per anim: idle 4 (breath + blink), talk 4, think 4 (thought dots 1, 2, 3, 2), walk 4 (side view, flip for left, like the rest of the cast), sit 2, wave 2.
Idle, talk and think play at 5 fps, walk at 8 fps. The existing cast has side-view walks only, so there is no 4-direction walk set.
`assets/sprites/cast.json` is the vendor-derived atlas built by `packages/media`; the council cast is not in it, it lives in the composed atlas above.

## `<CastAvatar />`

```tsx
import { CastAvatar, CAST_STATE_LABEL } from '../components/cast-avatar';
<CastAvatar name="chill" state="idle" size={2} />
```

| Prop | Type | Notes |
| --- | --- | --- |
| `name` | `'chill' \| 'grind' \| 'advisor' \| 'chair'` (also `'Chairman'`, any case) | unknown names render nothing |
| `state` | `'idle' \| 'talk' \| 'think'` | default `idle`; `talk` while that member speaks |
| `size` | integer 1 to 6 | scale of the 32px bust, default 2 (64px); rounded, so always integer |
| `calm` | boolean | static first frame. `prefers-reduced-motion` and `:root[data-calm='true']` do this in CSS too |
| `outline` | boolean | default true: 2px state outline (idle `--state-idle`, talk `--state-studying`, think `--sq-violet`) |

It is a `role="img"` with `aria-label="Chill, listening"`. Colour is never the only signal: show `CAST_STATE_LABEL[state]` (Listening / Speaking / Thinking) as text next to it,
as the help panel does. Rendering is `image-rendering: pixelated`, frames step with `steps(4)` on `background-position`, nothing else animates.
Adopters: Agent Inspector, chat cards, council verdict card (not wired by this change).

## Help panel behaviour

Rows enter with a 40 ms stagger, 160 ms, `cubic-bezier(0.23, 1, 0.32, 1)`, transform + opacity. Hover (only `(hover: hover) and (pointer: fine)`) switches that avatar to its talking loop and
nudges it 1px over 125 ms ease. `RoomInfoPanel` takes `speaking` (set by `RoomLayer` from the live transcript) so the speaking member's avatar plays its talking loop.
Reduced motion and Calm: static first frame, opacity-only entrance.
