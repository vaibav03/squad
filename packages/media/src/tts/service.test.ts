import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VoiceService } from '../voices/service';
import { MemoryVoiceStore } from '../voices/store';
import { BudgetGuard } from './budget';
import { FakeTts } from './fake';
import { sentences, TtsService } from './service';
import { BudgetExceededError } from './types';

async function setup(budget?: BudgetGuard, withFallback = false) {
  const dir = await mkdtemp(join(tmpdir(), 'tts-'));
  const engine = new FakeTts();
  const fb = new FakeTts();
  const voices = new VoiceService({
    store: new MemoryVoiceStore({ cubbie: 'v_cubbie' }),
    fallbackVoiceId: 'v_stock',
  });
  const tts = new TtsService({
    engine,
    voices,
    cacheDir: dir,
    ...(budget ? { budget } : {}),
    ...(withFallback ? { fallbackEngine: fb } : {}),
  });
  return { tts, engine, fb, voices };
}

describe('TtsService', () => {
  it('second identical speak is a cache hit with no engine call or spend', async () => {
    const budget = new BudgetGuard({ meters: { 'elevenlabs.chars': { total: 1000 } } });
    const { tts, engine } = await setup(budget);
    const a = await tts.speak('cubbie', 'hello there');
    const b = await tts.speak('cubbie', 'hello there');
    expect(a.cached).toBe(false);
    expect(b.cached).toBe(true);
    expect(b.path).toBe(a.path);
    expect(engine.calls).toHaveLength(1);
    expect(budget.spent('elevenlabs.chars')).toBe('hello there'.length);
    expect(a.durationMs).toBeGreaterThan(300);
  });

  it('different voice or text misses the cache', async () => {
    const { tts, engine } = await setup();
    await tts.speak('cubbie', 'hello');
    await tts.speak('rival', 'hello'); // resolves to stock voice
    await tts.speak('cubbie', 'hello!');
    expect(engine.calls).toHaveLength(3);
  });

  it('timings are cached and returned', async () => {
    const { tts, engine } = await setup();
    const a = await tts.speak('cubbie', 'hi', { timings: true });
    const b = await tts.speak('cubbie', 'hi', { timings: true });
    expect(a.timings).toHaveLength(2);
    expect(b.cached && b.timings?.length).toBe(2);
    expect(engine.calls).toHaveLength(1);
  });

  it('budget exhaustion throws without calling the engine', async () => {
    const { tts, engine } = await setup(
      new BudgetGuard({ meters: { 'elevenlabs.chars': { perHour: 5 } } }),
    );
    await expect(tts.speak('cubbie', 'far too long for budget')).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    expect(engine.calls).toHaveLength(0);
  });

  it('falls back when the primary fails or the budget is out', async () => {
    const { tts, engine, fb } = await setup(undefined, true);
    engine.failNext = 1;
    const r = await tts.speak('cubbie', 'resilient');
    expect(r.source).toBe('fallback');
    expect(fb.calls).toHaveLength(1);

    const s2 = await setup(new BudgetGuard({ meters: { 'elevenlabs.chars': { total: 0 } } }), true);
    expect((await s2.tts.speak('cubbie', 'over budget')).source).toBe('fallback');
  });

  it('concurrent identical calls share one engine call', async () => {
    const { tts, engine } = await setup();
    await Promise.all([tts.speak('cubbie', 'same'), tts.speak('cubbie', 'same')]);
    expect(engine.calls).toHaveLength(1);
  });

  it('streamSpeak yields audio per sentence', async () => {
    const { tts } = await setup();
    const seen = new Set<string>();
    let bytes = 0;
    for await (const c of tts.streamSpeak('cubbie', 'One sentence. Two sentences!')) {
      seen.add(c.sentence);
      bytes += c.audio.length;
    }
    expect([...seen]).toEqual(['One sentence.', 'Two sentences!']);
    expect(bytes).toBeGreaterThan(1000);
  });
});

describe('sentences', () => {
  it('splits token streams incrementally', async () => {
    async function* toks() {
      for (const t of ['Hel', 'lo wor', 'ld. Next', ' one? Tail']) yield t;
    }
    const out: string[] = [];
    for await (const s of sentences(toks())) out.push(s);
    expect(out).toEqual(['Hello world.', 'Next one?', 'Tail']);
  });
});
