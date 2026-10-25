import { beforeAll, describe, expect, it } from 'vitest';
import { FakeLlm, type VillageEvent } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import {
  NOT_IN_MATERIALS,
  bm25Chapters,
  createBrain,
  createCourseStore,
  loadFixtureCourse,
  quoteOnPage,
  type Brain,
} from '../src';
import { OracleLlm, loadGolden, type Mode } from './oracle';

const golden = loadGolden();

async function build(mode: Mode) {
  const db = openMemoryDb();
  const llm = new OracleLlm(golden, mode);
  const events: VillageEvent[] = [];
  const brain = createBrain({ llm, db, emit: (e) => void events.push(e) });
  await loadFixtureCourse({ store: brain.store });
  return { brain, llm, events, db };
}

describe('golden set (known pages)', () => {
  let b: Awaited<ReturnType<typeof build>>;
  beforeAll(async () => {
    b = await build('honest');
  });

  it('has the required size', () => {
    expect(golden.answerable.length).toBeGreaterThanOrEqual(12);
    expect(golden.unanswerable.length).toBeGreaterThanOrEqual(6);
  });

  it.each(golden.answerable.map((g) => [g.id, g] as const))(
    '%s answers with a verified citation',
    async (_id, g) => {
      const a = await b.brain.ask('demo', g.question);
      expect(a.grounded).toBe(true);
      expect(a.citations.length).toBeGreaterThanOrEqual(1);
      for (const c of a.citations) {
        const page = b.brain.store.getPage('demo', c.file, c.page!);
        expect(page, 'cited page exists').toBeTruthy();
        expect(quoteOnPage(c.quote!, page!.text)).toBe(true);
      }
      // the known page is cited (a quote may legitimately occur on two pages; accept any page that has it)
      const knownPages = b.brain.store
        .getPages('demo', g.chapter)
        .filter((p) => quoteOnPage(g.quote, p.text))
        .map((p) => p.page);
      expect(a.citations.some((c) => c.file === g.file && knownPages.includes(c.page!))).toBe(true);
      expect(a.text).toContain(`(${g.file} p.${a.citations[0]!.page})`);
    },
  );

  it.each(golden.unanswerable.map((u) => [u.id, u] as const))('%s is refused', async (_id, u) => {
    const a = await b.brain.ask('demo', u.question);
    expect(a).toMatchObject({ grounded: false, text: NOT_IN_MATERIALS, citations: [] });
  });

  it('uses one cached context per chapter across all questions', () => {
    expect(b.llm.caches.length).toBeLessThanOrEqual(4);
  });
});

describe('planted bad model behaviour is rejected', () => {
  it.each(['wrong-page', 'fabricated', 'cross-chapter'] as Mode[])(
    '%s claims never reach the student',
    async (mode) => {
      const { brain } = await build(mode);
      for (const g of golden.answerable) {
        const a = await brain.ask('demo', g.question);
        expect(a.grounded, `${mode} ${g.id}`).toBe(false);
        expect(a.text).toBe(NOT_IN_MATERIALS);
        expect(a.citations).toEqual([]);
        expect(a.struck).toBeGreaterThanOrEqual(1);
      }
    },
  );

  it('a hallucinating model on unanswerable questions is still refused (routed to none)', async () => {
    const { brain } = await build('fabricated');
    for (const u of golden.unanswerable) {
      expect((await brain.ask('demo', u.question)).grounded).toBe(false);
    }
  });
});

describe('determinism', () => {
  it('the same scripted llm gives byte-identical answers and events', async () => {
    const run = async () => {
      const { brain, events } = await build('honest');
      const answers = [];
      for (const g of golden.answerable.slice(0, 5))
        answers.push(await brain.ask('demo', g.question));
      return { answers, events };
    };
    expect(await run()).toEqual(await run());
  });
});

describe('dean BM25 fallback routing (no llm)', () => {
  it('routes at least 70% of golden questions to the right chapter', async () => {
    const store = createCourseStore(openMemoryDb());
    await loadFixtureCourse({ store });
    const pages = store.getPages('demo');
    let hit = 0;
    for (const g of golden.answerable) {
      const top = bm25Chapters(pages, g.question)[0];
      if (top?.chapter === g.chapter) hit++;
    }
    const rate = hit / golden.answerable.length;
    console.info(
      `bm25 routing accuracy: ${(rate * 100).toFixed(0)}% (${hit}/${golden.answerable.length})`,
    );
    expect(rate).toBeGreaterThanOrEqual(0.7);
  });

  it('end to end with a failing Dean llm, the brain still routes by BM25', async () => {
    const llm = new FakeLlm({
      fallback: () => {
        throw new Error('quota');
      },
    });
    const brain: Brain = createBrain({ llm, db: openMemoryDb(), emit: () => {} });
    await loadFixtureCourse({ store: brain.store });
    const r = await brain.dean.route(
      'demo',
      'What is the empirical rule for the normal distribution?',
    );
    expect(r).toEqual({ chapters: ['ch6'], via: 'bm25' });
  });
});

describe('unanswerable questions with the Dean down', () => {
  it('BM25 may pick a chapter, but the expert finds no supported quote and the answer is refused', async () => {
    const llm = new FakeLlm({
      fallback: (req) => {
        if ((req.system ?? '').includes('Dean')) throw new Error('quota');
        return { answer: '', claims: [] };
      },
    });
    const brain = createBrain({ llm, db: openMemoryDb(), emit: () => {} });
    await loadFixtureCourse({ store: brain.store });
    for (const u of golden.unanswerable) {
      const a = await brain.ask('demo', u.question);
      expect(a).toMatchObject({ grounded: false, text: NOT_IN_MATERIALS });
    }
  });
});

describe('call captions on the real fixture', () => {
  it('every caption with a cite has its quote on the cited page; transcript matches', async () => {
    const { brain, events } = await build('honest');
    const g = golden.answerable[3]!;
    const lines = await brain.captions.run({
      callId: 'c1',
      courseId: 'demo',
      chapter: g.chapter,
      question: g.question,
    });
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines.some((l) => l.cite)).toBe(true);
    for (const l of lines) {
      if (!l.cite) continue;
      expect(
        quoteOnPage(l.cite.quote!, brain.store.getPage('demo', l.cite.file, l.cite.page!)!.text),
      ).toBe(true);
    }
    expect(brain.captions.transcript('c1')).toEqual(lines);
    expect(events.filter((e) => e.t === 'call.caption')).toHaveLength(lines.length);
  });

  it('planted wrong page: captions fall back to the single not-in-materials line', async () => {
    const { brain } = await build('wrong-page');
    const g = golden.answerable[0]!;
    const lines = await brain.captions.run({
      callId: 'c2',
      courseId: 'demo',
      chapter: g.chapter,
      question: g.question,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.cite).toBeUndefined();
    expect(lines[0]!.text).toMatch(/isn't in the materials/);
  });
});
