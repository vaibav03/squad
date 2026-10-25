# Brief: motion (spec 08), branch ws/motion  [UI workstream: top-notch]

**Mission:** the motion system that makes the village feel alive: tokens, primitives and a motion lab, exactly per docs/specs/08-village-motion.md (21-row table, the three curves, never-ship list).

**Do first (15 minutes):** publish docs/motion-api.md (function signatures for: tween helpers using the shared bezier curves, speech/thought bubble, door pulse ring, envelope carry and hand-off, conflict marker, check reveal, camera pan, building enter/leave fade, call speaking state, cutscene sequencer, Calm mode and reduced-motion switch, tab-visibility pause) so the village lead can code against it, and push it.

**Build:** packages/village/src/motion/* (Phaser-side primitives) and the DOM motion tokens/transitions in packages/web, the three curves as bezier functions and CSS variables, every row of the table implemented with its reduced-motion variant, a standalone Motion Lab page (apps/web-host route /__motion) that plays each animation looped at 1x and 0.25x with a reduced-motion toggle and a frame stepper, and unit tests for timing, easing endpoints and reduced-motion branches.

**Quality bar:** a read-only motion reviewer must find none of: transition: all, scale(0) entrances, ease-in, UI durations over 300 ms without reason, layout-property animation, keyframes on rapidly-triggered elements, ungated hover, missing reduced motion, everything entering at once. Capture frame strips (0, 25, 50, 75, 100 percent) of each animation and critique them. Feel-check items you cannot judge from code must be listed for the owner.

**Sub-agent ideas:** tokens and API doc, bubbles and rings, envelopes and markers, camera and transitions, cutscene sequencer, DOM overlay motion, motion lab and reviewer.
