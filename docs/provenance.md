# Reply provenance

Every bot reply says where it came from, or says plainly that it came from nowhere. Contract: `packages/core/src/provenance.ts`; composer: `postBot` in `apps/hub/src/chat/hub-chat.ts` (the ONE place every bot message passes through, including plan, trip, council and scheduler posts).

## Rule

`composeProvenance` keeps only **verified** citations (a course page that exists in the store, or a synced source that exists) and produces `message.provenance = {kind, label, sources, mode, via}`:

| kind | when | label |
|---|---|---|
| `grounded` | at least one verified citation | `N sources` (chips open the source viewer with the verified snippet) |
| `no_sources` | no citations | `No course sources used`, or the skill's own label (quiz question, policy line) |
| `sample` | built from sample data | `Not grounded: sample data`, `Fallback sample plan: ...`, `Fallback: sample catalogue` (semester plan) |
| `demo` | the scripted model answered | `Demo: scripted, not Gemini` |
| `ungrounded` | the text cites pages that did not verify | `Not grounded: cited sources could not be verified` (chips dropped) |

A grounded answer without chips cannot exist: no verified citation means no `grounded`. `mode` is Live (real model, real ports), Degraded (real model, stubbed ports or a reported model problem) or Demo. `via` is the channel of the question (`web` or `imessage`).

## What was dropping chips

1. Citations were only parsed from `(file.pdf p.N)` text markers. Structured citations never travelled: non-PDF sources (Canvas, Drive) answer as `claim (Title)` and the doubt and Canvas skills returned text only, so those answers had no chips. Skills can now return `OutboundMessage.citations`.
2. Quiz feedback, council verdicts, plans, behind, policy and fallback replies carried no marker and no label, so the footer was empty and looked unsourced. Quiz feedback now cites the page its explanation came from; the council message surfaces its members' verified citations; plan messages cite the verified material; everything else gets an explicit label.
3. The full chat page mounted no source viewer, so `source://` chips could not open there.

## Surfaces

Web: the bubble footer row (`chat-provenance`: sources count, mode, via) under chips, on the full page and in the village dock. iMessage: chips become `[file p.N]` text; a reply without sources ends with `(<label>)`. Tests: `apps/hub/test/smoke/provenance.smoke.test.ts` fails when a reply to a course question has neither chips nor a label; gate step S3e; `e2e/specs/j30-provenance-plan.spec.ts`.

## iMessage indicator

`GET /v1/imessage/status` returns `{enabled, mode: off|dry_run|live|fixture, killSwitch, dryRun, fixture, transport, degradedReason?, queued, failed, lastSyncAt, squads: [{squadId, name, bound, lastSyncAt, mirror}]}`. The chat header, Connections card and plan panel use `imessageIndicator()` in core: `Web only` (DMs), `iMessage: not connected (setup)`, `iMessage: dry run`, `iMessage: connected to <squad>, last sync <time>, <n> queued`, `iMessage: degraded: <reason>`, and for a scripted transport `Fixture transport (no real iMessage): connected ...`. `IMESSAGE_FIXTURE=1` (with `IMESSAGE_ENABLED=1` and `IMESSAGE_ALLOWED_CHATS=iMessage;+;chat-fixture-0001`) runs and binds a scripted transport for demos and e2e. Rows show `via web` / `via iMessage`; delivery state stays in `SyncBadge`.
