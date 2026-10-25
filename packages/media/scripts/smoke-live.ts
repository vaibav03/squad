// FLAGGED real-key smoke. Runs only with SQUAD_LIVE=1. Tiny budget: ~120 ElevenLabs chars and 2 Gemini calls.
// Verifies: ElevenLabs voice listing + TTS + cache hit + timestamps, Gemini JSON call, Gemini transcription of our own TTS audio.
import { readFile } from 'node:fs/promises';
import { GeminiLlm, loadConfig } from '@squad/core/node';
import { createAudioServices } from '../src/factory';
import { BudgetGuard } from '../src/tts/budget';
import { guardLlm } from '../src/tts/guarded-llm';
import { GeminiTranscriber } from '../src/call/transcribe';
import { z } from 'zod';

if (process.env.SQUAD_LIVE !== '1') {
  console.log('SQUAD_LIVE!=1: skipping live smoke.');
  process.exit(0);
}
const cfg = loadConfig();
const budget = new BudgetGuard({
  meters: { 'elevenlabs.chars': { total: 150 }, 'gemini.calls': { total: 3 } },
});
const a = createAudioServices({ config: cfg, budget });
const voices = await a.eleven!.listVoices();
console.log('voices visible:', voices.length);
const premade = voices.find((v) => v.category === 'premade') ?? voices[0];
const store = a.store.all();
if (!premade && !Object.keys(store).length) throw new Error('no usable voice on this account');
const r1 = await a.tts.speakVoice(premade!.id, 'Hello squad, quick check.', { timings: true });
const r2 = await a.tts.speakVoice(premade!.id, 'Hello squad, quick check.', { timings: true });
console.log('tts', {
  ms: r1.durationMs,
  cachedSecond: r2.cached,
  timings: r1.timings?.length,
  spent: budget.spent('elevenlabs.chars'),
});
if (!r2.cached) throw new Error('cache miss on second call');
const llm = guardLlm(new GeminiLlm({ apiKey: cfg.geminiApiKey }), budget);
const j = await llm.json({
  model: 'fast',
  messages: 'Return {"ok":true}',
  schema: z.object({ ok: z.boolean() }),
});
console.log('gemini json', j);
const text = await new GeminiTranscriber({ apiKey: cfg.geminiApiKey, budget }).transcribe(
  new Uint8Array(await readFile(r1.path)),
  r1.mime,
);
console.log('transcript:', text);
console.log('LIVE SMOKE OK');
