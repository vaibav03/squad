import { randomUUID } from 'node:crypto';
import type { Db, Llm, StudentId } from '@squad/core';
import type { EmitEvent, MasteryStore } from '../mastery/types';
import { firstDivergence, llmEquiv, type Divergence, type EquivFn, type Step } from './align';
import { hashStep, privateDivergence } from './hash';
import { extractSteps, stepsFromText } from './vision';

export type DiffMode = 'full' | 'private';

export function ensureStepDiffSchema(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS diff_sessions(
    id TEXT PRIMARY KEY, chatId TEXT NOT NULL, courseId TEXT NOT NULL, chapter TEXT,
    mode TEXT NOT NULL, phase TEXT NOT NULL, work_json TEXT NOT NULL, ts INTEGER NOT NULL)`);
}

interface Work {
  hashes: string[];
  /** Absent in private mode: step text is never stored there. */
  steps?: Step[];
}
interface Row {
  id: string;
  chatId: string;
  courseId: string;
  chapter: string | null;
  mode: DiffMode;
  phase: 'open' | 'done';
  work_json: string;
}

const words = {
  split: (n: number) => `Step ${n} splits.`,
  defend: 'Defend your step.',
};

/**
 * The group-facing text. It states where the work agrees and where it splits. It never says who
 * is right and never contains the correct line.
 */
export function renderDiff(
  d: Divergence,
  names: { a: string; b: string },
  mode: DiffMode,
  agreed?: Step[],
): string {
  if (d.split === null) return `Your steps match all the way through (${d.matchedThrough} steps).`;
  const head =
    d.matchedThrough === 0
      ? `You differ from the first step. ${words.split(d.split)}`
      : `You agree through step ${d.matchedThrough}. ${words.split(d.split)}`;
  if (mode === 'private') return `${head} ${words.defend}`;
  const parts = [head];
  if (agreed && agreed.length > 0)
    parts.push(`Matching: ${agreed.map((s, i) => `${i + 1}. ${s.text}`).join('; ')}`);
  parts.push(`${names.a} wrote: ${d.stepA?.text ?? '(nothing yet)'}`);
  parts.push(`${names.b} wrote: ${d.stepB?.text ?? '(nothing yet)'}`);
  parts.push(words.defend);
  return parts.join('\n');
}

export type SubmitResult =
  | { status: 'waiting' }
  | { status: 'illegible'; message: string }
  | { status: 'full'; reason: string }
  | { status: 'done'; message: string; divergence: Divergence };

export interface StepDiffDeps {
  db: Db;
  llm: Llm;
  emit: EmitEvent;
  mastery?: MasteryStore;
  equiv?: EquivFn;
  now?: () => number;
  newId?: () => string;
}

export class StepDiffEngine {
  private readonly equiv: EquivFn;
  constructor(private readonly d: StepDiffDeps) {
    ensureStepDiffSchema(d.db);
    this.equiv = d.equiv ?? llmEquiv(d.llm);
  }

  private async emit(e: Parameters<EmitEvent>[0]) {
    try {
      await this.d.emit(e);
    } catch (err) {
      console.warn('[stepdiff] emit failed', (err as Error).message);
    }
  }

  open(chatId: string, courseId: string, mode: DiffMode = 'full', chapter?: string): string {
    const id = (this.d.newId ?? (() => `d_${randomUUID().slice(0, 8)}`))();
    this.d.db
      .prepare(
        'INSERT INTO diff_sessions(id, chatId, courseId, chapter, mode, phase, work_json, ts) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(id, chatId, courseId, chapter ?? null, mode, 'open', '{}', (this.d.now ?? Date.now)());
    return id;
  }

  /** Open session this student can add work to (the student is a member of the session's chat). */
  openFor(student: StudentId): { id: string; chatId: string } | undefined {
    return this.d.db
      .prepare(
        "SELECT s.id AS id, s.chatId AS chatId FROM diff_sessions s JOIN chat_members m ON m.chat_id = s.chatId WHERE m.student_id=? AND s.phase='open' ORDER BY s.ts DESC LIMIT 1",
      )
      .get(student) as { id: string; chatId: string } | undefined;
  }

  hasSubmitted(sessionId: string, student: StudentId): boolean {
    return student in (JSON.parse(this.row(sessionId).work_json) as Record<string, Work>);
  }

  private row(id: string): Row {
    const r = this.d.db.prepare('SELECT * FROM diff_sessions WHERE id=?').get(id) as
      Row | undefined;
    if (!r) throw new Error(`unknown diff session ${id}`);
    return r;
  }

  private nameOf(id: string): string {
    const r = this.d.db.prepare('SELECT name FROM students WHERE id=?').get(id) as
      { name: string } | undefined;
    return r?.name ?? id;
  }

  /** A student's photo (private DM). Falls back to a typed prompt when it cannot be read. */
  async submitPhoto(
    sessionId: string,
    student: StudentId,
    image: { path: string; mime: string },
  ): Promise<SubmitResult> {
    const r = await extractSteps(this.d.llm, image);
    if (!r.legible) {
      return {
        status: 'illegible',
        message:
          'I could not read that photo. Type your steps, one per line, or retake it flat and well lit.',
      };
    }
    return this.submitSteps(sessionId, student, r.steps);
  }

  async submitSteps(sessionId: string, student: StudentId, steps: Step[]): Promise<SubmitResult> {
    const s = this.row(sessionId);
    if (s.phase !== 'open') return { status: 'full', reason: 'This diff is already finished.' };
    const work = JSON.parse(s.work_json) as Record<string, Work>;
    if (!(student in work) && Object.keys(work).length >= 2)
      return { status: 'full', reason: 'Two people already sent their work.' };
    work[student] = {
      hashes: steps.map((x) => hashStep(x.text)),
      ...(s.mode === 'full' ? { steps } : {}),
    };
    this.d.db
      .prepare('UPDATE diff_sessions SET work_json=? WHERE id=?')
      .run(JSON.stringify(work), s.id);
    const who = Object.keys(work).sort();
    if (who.length < 2) return { status: 'waiting' };

    const [a, b] = who as [string, string];
    await this.emit({ t: 'agent.state', agent: 'dean', state: 'studying' });
    let divergence: Divergence;
    if (s.mode === 'private') {
      divergence = privateDivergence(work[a]!.hashes, work[b]!.hashes);
    } else {
      divergence = await firstDivergence(work[a]!.steps!, work[b]!.steps!, this.equiv);
    }
    const names = { a: this.nameOf(a), b: this.nameOf(b) };
    const agreed =
      s.mode === 'full' ? work[a]!.steps!.slice(0, divergence.matchedThrough) : undefined;
    const message = renderDiff(divergence, names, s.mode, agreed);
    this.d.db.prepare("UPDATE diff_sessions SET phase='done' WHERE id=?").run(s.id);
    // Labels only: no photos, no step text, no names of who wrote what.
    await this.emit({
      t: 'agent.message',
      from: 'dean',
      to: 'commons',
      taskId: s.id,
      kind: divergence.split === null ? 'step_diff_match' : 'step_diff_split',
      shared: divergence.split === null ? [] : [`step ${divergence.split}`],
    });
    // We never say who is wrong, so a diverging concept is queued for both people.
    if (divergence.split !== null && s.chapter && this.d.mastery) {
      await this.d.mastery.queueReview(a, s.courseId, s.chapter);
      await this.d.mastery.queueReview(b, s.courseId, s.chapter);
    }
    await this.emit({ t: 'agent.state', agent: 'dean', state: 'idle' });
    return { status: 'done', message, divergence };
  }

  chatOf(sessionId: string): string {
    return this.row(sessionId).chatId;
  }
}

export { stepsFromText };
