# E2E bugs: ops / proactive / security (branch e2e/ops)

Happy-path checks only. Each defect lists steps, expected, actual, and a file guess.

## BUG-1: pinky promise text is mangled when recorded
- Steps: `pnpm bot:chat`, then `/as s_ana`, `/group study s_ana s_ben`, `@cubbie I pinky promise to finish the essay by Friday`, then `@cubbie my pinky promises`.
- Expected: the promise reads "finish the essay (by Fri, Oct 30, 8:00 PM)".
- Actual: "1. I to finish the essay (by Fri, Oct 30, 8:00 PM) [unconfirmed]". The subject "I" is kept and "will" or "pinky promise" leftovers break the sentence.
- File guess: `packages/brain/src/skills/pact/parse.ts`.

## BUG-2: live credits-depleted state has no fix text from the hub
- Steps: code read only. Depletion could not be forced on the live hub, which reported `llm.mode=real` and `credits.state=ok`.
- Expected: when the hub reports `credits.state=depleted`, the Status page shows the exact fix "Top up Gemini credits in Google AI Studio (Billing). ...".
- Actual: the hub's `/v1/admin/status` payload has no `fix` field. The fix text exists only in `packages/web/src/pages/status/fixtures.ts`. A live depleted hub would show "Nothing to fix" in the Credits card, which contradicts the depleted state.
- File guess: `apps/hub/src/routes/status.ts` or `apps/hub/src/observability/` (add the fix to the admin status payload).
- Status: unverified live.

## BUG-3: `pnpm bot:chat` does not exit after `/quit`
- Steps: pipe a script ending in `/quit` into `pnpm bot:chat`.
- Expected: the process exits.
- Actual: the REPL stops reading, but the Node process stays alive (a timer or open handle keeps it running). A piped run also reports "readline was closed" if stdin ends before async replies finish.
- File guess: `apps/bot/src/cli/repl.ts` and `apps/bot/src/main.ts` (close the scheduler and db on quit).

## NOTE: possible overlap on mobile (unconfirmed)
- At 390x844 the fixed bottom nav covers the Credits "The fix" block in the full-page screenshot `docs/design/shots/e2e/ops/status-admin-depleted-sample-390.png`.
- This may be a full-page capture artifact of the fixed nav. Re-check in a viewport screenshot before filing.
- File guess: `packages/web/src/pages/status/status.css`.
