# Track 3 video: shot list and narration (about 2 minutes)

Source of timing: `apps/hub/sim/replays/track3.json` (114 s). Laptop at `/squad/village?replay=track3` (or Live); 2-3 phones show the group "Stats Midterm Grind". Say "this is the Replay" while the badge shows. The doubt answer panel and Step Diff are hub-driven panels, not events: in Replay the presenter narrates them while the agent states move.

| Time | Screen | Phone | Narration | Criterion | Checkpoint |
| ---- | ------ | ----- | --------- | --------- | ---------- |
| 0:00 | Village at dusk, dean at the council hall wakes at 0:03 | Group chat: "is a z-score of 2 about 95%??" | "Every class group chat is forty people guessing." | Use case | `hook` |
| 0:08 | Ana walks to the Chapter 6 house; expert glows; answer panel with a citation to our own file | Ana asks why 95% sits within two standard deviations | "It answers from the class file and cites the page." | Use case; accuracy | `doubt` |
| 0:22 | Join the Chapter 12 expert call; captions stream with citations | none | "Captions stream with citations to the chapter file." | Use case; craft | `call` |
| 0:42 | Quiz panel; two students answer; mastery glows | Ben and Ana answer | "It quizzes the group. Scores stay hidden by default." | Group-chat manners | `quiz` |
| 1:00 | Step Diff panel: matching steps, then the split | Ana and Ben DM photos of a least-squares problem | "It shows only where your work splits, never who is right." | Use case | `step-diff` |
| 1:18 | Ana's agent shows the waiting ring | Group: "sent you a DM"; Ana's phone shows her own summary | "Anything personal goes to a DM. Nothing about her is in the group." | Group-chat manners; consent | `private` |
| 1:28 | Planner council debates; one dissent | none | "The planner council argues the study plan, with one dissent. This is real-time animation of real events, nothing is a video." | Craft | `council` |
| 1:44 | Dean at the hall, dusk deepens | Ana: "@cubbie help me with the HW3 graded question" | "For graded work it gives a hint and the syllabus policy, never the answer." | Brand fit: integrity | `integrity` |
| 1:54 | Title card | none | "It answers from your class, cites where, and never does your homework." | Use case | end |

## Read-aloud narration (about 280 words)

Every class group chat is forty people guessing. Is a z-score of two about ninety-five percent? Nobody has the slides open. So we put Cubbie in the group, and the group becomes a village.

Ana walks to the Chapter 6 house and asks why about ninety-five percent falls within two standard deviations. The expert answers from our own OpenStax file and cites the page. Then she joins the Chapter 12 expert on a call. Captions stream in, each with a citation to the chapter file, so every claim can be checked.

The expert quizzes the group. Two students answer, and scores stay hidden by default so nobody is embarrassed. Mastery is private to each student.

Now two students try the same least-squares problem and get different answers. They each send a photo. Cubbie shows the group only the matching steps and the line where the work splits. No verdict on who is right, and each student's weak concept goes to their own queue.

When Ana asks how she is doing, the group sees one line: sent you a DM. Her own summary appears on her phone, and nothing about her is in the group chat. The bot speaks only when mentioned.

While the session winds down, the planner council debates a study plan with one dissenting voice. This is real-time animation of real events, not a video and not a score.

Finally, Ana asks for help with a graded homework question. Cubbie gives a hint and quotes the syllabus policy, and never the answer. It answers from your class, cites where, and never does your homework.

## Recording notes

- QuickTime movie recording for each phone, 1080p; composite phones beside the laptop capture.
- Run `pnpm demo:reset` before each take; no notifications, no Focus.
- Record the Replay first, then Live after two clean dry runs.
- Upload unlisted and use the link as `--video`.
