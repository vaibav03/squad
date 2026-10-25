// End-to-end with fakes: factory -> voices -> tts -> call, podcast, explainer, delivery. No network.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeLlm, loadConfigLike } from './helpers';
import { describe, expect, it } from 'vitest';
import {
  createAudioServices,
  FakeTts,
  fakeAnswer,
  makePodcast,
  makeExplainer,
  FakeImageGen,
  prepareAudioAttachment,
  probeDurationMs,
  MemoryVoiceStore,
} from '../../src';

describe('audio smoke (fakes)', () => {
  it('speak twice hits cache; call turns carry audio; podcast + explainer produce attachments', async () => {
    const root = await mkdtemp(join(tmpdir(), 'smoke-'));
    const a = createAudioServices({
      config: loadConfigLike(),
      engine: new FakeTts(),
      root,
      store: new MemoryVoiceStore({ cubbie: 'v1', rival: 'v2' }),
    });
    const x = await a.tts.speak('cubbie', 'hello');
    expect((await a.tts.speak('cubbie', 'hello')).cached).toBe(true);
    expect(x.durationMs).toBeGreaterThan(300);

    const port = a.callPort({ answer: fakeAnswer });
    const s = (await port.open({ callId: 'c', agent: 'expert:ch5', student: 's' }))!;
    const turns: { text: string; cite?: unknown; audio?: unknown }[] = [];
    for await (const t of s.reply('what is a limit')) turns.push(t);
    expect(turns.length).toBe(2);
    expect(turns[1]!.cite).toBeDefined();
    expect(turns.every((t) => t.audio)).toBe(true);

    const cite = { courseId: 'd', chapter: 'ch5', file: 'ch5.pdf', page: 1 };
    const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ') + '.';
    const llm = new FakeLlm({
      fallback: (req: { model?: string; messages: unknown }) =>
        req.model === 'fast'
          ? {
              checks: Array.from({ length: 8 }, (_, i) => ({
                i,
                supported: true,
                evidence: ['p1'],
              })),
            }
          : {
              turns: Array.from({ length: 8 }, (_, i) => ({
                speaker: i % 2 ? 'rival' : 'cubbie',
                text: words(50),
                kind: 'fact',
              })),
            },
    });
    const pod = await makePodcast(
      {
        llm,
        tts: a.tts,
        voices: a.voices,
        outDir: join(root, 'pod'),
        material: async () => ({
          chapterTitle: 'Ch5',
          passages: [{ id: 'p1', text: 't', cite }],
          squadSize: 2,
        }),
      },
      { courseId: 'd', chapter: 'ch5', audience: 'squad', chatId: 'chat' },
    );
    expect(pod.message.attachments?.[0]?.mime).toBe('audio/mp4');
    expect(await probeDurationMs(pod.path)).toBeGreaterThan(30_000);
    expect((await prepareAudioAttachment(pod.path)).path).toBe(pod.path);

    const ex = await makeExplainer(
      {
        llm: new FakeLlm({
          fallback: {
            panels: [
              {
                kind: 'diagram',
                sources: ['p1'],
                diagram: {
                  kind: 'timeline',
                  title: 'Steps',
                  steps: [{ label: 'One' }, { label: 'Two' }],
                },
              },
            ],
          },
        }),
        material: async () => ({ chapterTitle: 'Ch5', passages: [{ id: 'p1', text: 't', cite }] }),
        imageGen: new FakeImageGen(),
        outDir: join(root, 'ex'),
      },
      { courseId: 'd', chapter: 'ch5', chatId: 'chat' },
    );
    expect(ex.message.attachments?.[0]?.mime).toBe('image/png');
  }, 60_000);
});
