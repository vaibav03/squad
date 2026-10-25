# Information architecture (final)

## Principles

1. One continuous path: Welcome, squad, connect, verify, ask, council, inspect, decide, plan (in chat), return.
2. Few top-level places with plain names; everything else lives under one "More" menu. No route is removed: old URLs redirect or still render.
3. Every page answers "where am I" (title plus one-line lede) and "what happens next" (one "Next:" line) and has exactly one primary action.
4. One vocabulary for "is this real?" (below), used by every screen.

## Navigation

Top bar and mobile tab bar (primary): **Home**, **Village**, **Chat**, **Connections**. A fifth item, **More**, opens a menu (a real button with `aria-expanded`, arrow keys, Escape returns focus): **Courses**, **Privacy ledger**, **Study buddies**, **Squad and members**, **Setup guide**. The active item highlights its parent (More lights up when you are on a secondary page).

Why these four: Home tells you the state and the next step; Village is the shared place where agents live and the council meets; Chat is where you ask Cubbie and plan; Connections is where context comes from. Trips and study plans are NOT a destination: planning happens inside the group chat (composer "+" menu, plan cards in the thread, Plans drawer). Operator-only System status is reachable by URL and from Connections details, never from the nav.

Top bar also carries the system status pill (right) and a one-line "Next: ..." strip under the bar, both from server state.

## Pages

| Route | Title | Purpose | Primary CTA | Where next |
|---|---|---|---|---|
| `/welcome`, `/welcome/choose` | Welcome | Sign in; create or join a squad | Continue | First-run tour |
| `/join/:code` | Join a squad | Accept an invite | Join squad | Tour |
| `/squad/welcome-tour/*` | Connect your learning context | Connect, verify, choose what is shared | per step | Chat |
| `/squad` | Home | State, next step, what is happening now | Continue: <next step> | the step |
| `/squad/village` | Village | Watch agents, enter the council hall, open panels (`?panel=council|plan|mastery`) | Ask the council | Chat or plan |
| `/squad/chat` | Chat | Ask Cubbie, talk with the squad, plan in the thread | Send | Plan card |
| `/squad/connections` | Connections | Health summary plus Canvas, Google, Messaging cards, imported items | Connect (state dependent) | Chat with the item |
| `/squad/connections/health` | (redirect) | Redirects to `/squad/connections#health` | - | - |
| `/squad/setup/:step?` | Set up | Four steps: Learning context, Availability, Messaging, Agent | Continue | Home |
| `/squad/courses/:id?` | Courses | Library of imported and uploaded course material | Connect or upload | Chat |
| `/squad/ledger/:task?` | Privacy ledger: what agents shared | What each agent shared or kept back | Open a row | - |
| `/squad/members` | Squad and members | Invite people, roles, leave | New invite link | - |
| `/squad/personas` | Study buddies | Choose voice and face | Save | Home |
| `/squad/trips/:id?` | (redirect) | Redirects into the group chat plan card, or the plan wizard if none | - | Chat |
| `/squad/status` | System status | Operator-only health | Unlock | Home |
| `/squad/new` | Create a squad | Name a squad | Create squad | Tour |

## State vocabulary (one label map: `packages/web/src/lib/state-labels.ts`, `lib/connection-phase.ts`)

Answers and system:
- **Live: answered by Gemini** (pill: System live)
- **Partly live: one member could not answer** (pill: Degraded: <short reason>)
- **Practice mode: example answers, not real AI** (pill: Demo data)
- **Not set up yet: add X to turn this on**
- **Offline: Squad cannot reach the server** (button: Try again)
- **Checking**

Connections (one phase machine): Not connected, Connecting, Syncing, **Live** (your own account only), **Demo data**, Needs attention, Sign in again.

## Copy rules

1. Plain verbs for actions ("Connect Canvas", "Ask the council"); nouns the customer already uses (course, due date, plan).
2. No internal terms in primary UI: A2A, SSE, PSI, envelope, tier, mesh, xref, webhook, hub, env var names. Explain inline instead ("how the agents handed work to each other"). Technical detail lives in collapsed "Details for whoever runs this" blocks.
3. Never say "Live" for demo data; never "Not started" for a connected demo source (say "Demo-connected").
4. Every empty, loading, offline, expired-auth and permission-denied state names the problem and offers a button.
5. One primary button per page; secondary actions are secondary or links.
6. No emojis; no gamification.
7. Page title is a noun phrase; lede says what the page is; "Next:" says what to do or what will happen.

## Where planning lives

Group chat: composer "+" menu (Plan a trip, Create a study plan) opens an inline wizard; plan cards sit in the thread; a Plans drawer in the group header lists them. Home and the Next step card deep-link with `/squad/chat?wizard=trip|study` (optional `&seed=<council run>`).
