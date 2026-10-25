# Brief: demo (spec 07), branch ws/demo

**Mission:** make the product demonstrable and the submission airtight: seeded data, replay scripts, one-command demo, READMEs, video script, judge Q&A.

**Build:** a seed pack (3 or 4 students with distinct calendars and budgets, an OpenStax course, personas); the merged replay scripts apps/hub/sim/replays/track2.json and track3.json (beat-for-beat per spec 07, valid against core, ending track2 on trip.confirmed with a checkpoint before the last confirm); pnpm demo:seed, demo:reset, demo:replay; README per track and a root README with architecture, privacy and trust table, run instructions and art credits; a 2-minute video shot list and narration for each track; the judge Q&A sheet; submission checklist and  previews for Tracks 2 and 3 (never --yes; fields per spec 07; the repo must stay private until the owner says to flip it); a pre-flight script that checks env, keys, hub health, replay validity and sentinel leaks.

**Quality bar:** a fresh clone can run the replay demo in under 5 minutes following the README alone (test it in a clean temp directory); replays are validated by core's validator in CI; the scripts read like a story, with each beat tied to a judging criterion.

**Start early:** you depend on others for real behavior but not for scripts: write against the core contract now, and integrate as branches land.
