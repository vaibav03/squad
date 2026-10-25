# Developing Squad locally

## Start the stack

```sh
pnpm install --frozen-lockfile
pnpm dev:all            # hub 8788, agents 4101-4104, web 5180 (override with DEV_ALL_HUB_PORT, DEV_ALL_WEB_PORT, DEV_ALL_AGENT_PORT_BASE)
```

## Restart vite after switching branches

Vite resolves the module graph, the pre-bundled dependencies (`node_modules/.vite/deps`) and the `git` sha it shows in
the footer when it **starts**. If you `git checkout`, `git merge` or `pnpm install` underneath a running dev server, the
page can keep serving old modules or fail to load a chunk. That used to look like a blank shell or a spinner that never
ends, and the hub kept answering 200 the whole time.

After switching branches, or after `pnpm install` changes dependencies:

1. Stop the dev stack (Ctrl-C in the `pnpm dev:all` terminal, which stops its whole process group).
2. `pnpm install --frozen-lockfile`.
3. Start it again. Add `--force` to vite (`pnpm --filter @squad/web-host exec vite --force`) if dependencies changed.
4. Restart the **hub** too: its commit sha is read at hub start, and the warning below compares the two.

Never leave a dev server running from a checkout that was switched under it.

## The build marker

Every page shows a small footer, `web <sha> · built <time> · hub <sha> v<version>`, and `/squad/status` repeats it in
the Build panel.

- `web` is `git rev-parse --short=12 HEAD` plus a timestamp, fixed when `vite` starts or `vite build` runs
  (`apps/web-host/vite.config.ts`, `define: __SQUAD_BUILD__`). Set `GIT_SHA` / `BUILD_TIME` when there is no `.git`.
- `hub` comes from the public `GET /v1/status` (`gitSha`, `version`).
- When the two shas differ, a yellow **Stale build** warning appears with a Reload button. It means the web server or
  the hub was started from a different commit than the other: restart the one that is behind.

## If a page is blank anyway

- `index.html` shows "Starting Squad..." until React mounts. After 8 s it adds "Still loading Squad... this connection
  is slow." with Retry (it keeps loading: a slow connection is not a failure). After 45 s with no app it turns into
  "Squad did not start" with Retry, and logs `Squad boot guard` to the console. A failed script or preload reloads once
  on its own first.
- The village shows "Opening the village", then after 8 s "Still loading the village..." with Retry (still loading),
  then after 45 s an error with Retry. The engine chunk is requested in parallel with sign-in on a direct
  `/squad/village` load; the asset manifest gives up after 8 s and every Phaser file after 30 s.
- HTTP 429 is never "offline": reads wait `Retry-After` and retry twice, the shell shows "Too many requests, retrying
  in N s" with Retry now, and the account load shows a rate-limited state with a countdown and Retry.
- Once React is up, a page that renders nothing for 4 s shows "Something went wrong" with Retry, and logs
  `Squad render watchdog` to the console.
- Data reads time out after 8 s (`packages/web/src/lib/http.ts`, `timedFetch`) and show an error state with Retry.

## Measuring the blank rate

`e2e/blank-rate.mjs` loads every route in fresh browser contexts and counts blank or stuck pages:

```sh
HUB=http://localhost:8920 WEB=http://localhost:5320 node e2e/blank-rate.mjs --n 20 --who acct --cond normal --scenario routes
# --who acct|seed|anon  --cond normal|cpu4|slow|down|401|dataslow|data500  --scenario routes|seq
```

Fault conditions without a browser route hack: run `node scripts/dev/fault-proxy.mjs --listen 4815 --target http://localhost:8950`,
build or start the web with `VITE_HUB_URL=http://localhost:4815`, and use `--cond p-slow|p-down|p-flap|p-401|p-hang|p-500|p-429`
(`PROXY=http://localhost:4815`). `PW_MODULE` / `CHROME` point at a scratch Playwright install and a Chrome for Testing binary.

The hub allows 20 sign-ups per hour per IP (in memory): restart the hub to reset it when you run many batches.

## Web origin knobs (OAuth return, invite and iMessage links)

The hub sends the browser back to the web origin that started the flow (Origin header or `return_origin`), never a hard-coded port. Allowed: `HUB_CORS_ORIGINS` entries, `PUBLIC_WEB_URL` / `WEB_URL` / `HUB_WEB_URL`, and localhost / 127.0.0.1 on any port only when not production. Otherwise it falls back to the configured web URL, else a plain "Connected, return to the app" page. `pnpm dev:all` sets `HUB_WEB_URL` to its own `DEV_ALL_WEB_PORT` origin and adds that origin to the CORS list. See `.env.example`. There is no Sendblue code in this repo; the Canvas extension bakes its web origin at build (`SQUAD_WEB_ORIGIN`).
