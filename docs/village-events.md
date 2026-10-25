# village-events: the events half of the village (workstream village-mesh)

Source of truth for types: `packages/village/src/adapter/commands.ts`. Everything below is stable; additions are backwards compatible.

## 1. Pipeline

`VillageSource -> adapter.adapt(event, {me}) -> SceneCommand[] -> bus 'command' -> every module's onCommand`.
The adapter is pure (no Phaser, no clock, no randomness): `adapt`, `adaptUnknown` (validates with the strict core schema first, never throws, never echoes values), `createAdapter({me})` (the world hook, `src/adapter/module.ts`). The `switch` over `event.t` is exhaustive with a compile-time `never` check, and a test builds a sample for every `VILLAGE_EVENT_TYPES` entry (adding an event type to core breaks the build until the adapter handles it).

## 2. Event -> commands

| Event | Commands (in order) |
|---|---|
| `agent.state` | `setAgentState`, `ring` (on only for `waiting_for_student`), `announce` |
| `agent.message` to an agent | `spawnEnvelope`, `walkTo` (commons, `carrying`), `showBubble` (kind in plain words, `lines` = `shared[]` only), `announce` |
| `agent.message` to `commons` | same, envelope rests at the fire |
| `agent.message` conflict / option_dropped / query_denied (from `mediator`) | `showBubble` (`tone: 'alert'`), `marker` at commons, `announce` (+ `ledgerCard` blocked for query_denied). A mediator sender never spawns an envelope and is never named |
| `ledger.entry` shared | `ledgerCard` (shared) + `announce` |
| `ledger.entry` `withheld:'hidden'` | `ledgerCard` (hidden: field label only; any `shared` that rides along is ignored) |
| `ledger.entry` `blocked` | `ledgerCard` (blocked: field only), `marker` (reason `blocked`) over the sender's door, `announce` (assertive) |
| `confirm.pending` | `ring` on at that student's door, `openOverlay openConfirm` only if `student === me` |
| `confirm.done` | `ring` off, `tick` at the door, `openOverlay close confirm` if me |
| `council.opinion` / `council.rank` / `council.verdict` | `councilOpinion` / `councilRank` / `councilVerdict` (+ `lantern flicker` and an assertive `announce` when a dissenter exists) |
| `quiz.question` | `chalkboard question`, `openOverlay openQuiz` only if `target === me` |
| `quiz.answer` / `quiz.result` | `chalkboard tick|cross` only when `correct` is present, else `none` (never a grade) |
| `call.start` | `callPortrait on`, `setAgentState in_call`, `openOverlay openCall` only if `student === me` |
| `call.caption` | `showBubble` caption, first 60 chars cut on a word boundary + ellipsis |
| `call.end` | `dismissBubble`, `callPortrait off`, `setAgentState idle`, `openOverlay close call`, `announce` |
| `trip.confirmed` | `playTrip`, `announce` (assertive) |
| `mastery.changed` | `setGlow`, only when `student === me` |

Dwell: every bubble `minMs = clamp(ceil(len/20) * 1200, 1200, 9000)`.

## 3. Who executes what

- village-mesh (`packages/village/src/mesh-view`, order 200): `spawnEnvelope`, `walkTo` (+ hand-off and return home), `showBubble` / `dismissBubble` (9-slice art, tail, clamped to the view, one lane per anchor so commons bubbles never overlap, pool of 12), `marker` / `clearMarker`, `ring`, `tick` (ring becomes check, padlock opens for 1.6 s), `ledgerCard` (board slot + readable bubble), neighbour houses (locked variant generated from the composed art, padlock, name sign, lit window and chimney smoke on `setAgentState`), campfire, notice board. Ignores everything else.
- village-mesh `cutscene` (order 300): `playTrip`. `a11y` (order 400): folds every command into the agent feed and forwards `announce` to the world live region. `overlay-bridge` (order 410): `openOverlay` -> bus `overlay` (one overlay at a time, deduped, FIFO queue).
- world / scenes (not mine): `setAgentState` for experts/dean/councils, `setGlow`, `chalkboard`, `callPortrait`, `council*`, `lantern`. A module that does not implement a command ignores it.

