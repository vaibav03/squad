import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  FakeLlm,
  VillageEventSchema,
  type Ctx,
  type OutboundMessage,
  type VillageEvent,
} from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { createMasteryStore } from '../mastery/store';
import { msg } from '../quiz/testkit';
import { createStepDiffSkill } from '../skills/stepdiff/stepDiffSkill';
import { firstDivergence, type EquivFn, type Step } from './align';
import { canonicalStep, hashStep, privateDivergence } from './hash';
import { renderDiff, StepDiffEngine } from './session';
import { stepsFromText } from './vision';
import golden from './fixtures/golden.json';

interface Golden {
  name: string;
  a: string[];
  b: string[];
  equivalent: string[][];
  concept?: string;
  expectedSplit: number | null;
  expectedMatchedThrough: number;
  expectedFull?: string;
  expectedPrivate?: string;
  expectedPrivateSplit?: number;
}
const FIXTURES = golden as Golden[];
const toSteps = (xs: string[]): Step[] => xs.map((text) => ({ text }));

/** Deterministic oracle: equivalent iff canonical forms match or the pair is listed in the fixture. */
const oracleFor =
  (g: Golden): EquivFn =>
  async (x, y) => {
    const listed = g.equivalent.some(
      ([p, q]) => (p === x.text && q === y.text) || (p === y.text && q === x.text),
    );
    const same = canonicalStep(x.text) === canonicalStep(y.text);
    return { equivalent: listed || same, ...(g.concept ? { concept: g.concept } : {}) };
  };

describe('golden step diff fixtures', () => {
  for (const g of FIXTURES) {
    it(g.name, async () => {
      const d = await firstDivergence(toSteps(g.a), toSteps(g.b), oracleFor(g));
      expect(d.split).toBe(g.expectedSplit);
      expect(d.matchedThrough).toBe(g.expectedMatchedThrough);
      if (g.concept && d.split !== null) expect(d.concept).toBe(g.concept);
      const names = { a: 'Ana', b: 'Bo' };
      if (g.expectedFull) {
        expect(renderDiff(d, names, 'full', toSteps(g.a).slice(0, d.matchedThrough))).toBe(
          g.expectedFull,
        );
      }
      if (g.expectedPrivate) expect(renderDiff(d, names, 'private')).toBe(g.expectedPrivate);
      if (g.expectedPrivateSplit) {
        expect(privateDivergence(g.a.map(hashStep), g.b.map(hashStep)).split).toBe(
          g.expectedPrivateSplit,
        );
      }
    });
  }
});

describe('step diff properties', () => {
  const stepsArb = fc.array(
    fc.string({ minLength: 1, maxLength: 12 }).map((t) => ({ text: `s${t}` })),
    { maxLength: 8 },
  );
  const strict: EquivFn = async (x, y) => ({ equivalent: hashStep(x.text) === hashStep(y.text) });

  it('identical sequences never split', async () => {
    await fc.assert(
      fc.asyncProperty(stepsArb, async (xs) => {
        expect((await firstDivergence(xs, xs, strict)).split).toBeNull();
      }),
    );
  });
  it('a distinct step inserted at i splits at i+1 (1-based)', async () => {
    await fc.assert(
      fc.asyncProperty(stepsArb, fc.nat(8), async (xs, k) => {
        const i = Math.min(k, xs.length);
        const prefix = xs.slice(0, i);
        const a = [...prefix, { text: 'sAAA-unique' }, ...xs.slice(i)];
        const b = [...prefix, { text: 'sBBB-unique' }, ...xs.slice(i)];
        const d = await firstDivergence(a, b, strict);
        expect(d.split).toBe(i + 1);
        expect(d.matchedThrough).toBe(i);
      }),
    );
  });
  it('is symmetric in A and B up to swapping the split steps', async () => {
    await fc.assert(
      fc.asyncProperty(stepsArb, stepsArb, async (a, b) => {
        const x = await firstDivergence(a, b, strict);
        const y = await firstDivergence(b, a, strict);
        expect(x.split).toBe(y.split);
        expect(x.stepA).toEqual(y.stepB);
      }),
    );
  });
  it('a strict prefix splits at the first extra step', async () => {
    await fc.assert(
      fc.asyncProperty(stepsArb, fc.string({ minLength: 1 }), async (xs, extra) => {
        const d = await firstDivergence([...xs, { text: `e${extra}` }], xs, strict);
        expect(d.split).toBe(xs.length + 1);
      }),
    );
  });
  it('canonicalisation is idempotent and spacing/case invariant', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(canonicalStep(canonicalStep(s))).toBe(canonicalStep(s));
        expect(hashStep(`  ${s}  `)).toBe(hashStep(s));
      }),
    );
    expect(hashStep('X ^ 2 + 1')).toBe(hashStep('x^2+1'));
    expect(hashStep('x²')).toBe(hashStep('x^2'));
  });
  it('private divergence: first differing hash, no step text involved', () => {
    expect(privateDivergence(['a', 'b', 'c'], ['a', 'b', 'd'])).toEqual({
      matchedThrough: 2,
      split: 3,
    });
    expect(privateDivergence(['a'], ['a'])).toEqual({ matchedThrough: 1, split: null });
    expect(privateDivergence(['a', 'b'], ['a'])).toEqual({ matchedThrough: 1, split: 2 });
  });
  it('typed fallback parses numbered lines', () => {
    expect(stepsFromText('1. 2x=8\nStep 2: x=4\n\n')).toEqual([{ text: '2x=8' }, { text: 'x=4' }]);
  });
});

