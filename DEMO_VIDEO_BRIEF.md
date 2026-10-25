# Squad demo video brief

Build shown: `31e7ff3f` (web and hub). Everything on screen runs on the demo stack unless it says Live.

## Demo versus Live (say this on screen and out loud)

| Surface | What the video may say | What it must NOT say |
| --- | --- | --- |
| Canvas | "Demo Canvas workspace: 3 courses, 27 items. Simulated, not a real account." | "Connected to your Canvas" |
| Google | "Demo Google workspace: Drive/Docs, Calendar, Classroom. Simulated." | "Signed in with Google" |
| @cubbie answers | "Grounded in the imported items, every line cited. Footer reads Demo data." | "Live" |
| Council | "Scripted council run (Demo). Live Gemini is wired, key dependent." | "Gemini decided" unless a live run was shown |
| iMessage | "Demo bridge: a simulated text round trip, no real message sent." | "Texts your group" (real Sendblue is not connected) |
| Trip cutscene | Fine as is: it plays from a confirmed trip. | |

Live blockers to mention in one line at the end: Google needs an OAuth client and consent screen, Canvas needs a signed-in session or an `.ics` feed, and iMessage needs Sendblue credentials plus an allowlisted chat.

## Opening hook (0:00-0:05)

"Your syllabus, your Canvas and your Drive are scattered. Squad turns them into one study group that answers with receipts."

## Closing line (1:15-1:25)

"Squad: one group chat that knows your courses, shows its sources, and turns answers into plans. All of this ran on demo data. Live Canvas, Google and iMessage connect with real credentials."

## Strongest shipped features (one-liners for judges)

1. **Setup that tells the truth:** identity, then connect Canvas and Google, then review what was imported, then choose what to share, then your first group chat.
2. **Honest labels everywhere:** one status language (Live, Demo data, Degraded, Not connected) across Home, Connections, chat and the header. Demo content is never labelled Live.
3. **Canvas demo workspace in one click:** 3 courses, modules, assignments with real-looking due dates, announcements. Labelled Demo in every list.
4. **Grounded @cubbie answers:** ask "what is due from Canvas this week and what Google files should I study?" and get exact dates, course codes and names, and Drive titles with a reason each.
5. **Cited sources you can open:** every item has a chip showing where it came from, with a Demo or Fixture tag.
6. **Plan from this answer:** one button turns the cited due items into a shared study plan, inside the same chat.
7. **Planning lives in the group chat:** the "+" menu offers Plan a trip, Create a study plan and Group activity and ledger, with plan cards that members vote on.
8. **Group ledger:** a drawer that records who created, voted and decided, with timestamps and a source label.
9. **Trip confirmation cutscene:** when everyone confirms, the van drives across the village. A Replay trip button is there if you miss it.
10. **Council Hall:** a designed interior with the council table and seated agents, plus a compact result card (outcome, one disagreement line, agent rows). Diagnostics stay folded away under Technical details.

Optional if time allows, and only with the Demo label: **Ask again on expired questions** (an old Yes/No question shows Ask again instead of dead buttons), and **web to iMessage demo bridge** (simulated text lands once in the same chat, tagged via iMessage (demo), and the reply is mirrored out).

## 60-90 second visual sequence (target 80 s)

Prep before recording: fresh user state (dev reset for the demo student), browser at 1280x800, dark UI, Calm mode on for steadier frames, village loaded once so assets are warm. Keep the build marker visible in one shot.

| Time | Screen | Action | Say (short) |
| --- | --- | --- | --- |
| 0:00-0:05 | Squad title over the village | Hook line | Hook |
| 0:05-0:15 | `/squad/setup` first-run | Step "Connect": click Use Canvas demo workspace, then the Google demo. Badge shows Demo data. | "Setup starts with your real sources. No live account here, so it says Demo." |
| 0:15-0:22 | Review step, then Share step | Show Canvas 3 courses, Google Drive docs, then pick sharing. Counts match on both steps. | "Review what was imported, choose what the group may see." |
| 0:22-0:38 | Group chat | Type the exact question: `@cubbie what is due from Canvas this week and what Google files should I study?` Reply shows due this week, Next after this week, Google files with reasons, citation chips, footer Demo data. Hover or open one citation. | "Exact dates, course names, and files to study, every line cited." |
| 0:38-0:46 | Same reply | Click Plan from this answer, wizard opens in chat with the chips attached, finish to the plan card. | "One click turns the answer into a shared plan." |
| 0:46-0:56 | Chat "+" menu | Show Plan a trip, Create a study plan, Group activity and ledger. Open the ledger drawer briefly. | "Plans and the decision trail live in the group chat." |
| 0:56-1:06 | Trip card, then Village | Confirm the trip, navigate to the Village, the van drives across under "Trip confirmed". | "Everyone says yes, the van rolls." |
| 1:06-1:16 | Village, walk into the Council Hall | Show the interior with the table and agents, the compact dock on the right with the result summary, Technical details closed. | "The council meets at a real table. One clear result, diagnostics tucked away." |
| 1:16-1:25 | Connections page | Show the status states and the iMessage section: real Sendblue blocked, Demo bridge available. Then the closing line over the Squad logo. | Closing line plus the Live blockers line |

If the video must be under 75 seconds, cut the ledger drawer and the Connections shot, and keep the closing line.

## Shots to avoid (known rough edges)

- The in-world speech bubbles over agents (still small pixel text).
- The bottom-left "Replay trip" button on small windows (clipped at the edge): trigger the replay from the trip card instead.
- The top wall of the Council Hall at narrow widths (shown slightly under the header at 822 px): record at 1280x800.

## On-screen captions (use verbatim)

- "Demo data: simulated, not your account"
- "Every answer cites its source"
- "Live needs real credentials: Google OAuth client, Canvas session, Sendblue"
