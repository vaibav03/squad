# Accounts and squads API (apps/hub), v1

Real onboarding for Squad: accounts with a verification code, signed sessions, squads with invite codes and links, member roles, privacy basics. Additive to `docs/hub-api.md`. Schemas live in `@squad/core` (`packages/core/src/accounts.ts`); this file is the behavior contract. Errors are `{ error: { code, message? } }` (codes in `ACCOUNT_ERROR_CODES`).

## 1. Env

| Env | Default | Meaning |
|---|---|---|
| `SESSION_SECRET` | dev: derived from `HUB_AUTH_SECRET`; production: required (hub refuses to boot without 32+ chars) | HMAC key for session tokens and for hashing phones/emails/codes |
| `HUB_DEV_LOGIN` | `1` outside production, `0` in production | enables `POST /v1/auth/dev-login`, `GET /v1/auth/students` and `devCode` in `/v1/auth/start` |
| `HUB_SEED` | `1` dev | seeds the demo cast. The demo squad `sq_demo` is listed as "Demo squad" and any account may be put in it only by dev-login (never through invites) |
| `HUB_SQUAD_MAX` | `12` | max members per squad |
| `HUB_SESSION_DAYS` | `30` | session lifetime |
| `HUB_WEB_URL` | first CORS origin | base for invite links (`<HUB_WEB_URL>/join/ABCD-EFGH`) |
| `CODE_SENDER` | `console` | `console` (logs `code` plus the masked contact, never the full phone/email) or `imessage` (uses the bot transport via `IMESSAGE_SEND_URL`, POST `{ to, text }`) |

## 2. Auth

Name + phone (or email), then a 6 digit code. Existing contact = sign in (the name is ignored and the response does not reveal whether the account existed).

- `POST /v1/auth/start` `{ name?, phone | email }` -> `{ challengeId, channel, to, expiresAt, resendAfter, devCode? }`. Code lives 10 minutes, 5 tries, resend after 30 s, at most 5 starts per contact per hour and 20 per IP per hour (429 `rate_limited`, `retryAfterS` in body). `name` is required when no account exists for the contact (400 `invalid_request`). `devCode` only when `HUB_DEV_LOGIN=1`.
- `POST /v1/auth/resend` `{ challengeId }` -> same shape (new code, old one dies).
- `POST /v1/auth/verify` `{ challengeId, code }` -> `SessionResponse` `{ token, expiresAt, user, squads, activeSquadId, created? }` and `Set-Cookie: squad_session=...; HttpOnly; SameSite=Lax; Path=/` (`Secure` when the hub base url is https). Errors: 400 `code_invalid` (with `triesLeft`), 410 `code_expired`, 429 `too_many_attempts`.
- `POST /v1/auth/logout` -> `{ ok: true }`; revokes the session server side and clears the cookie.
- `POST /v1/auth/refresh` -> `SessionResponse`; rotates the session (new id, new token, new cookie). The old token keeps working for 60 s so parallel requests do not fail. The hub also rotates automatically when a session is over 24 h old and says so with response headers `x-squad-token` and `Set-Cookie`.
- `POST /v1/auth/dev-login` `{ studentId }`: unchanged, 403 `dev_login_disabled` unless `HUB_DEV_LOGIN=1`. `GET /v1/auth/students` is 404 when dev login is off.

Credentials accepted on every authenticated route: `Authorization: Bearer <token>` (tools; stateless dev tokens and session tokens both work) or the `squad_session` cookie (web). Cookie requests with an `Origin` header outside `HUB_CORS_ORIGINS` are 403 (CSRF). CORS now sends `access-control-allow-credentials: true` for listed origins.

Which squad a request acts in: the user's active squad (server side, changed by `POST /v1/squads/:id/activate`), or one request's override `X-Squad-Id: <id>` (403 `forbidden` when not a member). `viewer.squadId` is verified against real membership on every request. SSE `?st=` tokens carry the squad they were minted for.

## 3. Me and privacy

