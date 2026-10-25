import type { Ctx, InboundMessage, Llm, OutboundMessage, Skill, StudentId } from '@squad/core';
import type { EmitEvent } from '../../mastery/types';
import { stripMention } from '../../experts/intent';
import { parseVoteAnswer, runDebate, type DebateMaterial } from './debate';

export interface DebateSkillDeps {
  emit: EmitEvent;
  /** Falls back to `ctx.llm`. */
  llm?: Llm;
  /**
   * Course material relevant to the question (a `[file p.N]` joined context), or undefined when the
   * question is not about the course. Failures must be swallowed by the caller or throw: both mean
   * "no material" here.
   */
  materialFor?: (
    question: string,
    m: InboundMessage,
    ctx: Ctx,
  ) => Promise<DebateMaterial | undefined>;
  /** Who votes. Default: the chat members from core `chat_members`, or the asker alone. */
  studentsFor?: (m: InboundMessage, ctx: Ctx) => StudentId[];
  /** How long to wait for a vote before it counts as no vote. Default 90 s. */
  voteTimeoutMs?: number;
  now?: () => number;
}

export const DEFAULT_VOTE_TIMEOUT_MS = 90_000;

/**
 * "debate <question>" (a real question: at least 3 words, or after a colon) and "debate this".
 * Anchored at the start of the message (after the bot mention): "we should debate that" is banter.
 */
const DEBATE_THIS = /^debate\s+(?:this|that|it)\s*[.!?]*$/i;
const QUESTIONY =
  /\?|^(?:should|is|are|does|do|can|could|will|would|whether|which|why|how|what|who|if)\b|\b(?:vs\.?|versus|or)\b/i;
const DEBATE_Q = /^debate\s*(?:[:\-,]\s*|\s+)(.{3,})$/i;

export type DebateRequest = { kind: 'question'; question: string } | { kind: 'this' };

export function parseDebate(text: string): DebateRequest | undefined {
  const t = stripMention(text).replace(/\s+/g, ' ').trim();
  if (DEBATE_THIS.test(t)) return { kind: 'this' };
  const m = DEBATE_Q.exec(t);
  if (!m) return undefined;
  const q = m[1]!.trim();
  const colon = /^debate\s*[:\-,]/i.test(t);
  // Without a colon it must read as a debatable question, not a noun phrase ("debate club is at 5").
  if (!colon && !(q.split(' ').length >= 3 && QUESTIONY.test(q))) return undefined;
  return { kind: 'question', question: q.slice(0, 300) };
}

/** The last real message in the chat before this one (for "debate this"), never a debate trigger. */
export function recentTopic(ctx: Ctx, m: InboundMessage): string | undefined {
  try {
    const rows = ctx.db
      .prepare(
        "SELECT text FROM messages WHERE chat_id=? AND from_id!='bot' AND ts<=? AND text IS NOT NULL ORDER BY id DESC LIMIT 8",
      )
      .all(m.chatId, m.ts) as { text: string }[];
    for (const r of rows) {
      const t = stripMention(r.text).trim();
      if (t.split(/\s+/).length >= 4 && !parseDebate(r.text)) return t.slice(0, 300);
    }
  } catch {
    /* no messages table (unit tests) */
  }
  return undefined;
}

export function createDebateSkill(deps: DebateSkillDeps): Skill {
  const students = (m: InboundMessage, ctx: Ctx): StudentId[] => {
    if (deps.studentsFor) return deps.studentsFor(m, ctx);
    if (!m.isGroup) return [m.from];
    try {
      const rows = ctx.db
        .prepare('SELECT student_id FROM chat_members WHERE chat_id=?')
        .all(m.chatId) as { student_id: string }[];
      if (rows.length) return rows.map((r) => r.student_id);
    } catch {
      /* fall through */
    }
    return [m.from];
  };

  return {
    name: 'debate',
    async match(m: InboundMessage) {
      // Addressed (mention) or a DM only; 0.95 so the doubt skill (0.9 on a question) does not take it.
      if (!(m.mentionsBot || !m.isGroup)) return 0;
      return parseDebate(m.text) ? 0.95 : 0;
    },
    async handle(m: InboundMessage, ctx: Ctx): Promise<OutboundMessage[]> {
      const out = (text: string): OutboundMessage[] => [{ chatId: m.chatId, text }];
      const req = parseDebate(m.text);
      if (!req)
        return out('What should we debate? Try "@cubbie debate should exams be open book?".');
      const question = req.kind === 'question' ? req.question : recentTopic(ctx, m);
      if (!question)
        return out('Debate what? Say "@cubbie debate <question>" and I will set up both sides.');

      let material: DebateMaterial | undefined;
      try {
        material = await deps.materialFor?.(question, m, ctx);
      } catch {
        material = undefined; // honest fallback: a general debate, labelled as such
      }
      const timeout = deps.voteTimeoutMs ?? DEFAULT_VOTE_TIMEOUT_MS;
      const askVote = async (student: StudentId, prompt: string, options: [string, string]) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const answer = await Promise.race([
            ctx.askConfirm(student, prompt, options, `debate:${m.chatId}:${m.ts}:${student}`),
            new Promise<string>((res) => {
              timer = setTimeout(() => res('timeout'), timeout);
            }),
          ]);
          return parseVoteAnswer(answer, options);
        } catch {
          return 'none' as const;
        } finally {
          if (timer) clearTimeout(timer);
        }
      };

      try {
        const res = await runDebate(
          { llm: deps.llm ?? ctx.llm, emit: deps.emit },
          {
            question,
            ...(material ? { material } : {}),
            students: students(m, ctx),
            askVote,
            onArguments: async ({ pro, con, positions }) => {
              await ctx.send({
                chatId: m.chatId,
                text: `Debate on the stage: ${question}\nFor (${positions.pro}): ${pro}\nAgainst (${positions.con}): ${con}\nI am DMing each of you a vote.`,
              });
            },
          },
        );
        // The arguments already went to chat; the final message is the vote, verdict and dissent.
        return out(res.closingText);
      } catch (e) {
        return out(
          `I could not run that debate just now (${(e as Error).message.slice(0, 80)}). Try again in a minute.`,
        );
      }
    },
  };
}
