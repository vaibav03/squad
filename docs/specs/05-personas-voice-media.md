# 05 · Personas, voices and media (draft for approval)

Package: `app/packages/media`. Serves 03 (experts), 04 (student agents), 06 (web picker), 07 (demo) and 09 (village).
Conforms to the `Persona`, `Student`, `OutboundMessage` and `VillageEvent` contracts in `00-OVERVIEW.md`. `Persona.spriteSheet` and `portrait` are extensions listed in 00; nothing else here changes the contracts.
Time is not a constraint: nothing is cut for schedule. "Core" tickets are built first, "Later" tickets after, and all of them get built. Estimates only order the work.

## Summary
Every voice in the system sounds different and has a face. Each persona has four assets: a **pixel sprite** (village), a **portrait** (web chrome), a **voice**, and optionally an **iMessage GIF** made from sprite frames.
Personas: Cubbie (bear), examiner, chapter experts, rival, council members, chairman, Feynman freshman, plus the student picks.
Cubbie also sends two kinds of media into iMessage:
- **Recap Radio:** a 2-3 minute two-host podcast episode (an audio file).
- **Picture It:** an illustrated explainer (images). Diagrams are drawn by code, so labels are always correct.
Students can also walk up to an agent in the village and talk to it by voice in the browser (see "In the village").

**Demo moments (for 07)**
1. `@cubbie podcast ch5` in the group. About 40 s later an audio file arrives, hosted by Cubbie and the rival, covering the squad's two shared weak spots (anonymized) with a running chat joke as the example.
2. `@cubbie explain ch5 visually` returns a matplotlib/Mermaid diagram with slide citations plus one illustration.
3. In the village, a student walks up to the chapter expert, presses Talk, and hears it answer. Captions with citations scroll and the sprite animates while it speaks.
4. On the web (06), you pick a portrait and type "calm British professor", hear three voice previews, and pick one.
5. A DM: "your personal cut" is a shorter episode that spends more time on your own weak concepts.

