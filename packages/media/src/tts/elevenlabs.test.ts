import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { ElevenLabsEngine, ELEVEN_BASE } from './elevenlabs';
import { DEFAULT_FALLBACK_VOICE_ID } from '../voices/service';
import { GeminiImageGen } from '../explainer/imagegen';

interface Captured {
  url: string;
  method: string;
  headerNames: string[];
  body: unknown;
}

/** Injected fetch: records request shape (header NAMES only) and replies with queued responses. */
function fakeFetch(...responses: Response[]) {
  const calls: Captured[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headerNames: [...headers.keys()].sort(),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const r = responses.shift();
    if (!r) throw new Error('no queued response');
    return r;
  });
  return { f: f as unknown as typeof fetch, calls };
}

const audio = () => new Response(new Uint8Array([1, 2, 3]), { status: 200 });
const json = (v: unknown) =>
  new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });

const engine = (f: typeof fetch) =>
  new ElevenLabsEngine({ apiKey: 'test-key', fetch: f, retries: 0 });

describe('ElevenLabsEngine request shapes (no network)', () => {
  it('convert: POST /v1/text-to-speech/{voice_id}?output_format=mp3_44100_128', async () => {
    const { f, calls } = fakeFetch(audio());
    const r = await engine(f).synth({ voiceId: 'v 1', text: 'hi', model: 'flash' });
    expect([...r.audio]).toEqual([1, 2, 3]);
    expect(calls[0]).toEqual({
      url: `${ELEVEN_BASE}/v1/text-to-speech/v%201?output_format=mp3_44100_128`,
      method: 'POST',
      headerNames: ['accept', 'content-type', 'xi-api-key'],
      body: { text: 'hi', model_id: 'eleven_flash_v2_5' },
    });
  });

  it('stream: POST /v1/text-to-speech/{voice_id}/stream?output_format=mp3_44100_64', async () => {
    const { f, calls } = fakeFetch(audio());
    const chunks: Uint8Array[] = [];
    for await (const c of engine(f).stream({ voiceId: 'v', text: 'hi', model: 'v3' }))
      chunks.push(c);
    expect(chunks.flatMap((c) => [...c])).toEqual([1, 2, 3]);
    expect(calls[0]).toMatchObject({
      url: `${ELEVEN_BASE}/v1/text-to-speech/v/stream?output_format=mp3_44100_64`,
      method: 'POST',
      headerNames: ['accept', 'content-type', 'xi-api-key'],
      body: { text: 'hi', model_id: 'eleven_v3' },
    });
  });

  it('with-timestamps: parses audio_base64 + alignment', async () => {
    const { f, calls } = fakeFetch(
      json({
        audio_base64: Buffer.from([9, 9]).toString('base64'),
        alignment: {
          characters: ['h', 'i'],
          character_start_times_seconds: [0, 0.1],
          character_end_times_seconds: [0.1, 0.25],
        },
        normalized_alignment: null,
      }),
    );
    const r = await engine(f).synthWithTimings({ voiceId: 'v', text: 'hi', model: 'flash' });
    expect(calls[0]!.url).toBe(
      `${ELEVEN_BASE}/v1/text-to-speech/v/with-timestamps?output_format=mp3_44100_128`,
    );
    expect([...r.audio]).toEqual([9, 9]);
    expect(r.timings).toEqual([
      { char: 'h', startMs: 0, endMs: 100 },
      { char: 'i', startMs: 100, endMs: 250 },
    ]);
  });

  it('text-to-dialogue: inputs[{text, voice_id}] + model_id eleven_v3', async () => {
    const { f, calls } = fakeFetch(audio());
    await engine(f).dialogue([
      { voiceId: 'a', text: 'one' },
      { voiceId: 'b', text: 'two' },
    ]);
    expect(calls[0]).toMatchObject({
      url: `${ELEVEN_BASE}/v1/text-to-dialogue?output_format=mp3_44100_128`,
      method: 'POST',
      body: {
        inputs: [
          { text: 'one', voice_id: 'a' },
          { text: 'two', voice_id: 'b' },
        ],
        model_id: 'eleven_v3',
      },
    });
  });

  it('voice design + create: /v1/text-to-voice/design then /v1/text-to-voice', async () => {
    const { f, calls } = fakeFetch(
      json({
        previews: [
          {
            audio_base_64: Buffer.from([7]).toString('base64'),
            generated_voice_id: 'gen1',
            media_type: 'audio/mpeg',
            duration_secs: 2.5,
          },
        ],
        text: 'auto',
      }),
      json({ voice_id: 'voice1', name: 'N' }),
    );
    const e = engine(f);
    const previews = await e.designVoice('a warm, calm tutor voice with a slight accent');
    expect(previews).toEqual([
      { generatedVoiceId: 'gen1', audio: new Uint8Array([7]), durationSecs: 2.5 },
    ]);
    expect(calls[0]).toMatchObject({
      url: `${ELEVEN_BASE}/v1/text-to-voice/design`,
      method: 'POST',
      headerNames: ['content-type', 'xi-api-key'],
      body: {
        voice_description: 'a warm, calm tutor voice with a slight accent',
        auto_generate_text: true,
      },
    });
    expect(await e.saveVoice('gen1', 'N', 'desc')).toBe('voice1');
    expect(calls[1]).toMatchObject({
      url: `${ELEVEN_BASE}/v1/text-to-voice`,
      method: 'POST',
      body: { voice_name: 'N', voice_description: 'desc', generated_voice_id: 'gen1' },
    });
  });

  it('listVoices: GET /v2/voices with page_size=100, follows next_page_token', async () => {
    const { f, calls } = fakeFetch(
      json({
        voices: [{ voice_id: DEFAULT_FALLBACK_VOICE_ID, name: 'Rachel', category: 'premade' }],
        has_more: true,
        next_page_token: 'tok',
      }),
      json({ voices: [{ voice_id: 'x', name: 'X' }], has_more: false, next_page_token: null }),
    );
    const voices = await engine(f).listVoices();
    expect(voices).toEqual([
      { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', category: 'premade' },
      { id: 'x', name: 'X' },
    ]);
    expect(calls.map((c) => [c.method, c.url, c.headerNames])).toEqual([
      ['GET', `${ELEVEN_BASE}/v2/voices?page_size=100`, ['xi-api-key']],
      ['GET', `${ELEVEN_BASE}/v2/voices?page_size=100&next_page_token=tok`, ['xi-api-key']],
    ]);
  });
});

describe('GeminiImageGen request shape (injected client)', () => {
  it('generateContent with responseModalities [IMAGE], reads inlineData', async () => {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer();
    const generateContent = vi.fn(async () => ({
      candidates: [
        {
          content: {
            parts: [
              { text: 'here' },
              { inlineData: { mimeType: 'image/png', data: png.toString('base64') } },
            ],
          },
        },
      ],
    }));
    vi.stubEnv('GEMINI_IMAGE_MODEL', undefined);
    const gen = new GeminiImageGen({ client: { models: { generateContent } } as never });
    vi.unstubAllEnvs();
    const out = await gen.generate('a cat');
    expect((await sharp(out).metadata()).format).toBe('png');
    expect(generateContent).toHaveBeenCalledWith({
      model: 'gemini-nano-banana-2.1',
      contents: 'a cat',
      config: { responseModalities: ['IMAGE'] },
    });
  });
});
