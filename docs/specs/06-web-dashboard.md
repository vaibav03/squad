# 06 · Web dashboard: Squad pages in Nook (draft for approval)

Conforms to `00-OVERVIEW.md` (Village event contract, Build order). Nothing is built until you approve.

## Summary
Add a "Squad" section to the Nook web app (`app/apps/web`). Its main entry is the **Village** (`/squad/village`, a full-screen
walkable pixel world, spec 09). Around it sit the ledger, trip, persona and setup pages. All pages use the existing
`AppShell`, tokens and card style (the village is full-bleed inside the shell). A new `squad` area in `apps/mock` (Hono on :8787)
is the **hub**, the one backend the web talks to. It reads the shared SQLite db (`packages/core`), receives events from the bot (02),
the agents (04), the brain (03) and media (05), and streams the full `VillageEvent` union to browsers over SSE.
The hub imports brain and media in-process (no extra services). Clean-room rules still apply: the product is "Nook", no Cubbie assets, nothing calls cubbie.ai.

**Pages:** Village (main), Glass Box ledger, Trip view, Persona picker, Onboarding, Mastery map. All are Core.

## Scope
- **In scope (Core):** village page and overlays, onboarding, persona and voice picker, ledger, trip view, mastery map, hub API, unified SSE stream, replay, seed/demo data.
- **Out of scope:** real Google OAuth (the mock `/connect/:provider` flow, `.ics` upload or the 04 demo JSON is enough); avatar generation (05 owns it); the Phaser world itself (09 owns it, this spec only hosts it). Anything marked Later is not built in the first pass.

## Routes (inside the existing auth layout, so the user must be signed in)
| Path | Page | Data |
|---|---|---|
| `/squad` | Home. W2 owns the shell (setup checklist, **primary "Enter the Village" card**, links) | clientLoader |
| `/squad/village` | Full-screen village (09) plus call/quiz overlays and agent list | clientLoader + SSE or replay |
| `/squad/setup/:step?` | Onboarding: `phone` → `courses` → `calendar` | clientLoader |
| `/squad/personas` | Avatar and voice picker | clientLoader |
| `/squad/ledger/:taskId?` | Glass Box (live) | clientLoader + SSE |
| `/squad/trips/:tripId` | Trip planner (live): options, private limits, vote, confirmations, split. On `trip.confirmed` it triggers the village trip cutscene (see Motion) | clientLoader + SSE |
| `/squad/mastery/:courseId?` | Mastery map | clientLoader |

`test/routes.test.ts` pins the table to the original 37-route manifest. Foundation adds a `NOOK_EXTRA_ROUTES` allow-list that
includes `/squad`, `/squad/village` and the other `/squad/*` paths, so the guard stays intact and the test stays green.

## Client-only Phaser (the app is `ssr: true`)
- `routes/squad-village.tsx` renders the shell, side panel and overlays on the server. The canvas lives in `VillageCanvas`, wrapped in
  a `ClientOnly` component (renders a placeholder until `useEffect` runs).
- Phaser is pinned at **3.90.0** (Phaser 4 stays a decision in 09).
- `@nook/village` exports Phaser-free sources at the subpath `@nook/village/sources` (`LiveSource`, `ReplaySource`); `use-village-source` imports only that, so the host page and `AgentList` never pull Phaser.
- Inside the effect: `const { mountVillage } = await import('@nook/village')`, then `mountVillage(el, { source, onOverlay })` returns `{ destroy, setCamera }`. Phaser is never imported at module top level, so SSR never touches `window`.
- Ownership: 09 V0 owns the canvas mount (`mountVillage`); 06 W7 owns the host page around it.
- Code-split: the dynamic import is the only reference, so Vite emits a separate chunk loaded on `/squad/village` only. Other pages ship no Phaser.
  The effect cleans up with `destroy()`; `prefetch` is not used on links.
- While loading: skeleton plus "Loading village…"; on import failure: `Notice` with retry, and the side-panel list still works.

