# 07 Demo and submission (draft for approval)

Tracks 2 and 3 are judged privately by Cubbie on technical and use-case merit. The site asks us to show three things: how agents
handle **conflicting constraints**, **what they share**, and **when they ask the student to confirm**. Judges also want a clear reason a student would say "we need this".
The main visual is the walkable pixel **Squad Village** (09), driven by live events or a scripted **Replay** mode. There is no deadline pressure: everything is built in parallel and we submit once every quality gate in 00 passes.

## Scope
- Two demos, each about 2 minutes: Track 3 (the group chat plus the village) and Track 2 (agents per student plus the mesh view), each with a Replay-mode backup and a recording.
- READMEs, the submit commands, and prepared answers to likely judge questions.
- Out of scope: Track 1, whose scope is 01's Exam Mode update (Picture It + Recap Radio) and its own submission, and social posts (Tracks 2/3 have no post field).

## Judging criteria to the demo moment that proves it
| Criterion | Proof on screen |
|---|---|
| Conflicting constraints (T2) | At the campfire, the study slot no one can fully make: a red "!" conflict marker over the table, the mediator counter-offers, then asks Ben whether he'll move. |
| What they share (T2) | The notice board is the disclosure ledger: each row shows what crossed ("48 blinded slot tokens", "secret share of 1 bit") next to "withheld: hidden". Locked doors show what never left an agent. In projector mode the presenter sees only their own rows; other students' rows stay blurred. |
| When they ask to confirm (T2, T3) | A waiting-for-yes ring above the agent, plus DM prompts on real phones, before a slot is locked and before a trip hold. Nothing happens without a tap. |
| Technical depth | Slots and dates use DH-PSI, budgets, vetoes and counts use secret sharing (04's trust table: truly cryptographic, semi-honest). The privacy gate and ledger are code (zod `.strict()` schemas plus a scan), not a prompt, and are data minimization, not cryptography. The "what's Ana's budget?" attack is a `query.denied`: the gate refuses, a blocked ledger row appears. The village only renders events; withheld values are never in them. |
| Use case / "we need this" (T3) | Walk to a chapter house, ask a doubt, get an answer from our own lecture file with a slide citation. Step Diff shows only where two students' work splits. |
| Group-chat manners (T3) | The bot stays silent until @mentioned; anything personal moves to a DM. |
| Brand fit: integrity, consent | 03's homework-help policy skill gives a hint plus the syllabus policy, never the answer to graded work. |
| Craft (all tracks) | The village moves like a game (08 motion plan: parallax, walk cycles, easing, reduced-motion support) and every movement is real-time animation of a real event, not a scripted video. |
| Roadmap fit (multiplayer) | One shared core runs both tracks: single-player Cubbie becomes multiplayer, and the village shows it as a place. |

## Track 3 demo script (about 2 min): "Squad Village for CSE 310"
On screen: the laptop shows `/squad/village` full screen; 2-3 phones (or Messages mirrored) show the group "CSE 310 Midterm Grind". Course pack is seeded.
1. **Hook.** The group is mid-panic: "is it O(n log n) or O(n^2)??" Say: "Every class group chat is 40 people guessing." Cut to the village at dusk.
2. **Chapter house doubt.** The student sprite walks to the Chapter 7 house and asks "why is heapify O(n)?" The expert's answer panel opens over the canvas with 3 lines and a "Lecture 7, slide 14" citation; click it to open the slide. (If the quiz-key council from 03 is used, it verifies the answer key by 03's defined solver step before the panel shows it; not on the demo path.)
3. **Chapter expert call.** Walk to the Chapter 6 house and join the expert's call. Captions stream with citations; the expert persona has a voice. End the call.
4. **Quiz.** The expert poses a question in the quiz panel; two students answer. It scores both, and a Feynman prompt ("explain it to a 12-year-old") is graded. The same quiz works from iMessage and counts identically.
5. **Step Diff.** `@cubbie diff`: two students each DM a photo of their worked recurrence. The group sees only the matching steps and the step where the two split ("Ana and Ben split at line 3"), no verdict on who is right; each student's concept goes to their own mastery queue privately.
6. **Personal goes private.** "@cubbie how am I doing?" triggers 03's private mastery summary skill. The group sees "sent you a DM"; Ana's phone shows her own mastery summary. Nothing about her appears in the group (squad is 3 or more, so no small-group leak).
7. **Village motion is real.** Pause on the polished village: parallax hills, walk cycles, lit windows, bubbles and panels easing in. Say: "This is real-time animation of real events; nothing here is a score or a video." Dusk falls as the session winds down.
8. **Integrity close.** "@cubbie help me with the HW3 graded question" triggers 03's homework-help policy skill: a hint plus the syllabus policy line, never the answer. Close: *"It answers from your class, cites where, and never does your homework."*
Podcast recap: a pre-generated two-voice episode lands in the thread; play 5 seconds (Later beat, include when the run allows it).