## Scope
| Core (built first) | Later (built after, normal tickets) |
|---|---|
| Persona registry, each persona with a saved ElevenLabs `voiceId` | Custom designed voice for every persona and every student (`@cubbie voice`) |
| TTS service with a disk cache keyed by hash(voiceId+text) | Clone your own voice (only the user's own, see Risks) |
| Squad podcast plus a personal cut, as m4a in iMessage | Quiz breaks inside episodes; "Last Mile" episodes sized to your walk |
| Explainer: code-drawn diagram + illustration, with citations | Viseme-accurate lip sync from character timestamps (portraits) |
| Sprite sheets (walk, idle, talk) per persona from CC0 packs (after V0's asset audit); portraits chosen from the Fluent set | Talking-head video (Hedra/D-ID) for hero clips |
| Browser voice call from the village (TTS streaming, captions, speaking events) | Realtime voice call (speech in, speech out) and live phone calls |
| iMessage GIF per persona, built from sprite frames | Group vote on a persona's voice |

## Key design
**Personas.** `personas.json`, seeded and then stored in SQLite (02's db): id, name, role, systemPrompt, voice description, voiceId, `spriteSheet` (path and frame map), `portrait`, emoji (`spriteSheet` and `portrait` are the extensions 00 lists on `Persona`). Chapter experts come from one template ("Ch5 expert") so 03 can add them on the fly, rotating through pre-designed expert voices. Later ticket M11 gives each its own designed voice.

**Voices (ElevenLabs; the LLM provider is Gemini, but voices stay ElevenLabs).** Env: `ELEVENLABS_API_KEY` in `.env` (gitignored), plus `GEMINI_API_KEY` for the text, vision and transcription steps below. Gemini also ships TTS models (`gemini-3.8-flash-tts`), but they are not used.
- Design flow: `POST /v1/text-to-voice/design` with a description returns 3 previews, each with a `generated_voice_id`. Saving a preview with `POST /v1/text-to-voice` gives a permanent `voiceId`. [1]
- Persona voices are designed by a script and saved in the registry. Per-student picks live in `Student.voiceId`.
- Fallback: OpenAI `gpt-4o-mini-tts`, which takes style instructions [4]. Each persona gets a mapped built-in voice plus a one-line style, so calls still work if ElevenLabs fails or is rate limited.

**TTS service.**
- `speak(personaId, text)` returns `{ path, durationMs }`, cached on disk so a replay makes no API call.
- `speakWithTimings` uses `/v1/text-to-speech/{id}/with-timestamps` [2] (start and end per character) for captions and visemes.
- `streamSpeak(personaId, text)` uses the streaming endpoint (`/v1/text-to-speech/{id}/stream`, or the websocket input stream for token-by-token text [11]) and yields audio chunks for the browser call.
- Model: `eleven_flash` for short replies and calls; `eleven_v3` for podcasts, because it reads tags like [laughs].

**Podcast pipeline.**
1. 03 provides chapter material and citations. 03/04 provide the squad's shared weak spots as anonymized counts only; for squads under 3 the counts are dropped and the episode covers the chapter only (minimum group size rule, defined in 00). 02 provides 3-5 opt-in inside-joke snippets with names removed.
2. The `strong` role (02) writes, through `Llm.json`, a JSON script of `{speaker, text}` turns, 350-450 words. Hosts: Cubbie (host) and the Rival (a skeptic who asks naive "why"s).
3. A council-lite check (`fast` role, `Llm.json`) compares every factual line with the citations and drops what it can't support.
4. ElevenLabs Text to Dialogue (`POST /v1/text-to-dialogue`, up to 10 voices, about 2,000 characters per request [3]) renders chunks of 1,800 characters or less. Fallback: one TTS call per turn.
5. ffmpeg joins the chunks, adds a 2 s jingle, normalizes loudness (`loudnorm`) and encodes AAC m4a (`-c:a aac -b:a 96k`).
6. Send through `ctx.send({ attachments:[{path, mime:'audio/mp4'}] })` with a 2-line summary and the citations. The personal cut uses the same pipeline with the student's own weak spots, by DM only.

**Explainer pipeline.**
1. The `strong` role plans 1-3 panels (`Llm.json`): `{kind:'diagram'|'illustration', spec}`.
2. **Diagrams** are drawn by code: Mermaid (`mmdc` to PNG) or a matplotlib script in a subprocess with a timeout. These carry every label, number and formula.
3. **Illustrations** come from a Gemini image model (the models page lists Nano Banana 2 `gemini-3.1-flash-image`, Nano Banana 2 Lite `gemini-3.1-flash-lite-image`, Nano Banana 2.1 `gemini-nano-banana-2.1`; `gemini-2.5-flash-image` is limited-access now; pick one in M6, same `GEMINI_API_KEY`) [5] or gpt-image-1 [6]. The prompt always says "no text, no labels". Captions are overlaid by code (sharp/ImageMagick).
4. Panels are sent as PNG attachments, with citations in the text.

**Characters: sprites, portraits, GIFs.**
- **Sprites (village).** Walk and idle sheets from the CC0 packs in `/Users/vaibav/Desktop/squad-assets/pixel/`. The folder holds `_packs`, `_licenses`, `backgrounds`, `buildings`, `characters`, `fx`, `interiors`, `items`, `monsters`, `ui` (ninja-adventure, Kenney, OpenGameArt and Autumn Town packs; character sets include `ninja-adventure-npcs-16px`, `autumn-town-npcs-32px`, `kenney-roguelike-characters`). V0's asset audit (09) confirms what is usable and under which license; M4 starts after it. `scripts/build-sprites.ts` maps each persona to a pack character and writes `assets/sprites/<id>/{walk,idle}.png` plus `frames.json` (frame size, counts, fps). Packs have no mouth frames, so "talking" is made in code (see "In the village"). Where no pack character fits a persona, recolor a base sprite with a palette swap and add a hat or prop. License text comes from `pixel/_licenses` and the pack folders; record each used pack in `assets/LICENSES.md`.
- **Portraits (web chrome).** The Fluent Emoji 3D set at `/Users/vaibav/Desktop/squad-assets/characters/` (`personas/` and `avatars/` only; 256 px, no mouth frames) is for UI portraits only (not world sprites): picker, ledger rows, call panel header. Portraits are chosen from this set, never generated; students pick from the avatars offered. They keep the CSS treatment: idle bob and blink, and a speaking glow plus scale pulse driven by a WebAudio `AnalyserNode` (RMS). There is no CSS mouth flap on 3D stickers.
- **iMessage GIF.** ffmpeg (or sharp) loops 4-8 sprite frames, upscaled with nearest-neighbor (4x to 6x), into a small looping GIF per persona. It is sent the first time a persona joins a chat, as its entrance. Optionally add a talk variant (bob plus a speech-bubble overlay). Any user-facing video goes out as an H.264 mp4.
- **Talking-head video** (Later): Hedra Character-3 or D-ID [7][8] for hero clips made from the portraits. Too slow to call live in a chat, so they are pre-rendered per persona.

## In the village
A student walks next to an agent sprite and a "Talk" prompt appears. Pressing it opens the call panel (a normal DOM panel over the canvas, per 00) and the browser joins a voice call. The iMessage audio path (podcast, voice replies as m4a) stays as is; both paths share `speak`, the persona voice and the same citations.

**Browser call path.**
1. Client posts `POST /v1/call/start {agent, student}` to the hub. The hub creates a `callId`, sets the agent to `in_call`, and emits `call.start` (with `student`; `in_call` is for voice calls only). Audio streams over the hub websocket `/v1/call/ws/:callId`. `call.caption` is emitted by 03's caption pipeline via the hub.
2. Student speaks or types. Core path is typed text or push-to-talk captured by the browser `SpeechRecognition`, or recorded audio sent to `Llm.transcribe` (Gemini audio understanding, or `gemini-3.5-transcribe`; see 02), sent on as text. Voice output stays ElevenLabs. The agent's answer comes from the same brain as iMessage (03), so the same citations apply.
3. The server streams the reply: text tokens go to ElevenLabs TTS streaming [11], and audio chunks go to the browser over a websocket. The browser plays them with WebAudio (`AudioContext`, decode and queue chunks, no gaps) and keeps an `AnalyserNode` for the loudness meter.
4. For each sentence the server emits `call.caption { agent, callId, text, cite? }` with the `Citation` from 03. The panel shows live captions with a citation chip per sentence. `call.end` closes it.
5. Later: realtime voice (ElevenLabs Conversational AI agent, or STT streaming into the same brain with barge-in, where the student's speech stops the agent's audio). Later: live phone calls to a student's number with the same persona voice, opt-in only.

**Speaking state drives the sprite.** The village listens to `call.caption` (text and timing from `speakWithTimings`) and the audio element's play state. While an agent is speaking:
- swap between two "talk" frames at about 8 fps (the idle sheet's two most different frames, or a hand-made 2-frame mouth or hands-up variant);
- add a 2 px vertical bob and a soft glow ring around the sprite;
- show a small speech-bubble icon that fades out 300 ms after the last caption.
Timings, curves and reduced-motion variants for this come from `08-village-motion.md` (row 17: speaking sprite and portrait, driven by `call.caption`; glow is opacity only; reduced motion keeps the glow and drops the bob). Where the numbers differ, 08 wins.
The sprite returns to idle on `call.end` or 1 s after the audio ends. Council members and the chairman use the same animation when `council.opinion` or `council.verdict` events carry text (spoken only if the student opted in to audio).

**Rules.** Withheld values never appear in captions (they follow the event contract). Mic access is requested only when the student presses Talk. Calls log to the same ledger/disclosure view as iMessage answers.

## Interfaces (sketch)
```ts
// packages/media
listPersonas(): Persona[]; getPersona(id): Persona; upsertPersona(p: Persona): void
designVoice(description: string): Promise<{ previews: { generatedVoiceId: string; audioPath: string }[] }>
saveVoice(generatedVoiceId: string, name: string): Promise<string /*voiceId*/>
speak(personaId: string, text: string, opts?: { timings?: boolean }): Promise<{ path: string; durationMs: number; timings?: CharTiming[] }>
streamSpeak(personaId: string, text: AsyncIterable<string> | string): AsyncIterable<{ audio: Uint8Array; timings?: CharTiming[] }>
startCall(req: { agent: AgentId; student: StudentId }): Promise<{ callId: string; ws: string }>
makePodcast(req: { courseId: string; chapter: string; audience: 'squad'|StudentId; chatId: ChatId }): Promise<OutboundMessage>
makeExplainer(req: { courseId: string; chapter: string; question?: string; chatId: ChatId }): Promise<OutboundMessage>
// Skills registered with 02's router: podcastSkill, explainerSkill, voiceSkill
```
File layout: `packages/media/src/{personas,voices,tts,stream,call,podcast,explainer,sprites,gifs,ffmpeg}.ts`, `assets/sprites/<id>/{walk,idle}.png + frames.json`, `assets/portraits/`, `assets/gifs/<id>.gif`, `scripts/{design-voices,build-sprites}.ts`, `cache/`. The village (09) reads `frames.json` and listens to `call.*` events; the web call panel lives in `apps/web`.

## Build tickets (ordered; all get built)
| # | Ticket | Order | Depends on |
|---|---|---|---|
| M1 | Package scaffold, persona registry + seed json, SQLite table | core | 02 core types |
| M2 | Voice design script; design and save persona voices; OpenAI fallback mapping | core | M1, API key |
| M3 | TTS service: cache, timestamps, fallback | core | M1 |
| M4 | Sprite builder: map personas to CC0 pack characters found by V0's audit, write sheets and `frames.json`; choose portraits from the Fluent set (no generation) | core | V0 asset audit (09) |
| M5 | Podcast: script prompt (`Llm.json`, `strong`), fact check (`fast`), dialogue render, ffmpeg m4a, squad + personal cuts | core | M3, 03 retrieval, 02 send, `Llm` |
| M6 | Explainer: panel planner, Mermaid/matplotlib runner, illustration + caption overlay | core | 03 retrieval |
| M7 | Browser call: `streamSpeak`, `POST /v1/call/start` and ws `/v1/call/ws/:callId` on the hub, WebAudio player, captions with citations, `call.*` events | core | M3, 06 hub, 09 V0 canvas mount |
| M8 | Village talking animation (frame swap, bob, glow) wired to `call.caption`; CSS portrait speaking glow for UI chrome | core | M4, M7 |
| M9 | iMessage GIFs from sprite frames; skills wired into the router; audio/GIF smoke test on a real phone | core | M4, M5, M6, 02 |
| M10 | Voice picker API and portrait picker (with 06) | core | M3, M4 |
| M11 | Custom designed voice for every persona and every student (`@cubbie voice`) | Later | M2, M10 |
| M12 | Realtime voice call with barge-in (agent talks to the student live) | Later | M7 |
| M13 | Live phone calls: persona calls an opted-in student's number | Later | M12 |
| M14 | Talking-head video clips per persona (Hedra/D-ID), shown in the call panel and sent as mp4 | Later | M4, M3 |
| M15 | Viseme lip sync on portraits from character timestamps; voice cloning (own voice, consent-gated) | Later | M3, M14 |

Ordering: M1-M4 and M6 start in parallel; M5, M7 and M10 start once M3 is done; M8 after M4 and M7; Later tickets start after the core ones pass their smoke tests.

## Smoke tests
- `speak('cubbie','hello')` twice: the second call is a cache hit (no API call), and the file plays.
- With ElevenLabs disabled, `speak` and `streamSpeak` still return audio (fallback).
- `build-sprites` produces a sheet and valid `frames.json` for every persona; a village scene loads each sprite and plays walk and idle without console errors.
- Browser call: start a call on a fixture agent; `call.start`, one `call.caption` per sentence with a citation, and `call.end` arrive in order; audio plays with no gaps; the talking animation runs only between the first audio chunk and about 1 s after the last; the sprite is idle again after `call.end`.
- A caption never contains a withheld value, and the same question answered in iMessage and in a call cites the same source.
- `makePodcast` on a fixture chapter gives an m4a of 90-200 s that plays in iMessage on an iPhone in the real group.
- Podcast script and explainer plan tests use `FakeLlm` (02); one run each against the real Gemini key.
- `makeExplainer`: the diagram PNG contains every expected label, and the illustration prompt includes "no text".
- The sprite GIF animates in an iMessage thread; the UI portrait glows only while audio plays.
- Later: realtime call interrupts when the student speaks; a phone call is placed only to an opted-in number; clip mp4 plays in iMessage.

## Risks
- **Voice cloning consent:** clone only the user's own voice, recorded live, with an explicit yes stored. Never a professor's, a friend's or a celebrity's voice.
- **Gemini quota and cost for text steps:** podcast scripts and explainer plans use the `strong` role, one call each, cached on disk by content hash so a replay makes no LLM call; fact-check uses `fast`. Free-tier limits are small (see 02 risks), so the project must be billed.
- **Credit and rate limits:** caching, a per-hour character budget, and automatic switch to OpenAI TTS (this is a safeguard, not a schedule cut).
- **Text to Dialogue limits** (about 2k characters, 10 voices): chunking, plus a per-turn TTS fallback.
- **Image models invent labels:** illustrations never carry text, and every fact goes in a code-drawn panel.
- **Privacy:** squad episodes use only anonymized counts (hidden for squads under 3) and opt-in jokes. Personal cuts go by DM. Mic audio is not stored; only the transcript is logged.
- **Browser audio:** autoplay rules need a user gesture (the Talk button provides it); test Safari, Chrome and Firefox.
- **Pack licenses and style mismatch:** keep to CC0 packs (license files are in `pixel/_licenses` and pack folders; V0 verifies), log each license, and palette-swap to keep one consistent look.
- **iMessage audio display** varies by OS version, so test on a real device.

## Decisions for you
1. **ElevenLabs plan:** a paid plan with streaming, since calls use it often. *Recommend Creator or higher.*
2. **Podcast hosts:** Cubbie + Rival, or Cubbie + the chapter expert? *Recommend Cubbie + Rival.*
3. **Character art:** pixel sprites in the village, Fluent 3D portraits in web chrome. Decided; the CSS mouth-flap approach is dropped (breathing/blink plus amplitude glow and scale only). Avatars are chosen, not generated.
4. **Call input:** start with typed or push-to-talk text in, voice out; realtime barge-in is Later (M12). *Recommend this order.*
5. **Talking-head video, custom voices for all personas, live phone calls:** now normal tickets (M14, M11, M13), built after the core ones.
6. **Voice cloning:** build it (M15) as consent-gated, own-voice only? *Recommend yes, last.*

## Sources
[1] https://elevenlabs.io/docs/api-reference/text-to-voice/design · [2] https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps · [3] https://elevenlabs.io/docs/api-reference/text-to-dialogue/convert · [4] https://community.openai.com/t/understanding-gpt-4o-mini-tts-pricing-input-characters-cost/1151816 · [5] https://www.myarchitectai.com/blog/nano-banana-api-pricing · [6] https://www.cometapi.com/how-much-does-gpt-image-1-cost/ · [7] https://magichour.ai/blog/guide-to-hedra-ai · [8] https://fluxnote.io/alternative/best-hedra-alternatives · [9] https://github.com/photon-hq/imessage-kit · [11] https://elevenlabs.io/docs/api-reference/text-to-speech/stream
