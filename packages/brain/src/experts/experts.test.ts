import { describe, expect, it } from 'vitest';
import { FakeLlm, VillageEventSchema, type LlmJsonRequest, type LlmRequest } from '@squad/core';
import { createDean, bm25Chapters } from '../dean';
import { BrainUnavailableError } from './errors';
import { assembleBrain } from './brain';
import { MIN_CACHE_CHARS, createContextProvider } from './context';
import type { CourseStore } from '../ingest/types';
import { createChapterExpert } from './expert';
import { PAGE_MSE, makeKit } from './testkit';
import { NOT_IN_MATERIALS } from './types';

const good = {
  answer: 'x',
  claims: [
    {
      text: 'The factor of 2 comes from the power rule.',
      file: 'ch3-slides.pdf',
      page: 2,
      quote: 'The factor of 2 in the derivative comes from the power rule applied to the square.',
    },
  ],
};

async function expertKit(llm: FakeLlm) {
  const k = await makeKit(llm);
  const contexts = createContextProvider(k.store, llm, { minCacheChars: 10 });
  const expert = createChapterExpert({ llm, store: k.store, contexts, emit: k.emit }, 'c', 'ch3');
  return { ...k, contexts, expert };
}

describe('chapter expert', () => {
  it('answers with a verified citation and renders (file p.N)', async () => {
    const k = await expertKit(new FakeLlm({ responses: [good] }));
    const a = await k.expert.answer('why does MSE have a 2?');
    expect(a.grounded).toBe(true);
    expect(a.text).toBe('The factor of 2 comes from the power rule. (ch3-slides.pdf p.2)');
    expect(a.citations).toEqual([
      expect.objectContaining({ courseId: 'c', chapter: 'ch3', file: 'ch3-slides.pdf', page: 2 }),
    ]);
    const pg = k.store.getPage('c', 'ch3-slides.pdf', 2)!;
    expect(pg.text).toContain(a.citations[0]!.quote!);
  });

  it('strikes a planted wrong page and a fabricated quote; all struck => refusal', async () => {
    const wrongPage = { ...good.claims[0]!, page: 1 };
    const fabricated = {
      ...good.claims[0]!,
      quote: 'The factor of 2 exists because Gauss said so in 1809.',
    };
    const k = await expertKit(
      new FakeLlm({ responses: [{ answer: '', claims: [wrongPage, fabricated] }] }),
    );
    const a = await k.expert.answer('why 2?');
    expect(a).toMatchObject({ grounded: false, text: NOT_IN_MATERIALS, citations: [], struck: 2 });
  });

  it('keeps verified claims and counts struck ones', async () => {
    const bad = { ...good.claims[0]!, file: 'nope.pdf' };
    const k = await expertKit(
      new FakeLlm({ responses: [{ answer: '', claims: [good.claims[0]!, bad] }] }),
    );
    const a = await k.expert.answer('q');
    expect(a.grounded).toBe(true);
    expect(a.struck).toBe(1);
    expect(a.citations).toHaveLength(1);
  });

  it('uses the cache handle once per chapter and sends no system when cached', async () => {
    const llm = new FakeLlm({ fallback: good });
    const k = await expertKit(llm);
    await k.expert.answer('a');
    await k.expert.answer('b');
    expect(llm.caches).toHaveLength(1);
    for (const c of llm.calls) {
      const r = c as LlmJsonRequest<unknown>;
      expect(r.cache?.id).toBe(llm.caches[0]!.id);
      expect(r.system).toBeUndefined();
    }
    expect(JSON.stringify((llm.calls[0] as LlmRequest).messages)).toContain('Student question: a');
  });

  it('default cache threshold matches the 4,096-token Gemini minimum (~4 chars/token)', async () => {
    expect(MIN_CACHE_CHARS).toBeGreaterThanOrEqual(4096 * 4);
    const llm = new FakeLlm({ fallback: good });
    const pages = [{ file: 'f.pdf', page: 1, text: 'x' }];
    const store = (block: string) =>
      ({ getPages: () => pages, chapterContext: () => block }) as unknown as CourseStore;
    await createContextProvider(store('a'.repeat(10_000)), llm).get('c', 'ch');
    expect(llm.caches).toHaveLength(0);
    await createContextProvider(store('a'.repeat(MIN_CACHE_CHARS)), llm).get('c', 'ch');
    expect(llm.caches).toHaveLength(1);
  });

  it('tiny chapters skip the cache and put the chapter block in the system prompt', async () => {
    const llm = new FakeLlm({ fallback: good });
    const k = await makeKit(llm);
    const contexts = createContextProvider(k.store, llm);
    const e = createChapterExpert({ llm, store: k.store, contexts, emit: k.emit }, 'c', 'ch3');
    await e.answer('q');
    expect(llm.caches).toHaveLength(0);
    const req = llm.calls[0] as LlmJsonRequest<unknown>;
    expect(req.system).toContain('[ch3-slides.pdf p.2]');
    expect(req.system).toContain(PAGE_MSE);
  });

  it('createCache failure degrades to a plain prompt', async () => {
    const llm = new FakeLlm({ fallback: good });
    llm.createCache = async () => {
      throw new Error('429');
    };
    const k = await expertKit(llm);
    const a = await k.expert.answer('q');
    expect(a.grounded).toBe(true);
  });

  it('emits studying then idle for expert:<chapter>, also on failure, and never leaks answer text', async () => {
    const k = await expertKit(new FakeLlm({ responses: [good] }));
    await k.expert.answer('q');
    expect(k.events).toEqual([
      { t: 'agent.state', agent: 'expert:ch3', state: 'studying' },
      { t: 'agent.state', agent: 'expert:ch3', state: 'idle' },
    ]);
    k.events.forEach((e) => VillageEventSchema.parse(e));
    const k2 = await expertKit(new FakeLlm({ responses: ['not json', 'still not'] }));
    await expect(k2.expert.answer('q')).rejects.toBeInstanceOf(BrainUnavailableError);
    expect(k2.events.at(-1)).toEqual({ t: 'agent.state', agent: 'expert:ch3', state: 'idle' });
  });

  it('is deterministic: same scripted llm gives identical answers', async () => {
    const a = await (await expertKit(new FakeLlm({ responses: [good] }))).expert.answer('q');
    const b = await (await expertKit(new FakeLlm({ responses: [good] }))).expert.answer('q');
    expect(a).toEqual(b);
  });
});

