import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BudgetGuard } from '../tts/budget';
import { FakeTts } from '../tts/fake';
import { TtsService } from '../tts/service';
import { VoiceService } from '../voices/service';
import { MemoryVoiceStore } from '../voices/store';
import { createMediaPort } from './media-port';
import { createCallPort } from './port';
import { fakeAnswer, FIXTURE_CITE } from './fake-answer';
import { FakeTranscriber } from './transcribe';
import type { AnswerFn, CallTurn } from './types';

async function mk(budget?: BudgetGuard) {
  const engine = new FakeTts();
  const store = new MemoryVoiceStore({ expert: 'v_expert' });
  const tts = new TtsService({
    engine,
    voices: new VoiceService({ store, fallbackVoiceId: 'stock' }),
    cacheDir: await mkdtemp(join(tmpdir(), 'call-')),
    ...(budget ? { budget } : {}),
  });
  return { engine, tts, store };
}
async function collect(it: AsyncIterable<CallTurn>) {
  const out: CallTurn[] = [];
  for await (const t of it) out.push(t);
  return out;
}

describe('call port', () => {
  it('one turn per sentence, audio attached, citation on the cited sentence, speaking events bracket audio', async () => {
    const { tts } = await mk();
    const events: boolean[] = [];
    const port = createCallPort({
      tts,
      answer: fakeAnswer,
      emit: (e) => void events.push(e.speaking),
      speakingTailMs: 5,
    });
    const s = (await port.open({ callId: 'c1', agent: 'expert:ch5', student: 's_ana' }))!;
    const g = await collect(s.greeting());
    expect(g.length).toBeGreaterThanOrEqual(1);
    const turns = await collect(s.reply('what is a limit'));
    expect(turns.map((t) => t.text)).toEqual([
      'You asked: what is a limit.',
      'The key idea is on page 12.',
    ]);
    expect(turns[0]!.cite).toBeUndefined();
    expect(turns[1]!.cite).toEqual(FIXTURE_CITE);
    expect(turns.every((t) => t.audio && t.audio.data.length > 500)).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(events[0]).toBe(true);
    expect(events.at(-1)).toBe(false);
    expect(events.every((v, i) => v === (i % 2 === 0))).toBe(true); // alternating, never stuck on
    await s.close();
  });

  it('captions never carry anything beyond what the answer yielded (withheld sentinel stays out)', async () => {
    const { tts } = await mk();
    const SENTINEL = '$180';
    let seenReq = '';
    const answer: AnswerFn = async (req) => {
      seenReq = JSON.stringify(req);
      return [{ text: 'Your squad is doing fine.' }];
    };
    const port = createCallPort({ tts, answer });
    const s = (await port.open({ callId: 'c', agent: 'dean', student: 's_ana' }))!;
    const turns = await collect(s.reply('hi'));
    expect(JSON.stringify(turns.map((t) => t.text))).not.toContain(SENTINEL);
    expect(seenReq).not.toContain(SENTINEL);
  });

  it('degrades to captions when TTS fails or budget is out', async () => {
    const { tts, engine } = await mk();
    engine.failNext = 5;
    const port = createCallPort({ tts, answer: fakeAnswer });
    const s = (await port.open({ callId: 'c', agent: 'dean', student: 's' }))!;
    const turns = await collect(s.reply('hello'));
    expect(turns).toHaveLength(2);
    expect(turns.every((t) => !t.audio)).toBe(true);

    const b = await mk(new BudgetGuard({ meters: { 'elevenlabs.chars': { total: 0 } } }));
    const s2 = (await createCallPort({ tts: b.tts, answer: fakeAnswer }).open({
      callId: 'c',
      agent: 'dean',
      student: 's',
    }))!;
    expect((await collect(s2.reply('hello'))).every((t) => !t.audio)).toBe(true);
  });

  it('ignores empty text, clips long text, keeps bounded history, stops after close', async () => {
    const { tts } = await mk();
    const seen: number[] = [];
    const answer: AnswerFn = async (r) => {
      seen.push(r.text.length, r.history.length);
      return [{ text: 'ok.' }];
    };
    const s = (await createCallPort({ tts, answer }).open({
      callId: 'c',
      agent: 'dean',
      student: 's',
    }))!;
    expect(await collect(s.reply('   '))).toEqual([]);
    await collect(s.reply('x'.repeat(5000)));
    expect(seen[0]).toBe(1000);
    for (let i = 0; i < 20; i++) await collect(s.reply('q'));
    expect(seen.at(-1)).toBeLessThanOrEqual(12);
    await s.close();
    expect(await collect(s.reply('after close'))).toEqual([]);
  });

  it('unknown agent returns null', async () => {
    const { tts } = await mk();
    const port = createCallPort({ tts, answer: fakeAnswer, knownAgent: () => false });
    expect(await port.open({ callId: 'c', agent: 'expert:zzz', student: 's' })).toBeNull();
  });

  it('mic audio is transcribed and only the transcript is answered', async () => {
    const { tts } = await mk();
    const tr = new FakeTranscriber('explain entropy');
    let got = '';
    const answer: AnswerFn = async (r) => {
      got = r.text;
      return [{ text: 'sure.' }];
    };
    const s = (await createCallPort({ tts, answer, transcriber: tr }).open({
      callId: 'c',
      agent: 'dean',
      student: 's',
    }))! as unknown as {
      audio(c: Uint8Array): void;
      replyToAudio(): AsyncIterable<CallTurn>;
    };
    s.audio(new Uint8Array(100));
    s.audio(new Uint8Array(50));
    const turns = await collect(s.replyToAudio());
    expect(tr.calls[0]!.bytes).toBe(150);
    expect(got).toBe('explain entropy');
    expect(turns).toHaveLength(1);
    expect(await collect(s.replyToAudio())).toEqual([]); // buffer was dropped
  });
});

describe('media port', () => {
  it('previews are cached, clipped to 400 chars, and voices lists saved ones', async () => {
    const { tts, engine, store } = await mk();
    const mp = createMediaPort({ personas: () => [], tts, store });
    const a = await mp.preview('v_x', 'hello '.repeat(200));
    const b = await mp.preview('v_x', 'hello '.repeat(200));
    expect(a!.data.length).toBe(b!.data.length);
    expect(engine.calls).toHaveLength(1);
    expect(engine.calls[0]!.text.length).toBeLessThanOrEqual(400);
    expect(await mp.preview('v_x', '  ')).toBeNull();
    expect((await mp.voices()).map((v) => v.id)).toContain('v_expert');
    await mp.updatePersona('cubbie', { voiceId: 'v_new' });
    expect((await mp.voices()).map((v) => v.id)).toContain('v_new');
  });
});
