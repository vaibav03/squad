import { z } from 'zod';
import { scripted, type AgentMode, type Llm, type StudentId } from '@squad/core';
import { fallbackMode, modeLabel, startMode, type ModeDeps } from '../mode-util';
import type { CourseStore } from '../../ingest/types';
import type { MasteryStore } from '../../mastery/types';
import { loadPrompt } from '../../experts/prompts';
import {
  CLOSING_LINE,
  CONTEXT_CHARS,
  DEFAULT_QUESTIONS,
  INTRO_LINE,
  NO_CHAPTERS_LINES,
  REPROMPT_LINE,
  SKIP_LINE,
  UNSURE_LINE,
  classifyReply,
  fallbackQuestion,
  fallbackSummaryScripted,
  feedbackLine,
  pickChapters,
  safeLine,
  type ExaminerLine,
  type QuestionNote,
} from './state';
import type { Chapter } from '../../ingest/types';

export interface OralDeps extends ModeDeps {
  store: CourseStore;
  llm: Llm;
  courseId: string;
  /** Accepted for wiring symmetry; the oral exam never reads or writes scores (feedback only). */
  mastery?: MasteryStore;
  now?: () => number;
  /** Questions per exam, default 3 (capped by MAX_QUESTIONS). */
  questions?: number;
}

export interface OralExaminer {
  greeting(): Promise<ExaminerLine[]>;
  reply(studentText: string): Promise<ExaminerLine[]>;
  done(): boolean;
}
export interface OralExaminerFactory {
  begin(args: { student: StudentId; chapter?: string }): OralExaminer;
}

const QuestionSchema = z.object({ question: z.string() });
const JudgeSchema = z.object({
  complete: z.boolean(),
  followUp: z.string().default(''),
  solid: z.string().default(''),
  revisit: z.string().default(''),
});
const SummarySchema = z.object({
  items: z.array(
    z.object({ index: z.number(), solid: z.string().default(''), revisit: z.string().default('') }),
  ),
});

