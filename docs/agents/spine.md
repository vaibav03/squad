# Brief: spine (spec 02), branch ws/spine

**Mission:** the iMessage bot that every other feature plugs into: transports, router, speaking policy, DM confirmations, memory, replay recording.

**Do first (gate):** write a verification script that proves the Photon imessage-kit works on this Mac (macOS 27): a group message's text must appear in the log within 5 seconds, a reply must send, an attachment must send. It needs the owner's spare Apple ID, Full Disk Access and Messages automation permission, so build the script, a precise setup README, and a dry-run mode, then report exactly what the owner must do. Build the Discord adapter either way as a tested fallback behind the same Transport interface.

**Build:** router that scores Skills; speaking policy (speak only when mentioned or very sure; one unprompted message per group per 2 minutes) with every decision logged for the glass-box demo; askConfirm via numbered DM with reply parsing, timeout and taskId; persona-tagged sends; SQLite schema; the Llm wiring and prompt-cache handles; fake-chat CLI that drives multi-student sessions from a script and records them with /record into replay JSON that validates against core; Village event publishing (agent.state, confirm.pending/done) through the core helper.

**Quality bar:** an adversarial test suite for the speaking policy (it must stay quiet in banter, answer when tagged, never double-post); property tests for reply parsing; a simulated 4-person group session as the smoke test; clear logs.

**Sub-agent ideas:** transport (iMessage + Discord), router and policy, confirm flow, CLI and recorder, test-suite author.
