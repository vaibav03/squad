# Audio API (`@squad/media`, workstream media-audio)

Owner: `packages/media/src/{voices,tts,call,podcast,explainer,delivery}/**` plus `factory.ts`. Everything is exported from `@squad/media`. All paid calls go through one `BudgetGuard`; every artifact is cached on disk and named by content hash; every module has a fake for tests.

## Env

| Var | Use |
|---|---|
| `ELEVENLABS_API_KEY` | ElevenLabs (never logged; header only) |
| `GEMINI_API_KEY`, `GEMINI_MODEL_FAST/MAIN` | text (core `Llm` tiers), transcription (fast tier), images |
| `GEMINI_IMAGE_MODEL` | illustration model, default `gemini-nano-banana-2.1` |
| `ELEVENLABS_FALLBACK_VOICE_ID` | stock voice for personas with no saved voice (default Rachel `21m00Tcm4TlvDq8ikWAM`, from memory, unverified) |
| `SQUAD_BUDGET_EL_CHARS_HOUR/_TOTAL` | defaults 30000 / 200000 characters |
| `SQUAD_BUDGET_GEMINI_CALLS_HOUR/_TOTAL` | defaults 300 / 3000 |
| `SQUAD_BUDGET_GEMINI_IMAGES_HOUR/_TOTAL` | defaults 20 / 100 |
| `SQUAD_TTS_CONCURRENCY` | concurrent ElevenLabs requests, default 3 (raise to match the plan) |
| `SQUAD_LIVE=1` | enables `pnpm --filter @squad/media smoke:live` |

## Wiring (hub integration step)

```ts
import { createAudioServices } from '@squad/media';
const audio = createAudioServices();                 // or { engine: new FakeTts() } for demos
const mediaPort = audio.mediaPort(() => personaRegistry.list());      // hub MediaPort
const callPort  = audio.callPort({ answer: brainAnswerFn });          // hub CallPort
```

- `CallPort` / `MediaPort` / `CallSession` / `CallTurn` are declared locally and are structurally identical to `apps/hub/src/ports.ts` (docs/hub-api.md section 11).
- `AnswerFn(req:{agent, student, text, history}) => AsyncIterable|Promise<{text, cite?}[]>` is what brain must supply. Captions equal exactly what it yields; nothing else is added, so withheld values can only leak if brain emits them.
- One `CallTurn` per sentence (caption + cached audio clip, mp3 `audio/mpeg`). TTS or budget failure yields a text-only turn (captions keep working).
- The call path emits no events. The talking animation is driven by the hub's `call.start`, `call.caption` and `call.end` events; audio clips travel on the hub call websocket.

## Services

```ts
tts.speak(personaId, text, { timings?, model?: 'flash'|'v3' }) -> { path, durationMs, mime, timings?, cached, source: 'primary'|'fallback' }
tts.speakVoice(voiceId, text, opts)                          // previews, podcast hosts
tts.streamSpeak(personaId, text | AsyncIterable<string>)     // per-sentence streaming chunks, not cached
tts.dialogue(inputs)                                          // text-to-dialogue, <= 2000 chars
voices.resolve(personaId) -> { voiceId, isFallback, profile }  // saved-voices.json, overrides, stock fallback
voices.designVoice(desc) / saveVoice(generatedVoiceId, name)  // ElevenLabs voice design flow
voices.ensureProfileVoices()                                  // idempotent; scripts/design-voices.ts
makePodcast(deps, {courseId, chapter, audience:'squad'|StudentId, chatId}) -> { message, dm?, path, durationMs, script, dropped, citations }
makeExplainer(deps, {courseId, chapter, question?, chatId}) -> { message, panels, plan }
prepareAudioAttachment / preparePngAttachment / gifFromFrames / toOutbound / assertSendable
```

Cache key for speech = sha256(engine, model, voiceId, text). Persona ids resolve to a voice profile by role (`expert:ch5`, `council:2`, `dean`, `persona-05-rival-ninja` all work).

## Rules enforced and tested