- `GET /v1/me` -> existing `{ student, squadId, projector }` plus `user` (AccountUser), `squads` (SquadSummary[]), `activeSquadId`. Squad-scoped routes (state, stream, ledger, trips, quiz, calls) answer 409 `no_squad` for an account with no squad yet. `squadId` here is `""` for such a user (the web app then shows Welcome -> Create or Join).
- `PATCH /v1/me` `{ name }` -> `{ user }`.
- `GET /v1/me/export` -> `application/json` attachment with only the caller's own data: profile (no hashes), memberships, audit rows about them, calendar busy blocks, their own ledger rows (their own raw withheld values), memory rows scoped to them.
- `DELETE /v1/me` `{ confirm: "delete my account" }` -> `{ ok: true }`. Cascades: sessions, codes, memberships (ownership of a squad with other members passes to the longest member; a squad left empty is disbanded and its events, trips and settings purged), calendar, ledger rows, memory, directory entry. Audit rows keep the squad action but lose the user id. Cookie cleared.

Storage and logs: phone/email are never stored in clear. The hub keeps `HMAC(SESSION_SECRET, normalized contact)` plus `last4` / masked email for display. Logs carry user ids and masked hints only; the console code sender is the one place a code is printed, next to the masked contact.

## 4. Squads

All need auth. `SquadSummary` and `SquadDetail` are in core. Counts are `null` under 3 members (the member list is shown to members as today; only counts and aggregates are suppressed).

- `GET /v1/squads` -> `{ squads: SquadSummary[], activeSquadId }`
- `POST /v1/squads` `{ name, course? }` -> `201 { squad: SquadDetail }`; creator is `owner` and the squad becomes active. A student may be in several squads.
- `GET /v1/squads/:id` -> `{ squad: SquadDetail }` (404 `not_found` for non-members, never 403: existence is not leaked)
- `PATCH /v1/squads/:id` `{ name?, course? }` owner only -> `{ squad }`
- `POST /v1/squads/:id/activate` -> `{ activeSquadId }`
- `POST /v1/squads/:id/leave` -> `{ ok: true }`. The last owner cannot leave while others remain unless ownership is passed: the hub passes it to the longest member automatically; the last member leaving disbands the squad.
- `DELETE /v1/squads/:id/members/:userId` owner only -> `{ ok }` (not yourself, use leave)
- `POST /v1/squads/:id/members/:userId/role` `{ role: 'owner' | 'member' }` owner only (making someone owner demotes nobody; an owner can step down with `member` while another owner exists, else 409 `last_owner`)
- `DELETE /v1/squads/:id` owner only, body `{ confirm: <squad name> }` -> `{ ok }` disbands and purges.

### Invites

- `POST /v1/squads/:id/invites` owner only, `{ maxUses?: number|null, expiresInHours? }` -> `201 { invite: Invite }`. `maxUses: 1` single use, `null`/omitted multi-use. Code `ABCD-EFGH` (alphabet without 0 O 1 I L, 40 bits of CSPRNG, stored as is because members can list active invites; revoke or expiry kills it).
- `GET /v1/squads/:id/invites` any member -> `{ invites: Invite[] }` (active ones first)
- `DELETE /v1/squads/:id/invites/:inviteId` owner only -> revoke, `{ ok }`
- `GET /v1/invites/:code` (no auth; rate limited) -> `InvitePreview`. 404 `invite_invalid` / 410 `invite_expired` / `invite_revoked` / `invite_used_up`.
- `POST /v1/invites/join` `{ code }` (auth) -> `{ squad: SquadDetail, activeSquadId }` and the squad becomes active. 409 `already_member` (body carries the squad id so the UI can switch), 409 `squad_full`, plus the invite errors above. Single use: consumed atomically (two people racing one code: one wins, one gets `invite_used_up`). 10 join attempts per user per hour -> 429.
- Joining and leaving write the audit log (`squad_audit`).

## 5. Data model (hub sqlite, migrations in `acct_migrations`)

`acct_users`, `acct_sessions`, `acct_challenges`, `squads`, `squad_members`, `squad_invites`, `squad_audit`. Every table is created by a numbered migration run at boot (idempotent). The hub directory (`hub_students`, `hub_squads`) is kept in sync so everything that reads `directory.members/isSmall/visibleMemberCount` (privacy filter, snapshot, trips, mastery, stream routing) now sees real membership.

## 6. Per-student keys

Real users get ids `u_<12 hex>`; seeded demo ids (`s_ana` ...) are unchanged. Every store the product reads per student (busy blocks, ledger rows, mastery, courses, personas, agent state) is keyed by that id and routed by the student's active squad; the seed ids need no adapter beyond being ordinary ids. Cross-squad isolation: a stream, snapshot, ledger, chat or trip is only served for `viewer.squadId`, which is resolved from membership.
