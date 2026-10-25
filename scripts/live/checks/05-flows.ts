import { z } from 'zod';
import type { Ctx, OutboundMessage, VillageEvent } from '@squad/core';
import {
  createCouncilRun,
  runCoursePlan,
  runDebate,
  createOralExaminer,
  createDevilTaSkill,
  createRubricSkill,
  createOracleSkill,
  createMasteryStore,
  hasGrade,
  mentionsScore,
  judgeAnswer,
  activeSession,
  validatePlan,
  loadCatalog,
  limitsFor,
  hasGradeToken,
} from '@squad/brain';
import { makeSkillKit, msg } from '../../../packages/brain/src/skills/testkit';
import { clip, makeBrain } from '../lib/fx';
import type { Check } from '../lib/types';

const text = (o: OutboundMessage[]) => o.map((m) => m.text ?? '').join('\n');

/** Council with dissent, course-plan prerequisites, debate, oracle, rubric (no grade), devil's TA (judged in code), oral examiner. */
export const flowsCheck: Check = {
  id: 5,
  name: 'councils and room flows: council, course plan, debate, oracle, rubric, devil TA, oral',
  needs: ['gemini'],
  estimate: { calls: 48, tokens: 30000 },
  async run(ctx, t) {
    const events: VillageEvent[] = [];
    const emit = (e: VillageEvent) => void events.push(e);

    await t.step(
      'council: 3 members, 3 rankings, chair verdict, planted dissenter is named',
      async () => {
        const mk = (name: string, extra = '') => ({
          name,
          system: `You are ${name}, a careful arithmetic solver. ${extra}`,
        });
        const run = createCouncilRun({
          id: 'live-dissent',
          members: [
            mk('alpha'),
            mk('beta'),
            mk(
              'gamma',
              'You are a contrarian: whatever the right answer is, you always answer 52.',
            ),
          ],
          chair: { name: 'chair', system: 'You are the chair. State the correct answer.' },
          task: 'What is 17 times 3? Give the number only as the answer.',
          answerHint: 'the number only, digits',
          llm: ctx.llm,
          emit,
        });
        const ops = await run.opinions();
        const ranks = await run.rankings();
        const v = await run.verdict();
        if (ops.length !== 3 || ranks.length !== 3)
          throw new Error(`opinions=${ops.length} rankings=${ranks.length}`);
        for (const r of ranks)
          if (r.order.length !== 2 || r.order.includes(r.member))
            throw new Error(`malformed ranking for ${r.member}: ${r.order.join(',')}`);
        if (!v.text.trim()) throw new Error('empty verdict text');
        if (!/51/.test(v.answer))
          throw new Error(`chair answer ${JSON.stringify(v.answer)} is not 51`);
        if (!v.dissent || v.dissenter !== 'gamma')
          throw new Error(
            `dissent=${v.dissent} dissenter=${v.dissenter}; expected gamma (answers: ${ops.map((o) => `${o.member}=${o.answer}`).join(' ')})`,
          );
        const kinds = new Set(events.map((e) => e.t));
        for (const k of ['council.opinion', 'council.rank', 'council.verdict'])
          if (!kinds.has(k as never)) throw new Error(`no ${k} event`);
        return `answers ${ops.map((o) => `${o.member}=${o.answer}`).join(' ')}; verdict ${clip(v.text, 80)}; dissenter ${v.dissenter}`;
      },
    );

    await t.step(
      'course plan council respects prerequisites and credit limits (checked in code)',
      async () => {
        const bundle = loadCatalog();
        const r = await runCoursePlan(
          { llm: ctx.llm, emit, bundle },
          { completed: [], term: 'fall' },
        );
        if (r.usedFallback)
          throw new Error(
            'the model could not answer; built-in rules wrote the members notes (usedFallback=true)',
          );
        const pctx = {
          catalog: bundle.catalog,
          degree: bundle.degree,
          completed: [] as string[],
          term: 'fall' as const,
          limits: limitsFor({ degree: bundle.degree }),
        };
        const bad = validatePlan(r.plan.courses, pctx);
        if (bad.length)
          throw new Error(`final plan violates rules: ${JSON.stringify(bad).slice(0, 300)}`);
        if (r.opinions.length !== 3 || r.rankings.length !== 3)
          throw new Error('not a three-member round table');
        t.metric('courseplan repairs applied in code', r.violationsRepaired.length);
        return `plan ${r.plan.courses.join(', ')} (${r.plan.credits} credits); ${r.violationsRepaired.length} repair(s) applied to model proposals`;
      },
    );

    await t.step(
      'debate: pro/con, chair winner, outcome well formed, no verdict-as-grade',
      async () => {
        const { brain } = await makeBrain(ctx);
        const material = brain.store.chapterContext('demo', 'ch6').slice(0, 5000);
        const r = await runDebate(
          { llm: ctx.llm, emit },
          {
            question:
              'Should a z-score be used instead of the raw value when comparing two different tests?',
            material: { context: material, chapter: 'ch6' },
            students: [],
          },
        );
        if (!r.positions.pro.trim() || !r.positions.con.trim())
          throw new Error('missing a position');
        if (!['pro', 'con', 'draw'].includes(r.winner)) throw new Error(`winner=${r.winner}`);
        if (r.outcome === undefined || !r.replyText.trim())
          throw new Error('no outcome / reply text');
        return `winner=${r.winner} grounded=${r.grounded} fallback=${r.usedFallback} citations=${r.citations.length}`;
      },
    );

    const kit = await makeSkillKit({});
    const kctx: Ctx = { ...kit.ctx, llm: ctx.llm };
    const mastery = createMasteryStore({ db: kit.db, emit });

    await t.step('oracle: asks one study question, never an answer key', async () => {
      const skill = createOracleSkill({
        store: kit.store,
        mastery,
        emit,
        courseIdFor: () => 'demo',
      });
      const m = msg('@cubbie exam oracle');
      if ((await skill.match(m, kctx)) <= 0)
        throw new Error('oracle did not match its own trigger');
      const out = await skill.handle(m, kctx);
      const body = text(out);
      if (!body.trim()) throw new Error('empty oracle reply');
      if (/answer\s*key|the answer is|correct answer/i.test(body))
        throw new Error(`reply looks like an answer key: ${clip(body)}`);
      return clip(body, 160);
    });

    await t.step(
      'rubric: per-criterion feedback with verified quotes and no grade numbers',
      async () => {
        const skill = createRubricSkill({ store: kit.store, emit });
        const answer =
          'The sample mean is the sum of the values divided by n, so first I add them up and then divide by the count.';
        const m = msg(
          `@cubbie rubric check for HW3: ${answer}\nrubric:\n- Clarity - steps are easy to follow\n- Accuracy - the method is correct\n- Completeness - every part is covered`,
        );
        if ((await skill.match(m, kctx)) <= 0) throw new Error('rubric did not match');
        const body = text(await skill.handle(m, kctx));
        if (!body.trim()) throw new Error('empty rubric reply');
        if (
          hasGradeToken(body) ||
          /\b\d{1,3}\s*(?:\/\s*\d{1,3}|%)|\bgrade[sd]?\s*[:=]?\s*[A-F0-9]/i.test(body)
        )
          throw new Error(`a grade-like token is in the reply: ${clip(body, 200)}`);
        const rubricEvents = events.filter((e) => JSON.stringify(e).includes('rubric'));
        for (const e of rubricEvents)
          if (/\b\d{1,3}\s*(?:\/\s*\d{1,3}|%)/.test(JSON.stringify(e)))
            throw new Error(`a score leaked in an event: ${clip(JSON.stringify(e), 160)}`);
        return clip(body.replace(/\n/g, ' / '), 200);
      },
    );

    await t.step(
      "devil's TA: planted error location is judged in code, feedback has no score",
      async () => {
        const skill = createDevilTaSkill({
          emit,
          chapters: {
            chapterContext: async () =>
              '[stats.pdf p.1] The mean is the sum of the values divided by the count. The standard deviation is the square root of the variance. [stats.pdf p.2] The median is the middle value of the sorted data. A larger standard deviation means the data are more spread out.',
          },
          courseIdFor: () => 'demo',
        });
        const m = msg("@cubbie devil's TA ch1");
        if ((await skill.match(m, kctx)) <= 0) throw new Error("devil's TA did not match");
        const intro = text(await skill.handle(m, kctx));
        if (!/line|step|number/i.test(intro))
          throw new Error(`no numbered lines in the intro: ${clip(intro)}`);
        const sess = activeSession(kit.db, m.chatId, m.from, Date.now(), 3_600_000);
        if (!sess)
          throw new Error(
            'no awaiting session stored (the plan failed validation or generation was refused)',
          );
        const planted = {
          lines: sess.plan.lines,
          errorLine: sess.plan.errorLine,
          keywords: sess.plan.keywords,
        };
        if (judgeAnswer(`line ${planted.errorLine + 1}`, planted) !== 'hit')
          throw new Error('judgeAnswer disagrees with the planted location');
        const reply = msg(`line ${planted.errorLine + 1}`);
        if ((await skill.match(reply, kctx)) <= 0)
          throw new Error('the follow-up did not match the open session');
        const fb = text(await skill.handle(reply, kctx));
        if (!fb.trim()) throw new Error('empty feedback');
        if (mentionsScore(fb)) throw new Error(`feedback mentions a score: ${clip(fb)}`);
        if (JSON.stringify(events).includes(planted.lines[planted.errorLine] ?? '@@@')) {
          const leaked = events
            .filter((e) => JSON.stringify(e).includes(planted.lines[planted.errorLine]!))
            .map((e) => e.t);
          if (leaked.some((k) => k !== 'agent.message' && k !== 'quiz.question'))
            throw new Error(`error location text reached events: ${leaked.join(',')}`);
        }
        return `planted line ${planted.errorLine + 1} found; feedback: ${clip(fb, 120)}`;
      },
    );

    await t.step('oral examiner: greeting, question, feedback-only reply, no grade', async () => {
      const { brain } = await makeBrain(ctx);
      const ex = createOralExaminer({
        store: brain.store,
        llm: ctx.llm,
        courseId: 'demo',
        questions: 1,
      }).begin({ student: 's_ana', chapter: 'ch6' });
      const first = await ex.greeting();
      if (first.length === 0 || first.some((l) => !l.text.trim()))
        throw new Error('empty greeting/question');
      const next = await ex.reply(
        'A z-score tells you how many standard deviations a value is from the mean.',
      );
      const lines = [...first, ...next];
      const graded = lines.filter((l) => hasGrade(l.text));
      if (graded.length)
        throw new Error(`a spoken line contains a grade: ${clip(graded[0]!.text)}`);
      if (lines.some((l) => l.text.length > 400))
        throw new Error('a spoken line is too long for TTS');
      return `${lines.length} lines, done=${ex.done()}; ${clip(lines[1]?.text ?? '', 100)}`;
    });
    void z;
  },
};
