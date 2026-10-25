import {
  councilVerdictText,
  type CouncilResult,
  type InboundMessage,
  type OutboundMessage,
  type Skill,
} from '@squad/core';
import { stripMention } from '../../experts/intent';
import { CouncilBusyError, type CouncilService } from '../../councils/ask-types';

export const COUNCIL_USAGE =
  'Ask the council anything you are stuck on: "@cubbie council B or C?", "@cubbie council is this proof right?" or "@cubbie ask the council which approach to use for problem 3". Three members answer on their own, rank each other, and a chair gives one verdict.';
export const COUNCIL_BUSY = 'The council is still working on your last question. Give it a moment.';
export const COUNCIL_RATE =
  'You have asked the council a lot in the last hour. Try again a little later.';
export const COUNCIL_FOOTER = (id: string): string => `(council run ${id})`;

const EXPLICIT = /^\s*council\b[\s:,\-–—]*/i;
const NATURAL =
  /\b(?:ask|consult|convene|summon|put (?:it|this) to|take (?:it|this) to)\s+(?:the\s+)?council\b[\s:,\-–—]*/i;

/** The question after the trigger, or null when the message is not for the council. */
export function councilQuestion(text: string): string | null {
  const t = stripMention(text);
  const explicit = EXPLICIT.exec(t);
  if (explicit) return t.slice(explicit[0].length).trim();
  const natural = NATURAL.exec(t);
  if (natural) {
    const rest = (t.slice(0, natural.index) + ' ' + t.slice(natural.index + natural[0].length))
      .replace(/^\s*(?:please|pls|can you|could you|let'?s|hey)\b[\s,]*/i, '')
      .trim();
    return rest;
  }
  return null;
}

/** Plain-text reply for chat transports: the verdict, how each member answered, and the run id footer. */
export function formatCouncilReply(r: CouncilResult): string {
  const lines = [councilVerdictText(r)];
  if (r.status === 'done') {
    const said = r.members
      .filter((m) => m.status === 'answered')
      .map((m) => `${m.name}: ${m.answer}`);
    if (said.length) lines.push(`How they answered: ${said.join(' | ')}`);
  }
  lines.push(COUNCIL_FOOTER(r.id));
  return lines.join('\n');
}

export interface CouncilSkillOptions {
  courseId?: (m: InboundMessage) => string;
}

/**
 * `@cubbie council <question>` and natural "ask the council ...". Scores 0.97 when the bot is addressed, so it
 * beats the doubt skill; never reaches 0.8 without a mention (cannot speak unprompted).
 */
export function createCouncilSkill(service: CouncilService, opts: CouncilSkillOptions = {}): Skill {
  return {
    name: 'council',
    async match(m) {
      const q = councilQuestion(m.text);
      if (q === null) return 0;
      return m.mentionsBot ? 0.97 : 0.3;
    },
    async handle(m, ctx): Promise<OutboundMessage[]> {
      const question = councilQuestion(m.text);
      if (!question || question.length < 3) return [{ chatId: m.chatId, text: COUNCIL_USAGE }];
      try {
        const run = service.ask({
          question,
          askedBy: m.from,
          chatId: m.chatId,
          ...(opts.courseId ? { courseId: opts.courseId(m) } : {}),
        });
        // The run card goes out at once so the board can be opened and watched while the council works. The card
        // keeps itself current from the run; the closing text then needs no footer (and no second card).
        let early = false;
        try {
          if (typeof ctx?.send !== 'function') throw new Error('no early send');
          await ctx.send({
            chatId: m.chatId,
            text: 'The council is meeting. Open the board to watch who is asked what, step by step.',
            card: { type: 'council', runId: run.id },
          });
          early = true;
        } catch {
          // no early card: the closing reply carries the run footer as before
        }
        const r = await run.done;
        const text = formatCouncilReply(r);
        return [
          {
            chatId: m.chatId,
            text: early ? text.replace(/\n?\(council run cn_[a-z0-9]{12}\)\s*$/, '') : text,
          },
        ];
      } catch (e) {
        if (e instanceof CouncilBusyError)
          return [{ chatId: m.chatId, text: e.code === 'busy' ? COUNCIL_BUSY : COUNCIL_RATE }];
        return [
          {
            chatId: m.chatId,
            text: "I couldn't convene the council just now. Try again in a minute.",
          },
        ];
      }
    },
  };
}

export { councilVerdictText };