describe('dean', () => {
  it('routes by llm, ignores invalid ids, and honors an explicit none', async () => {
    const k = await makeKit(
      new FakeLlm({ responses: [{ chapters: ['ch5', 'zzz'] }, { chapters: [] }] }),
    );
    const dean = createDean({ llm: k.llm, store: k.store, emit: k.emit });
    expect(await dean.route('c', 'what is a primary key')).toEqual({
      chapters: ['ch5'],
      via: 'llm',
    });
    expect(await dean.route('c', "what's on the final?")).toEqual({ chapters: [], via: 'llm' });
    expect(k.events.filter((e) => e.t === 'agent.state' && e.agent === 'dean')).toHaveLength(4);
  });

  it('falls back to BM25 when the llm throws, and says none for unrelated text', async () => {
    const llm = new FakeLlm({
      fallback: () => {
        throw new Error('quota');
      },
    });
    const k = await makeKit(llm);
    const dean = createDean({ llm, store: k.store, emit: k.emit });
    expect(await dean.route('c', 'why does the mean squared error have a factor of 2')).toEqual({
      chapters: ['ch3'],
      via: 'bm25',
    });
    expect((await dean.route('c', 'what is the capital of Australia')).chapters).toEqual([]);
  });

  it('bm25Chapters ranks the matching chapter first', async () => {
    const k = await makeKit();
    const hits = bm25Chapters(k.store.getPages('c'), 'primary key rows table');
    expect(hits[0]!.chapter).toBe('ch5');
  });
});

describe('brain.ask', () => {
  it('none => refusal without any expert call', async () => {
    const k = await makeKit(new FakeLlm({ responses: [{ chapters: [] }] }));
    const brain = assembleBrain({ llm: k.llm, db: k.db, store: k.store, emit: k.emit });
    const a = await brain.ask('c', "what's on the final?");
    expect(a).toMatchObject({ grounded: false, text: NOT_IN_MATERIALS });
    expect(k.llm.calls).toHaveLength(1); // only the Dean call
  });

  it('one chapter: dean then expert', async () => {
    const k = await makeKit(new FakeLlm({ responses: [{ chapters: ['ch3'] }, good] }));
    const brain = assembleBrain({ llm: k.llm, db: k.db, store: k.store, emit: k.emit });
    const a = await brain.ask('c', 'why does MSE have a 2?');
    expect(a.grounded).toBe(true);
    expect(a.chapters).toEqual(['ch3']);
  });

  it('two chapters merge keeps only verified citations', async () => {
    const llm = new FakeLlm({
      responses: [
        { chapters: ['ch3', 'ch5'] },
        (req) =>
          ((req as LlmJsonRequest<unknown>).system ?? '').includes('ch5-slides') ||
          JSON.stringify(req).includes('primary key')
            ? ch5
            : good,
        (req) =>
          ((req as LlmJsonRequest<unknown>).system ?? '').includes('ch5-slides') ? ch5 : good,
        { order: [1, 0, 99] },
      ],
    });
    const ch5 = {
      answer: '',
      claims: [
        {
          text: 'A primary key identifies each row.',
          file: 'ch5-slides.pdf',
          page: 1,
          quote: 'A primary key uniquely identifies each row in a table',
        },
        {
          text: 'Invented.',
          file: 'ch5-slides.pdf',
          page: 1,
          quote: 'Rows are always stored on a blockchain ledger',
        },
      ],
    };
    const k = await makeKit(llm);
    const brain = assembleBrain({ llm, db: k.db, store: k.store, emit: k.emit });
    const a = await brain.ask('c', 'compare');
    expect(a.grounded).toBe(true);
    expect(a.chapters.sort()).toEqual(['ch3', 'ch5']);
    for (const c of a.citations) {
      expect(k.store.getPage('c', c.file, c.page!)!.text).toContain(c.quote!);
    }
    expect(a.text).not.toContain('Invented');
  });
});
