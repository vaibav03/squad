import { openMemoryDb } from '@squad/core/node';
import type { VillageEvent } from '@squad/core';
import { QuizEngine, createMasteryStore, createQuizKeyVerifier, createCourseStore, loadFixtureCourse } from '@squad/brain';
import { clip } from '../lib/fx';
import type { Check } from '../lib/types';

const PUBLIC_FIELDS = new Set(['quizId', 'chapter', 'index', 'kind', 'question', 'choices']);

/** Quiz generation + council:quizkey verification through the real QuizEngine; the key never leaves the server. */
export const quizCheck: Check = {
  id: 4,
  name: 'quiz: generation, quiz-key council verification, key never leaks',
  needs: ['gemini'],
  estimate: { calls: 18, tokens: 14000 },
  async run(ctx, t) {
    const db = openMemoryDb();
    const store = createCourseStore(db);
    await loadFixtureCourse({ store }, 'demo');
    // Two pages of ch6 keep the 3 blind solvers x (opinion + ranking) affordable.
    const pages = store.getPages('demo', 'ch6').slice(1, 3);
    const material = pages.map((p) => `[${p.file} p.${p.page}] ${p.text}`).join('\n').slice(0, 5000);
    const events: VillageEvent[] = [];
    const emit = (e: VillageEvent) => void events.push(e);
    const councilEvents: VillageEvent[] = [];
    const engine = new QuizEngine({
      db,
      llm: ctx.llm,
      emit,
      mastery: createMasteryStore({ db, emit }),
      chapters: { chapterContext: async () => material },
      verifier: createQuizKeyVerifier({ llm: ctx.llm, emit: (e) => void councilEvents.push(e) }),
      questionCount: 2,
      maxTopUps: 0,
      autoAdvance: false,
    });
    let quizId = '';
    await t.step('generates questions and the council verifies at least one key', async () => {
      quizId = await engine.start('demo', 'ch6', 'village', { students: ['s_ana'] });
      const p = engine.payload(quizId);
      if (!p.question) throw new Error('empty question');
      const opinions = councilEvents.filter((e) => e.t === 'council.opinion').length;
      const ranks = councilEvents.filter((e) => e.t === 'council.rank').length;
      const verdicts = councilEvents.filter((e) => e.t === 'council.verdict').length;
      if (opinions < 3 || ranks < 3 || verdicts < 1) throw new Error(`council events opinions=${opinions} ranks=${ranks} verdicts=${verdicts}`);
      const dropped = councilEvents.filter((e) => e.t === 'council.verdict' && 'dissent' in e && e.dissent).length;
      t.metric('quiz-key verdicts', `${verdicts} questions checked, ${dropped} dropped for dissent`);
      return `kind=${p.kind}; ${clip(p.question, 100)}`;
    });
    if (!quizId) return;

    await t.step('the public payload and quiz events never carry the key or explanation', async () => {
      const p = engine.payload(quizId);
      const extra = Object.keys(p).filter((k) => !PUBLIC_FIELDS.has(k));
      if (extra.length) throw new Error(`payload has non-public field(s): ${extra.join(', ')}`);
      const rows = db.prepare('SELECT kind, key_json, explanation FROM quiz_items WHERE quizId=?').all(quizId) as { kind: string; key_json: string; explanation: string | null }[];
      if (rows.length === 0) throw new Error('no quiz_items stored');
      const wire = JSON.stringify([p, events]).toLowerCase();
      const leaks: string[] = [];
      for (const r of rows) {
        if (r.explanation && wire.includes(r.explanation.toLowerCase().slice(0, 40))) leaks.push('explanation');
        const key = JSON.parse(r.key_json) as unknown;
        if (r.kind === 'free' && typeof key === 'string' && key.length >= 4 && wire.includes(key.toLowerCase())) leaks.push(`free key "${clip(key, 30)}"`);
      }
      if (leaks.length) throw new Error(`leaked on the public wire: ${leaks.join(', ')}`);
      return `${rows.length} stored item(s); ${events.length} quiz event(s) checked; payload fields ${Object.keys(p).join(',')}`;
    });

    await t.step('council:quizkey events do not echo a free-text key or explanation', async () => {
      const rows = db.prepare('SELECT kind, key_json, explanation FROM quiz_items WHERE quizId=?').all(quizId) as { kind: string; key_json: string; explanation: string | null }[];
      const wire = JSON.stringify(councilEvents).toLowerCase();
      const leaks = rows.flatMap((r) => {
        const key = JSON.parse(r.key_json) as unknown;
        return r.kind === 'free' && typeof key === 'string' && key.length >= 4 && wire.includes(key.toLowerCase()) ? [`free key "${clip(key, 30)}"`] : [];
      });
      if (leaks.length) throw new Error(`solver text in public council events contains the key (${leaks.join(', ')}); route the verifier to a private emit (docs/live/FINDINGS.md F-04)`);
      return 'no free-text key in council events (choice keys are indexes; solver reasoning still names the right choice, see FINDINGS F-04)';
    });

    await t.step('answering grades privately and the round advances', async () => {
      const p = engine.payload(quizId);
      const res = await engine.answer(quizId, 's_ana', p.kind === 'choice' ? { choice: 0 } : { text: 'the standard deviation' });
      if (!res.accepted) throw new Error('answer not accepted');
      if (typeof res.feedback !== 'string') throw new Error('no feedback string');
      if (!res.graded) throw new Error('grader unavailable (graded=false)');
      return `correct=${res.correct} graded=${res.graded} phase=${res.phase}; feedback: ${clip(res.feedback, 100)}`;
    });
  },
};
