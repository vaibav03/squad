# Rooms A: Debate Stage, Devil's TA, Feynman Porch, Panic Line

Branch `rooms/a`. Audit rows updated in `docs/qa/ROOMS-AUDIT.md`.

## What each room does now
| Room | Chat phrase (addressed to the bot) | Code | Events |
|---|---|---|---|
| Debate Stage | `@cubbie debate <question>`, `@cubbie debate this` | `packages/brain/src/skills/debate` (`runDebate` on `createCouncilRun`, id `debate`) | `council.opinion` (pro, con, with text), `council.rank`, `council.verdict` with `outcome` and dissent, `agent.state council:debate` |
| Devil's TA | `@cubbie devil's TA ch2`, `@cubbie find my mistake` | `packages/brain/src/skills/devilta` | `quiz.question` (public text, chapter `devil:<ch>`), `quiz.result`, `agent.state expert:devil` |
| Feynman Porch | `@cubbie feynman ch3 <idea>` | `feynman/engine.ts` | `agent.state expert:feynman` (was `expert:<chapter>`) |
| Panic Line | `@cubbie diff` | `stepdiff/session.ts` | `agent.state` and `agent.message` from `expert:stepdiff` (was `dean`) |

## Design notes
- Debate: positions are framed by the model, two debaters argue, rankings run, then each student votes through `ctx.askConfirm` (90 s timeout counts as no vote), then the chair decides on merit (not popularity). If the room's majority disagrees with the chair that is the dissent (dissenter = the side the chair overruled). Course topics get chapter material from the dean route; a debater keeps a `[file p.N]` marker only if its quote is verified on that page (`verifyQuoteOnPage`), invented markers are stripped. Without material the debate is labelled general reasoning.
- Devil's TA: the planted-error line and keywords are stored at generation time. The student reply is judged in code (line number or span/keyword overlap, two tries). The LLM only phrases a nudge and the explanation, and its text passes a leak check. Public events never carry the location, keywords or correction. `quiz.result.correct` follows the quiz engine's `revealCorrectness` setting (hidden by default). No score or points.
- Credits depleted (HTTP 402 right now): both skills degrade to labelled template/demo text in one pass, no retry loops. Verified with FakeLlm failing every call.
- Honest scoring: both skills score 0 unless the message addresses the bot (or is a DM) and starts with the phrase; `apps/bot/src/adversarial/rooms-a.adversarial.test.ts` runs the 50-line banter corpus plus unaddressed variants. Devil and debate score 0.95 so the doubt skill (0.9) does not take them.

## Tests
- `pnpm --filter @squad/brain test` (debate 16, devilta 81, feynman and stepdiff emitter asserts), `pnpm --filter @squad/bot test`, `pnpm --filter @squad/village test`, `pnpm --filter @squad/web test`.
- Gemini: not run (key returns 402). The skills use only the generic `Llm`, so a working key needs no code change.

## Frames (docs/design/shots/rooms-a)
- `before/`: idle interiors and dim exteriors.
- `events/*.json`: real events dumped by `packages/brain/src/skills/{debate,devilta}/events.script.ts` (feynman and stepdiff are hand-written with the real event shapes).
- `after/<scene>-<name>-{interior,exterior,interior-calm}.png`: painted from those events with `packages/village/src/scenes/tools/capture-events.ts`.
- `after/dom-debate-stage-{1280,390}.png`: the room panel (outcome card + transcript) via the web dev harness `?replay=` and `shoot-rooms-a.mjs`.

Critique: debate stage lecterns and both bubbles read clearly; bubbles clip at about 90 characters with `..` (so the page citation is only in the transcript and card, as designed). Devil's board still shows the fixed sample equation, so the explanation is not painted. Feynman and Panic booths now react (speech bubble and label). The OUTCOME card footer reads "Plan is ready: ..." for any room; that copy is plan-specific (UX-owned, `packages/web`).

## Gaps
- Council Hall verifier wiring is untouched (council lead). Devil board does not paint the question text. Room panel footer copy above.
