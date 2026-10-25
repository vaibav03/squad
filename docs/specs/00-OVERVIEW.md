# Squad build: overview and shared contracts (draft for approval)

Solo builder, with parallel AI build agents.
Each numbered doc below is a workstream spec. The user approves each one before a build agent starts it.

| Doc | Workstream | Track |
|---|---|---|
| 01-exam-mode-update.md | Picture It + Recap Radio in the Exam Mode Skill | T1 |
| 02-spine-imessage-bot.md | iMessage bot, @cubbie mentions, speaking policy, DMs, storage, LLM client | Core |
| 03-study-brain.md | Course ingest, chapter-expert swarm (teach, quiz, Feynman), doubt answering with citations, Step Diff, group study plan, course-planning council | T3 (+T1) |
| 04-agent-mesh-trip-planner.md | Per-student agents, A2A-style protocol, privacy gate, disclosure ledger, private group-study scheduling, privacy-preserving trip planner | T2 |
| 05-personas-voice-media.md | Personas (choose an avatar from the provided sprites and portraits; no avatar generation), persona voices, podcast episodes, illustrated explainers | Both |
| 06-web-dashboard.md | Standalone hub (SSE, replay, quiz/call endpoints) plus `@squad/web` pages: village page, ledger, trip, personas, setup, overlays, and a tiny web host | Both |
| 07-demo-and-submission.md | Demo scripts, video, READMEs, judging criteria map, submission steps | All |
| 08-village-motion.md | Village motion plan: the single animation spec (tokens, motion table, reduced motion, tickets M-1..M-9) | Both |
| 09-game-scenes.md | Squad Village: walkable side-view pixel world (Phaser 3.90.0) where students find agents, councils, calls and quizzes, driven by live events or a replay script (`packages/village`) | Both |
| 10-interior-campus.md | Squad Campus: top-down indoor world (Modern Interiors style) that replaces the side-view village as the primary world; license-safe asset pipeline | Both |

## Repo layout
Own private GitHub repo `squad`, a pnpm monorepo. The end goal is to integrate it into the Nook clone later (see "Later: integrate into Nook"); nothing here depends on the Nook clone to build or run.
```
apps/bot          imessage-kit listener + router                                   (02)
apps/agent        one process per student agent (port per student)                 (04)
apps/hub          standalone Hono server: reads port and secret from env; serves the SSE stream,
                  replay, quiz and call endpoints, /v1/*, /internal/events; replays in `sim/replays/<name>.json` (06, 09)
apps/web-host     tiny standalone Vite/React host that mounts @squad/web (sign-in stub, AppShell stand-in) (06)
packages/core     shared types (below), VillageEvent zod schema, internal-events helper, db, llm client, config (02)
packages/brain    course ingest, experts, quiz, step-diff                          (03)
packages/mesh     protocol, privacy gate, PSI, mediator                            (04)
packages/media    personas, voices, tts, images, podcast                           (05)
packages/village  Phaser world, sources, replay script                             (09; client-side only)
packages/web      @squad/web: React components and routes: village page, ledger, trip, personas, setup, overlays (06)
```
`contracts` are re-exported from `packages/core` (the zod schema and types), so web and village import them from there. The hub imports brain and media in-process. Public/private status of the repo and submission are covered in 07. Specs 02/03/04 use repo-relative paths.

Language: TypeScript, Node 20+, pnpm. LLM: Gemini, behind the provider-agnostic `Llm` interface in `packages/core` (model per role is set in 02). Voices: ElevenLabs. Storage: SQLite (better-sqlite3). Secrets in `.env` (GEMINI_API_KEY, ELEVENLABS_API_KEY, image key, Google OAuth).

## Shared contracts (every spec must conform; propose changes as open questions, don't diverge)
```ts
// packages/core
type StudentId = string;            // stable id, e.g. "s_ana"
type ChatId = string;               // imessage-kit chat id (group or DM)
interface Student { id: StudentId; name: string; handle: string /* phone/email */; personaId?: string; voiceId?: string; avatarUrl?: string }
interface InboundMessage { chatId: ChatId; isGroup: boolean; from: StudentId; text: string; attachments: { path: string; mime: string }[]; mentionsBot: boolean; ts: number; replyTo?: string }
interface OutboundMessage { chatId: ChatId; text?: string; attachments?: { path: string; mime: string }[]; personaId?: string }
// a feature handler; the router (02) picks one per message
interface Skill { name: string; match(m: InboundMessage, ctx: Ctx): Promise<number> /*0..1*/; handle(m: InboundMessage, ctx: Ctx): Promise<OutboundMessage[]> }
interface Ctx { db: Db; llm: Llm; send(o: OutboundMessage): Promise<void>; dm(student: StudentId, text: string, attachments?: OutboundMessage['attachments']): Promise<void>; askConfirm(student: StudentId, question: string, options: string[], taskId: string): Promise<string | 'timeout'> }
interface Persona { id: string; name: string; role: 'cubbie'|'expert'|'examiner'|'dean'|'council'|'rival'|string; systemPrompt: string; voiceId?: string; avatarUrl?: string; spriteSheet?: string /* pixel sprite sheet for the village */; portrait?: string /* Fluent 3D portrait for UI */; emoji?: string }
interface Citation { courseId: string; chapter: string; file: string; page?: number; quote?: string }
// mesh (04): every agent-to-agent message passes the privacy gate and lands in the ledger
interface AgentMessage { from: StudentId; to: StudentId | 'mediator'; taskId: string; kind: string; payload: unknown /* zod-validated per kind */ }
interface LedgerEntry { taskId: string; student: StudentId; field: string; shared: string; withheld?: string; ts: number }
```
Rules:
- The bot speaks in the group only when mentioned or when a skill scores >= 0.8; anything personal goes by DM; nothing is booked or revealed without `askConfirm`. Factual diagrams are drawn by code, not by image models.
- Minimum group size: for squads under 3 members, hide all counts, averages and topic aggregates that could identify a person. Applies in 03, 04, 05, 06, 09.
- Withheld values never appear in events or the UI; only the label and `'hidden'`.

