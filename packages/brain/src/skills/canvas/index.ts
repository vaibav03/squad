import type { OutboundMessage, Skill } from '@squad/core';
import { isBehindIntent, isGradedGrab } from '../../experts/intent';
import { canvasAnswerWithSources, isCanvasQuestion } from '../../context/answers';
import { calendarReply, dueReply, isCalendarQuestion } from '../../context/answers-rich';
import { chatCitationForSource } from '../../citations/chat';
import { ownSources } from '../../context/readable';
import type { ContextStore } from '../../context/store';
import type { ContextViewer } from '../../context/types';

export interface CanvasAnswerOptions {
  viewerFor: (m: { from: string }) => ContextViewer | undefined;
  now?: () => number;
}

const DEADLINE_ONLY = /\b(due|deadlines?|assignments?|homework|hw|upcoming|to-?do)\b/i;
const CONTEXT_PREFIXES = ['canvas_', 'classroom_', 'gcal_'];
const hasContext = (kind: string) => CONTEXT_PREFIXES.some((p) => kind.startsWith(p));

/**
 * Nook's "what's due?" / "send me the slides" answers plus "what's on my calendar", produced from the asker's own
 * imported data (Canvas, Google Classroom, Google Calendar) before any model runs, so they work without an LLM key.
 * Due answers carry one source citation per listed item (chips that open the source viewer). Calendar details are
 * owner-only: a group message gets aggregates, the owner's DM gets titles and citations. Scores 0.95 only when the
 * bot is addressed and the text is such a question, so it never speaks unprompted. The asker's sources only: a group
 * message never reveals another student's data.
 */
export function createCanvasAnswerSkill(store: ContextStore, opts: CanvasAnswerOptions): Skill {
  const now = opts.now ?? (() => Date.now());
  return {
    name: 'canvas',
    async match(m) {
      if (!m.mentionsBot || isGradedGrab(m.text) || isBehindIntent(m.text)) return 0;
      if (!isCanvasQuestion(m.text) && !isCalendarQuestion(m.text)) return 0;
      const viewer = opts.viewerFor(m);
      // Only claim the message when the asker has imported data; otherwise other skills answer as before.
      return viewer && ownSources(store, viewer).some((s) => hasContext(s.kind)) ? 0.95 : 0;
    },
    async handle(m): Promise<OutboundMessage[]> {
      const viewer = opts.viewerFor(m);
      if (!viewer) return [];
      const sources = ownSources(store, viewer);
      const t = now();
      const group = m.chatId.startsWith('group:');
      // Calendar first when the words ask for it and not for deadlines ("what's on my calendar").
      if (isCalendarQuestion(m.text) && !DEADLINE_ONLY.test(m.text)) {
        const cal = calendarReply(store, sources, m.text, t);
        if (!cal) return [];
        if (!group)
          return [{ chatId: m.chatId, text: cal.details.text, citations: cal.details.citations }];
        const out: OutboundMessage[] = [{ chatId: m.chatId, text: cal.aggregate }];
        if (cal.count > 0)
          out.push({
            chatId: `dm:${m.from}`,
            text: cal.details.text,
            citations: cal.details.citations,
          });
        return out;
      }
      if (
        DEADLINE_ONLY.test(m.text) &&
        !/\b(slides?|ppts?|pptx|powerpoints?|pdfs?)\b/i.test(m.text)
      ) {
        const due = dueReply(store, sources, t, new Map(), m.text);
        if (due)
          return [
            {
              chatId: m.chatId,
              text: due.text,
              ...(due.citations.length ? { citations: due.citations } : {}),
            },
          ];
      }
      const r = canvasAnswerWithSources(m.text, sources, t);
      return r
        ? [
            {
              chatId: m.chatId,
              text: r.text,
              ...(r.used.length ? { citations: r.used.map((s) => chatCitationForSource(s)) } : {}),
            },
          ]
        : [];
    },
  };
}
