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

- `index.html` shows "Starting Squad..." until React mounts. If the app bundle never starts it turns into "Squad did
  not start" with Retry after 8 s (after one automatic reload), and logs `Squad boot guard` to the console.
- Once React is up, a page that renders nothing for 4 s shows "Something went wrong" with Retry, and logs
  `Squad render watchdog` to the console.
- Data reads time out after 8 s (`packages/web/src/lib/http.ts`, `timedFetch`) and show an error state with Retry.

## Measuring the blank rate

`e2e/blank-rate.mjs` loads every route in fresh browser contexts and counts blank or stuck pages:

```sh
HUB=http://localhost:8920 WEB=http://localhost:5320 node e2e/blank-rate.mjs --n 20 --who acct --cond normal --scenario routes
# --who acct|seed|anon  --cond normal|cpu4|slow|down|401|dataslow|data500  --scenario routes|seq
```

The hub allows 20 sign-ups per hour per IP (in memory): restart the hub to reset it when you run many batches.
