# Review rubric (UI workstream leads and reviewers)

Apply this to every screen, overlay and scene before calling it done. A reviewer who has not looked at screenshots at both widths and both themes has not reviewed. Findings go in one list, ordered by severity: **Blocker** (breaks a rule marked B), **Major**, **Minor**. Authoritative sources: `DESIGN.md` (looks), `tokens.css`/`tokens.ts` (values), `docs/specs/08-village-motion.md` (motion). Rules marked **[B]** are blockers.

## How to capture and read screenshots

1. Once: `pnpm dlx playwright install chromium`. Start the app (`pnpm dev`, host at the printed port).
2. `node docs/design/tools/capture.mjs http://localhost:5173/squad/village out/village` (add `--calm` for reduced motion). It saves `village-390-dark.png`, `-390-light`, `-1280-dark`, `-1280-light` at DPR 2 and prints canvas facts (CSS size, backing size, `image-rendering`, horizontal scroll, console errors). Run it for every route you touched, plus each overlay state (open the call, quiz, ledger first via `?replay=...` checkpoints or by driving the page in a copy of the script).
3. **Read each PNG with your eyes** (the Read tool shows images). Do not trust a code review of CSS. For each image say what you saw in one sentence before judging: layout, text, colors, pixels.
4. Zoom check: crop and enlarge a 200x120 region around the canvas edge, a sprite, and a text label (`python3 -c "from PIL import Image; im=Image.open('x.png'); im.crop((x,y,x+200,y+120)).resize((800,480),Image.NEAREST).save('crop.png')"`) and look for blur, uneven pixel sizes, half-pixel shimmer rows, clipped glyphs.
5. Hold two frames: the state before and after an interaction (hover, press, open, close) at 1280 and 390; compare.
6. Compare against `docs/design/references/collage-user-references.png` bottom-left and against `assets/pixel/composed/_preview-street.png`: same palette, same pixel size, same light.
7. Automated aids: `python3 assets/pixel/composed/scripts/check_assets.py` (palette-only PNGs); the capture script's console error line; `pnpm check`.

## A. Layout and phone (390 and 1280)
1. **[B] No horizontal page scroll, no clipped content at 390 and 1280**, safe-area insets respected (HUD under the notch, dock above the home bar). Gutter 16 (390) / 24 (>=768).
2. **[B] Touch targets >= 44 px** on touch layouts, spacing >= 8 px between targets; the village is operable one-handed at 390 (dock and sheets reachable in the lower half).
3. **Hierarchy and rhythm:** one clear primary action per surface; spacing only from the 4 px scale; related things grouped (gap 8), sections separated (gap 16 to 24); no orphan controls; panels never cover the character's feet or the door being approached.
4. **Overlays behave:** call/quiz/ledger are full-screen sheets at 390, docked cards at 1280; focus trapped; Esc closes; the canvas is still visible and not distorted behind the scrim.

## B. Pixel discipline (scene and sprites)
5. **[B] One scale:** every sprite shares the same pixel size (measure a 1-pixel feature on two different assets; they must match). No 2x-coarse Ninja Adventure figures in the scene. Canvas zoom is an integer (2 or 3, or `round(zoom*dpr)` device px per art px).
6. **[B] No blur or shimmer:** canvas CSS `image-rendering: pixelated`; backing store at native size; sprite and camera positions whole art pixels; no rotation or non-integer scale of sprites (except the windmill sail frames); no fractional-zoom crops in the enlarged check (step 4).
7. **[B] Palette check:** only the 28 palette colors in any composed asset (`check_assets.py` passes) and only palette-derived tokens in the chrome. Sample five random on-screen scene pixels; each must be a palette hex.
8. **Light and outline consistency:** moon light upper-left, warm spill beside lit windows, 1 px ink outline on characters and props (none on background layers); lit windows glow warm against cool walls; no unlit building with a glowing window unless the agent is awake.
9. **Cohesion:** put the new asset next to the street preview; it must look drawn by the same hand (same shading steps, same noise level, same saturation). Warm pixels are under about 15% of the frame.

## C. Type and rhythm
10. **[B] Fonts and sizes by role:** pixel font (Jersey 10) only for in-world and HUD labels at integer multiples of its art pixel (18.667, 28, 37.333, 56 px) and never for paragraphs/captions/ledger/quiz/forms; Inter for everything read. Body text >= 16 px in call/quiz/ledger. No faux-bold pixel text, no letter-spacing on pixel text.
11. **Legibility:** contrast >= 4.5:1 for text (3:1 for large and icons) in both themes; text never sits on busy art without an `ink` plate or stroke; at most 60 characters in a canvas bubble; long text truncated with the full text reachable in the DOM list.

## D. Color and states
12. **[B] Color is never the only signal:** every agent state, conflict, success and error also has an icon and a text label. Check by viewing screenshots in grayscale.
13. **[B] Every state is designed:** loading (campfire plus text), empty (locked landmark plus invitation), error (red marker, plain cause, Retry), agent offline (desaturated portrait, "{Name} is offline"), connecting, ended. No raw "undefined", spinner-only, lorem or placeholder text, no dead buttons.
14. **Theme correctness:** pages pass in light and dark; the village page stays night in both; night art never sits on white; focus ring visible in each theme; `destructive` text on dark uses `--destructive-text`.
15. **Privacy in the UI:** no grades, budgets or identities of who is behind; the ledger never renders withheld values (search the DOM for the sentinel); team progress only.

## E. Motion and access
16. **[B] Motion obeys 08:** each animation has a frequency tier and one named purpose; only the three curves; never ease-in; no `transition: all`; no `scale(0)` (enter from 0.95 plus opacity); DOM animates only transform and opacity; UI under 300 ms (panels 200 to 280); hover only in `(hover: hover) and (pointer: fine)`; walking is linear with an 80 ms ease-out stop and whole pixels. Verify by reading the CSS/tween code **and** by recording or stepping frames (capture at 2 to 5x slow motion via DevTools animation speed or Playwright `page.clock`; look for jumps, overshoot beyond the spring, flashes over 3 per second).
17. **[B] Reduced motion and Calm mode:** with `--calm` and with the HUD toggle, parallax and ambient loops stop, walking becomes teleport with 120 ms fade, bubbles fade without movement, the trip cutscene is a static card; the screen is still understandable and not static-dead (fewer and gentler, not zero).
18. **[B] Keyboard and screen reader:** arrows walk, Enter enters/joins, Esc leaves, Tab cycles agents, `?` opens controls; every agent and building is reachable in the accessible list with name, state and action; live region announces events; visible focus on every control; the canvas has `role="img"` and a label.
19. **Words never move:** captions, ledger text, quiz questions and bubbles appear whole and stay >= 1.2 s per 20 characters; quiz feedback is a color change only (150 ms) plus icon and words.
20. **Message and action:** copy is plain and kind, student voice, sentence case, no jargon or system exclamation marks; every action has an obvious label and a visible result; destructive actions (leave call) are labelled, one tap, never ambiguous; errors say what happened and what to do next.

## F. Performance
Page stays 60 fps at 1280 and 30+ at a mid phone; village chunk loads only on its route; no layout properties animated; tab hidden pauses the loop; fonts preloaded (two files) and canvas text waits for `document.fonts`.

## Severity cheat sheet
Blocker: any **[B]** rule fails. Major: ugly or confusing but works (misaligned rhythm, inconsistent copy, one theme weak). Minor: polish (one pixel off, a tooltip typo). The lead merges findings; nothing ships with an open Blocker.
