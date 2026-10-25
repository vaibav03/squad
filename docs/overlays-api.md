# Overlays API (web-live) - shared by village-world, village-mesh and the web host

Source of truth: `packages/web/src/overlays/types.ts` (types) and `packages/web/src/overlays/index.ts` (exports, re-exported from `@squad/web`).
All overlays are plain-prop React components. They never fetch, never touch Phaser, the router or the hub client, and are SSR-safe (no `window` at module scope). The host owns data and state.

```ts
import { CallPanel, QuizCard, ConfirmSheet } from '@squad/web';
import type { CallPanelProps, QuizCardProps, ConfirmSheetProps } from '@squad/web';
```

## Mounting
- Render inside the village stage wrapper (`position: relative`). Each overlay renders `position: absolute; inset: 0` over it (a scrim plus the panel); there is no portal, so z-order is the stage's. Keep the element mounted and flip `open`; exit transitions run on `open=false` and the node unmounts itself after.
- Focus is trapped while open, Esc calls `onClose`, and focus returns to `returnFocusTo` (pass the canvas or the AgentList button). Tap targets are 44px. `calm` forces the reduced-motion variants (also automatic under `prefers-reduced-motion`).
- Motion follows 08 rows 16 and 19 (ease-drawer, 200 to 280 ms, transform+opacity only). Captions, quiz text and feedback never animate.

## Common props (`OverlayBaseProps`)
| prop | type | notes |
|---|---|---|
| `open` | boolean | controls mount and transition |
| `onClose` | `() => void` | Esc, scrim, close button |
| `returnFocusTo?` | `HTMLElement \| null` | focus target on close |
| `calm?` | boolean | village Calm mode |
| `fixed?` | boolean | cover the viewport (pages) instead of the nearest positioned ancestor; the village leaves it off |

## CallPanel
Events in, state out. Typical wiring in village-mesh: `call.start` -> `open`, `status:'connecting'` then `'live'`; `call.caption` -> append `{id, speaker:'agent', text, cite}` (the `student` echo, if any, as `speaker:'you'`); `call.end` -> `status:'ended'`. A pure helper does this for you:

```ts
import { callReducer, initialCallState } from '@squad/web';   // overlays/call-state.ts
state = callReducer(state, villageEvent)   // handles call.start | call.caption | call.end for one callId
// state: { open, callId?, agent?, status, captions, speaking, startedAt? }
```
| prop | type | notes |
|---|---|---|
| `agent` | `{id, name, role, portrait?, emoji?}` | header and portrait |
| `status` | `'connecting'\|'live'\|'reconnecting'\|'ended'\|'error'` | |
| `captions` | `CallCaption[]` (`{id, speaker:'agent'\|'you', text, cite?: Citation}`) oldest first, `aria-live="polite"` log | each shown whole; citation chip reads `Ch5 p12` |
| `speaking` | `'agent'\|'you'\|'none'` | glow and waveform colour |
| `level?` | 0..1 | smoothed amplitude; absent = calm baseline |
| `muted` / `onMuteChange(muted)` | | mic toggle (`aria-pressed`) |
| `handRaised` / `onHandRaiseChange(raised)` | | "I have a question" |
| `onLeave()` | | the only hang-up action |
| `onClose()` | | dismiss (Esc, x). Host should treat as Leave unless it supports a minimised call |
| `onOpenCitation?(cite)` | | chip click |
| `elapsedMs?` | number | timer |
| `message?`, `onRetry?` | | for `error` / `reconnecting` |

## QuizCard
No scores, ever. Correctness is shown only when `result.correct` is present (squad setting); otherwise it says "Answer recorded".
| prop | type | notes |
|---|---|---|
| `phase` | `'loading'\|'answering'\|'submitting'\|'done'\|'error'` | |
| `quiz?` | `{quizId, chapter, label?, question, choices?: {id,label}[]}` | no `choices` = free text |
| `result?` | `{recorded:true, correct?, explanation?}` | `phase:'done'` |
| `message?`, `onRetry?` | | `phase:'error'` |
| `quiz.index?`, `quiz.total?` | number | renders "Q2 of 5" and 5 progress pills (never a score) |
| `onNext?()` | | when given, the done state shows Next instead of Done |
| `onSubmit({choice?, text?})` | | host POSTs `/v1/quiz/:quizId/answer`, then sets `phase`/`result` |
Wiring: `quiz.question` (target = viewer) -> fetch `GET /v1/quiz/:quizId` -> `phase:'loading'` until it lands -> `'answering'`.

## ConfirmSheet
| prop | type | notes |
|---|---|---|
| `question` | string | from `confirm.pending` (owner only) |
| `options?` | `string[]` default `['Yes','No']` | first is primary |
| `details?` | `{label, value, tone?:'shared'\|'private'}[]` | what is shared / kept private |
| `phase?` | `'idle'\|'submitting'\|'done'\|'error'` | |
| `message?` | string | error text |
| `onChoose(option, index)` | | host resolves the confirm (`POST .../confirm`), `confirm.done` closes it |
| `student?` | StudentId | informational |

## Fixtures
`packages/web/src/overlays/fixtures.ts` exports ready-made props for every state (`callPanelFixtures`, `quizCardFixtures`, `confirmSheetFixtures`) for the gallery and for village-side tests.

## Status
All three components, `callReducer`, fixtures and stories are on `ws/web-live`. The prop contract above is frozen; additions are optional props only (`fixed`, `quiz.index/total`, `onNext` were added after the first publish). Overlays import nothing from the shell; they style through `src/overlays/kit/bridge.css` (aliases of docs/design/tokens.css). Mount inside a `.sq-scene` stage; each overlay adds `sq-scene` on its own root too.
