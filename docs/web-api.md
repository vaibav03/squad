# web-shell API (docs/web-api.md)

Owner: workstream `web-shell` (branch `ws/web-shell`). Consumers: `web-live` (pages/ledger, trip, mastery, overlays), `motion` (apps/web-host/src/lab/motion). Code against this; everything here is stable unless a note says "draft".

## Packages and entry points
- `@squad/web` (`packages/web`) exports from `src/index.ts`: `primitives`, `shell`, `routes`, hub client types. SSR-safe: no `window`/`document` at module top level.
- `@squad/web/styles.css` is the single stylesheet (`src/styles/index.css`): fonts (Inter Variable, Jersey 10, Silkscreen from assets/fonts), `docs/design/tokens.css` (imported by relative path, never copied), a small base layer, and every primitive's CSS (imported by its module). Hosts import it once. Component CSS uses only design tokens (`--card`, `--primary`, `--border`, `--space-*`, `--radius-*`, `--ease-*`, `--dur-*`, `--sq-*` palette); never raw hex. Pixel font only for labels per DESIGN.md section 6; UI sans for everything read. Pages that sit over the canvas wrap in `.sq-scene` (always night).
- `apps/web-host` is a Vite + React app: `pnpm --filter @squad/web-host dev` (port 5180), `build`, `preview`.

## Primitives (`import { Button, ... } from '@squad/web'`)
All accept `className` and forward `ref` where it makes sense. Each has the five states: default, hover (only `(hover:hover) and (pointer:fine)`), focus-visible (token ring), pressed/active (`scale(0.97)` 100-160ms ease-out), disabled/loading. Hit area is at least 44px on touch.

| Component | Props |
|---|---|
| `Button` | `variant: 'primary'\|'secondary'\|'ghost'\|'danger'` (default secondary), `size: 'sm'\|'md'\|'lg'`, `loading?`, `iconStart?`, `iconEnd?`, `fullWidth?`, plus native button props; `as="a"` with `href` supported |
| `IconButton` | `label` (required, aria-label), `icon`, `variant`, `size`, `pressed?` |
| `Chip` | `tone: 'neutral'\|'ok'\|'alert'\|'ember'\|'violet'`, `selected?`, `onSelect?`, `onRemove?`, `icon?` |
| `Badge` | `tone`, `count?` (number), `dot?` |
| `StatusDot` | `status: 'live'\|'idle'\|'busy'\|'offline'\|'error'`, `label?` (visible text next to the dot), `pulse?` (gated by motion pref) |
| `Card` | `tone: 'default'\|'raised'\|'inset'\|'glass'`, `interactive?` (renders as button/link semantics), `padding: 'none'\|'sm'\|'md'\|'lg'`, subcomponents `Card.Header`, `Card.Body`, `Card.Footer` |
| `Sheet` | `open`, `onClose`, `title`, `side: 'bottom'\|'right'\|'center'` (center = modal), `description?`, `initialFocusRef?`, `dismissible?` (default true); focus-trapped, Esc closes, returns focus, `@starting-style` drawer motion (200-280ms ease-drawer) |
| `Modal` | alias of `Sheet side="center"` |
| `ToastProvider` + `useToast()` | `toast({ title, body?, tone?, durationMs? (default 4500), action?: {label,onAction} }) => id`, `dismiss(id)`; region is `aria-live=polite`, stacks bottom-center on phone and bottom-right on desktop |
| `Tabs` | `value`, `onValueChange`, `items: {value,label,icon?,badge?,disabled?}[]`, `variant: 'underline'\|'pill'`, `panelId?`; roving tabindex, arrow keys, Home/End; `TabPanel` helper `<TabPanel value active>` |
| `TextField` | `label`, `value`, `onChange(value)`, `hint?`, `error?`, `prefix?`, `suffix?`, `type`, `inputMode`, `multiline?`, `disabled?`, `required?`; native input props pass through |
| `Switch` | `checked`, `onCheckedChange`, `label`, `disabled?` |
| `RadioCards` | `value`, `onValueChange`, `options: {value,label,description?,leading?,trailing?}[]`, `name` (a real radio group, for voice picker and similar) |
| `Avatar` | `src?`, `name`, `size: 'xs'\|'sm'\|'md'\|'lg'\|'xl'` , `state: 'idle'\|'talking'\|'muted'\|'offline'`, `level?` (0..1 amplitude for talking glow), `frame: 'round'\|'portrait'`. Idle = CSS breathing + blink; talking = amplitude glow and transform scale only. Falls back to initials on a palette tile |
| `Notice` | `tone: 'info'\|'ok'\|'warn'\|'error'`, `title`, `children`, `action?`, `onDismiss?`; `role=status` (error uses `alert`) |
| `Spinner` | `size`, `label` (sr-only); reduced motion shows a static dotted ring |
| `Skeleton` | `shape: 'line'\|'block'\|'circle'`, `width?`, `height?`; opacity pulse only |
| `ProgressBar` | `value` (0..1 or `undefined` for indeterminate), `label`, `tone` |
| `EmptyState` | `title`, `body?`, `icon?`, `action?` ; `ErrorState` (`error`, `onRetry`), `OfflineState` (`onRetry`) |
| `Stepper` | `steps: {id,label}[]`, `current: string`, `completed: string[]`, `onStepClick?` |
| `Markdown` | `children: string`, minimal safe renderer (bold, italic, code, links, lists, citations chips `[cite: ch5 p12]`) |
| `VisuallyHidden`, `FocusTrap`, `ClientOnly` | utilities |
| `Icon` | `name` from a built-in set (`check, x, plus, play, pause, volume, mic, mute, phone, calendar, file, lock, eye, eye-off, chevron-right, chevron-left, arrow-right, upload, info, alert, sparkle, trash, link`), `size`; pixel-friendly 2px stroke line icons, currentColor |

