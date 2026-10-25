# Brief: web (spec 06 UI half), branch ws/web  [UI workstream: top-notch]

**Mission:** @squad/web (React components and routes) and apps/web-host (tiny standalone host) that make the app shell, setup, personas, notice board/ledger, trip planner and the shared overlays feel premium.

**Build:** implement docs/design/tokens.css as the single styling source; primitives (button, chip, card, sheet, toast, tabs, input, avatar, badge) with the five states; AppShell stand-in; pages: setup (one step per screen: phone, course PDFs, calendar .ics, persona), personas studio (avatar + voice picker with audio preview), ledger/notice board (live, own-withheld only, blurred projector toggle), trip planner (options, private limits, secret vote progress, confirmations, split, cutscene trigger on trip.confirmed), mastery summary; overlays shared with the village (call panel with waveform and cited captions, quiz card, confirm sheet) as components that take plain props; empty/loading/error/offline states everywhere; /__gallery route that renders every component and state for review; MSW or a recorded-replay mode so pages work with no backend.

**UI bar:** this is the first thing a judge sees after the village. Typography, spacing rhythm and colour must be deliberate and match DESIGN.md; no default-looking inputs, no generic cards-with-shadows; delight in micro-details (focus rings, press states, count-ups under the motion rules). Do the screenshot-critique loop three times per page and keep shots in docs/design/shots/web/.

**Sub-agent ideas:** primitives, setup flow, personas studio, ledger, trip planner, overlays, gallery + visual regression, accessibility reviewer.
