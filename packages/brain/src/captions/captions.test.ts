import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FakeLlm, VillageEventSchema } from '@squad/core';
import { PAGE_MSE } from '../experts/testkit';
import { NO_SUPPORT_CAPTION, gateSentences, isPureTalk, splitSentences } from './index';
import { CaptionUnavailableError } from './errors';
import { captionKit } from './testkit';
import { quoteOnPage } from '../citations';

const Q = 'The factor of 2 in the derivative comes from the power rule applied to the square.';
const script = {
  sentences: [
    { text: 'Great question.', factual: false },
    {
      text: 'The 2 comes from the power rule.',
      factual: true,
      file: 'ch3-slides.pdf',
      page: 2,
      quote: Q,
    },
    {
      text: 'The MSE averages squared differences.',
      factual: true,
      file: 'ch3-slides.pdf',
      page: 2,
      quote: 'is the average of the squared differences between predictions and targets',
    },
    { text: 'Does that make sense?', factual: false },
  ],
};
const run = {
  callId: 'call1',
  courseId: 'c',
  chapter: 'ch3',
  question: 'why is there a 2?',
  student: 's_ana',
};

describe('caption pipeline', () => {
  it('emits one call.caption per sentence, in order, each factual one with a verified cite', async () => {
    const k = await captionKit(new FakeLlm({ responses: [script] }));
    const seen: string[] = [];
    const lines = await k.pipeline.run(run, (l) => seen.push(l.text));
    expect(lines.map((l) => l.text)).toEqual(script.sentences.map((s) => s.text));
    expect(seen).toEqual(lines.map((l) => l.text));
    const caps = k.events.filter((e) => e.t === 'call.caption');
    expect(caps).toHaveLength(4);
    for (const e of caps) {
      VillageEventSchema.parse(e);
      if (e.t === 'call.caption' && e.cite) {
        const pg = k.store.getPage('c', e.cite.file, e.cite.page!)!;
        expect(quoteOnPage(e.cite.quote!, pg.text)).toBe(true);
      }
    }
    expect(caps.filter((e) => e.t === 'call.caption' && e.cite)).toHaveLength(2);
    expect(caps[0]).toMatchObject({ agent: 'expert:ch3', callId: 'call1', student: 's_ana' });
  });

  it('wraps in agent.state in_call -> idle and never emits call.start or call.end', async () => {
    const k = await captionKit(new FakeLlm({ responses: [script] }));
    await k.pipeline.run(run);
    expect(k.events[0]).toEqual({ t: 'agent.state', agent: 'expert:ch3', state: 'in_call' });
    expect(k.events.at(-1)).toEqual({ t: 'agent.state', agent: 'expert:ch3', state: 'idle' });
    expect(k.events.some((e) => e.t === 'call.start' || e.t === 'call.end')).toBe(false);
  });

  it('drops a fabricated-quote sentence and a factual sentence without a cite', async () => {
    const s = {
      sentences: [
        {
          text: 'The 2 comes from the power rule.',
          factual: true,
          file: 'ch3-slides.pdf',
          page: 2,
          quote: Q,
        },
        {
          text: 'It was discovered in 1809.',
          factual: true,
          file: 'ch3-slides.pdf',
          page: 2,
          quote: 'Gauss discovered the factor of two in 1809 exactly',
        },
        { text: 'Variance is always 7.', factual: false },
      ],
    };
    const k = await captionKit(new FakeLlm({ responses: [s] }));
    const lines = await k.pipeline.run(run);
    expect(lines.map((l) => l.text)).toEqual(['The 2 comes from the power rule.']);
  });

  it('nothing survives => the single not-in-materials caption, no cite', async () => {
    const k = await captionKit(
      new FakeLlm({
        responses: [
          {
            sentences: [
              {
                text: 'The final is on Friday.',
                factual: true,
                file: 'x.pdf',
                page: 1,
                quote: 'the final is on friday for sure',
              },
            ],
          },
        ],
      }),
    );
    const lines = await k.pipeline.run(run);
    expect(lines).toEqual([{ seq: 0, text: NO_SUPPORT_CAPTION }]);
    const k2 = await captionKit(new FakeLlm({ responses: [{ sentences: [] }] }));
    expect((await k2.pipeline.run(run))[0]!.text).toBe(NO_SUPPORT_CAPTION);
  });

  it('stored transcript equals what was emitted', async () => {
    const k = await captionKit(new FakeLlm({ responses: [script] }));
    const lines = await k.pipeline.run(run);
    expect(k.pipeline.transcript('call1')).toEqual(lines);
    const emitted = k.events
      .filter((e) => e.t === 'call.caption')
      .map((e) => (e.t === 'call.caption' ? { text: e.text, cite: e.cite } : null));
    expect(emitted).toEqual(lines.map((l) => ({ text: l.text, cite: l.cite })));
  });

  it('is deterministic', async () => {
    const a = await captionKit(new FakeLlm({ responses: [script] }));
    const b = await captionKit(new FakeLlm({ responses: [script] }));
    await a.pipeline.run(run);
    await b.pipeline.run(run);
    expect(a.events).toEqual(b.events);
  });

  it('a failing emit does not crash the call; llm failure throws a typed error and still emits idle', async () => {
    const k = await captionKit(new FakeLlm({ responses: [script] }));
    let n = 0;
    const flaky = { ...k };
    const p = (await import('./index')).createCaptionPipeline({
      store: k.store,
      contexts: k.contexts,
      llm: k.llm,
      db: k.db,
      emit: (e) => {
        if (e.t === 'call.caption' && n++ === 1) throw new Error('hub down');
        k.emit(e);
      },
    });
    expect(await p.run(run)).toHaveLength(4);
    void flaky;
    const k2 = await captionKit(new FakeLlm({ responses: ['bad', 'bad'] }));
    await expect(k2.pipeline.run(run)).rejects.toBeInstanceOf(CaptionUnavailableError);
    expect(k2.events.at(-1)).toEqual({ t: 'agent.state', agent: 'expert:ch3', state: 'idle' });
    expect(k2.events.filter((e) => e.t === 'call.caption')).toHaveLength(0);
  });
});

