# Demo seed pack

Validated by `scripts/demo/lib/schema.ts` (zod, strict) on every `pnpm demo:seed`.

| File                 | Contents                                                                                                                                 | Public?                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `students.json`      | s_ana, s_ben, s_chi, s_dev: name, fake handle, persona, calendar file, and a `private` block (budget, hard no's, weak topics)            | only `id/name/handle/personaId` |
| `calendars/<id>.ics` | The week of Mon 2 Nov 2026 (America/Phoenix)                                                                                             | private                         |
| `lodging.json`       | Cabo ($310, dropped for budget), Flagstaff cabin ($64, chosen), Sedona glamping ($72, runner-up)                                         | public                          |
| `course.json`        | OpenStax Introductory Statistics 2e excerpt (CC BY 4.0), chapters ch2/ch3/ch6/ch12, group "Stats Midterm Grind", midterm Thu 5 Nov 14:00 | public                          |
| `personas.json`      | Five personas using the Fluent character art                                                                                             | public                          |

## Scenario mapping

- Study: no two-hour window is common to all four before the Thursday midterm (tested). Ben has labs, Ana has a private shift. Wednesday 19:00 works only if Ben moves his gym (event `s_ben-4`).
- Trip: Ben's cap is $80, Ana tells friends $200. The Flagstaff cabin ($64) fits everyone, Cabo ($310) fits no one, so the group sees only "option dropped: budget".
- Sentinels (`@squad/core` `SENTINELS`): `$180` is Ana's real hard cap, written in her private `budget.note` (what she tells friends is the $200 `comfortableUsd`). `therapy` is the title of a private event on Chi's calendar. They live only in private fields, so any appearance in an event, log or UI is a leak. `pnpm demo:preflight` scans the public view and both replays for them.
- Hub constants (`study task_study_ch5`, `expert:ch5`) come from the hub's own seed; this pack's chapters are the brain fixtures' ch2/ch3/ch6/ch12.
