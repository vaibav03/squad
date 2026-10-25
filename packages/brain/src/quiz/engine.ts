import { randomUUID } from 'node:crypto';
import type { Db, Llm, StudentId, VillageEvent } from '@squad/core';
import { z } from 'zod';
import type { EmitEvent, MasteryStore } from '../mastery/types';
import { FEEDBACK, gradeChoice, gradeFreeExact } from './grading';
import { generateDrafts } from './generate';
import { ensureQuizSchema } from './schema';
import { nextPhase } from './state';
import {
  AnswerPayloadSchema,
  type AnswerFeedback,
  type AnswerPayload,
  type ChapterProvider,
  type KeyVerifier,
  type QuestionDraft,
  type QuizPayload,
  type QuizPhase,
  type QuizVia,
} from './types';

export interface QuizEngineOptions {
  db: Db;
  llm: Llm;
  emit: EmitEvent;
  mastery: MasteryStore;
  chapters: ChapterProvider;
  verifier?: KeyVerifier;
  now?: () => number;
  newId?: () => string;
  questionCount?: number;
  /** Squad setting: per-student `correct` goes into events only when true (default hidden). */
  squadSettings?: () => { revealCorrectness: boolean };
  /** After reveal, move on by itself (default true). Front ends may set false and call advance(). */
  autoAdvance?: boolean;
  /** Extra generation rounds to top up after the verifier drops questions. Default 2. */
  maxTopUps?: number;
}

export interface StartOptions {
  students: StudentId[];
  target?: StudentId;
}

export interface AnswerResult extends AnswerFeedback {
  accepted: true;
  /** false when the grader was unavailable: nothing recorded, the student may answer again. */
  graded: boolean;
  phase: QuizPhase;
}

interface RoundRow {
  quizId: string;
  courseId: string;
  chapter: string;
  via: QuizVia;
  target: string | null;
  students_json: string;
  phase: QuizPhase;
  idx: number;
  total: number;
}
interface ItemRow {
  kind: 'choice' | 'free';
  question: string;
  choices_json: string | null;
  key_json: string;
  explanation: string | null;
}

const GradeSchema = z.object({ correct: z.boolean(), feedback: z.string().default('') });

export class QuizEngine {
  private readonly db: Db;
  private readonly clock: () => number;
  private readonly count: number;

  constructor(private readonly o: QuizEngineOptions) {
    this.db = o.db;
    this.clock = o.now ?? Date.now;
    this.count = o.questionCount ?? 3;
    ensureQuizSchema(o.db);
  }

  private async emit(e: VillageEvent): Promise<void> {
    try {
      await this.o.emit(e);
    } catch (err) {
      console.warn('[quiz] emit failed', (err as Error).message);
    }
  }

  private round(quizId: string): RoundRow {
    const r = this.db.prepare('SELECT * FROM quiz_rounds WHERE quizId=?').get(quizId) as
      RoundRow | undefined;
    if (!r) throw new Error(`unknown quiz ${quizId}`);
    return r;
  }
  private item(quizId: string, idx: number): ItemRow {
    return this.db
      .prepare(
        'SELECT kind, question, choices_json, key_json, explanation FROM quiz_items WHERE quizId=? AND idx=?',
      )
      .get(quizId, idx) as ItemRow;
  }
  private setPhase(quizId: string, phase: QuizPhase, idx?: number) {
    if (idx === undefined)
      this.db.prepare('UPDATE quiz_rounds SET phase=? WHERE quizId=?').run(phase, quizId);
    else
      this.db
        .prepare('UPDATE quiz_rounds SET phase=?, idx=? WHERE quizId=?')
        .run(phase, idx, quizId);
  }
  private revealCorrect = () => this.o.squadSettings?.().revealCorrectness === true;

  phase(quizId: string): QuizPhase {
    return this.round(quizId).phase;
  }

  /** What GET /v1/quiz/:quizId returns for the current question. Never contains the key. */
  payload(quizId: string): QuizPayload {
    const r = this.round(quizId);
    const it = this.item(quizId, r.idx);
    return {
      quizId,
      chapter: r.chapter,
      index: r.idx,
      kind: it.kind,
      question: it.question,
      ...(it.choices_json ? { choices: JSON.parse(it.choices_json) as string[] } : {}),
    };
  }

