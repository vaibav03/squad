// `@cubbie study plan for the exam on <date>` in a group creates a shared plan; numbered replies and `done <item>` update it.
// The group never waits on a private DM: a progress line goes out first, then the card or a clear error.
import {
  parseDoneReport,
  parseExamDate,
  parsePlanReply,
  type Ctx,
  type InboundMessage,
  type OutboundMessage,
  type Skill,
} from '@squad/core';
import type { PlanPort, PlanSayOut } from './port';

const PLAN_ASK =
  /\b(?:study\s*plan|plan\s+(?:the\s+|our\s+|my\s+)?(?:midterm|final|exam)|plan\s+(?:for\s+)?(?:the\s+)?(?:midterm|final|exam))\b/i;
const EXAM_CLAUSE = /\b(?:exam|midterm|final)\b[^?!.\n]*?\b(?:on|by|in|at|is)\s+([^?!.\n]+)/i;
const ON_CLAUSE = /\b(?:on|by)\s+([^?!.\n]+)$/i;
const DATEISH = /\d|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|mon|tue|wed|thu|fri|sat|sun|week|day)/i;
const TIMEOUT_MS = 20_000;

const groupSquad = (chatId: string) => (chatId.startsWith('group:') ? chatId.slice(6) : undefined);

export interface SharedPlanSkillDeps {
  plans: PlanPort;
  now?: () => number;
  timeoutMs?: number;
}

export function createSharedPlanSkill(deps: SharedPlanSkillDeps): Skill {
  const now = deps.now ?? Date.now;
  const squadOf = (m: InboundMessage, ctx: Ctx): string | undefined => {
    const g = groupSquad(m.chatId);
    if (g) return g;
    // DM: the student's squad via chat_members of any group chat they belong to
    const r = ctx.db
      .prepare("SELECT chat_id FROM chat_members WHERE student_id=? AND chat_id LIKE 'group:%' LIMIT 1")
      .get(m.from) as { chat_id: string } | undefined;
    return r ? groupSquad(r.chat_id) : undefined;
  };
  const stateOf = (m: InboundMessage, ctx: Ctx) => {
    const sq = squadOf(m, ctx);
    return sq ? deps.plans.state(m.from, sq) : undefined;
  };

  return {
    name: 'sharedPlan',
    async match(m, ctx) {
      const addressed = m.mentionsBot || !m.isGroup;
      if (addressed && (PLAN_ASK.test(m.text) || /@planner\b.*\bplan\b/i.test(m.text))) return 0.97;
      const reply = parsePlanReply(m.text);
      const done = parseDoneReport(m.text);
      if (!reply && !done) return 0;
      const st = stateOf(m, ctx);
      if (!st) return 0;
      if (reply) {
        if (reply.kind === 'show') return addressed && (st.proposed || st.active) ? 0.96 : 0;
        // unaddressed group replies only count while a plan is waiting on someone
        return addressed || st.proposed ? 0.96 : 0;
      }
      if (done) return st.ownsOpen(done.ref) ? 0.96 : addressed && st.active ? 0.9 : 0;
      return 0;
    },
    async handle(m, ctx): Promise<OutboundMessage[]> {
      const squadId = squadOf(m, ctx);
      const say = (o: PlanSayOut): OutboundMessage[] => [
        { chatId: m.chatId, text: o.text, ...(o.card ? { card: o.card } : {}) },
      ];
      if (!squadId)
        return [{ chatId: m.chatId, text: 'I could not find your squad chat, so I cannot plan yet.' }];

      const done = parseDoneReport(m.text);
      const reply = parsePlanReply(m.text);
      const asking = PLAN_ASK.test(m.text) || /@planner\b.*\bplan\b/i.test(m.text);

      const guard = async <T>(p: Promise<T>): Promise<T | 'timeout'> => {
        let t: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            p,
            new Promise<'timeout'>((r) => {
              t = setTimeout(() => r('timeout'), deps.timeoutMs ?? TIMEOUT_MS);
            }),
          ]);
        } finally {
          if (t) clearTimeout(t);
        }
      };
      const TIMEOUT_TEXT =
        'The plan is taking longer than it should, so I stopped waiting. Nothing was changed. Please try again in a minute.';

      try {
        if (reply && !(asking && reply.kind === 'show')) {
          const out = await guard(deps.plans.reply(m.from, squadId, reply));
          if (out === 'timeout') return [{ chatId: m.chatId, text: TIMEOUT_TEXT }];
          if (out.privateText) await ctx.dm(m.from, out.privateText);
          return out.text ? say(out) : [{ chatId: m.chatId, text: 'Nothing changed.' }];
        }
        if (done && !asking) {
          const out = await guard(deps.plans.done(m.from, squadId, done.ref));
          if (out === 'timeout') return [{ chatId: m.chatId, text: TIMEOUT_TEXT }];
          return say(out);
        }
        // propose
        if (!m.isGroup) {
          const note =
            'Study plans are shared with your whole squad, so start one in the squad chat: "@cubbie study plan for the exam on Nov 4". Here I can show your own part: say "show plan".';
          return [{ chatId: m.chatId, text: note }];
        }
        const clause = EXAM_CLAUSE.exec(m.text)?.[1] ?? ON_CLAUSE.exec(m.text)?.[1];
        const examDate = clause ? parseExamDate(clause, m.ts || now()) : undefined;
        if (clause && !examDate && DATEISH.test(clause))
          return [
            {
              chatId: m.chatId,
              text: `I could not read "${clause.trim()}" as a date. Try "@cubbie study plan for the exam on Nov 4" or an ISO date like 2026-11-04.`,
            },
          ];
        // progress first, so the group never sits on "thinking" with nothing to read
        await ctx.send({
          chatId: m.chatId,
          text: 'On it. Building a shared study plan from the course materials and due dates. I will post it here for everyone to accept.',
        });
        const out = await guard(
          deps.plans.propose(m.from, squadId, examDate ? { examDate } : {}),
        );
        if (out === 'timeout') return [{ chatId: m.chatId, text: TIMEOUT_TEXT }];
        if (out.privateText) await ctx.dm(m.from, out.privateText);
        return say(out);
      } catch {
        return [
          {
            chatId: m.chatId,
            text: 'Something went wrong while handling the study plan. Nothing was changed. Please try again.',
          },
        ];
      }
    },
  };
}
