import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeLlm, type LlmJsonRequest, type LlmRequest } from '@squad/core';
import { describe, expect, it } from 'vitest';
import { measureLufs, probeDurationMs } from '../tts/audio';
import { FakeTts } from '../tts/fake';
import { TtsService } from '../tts/service';
import { PODCAST_CHUNK_CHARS } from '../tts/types';
import { VoiceService } from '../voices/service';
import { MemoryVoiceStore } from '../voices/store';
import { makePodcast } from './index';
import { chunkTurns } from './render';
import type { PodcastMaterial, ScriptTurn } from './types';

const cite = { courseId: 'demo', chapter: 'ch5', file: 'ch5.pdf', page: 4 };
const material = (over: Partial<PodcastMaterial> = {}): PodcastMaterial => ({
  chapterTitle: 'Chapter 5: Limits',
  passages: [
    { id: 'p1', text: 'A limit describes the value a function approaches.', cite },
    {
      id: 'p2',
      text: 'Continuity requires the limit to equal the value.',
      cite: { ...cite, page: 9 },
    },
  ],
  weakSpots: [{ concept: 'epsilon-delta', count: 3 }],
  personalWeakSpots: ['continuity'],
  jokes: ['the group chat keeps saying limit does not exist'],
  squadSize: 4,
  ...over,
});

const line = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ') + '.';
function script(words = 400): { turns: ScriptTurn[] } {
  const turns: ScriptTurn[] = [];
  for (let i = 0; i < 10; i++) {
    turns.push({
      speaker: i % 2 ? 'rival' : 'cubbie',
      text: line(words / 10),
      kind: i === 3 ? 'banter' : 'fact',
    });
  }
  return { turns };
}

function setup(over: { llm?: FakeLlm; dialogueFail?: boolean } = {}) {
  const engine = new FakeTts();
  if (over.dialogueFail) engine.failNext = 1;
  const llm =
    over.llm ??
    new FakeLlm({
      fallback: (req: LlmRequest | LlmJsonRequest<unknown>) => {
        if (req.model === 'fast') {
          const body = typeof req.messages === 'string' ? req.messages : '';
          const n = (body.match(/^\d+\. /gm) ?? []).length;
          return {
            checks: Array.from({ length: n }, (_, i) => ({
              i,
              supported: i !== 5,
              evidence: ['p1'],
            })),
          };
        }
        return script();
      },
    });
  return { engine, llm };
}

async function deps(engine: FakeTts, llm: FakeLlm, mat: PodcastMaterial, outDir?: string) {
  const store = new MemoryVoiceStore({ cubbie: 'v_cubbie', rival: 'v_rival' });
  const voices = new VoiceService({ store, fallbackVoiceId: 'stock' });
  const dir = outDir ?? (await mkdtemp(join(tmpdir(), 'pod-')));
  const tts = new TtsService({ engine, voices, cacheDir: join(dir, 'tts') });
  return { llm, tts, voices, material: async () => mat, outDir: dir };
}