- Squads under 3 (`meetsMinGroupSize`) never get counts or weak-spot aggregates in any LLM prompt or script; squad cuts use anonymized counts only; personal cut uses only that student's own concepts and returns `dm` (send with `ctx.dm`, never to the group).
- Budget is charged before the paid call; exhaustion falls back (TTS fallback engine / text-only call turn / decorative panel) instead of overspending.
- Podcast: script by `main` tier (350-450 words squad, 200-330 personal), fact-check by `fast` tier drops unsupported `fact` turns, chunks <= 1800 chars through text-to-dialogue with per-turn fallback, 2 s jingle, `loudnorm` to -16 LUFS, AAC m4a 96k. Episode file name = hash of script + voices.
- Explainer: diagrams (flow, bars, compare, timeline) are drawn by code from a zod spec (every label from the spec, SVG then PNG at 1080 px); the image model only decorates (prompt always contains "no text, no labels, no letters"); captions are composited by code.

## Run / test

```sh
pnpm --filter @squad/media test            # unit (FakeTts, FakeLlm, real ffmpeg)
pnpm test:smoke media                      # fakes end to end
pnpm --filter @squad/media design-voices   # once, with ELEVENLABS_API_KEY; commit voices/saved-voices.json
SQUAD_LIVE=1 pnpm --filter @squad/media smoke:live   # <= 150 ElevenLabs chars, 3 Gemini calls
```

Requires `ffmpeg` and `ffprobe` on PATH.

## Verified against official docs (fetched Oct 24) vs not verified

Verified from docs: `POST /v1/text-to-speech/{voice_id}` (`xi-api-key`, `output_format` query, default `mp3_44100_128`), `/with-timestamps` (`audio_base64`, `alignment`), `POST /v1/text-to-dialogue` (`inputs[{text,voice_id}]`, max 10 voices, 2,000 chars total, default `eleven_v3`), `POST /v1/text-to-voice/design` (`voice_description`, `text` 100-1000 chars, `auto_generate_text`, previews with `generated_voice_id`, `audio_base_64`), `POST /v1/text-to-voice` (`voice_name`, `voice_description`, `generated_voice_id` -> `voice_id`), model ids `eleven_flash_v2_5` (40k chars), `eleven_v3` (5k), `eleven_multilingual_v2`, `eleven_v4_turbo`; Gemini inline audio (<= 20 MB, listed mime types); image model ids `gemini-nano-banana-2.1`, `gemini-3.1-flash-lite-image`, `gemini-3.1-flash-image`.

NOT verified (no keys were available in this worktree: `.env` symlink target was missing, so `smoke:live` has not run):
1. The `/stream` endpoint path and `mp3_44100_64` format for streaming (from memory); `streamSpeak` is unused by the call path, which streams per sentence.
2. Default stock voice id (Rachel) and that `GET /v1/voices` lists premade voices on the account.
3. Gemini calls use `models.generateContent` (works in installed `@google/genai` 1.52); current docs show the newer Interactions API (`ai.interactions.create`). Image generation with `responseModalities:['IMAGE']` on `gemini-nano-banana-2.1` and the transcription call are untested live. Each is a one-function change (`GeminiTranscriber.transcribe`, `GeminiImageGen.generate`).
4. Concurrency default 3, set by `SQUAD_TTS_CONCURRENCY`.
5. Loudness: tests assert within 3 LU of -16 on synthetic tones; real speech lands closer with single-pass loudnorm but is not measured here.

## Contract requests

1. Hub `CallSession.audio(chunk)` has no end-of-utterance signal and no way to push turns back. Core input path is `user.text` (browser SpeechRecognition). The session exposes `audio()` buffering and `replyToAudio()` (transcribe with Gemini, answer); the hub would need to call `replyToAudio()` on `mute:true` / a new `{type:'audio.end'}` frame and stream the returned turns. Until then mic audio is buffered, never stored, and ignored.
2. `GeminiTranscriber` stays in media by decision (no `transcribe` on core `Llm`).
3. Persona ids come from media-art's registry; voice profiles resolve by role regex in `voices/profiles.ts`. If ids change, only that table needs editing.
