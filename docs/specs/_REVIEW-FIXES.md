# Consistency fixes (decided by the orchestrator after the cross-spec review)
Every spec edit must follow these decisions exactly. Edit only your assigned files.

## A. Event contract (owner: 00; everyone else cites 00, never redefines)
- Add to the VillageEvent union: `raid.started {squadId, bossId, max}`; `boss.hit` gains `max`; `champion.stage {student, stage}`; `streak.updated {squadId, days}`; `board.updated {squadId}` (deltas fetched via the hub, never inline grades); `mastery.changed {student, chapter, box}` (owner-filtered by the hub).
- `ledger.entry` gains `blocked?: true` (a send the privacy gate stopped). `agent.message.kind` values include `conflict | option_dropped | query_denied`. Vetoes and dropped options are emitted `from: 'mediator'` so `from` never names the vetoer.
- `council.rank` carries `order: string[]`; `council.verdict` carries `dissent?: boolean` and `dissenter?: string`; council/member ids are `council:<id>` and member names defined by 03 (two councils: quiz-key solvers, and chill/grind/advisor planners).
- `call.start` gains `student?: StudentId` (who joined). `in_call` is for voice calls only; mesh negotiation uses `agent.message` and `studying`.
- `quiz.*` events carry `quizId`, `chapter`, `target?: StudentId`; per-student `correct` is shown only if the squad setting allows (default hidden). Quiz payload comes from `GET /v1/quiz/:quizId` (question + choices or free text); answers are `POST /v1/quiz/:quizId/answer {choice | text, confidence?}`. The id is `quizId` everywhere.
- AgentId mapping: `student:<id>`, `expert:<chapter>`, `council:<id>`, `dean`, `mediator`.
- `GameEvent` (08) is an internal bus (`game.emit`), never sent to the hub and not part of the union; 08's field definitions are authoritative and 04 cites them. One emitter per fact: `trip.unlocked` and `boss.*` and `raid.started` and `champion.stage` and `streak.updated` and `board.updated` by 08; `mastery.changed` by 03; `call.start`/`call.end` by the hub, `call.caption` by 03's caption pipeline via the hub; `agent.message`/`ledger.entry`/`confirm.*` by 04 and the spine.
- `Ctx.askConfirm(student, question, options, taskId)` returns `string | 'timeout'`.
- Transport: all emitters POST to the hub at `/internal/events` (header `X-Nook-Internal`) through one helper in `packages/core`. The VillageEvent zod schema lives in `packages/core`; `packages/contracts` re-exports it. 00's layout lists `apps/mock` (the hub), `packages/contracts`, `packages/api-client`. The hub imports brain/game/media in-process.
- Late joiners: `GET /v1/squad/state` snapshot plus `Last-Event-ID` resume.

## B. Replay, calls, sources
- Replay shape is 09's (`{name, version, loop, cast, events:[{at, event}], checkpoints}`). Selected with `?replay=<name>`; files at `apps/mock/sim/replays/<name>.json`; served by `GET /v1/squad/replay/:name`. Delete other variants.
- Calls: `POST /v1/call/start` and websocket `/v1/call/ws/:callId` on the hub.
- `@nook/village` exports Phaser-free sources at `@nook/village/sources` (LiveSource, ReplaySource); `mountVillage(el, { source, onOverlay })` returns `{ destroy, setCamera }`. 09 V0 owns the canvas mount; 06 W7 owns the host page; 06 `AgentList` is the one accessible list, fed from the same source.
- Phaser 3.90.0 pinned (Phaser 4 stays a decision in 09); 06 states the version.

## C. Rules
- Minimum group size: for squads under 3, hide all counts, averages, topic aggregates and boss details that could identify a person; applies in 03, 04, 05, 06, 09 (00 defines it, 08 already has it).
- Trip unlock: boss defeated, or optional unanimous waiver. The cutscene is owned by 09 (road scrolls, vehicle drives off, "Trip" door appears); on waiver the cutscene still plays without the boss line. 08 only emits the events. 06's trip page has a locked state with boss progress ("Hydra HP 45/120"); add `GET /v1/squad/progress`, `GET /v1/squad/board`, a `/squad/me` route; W2 owns the `/squad` home shell, G7 owns the champion/board content inside it.
- Withheld values never appear in events (`'hidden'` only); "projector mode" in 06 shows only the viewer's own data by default and blurs others.
- Art: pixel sprites in the world; Fluent 3D only for UI chrome and portraits; no CSS mouth-flap on 3D stickers (06 D3 → breathing/blink plus amplitude glow and scale, per 05); 05 does not generate avatars ("choose"). The pixel folder now contains: _packs, backgrounds, buildings, characters, fx, interiors, items, monsters, ninja-adventure; specs must say V0 audits it; the 4-stage creature line and boss/windmill/vehicle/summoning-circle art are unconfirmed.
- Vocabulary: "Core" and "Later" (no MVP/stretch/first-set). No deadline text anywhere: remove "Written Sat Oct 24, 5:10 PM", "Submissions close", "Track 1 cutoff", "Updated Sat Oct 24". Scenario times inside demo content are fine.
- Repo: develop in `cubbie-re/app`. The submission repo is an export of the whole `app/` workspace (Nook plus new packages) excluding `EVIDENCE.md`, `recovered/`, `rea/`, `docs/hackathon-ideas`, with no copied Cubbie assets. Specs 02/03/04 use app-relative paths and don't link `../hackathon-ideas`.
- `Persona` gains `spriteSheet` and `portrait` (00 lists them).
- 01: remove the claim that Exam Mode's Python `quiz.py` syncs with the village engine; say both use the same Leitner rules.

## D. Content fixes
- 07: beat 2 asks a doubt at a chapter house (not the Council Hall; the council verifies answers via a defined step if used); Step Diff beat uses two students' photos and shows only the split, no verdict; the trip beat comes after the boss raid (or starts from a replay checkpoint with the boss defeated); replace "@cubbie am I behind?" and "just do HW3 Q2" beats with skills that exist (see 03 additions); use `?replay=track2`; add a ticket table: merged `track2.json`/`track3.json` replays (one owner), `pnpm demo:seed`, `demo:reset`, `demo:replay`, the export script and clean-clone check.
- 03: add skills and tickets for "am I behind?" (private mastery summary by DM) and a homework-help policy skill (hint plus syllabus policy, never the answer to graded work); emit `mastery.changed`; define the quiz payload; council `dissenter`.
- 04: align `study.slot_agreed`, `study.block_done`, `trip.confirmed`, `trip.option_dropped` with 08's `GameEvent`; remove 04's own `trip.unlocked` emission; add a `query.denied` flow (a friend's agent asks for something private, the gate refuses, the ledger shows it) and align 07's wording to the trust table; use `from:'mediator'`.
- 02: add a ticket for "Village support" (agent.state, confirm events via the internal helper, `/record`); askConfirm takes `taskId`.
- 05: M4 depends on V0's asset audit; call start uses the hub endpoints in B.
- 06: add the endpoints in A/B/C, the Phaser version, `/squad/me`, snapshot, call endpoints, trip locked state, replay shape, D3 fix, ownership notes.
- 08: GameEvent is internal; waiver plays cutscene; `/squad` ownership; min-group rule; champion gallery uses sprites.
- 09: add event-table rows for raid.started, champion.stage, streak.updated, board.updated, mastery.changed, blocked ledger entries, conflict/option_dropped/query_denied "!" markers, dissenter bubble, call.start student; `?replay=` param; sources subpath; mountVillage signature; cutscene owner; min-group rule; real pixel folder contents.