Hooks: `useReducedMotion()` (OS pref or Calm mode), `useCalmMode()` returns `[calm, setCalm]` (persisted, sets `data-calm` on `<html>`), `useMediaQuery(q)`, `useId`-based `useFieldIds()`.

Theming: `<html data-theme="dark|light">` (default follows `prefers-color-scheme`; chrome only, the village is always its own palette). `data-calm="true"` softens all motion. Tokens are CSS custom properties from tokens.css; do not duplicate values.

## Shell
```ts
import { AppShell, useShell } from '@squad/web';
<AppShell
  nav={navItems}                 // NavItem[] (see routes below); defaults to squadNav
  user={{ id, name, avatarUrl? }}
  status={{ connection: 'live'|'replay'|'offline', label? }}
  onSignOut={() => void}
  fullBleed?                     // for /squad/village: no container, header collapses to a slim bar
>{children}</AppShell>
```
`useShell()` returns `{ setTitle(string), setActions(ReactNode), setFullBleed(boolean) }` so pages can set the header title and right-side actions. A different host (Nook) can render its own shell and just mount `squadRoutes`. Layout: header (brand wordmark "Squad" in the display face, nav, status chip, avatar menu); phone (390px) uses a bottom tab bar with the 4 primary routes plus a sheet for the rest, desktop (>=1024px) uses a top nav. Content container `max-width: var(--sq-container)`.

Page building blocks: `Page` (`title`, `eyebrow?`, `actions?`, `width: 'narrow'|'default'|'wide'`, children) and `PageSection` (`title`, `description?`). Use them in every page for consistent rhythm.

