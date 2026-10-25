# Brief: media (spec 05), branch ws/media  [UI-adjacent: the characters must look extraordinary]

**Mission:** personas, voices, podcasts, explainers, and the pixel characters that carry the whole product's personality.

**Build:** persona registry (Cubbie-like mascot, examiner, chapter experts, rival, council members, chairman, Feynman freshman) with spriteSheet and portrait; the sprite pipeline (from assets and docs/design/asset-manifest.md: palette-quantized, consistent outlines, idle and 4-frame walk, a talk frame pair, frames.json atlas, GIFs for iMessage built from frames) and portrait renderer at integer scales; ElevenLabs voice service (voice design per persona, saved voiceIds, cached TTS, rate-limit aware, fallback voice); the browser call path (POST /v1/call/start, ws audio, captions) behind the hub's call port; podcast generator (script with Gemini strong, fact-check pass, multi-voice render, ffmpeg join, anonymized squad cut that respects min group size); explainer generator (code-drawn diagrams from real figures; image model decoration only); audio and GIF delivery helpers for iMessage.

**Quality bar:** a character sheet and a persona wall page whose contact sheets you open and critique until each character is distinct, cohesive and charming at 2x and 3x; audio loudness normalized; every generated artifact deterministic or cached; budget guard for ElevenLabs and Gemini calls; tests with fakes and one flagged real-key smoke.

**Sub-agent ideas:** sprite pipeline and persona wall, voices and TTS cache, browser call path, podcast, explainer, GIF and delivery.