Camera: when mesh activity happens outside the view and the student is not walking, mesh-view calls `camera.setMode('right')` (the world's Right preset is the stage: board, campfire, your house), at most once per 6 s. It never moves the camera while the student walks.

## 4. Sources (`@squad/village/sources`, Phaser-free)

```ts
import { createLiveSource, createReplaySource, loadReplay, withTripCutscene, tripCutsceneFromQuery } from '@squad/village/sources';
const live = createLiveSource({ baseUrl, getToken, me });  await live.start();   // snapshot (as events with meta.snapshot) -> SSE with lastEventId -> polling after 2 errors
const replay = createReplaySource(script);  replay.play(); replay.seek('trip'); replay.setSpeed(2); // virtual-clock friendly
```
Subscribers are `(e: VillageEvent, meta?: { fast?, snapshot?, id? }) => void`. Invalid frames are dropped and logged without values. `x.*` frames are ignored (`x.resync` refetches the snapshot).

## 5. Trip cutscene from the web ("Watch in the village")

`/squad/village?cutscene=trip&task=<taskId>[&squad=<id>]`: the host wraps its source and mounts as usual:

```ts
const t = tripCutsceneFromQuery(location.search);              // { taskId, squadId } | undefined
const source = t ? withTripCutscene(liveSource, t) : liveSource;  // one synthetic trip.confirmed first
```
The cutscene plays once per taskId (module flag plus `sessionStorage['squad:trip-played:<taskId>']`, try/catch), is skippable with any key or tap, and ends with the Trip door open at the `trip-road` slot, a `tripDoor` bus event for the HUD chip and an interactable "Go to Trip door" (emits overlay `openLedger` for that task). Calm / reduced motion: static card with 200 ms fades.

## 6. Overlay events (bus 'overlay', forwarded to `onOverlay`)

`openCall {agent, callId}`, `openQuiz {quizId, chapter}`, `openLedger {taskId}`, `openConfirm {taskId, question}`, `focusAgent {agent}`, `closeOverlay`. The host calls `handle.overlayClosed()` when the panel closes.

## 7. Accessibility feed (`@squad/village/a11y`)

`createAgentFeed({ me, squadSize })` -> `apply(event)`, `snapshot()` (entries with name, state words + icon, detail, actions with an `OverlayRequest`), `subscribe`, `onAnnounce` (rate-limited, deduped, assertive for conflict, blocked and dissent), `attach(source)`. The in-canvas module stores the same feed in `ctx.registry` under `a11yFeed`. Under 3 members the notice board shows no counts.

## 8. Run and capture

```
pnpm -F @squad/village test                       # adapter, sources, a11y, bridge, timeline, locked variant
pnpm -F @squad/village exec vite --config src/mesh-view/dev/vite.config.ts --port 5230   # mesh dev harness (plays the story)
node packages/village/src/mesh-view/dev/capture.mjs 5230 docs/design/shots/village-mesh/<dir> 1280 720 "x=1235&cam=follow" 1800,3600,... desk
```
Harness query: `cam`, `x` (teleport the player), `calm=1`, `start=<ms>` (seek the story), `paused=1`, `me`. Story: `src/mesh-view/dev/story.ts`.

## 9. World-agnostic contract (the seam for the top-down campus)

The owner will later replace the side-view world with a top-down interior campus. Everything that is not a renderer is therefore world-agnostic and survives that swap unchanged:

- `adapter`, `sources`, `overlay-bridge` and `a11y` never import Phaser, never read a layout (clocks are injectable), and never emit a pixel coordinate. Commands address the world only through `Place` (`door{agent}`, `commons`, `board`, `house{chapter}`, `hall{councilId}`, `tripDoor`), agent ids and slot-style ids. A test greps the pure files of these four folders for coordinate fields and `phaser` imports; the only world-touching files are the thin `module.ts` shims that register with the world bus.
- Coordinates come from exactly one place: `layout.slot(id)` in the world (`src/mesh-view/places.ts` is the single resolver from `Place` to a point; the cutscene uses the `trip-road` slot). A new world only has to provide the same slot ids (`commons`, `notice-board`, one door slot per house, `trip-road`) and the renderer modules (`mesh-view`, `cutscene`) re-resolve them. Movement style (a side-view walk vs. a top-down path) is the renderer's business; the commands only say who goes where and what they carry.
- Layout-dependent behaviour (camera preset, bubble lanes, clamping to the view) lives in `mesh-view` only.
- The a11y feed and overlay requests are expressed in words and ids, so the DOM feed works identically in either world.
