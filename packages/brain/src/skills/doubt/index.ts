import type { ChatCitation, InboundMessage, OutboundMessage, Skill } from '@squad/core';
import {
  isBehindIntent,
  isGradedGrab,
  looksLikeQuestion,
  stripMention,
} from '../../experts/intent';
import { NOT_IN_MATERIALS, type Brain } from '../../experts/types';

export const UNAVAILABLE_TEXT =
  "I couldn't reach the course brain just now. Try again in a minute.";

export interface DoubtOptions {
  courseId?: (m: InboundMessage) => string;
  /**
   * The asker as a context viewer (squad membership verified by the caller). With it, the doubt is also answered
   * from the asker's own and squad-shared Canvas/Drive sources and cites them. Absent: unchanged behaviour.
   */
  viewerFor?: (m: InboundMessage) => { studentId: string; squadIds: string[] } | undefined;
}

/**
 * Doubt answering from the class's own materials. Scores 0.9 on a clearly course-shaped question
 * that mentions the bot, 0.4 on any other mention, and never reaches 0.8 without a mention, so it
 * cannot start talking in a group unprompted (spec 02 speaking policy).
 */
export function createDoubtSkill(brain: Brain, opts: DoubtOptions = {}): Skill {
  const course = opts.courseId ?? (() => 'demo');
  return {
    name: 'doubt',
    async match(m) {
      if (isGradedGrab(m.text) || isBehindIntent(m.text)) return 0;
      const q = looksLikeQuestion(m.text);
      if (m.mentionsBot) return q ? 0.9 : 0.4;
      return q ? 0.2 : 0;
    },
    async handle(m): Promise<OutboundMessage[]> {
      const question = stripMention(m.text);
      let text: string;
      let citations: ChatCitation[] = [];
      try {
        const viewer = opts.viewerFor?.(m);
        const a = await brain.ask(
          course(m),
          question,
          viewer ? { viewer, contextCourseId: null } : undefined,
        );
        text = a.grounded || a.reason === 'nothing_connected' ? a.text : NOT_IN_MATERIALS;
        // Canvas/Drive/Calendar/Classroom citations travel structurally (chips that open the source viewer).
        citations = a.grounded
          ? a.citations.flatMap((c) =>
              c.source
                ? [
                    {
                      file: c.file,
                      page: 1,
                      label: c.file,
                      source: c.source,
                      ...(c.quote ? { quote: c.quote.slice(0, 600) } : {}),
                    },
                  ]
                : [],
            )
          : [];
      } catch {
        // Any failure is answered honestly; nothing is invented from model memory.
        text = UNAVAILABLE_TEXT;
      }
      return [{ chatId: m.chatId, text, ...(citations.length ? { citations } : {}) }];
    },
  };
}
