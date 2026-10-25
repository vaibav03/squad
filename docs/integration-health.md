# Integration health, account identity and Google setup

One chain, one report: **Google auth -> sync -> context -> chat / plan / trip**, and **Sendblue outbound -> delivery ->
inbound -> same web thread**. Every row comes from a real probe run at request time; nothing is a static badge.

## GET /v1/connections/health

Auth: signed-in user. Viewer-scoped. `Cache-Control: no-store`. No tokens, e-mails, phone numbers or event titles.
The served web origin is taken from the request `Origin` header (else the `Referer` origin).

```jsonc
{
  "generatedAt": 1790000000000,
  "overall": "pass" | "warn" | "fail",      // any fail -> fail; any warn/blocked -> warn
  "servedOrigin": "http://localhost:5290" | null,
  "checks": [{
    "id": "google_connected",
    "group": "canvas" | "google" | "chain" | "sendblue" | "platform",
    "label": "Google connected",
    "status": "pass" | "warn" | "fail" | "blocked",   // blocked = needs env/credentials that are missing, never faked
    "reason": "plain words",
    "fix": { "label": "Reconnect Google", "to": "/squad/connections" }  // or { "api": "env:PUBLIC_WEB_URL" }
    "missingEnv": ["GOOGLE_OAUTH_CLIENT_ID", ...],     // blocked only
    "mode": "real" | "fixture" | "extension" | "feed" | "token" | "extension not detected" | "expired" | "live" | "degraded" | ...,
    "facts": { "items": 12, "lastSyncAt": 1790000000000, "fixture": true },
    "probedAt": 1790000000000
  }]
}
```

| id (order) | probe |
| --- | --- |
| canvas_connected (10) | the viewer's Canvas connections: real session (extension), feed, token, fixture (warn, labelled), expired/revoked (fail, Reconnect), none (warn: `extension not detected` unless a pairing exists) |
| canvas_synced (11) | item count + last sync time from the store |
| google_connected (20) | state, granted scopes vs the 4 required, masked account; `blocked` with the exact env names when only the fixture exists |
| google_synced (21) | items per kind, last sync |
| redirect_origin (22) | the origin the OAuth callback would return to (allowlist) vs the served origin and PUBLIC_WEB_URL; fail when the served origin is not allowed |
| items_visible (40) | imported items readable through the read gate |
| context_retrievable (41) | live `createRetrieveContext` search for an item's own title; needs >= 1 hit with source id + anchor |
| cubbie_reachable (50) | bot engine attached to the hub chat |
| model_provider (51) | `runtime.llm()`: Gemini live / degraded: reason / fixture |
| study_plan_persisted (60) | newest saved `hub_plans` row of the viewer's squad; pass only if it cites an imported item |
| trip_availability (61) | busy blocks derived from the imported calendar; all titles must be the constant `busy` |
| imessage_bridge (70) | `imessageSync.status()`: live / dry run / fixture transport / degraded / not connected: setup |
| sendblue_outbound/delivery/inbound/thread (80-83) | `deps.sendblue.health()` when the Sendblue provider is installed, else `blocked: not installed` |

### Adding checks from another branch (no file conflicts)

```ts
import { registerHealthCheck } from '../health/registry';
registerHealthCheck('sendblue_outbound', 'sendblue', 80, async (ctx) => ({ label, status, reason, fix }));
```

`registerHealthCheck` replaces by id, runs in `order`, may read earlier results from `ctx.prior`, and has a 4 s
timeout (a hung probe becomes a `fail`). Create one file under `apps/hub/src/health/checks/` and call it from
`checks/index.ts`. The Sendblue worker can either register real probes under the four `sendblue_*` ids or set
`deps.sendblue = { health(): { outbound, delivery, inbound, thread } }` with `{status, reason, missingEnv?}` links.

## Connection view (GET /v1/connections, POST responses)

New fields on every connection: `account` (`{label, name?, host?}` or `null` after disconnect), `fixture` (boolean),
`grantedScopes` (short names, e.g. `calendar.readonly`), `importedAt` (first import), plus the existing `lastSyncAt`,
`state`, `needsReconnect`.

- Google live: `account.label` is the masked e-mail (`v*****@gmail.com`); `name` only if Google returned one
  (the `profile` scope is deliberately not requested).
- Canvas extension session: `account = { label: "<name> @ <host>", name, host }` from the extension register payload.
- Canvas token: `Canvas <host> (student token)`.
- Any fixture: `Fixture (simulated, not your account)`.

## GET /v1/connections/items

Signed-in user; own imported items only (never another member's); revoked connections have none.

```jsonc
{ "generatedAt": 1, "total": 2, "items": [{
  "id": "src_...", "connectionId": "conn_...", "provider": "canvas" | "google",
  "kind": "canvas_assignment" | "canvas_file" | "canvas_event" | "gcal_event" | "classroom_item" | "gdrive_file" | "gdoc",
  "title": "Problem set 4", "courseId": "c1" | null,
  "whenAt": 1790000000000 | null, "whenKind": "due" | "starts" | null,
  "fetchedAt": 1790000000000, "modifiedAt": null,
  "provenance": "real" | "fixture", "fixture": true,
  "sharing": "private" | "shared", "sharingLabel": "Private" | "Shared with <squad name>",
  "sharedWith": [{ "id": "sq_demo", "name": "..." }],
  "location": { "anchor": "p1", "label": "section" } | null,
  "url": "https://..." | null
}] }
```

## Google setup (live path)

Flow: authorization-code with `state` (single use, 30 min) and PKCE S256 (verifier derived from the state with a
server key), `access_type=offline`, `prompt=consent select_account`. Scopes: `openid email` (identity) +
`calendar.readonly`, `classroom.courses.readonly`, `classroom.coursework.me.readonly`, `drive.file` (only files the
user picks with the Picker). Refresh tokens are AES-GCM encrypted at rest (`CONTEXT_TOKEN_KEY`) and never returned by
any route. Disconnect calls Google's revoke endpoint and deletes every import. A 401 triggers one refresh; if that
fails the connection becomes `expired` (data kept, Reconnect); `invalid_grant` becomes `revoked` (data purged).
Calendar sync is incremental (`updatedMin`, deleted events included).

Env names (all three are required, otherwise the live path is `blocked` and only the labelled fixture works):

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI` (defaults to `${HUB_BASE_URL}/oauth/google/callback`)
- optional `VITE_GOOGLE_PICKER_API_KEY` (browser key, restricted to the web origin)

**Redirect URIs to register in Google Cloud (Web application client).** The callback route is served by the HUB
(there is no web-dev-server proxy for `/oauth`), so register the hub's callback, not the web port:

- dev: `http://localhost:<HUB_PORT>/oauth/google/callback` (journey stack: `http://localhost:9060/oauth/google/callback`;
  default dev hub `http://localhost:8788/oauth/google/callback`) and set `GOOGLE_OAUTH_REDIRECT_URI` to the same string.
- prod: `https://<hub host>/oauth/google/callback`.
- Authorized JavaScript origins (Picker): the served web origin, e.g. `http://localhost:5290` in dev, `https://<web host>` in prod.

After the callback the hub redirects the browser to the web origin that STARTED the flow (the `Origin` header, else
`return_origin`), validated against `HUB_CORS_ORIGINS`/`PUBLIC_WEB_URL` (loopback ports are accepted outside
production). A hostile origin falls back to `PUBLIC_WEB_URL`. So the app on `:5290` returns to `:5290` while Google
only ever sees the hub callback. If the customer needs the callback itself on the web origin, the web host must
proxy `/oauth/google/callback` to the hub and that URL be registered instead (not done: noted as a gap).
