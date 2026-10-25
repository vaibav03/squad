# @squad/web: web-live slice (ledger, trip, mastery, overlays)

Owned here by `web-live`: `src/pages/{ledger,trip,mastery}`, `src/overlays`. Shell, primitives and tokens belong to `web-shell`.

- **Pages** (default exports, route params via `react-router-dom`): `pages/ledger` (Glass Box, own-withheld bars, Demo projector blur), `pages/trip` (options, private limits, secret vote, confirmations, split, `trip.confirmed` -> `/squad/village?cutscene=trip&task=<id>`), `pages/mastery`.
- **Overlays** (plain props, see `docs/overlays-api.md`): `CallPanel`, `QuizCard`, `ConfirmSheet`, `callReducer`, fixtures.
- **No backend needed**: without a `LiveConfigProvider` (`overlays/kit/live-config.tsx`) every page runs in `mock` mode on its bundled recorded replay (`pages/*/fixtures.ts`). Live mode uses the hub (`/v1/ledger/:id`, `/v1/trips/:id`, `/v1/mastery/:id`, SSE with token and 2 s polling fallback). Integration: map web-shell's `useSquadConfig()` onto `LiveConfig` (`{mode, hubUrl, token, userId}`).
- **Review harness**: `pnpm --filter @squad/web exec vite --config review-live/vite.config.ts` (port 5291) lists every state; `node review-live/shoot.mjs [filter]` writes 390/1280 x dark/light PNGs to `docs/design/shots/web-live/`. Stories are also exported as `stories` from each `gallery.tsx` for the web-shell gallery.
- **Tests**: `pnpm --filter @squad/web test` (reducers, privacy invariants, keyboard, states).
- Styling uses `--lv-*` aliases (`overlays/kit/bridge.css`) of `docs/design/tokens.css`; load the tokens stylesheet once in the host.
- Unverified: the hub endpoints' exact response shapes (`/v1/ledger`, `/v1/trips`, `/v1/mastery`) follow spec 06 and are parsed defensively; the Demo projector toggle is client-side until the hub exposes its session flag.