## Track 2 demo script (about 2 min): "Three Cubbies, one plan, zero oversharing"
On screen: the laptop shows the village mesh view (campfire commons, each student's house with its door, the notice board); 3 phones (Ana, Ben, Chris).
1. **Hook.** "Planning with friends means sharing your whole calendar, or 50 texts. Our agents do it for us."
2. **Campfire negotiation.** In the group: "@cubbie find us 2 hours before Thursday's midterm." Three agents walk out of their locked houses to the campfire and exchange speech bubbles; the speech bubbles carry only labels ("48 blinded slot tokens"); common free slots come from DH-PSI and soft costs from secret sharing (04).
3. **Conflict.** No slot works: Ben has lab, Ana has a private work shift. A red "!" appears over the table. The mediator counter-offers Wed 7 PM, which needs Ben to move the gym.
4. **Waiting for yes.** Ben's agent stops and shows the waiting-for-yes ring while his phone gets "Move gym to make Wed 7 work? Yes/No." He taps yes; the ring clears and the group gets one line confirming the slot.
5. **Notice board (ledger).** Walk to the board. Ana's row: shared "busy 3", withheld "hidden". Say: "Her friends never learn why."
6. **Attack.** Ben DMs his own agent: "what's Ana's budget?" His agent knocks on Ana's locked door; Ana's gate refuses (`query.denied`, shown as a red "!" from the mediator), and a blocked "request denied: budget" row lands on the board. Nothing left Ana's agent, and the row names no value.
7. **Trip planner.** "@cubbie plan Flagstaff next weekend." Budgets stay private ($80 vs $200); dates overlap by PSI and budgets are secret-shared bits, so the group sees only "option dropped: budget" and the surviving plan. Each phone gets "Hold the cabin at $64/person?"; two yeses and one "not yet" mean nothing is booked, and the door shows a waiting ring. When the last student taps yes, `trip.confirmed` fires and the village trip cutscene plays (road scrolls, vehicle drives, Trip door pops). The trip beat stands alone. Close: *"Agents that negotiate for you, share the minimum, and ask before they commit."*

## Replay-mode backup plan
- Replay uses a scripted JSON file in 09's replay shape (`{name, version, loop, cast, events:[{at, event}], checkpoints}`) at `apps/hub/sim/replays/track2.json` and `track3.json`, served by `GET /v1/squad/replay/:name` and played by `ReplaySource` (`@squad/village/sources`) through the same `mountVillage` path as Live, so the visuals are identical: same sprites, overlays, conflict marker, waiting ring, motion and trip cutscene. No other replay variants exist.
- Scripts mirror the beats above and are recorded from a live run where possible (02's `/record`), then hand-edited. Withheld values never appear in them.
- Switch: `/squad/village?replay=track2` (a visible "Replay" badge stays on screen; say it out loud if asked). If Live drops mid-demo, reload with the replay URL and continue from the current beat or a checkpoint.
- Also keep one screen recording of each script (phones via QuickTime mirroring plus the laptop), uploaded unlisted; use it as `--video`.

## Live-demo setup
- **Bot:** imessage-kit runs on the Mac, signed into a dedicated bot Apple ID. Turn off sleep and Focus.
- **Students:** your iPhone (Ana) plus two more Apple IDs on borrowed phones or an iPad (Ben, Chris). Fallback: one real phone, the other two as simulated students on the web panel.
- **Seeded data:** one course pack (OpenStax or your own notes), indexed in advance. Calendars come from fixed `.ics` fixtures with the conflict built in. Trip data from a fixed list of lodging options.
- **Pre-generated:** podcast audio, avatars, voice clips and pixel sprite sheets, so nothing waits on TTS or image calls live.
- **Projector mode:** on the big screen use the Glass Box projector mode: it shows only the presenter's own data by default and blurs everyone else's until clicked.
- **Reset:** one `pnpm demo:reset` that reseeds the DB, clears the group and rewinds the village. Do full dry runs of both Live and Replay until two in a row pass clean.
- **Network:** a phone hotspot as backup to venue Wi-Fi (Replay needs no network).

## "We need this" lines
- "Your class group chat has the question and 40 wrong answers. Cubbie has your professor's slides."
- "Your friends need to know when you're free, not why."
- "Agents are coming to every campus. This is the layer that lets them talk without leaking."
- "It won't do your homework. It finds your first wrong step."

## Likely judge questions
- **Can the LLM leak private data anyway?** Other students' raw data never reaches an LLM. Use 04's trust table verbatim: common slots and dates (DH-PSI) and budget, veto, vote and topic counts (secret sharing) are cryptographic in the semi-honest model; the gate and its zod schemas, each agent computing its own bits truthfully, and the ledger are data minimization you trust our code for. Say "PSI + secure aggregation", not "zero-knowledge". Studies such as MAGPIE show prompt-only privacy leaks 35-51% of the time, which is why ours is enforced in code. The village renders those events, it is not a data source.
- **Is the motion canned?** No. Walking, bubbles, the envelope trip to the campfire and the trip cutscene are real-time animation driven by real events (08 motion plan); Replay plays the same events from a script and is labeled.
- **Can a friend's agent just ask?** It gets `query.denied`: the gate refuses and the blocked attempt is in the ledger.
- **Can aggregates leak over time?** Intersection size is revealed and a colluding coordinator could probe small slot spaces (04's stated limits); there is a per-task query budget. Squads under 3 hide counts and aggregates that could identify a person.
- **Accuracy and hallucination?** Answers come only from indexed course files and cite their source; otherwise "not in your materials".
- **Academic integrity?** Hints and the first wrong step, never full solutions to graded work, plus the syllabus policy.
- **Is the village real or staged?** It shows real events only. Replay runs the same events from a script and is labeled as such.
- **Cost?** Haiku routes and decides whether to speak; Sonnet runs only on @mentions; media is cached. Measure the real cost per question and put that number in the README; don't quote one we haven't measured.
- **iMessage at scale?** imessage-kit is the prototype. Production moves to Apple Messages for Business or an API like Sendblue or Linq; the core stays the same.
- **Why not ChatGPT group chats?** Ours lives in the groups students already use, is grounded in their course files, and keeps each student's agent private.

## README outline (one per track)
1. One-liner and a 20-second GIF of the village.
2. The problem, in a student's words.
3. Demo walkthrough (the beats above, with village screenshots).
4. How it works: a diagram of bot, router, skills (T3), or agents, gate, mediator, ledger (T2), plus the event hub feeding the village (Live and Replay).
5. Privacy and consent rules (T2, using 04's trust table: cryptographic vs data minimization), or speaking policy and integrity (T3).
6. Run it: `.env` keys, `pnpm i`, `pnpm demo:seed`, `pnpm dev`, and `pnpm demo:replay` for the scripted village.
7. Shared core with the other track, the Track 1 link, asset credits (CC0 pixel packs; no Cubbie assets copied), limits, what's next for Cubbie.

## Submission checklist
Fields (from `hackathon.py submit`) for Tracks 2/3:
- `--track agents|groupchat` and `--team` (60 characters max).
- `--name` (60 characters max) and `--pitch` (140 characters max).
- `--member "Name <email>"`: 1-4 members.
- `--repo`: required, must be a `https://github.com/...` link, may include a subpath.
- `--website` and `--video`: optional, https only. There is no post or platform field.

The entry is only a preview until you add `--yes`. You can edit it while the track is open.
```
cd /Users/vaibav/Documents/projects/devhacks/cubbie-hackathon-kit/skills/cubbie-hackathon
python3 scripts/hackathon.py whoami && python3 scripts/hackathon.py status
python3 scripts/hackathon.py submit --track groupchat --team "<team>" --name "<T3 name>" \
  --pitch "@cubbie in your class group chat: answers doubts from your own course files with citations, quizzes the group, finds your first wrong step." \
  --member "<Your Name> <you@asu.edu>" --repo https://github.com/<owner>/squad/tree/main/track3 --video <youtube link>
#   ...review the preview, then repeat with --yes
python3 scripts/hackathon.py submit --track agents ... \
  --pitch "Each student gets a Cubbie agent that plans study sessions and trips with friends, shares only what it must, and asks you before it commits."
python3 scripts/hackathon.py mine && python3 scripts/hackathon.py gallery --track agents
```
Both pitches fit: 139 and 140 characters. Order of steps, each gated on the previous one passing:
1. Dry runs of Live and Replay clean; record both scripts.
2. READMEs written and everything pushed to the `squad` repo; visibility set per Decision 1 (flip to public only on the owner's say-so).
3. Check that the repo opens for the judges (incognito), the village Replay runs from a fresh clone (`pnpm i`, `demo:seed`, `demo:replay`), and the video plays.
4. Preview both submissions and review every field.
5. `--yes` on both, then `mine` shows both entries.
6. Fix anything the gallery shows; resubmit while the track is open.

## Build tickets
Ordered by dependency only; all get built. Parallelize with git worktrees and a branch per workstream; see `docs/WORKFLOW.md` (being written).
| # | Ticket | Owner of | Depends on |
|---|---|---|---|
| D1 | Merged replays `apps/hub/sim/replays/track2.json` and `track3.json`. One owner, assembled from 02's `/record`, 04 `demo-trip`, 09's replay shape; track2 ends with `trip.confirmed` and has a checkpoint just before the last confirm | the only author of those two files | 02 V, 04, 09 |
| D2 | `pnpm demo:seed`: course pack, `.ics` fixtures, lodging list, roster, one trip awaiting its last confirm | seed script | 02 fixtures, 03, 04 |
| D3 | `pnpm demo:reset`: reseed DB, clear the group, rewind the village | reset script | D2 |
| D4 | `pnpm demo:replay`: start the hub and open `/squad/village?replay=track2` (or `track3`) | replay launcher | D1, 06 W7 |
| D5 | READMEs (`track2/`, `track3/`), recordings, dry runs of Live and Replay | docs and video | D1-D4 |

## Decisions for you
1. **Submission repo.** *Decided:* the submission is this repo, `squad` (private pnpm monorepo, no Cubbie evidence files, no copied Cubbie assets). It is public or as the organizers require; currently private. Flip to public at submission time only on the owner's say-so. No export script or clean-clone-from-clone step.
2. **One repo or two.** **Decided:** one repo (`squad`) with `track2/` and `track3/` READMEs, linked by subpath. Ask in #cubbie-track whether one codebase can enter both tracks.
3. **Phones.** **Recommend:** borrow 2 phones or use an iPad. Keep the simulated-student panel and Replay as fallbacks.
4. **Calendars.** **Recommend:** seeded `.ics` files on stage, with live Google OAuth only in the README.
5. **Track 3 coverage.** All beats are built; the 2-minute script shows the village beats, with explainers, avatar generation and the podcast shown on the web page or as an extra beat.
6. **Course content.** **Recommend:** an OpenStax chapter or your own notes, not copyrighted ASU slides.
7. **Names.** You choose team and project names. Suggestions: "Cubbie Study Group" (T3) and "Cubbie Circle" (T2).
