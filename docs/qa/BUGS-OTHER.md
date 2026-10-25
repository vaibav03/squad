# Bugs outside the web paths

- Merge of origin/main: `apps/hub/src/main.ts`, `routes/status.ts`, hub smoke test and `packages/core/src/llm/resilient.ts` kept the chat/web version; main's `/v1/status` extras (`lastProbeAt`, `nextProbeAt`, rate_limited and invalid_key reasons, probe spacing) are NOT carried. Chat lead or integration must reconcile. Only `onRecover` was added to resilient.ts so apps/agent compiles.
- Devil's TA board still paints its fixed sample equation rather than `quiz.question.text` unless rooms-b changed it (packages/village/src/scenes/landmarks/devils-ta is outside my paths).
- Port 4101-4104 agents were held by another worktree, so QA ran with `--no-agents`: trip confirm with live agents was not exercised.
