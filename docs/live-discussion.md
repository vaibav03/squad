# Live agent discussions (Gemini Live)

Agents hold a real-time discussion about the student's topic. The student listens (audio or captions), interrupts by text or push-to-talk, and leaves with takeaways. Wire contract: `packages/core/src/live.ts`. Endpoints and env: `docs/live-discussion-api.md`.

## Verified API facts (Google docs read 2026-10-25)

Read through a page-to-markdown summarizer, so treat exact field names as "docs say" and re-check the first time a real key has credit. Anything marked (probe) was observed on the wire.

| Topic | Fact | Source |
|---|---|---|
| Models | `gemini-3.8-live` (stable, default), `gemini-3.8-live-extended-thinking` (stable), `gemini-3.1-flash-live-preview` (legacy, deprecated in favour of 3.8), `gemini-2.5-flash-native-audio-preview-12-2025` (only for prior 2.5 users). `gemini-3.5-transcribe-live` is speech-to-text only. | https://ai.google.dev/gemini-api/docs/models |
| Transport | Stateful WebSocket. Server-to-server or client-to-server; ephemeral tokens recommended for client-to-server. | https://ai.google.dev/gemini-api/docs/live-api |
| SDK | `@google/genai`: `ai.live.connect({ model, callbacks: { onopen, onmessage, onerror, onclose }, config })`. | https://ai.google.dev/gemini-api/docs/live-api/get-started-sdk |
| Modalities | Native-audio models support only `AUDIO` responses. Text comes from `outputAudioTranscription: {}`. | https://ai.google.dev/gemini-api/docs/live-api/capabilities |
| Audio formats | In: raw 16-bit PCM, 16 kHz, little-endian, mime `audio/pcm;rate=16000`. Out: raw 16-bit PCM, 24 kHz, little-endian. | live-api, get-started-sdk |
| Transcription | `inputAudioTranscription: {}` and `outputAudioTranscription: {}` in config; read `serverContent.inputTranscription.text` / `serverContent.outputTranscription.text`. | capabilities |
| Text input | `session.sendRealtimeInput({ text })` (also `{ audio }`, `{ video }`). | get-started-sdk |
| Turn events | `serverContent.modelTurn.parts[].inlineData.data` (base64 audio), `generationComplete`, `turnComplete`, `interrupted`. | session-management, capabilities |
| VAD | `realtimeInputConfig.automaticActivityDetection`: `disabled`, `startOfSpeechSensitivity`, `endOfSpeechSensitivity`, `prefixPaddingMs`, `silenceDurationMs` (500-800 ms recommended; default about 800). Manual VAD: `disabled: true` plus `sendRealtimeInput({ activityStart: {} })` / `{ activityEnd: {} }`. | capabilities |
| Interruption | On barge-in, generation is cancelled, only already-sent content stays in history, and `serverContent.interrupted` is set; the client must stop playback and clear queued audio. | capabilities |
| System instruction | Per session in setup config (`systemInstruction`); the summary of the SDK page did not show it, the config field is standard `LiveConnectConfig`. One session per persona gives each its own instruction and voice. | SDK type `LiveConnectConfig` |
| Voice | `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName` (any TTS voice, example `Kore`). | capabilities |
| Limits | Without compression: audio-only sessions 15 min, audio+video 2 min. A connection lives about 10 min; server sends `GoAway { timeLeft }` first. `sessionResumption` returns handles (valid 2 h) to continue across connections. `contextWindowCompression: { slidingWindow: {} }` lifts the duration cap. | https://ai.google.dev/gemini-api/docs/live-api/session-management |
| Ephemeral tokens | `client.authTokens.create({ config: { uses, expireTime (default 30 min), newSessionExpireTime (default 1 min), liveConnectConstraints } })`; Live API only, `v1beta` only; browser connects with `apiKey: token.name`. | https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens |
| Pricing | Gemini 3.8 Live: free tier available; paid $0.75/M text in, $3.00/M (or $0.005/min) audio in, $4.50/M text out, $12.00/M (or $0.018/min) audio out. 2.5 native audio: $3.00/M audio in, $12.00/M audio out. Free-tier content may be used to improve Google products. | https://ai.google.dev/gemini-api/docs/pricing |
| Credits depleted (probe) | With the project key, connect succeeds, then the server closes the socket with code 1011 and reason "Your prepayment credits are depleted ..." (no HTTP 402 on the socket, no `onerror`). | one probe call, 2026-10-25 |

## Design decisions

