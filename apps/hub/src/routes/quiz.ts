import { Hono } from 'hono';
import { z } from 'zod';
import { requireViewer } from '../auth';
import type { HubApp, HubDeps, HubEnv } from '../types';

const Answer = z
  .strictObject({
    choice: z.string().min(1).max(64).optional(),
    text: z.string().min(1).max(2000).optional(),
  })
  .refine(
    (a) => (a.choice === undefined) !== (a.text === undefined),
    'exactly one of choice or text',
  );

export function createQuizRoutes(deps: HubDeps): HubApp {
  const r = new Hono<HubEnv>();
  const need = requireViewer(deps);

  r.get('/v1/quiz/:quizId', need, async (c) => {
    const q = await deps.ports.quiz.get(c.req.param('quizId'), c.get('viewer').studentId);
    if (!q) return c.json({ error: { code: 'not_found' } }, 404);
    // Explicit allow-list so an adapter returning extra fields (an answer key) can never leak.
    return c.json({
      quizId: q.quizId,
      chapter: q.chapter,
      question: q.question,
      ...(q.choices ? { choices: q.choices.map((x) => ({ id: x.id, text: x.text })) } : {}),
    });
  });

  r.post('/v1/quiz/:quizId/answer', need, async (c) => {
    const viewer = c.get('viewer');
    const parsed = Answer.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    const quizId = c.req.param('quizId');
    const res = await deps.ports.quiz.answer(quizId, viewer.studentId, parsed.data);
    if (!res) return c.json({ error: { code: 'not_found' } }, 404);
    if (res.correct === undefined && res.explanation === undefined)
      return c.json({ error: { code: 'already_answered' }, recorded: true }, 409);
    deps.ingest.village({
      t: 'quiz.answer',
      quizId,
      chapter: res.chapter,
      student: viewer.studentId,
    });
    deps.ingest.village({
      t: 'quiz.result',
      quizId,
      chapter: res.chapter,
      student: viewer.studentId,
      ...(res.correct !== undefined ? { correct: res.correct } : {}),
    });
    const reveal = deps.directory.settings(viewer.squadId).revealQuizCorrectness;
    return c.json({
      recorded: true,
      ...(reveal && res.correct !== undefined ? { correct: res.correct } : {}),
      ...(reveal && res.explanation !== undefined ? { explanation: res.explanation } : {}),
    });
  });

  return r;
}