describe('sentence splitting and gate', () => {
  it.each([
    ['Use e.g. the mean. Then stop.', ['Use e.g. the mean.', 'Then stop.']],
    ['Pi is 3.14 roughly. Next.', ['Pi is 3.14 roughly.', 'Next.']],
    ['See Fig. 2.3 for details. Done!', ['See Fig. 2.3 for details.', 'Done!']],
    ['', []],
    ['One sentence without end', ['One sentence without end']],
    ['Really? Yes. Okay!', ['Really?', 'Yes.', 'Okay!']],
  ])('splits %j', (input, want) => expect(splitSentences(input)).toEqual(want));

  it('property: no empty pieces, no loss of non-space characters, no split inside a decimal', () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[A-Za-z0-9.,!? ]{0,30}$/), { maxLength: 8 }),
        (parts) => {
          const input = parts.join(' ');
          const out = splitSentences(input);
          expect(out.every((s) => s.length > 0 && s === s.trim())).toBe(true);
          expect(out.join('').replace(/\s/g, '')).toBe(input.replace(/\s/g, ''));
        },
      ),
    );
    expect(splitSentences('The value is 3.5 percent.')).toHaveLength(1);
  });

  it('isPureTalk is strict: digits and long lines are not talk', () => {
    expect(isPureTalk('Great question.')).toBe(true);
    expect(isPureTalk('Does that make sense?')).toBe(true);
    expect(isPureTalk('Great, the answer is 4.')).toBe(false);
    expect(isPureTalk('The mean is the average of the numbers.')).toBe(false);
  });

  it('multi-sentence item: only the first sentence keeps the cite', () => {
    const pages = [{ courseId: 'c', chapter: 'ch3', file: 'f.pdf', page: 1, text: PAGE_MSE }];
    const { lines, dropped } = gateSentences(
      [
        {
          text: 'The 2 comes from the power rule. Also the sky is green.',
          factual: true,
          file: 'f.pdf',
          page: 1,
          quote: Q,
        },
      ],
      pages,
      { courseId: 'c', chapter: 'ch3' },
    );
    expect(lines.map((l) => l.text)).toEqual(['The 2 comes from the power rule.']);
    expect(dropped).toBe(1);
  });
});
