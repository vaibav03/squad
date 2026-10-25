# 09 · Game scenes: Squad Village (draft for approval)

Workstream for `packages/village`, mounted by the village page in `packages/web` (`@squad/web`, hosted by `apps/web-host`) at `/squad/village`. Integration into the Nook clone is later (00 and 06 appendix). Conforms to `00-OVERVIEW.md` (Village event contract, `VillageSource`). Visual direction: `CLAUDE-DESIGN-PROMPT-WORLD.md`. Event shapes are owned by 00 (this file only maps them to animation). Vocabulary: "Core" and "Later".

## Summary
Squad Village is a walkable side-view pixel-art night world: parallax sky, moon, hills, windmill, houses with lit windows, chimney smoke. The student's character walks (arrow keys, or tap-to-walk). Every building is an agent from 03/04/05. The village **only renders real events** (or the same events from a replay file); it never decides what agents do. Calls and quizzes are ordinary React overlays on top of the canvas, so they stay accessible and share logic with iMessage.

## Answer to the pasted advice (Phaser 3 + spritesheets)
- **Phaser + spritesheets: yes.** Phaser is the right engine: sprites, tweens, cameras, parallax via `TileSprite`, particles for smoke and glow.
- **An AI-simulation engine with per-bot state machines: not needed.** That pattern (a16z AI Town, Stanford Smallville) exists because the bots there have no backend; the engine must invent their behavior. Ours already has real behavior: the hub emits `agent.state`, `council.*`, `ledger.entry` and so on. The village maps each event to an animation. We only keep tiny **animation** state machines (idle, walk, talk, wave) per sprite, about 30 lines each, no planning, memory or pathfinding AI. AI Town and Smallville are reference for look and feel only; no code is taken from them.
- **Research findings.**
  - Phaser 4 shipped in April 2026 and Phaser 3 ended at 3.90.0 ([Phaser 3 vs 4](https://phaser.io/news/2026/05/phaser-3-vs-phaser-4), [migration guide](https://phaser.io/news/2026/04/migrating-from-phaser-3-to-phaser-4-what-you-need-to-know)). You asked for Phaser 3; I pin `phaser@3.90.0` and see Decision 1.
  - `roundPixels` defaults to true since 3.70, but `pixelArt` does not ([release](https://github.com/phaserjs/phaser/releases/tag/v3.70.0)), so we set `pixelArt: true` ourselves.
  - SSR: Phaser touches `window` on import, so it must never load on the server. `@squad/web` stays SSR-safe because Nook is SSR (later); the page renders a shell on the server; `useEffect` runs `await import('@squad/village')` and creates the game, and `destroy(true)` on unmount. Loaded only on the village route, matching 00.
  - Layout: hand-placed in one typed `layout.ts` (building ids, x positions, depth). Tiled is overkill for one horizontal strip and adds a toolchain. Reconsider only if we ever add interior maps.
  - Parallax: 4 to 5 `TileSprite` layers with `scrollFactor` 0.05 to 0.6 and `tilePositionX` driven from the camera; Phaser's own parallax examples use the same approach.

## Architecture (`packages/village`)
```
src/index.ts           mountVillage(el, { source, onOverlay }) -> { destroy, setCamera }   (V0 owns this canvas mount; 06 W7 owns the host page)
src/source/live.ts     LiveSource (hub /v1/squad/stream)   src/source/replay.ts  ReplaySource (JSON script player)
                       both exported Phaser-free at `@squad/village/sources` (06 imports them without loading Phaser)
src/adapter.ts         VillageEvent -> SceneCommand[]  (pure, unit-testable, no Phaser import)
src/scenes/            Boot, Village, Interior(house|hall), TripCutscene   (scene manager = Phaser's)
src/entities/          Player, AgentNpc, Building, Bubble, Envelope, Lantern     src/layout.ts  world map
src/overlay/bridge.ts  typed events to React via `onOverlay`: openCall, openQuiz, openLedger, focusAgent
src/a11y/              text-alternative model; 06 `AgentList` is the one accessible list, fed from the same source
```
- **VillageSource** is exactly the 00 interface; the village imports nothing from the hub.
- **Event adapter:** a pure function turns each `VillageEvent` into scene commands (`walkTo`, `showBubble`, `setGlow`, `flicker`, `spawnEnvelope`, `ring`, `openOverlay`). Scenes execute commands; they hold no business state beyond what is on screen. This is what makes Live and Replay identical.
- **Scene manager:** Village is the persistent scene. Interiors (chapter house, Council Hall) are cutaway scenes launched on top (`scene.launch`); TripCutscene runs as an overlay of Village. 09 owns the trip cutscene; 04 only emits `trip.confirmed`. The player's position is saved in the registry so Esc returns to the door.
- **Scene content.** Chapter houses: signboard, lit window when the expert is awake, mastery glow dim to bright. Council Hall: 3 members plus chairman. Landmarks (locked or dimmed until relevant): Debate Stage, Course-Planning Round Table, Feynman Porch, Panic Line booth (glows at 2 AM), Oral Exam Hut, Rubric Courthouse, Exam Oracle, Devil's TA. Mesh view: neighbor houses with locked doors, campfire commons, notice board.

## Event to animation table (every `VillageEvent` in 00)
| Event | Village response |
|---|---|
| `agent.state` idle / studying | Window dim / window lit and desk lamp, NPC types at desk; HUD chip state dot updates |
| `agent.state` in_call | NPC faces the player's door, "on a call" sign; chip turns call color |
| `agent.state` waiting_for_student | NPC stands at its door with a pulsing ring (transform/opacity only) |
| `agent.message` to agent | Sender walks to the commons carrying an envelope, hands it over; bubble lists only `shared[]` labels |
| `agent.message` to `commons` | Envelope pinned at the campfire, bubble over the fire with `kind` in plain words |
| `ledger.entry` with `shared` | New card slides onto the notice board (green tick, field and shared text) |
| `ledger.entry` with `withheld: 'hidden'` | Card shows field label and a padlock plus the word "hidden" (never the value) |
| `ledger.entry` with `blocked: true` | Card gets a red stop mark and "blocked by privacy gate"; red "!" over the sender's door |
| `agent.message` kind `conflict` / `option_dropped` / `query_denied` | Red "!" marker at the commons (sender is `from: 'mediator'`, so the marker never names the vetoer); bubble shows the kind in plain words; `query_denied` also adds a blocked card |
| `confirm.pending` / `confirm.done` | Ring at that student's agent door starts / stops; `done` plays a small tick |
| `council.opinion` | Member's thought bubble appears independently (staggered, no peeking); `text` shown as given |
| `council.rank` | Speech bubbles pass between members around the table |
| `council.verdict` | Chairman stands and announces; `dissent: true` makes the lone red-lined dissenter bubble (member `dissenter`) stay and the lantern flicker ("uncertain, ask your TA") |
| `quiz.question` | Classroom house chalkboard shows the chapter; `openQuiz` overlay if `target` is this student (payload fetched via `GET /v1/quiz/:quizId`) |
| `quiz.answer` / `quiz.result` | Chalkboard tick or cross (never a grade; per-student `correct` only if the squad setting allows); chapter house glow nudges up on correct |
| `call.start` (with `student`) | Agent portrait animates at its door; `openCall` overlay if `student` is the viewer; others see that student's sprite at the door and a speech icon |
| `call.caption` | Short bubble over the agent (first 60 chars); full caption and `cite` live in the overlay |
| `call.end` | Portrait stops; overlay closes; agent returns to idle |
| `mastery.changed` | That chapter house glow tweens to the new `box` level (owner only; the hub filters it) |
| `trip.confirmed` | TripCutscene (owned here), plays once and is skippable: road scrolls, vehicle drives off, then the HUD gets a "Trip" door; reduced motion: fade card |
Unknown or malformed events are logged and ignored; they never crash a scene. Agent ids follow 00's mapping: `student:<id>`, `expert:<chapter>`, `council:<id>`, `dean`, `mediator`.

**Minimum group size.** For squads under 3 (rule defined in 00) the village hides counts, averages and topic aggregates that could identify a person: no per-chapter weak-spot glow.

## Live vs Replay
- **Live:** `LiveSource` opens the hub SSE stream (stream token from `POST /v1/squad/stream-token`), falls back to polling after two errors. Late joiners load the `GET /v1/squad/state` snapshot, then resume with `Last-Event-ID`. Badge says "Live".
- **Replay:** `?replay=<name>` (or a toggle) plays `apps/hub/sim/replays/<name>.json`, served by the hub at `GET /v1/squad/replay/:name`; other replay variants are deleted. Badge says "Replay". Visuals are identical because both feed the same adapter.
```jsonc
{ "name": "track2", "version": 1, "loop": false,
  "cast": { "me": "s_ana" },                       // which student the viewer is
  "events": [ { "at": 0,    "event": { "t": "agent.state", "agent": "dean", "state": "studying" } },
              { "at": 1200, "event": { "t": "council.opinion", "councilId": "council:planner", "member": "chill", "text": "Start with ch5." } } ],
  "checkpoints": { "council": 1200, "trip": 18000 } }  // jump targets for the demo remote
```
`at` is ms from start; the player supports pause, speed 0.5x/1x/2x and checkpoint jump. The same file doubles as the test fixture.

## Motion
`08-village-motion.md` is the single motion plan for the canvas and the overlays; this file does not define curves or durations. `packages/village/src/motion.ts` must export the three curves (ease-out, ease-in-out, ease-drawer) as bezier functions for Phaser tweens (ticket M-1), with the same values as the CSS custom properties. The village HUD has a "Calm mode" toggle that applies the reduced-motion variants (08 M-8), on top of `prefers-reduced-motion`.

## Overlay panels (React, over the canvas)
`bridge.ts` calls `onOverlay` with `openCall({agent, callId})`, `openQuiz({quizId, chapter})`, `openLedger({taskId})`; the web app owns the panels, the village only pauses input while one is open and refocuses the canvas on close.
- **Call (spec 05):** portrait, waveform, captions with citations (`call.caption.cite`), mute, hand-raise, leave. The village emits nothing about audio; 05 owns it.
- **Quiz (spec 03):** question and choices. Answer posts to the same hub/brain endpoint as iMessage, so it counts identically; the village only sees the resulting `quiz.*` events. Shows progress, never grades.
- **Ledger (spec 06):** the notice board opens the Glass Box view for that `taskId`; withheld text follows 06's viewer filtering. Nothing in the village receives a withheld value.

## Accessibility
- Keyboard: arrows walk, Enter enters or joins, Esc leaves, Tab cycles agents, `?` opens a controls card. Phaser keyboard capture is released while an overlay is open.
- **Text alternative:** a visually-hidden-until-focused list ("Agents and places") mirrors every building and agent with name, state, and an Enter action ("Join call", "Open Council Hall"). It is generated from the same state as the canvas and has a live region for event announcements ("Council verdict: start with chapter 5").
- The canvas is `role="img"` with a label and a link to the list; all village info (state, call, trip door) also exists as DOM text in the HUD.
- `prefers-reduced-motion`: parallax and ambient loops stop, walking becomes teleport-with-fade, bubbles appear without movement. Idle loops pause when the tab is hidden. Color is never the only state signal (icons plus labels).

## Mobile layout
Single horizontal scroll strip with drag and tap-to-walk; bottom dock of agent chips (tap = walk there and focus); camera buttons Left/Mid/Right/Zoom collapse into the dock. Calls and quizzes open as full-screen sheets. Canvas uses `Scale.FIT` with an integer zoom per breakpoint (2x at 390 px, 3x at 1280 px) so pixels stay crisp. Honors safe-area insets.

## Assets and credits
- Pixel art: CC0 packs under `/Users/vaibav/Desktop/squad-assets/pixel/`. The folder now contains `_packs` (autumn-town, oga-cc0, ninja-adventure, kenney), `_licenses` (Ninja Adventure CC0 and README, Kenney CC0, Ansimuz public-domain note), `backgrounds`, `buildings`, `characters`, `fx`, `interiors`, `items`, `monsters` and `ui` (plus contact-sheet PNGs and some per-pack `License.txt`). **V0 audits it**: confirms each used file maps to a pack and license, and writes `assets/LICENSES.md` plus a CI check. Candidates exist (a windmill PNG in `buildings`, campfire and chimney smoke in `fx`) but their style fit is unverified. **Unconfirmed**: the windmill and the vehicle (the boss, summoning circle and creature line are no longer needed); V0 either finds CC0 art or hand-draws them.
- Fluent 3D set: web UI chrome and portraits only, never in the world scene (pixel sprites in the world).
- Credits line in the village footer and in the README: "World art: <packs>, CC0. UI icons: Microsoft Fluent Emoji 3D (MIT)." (exact wording from `assets/LICENSES.md` at V0).
- Pipeline: one atlas per scene (TexturePacker-style JSON via a script), 16 px tiles, `pixelArt: true`, `roundPixels: true`, `antialias: false`, CSS `image-rendering: pixelated`.

## Performance budget
60 fps at 1280 px on a mid laptop and 30+ fps on a mid phone; village chunk under 1.2 MB gzipped (Phaser is about 300 KB gzipped, so Phaser-lite custom build is a later option); total art under 4 MB; at most 250 live game objects; 1 particle emitter per effect, pooled bubbles; cap 12 simultaneous bubbles; `game.loop` sleeps when hidden. Phaser is a dynamic import so no other route pays for it.

## Tickets (order only; nothing is cut)
| # | Ticket | Depends on |
|---|---|---|
| V0 | Package scaffold, `mountVillage` canvas mount (06 W7 owns the host page in `packages/web`), asset audit plus `LICENSES.md`, pixel config, Boot scene | 00 repo layout, 06 W0 |
| V1 | Village scene: parallax, moon, hills, windmill, houses, player walk (keys, tap), camera buttons, HUD chips incl. Calm mode toggle | V0, M-1, M-2 |
| V2 | Adapter, `@squad/village/sources` (LiveSource, ReplaySource), replay format and `?replay=`, badge | V0, 06 hub stream |
| V3 | Chapter houses, interiors, mastery glow (`mastery.changed`), quiz overlay bridge | V1, V2, 03 |
| V4 | Council Hall (opinions, ranks, verdict, dissenter bubble and lantern) plus landmark buildings | V2, V3, M-4, M-6 |
| V5 | Mesh view: locked houses, commons, envelopes, "!" markers, blocked ledger cards, waiting ring, notice board | V2, 04, 06 ledger, M-3, M-4 |
| V6 | Call overlay bridge and agent call animation | V2, 05, M-6 |
| V7 | Trip cutscene (`trip.confirmed`, plays once, skippable) | V2, 04, M-1, M-7 |
| V8 | Accessibility list, mobile layout, reduced motion and Calm mode, perf pass, credits, demo replay scripts | V1 to V7, M-5, M-8, M-9 |

Motion tickets M-1..M-9 are defined in `08-village-motion.md`; M-1 (`motion.ts`) comes first.

## Smoke tests
- **Scene boots:** headless (Playwright) loads `/squad/village`, canvas present (via `?replay=track2` too), no console errors, SSR response contains no Phaser code.
- **Replay renders each event:** one script contains every `VillageEvent` type; assert the adapter yields the expected commands (unit) and that each produces a visible change (screenshot diff per event).
- **No withheld value in any bubble:** feed events whose payloads contain a sentinel value (a fake budget "$180", "therapy"); assert it appears nowhere in the canvas text objects, the accessible list, or the DOM. The village also asserts `ledger.entry` has no field other than `field`, `shared` and `'hidden'`.
- **Trip cutscene:** a replay with `trip.confirmed` plays the cutscene once, any key skips it, and the "Trip" door appears; Calm mode shows the fade card.
- Keyboard-only run reaches every agent and opens/closes a call and quiz overlay.

## Risks
- Phaser version drift (Phaser 4 vs 3): pin the version, keep scene code to common API.
- Asset gaps in CC0 packs make the world look uneven: V0 audit decides early.
- Canvas text is hard to translate and read: all long text lives in DOM overlays.
- SSE buffering in dev (same as 06): point the stream at the hub port.
- Replay drifting from live shapes: both validate with the shared zod schema in `packages/core` (contracts re-exported from core).

## Decisions for you
1. **Phaser 3.90.0 or Phaser 4.x?** *Recommend 3.90.0* (pinned; 06 states the same version): stable, most tutorials, and our needs are standard. Phaser 4 stays a decision here; migration is a few hours.
2. **Layout:** hand-placed `layout.ts`, not Tiled. *Recommend hand-placed.*
3. **Unconfirmed art** (windmill, vehicle): hand-draw simple ones vs keep searching CC0. *Recommend search first, hand-draw gaps.*
4. **Walking:** free walk only, or also "click an agent chip to auto-walk"? *Recommend both* (needed for mobile and a11y).
5. **Replay as default on first visit** when no live squad exists? *Recommend yes*, with the badge.
6. **Custom Phaser build to trim size?** *Recommend no for now*, only if the budget is missed.
