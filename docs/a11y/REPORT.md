# Accessibility report (trimmed)

Method: Playwright chromium + axe-core 4.x, WCAG 2.2 A/AA and best-practice rules. Variants: 1280x800 dark (reduced motion), 390x844 light with Calm. Routes: /squad, village replay track2 and track3, live village, ledger, trip, setup, personas, mastery, /__gallery, /__labs, /signin, 404.

| Area | Result |
|---|---|
| Axe, app pages (home, trip, setup, mastery) | no violations |
| Axe, village | nested-interactive (serious), aria-allowed-role (minor) |
| Axe, ledger / personas | aria-allowed-role, one contrast failure |
| Axe, labs / 404 / gallery | landmark and heading issues (low, dev pages) |
| Keyboard: walk, Enter prompt, ? help + Esc | pass |
| Keyboard: Tab through HUD | fail (A11Y-003) |
| Overlay focus trap (quiz) | fail (A11Y-001) |
| Targets >= 44 px on phone (HUD) | pass |
| Page titles | fail on 3 routes (A11Y-005) |

Not tested (out of trimmed scope): forced-colors, 400% reflow, zoom, screen reader runs, flash rate, podcast transcripts, setup form error flows. Details and patches: FINDINGS.md. Baseline: scripts/a11y/baseline.json (39 axe entries).

Run: `pnpm a11y:check` (boots the stack on 15911/18911 if not running; `--update-baseline`, `--verbose`, `--no-boot`).