  async start(
    courseId: string,
    chapter: string,
    via: QuizVia,
    opts: StartOptions = { students: [] },
  ): Promise<string> {
    const context = await this.o.chapters.chapterContext(courseId, chapter);
    if (!context.trim()) throw new Error(`no material for chapter ${chapter}`);
    const kept: QuestionDraft[] = [];
    const asked: string[] = [];
    for (
      let attempt = 0;
      attempt <= (this.o.maxTopUps ?? 2) && kept.length < this.count;
      attempt++
    ) {
      const need = this.count - kept.length;
      const drafts = await generateDrafts(
        this.o.llm,
        context,
        need + (attempt === 0 ? 1 : 0),
        asked,
      );
      for (const d of drafts) {
        if (kept.length >= this.count) break;
        asked.push(d.question);
        if (this.o.verifier) {
          const v = await this.o.verifier.verify(d, { courseId, chapter, chapterContext: context });
          if (!v.ok) continue; // uncertain key: dropped
        }
        kept.push(d);
      }
    }
    if (kept.length === 0) throw new Error(`could not produce a verified question for ${chapter}`);
    const quizId = (this.o.newId ?? (() => `q_${randomUUID().slice(0, 8)}`))();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO quiz_rounds(quizId, courseId, chapter, via, target, students_json, phase, idx, total, createdAt) VALUES(?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          quizId,
          courseId,
          chapter,
          via,
          opts.target ?? null,
          JSON.stringify(opts.students),
          'asking',
          0,
          kept.length,
          this.clock(),
        );
      const ins = this.db.prepare(
        'INSERT INTO quiz_items(quizId, idx, kind, question, choices_json, key_json, explanation, cite_json) VALUES(?,?,?,?,?,?,?,?)',
      );
      kept.forEach((d, i) =>
        ins.run(
          quizId,
          i,
          d.kind,
          d.question,
          d.choices ? JSON.stringify(d.choices) : null,
          JSON.stringify(d.key),
          d.explanation ?? null,
          d.cite ? JSON.stringify(d.cite) : null,
        ),
      );
    });
    tx();
    await this.pose(quizId);
    return quizId;
  }

  /**
   * The question prompt only (never choices, key or explanation), clipped to the event limit. Omitted
   * when a free-text key would leak through the stem.
   */
  private publicPrompt(quizId: string, idx: number): string | undefined {
    const it = this.item(quizId, idx);
    const stem = it.question.trim();
    if (!stem) return undefined;
    if (it.kind === 'free') {
      const key = String(JSON.parse(it.key_json)).trim().toLowerCase();
      if (key.length >= 3 && stem.toLowerCase().includes(key)) return undefined;
    }
    return stem.length > 600 ? `${stem.slice(0, 599)}…` : stem;
  }

  /** asking -> collecting, announcing the current question. */
  private async pose(quizId: string): Promise<void> {
    const r = this.round(quizId);
    this.setPhase(quizId, nextPhase(r.phase, 'posed'));
    const text = this.publicPrompt(quizId, r.idx);
    await this.emit({
      t: 'quiz.question',
      quizId,
      chapter: r.chapter,
      ...(text ? { text } : {}),
      ...(r.target ? { target: r.target } : {}),
    });
    await this.emit({
      t: 'agent.state',
      agent: `expert:${r.chapter}`,
      state: 'waiting_for_student',
    });
  }

  async answer(
    quizId: string,
    student: StudentId,
    input: AnswerPayload | string,
  ): Promise<AnswerResult> {
    const payload = AnswerPayloadSchema.parse(typeof input === 'string' ? { text: input } : input);
    const r = this.round(quizId);
    const students = JSON.parse(r.students_json) as StudentId[];
    if (students.length > 0 && !students.includes(student))
      throw new Error('student is not part of this quiz');
    if (r.phase !== 'collecting')
      throw new Error(`quiz is not collecting answers (phase: ${r.phase})`);
    const it = this.item(quizId, r.idx);
    const prior = this.db
      .prepare('SELECT correct, feedback FROM quiz_answers WHERE quizId=? AND idx=? AND student=?')
      .get(quizId, r.idx, student) as { correct: number | null; feedback: string } | undefined;
    if (prior && prior.correct !== null) {
      return {
        accepted: true,
        graded: true,
        correct: prior.correct === 1,
        feedback: prior.feedback,
        phase: r.phase,
      };
    }

    const graded = await this.grade(it, payload);
    const feedbackText = graded
      ? `${graded.correct ? FEEDBACK.right : FEEDBACK.wrong}${graded.feedback ? ` ${graded.feedback}` : ''}`
      : FEEDBACK.ungraded;
    this.db
      .prepare(
        'INSERT OR REPLACE INTO quiz_answers(quizId, idx, student, answer_json, correct, feedback, ts) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        quizId,
        r.idx,
        student,
        JSON.stringify(payload),
        graded ? (graded.correct ? 1 : 0) : null,
        feedbackText,
        this.clock(),
      );
    if (!graded)
      return {
        accepted: true,
        graded: false,
        correct: false,
        feedback: feedbackText,
        phase: r.phase,
      };

    await this.o.mastery.record(student, r.courseId, r.chapter, graded.correct, this.clock());
    await this.emit({
      t: 'quiz.answer',
      quizId,
      chapter: r.chapter,
      student,
      ...(r.target ? { target: r.target } : {}),
      ...(this.revealCorrect() ? { correct: graded.correct } : {}),
    });

    let phase: QuizPhase = r.phase;
    if (students.length > 0 && this.allAnswered(quizId, r.idx, students))
      phase = await this.reveal(quizId);
    return { accepted: true, graded: true, correct: graded.correct, feedback: feedbackText, phase };
  }

  private allAnswered(quizId: string, idx: number, students: StudentId[]): boolean {
    const n = (
      this.db
        .prepare(
          'SELECT COUNT(*) AS n FROM quiz_answers WHERE quizId=? AND idx=? AND correct IS NOT NULL',
        )
        .get(quizId, idx) as { n: number }
    ).n;
    return n >= students.length;
  }

  private async grade(
    it: ItemRow,
    p: AnswerPayload,
  ): Promise<{ correct: boolean; feedback: string } | null> {
    const key: unknown = JSON.parse(it.key_json);
    const expl = it.explanation ?? '';
    if (it.kind === 'choice') {
      if (!('choice' in p)) throw new Error('this question takes a choice');
      const n = (JSON.parse(it.choices_json ?? '[]') as string[]).length;
      if (p.choice >= n) throw new Error('choice out of range');
      return { correct: gradeChoice(p.choice, key as number), feedback: expl };
    }
    if (!('text' in p)) throw new Error('this question takes text');
    if (gradeFreeExact(p.text, String(key))) return { correct: true, feedback: expl };
    try {
      const g = await this.o.llm.json({
        model: 'fast',
        system:
          'You grade a short answer against a reference. The student must never see the reference. Feedback is one plain sentence with no score.',
        messages: `Question: ${it.question}\nReference answer: ${String(key)}\nStudent answer: ${p.text}\nReturn {"correct": boolean, "feedback": string}.`,
        schema: GradeSchema,
        temperature: 0,
      });
      return { correct: g.correct, feedback: g.feedback || expl };
    } catch (e) {
      console.warn('[quiz] grader unavailable', (e as Error).message);
      return null;
    }
  }

  /** collecting -> reveal. Public so a timeout hook can close a question early. */
  async reveal(quizId: string): Promise<QuizPhase> {
    const r = this.round(quizId);
    this.setPhase(quizId, nextPhase(r.phase, 'all_answered'));
    await this.emitResults(r);
    if (this.o.autoAdvance === false) return 'reveal';
    return this.advance(quizId);
  }

  private async emitResults(r: RoundRow) {
    const base = { chapter: r.chapter, ...(r.target ? { target: r.target } : {}) };
    if (!this.revealCorrect()) {
      await this.emit({ t: 'quiz.result', quizId: r.quizId, ...base });
      return;
    }
    const rows = this.db
      .prepare(
        'SELECT student, correct FROM quiz_answers WHERE quizId=? AND idx=? AND correct IS NOT NULL ORDER BY student',
      )
      .all(r.quizId, r.idx) as { student: string; correct: number }[];
    for (const a of rows) {
      await this.emit({
        t: 'quiz.result',
        quizId: r.quizId,
        ...base,
        student: a.student,
        correct: a.correct === 1,
      });
    }
  }

  /** reveal -> next -> asking -> collecting, or reveal -> done. */
  async advance(quizId: string): Promise<QuizPhase> {
    const r = this.round(quizId);
    if (r.idx + 1 >= r.total) {
      this.setPhase(quizId, nextPhase(r.phase, 'finish'));
      await this.emit({ t: 'agent.state', agent: `expert:${r.chapter}`, state: 'idle' });
      return 'done';
    }
    this.setPhase(quizId, nextPhase(r.phase, 'advance'));
    this.setPhase(quizId, nextPhase('next', 'advance'), r.idx + 1);
    await this.pose(quizId);
    return 'collecting';
  }
}