## Route registry
`@squad/web` exports (from `src/shell/routes.ts`):
```ts
export interface SquadRouteMeta {
  key: string;            // page folder name under packages/web/src/pages/<key>/
  path: string;           // react-router path, includes the /squad prefix
  title: string;
  nav?: { label: string; icon: IconName; order: number; primary?: boolean };
  fullBleed?: boolean;
  public?: boolean;       // reachable before sign-in (none today)
}
export const squadRouteMeta: SquadRouteMeta[];   // static metadata, the table below
export const squadRoutes: RouteObject[];         // react-router objects, lazily loaded
export const squadNav: NavItem[];
```
| key | path | owner |
|---|---|---|
| `home` | `/squad` | web-shell |
| `village` | `/squad/village` | web-live (host page) |
| `setup` | `/squad/setup/:step?` | web-shell |
| `personas` | `/squad/personas` | web-shell |
| `ledger` | `/squad/ledger/:taskId?` | web-live |
| `trip` | `/squad/trips/:tripId` | web-live |
| `mastery` | `/squad/mastery/:courseId?` | web-live |

**How a page registers:** create `packages/web/src/pages/<key>/index.tsx` with a **default export** React component (no props; read route params with `useParams`). The registry discovers it with `import.meta.glob('../pages/*/index.tsx')` (lazy, one chunk per page). If the file does not exist yet, the route renders a designed `EmptyState` ("Coming soon"), so nobody blocks anybody. Pages wrap their content in `Page`; the host's `AppShell` wraps the router outlet. Data: pages read hub config from `useSquadConfig()` (`{ hubUrl, token, userId, mode: 'live'|'replay'|'mock' }`), supplied by `<SquadProvider>` in the host. `mode: 'mock'` is the default when `VITE_HUB_URL` is unset: pages must render from local fixtures (use `src/fixtures/` of your own page dir; do not call fetch in mock mode).

## web-host
- `apps/web-host/src/main.tsx` creates the router: `/` redirects to `/squad`; `/signin` is the sign-in stub; `/__gallery` is the component gallery; `/__lab/*` and `/__<name>` are lab pages; all `/squad/*` routes mount behind an auth guard inside `AppShell`.
- Sign-in stub: pick one of 4 seeded students (Ana, Ben, Chi, Dev); stores `{ userId, name, token }` in localStorage key `squad.session`; `useAuth()` from `@squad/web` reads it.
- Env: `VITE_HUB_URL` (hub base), unset means mock mode.

### Lab pages (reserved `lab/` area, used by the motion lead)
Owned by web-shell: `apps/web-host/src/lab/index.ts`. Do not edit it. To add a lab page, add exactly two files in your own folder `apps/web-host/src/lab/<name>/`:
1. `meta.ts`: `export const meta = { path: '__motion', title: 'Motion Lab', description: 'Every animation, looped, 0.25x, frame stepper' } satisfies LabMeta;` (`LabMeta` is `{ path: string; title: string; description?: string }` exported from `@squad/web`). `path` has no leading slash and should start with `__`.
2. `index.tsx`: default export of the lab React component (rendered full-viewport, outside AppShell, with tokens.css and `squad.css` already loaded).
The registry (`import.meta.glob('./*/meta.ts', { eager: true })` plus a lazy `./*/index.tsx`) mounts it at `/<meta.path>` and lists it on the `/__labs` index page. No registration line is needed in any shared file.

## Gallery
`/__gallery` renders every primitive and shell piece in every state (default, hover forced via `data-force-state`, focus, pressed, disabled, loading, error, empty), light and dark and Calm toggles, plus a phone-width frame toggle. web-live: add your overlay stories by exporting `stories` from `packages/web/src/overlays/gallery.tsx` (`export const stories: GalleryStory[]`, where `GalleryStory = { id, title, render: () => ReactNode }`); the gallery picks it up with `import.meta.glob('../{overlays,pages/*}/gallery.tsx')`. Optional but encouraged.

## Personas and setup (for reference)
`/squad/personas` and `/squad/setup/:step?` use `Persona` from `@squad/core` and the hub endpoints in spec 06 (`GET/PUT /v1/personas`, `GET /v1/voices`, `POST /v1/voices/preview`). In mock mode they use bundled stubs (static mp3 stand-ins generated with WebAudio until media lands).

