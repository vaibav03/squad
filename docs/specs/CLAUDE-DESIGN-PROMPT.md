# Prompt for Claude Design (R / I / S / E format from claude-design-blueprint hack #10)

Attach before sending:
- 4–6 screenshots of the Nook clone (workspace, onboarding, profile), phone and desktop
- `app/apps/web/src/ui/styles.css` (the clone's tokens and components)
- `design-checklist.md` from the blueprint (hack #10)
- optional: 2–3 screenshots of a real iMessage group chat
- the asset folder `~/Desktop/squad-assets/` (zip it): characters (Fluent Emoji 3D, MIT), hero objects (Fluent Emoji 3D, MIT), Lucide icons (ISC), Lottie motion references, two background patterns, plus LICENSES.md

---

R: Here is my app: screenshots of my student-assistant web app and its stylesheet (styles.css). The product lives in students' iMessage; the web app is for setup and dashboards. Here is my checklist: design-checklist.md (20 rules in 5 groups). I am adding new features to this existing app, so every new screen must look like it was always part of it.

I: Design the screens for "Squad", a study-group layer with three parts: an @cubbie bot in the group chat, a private AI agent for each student that coordinates with friends' agents, and a village that makes the agents' work visible and feels like a game. Before designing anything, write DESIGN.md from my screenshots and stylesheet: tokens, type scale, spacing, radii, components, tone of voice. Then show me 2 directions for the Squad home screen only, both inside my existing style, and wait for my pick. After I pick, design these screens, phone (390px) first, then desktop (1280px):
1. Squad home: the squad's agents (each with its student's avatar and state), the next agreed study session, and a doorway into the Squad Village (the walkable world, designed in a separate prompt). No scores, streaks, bosses or boards.
2. Setup: link the iMessage group, add course PDFs, upload a calendar (.ics), pick a persona. One step per screen.
3. Persona studio: choose or generate an avatar, preview it animated (idle and talking), pick or design a voice with a play button, tone presets (chill tutor, strict examiner, hype coach).
4. Glass Box: a live log of what each student's agent shared and what it kept private ("shared: busy Tue 2–4 · withheld: work shift"). A viewer sees only their own withheld items.
5. Trip planner: unlocks when everyone has confirmed the plan (no locked state, no gate). Show trip options, my private limits (visible only to me), secret vote progress, everyone's confirmations and cost split. When the last student confirms, play the trip cutscene once, skippable (the road scrolls, a vehicle drives off, the Trip door pops open), then show the options.
6. Me: a private mastery summary only the student sees (weak topics and how each is improving against their own earlier self), plus persona and privacy settings. No XP, levels, champion stages or bets.
7. Action layer (turns a group decision into something real, always after each person's yes): a confirm sheet listing what will happen and who has said yes; study-room booking in a browser view with a "take over to finish" handoff; calendar invite preview; Venmo request links per person; Regroup, a live ETA board after the game with a fair meeting point and light-rail delays; Lock-In Lobby, a booked 50-minute co-study session with who's in and a focus timer; Stakes Pact, a small social bet ("loser buys boba") refereed by on-time submission, showing only yes/no; Handicap League, a weekly board ranked by % of your own plan done.
8. iMessage mockups: @cubbie answering a doubt with a slide citation; a plain quiz round (question, options, instant feedback); Step Diff (two photos, "you split at step 3"); a private DM asking "Thu 7 PM, you cover ch3. Yes?"; a podcast audio bubble; "@cubbie book us a room" ending in a confirm and a booked-room card; "@cubbie regroup" with per-person leave times; a Stakes Pact settled ("Ana submitted on time, Ben owes boba").

9. Agent animations (make the private coordination visible; these are the Track 2 moments judges watch):
   a. Negotiation table: each student's agent avatar around a table; each message flies sender → receiver as a small card; private fields ride along as a static redaction bar (never animated text).
   b. Private calendar match: each person's free slots become scrambled tiles, slide together, and only the shared slot lights up ("Thu 7 PM ✓"). Nobody else's slots ever appear.
   c. Conflict and counter-offer: a card that fails a constraint gives one short shake and turns red ("Ben has a shift"), then the counter-proposal slides in and the cards settle.
   d. Waiting for yes: each avatar has a soft pulsing ring ("waiting for Ana…") that becomes a drawn check mark when that student confirms; the plan locks when all rings are checked.
   e. Secret vote and budget count: sealed envelopes drop into a box one by one, then only the total flips open; the "can afford" count ticks up once.
   f. Glass Box rows slide in live as agents share things.
   g. Trip unlock cutscene: when the last student confirms, the padlock pops open, the road scrolls and the trip options fan out (rare delight, skippable).
   h. Mastery summary: weak-topic rows gently fill as the student improves (private, transform and opacity only).
   i. "Agents are talking…" typing indicator in iMessage, and a 2-second looping GIF of the trip unlock (last frame matches the first).

S: Match my existing app: reuse its tokens, fonts, components and spacing; add new tokens only for village/game-feel surfaces (agent state colors, glow, door states) and action states (pending yes, confirmed, booked) and define them in DESIGN.md. Copy patterns from my screenshots, never another brand's logo or assets. Privacy is part of the design: never show grades, budgets or who is behind; show team progress and "1 teammate still needs 2 blocks". Every screen has designed empty, loading and error states. Plain, friendly copy in a student's voice; no jargon like "agent mesh" or "PSI".

ASSETS (attached as squad-assets.zip; use these files, don't draw substitutes):
- characters/avatars: the 6 student avatars; each student's agent uses its student's avatar, so you can always tell whose agent is talking. Put avatars on a soft light circle so dark ones stay readable on dark backgrounds.
- characters/personas: bear = Cubbie mascot, owl = alternate mascot, teacher = examiner, wizard = chapter expert, ninja = rival.
- objects/hero: the 3D envelope, ballot box, padlock closed/open, calendar, check, shield, hourglass, map pin, light rail, money bag, books, headphones, microphone, party popper. Use these for the agent animations (9a–9i) and empty states.
- objects/icons: Lucide only for small UI icons (24px, 2px stroke, currentColor). Never mix the 3D art into icon slots or vice versa. No emoji characters as icons.
- objects/lottie: motion references for typing dots, success check, confetti, lock unlocking and loading pulse; match their feel but follow the MOTION rules.
- objects/patterns: optional subtle backgrounds.
- The 3D art is 256px native, so never show it larger than about 128px on screen. Talking avatars have no mouth frames: show "talking" with a gentle scale pulse and a glow ring, not lip sync.
- Add a credits line in settings: "Character and object art: Microsoft Fluent Emoji (MIT). Icons: Lucide (ISC)."

MOTION (condensed from 08-village-motion.md, the single motion plan; follow it exactly):
- Gate first. For every animation state how often a student sees it (100+/day, tens/day, occasional, rare) and one purpose: feedback, spatial consistency, state indication, preventing a jarring change, explanation, or delight. No purpose, no animation. 100+/day or keyboard actions get none. Delight only in rare moments (trip cutscene, first arrival in the village). Numbers, ledger text and anything people read never move for style; withheld text is a static bar.
- Same three curves, defined once in DESIGN.md, no others, never ease-in: --ease-out: cubic-bezier(0.23, 1, 0.32, 1) for entering/exiting; --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1) for moving on screen; --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1) for panels from an edge. Rare-delight spring only: { duration: 0.5, bounce: 0.2 }.
- Durations: press 100-160ms; sheets and panels 200-280ms; everything else in the UI under 300ms. Only explanatory agent animations (9a, 9b, 9e) may run to about 600ms per step, with 30-80ms staggers, never everything at once.
- Only transform and opacity (clip-path for the check-mark draw). Never scale(0) (start at scale(0.95) plus opacity 0), never transition: all. Rapidly triggered things use transitions, not keyframes. Hover motion only in (hover: hover) and (pointer: fine).
- Nothing flashes more than 3 times a second; nothing here is a score. Pause loops when the tab is hidden.
- Every animation ships a prefers-reduced-motion variant: fewer and gentler, not zero (keep opacity and colour, drop movement).
- Deliver a motion table in DESIGN.md: animation, trigger, frequency, purpose, tool, properties, curve and duration, reduced-motion variant.
- Never ship: transition: all, scale(0), ease-in, UI over 300ms without reason, layout properties, ungated hover, missing reduced motion, everything entering at once.

E: Before you call it done, run the checklist with 5 read-only subagents, one per group of 4 rules. Each reports rule number, where, severity, and a one-line fix, at 390px and 1280px, and flags dead buttons and leftover placeholder text. Add a sixth read-only motion reviewer that checks every animation against the MOTION rules and blocks: transition: all, scale(0) entrances, ease-in, UI durations over 300ms without a reason, animating width/height/top/left, keyframes on rapidly triggered elements, ungated hover, missing reduced-motion, and everything entering at once. Play each agent animation at 2–5× duration and step it frame by frame before approving it. Merge into one fix list and show me. Change nothing until I say go. Then fix it yourself and show before and after screenshots.
