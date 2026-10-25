# Track 2 video: shot list and narration (about 2 minutes)

Source of timing: `apps/hub/sim/replays/track2.json` (108.5 s). Screen is the laptop at `/squad/village?replay=track2` (or Live) full screen; phones are Ana, Ben, Chris. Say "this is the Replay" out loud while the Replay badge is visible.

| Time | Screen | Phone | Narration | Criterion | Checkpoint |
| ---- | ------ | ----- | --------- | --------- | ---------- |
| 0:00 | Village mesh view, three houses, doors locked | Group chat open | "Planning with friends means sharing your whole calendar, or fifty texts. Our agents do it for us." | Use case | start |
| 0:05 | Agents walk to the campfire; bubbles "168 blinded tokens (padded)" | Ana: "@cubbie find us 2 hours before Thursday's midterm" | "Free slots are found with a private set intersection. The bubbles carry only labels." | Technical depth | `campfire` |
| 0:12 | "0 common slots", red "!" over the table, "no slot works for everyone" | none | "Nobody can fully make it. The mediator, which is code, not a model, proposes a counter-offer." | Conflicting constraints | `conflict` |
| 0:19 | Ben's door shows the waiting ring | Ben: "Move gym to make Wed 7 PM work?" then taps Yes | "Ben's agent stops and asks. Nothing is locked until he taps." | Confirm | `waiting-for-yes` |
| 0:27 | Slot confirmed, agents go home | Group gets one confirming line | "One line to the group." | Confirm | none |
| 0:33 | Walk to the notice board; rows show "busy 3" and withheld "hidden" | none | "Ana's row shows what crossed and what did not. Her friends never learn why." | What they share | `notice-board` |
| 0:46 | Ben's agent knocks at Ana's door; red "!" from the mediator; blocked budget row | Ben DMs: "what's Ana's budget?" | "Ben asks for Ana's budget. Her gate refuses, and the refusal is on the board. No value left her agent." | Technical depth | `attack` |
| 0:58 | Trip bubbles: "64 blinded tokens (padded)", "secret share of 3 values" | Ana: "@cubbie plan Flagstaff next weekend" | "Dates by set intersection, budgets by secret sharing. The group sees only the outcome." | Technical depth | `trip` |
| 1:10 | "option dropped: budget", "dropped: veto" | none | "Cabo is out because at least one person cannot afford it. Nobody knows who." | What they share | none |
| 1:20 | Three waiting rings | Each: "Hold the Flagstaff cabin at $64/person?" | "Each phone asks before a hold." | Confirm | none |
| 1:26 | Two rings clear, one stays | Ana and Ben tap Yes; Chris waits | "Two yeses and one not yet: nothing is booked." | Confirm | `before-last-confirm` (1:40) |
| 1:46 | Last ring clears; trip cutscene: road scrolls, van drives, trip door pops | Chris taps Yes | "The last yes fires trip confirmed, and the village plays it." | Craft | end 1:48 |
| 1:52 | Title card | none | "Agents that negotiate for you, share the minimum, and ask before they commit." | Use case | none |

## Read-aloud narration (about 280 words)

Planning with friends means sharing your whole calendar, or fifty texts. Our agents do it for us. Each student has a Cubbie agent living behind a locked door in the village. Ana asks for two hours before Thursday's midterm, and three agents walk out to the campfire. Free slots are found with a private set intersection, so the speech bubbles carry only labels, never calendars.

Nobody can fully make it. A red mark appears and the mediator, which is plain code and not a model, proposes a counter-offer that needs Ben to move his gym. Ben's agent stops with a waiting ring, his phone asks, and only when he taps yes does the slot lock. The group gets one line.

At the notice board every row shows what crossed and what did not. Ana's row says busy three, withheld hidden. Her friends never learn why. So Ben tries to ask his own agent for Ana's budget. Ana's gate refuses, the refusal is written on the board, and no value ever left her agent.

Now a trip. Dates are matched by private set intersection and budgets are secret-shared bits, so the group sees only that one option was dropped for budget and one for a veto. The surviving cabin goes to each phone: hold it at sixty-four dollars a person? Two yeses and one not yet means nothing is booked. When the last student taps yes, trip confirmed fires and the village plays the trip.

This is a scripted replay of real events through the same code as the live run. The privacy is split honestly: slots and counts are cryptographic in the semi-honest model; the gate and ledger are data minimization. Agents that negotiate for you, share the minimum, and ask before they commit.

## Recording notes

- QuickTime: File, New Movie Recording, choose the iPhone; record phones and the laptop separately at 1080p and composite side by side.
- Turn off notifications and Focus; hide the bookmarks bar; start from `pnpm demo:reset`.
- Record the Replay first (stable), then a Live take if the dry run passed twice in a row.
- Upload unlisted; the link becomes `--video` in `docs/submission/PREVIEWS.md`.