## Wireframes (rough)
```
/squad/village
+------------------------------------------------------------------------------+
| Nook · Village          [Source: (•)Live ( )Replay ▶ ⏸ 1x]   ● connected [Me]|
| +----------------------------------------------------+ +-------------------+ |
| |                                                    | | Agents (list)     | |
| |   Phaser canvas (full height, side-view pixel      | | ▸ Dean   idle     | |
| |   world: agents, council hall, quiz board)         | | ▸ Ch5 expert      | |
| |                                                    | |     in call  [Open]| |
| |        [overlay: Call panel]                       | | ▸ Council 1       | |
| |        +--------------------------------+          | | ▸ Ana (you) waits | |
| |        | Ch5 Expert · live call   [x]   |          | |   confirm [Answer]| |
| |        | caption text… [cite: ch5 p12]  |          | |        +--------------------------------+          | | Recent events…    | |
| +----------------------------------------------------+ +-------------------+ |
+------------------------------------------------------------------------------+
Overlays (React, over the canvas, focus-trapped, Esc closes):
 Call:  title, captions stream (aria-live=polite), citation chip, [Mute] [End]
 Quiz:  "Ch5 · Q2"  question, options as radio group or text box, [Submit]; result banner
```
```
/squad/setup                         /squad/personas
+-------------------------------+    +---------------------------------------------+
| (1)Phone ─ (2)Courses ─ (3)Cal|    | [Nook] [Ch5 Expert] [Examiner] [Dean]  tabs |
| [ drop PDFs here / browse ]   |    | +---------+  Voice: ( ) Calm prof ▶         |
| CSE 310 · ch1-8.pdf  ✓        |    | | avatar  |         (•) Hype coach ▶        |
| MAT 343 · notes.pdf  ▓▓░ 60%  |    | +---------+ Avatar: [a][b][c][d]  [Save]    |
+-------------------------------+    +---------------------------------------------+

/squad/ledger/:taskId  (Glass Box)         /squad/trips/:tripId
| Glass Box · "Group study"  ● live [Me|Projector] |  Options  Fits you?  Votes | Your private limits |
| Ana's agent | Ben's agent | Chi's agent | Mediator|  Cabo $640  ✓  #1         | Budget ≤ $700 🔒    |
| ✓ shared Tue 2-4 | ✕ withheld (hidden)  | picked  |  Vegas $380 ✕ vetoed       | Only you see this   |
| newest on top; red flash if gate blocked a leak  |  Confirmations: Ana ✓ Ben ✓ Chi …  [Confirm]  |
```
**Mastery:** grid of chapters × concepts, colored by quiz score, one row per student. Each student sees only their own row plus the squad average.

## Overlays and accessibility
- Call and quiz panels are React components over the canvas, not canvas UI. They reuse Nook `Modal`/`Card`/`Button`/`Markdown`, trap focus, close on Esc and return focus to the canvas.
  Quizzes answered here post to the same endpoint as iMessage, so scoring is identical. The quiz question and choices (or free-text prompt) come from `GET /v1/quiz/:quizId`. Correctness is hidden by default (shown only if the squad setting allows); the result banner then says "answer recorded".
  Joining a call uses `POST /v1/call/start` and the websocket `/v1/call/ws/:callId`.
- `AgentList` is the one accessible list (no second copy elsewhere), fed from the same `VillageSource` as the canvas. It is the accessible alternative: every agent with its state (from `agent.state`), a button to open its call or quiz, pending confirms, and a polite live log of recent events. The village is fully usable from it by keyboard alone.
- Canvas gets `role="img"` with a label pointing to the list; `prefers-reduced-motion` pauses ambient animation.

## Reuse from Nook (read-only imports, nothing forked)
- `AppShell` (`variant="workspace"`), `Page`, `Card`, `Button`, `Tooltip`, `useDropdownMenu` from `~/ui`.
- `Notice`, `Spinner`, `StatusDot`, `Modal` from `features/workspace/parts.tsx`, plus `.ws-card` and skeleton styles.
- `OnboardingSteps` and `ConnectHeader` from `connect-integrations/components.tsx`; step 1 links into `/connect/imessage`, "Import from Canvas" into `/connect/canvas`.
- `Markdown` from `web-chat`, the poll cadence in `web-chat/poll.ts` (SSE fallback), and `useAuth()` / `loadAuth()`.

