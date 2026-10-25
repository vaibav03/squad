# Squad Canvas bridge extension

Port of the Nook dev extension. It reads the student's own Canvas with their logged-in browser session
(`credentials: "include"`, no OAuth, no developer key, no API token) and pushes courses, assignments and file
metadata to the Squad hub. No credentials are shipped in this package.

## Routes to Canvas (in order)

1. **Squad browser extension (recommended, primary).** Uses your signed-in Canvas session; nothing is stored on
   the Squad side except what you choose to import. Install steps below. The Connections page shows
   "Extension not detected" with a Check again button until it is installed.
2. **Canvas calendar feed (.ics) URL.** Paste it on the Connections page (due dates and events only).
3. **Student API token (optional, advanced).** Collapsed under "Advanced (optional)". Never required; some
   schools do not allow students to create tokens.

## Build and install (unpacked)

1. `pnpm --filter @squad/extension build` (override hosts with `SQUAD_HUB_URL`, `SQUAD_WEB_ORIGIN`; defaults are
   `http://localhost:8930` and `http://localhost:5330`).
2. Chrome: `chrome://extensions`, turn on Developer mode, Load unpacked, choose `apps/extension/dist`. Reload after each rebuild.
3. Pair: in Squad open Settings, Connect Canvas, copy the one-time pairing code, then in the extension options page
   (Details, Extension options) paste it and press Pair. The hub returns a scoped, expiring bearer token stored in
   `chrome.storage.local`.
4. Sign in to your school Canvas in the same browser and open any Canvas page once (the extension sees the origin).
   Schools on their own domain: grant the extra origin when Chrome asks, optionally add it to the allow-list.
5. In Squad, Connect Canvas, Authorize. The extension registers the account and runs the sync; re-authorize to refresh.

## Hub contract

- `POST /v1/connections/extension/token` `{code}` returns `{token, userId, expiresAt}` (code from `POST /v1/connections/extension/pair`).
- `POST /v1/connections/canvas/register` registers the Canvas login (201 `{connection:{id}}`; 409 `canvas_account_already_bound` or `canvas_account_conflict`; 400 `canvas_origin_not_allowed`).
- `POST /v1/connections/:id/canvas-sync` with `{origin, canvas_user_id, courses, assignments, files}` (409 `canvas_session_mismatch`).
- Sync outcome reported to the page: `ok | expired | rate_limited | error`.

## Page bridge

`squad:ping`, `squad:canvas-status`, `squad:canvas-authorize`, `squad:canvas-open-sign-in` via `squad:bridge-request` /
`squad:bridge-response` window messages; the content script marks `data-squad-extension="1"` and announces `squad:extension-ready`.

## Status

- Unpacked install: works (needs the user's browser).
- Chrome Web Store: BLOCKED (needs a developer account, listing review and fee).
- Live check against a real Canvas: BLOCKED (needs a real student session); tests use a synthetic fake Canvas.
