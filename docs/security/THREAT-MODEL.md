# Squad threat model

## Assets
Student calendars (busy blocks), budgets and topic limits (withheld values), mastery rows, quiz keys, chat/DMs, uploaded PDFs, auth secrets, LLM and TTS API keys.

## Actors
Squad peer (honest-but-curious), student in another squad, unauthenticated internet client, malicious uploaded document or chat text (prompt injection), compromised/curious mediator or hub operator (out of scope except as stated below), supply-chain attacker.

## Trust boundaries
1. Browser -> hub: bearer token (12 h) for REST, 5 min stream token for SSE, 5 min call-scoped ticket for the call websocket. No cookies, so no CSRF surface; CORS is an allow-list.
2. Agents/bot -> hub `/internal/events`: shared secret, constant-time compare.
3. Hub -> LLM/TTS providers: documents and questions leave the hub.
4. Student agent <-> student agent: mesh protocol (see trust table in packages/mesh/README.md).

## Claimed
- Per-viewer filtering is default-deny on SSE, snapshot, REST and replay; withheld values reach only their owner.
- Squads under 3 get no counts or averages (server-side: mastery, trip vote progress).
- Mesh: PSI (ristretto255) and additive secret sharing are cryptographic in the semi-honest model; everything else in that README's right-hand column is data minimization.

## Not claimed
- Malicious (non-semi-honest) agents; n-1 colluding parties recover the remaining party's secret-shared input (the group-size rule does not stop collusion, only the 2-party trivial case).
- Anonymity from the hub operator, who holds the database and the LLM prompts.
- Revocation of a stolen bearer token before its 12 h expiry.
- Prompt injection is mitigated structurally (chapter expert has no tools; claims count only if the quote is found verbatim on the cited page), not eliminated: an injected document can still steer wording drawn from itself.

## Controls added (apps/hub/src/middleware, apps/hub/src/security)
Security headers, request ids, body-size cap that also covers chunked uploads, strict JSON content type, per-route rate limits (memory or sqlite store), SSE per-user cap, stream-token-only `?st=`, ledger squad scoping, upload validation by magic number plus file-name sanitising, production config refusal (default/derived secrets, seed, sim, wildcard CORS), PII-free audit log. Regression probes: `pnpm security:scan`, `pnpm --filter @squad/hub test:security`.