## World host page and live wiring (wire-web)
- **Live mode.** `SquadProvider` turns on live mode when a hub URL and a real hub token exist. The sign-in stub calls `POST /v1/auth/dev-login {studentId}` (`devLogin()` in `@squad/web`, ids are `s_<name>`), stores the bearer token with `live: true`, and every page reads it through `useSquadConfig()`; `liveConfigFrom()` adapts that to web-live's `LiveConfig`. A demo sign-in (no hub) keeps `live` false, so pages stay on bundled fixtures and no request carries a fake token (that was the Personas 401).
- **Host page** `/squad/village` (`packages/web/src/pages/village`) is world-agnostic. It picks an event source (live hub stream, or `?replay=<name>`), mounts the world named by the `world` prop or `?world=` (default `village`) from the registry in `worlds.ts`, and renders the DOM overlays the world asks for. A world is `(o: {parent, source, me, calm, onOverlay}) => {destroy, overlayClosed, ready, setCalm?}`. Register another one with `registerWorld('interior', async () => (await import('@squad/interior')).mountInterior)`; nothing else changes.
- **Overlay bridge contract.** The host listens to `OverlayEvent`: `openCall`, `openQuiz`, `openConfirm` mount `CallPanel`, `QuizCard`, `ConfirmSheet` (`OverlayHost.tsx`); `closeOverlay` closes; every close calls `overlayClosed()` on the world handle. An `openCall` for the agent whose panel is already open is ignored (starting a call makes the hub emit `call.start`, which the world re-requests).
- **Live endpoints used.** Call: `POST /v1/call/start {agentId}`, then the call websocket (path from `wsUrl`, joined on the hub origin the page already reaches) with `{type:'end'}`, `{type:'audio.end'}` after the last mic chunk when muting, binary mic chunks; server frames `ready`, `caption`, `audio` (and `audio.meta` plus binary), `ended`, `error`. Quiz: `GET /v1/quiz/:id`, `POST /v1/quiz/:id/answer {choice|text}` (409 reads as recorded). Confirm: `POST /v1/trips/:tripId/confirm {optionId, yes}` (the hub has no generic confirm endpoint yet; other task kinds fail closed with the sheet's error state). Replay mode uses a scripted stub call and local stub quiz/confirm.
- **Trip cutscene.** `?cutscene=trip&task=<id>`: `tripCutsceneFromQuery` and `withTripCutscene` from `@squad/village/sources` wrap the source once at mount; the cutscene module (village-scenes) owns the once-per-task guard and skip keys. The module is not in this tree yet, so nothing plays until it lands.
- **Hub shape adapters.** Trip (`tripFromHub`), mastery (`masteryFromHub`), ledger (`LedgerResponseSchema`, owner raw `withheld` is reduced to the fact it exists) and voices (`{ voices }`) map the documented hub bodies to the page models. Defaults: `/squad/trips` opens `trip_cabo`, `/squad/mastery` opens `cse310` (the demo hub's seeds).
- **Portraits.** Personas, the setup persona step, the call panel and `Avatar pixel` use the 32x32 cast from `assets/pixel/composed/characters` through `pixelPortrait(id)` (aliases cover hub agent ids and legacy avatar ids) at integer scale only.
- Dev/test hook: in `vite dev` the host exposes `window.__squadOverlay(event)` to raise an overlay without a world (used by `apps/web-host/scripts/wire-web-overlays.mjs`).

## Stability notes
- Names and props above are the contract. Additive changes only after this commit; breaking changes will be announced via SendMessage to main.
- Tokens are the real docs/design/tokens.css (shadcn-style names). Icons are Lucide (`lucide-react`), wrapped by `Icon` so names stay stable. Specs for each component follow DESIGN.md section 8 (8.12 toasts, 8.13 buttons and inputs, 8.14 empty/loading/error/offline).
