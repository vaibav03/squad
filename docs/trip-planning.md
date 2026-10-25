# Collaborative trip planning

A squad plans one trip together. Everyone's agent contributes private constraints; the group only ever sees aggregates.
Code: `packages/core/src/trip.ts` (wire contract), `apps/hub/src/trips/*` (service, rules, chat intents, per-viewer view),
`apps/hub/src/routes/trips.ts` (HTTP), `packages/mesh/src/flows/trip.ts` (`runTripConstraints`), `packages/web/src/pages/trip/*`.

## Flow

1. **Create.** Two entry points, same service call:
   - Group or DM chat: `@cubbie plan a trip to Cabo in March` (aliases `@cubbie`, `@cubbi`, `@squad`, `@planner`,
     `@council`; in a DM no tag is needed). Without a destination Cubbie replies with the usage line.
   - Trip page: **Plan a trip** (no trip yet) or **Plan another trip** (after a trip ended, or on the seeded demo trip).
   The hub keeps trips per squad (`TripRecord.squadId`). Ids are `trip_<random>`; nothing is hard-coded. Real-account
   squads and the seeded `sq_demo` squad behave the same; the seeded `trip_cabo` stays addressable by trip id or task id.
   One active trip per squad (409 `trip_in_progress` with the existing `tripId`). The organizer is the creator.
2. **Constraints (status `planning`).** The hub asks the organizer's agent (`POST /internal/start/trip`,
   `constraintsOnly: true`) with public option facts only (id, slugged label, days, cost). Member agents answer through the
   mesh with the existing privacy mechanisms:
   - calendars: PSI over free days. The group learns only *"these days are free for everyone"* (`constraints.overlapDays`);
   - budgets and hard-nos: secret-shared sums (`cantAfford`, `veto`). Options nobody can afford or somebody vetoed are dropped
     with a reason that never names whose limit it was;
   - each agent posts only its own limits (`x.trip.limits`, tripId = the run id) so a member can see their own on the page.
   Calendar-derived busy blocks (Canvas/Google connections, titles never stored) enter through the agent's calendar loader.
   `TripService.setBeforeConstraints(fn)` runs before every check; wire `mergeContextBusy` from `feature/nook-parity` there
   once it lands on main (it writes `deriveTripConstraints` output as untitled busy blocks).
3. **Voting (status `voting`).** The hub posts the options to the group chat and DMs each member a numbered vote card.
   A member votes on the page (rank), by typing `I vote 2` (or `2` to the DM card), or via iMessage (same chat path).
   Revoting replaces your own row. Voting closes when everyone voted or the organizer closes it (needs at least one vote).
   Tally: Borda over the live options, ties broken by lower cost then label. Anyone may propose, edit or remove options
   while `planning` or `voting` (limit 8); a proposal re-runs the constraint check.
4. **Confirming (status `confirming`).** The winning option and the earliest run of shared free days are announced.
   Every member must confirm (page button, `confirm` in chat, or the DM card). One decline ends the attempt (`failed`);
   the organizer can reopen voting (votes cleared, new 48 h deadline).
5. **Confirmed.** When the last member confirms the hub emits `trip.confirmed` exactly once (deduplicated per task id), each
   member's `confirm.done`, a group chat summary, and the page links to the village cutscene (the page also hands off once).

Deadline: 48 h from creation or reopen. Overdue active trips become `expired`; the organizer can reopen.

## Council recommendation

`recommendation` = `{optionId, chair, planner, dissent[], mode}`. Chair names the pick (cheapest option that fits, or the
current leader once 3 voters exist), planner gives dates and cost, skeptic lines go in `dissent` (e.g. dropped options,
single surviving option, members skipped). `mode` is honest: `demo` = scripted rules text, no model; `live` = a real model
reworded it; `degraded` = a model is configured but did not answer in time (rules text stands). The page shows the badge.

## Privacy rules

| Data | Who sees it |
|---|---|
| Calendar | nobody; only "free for everyone" days |
| Budget / hard-no | its owner (`myLimits`); others see only "dropped by a limit" |
| Ranking | its owner (`myVote`); never in another viewer's payload, SSE event or chat |
| Who voted / counts | hidden below 3 voters and in squads under 3 (`voteProgress: null`, `members[].voted: null`); yourself always |
| Votes typed in the group chat | visible there (Cubbie warns; DM keeps it secret) |

## Honest states

- No trip: `{trip: null}` -> **No trip planned yet** + **Plan a trip**. Never "the hub did not answer".
- Agent offline or no agent: `constraints.state = waiting`, copy `Ben's agent is offline, trip waits for Ben`, per-member
  `agent` chip, **Retry** (any member) and **Continue without** (organizer; states that calendars/budgets were not checked).
  Nothing is checked, and voting does not open, until everyone is reachable or the organizer skips. The hub sweeps every 15 s
  and resumes automatically when agents return; a chat notice is posted on each change.
- Check failed or timed out: labelled `failed` with Retry. No overlap or no affordable option: stated plainly.
- Hub unreachable: error with Retry; offline browser: offline state.

## Cross-surface sync

Every decision (created, proposed/edited/removed option, vote arrived, voting closed, confirm, decline, cancel, reopen,
expiry, agent offline/back) is posted as a plain-text bot message to `group:<squadId>`. That is a normal hub chat event, so
the iMessage sync layer mirrors it; the trip code contains no iMessage code. Chat replies (`I vote 2`, `confirm`, `I'm out`,
`plan a trip to X`, `cancel the trip`, `trip status`) are handled by the trip service before the bot router, for web and
iMessage-origin messages alike. Vote and confirm DM prompts are ordinary numbered confirm cards, so numbered replies work.

## Conflicts (two members editing at once)

Optimistic concurrency, per option:
- `trip.rev` increases on every option/plan change, never on votes. Each option has its own `rev`.
- Edits send `baseRev`. Different options or fields never conflict. If the option changed after `baseRev`, the hub answers
  **409** `conflict` with who changed it, when and the current option. Nothing is written.
- The page shows a banner: **Keep theirs** (refetch) or **Replace with mine** (resend with `replace: true`); a replacement
  is logged in the change list and the chat ("... (replaced a newer change)").
- Votes are per-member rows and never conflict; a vote that ranks an option changed since the voter's `baseRev` gets a 409 so
  the voter can re-check. Confirming an option that is no longer the chosen one is a 409 too.

## API

`GET /v1/trips/current` -> `{trip|null}`; `GET /v1/trips/:id`; `POST /v1/trips`; `POST /v1/trips/:id/options`;
`PATCH|DELETE /v1/trips/:id/options/:optionId`; `POST /v1/trips/:id/{vote,confirm,close-voting,retry,continue,reopen,cancel}`.
Mutations return `{trip}` (the viewer's projection) or an error `{error:{code,message}}`; squads are isolated (404).

## Tests

Hub smoke `apps/hub/test/smoke/trips.smoke.test.ts`; mesh `packages/mesh/src/flows/trip-constraints.test.ts`; web
`packages/web/src/pages/trip/*.test.tsx`; Playwright `e2e/specs/j21-trip.spec.ts` (four students, live agents).
Run the e2e on your own ports: `E2E_HUB_PORT=8925 E2E_WEB_PORT=5325 E2E_AGENT_BASE=4751 pnpm e2e specs/j21-trip.spec.ts`.
