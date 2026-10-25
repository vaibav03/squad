## Transport probe

Opt-in Gemini Live transport: `packages/brain/src/agents/live-transport.ts` (`createLiveTextTransport`, kinds
`live-text` / `live-audio`, structural socket so tests use a fake; thought parts and signatures are dropped inside the
transport; close reasons map to `reason:<token>` errors that `degradedReason` understands). It is NOT the default
(`stream-text` is). Tests: `live-transport.test.ts` (tool round trip, thought sentinel, 1011/1008 close mapping, abort).

Probe: `LIVE=1 pnpm live:council-probe` (`scripts/live/council-probe.ts`; refuses without `LIVE=1`; `LIVE_PROBE_AUDIO=1`
selects AUDIO + output transcription). One trivial tool (`retrieve_course`), 20 s wall cap, at most 2 connection attempts, key
read only through `loadEnv`, output redacted. Results, 2026-10-25, model `gemini-3.8-live`:

| Run | Config | Outcome | Tokens | Cost |
|---|---|---|---|---|
| TEXT modality | `responseModalities: ['TEXT']` + 1 function declaration | Both attempts closed at setup: **close 1007 "The requested combination of response modalities (TEXT) is not supported by the model"** (~1.3 s total) | 0 / 0 | $0 |
| AUDIO + transcription | `responseModalities: ['AUDIO']`, `outputAudioTranscription`, same tool | Both attempts closed at setup: **close 1011 "Internal error encountered."** (~1.8 s total) | 0 / 0 | $0 |

Conclusions (measured, not assumed):

* (a) TEXT-only output is **not supported** on `gemini-3.8-live`: the server rejects the setup. Live agents must use AUDIO with
  transcription, so a text-only Live council is not possible; `live-audio` is the only Live shape, and stays voice opt-in.
* (b) Tool calling on Live is **unverified**. The AUDIO run failed with a generic 1011 before any turn. Not yet separated:
  the function declaration (`parametersJsonSchema` may not be accepted on Live; try `parameters`), `maxOutputTokens`, or
  a transient server fault. The run did not look like the credits close ("prepayment credits are depleted"). No further runs
  were made (budget rule: stop on failure, no retry loops).
* (c) No turn completed, so no token usage or latency per turn was observed; spend was $0 (nothing billed at setup).
  Transcription-derived text is also not guaranteed to match what was spoken, a further reason the council default stays
  `stream-text` with `submit_turn`.
* Decision: council text agents stay on streaming `generateContent` with function calling. Revisit Live only for the voice
  opt-in, after one more probe with a variant declaration format.