// ---- end to end through the engine and skill, photos via the vision role (FakeLlm) ----

const FORBIDDEN = /\b(correct|incorrect|wrong|right answer|should be|mistake)\b/i;

function flow(opts: { mode?: 'full' | 'private'; photos: object[] }) {
  const events: VillageEvent[] = [];
  const emit = (e: VillageEvent) => void events.push(e);
  const db = openMemoryDb();
  db.prepare(
    "INSERT INTO students(id, name, handle) VALUES('s_ana','Ana','1'),('s_bo','Bo','2')",
  ).run();
  db.prepare(
    "INSERT INTO chat_members(chat_id, student_id) VALUES('grp','s_ana'),('grp','s_bo')",
  ).run();
  const g = FIXTURES[0]!;
  const queue = [...opts.photos];
  const llm = new FakeLlm({
    fallback: (req) => {
      const sys = req.system ?? '';
      if (sys.includes('transcribe')) return queue.shift() ?? { legible: false, steps: [] };
      return { equivalent: false, concept: g.concept };
    },
  });
  const mastery = createMasteryStore({ db, emit, now: () => 9 });
  const engine = new StepDiffEngine({ db, llm, emit, mastery, newId: () => 'd1' });
  const sent: OutboundMessage[] = [];
  const ctx = { db, llm, send: async (o: OutboundMessage) => void sent.push(o) } as unknown as Ctx;
  const skill = createStepDiffSkill({ engine, courseIdFor: () => 'c', chapterFor: () => 'ch2' });
  const dir = mkdtempSync(join(tmpdir(), 'sd-'));
  const png = join(dir, 'p.png');
  writeFileSync(png, Buffer.from('89504e470d0a1a0a', 'hex'));
  const photoMsg = (from: string) =>
    msg({
      from,
      isGroup: false,
      mentionsBot: false,
      text: '',
      attachments: [{ path: png, mime: 'image/png' }],
    });
  return { events, db, llm, skill, ctx, sent, photoMsg, engine, mastery, mode: opts.mode };
}

const vis = (xs: string[]) => ({ legible: true, steps: xs.map((text) => ({ text })) });

