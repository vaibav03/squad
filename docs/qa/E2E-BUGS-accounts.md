# E2E bugs: accounts and squads (J12)

Run: `e2e/specs/j12-accounts.spec.ts`, 6 tests, all passing on the harness stack (hub 8872, web 5272). Happy paths only. The defects below came from the screenshots and the code, not from failing assertions.

## 1. Switching squads does a full page reload

- Steps: sign in, have two squads, open the account sheet, pick the other squad under "Your squads".
- Expected: the sheet closes and the squad shell updates in place, with no reload.
- Actual: the switch calls `navigate(0)`, which is a full document reload. On the first J12d run the screenshot taken right after the switch was a blank white frame (4.7 KB). On a later run it showed the home skeleton with the nav already set to Home.
- File guess: `apps/web-host/src/router.tsx:117` (`onSwitch={(id) => account.switchSquad(id).then(() => navigate(0))}`). The `SquadSwitcher` comment says the host "remounts pages when the active squad changes", which a key or state change would do without a reload.
- Severity: medium (visible flash, slower switch, loses any in-page state).

## 2. Member rows: controls and status dots are hard to read

- Steps: open `/squad/members` as the owner, desktop 1280x800 and phone 390x844.
- Expected: row actions read as actions, and any indicator at the row end has a label or a legend.
- Actual: "Make owner" and "Remove" are small ghost text buttons with little affordance on phone. Each row also has an unlabeled coloured dot at the far right, and nothing says what it means.
- File guess: `packages/web/src/pages/squad-members/index.tsx` (the `sq-members__tools` block) and `packages/web/src/pages/squad-members/members.css`.
- Severity: low (copy and affordance, not a blocker).
- Screenshots: `docs/design/shots/e2e/accounts/j12c-03-members-owner-view.png`, `docs/design/shots/e2e/accounts/j12f-02-members-390.png`.

## Notes (not defects)

- The dev code is printed on the code step ("Dev only: code NNNNNN"). This is expected with `HUB_DEV_LOGIN=1`. Confirm it is hidden when dev login is off before a production build.
- After joining, the page keeps the `/join/CODE` URL and shows the joined state. A reload of that URL is not covered by these specs and has not been checked.
