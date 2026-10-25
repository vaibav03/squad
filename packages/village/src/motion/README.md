# Motion (workstream `motion`, spec 08)

Contract: `docs/motion-api.md`. Authoritative plan: `docs/specs/08-village-motion.md`.

- Canvas primitives: `packages/village/src/motion/*` (Phaser-free, structurally typed; import from `@squad/village/motion`).
- DOM tokens/transitions: `packages/web/src/motion/motion.css` + `index.ts` (`@squad/web/motion`).
- Motion Lab: `apps/web-host/src/lab/motion` at `/__motion` (every row looped at 1x and 0.25x, reduced toggle, frame stepper, 0/25/50/75/100% strip).

Run: `pnpm --filter @squad/village test`, `pnpm --filter @squad/web test`; lab via `pnpm --filter @squad/web-host dev` then open `/__motion`.

Usage in a scene: `const rt = new MotionRuntime(); pauseWhenHidden(rt); scene.update = (_, d) => rt.update(d);` then call primitives (`walkTo(rt, npc, {x, y})`, `showBubble(rt, bubble, { text })`). Calm mode: `getMotionPrefs().setCalm(true)`; every primitive reads the preference at call time.
Everything is deterministic (no wall clock): tests and the Lab use `rt.step(ms)`.

Notes: spring is only for the conflict pop and the trip door. Walking is never eased except the final 80 ms ease-out stop. Text never animates.
