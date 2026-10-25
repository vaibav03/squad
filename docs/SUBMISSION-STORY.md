# Submission story: Squad (Tracks 2 and 3)

One shared core, two tracks. Track 3 (group chat): `@cubbie` lives in the group chats students already use. Track 2 (agents): every student has a private agent, and the agents coordinate without exposing what belongs to their student.

## The problem

Study groups run on group chats, and two things go wrong there.

1. Generic chatbots do not know your course. They answer from the internet, invent citations, and happily solve graded homework.
2. Coordinating anything with friends (a study slot, a trip) means either sharing your whole calendar and budget or sending fifty messages. Nobody wants friends to know they cannot afford the trip.

## Why agents, and why privacy

A group chat is the right place for shared help (a doubt answered with the page it came from, a quiz for the squad). It is the wrong place for private facts. A per-student agent can hold the private facts (calendar, budget, vetoes, weak topics) and still help the group, but only if "help the group" does not mean "tell the group". So the agents coordinate through cryptographic primitives and a gate, not through chat, and the LLM never sees another student's raw data.

Prompt-only privacy ("please do not reveal Ana's budget") leaks; the MAGPIE benchmark reports 35 to 51 percent leakage for LLM agents told to keep secrets. Ours is enforced outside the model: strict schemas, a scan, PSI and secret sharing.

## What is novel

- **Private agents coordinating without exposing data.** Common free slots and dates by ECDH PSI on ristretto255; budget, veto, ranked-vote and weak-topic counts by additive secret sharing, where only totals are revealed. The mediator is deterministic code that sees tokens, share sums and counts, never inputs. The mesh uses no LLM, so a quota failure cannot stall a negotiation.
- **A privacy gate with no free text.** Agent-to-agent messages are strict zod schemas: no free-text field exists, unknown keys are rejected, and a scan blocks any send that contains a private value. A friend's agent asking for Ana's budget gets `query.denied`, and a blocked row (naming no value) lands on the notice board.
- **A visible disclosure ledger.** Every share and every refusal is a label; a withheld value is never stored and the ledger can only say `hidden`. The village renders the same events, so the privacy story is something you can watch: locked doors are private data, the campfire is the only shared place, the notice board is the ledger.
- **Councils.** Three blind solvers and a chair check every quiz answer key before a student sees it, and a planner council (chill, grind, advisor, chair) builds a term plan. Opinions are shown in full, dissent is marked, and the verdict carries an outcome.
- **Rooms.** Thirteen village rooms, each with one purpose (quizzes, Feynman practice, step diff, term planning, key checks and more), explained in plain language inside the room. Status per room: [docs/guide/ROOMS.md](guide/ROOMS.md).
- **Grounded citations.** Answers come only from the indexed course files and cite file and page; otherwise the bot says it is not in your materials. Graded homework gets a hint and the first wrong step plus the syllabus policy line, never the full solution.
- **Confirm before commit.** Nothing is booked or locked without a tap; confirms are DM prompts, shown as a waiting-for-yes ring.

Architecture and diagrams: [docs/architecture/OVERVIEW.md](architecture/OVERVIEW.md). Trust table: `packages/mesh/README.md` (copied in the README and the architecture doc).

## What is real and what is demo

| Piece | State |
| --- | --- |
| PSI, secret sharing, gate, ledger, mediator, event contract, hub filtering | Real code, property tests and a red-team suite |
| Village and web rendering | Real, driven only by events |
| Replay (`?replay=track2`, `track3`) | Scripted `VillageEvent`s through the same code path; labeled with a Replay badge |
| Students, calendars, budgets, lodging, course reference | Seeded fixtures (four demo students); real calendar import is a later ticket |
| Course material | OpenStax Introductory Statistics 2e (CC BY 4.0), four chapters, not student records |
| LLM answers | Gemini when `GEMINI_API_KEY` is set and has credits; otherwise a scripted stand-in, labeled "Demo" and reported by `GET /v1/status` with a reason (`no_key`, `credits_depleted`, `rate_limited`, `invalid_key`), with automatic recovery |
| Voices | ElevenLabs when a key is set; captions always |
| iMessage | Prototype transport (`imessage-kit`); simulated students in the web panel are the fallback |
| Rooms | Some rooms work end to end on `main`, some are on unmerged branches; see [ROOMS.md](guide/ROOMS.md) for the current status |

## Honest limitations

- Semi-honest model only: an agent that lies about its own budget or veto is not caught (a range proof needs a committed, attested budget).
- A mediator colluding with an agent can probe small slot spaces; the PSI intersection size is revealed to the mediator. Squads under 3 get no counts, because with two parties a total reveals the other's input.
- The gate scan is a safety net; the real guarantee is the schema. Replay and ordering protection live in memory per gate instance.
- "Privacy-preserving" here means PSI plus secure aggregation. It is not zero-knowledge.
- Cost per question has not been measured, so we quote no number. FERPA review and a data-processing agreement have not been done.
- Venmo link format is unverified against the live app.

## Judge questions

Short answers live in [docs/demo/QA.md](demo/QA.md) (privacy, product, engineering). Additional questions this submission expects:

**How do you know a council answer is not just three copies of one model?** The three solvers run independently without seeing each other or the key. Members also rank each other, the chair gives the verdict (in code for the key check and the planner) and can record dissent; the room shows each opinion, who disagreed and the outcome. We do not claim independence beyond that: they share a provider.

**What stops the bot from inventing a citation?** Each claim carries a file, page and quote. `verifyClaims` (`packages/brain/src/citations/check.ts`) keeps a claim only if that page exists in the indexed course and the quote appears verbatim on it (normalized text, minimum length); struck claims are dropped. With nothing grounded, the reply is the fixed "Not in the materials. Ask the TA."

**What happens when the LLM provider runs out of credits mid-demo?** The hub switches the bot, agents and experts to the scripted stand-in on a 402, a 429 or a 401 (never retrying credits or auth errors, retrying 429 a bounded number of times), shows a Demo notice in the UI, and probes the real model again every 60 seconds (10 minutes for an invalid key). Top up and it recovers without a restart. The mesh is unaffected because it uses no LLM.

**What does a room do that a command would not?** It makes the work visible and explainable: each room says in student language what it is for, who is inside, what to type, what you get and what is shared.

**How do I run it?** `pnpm install`, `cp .env.example .env`, `pnpm dev:all`; no keys needed. [README quickstart](../README.md#5-minute-quickstart).

**Is this Cubbie's roadmap?** One core runs both tracks: single-player Cubbie becomes multiplayer, and `@squad/web` mounts under `/squad/*` in the Nook clone.

## Where to look

- README: [../README.md](../README.md)
- Track 3 walkthrough: [demo/track3/README.md](demo/track3/README.md); Track 2 walkthrough: [demo/track2/README.md](demo/track2/README.md)
- Specs: [specs/00-OVERVIEW.md](specs/00-OVERVIEW.md); decisions: [DECISIONS.md](DECISIONS.md)
- Credits: [CREDITS.md](CREDITS.md)
