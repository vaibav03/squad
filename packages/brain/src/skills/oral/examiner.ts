import { z } from 'zod';
import type { Llm, StudentId } from '@squad/core';
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
  fallbackSummary,
  feedbackLine,
  pickChapters,
  safeLine,
  type ExaminerLine,
  type QuestionNote,
} from './state';
import type { Chapter } from '../../ingest/types';

export interface OralDeps {
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
  const line = (text: string, c?: Chapter): ExaminerLine => {
    if (!c) return { text };
    const page = deps.store.getPages(deps.courseId, c.id)[0];
    return {
      text,
      ...(page
        ? { cite: { courseId: deps.courseId, chapter: c.id, file: page.file, page: page.page } }
        : {}),
    };
  };

  return {
    begin({ chapter }) {
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
        } catch {
          q = ''; // any LLM error (including "HTTP 402 credits depleted"): deterministic fallback, no retry
        }
        if (!q || asked.includes(q)) q = fallbackQuestion(c, asked.length ? idx : 0);
        asked.push(q);
        current = q;
        return [line(q, c)];
      }

      async function summary(): Promise<ExaminerLine[]> {
        finished = true;
        const lines: string[] = [];
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
        } catch {
          lines.length = 0;
          lines.push(...fallbackSummary(notes));
        }
        return [...lines.filter(Boolean), CLOSING_LINE].map((text) => ({ text }));
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
