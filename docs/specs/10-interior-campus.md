# 10 · Interior campus: Squad Campus (draft for approval)

Pivot plan. The primary world becomes a **top-down indoor campus** in the style of LimeZu's [Modern Interiors](https://limezu.itch.io/moderninteriors) (16x16 RPG tiles): tiled floors, desks, shelves, play mats, round tables, plants, a chalkboard, small characters, rooms split by walls and doorways. This **replaces** the side-view night village (09) as the main world; that village stays on its branches (`ws/village-*`), nothing is deleted. Conforms to `00-OVERVIEW.md` (VillageEvent contract, `VillageSource`) and `08-village-motion.md`. Only docs change in this PR; no feature code. Art direction: `docs/design/INTERIORS-ART.md`; design prompt: `docs/design/CLAUDE-DESIGN-PROMPT-INTERIORS.md`.

## Summary
The student walks a small top-down character through a school-like campus. Every room is a part of the product; every agent is a character who lives in a room and **moves between rooms** when events say so. The campus still **only renders real events** (or the same events from a replay file). Calls, quizzes and the ledger stay DOM overlays on top of the canvas (accessible, shared logic with iMessage). The 00 contract does not change.

## Verified facts and research
- **Pack and license** (itch page): full pack is name-your-own-price, $1.50 minimum; 16/32/48 px sizes; thousands of single-file sprites per theme (classroom, library, conference/lecture hall, canteen, infirmary, museum...), 100+ animated objects; a character generator (100+ outfits, 200 hairstyles, walk/idle/read animations) ships with the **full** version only. License: edit and use in commercial or non-commercial projects, **no reselling or distributing the assets**, credit required.
- **Free sample** (`Modern_Interiors_Free_v2.2.zip`, 1 MB, about 1% of the pack, per the "Free version overview" devlog): 9 floors, 8 wallpapers, a Room_builder file, all Living Room interiors, **Classroom interiors**, 4 fully animated characters. Its license is **non-commercial only**. We have not downloaded it; exact folder names are unconfirmed (task I-0 inspects it). Community posts say RPG-Maker-format character sheets sit in a `4_RPG_MAKER_MV/Characters` folder in the full pack.
- **Character generator**: it can save a composed sprite sheet as PNG locally. Alternative: layer body, outfit, hairstyle PNGs in that order (Piskel works) and export. Community tools (a one-file HTML generator, a Windows tool) exist. So output is exportable, but only by hand on the owner's machine; we script the composition (I-2) so a cast of about 12 is reproducible.
- **Phaser 3.90 top-down workflow**: Tiled JSON -> `load.tilemapTiledJSON`, `addTilesetImage`, `createLayer` per layer, collision by tile property (`setCollisionByProperty({collides:true})`) or an object layer of rects; dynamic sprites get `setDepth(y)` each frame because a tilemap layer has one depth, so tall props (shelves, plants, desks) go in an **object layer rendered as sprites** that sort with characters. Camera: `startFollow` with `roundPixels` and `setBounds`. 4-direction walk: one sheet row per direction, velocity normalized so diagonals do not speed up. `pixelArt: true`, integer zoom (DESIGN.md section 2 still applies).
- **Pathfinding**: [EasyStar.js](https://github.com/prettymuchbryce/easystarjs) on a grid derived from the collision layer is the standard Phaser answer ([GameDevAcademy tutorial](https://gamedevacademy.org/how-to-use-pathfinding-in-phaser/)); it is small, async and 4/8-way. A custom 60-line BFS/A* on the same grid is the fallback and is easier to unit test (Decision 5).
- **AI Town / Smallville**: [a16z AI Town](https://github.com/a16z-infra/ai-town) uses a Tiled map plus spritesheets and a simulation engine where an LLM picks each agent's next move; Smallville is the same idea. We take only the **movement layer** (named waypoints on a tile map, path to a target, bubble above the head). We do not take the planning layer: our agents' behavior is already real and arrives as events (09 stays right about this).

## Campus map (rooms)
| Room | Product meaning | Agents who live there |
|---|---|---|
| Lobby / Commons | hub, spawn point, shared table for agent messages | none (visitors) |
| Classrooms (one per chapter) | chapter rooms; chalkboard = quiz overlay trigger; mastery shown as lit lamp and tidy-ness of desks | `expert:<chapter>` |
| Council Room | quiz-key solvers: round table, 3 seats plus chairman | `council:*` |
| Debate Hall (lecture hall) | debate council, two lecterns, tiered seats | debaters |
| Library / Quiet room | the study brain: shelves, reading nook, citations | brain agent |
| Cafeteria | Lock-In lobby; group table | none (students gather) |
| Infirmary | Panic Line; bed and phone, lit at night hours | dean / panic agent |
| Exam Room | oral exam and rubric: single chair, examiner desk | examiner |
| Reception | notice board = disclosure ledger, front desk | mediator |
| Private rooms (one per student agent) | locked doors; agent home base | `student:<id>` |

```
+----------+----------+------------+-------------+
| Class 1  | Class 2  |  Class N   |  Library    |
|  [desk]  |  [desk]  |   [desk]   |  [shelves]  |
+---D------+---D------+-----D------+------D------+
|                  Commons / Lobby              |
|  [shared table]      (spawn)   [round table]  |
+---D------+----D-----+-----D------+------D------+
| Council  | Debate   | Cafeteria  | Infirmary   |
| Room     | Hall     |            |             |
+----------+----D-----+------------+-------------+
| Exam Room | Reception (notice board) | Private  |
|           |                          | rooms P1..|
+-----------+--------------------------+----------+
 D = doorway (3 tiles wide, 1 tile for private rooms: locked)
```
Target size: about 60x40 tiles (960x640 px native); camera follows the player; rooms are 12x8 to 16x10 tiles so a room fits one screen at zoom 3.

## VillageEvent to movement and animation
The pure adapter maps each event to `SceneCommand`s (`walkTo(agent, waypoint)`, `say`, `carry`, `lock`, `ring`, `openOverlay`...). Waypoints are named Tiled points (`commons.table.a`, `council.seat.2`, `room.<id>.door`).
| Event | In the campus |
|---|---|
| `agent.state` studying | agent at its desk, read animation; idle = wander in room; waiting = at its door (below); in_call = faces student, talk bubble |
| `agent.message` | sender takes an **envelope** and walks to the shared table in Commons (or to the recipient's door), drops it, returns; bubble shows only `shared[]`; `kind: conflict` adds red "!" |
| locked doors | student rooms have closed doors with a lock icon; only the owner's door opens; others are visible but never enterable (privacy) |
| `ledger.entry` | a card pins to the Reception notice board (shared text, or a black bar for `'hidden'`; blocked = red edge) |
| `confirm.pending` / `done` | the student's agent stands at **its own door** with a pulsing ring until `done`, then goes back in |
| `council.opinion/rank/verdict` | members walk to Council Room seats, bubbles per opinion, rank = bubbles pass around the table, chairman stands for verdict; dissenter keeps a red-lined bubble and flickering lamp |
| `call.start/caption/end` | agent walks to the student (or student to agent); DOM call overlay opens; captions live in the overlay, not the canvas |
| `quiz.*` | chalkboard glows; stepping to it or `quiz.question` opens the existing DOM quiz overlay; no scores shown |
| `trip.confirmed` | cutscene: all squad agents file out of the Commons front doors, a bus pulls up, Trip door opens; plays once, skippable, static card in Calm mode |
| `mastery.changed` | classroom lamp and desk tidiness step up; display only |

## Reuse vs rewrite (packages/village)
| Reuse as is or lightly | Rewrite |
|---|---|
| `sources` (Live, Replay), `VillageSource`, zod schema in `core` | world: a Tiled-based `CampusScene` replaces the parallax strip and `layout.ts` |
| `adapter` (event -> command; commands change from side-view x to waypoints) | camera (follow plus room-bounds, no parallax) |
| overlay bridge (`openCall`, `openQuiz`, `openLedger`, `focusAgent`), React overlays in `@squad/web` | character: 4-direction walk, idle, read, talk sheets and anims |
| motion tokens, curves, bubble, envelope, council, cutscene timeline (`ws/motion`) | collision and interaction zones |
| `a11y` feed and `AgentList`, HUD chips and Calm toggle, scaler/DPR math | pathfinding and waypoint graph |
| boot/mount, SSR-safe dynamic import | art and atlas pipeline |
Note: `main` has only the Phaser-free `sources` and a scaffold; the engine, adapter, mesh view and motion live on `ws/village-world`, `ws/village-mesh`, `ws/village-scenes`, `ws/motion`. The port step cherry-picks the reusable modules.

## Asset pipeline (license-safe)
The repo must never contain pack files once public.
1. Owner buys (or downloads the free sample) and unzips locally. `.gitignore` gains `assets/vendor/` (and `.cache/`).
2. `pnpm assets:import --from <path-to-pack>` (script `scripts/import-modern-interiors.ts`): validates the folder layout, copies only the needed sprites to `assets/vendor/modern-interiors/`, runs the **atlas packer** (single-file sprites to one PNG atlas plus JSON per scene), builds the character sheets from the generator output, and renders the **Tiled** tilesets; writes `assets/vendor/manifest.json` with a content hash.
3. **Maps are ours.** Tiled JSON references tiles by **name** through an indirection table `assets/campus/tilemap-slots.json` (slot -> sprite id), so the committed maps contain no pack pixels; they do contain layout, which is our own work. A `slot -> source` table per tier: `modern-interiors`, `cc0` (existing `assets/pixel/*`, Kenney/Ninja Adventure), `placeholder`.
4. **Fallback chain at boot**: vendor atlas present -> use it; else CC0 pixel assets; else a generated **placeholder palette tileset** (flat colored 16 px squares with letters for furniture, drawn by script from `palette.json`). CI and fresh clones always render something and pass smoke tests.
5. Guards: a CI check fails if any file under `assets/` matches the vendor manifest hashes or the pack's file-name patterns; a pre-commit hint; `docs/CREDITS` line "Modern Interiors by LimeZu" shown in the app footer whenever the vendor atlas is active. Built atlases are gitignored too; production deploys build them from a private artifact (Decision 3: a public demo that serves the atlas to browsers **is distribution**, so confirm the license reading with LimeZu before a public deploy).
6. The free sample is non-commercial only: fine for dev and the hackathon demo, not for a product.

## Accessibility and mobile
- Keyboard: arrows/WASD walk, Enter interacts, Esc leaves overlays; focus-visible HUD; a **"Go to" menu** (DOM list of rooms and agents, same as `AgentList`) auto-walks the player via pathfinding, so no precise steering is needed.
- Text alternative: a live region narrates room changes and agent actions ("Ana's agent is carrying a message to the commons table"); screen-reader users reach every agent and room from the list.
- Mobile: **tap-to-walk** (tap a floor tile, pathfind there; tap an agent to open its card) as default; optional **virtual joystick** (left thumb, 48 px minimum target) behind a setting. Zoom 2 at 390 px; overlays are full-screen sheets.
- Reduced motion and Calm mode per 08: walking becomes short fades between waypoints; ambient (plants swaying, lamp flicker) off. Color is never the only signal (icons plus labels).

## Tickets (parallel workstreams)
| # | Workstream | Ticket | Depends on |
|---|---|---|---|
| I-0 | tilemap-art | Download free sample, document real folder layout in `assets/vendor/README`, confirm tile and character sizes | none |
| I-1 | tilemap-art | Import script, atlas packer, fallback chain, placeholder tileset, `.gitignore` plus CI guard | I-0 |
| I-2 | characters | 4-direction sheet spec, composition script from generator layers, cast of about 12 (player, experts, council, mediator), CC0 fallback sheet | I-0 |
| E-1 | world-engine | `CampusScene`: Tiled load, layers, collision, y-sorted props, camera follow and bounds, integer zoom | I-1 placeholder only |
| E-2 | world-engine | Player 4-direction controller, interaction zones, door open/lock logic | E-1 |
| R-1 | rooms | Floor plan to Tiled map (lobby, corridors, 8 room types), named waypoints, doors | E-1 |
| R-2 | rooms | Dress each room (classroom set, library, lecture hall, canteen, infirmary) per `INTERIORS-ART.md` | R-1, I-1 |
| A-1 | agent-movement | Grid from collision, EasyStar (or own A*), waypoint graph, agent walker with idle/wander | E-1 |
| A-2 | agent-movement | Adapter v2: events -> waypoint commands (table above), envelope carrying, lock rules | A-1, motion port |
| P-1 | motion-port | Cherry-pick `ws/motion`, bubble, envelope, council, cutscene; re-target from side-view to top-down | E-1 |
| P-2 | motion-port | Top-down council seating sequence, trip cutscene, mastery lamp | P-1, R-1 |
| N-1 | integration | Overlay bridge, HUD, `AgentList`, Go-to menu, live region, tap-to-walk and joystick | E-2, A-1 |
| N-2 | integration | Replay scripts (`?replay=`), smoke tests (below), perf pass, credits, flip the village route to the campus | all |
Parallelism: I-0 first (1 hour); then {I-1, I-2, E-1} in parallel; then {E-2, R-1, A-1, P-1}; then {R-2, A-2, P-2, N-1}; N-2 last.

## Smoke tests
Scene boots with vendor absent (placeholder) and present; pathfinding reaches every waypoint from spawn; a replay containing every event type yields the expected commands (unit) and a visible change; no withheld value in bubbles, board or live region; keyboard-only run reaches an agent and opens call and quiz; CI guard rejects a vendor file.

## Risks
- Pack unreviewed until bought; folder layout and character format guessed (I-0 resolves).
- License ambiguity for a public live demo (assets are shipped to browsers).
- Mixed art (CC0 fallback beside Modern Interiors) looks uneven: fallback is for CI and dev only.
- Y-sorting with tall props and doorway occlusion is fiddly; budget for it in E-1.
- Scope: about 10 room types is a lot of dressing; ship Commons, 2 classrooms, Council, Reception first.
- Free sample has 4 characters only; the generator needs the paid pack.

## Decisions for you
1. **Buy the full pack ($1.50 minimum, name your price)?** *Recommend yes*; the sample lacks library, lecture hall, canteen, infirmary and the generator.
2. **Replace the village as default route, keep it behind `?world=village`?** *Recommend yes*, keep the branch code reachable, not deleted.
3. **Public demo with a vendor atlas** is likely distribution. *Recommend:* demo from your machine/private deploy until you confirm with LimeZu, public repo ships the CC0/placeholder fallback only.
4. **Tile size:** 16 px (matches existing 16 px pipeline) vs 32. *Recommend 16 at zoom 3.*
5. **Pathfinding:** EasyStar vs own A*. *Recommend EasyStar*, wrapped so it can be swapped.
6. **Mobile default:** tap-to-walk, with optional joystick. *Recommend yes.*
7. **Students' characters:** one generated avatar per persona (05 `spriteSheet`) vs a fixed cast. *Recommend per-persona via the composition script.*
8. **Phaser 3.90.0** stays (09 Decision 1). *Recommend stay.*
9. **Day/night:** interiors are daylight; keep the night palette only for a window glow and the Panic Line room. *Recommend yes* (see art doc).
