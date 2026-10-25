# Customer-journey audit (first-time customer, fresh account)

Verdict that started this work: "The product still feels like separate feature demos."

Method: a fresh account (new e-mail, new empty squad) walked every route at desktop 1440x900 and mobile 390x844 on the
integrated branch (origin/main plus the home, provenance, integration, focus-panel, deliberation and Sendblue branches),
fixture mode, with a Playwright crawler (`e2e/.tmp/crawl.mts`, not committed) that records title, headings, buttons,
links, focus owner and a screenshot per route. Screenshots live outside the repo (never committed):
`~/Desktop/squad-demo/audit-d-<route>.png` (desktop) and `audit-m-<route>.png` (mobile). The first batch of fixes is
listed in "Status" and re-verified by `e2e/specs/j36-first-time-journey.spec.ts` (screenshots `ux-*.png`).

Severity: **S1** blocks or misleads the journey; **S2** a first-time customer hesitates or gets lost; **S3** polish.

## Journey-level findings (the "separate demos" problem)

| # | Sev | Finding | Fix | Status |
|---|---|---|---|---|
| J1 | S1 | Nine equal top-level destinations (Home, Village, Chat, Ledger, Trip, Setup, Personas, Courses, Connections): no order, no hierarchy, several are admin. | Four primary items (Home, Village, Chat, Connections) plus one keyboard-accessible "More" menu; every old route still works and highlights its parent. | done |
| J2 | S1 | No page says where you are or what happens next; each is a standalone tool. | `Page` takes `lede` and `next`; every page renders both ("Next: ..."). Top bar shows one server-driven line: "Next: connect Google or Canvas (1 of 5 done)". | done |
| J3 | S1 | The setup checklist, Setup wizard and Connections page each had their own idea of what is connected (Setup said "Calendar not started" next to a connected Google fixture). | One connection phase state machine (`lib/connection-phase.ts`) read by onboarding, Home, Setup, Connections and the chat banner. Setup has four steps derived from it. | done |
| J4 | S1 | "Live" pill is ambiguous: it showed Live for demo data. | One status pill: System live / Demo data / Degraded: reason / Offline, icon plus text, same component everywhere; one label map (`lib/state-labels.ts`). | done |
| J5 | S1 | Connections and Integration Health were two concepts; health was a separate page. | One Connections page with a health summary on top; `/squad/connections/health` redirects into it. | done |
| J6 | S1 | The journey does not begin with integrations; chat is reachable with no context and no explanation. | First-run tour (connect, review, share) and a chat interstitial with Connect or Skip (with an explanation); skip is stored on the server; a quiet "Limited context" banner afterwards. | done (server contract adapter, see gaps) |
| J7 | S2 | Council result does not carry into chat, plans or trips. | Result CTA opens chat or the plan wizard with the verdict attached as seed. | done |
| J8 | S2 | Trips and study planning were separate destinations. | Planning moves into the group chat (wizard `?wizard=trip|study`); `/squad/trips` redirects. | done (chat shell owned by the trip-truth worker) |
| J9 | S2 | Internal words in primary copy: FORCE_FAKE_LLM=1, HUB_ADMIN_TOKEN, "hub", "Glass Box". | Plain replacements and a banned-terms test in the journey spec. | done |
| J10 | S2 | Floating panels (agent panel, council card, plan pill, dock) can stack on each other. | Dock layout from fix/panels-semantics-dedupe, plus close/back on the agent panel and a bounding-box test. | done |

## Route by route

Screenshots are `~/Desktop/squad-demo/<name>` (desktop) unless the name starts `audit-m-`.

