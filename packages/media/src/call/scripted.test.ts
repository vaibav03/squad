import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeTts } from '../tts/fake';
import { TtsService } from '../tts/service';
import { VoiceService } from '../voices/service';
import { MemoryVoiceStore } from '../voices/store';
import { createCallPort } from './port';
import type { AnswerFn, CallTurn, HistoryItem, ScriptedAgent } from './types';

async function mkTts() {
  return new TtsService({
    engine: new FakeTts(),
    voices: new VoiceService({
      store: new MemoryVoiceStore({ examiner: 'v_ex' }),
      fallbackVoiceId: 'stock',
    }),
    cacheDir: await mkdtemp(join(tmpdir(), 'scripted-')),
  });
}
async function collect(it: AsyncIterable<CallTurn>) {
  const out: CallTurn[] = [];
  for await (const t of it) out.push(t);
  return out;
}
const answer: AnswerFn = async () => [{ text: 'static answer.' }];

function script(): ScriptedAgent & { seen: HistoryItem[][]; finish: boolean } {
  const o = {
    seen: [] as HistoryItem[][],
    finish: false,
    greeting: async () => [{ text: 'Welcome. First question here?' }],
    reply: async (_t: string, h: HistoryItem[]) => {
      o.seen.push(h);
      o.finish = true;
      return [
        { text: 'Solid on the basics. Revisit the edge cases.', cite: { courseId: 'c', chapter: 'ch1', file: 'f.pdf', page: 1 } },
        { text: 'That is the end.' },
      ];
    },
    done: () => o.finish,
  };
  return o;
}

describe('createCallPort agentFor', () => {
  it('uses the scripted agent: captions per sentence, finished() after the last line', async () => {
    const sc = script();
    const port = createCallPort({
      tts: await mkTts(),
      answer,
      agentFor: ({ agent }) => (agent === 'expert:oral' ? sc : undefined),
      personaFor: () => 'examiner',
    });
    const s = (await port.open({ callId: 'c1', agent: 'expert:oral', student: 's_ana' }))!;
    const g = await collect(s.greeting());
    expect(g.map((t) => t.text)).toEqual(['Welcome.', 'First question here?']);
    expect(g.every((t) => t.audio && t.audio.data.length > 100)).toBe(true);
    expect(s.finished?.()).toBe(false);
    const r = await collect(s.reply('my answer'));
    expect(r.map((t) => t.text)).toEqual([
      'Solid on the basics.',
      'Revisit the edge cases.',
      'That is the end.',
    ]);
    expect(r[1]!.cite?.chapter).toBe('ch1');
    expect(r[0]!.cite).toBeUndefined();
    expect(s.finished?.()).toBe(true);
    expect(sc.seen[0]!.map((h) => h.who)).toEqual(['agent', 'you']);
    await s.close();
  });

  it('other agents keep the static path and are never finished', async () => {
    const port = createCallPort({
      tts: await mkTts(),
      answer,
      agentFor: ({ agent }) => (agent === 'expert:oral' ? script() : undefined),
    });
    const s = (await port.open({ callId: 'c2', agent: 'expert:ch5', student: 's_ana' }))!;
    expect((await collect(s.reply('hi'))).map((t) => t.text)).toEqual(['static answer.']);
    expect(s.finished?.()).toBe(false);
  });

  it('TTS failure: captions only', async () => {
    const sc = script();
    const port = createCallPort({
      tts: {
        speak: async () => {
          throw new Error('no key');
        },
      },
      answer,
      agentFor: () => sc,
    });
    const s = (await port.open({ callId: 'c3', agent: 'expert:oral', student: 's_ana' }))!;
    const g = await collect(s.greeting());
    expect(g.map((t) => t.text)).toEqual(['Welcome.', 'First question here?']);
    expect(g.every((t) => t.audio === undefined)).toBe(true);
  });
});