describe('step diff skill flow', () => {
  it('two photos in -> group sees where it splits, no verdict, photos stay private', async () => {
    const g = FIXTURES[0]!;
    const t = flow({ photos: [vis(g.a), vis(g.b)] });
    const [open] = await t.skill.handle(msg({ chatId: 'grp', text: '@cubbie diff' }), t.ctx);
    expect(open!.text).toMatch(/DM me a photo/);
    expect(await t.skill.match(t.photoMsg('s_ana'), t.ctx)).toBeGreaterThan(0.8);
    const [w] = await t.skill.handle(t.photoMsg('s_ana'), t.ctx);
    expect(w!.text).toMatch(/Waiting/);
    expect(t.sent).toHaveLength(0);
    const [done] = await t.skill.handle(t.photoMsg('s_bo'), t.ctx);
    expect(done!.text).toMatch(/posted/);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]!.chatId).toBe('grp');
    expect(t.sent[0]!.text).toBe(g.expectedFull);
    expect(t.sent[0]!.text).not.toMatch(FORBIDDEN);
    expect(t.events.map((e) => e.t)).toEqual(['agent.state', 'agent.message', 'agent.state']);
    expect(t.events.find((e) => e.t === 'agent.message')).toMatchObject({
      kind: 'step_diff_split',
      shared: ['step 4'],
    });
    for (const e of t.events) {
      expect(VillageEventSchema.safeParse(e).success).toBe(true);
      expect(JSON.stringify(e)).not.toContain('f(x)');
    }
    // concept queued for review for both, via the mastery store (nextDue = now)
    expect(t.mastery.get('s_ana', 'c', 'ch2').nextDue).toBe(9);
    expect(t.mastery.get('s_bo', 'c', 'ch2').nextDue).toBe(9);
  });

  it('no LLM request ever asks for the correct line or a verdict', async () => {
    const g = FIXTURES[0]!;
    const t = flow({ photos: [vis(g.a), vis(g.b)] });
    await t.skill.handle(msg({ chatId: 'grp', text: '@cubbie diff' }), t.ctx);
    await t.skill.handle(t.photoMsg('s_ana'), t.ctx);
    await t.skill.handle(t.photoMsg('s_bo'), t.ctx);
    for (const c of t.llm.calls) {
      const sys = c.system ?? '';
      expect(sys).toMatch(/never|Do not/);
    }
  });

  it('private mode compares hashes: group message has no step text', async () => {
    const g = FIXTURES[0]!;
    const t = flow({ photos: [vis(g.a), vis(g.b)] });
    await t.skill.handle(msg({ chatId: 'grp', text: '@cubbie diff private' }), t.ctx);
    await t.skill.handle(t.photoMsg('s_ana'), t.ctx);
    await t.skill.handle(t.photoMsg('s_bo'), t.ctx);
    expect(t.sent[0]!.text).toBe(g.expectedPrivate);
    const row = t.db.prepare('SELECT work_json FROM diff_sessions').get() as { work_json: string };
    expect(row.work_json).not.toContain('f(x)'); // step text never stored in private mode
    // the equivalence oracle is not consulted in private mode
    expect(t.llm.calls.filter((c) => (c.system ?? '').includes('equivalence'))).toHaveLength(0);
  });

  it('unreadable photo falls back to typing; typed steps work', async () => {
    const g = FIXTURES[0]!;
    const t = flow({ photos: [{ legible: false, steps: [] }] });
    await t.skill.handle(msg({ chatId: 'grp', text: '@cubbie diff' }), t.ctx);
    const [bad] = await t.skill.handle(t.photoMsg('s_ana'), t.ctx);
    expect(bad!.text).toMatch(/could not read/);
    const typed = g.a.map((s, i) => `${i + 1}. ${s}`).join('\n');
    expect(
      await t.skill.match(
        msg({ from: 's_ana', isGroup: false, mentionsBot: false, text: typed }),
        t.ctx,
      ),
    ).toBeGreaterThan(0.7);
    const [ok] = await t.skill.handle(
      msg({ from: 's_ana', isGroup: false, mentionsBot: false, text: typed }),
      t.ctx,
    );
    expect(ok!.text).toMatch(/Waiting/);
  });

  it('a third person is turned away', async () => {
    const g = FIXTURES[0]!;
    const t = flow({ photos: [vis(g.a), vis(g.b)] });
    t.db.prepare("INSERT INTO chat_members(chat_id, student_id) VALUES('grp','s_cy')").run();
    const id = t.engine.open('grp', 'c');
    await t.engine.submitSteps(id, 's_ana', toSteps(g.a));
    await t.engine.submitSteps(id, 's_bo', toSteps(g.a.slice(0, 1)));
    const r = await t.engine.submitSteps(id, 's_cy', toSteps(g.a));
    expect(r.status).toBe('full');
  });
});