| Route | Sev | Finding | Screenshot | Fix |
|---|---|---|---|---|
| `/` | S3 | Redirects to Home when signed in; fine. | audit-d-_.png | none |
| `/welcome` | S2 | Signed-in users bounce straight to Home without a first-run path. | audit-d-_welcome.png | Welcome/Choose lead into the first-run tour. |
| `/join/:code` | S3 | Bad code is explained with a button ("Try another code"); good. | audit-d-_join_ABC123.png | none |
| `/squad` (Home) | S1 | Giant outdoor hero above the fold; three competing primary buttons ("Enter the Village" twice, "Propose a plan"); checklist rows with vague titles ("Add your course PDFs"). | audit-d-_squad.png, audit-m-_squad.png | Onboarding first: Next step card with ONE primary CTA; compact council-hall hero; truthful rows (Connect Canvas or Google Classroom, or upload PDFs); "Explore later" until a step is done; What's happening now strip. |
| `/squad` (Home) | S2 | Card "Spring break trip" could deep-link to a record that does not exist. | - | Cards resolve from real state (current trip, else "Plan a trip with your group"); legacy `/trips/spring-break` redirects. |
| `/squad/village` | S1 | No title or hint for a first visit; the "Study plan" pill is clipped under the top bar at 1440 wide; build marker overlaps the agent chips on mobile. | audit-d-_squad_village.png, audit-m-_squad_village.png | Panels addressable by `?panel=`; dock layout; guidance line; build marker moved. |
| `/squad/village?panel=mastery` | S2 | Unknown query was silently ignored. | audit-d-_squad_village_panel_mastery.png | `?panel=mastery|plan|council` opens the panel. |
| `/squad/chat` | S1 | Demo banner read "Demo mode: FORCE_FAKE_LLM=1, answers come from the scripted demo model". | audit-d-_squad_chat.png | "Practice mode: example answers, not real AI" from the label map. |
| `/squad/chat` | S2 | No gate or guidance when nothing is connected. | - | Context gate and "Limited context" banner. |
| `/squad/connections` | S1 | Two separate concepts (Connections, Integration Health); developer-style install steps (`pnpm --filter ...`) in the primary view; demo data shown as "Fixture". | audit-d-_squad_connections.png | One page, health summary first, per-card state words from the phase machine, developer steps collapsed under details. |
| `/squad/connections/health` | S1 | 404 ("Nothing at this address"). | audit-d-_squad_connections_health.png | Redirect into Connections. |
| `/squad/setup` | S1 | Four steps duplicated Connections (PDF upload, calendar) and ignored connected sources. | audit-d-_squad_setup.png | Four steps (Learning context, Availability, Messaging, Agent) derived from connection state; two actions each. |
| `/squad/courses` | S2 | Sample course shown first with no explanation of how it relates to Canvas or Google. | audit-d-_squad_courses.png | Lede and next line; "Connect Canvas or Google Classroom" shown first. |
| `/squad/trips` | S2 | Standalone planner with its own primary button and a separate "LIVE" badge. | audit-d-_squad_trips.png | Redirect to the chat plan flow; no standalone planner in the nav. |
| `/squad/ledger` | S1 | Title is a hard-coded demo task ("Group study: BIO 201 midterm") for a fresh squad; "Glass Box" is internal. | audit-d-_squad_ledger.png | "Privacy ledger: what agents shared"; task name shown only when rows exist. |
| `/squad/members` | S2 | Narrow centered layout unlike the rest; "Single-use link" unexplained; red "Leave squad" with equal weight. | audit-d-_squad_members.png | Lede and next line, plain explanation of single-use links, destructive action de-emphasised. |
| `/squad/personas` | S2 | Title "Personas" is internal; wall of 20 names. | audit-d-_squad_personas.png | "Study buddies". |
| `/squad/status` | S2 | Asks for `HUB_ADMIN_TOKEN` on a customer screen; layout spreads full width. | audit-d-_squad_status.png | "This page is for whoever runs Squad" with a button back to Home; contained layout; out of the nav. |
| `/squad/new` | S3 | Clear; add lede/next. | audit-d-_squad_new.png | Lede and next line. |
| `/squad/mastery` | S3 | Redirects to the village panel; ok. | audit-d-_squad_mastery.png | Uses `?panel=mastery`. |
| unknown route | S3 | "Nothing at this address" with a Back to Squad button. | audit-d-_squad_nowhere.png | none |
| extension pairing | S2 | Pairing code lives in a collapsed block in Connections; no confirmation of success. | - | Part of the Canvas card: Detected / Not detected, Check again, pairing code with a copy button. |

## Cross-cutting

- Focus: after route change focus lands on `main` (heading is focusable via `data-page-title`); the journey spec asserts focus is on the page heading or main.
- Back button: wizard and first-run steps are URL steps; village panels are `?panel=`; verified in the journey spec.
- Mobile: the "More" tab and tab bar do not overlap the dock; the dev annotation toolbar (dark round button at the bottom right of every audit screenshot) is a development tool, not product UI.

## Counts

Journey-level: 6 S1, 4 S2. Route-level: 10 S1, 11 S2, 5 S3 (rows above; a row with two findings is counted once per severity).

## Remaining gaps

Listed in the final report and at the end of `docs/ux/INFORMATION-ARCHITECTURE.md`.
