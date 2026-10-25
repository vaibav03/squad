import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { FakeLlm, VillageEventSchema, type Ctx, type VillageEvent } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { createMasteryStore } from '../mastery/store';
import { FeynmanEngine } from './engine';
import { splitPages, verifyQuote, verifyQuoteOnPage } from './quote';
import { createFeynmanSkill, parseFeynman } from '../skills/feynman/feynmanSkill';
import { msg } from '../quiz/testkit';

const CTX =
  '[ch3.pdf p.1] Gradient descent steps against the slope. [ch3.pdf p.2] The learning rate scales each step.';

function setup(opts: { followups?: (string | null)[]; graded?: object } = {}) {
  const events: VillageEvent[] = [];
  const emit = (e: VillageEvent) => void events.push(e);
  const db = openMemoryDb();
  const fu = [...(opts.followups ?? ['Why does it go against the slope?', null])];
  const llm = new FakeLlm({
    fallback: (req) => {
      if ((req.system ?? '').includes('confused freshman')) return { question: fu.shift() ?? null };
      return (
        opts.graded ?? {
          accuracy: 'Mostly accurate.',
          completeness: 'You skipped the learning rate.',
          plainness: 'Clear and plain.',
          missedPoints: [
            {
              text: 'The learning rate scales each step',
              file: 'ch3.pdf',
              page: 2,
              quote: 'learning rate scales each step',
            },
            { text: 'Invented', file: 'ch3.pdf', page: 1, quote: 'nothing like this on the page' },
          ],
        }
      );
    },
  });
  const mastery = createMasteryStore({ db, emit, now: () => 5 });
  const engine = new FeynmanEngine({
    db,
    llm,
    emit,
    mastery,
    chapters: { chapterContext: async () => CTX },
    newId: () => 'f1',
  });
  return { engine, events, db, mastery, llm };
}

describe('quote verification', () => {
  it('a substring of the context always verifies; strangers do not', () => {
    fc.assert(
      fc.property(fc.nat(CTX.length), fc.nat(CTX.length), (a, b) => {
        const [i, j] = [Math.min(a, b), Math.max(a, b)];
        const sub = CTX.slice(i, j);
        if (/[\p{L}\p{N}]/u.test(sub)) expect(verifyQuote(CTX, sub.toUpperCase())).toBe(true);
      }),
    );
    fc.assert(
      fc.property(fc.uuid(), (u) => {
        expect(verifyQuote(CTX, `zz${u}`)).toBe(false);
      }),
    );
    expect(verifyQuote(CTX, '   ')).toBe(false);
  });
  it('page-exact check rejects the right words on the wrong page', () => {
    expect(splitPages(CTX)).toHaveLength(2);
    expect(verifyQuoteOnPage(CTX, 'ch3.pdf', 2, 'learning rate')).toBe(true);
    expect(verifyQuoteOnPage(CTX, 'ch3.pdf', 1, 'learning rate')).toBe(false);
  });
});

describe('feynman engine', () => {
  it('asks at most 2 naive follow-ups, then gives feedback only, with verified citations', async () => {
    const t = setup({ followups: ['why 1?', 'why 2?', 'why 3?'] });
    const id = t.engine.start('chat', 's_a', 'c', 'ch3', 'gradient descent');
    expect(t.engine.prompt(id)).toMatch(/gradient descent/);
    const s1 = await t.engine.submit(id, 'it rolls downhill');
    expect(s1).toMatchObject({ kind: 'followup', asked: 1 });
    const s2 = await t.engine.submit(id, 'because slope');
    expect(s2).toMatchObject({ kind: 'followup', asked: 2 });
    const s3 = await t.engine.submit(id, 'ok');
    expect(s3.kind).toBe('feedback');
    if (s3.kind !== 'feedback') return;
    expect(s3.feedback.missedPoints).toHaveLength(1); // the invented quote is struck
    expect(s3.text).toContain('(ch3.pdf p.2)');
    expect(s3.text).not.toMatch(/\d+\s*\/\s*\d+|%|points?\b|score|grade/i);
    expect(t.mastery.get('s_a', 'c', 'ch3').box).toBe(1);
    expect(t.mastery.get('s_a', 'c', 'ch3').nextDue).toBe(5); // queued for review
    expect(t.engine.active('chat', 's_a')).toBeUndefined();
    for (const e of t.events) expect(VillageEventSchema.safeParse(e).success).toBe(true);
    expect(t.events.at(-1)).toMatchObject({ agent: 'expert:feynman', state: 'idle' });
    // the porch lights up, the chapter house does not
    const agents = t.events
      .filter((e) => e.t === 'agent.state')
      .map((e) => (e as { agent: string }).agent);
    expect(agents.length).toBeGreaterThan(0);
    expect(new Set(agents)).toEqual(new Set(['expert:feynman']));
    await expect(t.engine.submit(id, 'more')).rejects.toThrow(/finished/);
  });

  it('goes straight to feedback when the freshman has no question and nothing is missed', async () => {
    const t = setup({
      followups: [null],
      graded: {
        accuracy: 'Accurate.',
        completeness: 'Complete.',
        plainness: 'Plain.',
        missedPoints: [],
      },
    });
    const id = t.engine.start('chat', 's_a', 'c', 'ch3', 'x');
    const s = await t.engine.submit(id, 'full explanation');
    expect(s.kind).toBe('feedback');
    expect(t.mastery.forStudent('s_a', 'c')).toHaveLength(0);
    expect(t.events.some((e) => e.t === 'mastery.changed')).toBe(false);
  });
});

describe('feynman skill', () => {
  it('parses and runs a multi-turn session in a DM', async () => {
    expect(parseFeynman('feynman ch3 gradient descent')).toEqual({
      chapter: 'ch3',
      concept: 'gradient descent',
    });
    const t = setup({ followups: ['why?', null] });
    const skill = createFeynmanSkill({ engine: t.engine, courseIdFor: () => 'c' });
    const ctx = {} as Ctx;
    const dm = { isGroup: false, mentionsBot: false };
    expect(
      await skill.match(msg({ ...dm, text: 'feynman ch3 gradient descent' }), ctx),
    ).toBeGreaterThan(0.8);
    const [a] = await skill.handle(msg({ ...dm, text: 'feynman ch3 gradient descent' }), ctx);
    expect(a!.text).toMatch(/Explain "gradient descent"/);
    expect(await skill.match(msg({ ...dm, text: 'it goes downhill' }), ctx)).toBeGreaterThan(0.8);
    const [b] = await skill.handle(msg({ ...dm, text: 'it goes downhill' }), ctx);
    expect(b!.text).toBe('why?');
    const [c] = await skill.handle(msg({ ...dm, text: 'because the slope points up' }), ctx);
    expect(c!.text).toContain('Accuracy:');
    expect(await skill.match(msg({ ...dm, text: 'thanks' }), ctx)).toBe(0);
  });
});
