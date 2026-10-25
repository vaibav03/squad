import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ElevenLabsEngine, chunkTurns, PODCAST_CHUNK_CHARS } from '@squad/media';
import { measureLufs } from '../../../packages/media/src/tts/audio';
import { BudgetExceeded } from '../lib/budget';
import { fatalFromEleven } from '../lib/fixes';
import type { Check, ElevenPort, LiveContext } from '../lib/types';

const SENTENCE = 'Hello squad, quick check.'; // 25 characters
const DIALOGUE = [
  { speaker: 'A', text: 'Ready for chapter six?' },
  { speaker: 'B', text: 'Always. Z-scores first.' },
];

/** Real ElevenLabs engine over a metered fetch: characters are charged BEFORE each billed request. */
export function realEleven(ctx: LiveContext): ElevenPort {
  const key = ctx.env.ELEVENLABS_API_KEY ?? '';
  const metered: typeof fetch = async (input, init) => {
    const url = String(input);
    let chars = 0;
    try {
      const b = JSON.parse(String(init?.body ?? '{}')) as { text?: string; inputs?: { text: string }[] };
      if (url.includes('/text-to-speech/')) chars = (b.text ?? '').length;
      else if (url.includes('/text-to-dialogue')) chars = (b.inputs ?? []).reduce((s, i) => s + i.text.length, 0);
      else if (url.includes('/text-to-voice/design')) chars = 100; // design bills credits; charge a pessimistic 100
    } catch {
      /* GET */
    }
    if (chars > 0) ctx.budget.guardChars(chars);
    else ctx.budget.guardFreeCall();
    const res = await ctx.fetch(input, init);
    if (!res.ok) {
      const f = fatalFromEleven(res.status, await res.clone().text().catch(() => ''));
      if (f && f.kind !== 'el_rate_limited') ctx.budget.abort(f);
    }
    return res;
  };
  const eng = new ElevenLabsEngine({ apiKey: key, fetch: metered, retries: 1, sleep: ctx.sleep });
  return {
    listVoices: () => eng.listVoices(1),
    designVoice: async (d) => (await eng.designVoice(d)).map((p) => ({ generatedVoiceId: p.generatedVoiceId })),
    tts: async (voiceId, text) => {
      const r = await eng.synthWithTimings({ voiceId, text, model: 'flash' } as never);
      return { audio: r.audio, timings: r.timings.length };
    },
    dialogue: (inputs) => eng.dialogue(inputs),
  };
}

/** Voices, voice design, TTS with timestamps, dialogue chunking, loudness. Needs LIVE_ELEVENLABS=1 (it can bill). */
export const elevenCheck: Check = {
  id: 7,
  name: 'elevenlabs: voices, design, tts + timestamps, dialogue, loudness',
  needs: ['elevenlabs'],
  estimate: { calls: 5, tokens: 0, chars: 175 },
  async run(ctx, t) {
    if (!ctx.allowVoiceDesign) {
      t.skip('all ElevenLabs steps', 'set LIVE_ELEVENLABS=1 to allow billed calls (about 175 characters plus one voice design preview)');
      return;
    }
    const el = ctx.eleven ?? realEleven(ctx);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-el-'));
    let voiceId = '';
    await t.step('list voices (GET /v2/voices)', async () => {
      const v = await el.listVoices();
      if (v.length === 0) throw new Error('the account lists no voices');
      voiceId = (v.find((x) => x.category === 'premade') ?? v[0]!).id;
      return `${v.length} voice(s) visible; using ${voiceId.slice(0, 6)}...`;
    });
    await t.step('design one voice preview (not saved)', async () => {
      const p = await el.designVoice('A warm, upbeat young study buddy with a clear, friendly tone and a light playful energy.');
      if (p.length === 0 || !p[0]!.generatedVoiceId) throw new Error('no preview returned');
      return `${p.length} preview(s)`;
    });
    let mp3 = '';
    await t.step('tts of one short sentence with character timestamps', async () => {
      if (!voiceId) throw new Error('no voice id (list voices failed)');
      const r = await el.tts(voiceId, SENTENCE);
      if (r.audio.length < 2000) throw new Error(`audio too small: ${r.audio.length} bytes`);
      if (r.timings < SENTENCE.length * 0.8) throw new Error(`timings ${r.timings} for ${SENTENCE.length} chars`);
      mp3 = path.join(dir, 'tts.mp3');
      fs.writeFileSync(mp3, r.audio);
      return `${r.audio.length} bytes, ${r.timings} character timings`;
    });
    await t.step('podcast chunking stays under the dialogue limit (offline)', async () => {
      const turns = Array.from({ length: 40 }, (_, i) => ({ speaker: i % 2 ? 'rival' : 'cubbie', text: 'x'.repeat(160), kind: 'banter' as const }));
      const chunks = chunkTurns(turns as never);
      const big = chunks.filter((c) => c.reduce((s, x) => s + x.text.length, 0) > PODCAST_CHUNK_CHARS);
      if (big.length) throw new Error(`${big.length} chunk(s) over ${PODCAST_CHUNK_CHARS} chars`);
      return `${turns.length} turns -> ${chunks.length} chunks, each <= ${PODCAST_CHUNK_CHARS} chars`;
    });
    let dlg = '';
    await t.step('dialogue endpoint (/v1/text-to-dialogue), two voices', async () => {
      if (!voiceId) throw new Error('no voice id');
      const audio = await el.dialogue(DIALOGUE.map((d) => ({ voiceId, text: d.text })));
      if (audio.length < 2000) throw new Error(`dialogue audio too small: ${audio.length}`);
      dlg = path.join(dir, 'dialogue.mp3');
      fs.writeFileSync(dlg, audio);
      return `${audio.length} bytes for ${DIALOGUE.reduce((s, d) => s + d.text.length, 0)} chars`;
    });
    await t.step('loudness measured with ffmpeg (ebur128)', async () => {
      const f = dlg || mp3;
      if (!f) throw new Error('no audio file to measure');
      const lufs = await measureLufs(f);
      if (!Number.isFinite(lufs) || lufs < -60 || lufs > -5) throw new Error(`implausible loudness ${lufs} LUFS`);
      t.metric('integrated loudness LUFS', lufs);
      return `${lufs} LUFS (podcast target -16 after the mix step; raw TTS is not normalised)`;
    });
    void BudgetExceeded;
  },
};