describe('makePodcast', { timeout: 30_000 }, () => {
  it('renders a normalized m4a, drops unsupported fact turns, cites sources', async () => {
    const { engine, llm } = setup();
    const d = await deps(engine, llm, material());
    const r = await makePodcast(d, {
      courseId: 'demo',
      chapter: 'ch5',
      audience: 'squad',
      chatId: 'chat1',
    });
    expect(r.dropped).toBe(1);
    expect(r.script).toHaveLength(9);
    expect(r.message.attachments?.[0]?.mime).toBe('audio/mp4');
    expect(r.message.text).toMatch(/ch5\.pdf p\.4/);
    expect(r.dm).toBeUndefined();
    expect(await probeDurationMs(r.path)).toBeGreaterThan(60_000);
    expect(Math.abs((await measureLufs(r.path)) - -16)).toBeLessThan(3);
  });

  it('is cached: a second run makes no LLM call and no engine call', async () => {
    const { engine, llm } = setup();
    const d = await deps(engine, llm, material());
    const req = { courseId: 'demo', chapter: 'ch5', audience: 'squad' as const, chatId: 'c' };
    const a = await makePodcast(d, req);
    const llmCalls = llm.calls.length;
    const engineCalls = engine.calls.length;
    const b = await makePodcast(d, req);
    expect(b.path).toBe(a.path);
    // fact check still runs (fast, cheap); the script (main) must not
    expect(llm.calls.filter((c) => c.model === 'main')).toHaveLength(1);
    expect(llm.calls.length - llmCalls).toBe(1);
    expect(engine.calls.length).toBe(engineCalls);
  });

  it('falls back to per-turn TTS when dialogue fails', async () => {
    const { engine, llm } = setup({ dialogueFail: true });
    const d = await deps(engine, llm, material());
    const r = await makePodcast(d, {
      courseId: 'demo',
      chapter: 'ch5',
      audience: 'squad',
      chatId: 'c',
    });
    expect(engine.calls.some((c) => c.kind === 'synth')).toBe(true);
    expect(await probeDurationMs(r.path)).toBeGreaterThan(30_000);
  });

  it('personal cut is DM-only and uses the student weak spots, not squad counts', async () => {
    const { engine, llm } = setup();
    const d = await deps(engine, llm, material());
    const r = await makePodcast(d, {
      courseId: 'demo',
      chapter: 'ch5',
      audience: 's_ana',
      chatId: 'dm',
      targetWords: { min: 300, max: 500 },
    });
    expect(r.dm).toBe('s_ana');
    const prompt = JSON.stringify(llm.calls.filter((c) => c.model === 'main'));
    expect(prompt).toContain('continuity');
    expect(prompt).not.toContain('epsilon-delta');
  });

  it('squads under 3 never put counts or weak spots in any prompt (all sizes)', async () => {
    for (const size of [0, 1, 2]) {
      const { engine, llm } = setup();
      const d = await deps(engine, llm, material({ squadSize: size }));
      await makePodcast(d, { courseId: 'demo', chapter: 'ch5', audience: 'squad', chatId: 'c' });
      const all = JSON.stringify(llm.calls);
      expect(all).not.toContain('epsilon-delta');
      expect(all).not.toMatch(/\d+ of \d+/);
    }
  });

  it('squads of 3+ include anonymized counts but never names', async () => {
    const { engine, llm } = setup();
    const d = await deps(engine, llm, material({ squadSize: 3 }));
    await makePodcast(d, { courseId: 'demo', chapter: 'ch5', audience: 'squad', chatId: 'c' });
    const all = JSON.stringify(llm.calls);
    expect(all).toContain('epsilon-delta: 3 of 3');
    expect(all).not.toContain('continuity'); // personal data stays out of the squad cut
  });

  it('retries once on a bad word count then fails loudly', async () => {
    const llm = new FakeLlm({ fallback: () => script(40) });
    const { engine } = setup();
    const d = await deps(engine, llm, material());
    await expect(
      makePodcast(d, { courseId: 'demo', chapter: 'ch5', audience: 'squad', chatId: 'c' }),
    ).rejects.toThrow(/word count/);
    expect(llm.calls).toHaveLength(2);
  });
});

describe('chunkTurns', () => {
  it('never exceeds the limit, splits long turns, preserves order and text', () => {
    const turns: ScriptTurn[] = [
      { speaker: 'cubbie', text: 'A. '.repeat(1200).trim(), kind: 'fact' }, // 3,599 chars
      ...Array.from({ length: 30 }, (_, i) => ({
        speaker: (i % 2 ? 'rival' : 'cubbie') as 'rival',
        text: `turn ${i} ` + 'x'.repeat(150),
        kind: 'banter' as const,
      })),
    ];
    const chunks = chunkTurns(turns);
    for (const c of chunks)
      expect(c.reduce((n, t) => n + t.text.length, 0)).toBeLessThanOrEqual(PODCAST_CHUNK_CHARS);
    expect(chunks.length).toBeGreaterThan(3);
    const flat = chunks
      .flat()
      .map((t) => t.text)
      .join(' ');
    expect(flat.replace(/\s+/g, ' ')).toContain('turn 29');
  });
});