- The key never reaches the browser. The hub opens the Live sessions and proxies audio chunks and captions to the browser over SSE (`GET /v1/live/:id/stream`). Ephemeral tokens are supported by the docs but not used: the hub must relay between agents anyway (each agent hears the others as text), so a browser-direct session per agent would give no benefit.
- One Live session per persona (Tutor, Skeptic, Planner, Examiner, Chair), each with its own system instruction and voice. A turn-taking controller relays each agent's finished output transcript as text input to the next speaker, so exactly one agent holds the floor.
- Because native audio models are audio-only, captions come from `outputAudioTranscription`. Captions-only mode drops the audio chunks server-side (they are never sent).
- Interruptions: the user's text (or push-to-talk, transcribed in the browser by the Web Speech API) is injected into the room as the next input; the current speaker's turn is marked `interrupted` and the browser flushes its audio queue.
- Grounding: sources come from the squad's materials via the existing citation-checked retrieval; only citations whose marker matches a retrieved page that passes the quote check become chips.
- Demo mode: the same `LiveAgentClient` interface has a deterministic `FakeLive` implementation, used automatically when there is no key or Gemini answers 401, 402, 429 (or closes with a credits/auth/quota reason), and when `FORCE_FAKE_LIVE=1`. It is labelled "Demo mode" in the UI.
- Budget guard: max turns, max seconds, max chars per turn, one active run per viewer, hourly start cap, hard stop timer.

## Real-run evidence (2026-10-25, key from .env, credits working)

Three real discussion runs through the hub (3 agents: Chair, Tutor, Skeptic; `LIVE_MAX_TURNS=4`), plus free metadata calls. Takeaways in these runs used the scripted builder (`FORCE_FAKE_LLM=1`); the LLM builder was checked separately on a 5-turn transcript.

| Item | Result |
|---|---|
| Model id | `models.list` on this key includes `gemini-3.8-live`, `gemini-3.8-live-extended-thinking`, `gemini-3.1-flash-live-preview`, `gemini-2.5-flash-native-audio-*`, `gemini-3.5-live-translate-preview`, `gemini-3.5-transcribe-live`. Default `gemini-3.8-live` connects and answers. |
| `sendRealtimeInput({ text })` | Works mid-conversation on all three sessions: each reply is a native-audio turn with `outputTranscription`. |
| Turn-taking relay | Chair, Tutor, Skeptic, Tutor, Chair in order; each finished transcript relayed as text to the next speaker; one floor holder at all times. |
| Transcription | `outputTranscription` deltas stream as captions; first caption 1.0 to 1.3 s after start. |
| Interruption | User text at about 24 s: `interrupted` emitted for the in-flight turn within 40 ms (turn marked "(cut off)"), the user line is relayed, the Chair answered it about 8 s later and the run wrapped up normally. |
| Audio | Audio run: 176 chunks, 2.8 MB, 58.5 s of 24 kHz 16-bit PCM for a 62 s discussion (speech is generated about real time). |
| Browser playback | Playwright with an `AudioContext` hook: 163 buffer sources scheduled, 55.0 s total duration, context state `running`, no page errors. (Can not hear it; counts and durations only.) |
| Per-turn latency | About 10 to 14 s per turn (a 25 to 40 word turn is spoken in real time); 5 turns (4 plus wrap-up) in 46 to 62 s. |
| Cost | Native audio output is billed per audio second ($0.018/min): about $0.02 per 60 s discussion, so a 14-turn run (about 3 min) is about $0.06 plus text. Captions-only still pays for the audio (native-audio models are audio-only); the server just drops the chunks. Three runs cost well under $0.10. |
| Bad key | Close code 1007 "API key not valid" is mapped to `auth` and triggers the Demo fallback (unit-tested; observed with a bogus key). |
| Credits depleted | Close code 1011 "prepayment credits are depleted" (seen earlier today) is mapped to `credits` and triggers the Demo fallback. |
| LLM takeaways | `createLlmTakeaways` on a 5-turn transcript: 3 decisions, a kept Tutor/Skeptic disagreement with why, 1 next step, 2 quiz questions, each linked to a turn, in about 2.0 s. |
| `contextWindowCompression` + `sessionResumption` | Accepted in the setup config (sessions connect and run). |

## Not verified

- GoAway and the 10-minute connection limit (runs here are about 1 minute; the budget did not allow a long session). Session resumption after a GoAway is coded but untested.
- A run grounded on a real course (the dev hub has no course loaded in real mode, so agents said "we have no sources"); grounding and citation chips are verified in demo mode against the fixture course only.
- Hearing the audio (counts and durations only).
