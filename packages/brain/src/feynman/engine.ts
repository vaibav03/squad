import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Db, Llm, StudentId } from '@squad/core';
import type { EmitEvent, MasteryStore } from '../mastery/types';
import type { ChapterProvider } from '../quiz/types';
import { verifyQuoteOnPage } from './quote';

export const FEYNMAN_PROMPT_VERSION = 'feynman-v1';
export const MAX_FOLLOWUPS = 2;
/** Village agent id of the Feynman Porch room (not the chapter house). */
export const FEYNMAN_AGENT = 'expert:feynman';

export interface MissedPoint {
  text: string;
  file: string;
  page: number;
  quote: string;
}

export interface FeynmanFeedback {
  accuracy: string;
  completeness: string;
  plainness: string;
  missedPoints: MissedPoint[];
}

export type FeynmanStep =
  | { kind: 'followup'; question: string; asked: number }
  | { kind: 'feedback'; feedback: FeynmanFeedback; text: string };

const FreshmanSchema = z.object({ question: z.string().nullable() });
const GraderSchema = z.object({
  accuracy: z.string(),
  completeness: z.string(),
  plainness: z.string(),
  missedPoints: z
    .array(
      z.object({ text: z.string(), file: z.string(), page: z.number().int(), quote: z.string() }),
    )
    .default([]),
});

export function ensureFeynmanSchema(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS feynman_sessions(
    id TEXT PRIMARY KEY, chatId TEXT NOT NULL, student TEXT NOT NULL, courseId TEXT NOT NULL,
    chapter TEXT NOT NULL, concept TEXT NOT NULL, turns_json TEXT NOT NULL, followups INTEGER NOT NULL,
    phase TEXT NOT NULL, ts INTEGER NOT NULL)`);
}

interface SessionRow {
  id: string;
  chatId: string;
  student: string;
  courseId: string;
  chapter: string;
  concept: string;
  turns_json: string;
  followups: number;
  phase: 'awaiting' | 'done';
}

/** Render feedback as plain text: prose and citations, never a number out of N, never points. */
export function renderFeedback(f: FeynmanFeedback): string {
  const lines = [
    `Accuracy: ${f.accuracy}`,
    `Completeness: ${f.completeness}`,
    `Plainness: ${f.plainness}`,
  ];
  if (f.missedPoints.length > 0) {
    lines.push('Worth adding:');
    for (const p of f.missedPoints) lines.push(`- ${p.text} (${p.file} p.${p.page})`);
  }
  return lines.join('\n');
}

export interface FeynmanDeps {
  db: Db;
  llm: Llm;
  emit: EmitEvent;
  mastery: MasteryStore;
  chapters: ChapterProvider;
  now?: () => number;
  newId?: () => string;
}

export class FeynmanEngine {
  constructor(private readonly d: FeynmanDeps) {
    ensureFeynmanSchema(d.db);
  }

  private async emit(agent: string, state: 'studying' | 'waiting_for_student' | 'idle') {
    try {
      await this.d.emit({ t: 'agent.state', agent, state });
    } catch (e) {
      console.warn('[feynman] emit failed', (e as Error).message);
    }
  }

  /** The open session for this student in this chat, if any. */
  active(chatId: string, student: StudentId): string | undefined {
    const r = this.d.db
      .prepare(
        "SELECT id FROM feynman_sessions WHERE chatId=? AND student=? AND phase='awaiting' ORDER BY ts DESC LIMIT 1",
      )
      .get(chatId, student) as { id: string } | undefined;
    return r?.id;
  }

  start(
    chatId: string,
    student: StudentId,
    courseId: string,
    chapter: string,
    concept: string,
  ): string {
    const id = (this.d.newId ?? (() => `f_${randomUUID().slice(0, 8)}`))();
    this.d.db
      .prepare(
        'INSERT INTO feynman_sessions(id, chatId, student, courseId, chapter, concept, turns_json, followups, phase, ts) VALUES(?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        chatId,
        student,
        courseId,
        chapter,
        concept,
        '[]',
        0,
        'awaiting',
        (this.d.now ?? Date.now)(),
      );
    void this.emit(FEYNMAN_AGENT, 'waiting_for_student');
    return id;
  }

  prompt(sessionId: string): string {
    return `Explain "${this.row(sessionId).concept}" in your own words, as if to a friend who has never seen it.`;
  }

  private row(id: string): SessionRow {
    const r = this.d.db.prepare('SELECT * FROM feynman_sessions WHERE id=?').get(id) as
      SessionRow | undefined;
    if (!r) throw new Error(`unknown feynman session ${id}`);
    return r;
  }

  /** The student's explanation or reply. Returns a naive follow-up (at most 2) or the final feedback. */
  async submit(sessionId: string, text: string): Promise<FeynmanStep> {
    const s = this.row(sessionId);
    if (s.phase !== 'awaiting') throw new Error('this check is finished');
    const turns = JSON.parse(s.turns_json) as { role: 'student' | 'freshman'; text: string }[];
    turns.push({ role: 'student', text });
    const agent = FEYNMAN_AGENT;
    await this.emit(agent, 'studying');

    if (s.followups < MAX_FOLLOWUPS) {
      const f = await this.d.llm
        .json({
          model: 'fast',
          system: `You are a confused freshman hearing a concept for the first time. Ask ONE short naive "why" question about something unclear, or null if it is already clear. Never explain the concept yourself. [prompt ${FEYNMAN_PROMPT_VERSION}]`,
          messages: `Concept: ${s.concept}\n${turns.map((t) => `${t.role}: ${t.text}`).join('\n')}\nReturn {"question": string|null}.`,
          schema: FreshmanSchema,
          temperature: 0,
        })
        .catch(() => ({ question: null }));
      if (f.question) {
        turns.push({ role: 'freshman', text: f.question });
        this.d.db
          .prepare('UPDATE feynman_sessions SET turns_json=?, followups=? WHERE id=?')
          .run(JSON.stringify(turns), s.followups + 1, s.id);
        await this.emit(agent, 'waiting_for_student');
        return { kind: 'followup', question: f.question, asked: s.followups + 1 };
      }
    }

    const context = await this.d.chapters.chapterContext(s.courseId, s.chapter);
    const raw = await this.d.llm.json({
      model: 'main',
      system: `You give feedback on a student's plain-language explanation. Cover accuracy, completeness and plainness in prose. No scores, grades, points or numbers out of N. List missed points only with a verbatim quote from the material and its file and page. [prompt ${FEYNMAN_PROMPT_VERSION}]`,
      messages: `Material:\n${context}\n\nConcept: ${s.concept}\nConversation:\n${turns.map((t) => `${t.role}: ${t.text}`).join('\n')}\nReturn {"accuracy","completeness","plainness","missedPoints":[{"text","file","page","quote"}]}.`,
      schema: GraderSchema,
      temperature: 0,
    });
    const missedPoints = raw.missedPoints.filter((p) =>
      verifyQuoteOnPage(context, p.file, p.page, p.quote),
    );
    const feedback: FeynmanFeedback = {
      accuracy: raw.accuracy,
      completeness: raw.completeness,
      plainness: raw.plainness,
      missedPoints,
    };
    this.d.db
      .prepare("UPDATE feynman_sessions SET turns_json=?, phase='done' WHERE id=?")
      .run(JSON.stringify(turns), s.id);
    // Feedback only: a chapter with gaps goes to the review queue; no score is derived.
    if (missedPoints.length > 0) await this.d.mastery.queueReview(s.student, s.courseId, s.chapter);
    await this.emit(agent, 'idle');
    return { kind: 'feedback', feedback, text: renderFeedback(feedback) };
  }
}