export function createOralExaminer(deps: OralDeps): OralExaminerFactory {
  const prompts = {
    question: loadPrompt(import.meta.url, 'oral.question.md'),
    followup: loadPrompt(import.meta.url, 'oral.followup.md'),
    summary: loadPrompt(import.meta.url, 'oral.summary.md'),
  };

  const context = (chapterId: string): string => {
    try {
      return deps.store.chapterContext(deps.courseId, chapterId).slice(0, CONTEXT_CHARS);
    } catch {
      return '';
    }
  };
  const line = (text: string, c?: Chapter, mode?: AgentMode): ExaminerLine => {
    if (!c) return { text, ...(mode ? { mode } : {}) };
    const page = deps.store.getPages(deps.courseId, c.id)[0];
    return {
      text,
      ...(mode ? { mode } : {}),
      ...(page
        ? { cite: { courseId: deps.courseId, chapter: c.id, file: page.file, page: page.page } }
        : {}),
    };
  };

  return {
    begin({ chapter }) {
      const start: AgentMode = startMode(deps); // decided ONCE per exam
      let chapters: Chapter[] = [];
      try {
        chapters = pickChapters(
          deps.store.listChapters(deps.courseId),
          deps.questions ?? DEFAULT_QUESTIONS,
          chapter,
        );
      } catch {
        chapters = [];
      }
      const notes: QuestionNote[] = [];
      const asked: string[] = [];
      let idx = -1; // current question
      let current = '';
      let followUpUsed = false;
      let reprompted = false;
      let firstAnswer: string | undefined;
      let finished = chapters.length === 0;

      async function ask(): Promise<ExaminerLine[]> {
        idx += 1;
        followUpUsed = false;
        reprompted = false;
        firstAnswer = undefined;
        const c = chapters[idx]!;
        let q = '';
        let qErr: unknown;
        try {
          const r = await deps.llm.json({
            model: 'fast',
            messages: `${prompts.question}\n\nChapter: ${c.title}\n\nAlready asked:\n${
              asked.map((a) => `- ${a}`).join('\n') || '(none)'
            }\n\nChapter text:\n${context(c.id)}\n\nRespond as JSON.`,
            schema: QuestionSchema,
            temperature: 0.3,
          });
          q = safeLine(r.question);
        } catch (e) {
          qErr = e;
          q = ''; // any LLM error (including "HTTP 402 credits depleted"): deterministic fallback, no retry
        }
        if (q && !asked.includes(q)) {
          asked.push(q);
          current = q;
          return [line(q, c, start)];
        }
        const fm = fallbackMode(start, qErr);
        q = scripted(fallbackQuestion(c, asked.length ? idx : 0), fm).text;
        asked.push(q);
        current = q;
        return [line(`${modeLabel(fm)}${q}`, c, fm)];
      }

      async function summary(): Promise<ExaminerLine[]> {
        finished = true;
        const lines: string[] = [];
        let sumMode: AgentMode = start;
        try {
          const r = await deps.llm.json({
            model: 'fast',
            messages: `${prompts.summary}\n\nNotes:\n${notes
              .map(
                (n, i) =>
                  `${i}. Chapter "${n.title}". Question: ${n.question} Outcome: ${n.outcome}.${
                    n.answer ? ` Student said: ${n.answer.slice(0, 600)}` : ''
                  }`,
              )
              .join('\n')}\n\nRespond as JSON.`,
            schema: SummarySchema,
            temperature: 0.2,
          });
          for (const [i, n] of notes.entries()) {
            const it = r.items.find((x) => x.index === i);
            lines.push(feedbackLine(n, it?.solid || n.solid || '', it?.revisit || n.revisit || ''));
          }
        } catch (e) {
          lines.length = 0;
          const fm = fallbackMode(start, e);
          sumMode = fm;
          lines.push(...fallbackSummaryScripted(notes, fm));
          if (lines[0]) lines[0] = `${modeLabel(sumMode)}${lines[0]}`;
        }
        return [...lines.filter(Boolean), CLOSING_LINE].map((text) => ({ text, mode: sumMode }));
      }

      async function advance(prefix: string[] = []): Promise<ExaminerLine[]> {
        const head = prefix.map((text) => ({ text }));
        if (idx + 1 < chapters.length) return [...head, ...(await ask())];
        return [...head, ...(await summary())];
      }

      function note(outcome: QuestionNote['outcome'], extra: Partial<QuestionNote> = {}): void {
        const c = chapters[idx]!;
        notes.push({ chapterId: c.id, title: c.title, question: current, outcome, ...extra });
      }

      return {
        async greeting() {
          if (finished) return NO_CHAPTERS_LINES.map((text) => ({ text }));
          return [{ text: INTRO_LINE }, ...(await ask())];
        },

        async reply(studentText) {
          if (finished || idx < 0) return [];
          const kind = classifyReply(studentText);
          const c = chapters[idx]!;
          if (kind === 'repeat') return [line(current, c)];
          if (kind === 'skip') {
            note('skipped');
            return advance([SKIP_LINE]);
          }
          if (kind === 'unsure') {
            note('unsure');
            return advance([UNSURE_LINE]);
          }
          if (kind === 'empty' || kind === 'short') {
            if (!reprompted) {
              reprompted = true;
              return [{ text: REPROMPT_LINE }];
            }
            note('unsure', firstAnswer ? { answer: firstAnswer } : {});
            return advance([UNSURE_LINE]);
          }

          const answer = studentText.trim().slice(0, 1000);
          const wholeAnswer = firstAnswer ? `${firstAnswer} ${answer}` : answer;
          let judged: z.infer<typeof JudgeSchema> | undefined;
          try {
            judged = await deps.llm.json({
              model: 'fast',
              messages: `${prompts.followup}\n\nFollow-up already used: ${followUpUsed}\n\nChapter: ${c.title}\nQuestion: ${current}\nStudent said: ${wholeAnswer}\n\nChapter text:\n${context(c.id)}\n\nRespond as JSON.`,
              schema: JudgeSchema,
              temperature: 0,
            });
          } catch {
            judged = undefined; // no follow-up on failure; the summary falls back to the template
          }
          if (judged && !judged.complete && !followUpUsed) {
            const f = safeLine(judged.followUp);
            if (f) {
              followUpUsed = true;
              firstAnswer = answer;
              current = f;
              return [line(f, c)];
            }
          }
          note('answered', {
            answer: wholeAnswer,
            ...(judged?.solid ? { solid: judged.solid } : {}),
            ...(judged?.revisit ? { revisit: judged.revisit } : {}),
          });
          return advance();
        },

        done: () => finished,
      };
    },
  };
}
