# Focused agent panel (evolved Agent Inspector)

Clicking any agent opens ONE dominant panel for that agent, in the right dock (about 560 px) or, inside the Council board, docked on the
board's right. Picking another agent swaps the content in place (never stacks); `Next`/`Previous` and the HUD rail keep the tab you are on.

## Where it opens from
Village sprites, room seats, the agent rail (HUD), Round Table help avatars and council card names (`InspectableVoice`), board org-chart cards,
the sender and recipient names in the handoff timeline, inspector Prev/Next. Anything outside the village calls `openAgentPanel(agentId)`
(`packages/web/src/overlays/inspector/openAgentPanel.ts`).

## Semantics
`role="dialog"` with `aria-modal="false"` (non-modal on purpose: the village keeps running), labelled by its `h2` (`<Display name> - <role>`).
Esc closes and returns focus to the control that opened it; in the board, Esc closes the panel first and the board second.
Tabs are `role=tablist/tab/tabpanel` with Left/Right/Home/End. A polite live region says `Now showing <name>` on a swap and
`<name>: <tab>` on a tab change; it is derived from this panel only. The village live region drops state announcements about other agents
while one is focused (`createAgentFeed({ focusAgent })`), so the two never name different agents.

## Tabs (exact names)
Activity (status log, right now), Reasoning summary (cards Goal / Evidence / Decision / Next step, shared notes, positions, verdict),
Conversation (default; handoff timeline filtered to the agent, `Selected agent` | `All communication`), Team (who it works with),
Structure (who reports to whom). The cards are built only from the public envelope fields (`PUBLIC_TURN_FIELDS` in
`packages/village/src/council/handoffs.ts`) and end with `Summary shared by the agent. Private reasoning is never shown.`;
fixtures say `Scripted example`.

## Handoff timeline
`handoffRows`, `groupByStage`: every A2A envelope ordered by seq, then ts, then id (`compareEnvelopes`), grouped by stage, each row
`Sender -> Recipient` in display names, purpose chip, summary, status (queued / working / done / degraded, derived from the envelope status,
mode and the recipient's later reply) and a time (relative with an absolute tooltip, or a clock time on the board). The board opens on it with
`All communication`; the panel with `Selected agent`.

## Provider state
Badge with icon and words: `LIVE: Gemini`, `DEGRADED: <reason>`, `FIXTURE: scripted, not Gemini` (replays) or `DEMO: scripted, not Gemini`, plus the
transport (`Gemini Live (audio + transcript)`, `Gemini streaming`, `Scripted (not Gemini)`). Empty states add `Live: Gemini | Partly live | Example
mode | Not set up`, an As-of time, source and mode, and a next step (`Start a council`, `Ask Cubbie`).

## Tests
`packages/village/src/council/handoffs.test.ts`, `packages/web/src/overlays/inspector/focus/focus.test.tsx`, `packages/village/src/a11y/feed.test.ts`,
`packages/village/src/hud/math.test.ts`, `e2e/specs/j32-agent-focus.spec.ts`, gate step `S5b` (`e2e/gate/steps/s05b-focus.ts`).
