# Judge Q&A sheet

Short, honest answers. "Show" is the proof to put on screen. Mocked or seeded pieces are named in each answer. Cost per question has not been measured yet, so we quote no number.

## Privacy and security

**Can the LLM leak private data anyway?**
Other students' raw data never reaches an LLM. Common slots and dates are DH-PSI and budget, veto, vote and topic counts are secret-shared: cryptographic in the semi-honest model. The privacy gate, each agent computing its own bits truthfully, and the ledger are data minimization you trust our code for. We say "PSI + secure aggregation", not "zero-knowledge". Prompt-only privacy leaks (MAGPIE reports 35-51%), which is why ours is enforced by strict zod schemas plus a scan, not a prompt.
Show: root README trust table; the gate test file in `packages/mesh/src/gate/`.

**Can a friend's agent just ask?**
It gets `query.denied`: Ana's gate refuses and a blocked row ("nothing" shared) lands on the notice board, naming no value.
Show: Track 2 beat 6, replay checkpoint `attack`.

**What does semi-honest mean here?**
Agents follow the protocol but may try to learn from what they see. An agent that lies about its own budget is not caught, and a range proof would need a committed budget we do not have.
Show: limits paragraph in the root README.

**Why PSI and not zero-knowledge?**
ZK has a precise meaning (a proof). What we do is private set intersection plus additive secret sharing, which is the right tool for "which slot is free for everyone" and "how many cannot afford it".
Show: `docs/specs/04-agent-mesh-trip-planner.md`, "Two crypto primitives".

**Can aggregates leak over time?**
Intersection size is revealed and a colluding coordinator could probe small slot spaces. There is a per-task query budget (default 8). Squads under 3 hide counts and aggregates that could identify a person.
Show: min-group-size rule; hub snapshot returns `memberCount: null` under 3.

**What if two agents collude?**
The semi-honest model does not cover collusion with the mediator. We state it as a limit rather than claim otherwise.

**Who stores calendars?**
Each student's agent holds only its own private state. In the demo these are seeded `.ics` fixtures. Raw calendars never go to the hub or the village; the hub receives labels such as "168 blinded tokens (padded)".
Show: `scripts/demo/seed/` and a replay file with no event titles.

**How do you prove nothing leaks?**
Sentinel tests plant `$180` and `therapy` in private data and assert none appear in any event, replay or log; `ledger.entry.withheld` can only be the literal `hidden` (strict schema). `pnpm demo:preflight` runs the same check on both replays.
Show: `pnpm demo:preflight` output.

**Student data and FERPA?**
Course material in the demo is OpenStax (CC BY 4.0), not student records. We minimize data by design (labels only on the wire). A production deployment would need a FERPA review and a data-processing agreement; we have not done that.

## Product and craft

**Is the motion canned? Is the village real or staged?**
It renders real events only; walking, bubbles and the trip cutscene are real-time animation driven by events (08 motion plan). Replay plays the same events from a script through the same code and is labeled with a Replay badge.
Show: `/squad/village?replay=track2` and the Replay badge; then Live if available.

**What is real and what is mocked in the demo?**
Seeded: calendars, budgets, the three or four students, lodging options, course pack. Simulated: students in the Replay and any student without a phone. Real: the crypto primitives, the gate, the ledger, the mediator, the event contract, the village rendering. Ports that other workstreams own may be stubbed until integration; the README says so.
Show: root README "Limits".

**Accuracy and hallucination?**
Answers come only from indexed course files and cite file and page; otherwise "not in your materials". Citation quotes were checked against the extracted PDF text.
Show: a call caption citing `ch12-linear-regression.pdf`, page 14.

**Academic integrity?**
Hints and the first wrong step, never the full solution to graded work, plus the syllabus policy line.
Show: Track 3 beat 8, checkpoint `integrity`.

**Why a village?**
It makes invisible agent behavior legible: locked doors are private data, the campfire is the only shared place, the notice board is the ledger. It is the "what they share" answer you can see.

**Why not ChatGPT group chats?**
Ours lives in the groups students already use, is grounded in their course files, and keeps each student's agent private.

**Group-chat manners?**
The bot is silent until mentioned (or a skill scores 0.8 or more); personal things go to DMs.

## Engineering

**Why Gemini?**
Project decision: Gemini for the bot, agents, experts and council behind a provider-agnostic `Llm` interface, so swapping is a config change. The mesh itself uses no LLM, so a quota failure cannot stall a negotiation.

**Rate limits and quota?**
Agents share one project quota; calls go through the `Llm` limiter and degrade to templated text. Haiku-class routing decides whether to speak and larger models run only on mentions; media is cached. Real cost per question: not yet measured.

**What happens offline?**
Replay needs no network. Live degrades: the mesh needs no LLM, and a missing hub never crashes a bot (`postEvent` returns `ok:false`).

**How does this scale?**
Per-student agents are independent processes; PSI is linear in padded set size (168 slots per study task, 64 days per trip). iMessage via `imessage-kit` is a prototype; production would use Apple Messages for Business or an API such as Sendblue or Linq.

**Is the Replay deterministic and valid?**
Yes. Both scripts validate against core's `validateReplay` in CI; every event type appears across the two; track2 ends on `trip.confirmed` with a checkpoint before the last confirm.
Show: `pnpm demo:preflight`.

**Why this is Cubbie's roadmap.**
One shared core runs both tracks: single-player Cubbie becomes multiplayer, and the village shows it as a place.