## Village event contract (shared by 03, 04, 05, 06, 08, 09)
Every workstream emits these to the hub (06); the village (09) and the dashboard pages only consume them. The village shows real events and never invents behavior. A scripted replay file uses the same events, so Live and Replay look identical.
```ts
// AgentId: 'student:<id>' | 'expert:<chapter>' | 'council:<id>' | 'dean' | 'mediator'
type AgentId = string;
type VillageEvent =
  | { t: 'agent.state'; agent: AgentId; state: 'idle' | 'studying' | 'in_call' | 'waiting_for_student' } // in_call = voice calls only; mesh negotiation uses agent.message + studying
  | { t: 'agent.message'; from: AgentId; to: AgentId | 'commons'; taskId: string; kind: 'conflict' | 'option_dropped' | 'query_denied' | string; shared: string[] } // vetoes and dropped options use from: 'mediator'
  | { t: 'ledger.entry'; taskId: string; student: StudentId; field: string; shared?: string; withheld?: 'hidden'; blocked?: true } // blocked: a send the privacy gate stopped
  | { t: 'confirm.pending' | 'confirm.done'; student: StudentId; taskId: string; question: string }
  | { t: 'council.opinion' | 'council.rank' | 'council.verdict'; councilId: string; member: string; text?: string; dissent?: boolean; order?: string[] /* rank */; dissenter?: string /* verdict */ }
  | { t: 'quiz.question' | 'quiz.answer' | 'quiz.result'; quizId: string; chapter: string; target?: StudentId; student?: StudentId; correct?: boolean /* per-student only if the squad setting allows; default hidden */ }
  | { t: 'call.start' | 'call.caption' | 'call.end'; agent: AgentId; callId: string; student?: StudentId /* who joined, on start */; text?: string; cite?: Citation }
  | { t: 'trip.confirmed'; taskId: string; squadId: string }               // emitted by 04 when every student has confirmed; triggers the village trip cutscene
  | { t: 'mastery.changed'; student: StudentId; chapter: string; box: number }; // owner-filtered by the hub; house glow is progress display, not scoring
interface VillageSource { subscribe(fn: (e: VillageEvent) => void): () => void } // live (SSE) or replay (JSON script)
```
Ownership and rules:
- Council and member ids are `council:<id>`; member names are defined by 03 (two councils: quiz-key solvers, and chill/grind/advisor planners).
- One emitter per fact: `trip.confirmed` by 04; `mastery.changed` by 03; `call.start`/`call.end` by the hub; `call.caption` by 03's caption pipeline via the hub; `agent.message`, `ledger.entry`, `confirm.*` by 04 and the spine.
- Transport: every emitter POSTs to the hub at `/internal/events` (header `X-Nook-Internal`) through one helper in `packages/core`. The VillageEvent zod schema lives in `packages/core`; contracts are re-exported from it.
- Late joiners: `GET /v1/squad/state` snapshot, then the stream with `Last-Event-ID` resume.
- Quizzes: payload from `GET /v1/quiz/:quizId` (question + choices or free text); answers `POST /v1/quiz/:quizId/answer {choice | text}`. The id is `quizId` everywhere; a quiz answered in the village counts exactly like one in iMessage.
- Calls: `POST /v1/call/start` and websocket `/v1/call/ws/:callId` on the hub.
- Replay: shape is 09's (`{name, version, loop, cast, events:[{at, event}], checkpoints}`), selected with `?replay=<name>`, served by `GET /v1/squad/replay/:name`, files at `apps/hub/sim/replays/<name>.json`.
- Village rules: world art is pixel (09; CC0 packs in `~/Desktop/squad-assets/pixel/`, which 09 V0 audits); the Fluent 3D set is only for web UI chrome and portraits; calls and quizzes are normal page panels over the canvas (accessible), not canvas UI; Phaser loads only on the village route.

## Build order (full scope, quality first)
Vocabulary: "Core" means build it first; "Later" means build it after. Every ticket still gets built. Estimates exist only to order work and show dependencies.
1. Foundation: 02 spine (core package, router, fake-chat CLI), 06 hub and event stream, 09 village scaffold with replay script. No deadline pressure: build everything in parallel (git worktrees, `docs/WORKFLOW.md`) and submit when done.
2. Features in parallel: 03 study brain, 04 agent mesh and trip planner, 05 personas, voice and media, 08 motion plan (tokens first, ticket M-1, since 09 and 06 depend on it).
3. Experience: 09 village scenes and overlays (built on the 08 motion plan), 06 dashboard pages, 01 Exam Mode update.
4. Polish and demo: 07 demo scripts, recordings, READMEs, submission.
Quality gates between steps: each workstream passes its smoke tests before the next step starts.

## Later: integrate into Nook
Not a build requirement. When the Nook clone should host Squad:
- Nook adds `@squad/web` as a workspace dependency and mounts its routes under `/squad/*`.
- The hub base URL is set via config (Nook points at the standalone hub).
- Nook adds the `/squad/*` entries to the allow-list for its route-pin test.
- Phaser loads client-side only (Nook is SSR): dynamic import inside an effect, behind a client-only wrapper, as 06 and 09 describe.
