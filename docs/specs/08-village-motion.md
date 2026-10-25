# 08 Village motion plan (replaces the gamification spec)

No XP, levels, champions, streaks, bets or boards. The app feels like a game because the village looks alive and moves well. This doc is the single motion plan for spec 09 (canvas) and the DOM overlays/pages (spec 06). Rules come from Emil Kowalski's animation philosophy via the `animate` skill.

## Principles
- **Gate first.** Every animation has a frequency tier and one named purpose (feedback, spatial consistency, state indication, preventing a jarring change, explanation, delight). No purpose, no animation.
- **Walking is the game, so it is never eased.** Walking is a 100+/day action: constant speed, instant start, 80 ms ease-out stop, whole pixels. Never add acceleration or camera lag to key input.
- **Delight lives only in rare moments:** the trip cutscene and first arrival in the village.
- **Words never move for style.** Captions, ledger text, quiz questions and bubbles appear whole and stay at least 1.2 s per 20 characters. Withheld text is a static black bar, never animated.
- **Nothing here is a score.** Motion shows what is happening (who is talking, who is waiting, what was shared), not points.

## Tokens (one file, both worlds)
`packages/village/src/motion.ts` exports the three curves as bezier functions for Phaser tweens, and `styles` gets the same values as CSS custom properties, so canvas and DOM share them.
```
--ease-out:    cubic-bezier(0.23, 1, 0.32, 1)     entering, exiting
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)    moving on screen
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)     panels sliding from an edge
spring (rare delight only): { duration: 0.5, bounce: 0.2 }
```
No other curves. Never ease-in. Never `transition: all`. Never `scale(0)`: enter from `scale(0.95)` plus opacity 0. DOM animates only `transform` and `opacity` (`clip-path` for the check-mark draw). Canvas uses spritesheet frames plus tweens on transform/alpha.

## Motion table
| # | Animation | Where | Frequency | Purpose | Tool | Curve and time | Reduced motion |
|---|---|---|---|---|---|---|---|
| 1 | Parallax drift (sky, far/mid/near hills, clouds) | canvas | ambient, always | spatial consistency | scene update, layer factors 0.1 to 0.6 | linear, clouds 1 px/s | layers stop |
| 2 | Day/night shift | canvas | occasional | state indication | tint tween | ease-in-out 20 s, only at dusk/dawn | snap with 200 ms fade |
| 3 | Walk cycle | canvas | 100+/day | direct control | 4-frame spritesheet at 8 fps | linear, constant speed, 80 ms ease-out stop | teleport to target with 120 ms fade |
| 4 | Idle breathing | canvas | ambient | state indication | 2 frames at 2 fps | n/a | static frame |
| 5 | Lit window flicker (agent awake) | canvas | ambient | state indication | alpha 0.85 to 1, 4 s loop | ease-in-out | steady lit |
| 6 | Chimney smoke, campfire | canvas | ambient | state indication | Ninja Adventure FX sprites | frame loop | single frame |
| 7 | Envelope carried to commons | canvas | occasional | explanation | tween, door to campfire | walk linear; envelope pops in 180 ms ease-out; hand-off glides 320 ms ease-in-out; 60 ms stagger | envelope fades at destination |
| 8 | Speech bubble | canvas | occasional | feedback | tween scale 0.95 to 1 plus alpha | 160 ms ease-out, origin at speaker; exit 120 ms ease-out | fade only |
| 9 | Conflict "!" marker | canvas | occasional | state indication | emote sprite, one pop | spring 0.35 s bounce 0.2, red tint holds; no shake | no pop, static marker |
| 10 | Waiting-for-yes ring at the door | canvas | occasional | state indication | ring sprite scale 1 to 1.15, alpha 0.6 to 0 | 1.6 s loop ease-out | static ring plus "waiting" label |
| 11 | Yes arrives: ring becomes check, lock opens | canvas | occasional | feedback | check reveal by mask, lock frame swap | 200 ms ease-out | instant swap |
| 12 | Council opinions, then ranking, then verdict | canvas | occasional | explanation | tweens | opinions stagger 80 ms ease-out; bubbles slide to rank slots 320 ms ease-in-out; chairman bubble 240 ms ease-out | bubbles fade in order |
| 13 | Dissent lantern | canvas | rare | state indication | 3-frame flicker, 2 s | ease-in-out | steady red lantern |
| 14 | Camera pan to a building | canvas | occasional | spatial consistency | camera tween | 400 ms ease-in-out, skippable | jump cut |
| 15 | Enter or leave a building | canvas plus DOM | occasional | preventing a jarring change | fade | 200 ms ease-out | 120 ms fade |
| 16 | Overlay panels (call, quiz, ledger) | DOM | occasional | spatial consistency | CSS `@starting-style` transition | 200 to 280 ms ease-drawer, `translateY(8px)` plus opacity; exit mirrors entry | opacity only |
| 17 | Speaking sprite and portrait (call) | canvas plus DOM | occasional | state indication | 2-frame swap at 8 fps, 2 px bob, glow ring opacity follows smoothed amplitude | driven by `call.caption`; glow is opacity only | glow only, no bob |
| 18 | HUD portrait chip state change | DOM | tens/day | feedback | CSS transition on color and opacity | 150 ms ease | same |
| 19 | Button press, camera buttons | DOM | tens/day | feedback | CSS transition | `scale(0.97)` 100 to 160 ms ease-out; hover only in `(hover: hover) and (pointer: fine)` | opacity change only |
| 20 | Trip cutscene | canvas | rare | delight | road layer scroll, vehicle drive, Trip door pop | scroll 2.4 s ease-in-out; vehicle linear; door pop spring 0.5 s bounce 0.2; any key skips | static card, 200 ms fade |
| 21 | Replay/Live badge | DOM | rare | state indication | opacity | 150 ms ease | same |

## Never animated
Keyboard-driven walking acceleration, quiz questions, answers and feedback text (color change only, 150 ms), captions (appear whole per sentence), the ledger/notice-board text, anything repeating faster than once a second except sprite frames.

## Performance and safety
- Whole-pixel sprite positions, `pixelArt: true`, `roundPixels`, one atlas per scene, 60 fps target on a phone.
- Pause the game loop when the tab is hidden; resume without catching up.
- `prefers-reduced-motion`: fewer and gentler, not zero (table above). A "Calm mode" toggle in the village HUD does the same.
- Nothing flashes more than 3 times a second. No autoplay audio. Replay respects the same rules.
- Feel checks (cannot be judged from code): play the council and envelope sequences at 2 to 5x duration, step the trip cutscene frame by frame, test walking and touch on a real phone, and look again the next day.

## Tickets
M-1 `motion.ts` tokens plus CSS variables (feeds everything). M-2 ambient world (rows 1 to 6). M-3 agent movement and bubbles (rows 3, 7, 8). M-4 state markers (rows 9 to 13). M-5 camera and building transitions (rows 14, 15). M-6 overlays and speaking (rows 16, 17). M-7 trip cutscene (row 20). M-8 reduced-motion variants and Calm mode. M-9 frame-by-frame review against the "Never ship" list (no `transition: all`, no `scale(0)`, no ease-in, UI under 300 ms, no layout properties, ungated hover, missing reduced motion, everything entering at once).
