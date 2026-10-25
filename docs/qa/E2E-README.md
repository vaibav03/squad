# E2E acceptance: how to run everything

Everything lives in `e2e/` (own `package.json`, installed with `--ignore-workspace`, so the root lockfile is untouched). Specs are Playwright, one file per journey (`e2e/specs/jNN-*.spec.ts`). Results: `docs/qa/E2E-REPORT.md` (generated matrix), defects: `docs/qa/E2E-BUGS.md`, screenshots: `docs/design/shots/e2e/<journey>/`.

## One command

```
pnpm e2e                 # installs e2e deps + chromium on first use, boots the stack in DEMO mode, runs J1..J15, tears down
pnpm e2e j09 j14         # a subset (any Playwright file filter or -g "title")
pnpm e2e:live            # same journeys against real Gemini (LIVE=1); every journey skips with a clear message when /v1/status says credits_depleted / invalid_key / fake
```

The runner (`e2e/lib/global-setup.ts`, `e2e/lib/stack.ts`) boots the hub, four agents and the web host itself (not `pnpm dev:all`, whose fixed agent ports 4101-4104 collide with other stacks) with `FORCE_FAKE_LLM=1` (demo mode, FakeLlm, demo banner): hub 8851, web 5251, agents 4151-4154 (override `E2E_HUB_PORT`, `E2E_WEB_PORT`, `E2E_AGENT_BASE`; the run refuses to start when one of its own ports is busy). The hub database is `e2e/.tmp/hub.db` (fresh each run). Logs: `e2e/.tmp/{hub,agent-*,web}.log`. With `LIVE=1` the Gemini/ElevenLabs keys are read from `.env` and passed to the children (never printed) and `FORCE_FAKE_LLM` is not set.

## Faster loop with a long-lived stack

```
e2e/stack-up.sh                       # background dev:all in demo mode (E2E_HUB_PORT / E2E_WEB_PORT apply)
cd e2e && E2E_REUSE=1 npx playwright test j10
e2e/stack-down.sh
```

`E2E_REUSE=1` never boots or kills anything. `E2E_NO_AGENTS=1` boots without agents. `E2E_KEEP=1` leaves the stack running after the run.

## Status of features that were not on main

A journey whose feature is not on the branch under test (chat/web, council/ask, qa/web were on branches when this was written; they are on `main` now) detects it (`chatMerged()` probes `/v1/chat/chats`) and reports `blocked: not merged yet` instead of failing. After merging `origin/main` into this branch, just rerun.

## Journeys

| Id | File | Needs |
|---|---|---|
| J1 sign in (through the real sign-in screen and the accounts layer), setup (phone, PDFs, .ics, persona) | `j01-setup` | stack |
| J2 group chat grounded answer, J3 private DM and sentinels, J4 quiz, J5 council, J6 semester plan, J7 study modes, J11 media | `j02`..`j07`, `j11-media` | chat; reported `blocked` on a tree without it |
| J8 trip, study scheduling, cutscene | `j08-squad-flows` | agents |
| J9 ledger privacy | `j09-ledger` | stack |
| J10 village | `j10-village` | stack |
| J12 mobile and keyboard | `j12-mobile` | stack |
| J13 resilience | `j13-resilience` | spawns its own hub on `E2E_J13_PORT` (8893), kills it with SIGKILL |
| J14 status, doctor | `j14-status` | stack |
| J15 security | `j15-security` | stack, reads `.env` only to look for its secret values in responses (never prints them) |

## Not testable without real keys

Real answer quality, citations from real Gemini, vision (Step Diff on real images), cache hits, ElevenLabs voices and spoken oral exams, iMessage delivery, the 402 recovery against a live model. The LIVE variant covers what it can once credits exist.

## Hygiene

No journey prints a key, edits `.env` or touches product code. Scans for secrets compare responses and logs against the values in `.env` and report only the variable name.

## Other journeys in `e2e/specs`

Other workstreams added specs to the same harness (`j06-rooms`, `j08-explainer`, `j10-trip`, `j11-mastery`, `j12-accounts`, `j13-courses`, `j16-inspector`). They run in the same `pnpm e2e` and show up in the report's step table under their own titles.
