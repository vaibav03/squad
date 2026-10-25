# Accessibility findings (trimmed hackathon audit)

Scope: axe-core (WCAG 2.2 A/AA + best-practice) on every route at 1280x800 dark and 390x844 light+Calm (reduced motion), plus keyboard play of the village replay (`/squad/village?replay=track2`). Not covered: forced-colors, 400% reflow, screen-reader runs, audio transcripts, full conformance matrix. Run `pnpm a11y:check`. Ranked by severity; specs marked known-fail live in `apps/web-host/e2e-a11y/specs.ts`.

## High

### A11Y-001 Quiz overlay focus trap leaks (WCAG 2.1.2 / 2.4.3, 4.1.2 modal)
Owner: overlays (`packages/web/src/overlays/kit/hooks.ts`, `useFocusTrap`, lines 96-119).
Open the quiz (`__squadOverlay({type:'openQuiz',...})`): after 2 Tab presses focus is on `body` and then the app nav behind the scrim; Esc no longer closes the quiz because the keydown listener sits on the panel only. Cause: the trap only wraps when focus is on the last element of `focusableIn(root)`, but the radio group has one tab stop and Submit is disabled, so Tab leaves the dialog without hitting `lastEl`.
Patch: also listen on `document` for `focusin`/`keydown` while active: if `!root.contains(e.target)` call `firstEl.focus()`; and attach the Escape handler to `document` (capture) while the trap is active. Specs: `overlay: quiz dialog ... traps Tab`, `overlay: Esc still closes ...` (known-fail A11Y-001).

### A11Y-002 Village stage is `role="img"` but focusable and contains the HUD buttons (axe nested-interactive, serious; WCAG 4.1.2)
Owner: village HUD (`packages/village`, `.sqv-stage`, tabindex=0 role=img wrapping `.sqv-hud`).
Screen readers flatten the children of an img, so chips, camera, Calm and Menu buttons can be unannounced. Patch: give the stage `role="application"` (or `role="group"` with an aria-label) and keep the canvas hidden from AT, or move the HUD outside the img element. Baseline entry: `village-replay-track2|*|nested-interactive`.

## Medium

### A11Y-003 Tab on the stage cycles 9 places before leaving it (WCAG 2.4.3, 2.1.1 usability)
Owner: village input. Focus stays on `.sqv-stage` for 9 Tab presses (no visible change in focus), only then reaches the first HUD chip. Keyboard users cannot tell whether focus moved. Patch: cycle places with a dedicated key (for example `[`/`]` or Tab only while an explicit "places" mode is on) or move DOM focus to the real chip buttons. Spec: `HUD chips reachable within 3 Tab presses` (known-fail).

### A11Y-004 List semantics on non-list roles (axe aria-allowed-role, minor; 1.3.1)
Owners: village HUD (`button.sqv-chip role=listitem`, 9 nodes) and web ledger (`section.lv-col role=listitem`, 4 nodes). Patch: wrap chips in `<li>` inside `<ul>`, or drop role=list/listitem and use a plain group. In baseline.

### A11Y-005 Generic document title on Ledger, Trip, Mastery (WCAG 2.4.2)
Owner: web shell/pages (`useShell().setTitle` not called). Titles are "Squad" instead of "Ledger · Squad" etc. Spec `every app route sets a specific document title` (known-fail).

### A11Y-006 Contrast on Personas radio descriptions (color-contrast, serious; 1.4.3)
Owner: `packages/web/src/pages/personas/personas.css` (`.sq-radio__desc`, dark theme). Raise the muted text token to >= 4.5:1.

## Low

- A11Y-007 `/__labs`, 404 page: no `<main>`/h1 (landmark-one-main, page-has-heading-one, region). Owner: web-host router (`NotFound`, labs index). Wrap in `<main>` with an h1.
- A11Y-008 `/squad/village` live (non-replay) has no h1 (page-has-heading-one). Owner: village page; add a visually hidden h1.
- A11Y-009 Gallery (`/__gallery`, dev only): heading-order, duplicate landmarks, list/listitem structure, 3 contrast nodes. Owner: gallery. Dev-only, lower priority.
- A11Y-010 Skip link is 40 px high at 390 px (phone 44 px guideline, passes 2.5.8 AA 24 px).

## Observed OK
Page `lang`, skip link, focus rings on HUD buttons and nav (2 px), village HUD targets >= 44 px at 390 px, arrow-key walking and the Enter prompt, `?` help dialog with Esc, labelled Calm switch, quiz dialog has role/aria-modal/name, Esc closes quiz when focus is inside it and focus returns to the stage, call captions use `role="log"`.

## Notes
- Calm switch inside the HUD does not set `html[data-calm]` (the host hook does that only from page settings). Parity not verified; worth a check by the village owner.
- `.gitignore` on main contains unresolved merge markers (`<<<<<<< HEAD`). Not owned here.
- Enter on a door in the replay opened no DOM overlay, so room-entry keyboard flow could not be verified from outside the canvas.
