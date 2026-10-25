import type { Ctx, InboundMessage, OutboundMessage, Skill, StudentId } from '@squad/core';
import type { QuizEngine } from '../../quiz/engine';
import type { AnswerPayload, QuizPayload } from '../../quiz/types';

export interface QuizSkillDeps {
  engine: QuizEngine;
  /** Who plays in this chat. Default: the asker only (DM) or the chat members from core `chat_members`. */
  studentsFor?: (m: InboundMessage, ctx: Ctx) => StudentId[];
  courseIdFor?: (m: InboundMessage, ctx: Ctx) => string;
}

const KEY = 'quiz.active';
const LETTERS = 'ABCDEF';

/** "ch3", "Chapter 3", "3" -> "ch3"; anything else is kept as typed. */
export function parseChapter(text: string): string | undefined {
  const m = /\bquiz(?:\s+me)?(?:\s+on)?\s+(.+?)\s*$/i.exec(text);
  const raw = m?.[1]?.trim();
  if (!raw) return undefined;
  const n = /^(?:ch(?:apter)?\.?\s*)?(\d+)$/i.exec(raw);
  return n ? `ch${n[1]}` : raw;
}

/** Chat text -> answer payload. Letters and 1-based digits address choices; anything else is text. */
export function parseAnswer(text: string, payload: QuizPayload): AnswerPayload | undefined {
  const t = text.replace(/^@\w+\s*/, '').trim();
  if (!t) return undefined;
  if (payload.kind === 'choice') {
    const n = payload.choices?.length ?? 0;
    const letter = /^([A-F])[).:]?$/i.exec(t);
    if (letter) {
      const i = LETTERS.indexOf(letter[1]!.toUpperCase());
      return i < n ? { choice: i } : undefined;
    }
    const digit = /^(\d)$/.exec(t);
    if (digit) {
      const i = Number(digit[1]) - 1;
      return i >= 0 && i < n ? { choice: i } : undefined;
    }
    const byText = payload.choices?.findIndex((c) => c.trim().toLowerCase() === t.toLowerCase());
    return byText !== undefined && byText >= 0 ? { choice: byText } : undefined;
  }
  return { text: t };
}

export function renderQuestion(p: QuizPayload): string {
  const lines = [`Q${p.index + 1}. ${p.question}`];
  p.choices?.forEach((c, i) => lines.push(`${LETTERS[i]}) ${c}`));
  lines.push(p.kind === 'choice' ? 'Reply with a letter.' : 'Reply with your answer.');
  return lines.join('\n');
}

function active(ctx: Ctx, chatId: string): string | undefined {
  const row = ctx.db
    .prepare("SELECT value_json FROM memory WHERE scope='chat' AND scope_id=? AND key=?")
    .get(chatId, KEY) as { value_json: string } | undefined;
  return row ? (JSON.parse(row.value_json) as string) : undefined;
}
function setActive(ctx: Ctx, chatId: string, quizId: string | null) {
  if (quizId === null) {
    ctx.db
      .prepare("DELETE FROM memory WHERE scope='chat' AND scope_id=? AND key=?")
      .run(chatId, KEY);
    return;
  }
  ctx.db
    .prepare(
      "INSERT INTO memory(scope, scope_id, key, value_json, ts) VALUES('chat', ?, ?, ?, ?) ON CONFLICT(scope, scope_id, key) DO UPDATE SET value_json=excluded.value_json, ts=excluded.ts",
    )
    .run(chatId, KEY, JSON.stringify(quizId), Date.now());
}

export function createQuizSkill(deps: QuizSkillDeps): Skill {
  const { engine } = deps;
  const studentsFor = (m: InboundMessage, ctx: Ctx): StudentId[] => {
    if (deps.studentsFor) return deps.studentsFor(m, ctx);
    if (!m.isGroup) return [m.from];
    const rows = ctx.db
      .prepare('SELECT student_id FROM chat_members WHERE chat_id=?')
      .all(m.chatId) as { student_id: string }[];
    return rows.length ? rows.map((r) => r.student_id) : [m.from];
  };
  const isStart = (m: InboundMessage) =>
    /\bquiz\b/i.test(m.text) && parseChapter(m.text) !== undefined;

  return {
    name: 'quiz',
    async match(m, ctx) {
      if (isStart(m) && (m.mentionsBot || !m.isGroup)) return 0.9;
      const quizId = active(ctx, m.chatId);
      if (!quizId || engine.phase(quizId) !== 'collecting') return 0;
      const p = engine.payload(quizId);
      const parsed = parseAnswer(m.text, p);
      if (!parsed) return 0;
      if ('choice' in parsed) return 0.85;
      return m.mentionsBot || !m.isGroup ? 0.85 : 0;
    },
    async handle(m, ctx) {
      const out = (text: string): OutboundMessage => ({ chatId: m.chatId, text });
      const quizId = active(ctx, m.chatId);
      if (quizId && !isStart(m) && engine.phase(quizId) === 'collecting') {
        const parsed = parseAnswer(m.text, engine.payload(quizId));
        if (!parsed)
          return [out(`I did not catch that. ${renderQuestion(engine.payload(quizId))}`)];
        const before = engine.payload(quizId).index;
        const cite = engine.citation(quizId, before);
        let res;
        try {
          res = await engine.answer(quizId, m.from, parsed);
        } catch (e) {
          return [out((e as Error).message)];
        }
        const replies: OutboundMessage[] = [];
        // The page the explanation was written from is cited as a marker: the web chat turns it into a chip (after the
        // hub checked the page exists) and iMessage shows it as plain text. Ungraded feedback cites nothing.
        const feedback =
          res.graded && cite ? `${res.feedback} [${cite.file} p.${cite.page}]` : res.feedback;
        if (m.isGroup) await ctx.dm(m.from, feedback);
        else replies.push(out(feedback));
        if (res.phase === 'done') {
          setActive(ctx, m.chatId, null);
          replies.push(out('That was the last question.'));
        } else if (res.phase === 'collecting' && engine.payload(quizId).index > before) {
          // everyone answered: the engine moved on, so the chat gets the next question
          replies.push({
            ...out(renderQuestion(engine.payload(quizId))),
            provenance: {
              label: `Question written from ${engine.payload(quizId).chapter} course material; the page is cited after you answer`,
            },
          });
        }
        return replies;
      }
      const chapter = parseChapter(m.text);
      if (!chapter) return [out('Which chapter? Try "quiz ch3".')];
      const courseId = deps.courseIdFor?.(m, ctx) ?? 'default';
      try {
        const id = await engine.start(courseId, chapter, 'imessage', {
          students: studentsFor(m, ctx),
        });
        setActive(ctx, m.chatId, id);
        return [
          {
            ...out(renderQuestion(engine.payload(id))),
            provenance: {
              label: `Question written from ${chapter} course material; the page is cited after you answer`,
            },
          },
        ];
      } catch (e) {
        return [out(`Could not start that quiz: ${(e as Error).message}`)];
      }
    },
  };
}