## Hub endpoints (contract file `packages/contracts/src/squad.ts`, api-client `areas/squad.ts`)
All browser-facing endpoints are bearer-auth, `base: app`, and return `{error:{code}}` on failure.
- `GET  /v1/squad/state` → snapshot for late joiners (agent states, pending confirms for the viewer, trip confirmation status); the stream then resumes from it with `Last-Event-ID`.
- `POST /v1/squad/stream-token` → `{ st }` (5-minute SSE token).
- `POST /v1/call/start` `{agentId}` → `{ callId }`; websocket `/v1/call/ws/:callId` (audio and `call.caption`).
- `POST /v1/squad/courses` (multipart PDF) → `{ courseId, file, status:'queued' }`; `GET /v1/squad/courses` → ingest status (hands files to 03).
- `POST /v1/squad/calendar` (`.ics` or `{demo:true}`) → `{ busyBlocks: n }`. Only the student's own agent reads the raw data.
- `GET  /v1/personas` → `Persona[]`; `PUT /v1/personas/:id` `{voiceId, avatarUrl}`.
- `GET  /v1/voices`; `POST /v1/voices/preview` `{voiceId,text}` → `audio/mpeg` (05, cached).
- `GET  /v1/tasks`; `GET /v1/ledger/:taskId` → `LedgerEntry[]` (other students' `withheld` stripped unless projector mode).
- `GET  /v1/trips/:tripId` → `{ options[], dates, votes, vetoed[], confirmations[], myLimits }` (`myLimits` is the viewer's own only).
- `POST /v1/trips/:tripId/vote` `{ranking}`; `POST /v1/trips/:tripId/confirm` `{optionId, yes}` (same logic as the DM confirm in 02).
- `GET  /v1/quiz/:quizId` → `{ quizId, chapter, question, choices? }` (free text when no choices).
- `POST /v1/quiz/:quizId/answer` `{ choice | text }` → `{ recorded, correct?, explanation? }` (`correct`/`explanation` only if the squad setting allows; shared with the bot path, 03).
- `GET  /v1/mastery/:courseId` → `{ concepts[], mine:score[], squadAvg:score[] }`.
- **Unified stream:** `GET /v1/squad/stream?st=&taskId=` (SSE). Each message is one `VillageEvent` from 00 (`agent.state`, `agent.message`,
  `ledger.entry`, `confirm.*`, `council.*`, `quiz.*`, `call.*`, `mastery.changed`, `trip.confirmed`), event name = `t`, `id` = monotonic sequence.
  `taskId` is an optional filter; `Last-Event-ID` resumes (after `GET /v1/squad/state`). Page-only extras ride the same stream as `x.*` events: `ingest.progress`, `persona.speaking`, `trip.updated` (full trip object, already filtered).
- **Replay:** `GET /v1/squad/replay/:name` returns 09's shape `{ name, version, loop, cast, events:[{at, event}], checkpoints }` (`event` is a `VillageEvent`, not `e`). Files live at `apps/mock/sim/replays/<name>.json` and are selected in the browser with `?replay=<name>` (e.g. `?replay=track2`). The same viewer filter applies.
  The client `ReplaySource` plays it with speed, pause, seek and checkpoints. No other replay formats or endpoints.
- **Inbound:** `POST /internal/events` with header `X-Nook-Internal: <secret>` and a `VillageEvent` body (or `{type:'x.*',data}`), sent by every emitter through the one helper in `packages/core` (zod schema in core, re-exported by `packages/contracts`). The hub saves, filters per viewer, fans out.

**Per-viewer filtering (server, before send):** `ledger.entry` to anyone but the owner has `withheld` reduced to the literal `'hidden'`
(raw text is never in the event, per 00); `confirm.pending` question text, `mastery.changed` and `myLimits` go only to the owner; `quiz.*` per-student `correct` is hidden by default and shown only if the squad setting allows. Projector mode (D2) is a server-side session flag, not a client choice.
**Minimum group size:** for squads under 3, the hub hides all counts, averages, topic aggregates (`squadAvg`) and anything else that could identify a person (rule defined in 00).

**Source toggle:** `useVillageSource(mode)` returns a `VillageSource` (00) from `@nook/village/sources`: `LiveSource` (snapshot, then EventSource, 2 s polling fallback after two errors) or
`ReplaySource` (script JSON, chosen by `?replay=<name>`). Switching tears down one and starts the other with a fresh world state; the village code is identical for both.

## Motion
DOM overlays and pages follow `08-village-motion.md`: its three curve tokens (shared CSS custom properties from `packages/village/src/motion.ts`), rows 15 to 19 (building enter/leave fade, overlay panels with `@starting-style` at 200 to 280 ms ease-drawer, speaking portrait, HUD chip state change, button press), and its reduced-motion and Calm mode rules. Only `transform` and `opacity`; never `transition: all`, `scale(0)` or ease-in. On `trip.confirmed` the trip page hands off to the village trip cutscene (row 20); no text on this page animates for style.

## Live updates
- SSE with a 5-minute `?st=` token from `POST /v1/squad/stream-token`. Point the URL directly at :8787 in dev to avoid proxy buffering.
- Avatar animation: idle is a CSS breathing and blink loop; talking adds an amplitude-driven glow and scale from preview `<audio>` events or `persona.speaking` (no CSS mouth flap, per 05).

## File layout
```
apps/web/src/routes/squad-{home,village,setup,personas,ledger,trip,mastery}.tsx
apps/web/src/features/squad/{SetupPage,PersonaPicker,Avatar,GlassBox,TripPage,MasteryMap}.tsx
apps/web/src/features/squad/village/{VillagePage,VillageCanvas,ClientOnly,CallPanel,QuizPanel,AgentList,SourceToggle}.tsx
apps/web/src/features/squad/{use-squad-stream.ts, use-village-source.ts, squad.css, index.ts}
apps/web/src/i18n/locales/en/squad.ts
packages/contracts/src/squad.ts · packages/api-client/src/areas/squad.ts
apps/mock/src/routes/squad.ts · store/squad.ts · sim/squad.ts (seed + fake events) · sim/replays/<name>.json
apps/mock/test/squad.test.ts
```

## Build tickets (parallel agents; estimates only order the work)
| # | Ticket | Est | Depends on |
|---|---|---|---|
| W0 | Foundation: route entries incl. `/squad/village`, `NOOK_EXTRA_ROUTES` allow-list, mount `squad` area, contracts and api-client skeleton, `use-squad-stream` | 1 h | 00 contracts |
| W1 | Hub: routes, SQLite store, per-viewer filter, `/v1/squad/state`, stream-token, call start and ws, quiz endpoints, min-group rule, unified SSE fan-out for the full `VillageEvent` union with `Last-Event-ID`, `/internal/events`, in-process imports of brain/media, seed (4 students, 1 study task, 1 trip) | 2.5 h | W0 |
| W1b | Replay: `GET /v1/squad/replay/:name`, scripts in `apps/mock/sim/replays`, hub-side filter, one full demo script | 1 h | W1 |
| W2 | Onboarding: stepper, PDF drop zone with progress, calendar step, `/squad` home shell with Village card (W2 owns the shell) | 1.5 h | W0 |
| W3 | Persona picker plus `Avatar` (idle and talking) | 2 h | W0; 05 voices (static mp3 until then) |
| W4 | Glass Box ledger: columns, slide-in, blocked-leak flash, Me/Projector | 2 h | W1; 04 shapes |
| W5 | Trip view: options, private limits, veto, ranked vote, confirmations, split; cutscene trigger on `trip.confirmed` | 2 h | W1; 04 trip state |
| W6 | Mastery map | 1.5 h | 03 quiz scores |
| W7 | Village host page only (09 V0 owns the canvas mount): `ClientOnly` + lazy Phaser import, code-split check, `useVillageSource` via `@nook/village/sources`, Live/Replay toggle, `?replay=` | 2 h | W1, W1b; 09 V0 |
| W8 | Overlays and accessibility: `CallPanel`, `QuizPanel`, `AgentList` (the single list), focus trap, aria-live, 08 motion tokens and rows 15 to 19, reduced motion | 2 h | W7 |
| W9 | Integration: point hub at the real bot and agents, end-to-end run in two browsers, record replay scripts from a real run | 1.5 h | all |

W2–W8 build against `sim/squad` seed data and replay scripts, so they never wait on 02, 03, 04, 05 or 09.

## Smoke tests (light)
- `apps/mock/test/squad.test.ts`:
  - An agent posts a `ledger.entry` to `/internal/events`; a `/stream` subscriber receives it. Other `VillageEvent` types round-trip too.
  - **Viewer filter:** Ben's `GET /v1/trips/:id` has no Ana `myLimits`; Ben's stream and ledger show Ana's `withheld` only as `'hidden'`; same check on a replay.
  - `/internal/events` without the secret → 401.
  - `GET /v1/squad/replay/:name` returns ordered `{at, event}` entries that validate against the union.
  - Late joiner: `GET /v1/squad/state` then `Last-Event-ID` resume loses no events.
  - Squad of 2: `/mastery` omits counts and averages.
  - `trip.confirmed` reaches the stream once, only when every student has confirmed.
  - `GET /v1/quiz/:id` and the answer response omit `correct` by default.
- `pnpm typecheck` and `test/routes.test.ts` stay green with `/squad/village` in the allow-list.
- **Build check:** the production build has a separate Phaser chunk, and no other route's chunk imports it. Loading `/squad` and `/squad/village` server-side does not throw (no `window` access).
- **Manual:** open the village as two students, fire `POST /__sim/squad/demo-run`, watch both update; toggle to Replay and see the same scene; complete a call and a quiz overlay by keyboard only; confirm the trip as every student and watch the cutscene fire; check overlays with reduced motion on.

## Risks
- **SSE behind the Vite proxy can buffer.** Point at :8787 directly; CORS is set up.
- **Event shapes drift.** Pinned in `contracts/squad.ts` at W0 from the 00 union; seed and replay use the same schema.
- **Projector mode looks like a leak on camera.** Labeled "Demo projector"; it shows only the viewer's own data by default and blurs others (D2).
- **Phaser leaks into the main bundle or SSR.** Guarded by the build check above.
- **Ownership:** `routes.ts`, mock `index.ts` and barrels are Foundation-owned; W0 edits them in one pass.

## Decisions for you
- **D1. Hub: extend `apps/mock` or new `apps/hub`?** *Recommend extending apps/mock* (auth, CORS, area pattern, sim tooling already there).
- **D2. Withheld values in the Glass Box?** Options: (a) own items only; (b) projector toggle, blurred until clicked; (c) never show. *Recommend (b), with (a) as default:* projector mode shows only the viewer's own data by default and blurs others. Events still carry only `'hidden'`; projector reads the owner's view server-side.
- **D3. Avatar talking?** (a) breathing/blink plus amplitude glow and scale; (b) pre-rendered clip; (c) mouth lip-sync. *Recommend (a); no CSS mouth flap on 3D stickers (05).*
- **D4. Calendar source?** *Recommend `.ics` upload plus "use demo calendar".* Real OAuth adds no value for this build.
- **D5. Mastery map?** Core ticket (W6); built after W2–W5, no condition.
- **D6. SSE vs polling?** *Recommend SSE with 2 s polling fallback.*
- **D7. Village as the main entry?** *Recommend yes:* `/squad` leads with it, other pages stay one click away and deep-linkable.
- **D8. Replay storage?** Static JSON in `apps/mock/sim/replays` (recommended, deterministic and diffable) vs recording to SQLite. *Recommend JSON; exporting a live run to JSON is Later.*
- **D9. Motion and gamification?** *Decided:* no XP, levels, champions, streaks, bets or boards; the trip simply opens when everyone confirms (`trip.confirmed`, village cutscene). All motion follows 08-village-motion.md.
