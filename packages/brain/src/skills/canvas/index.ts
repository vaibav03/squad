import type { Skill } from '@squad/core';
import { isBehindIntent, isGradedGrab } from '../../experts/intent';
import { canvasAnswerWithSources, isCanvasQuestion } from '../../context/answers';
import { chatCitationForSource } from '../../citations/chat';
import { ownSources } from '../../context/readable';
import type { ContextStore } from '../../context/store';
import type { ContextViewer } from '../../context/types';

export interface CanvasAnswerOptions {
  viewerFor: (m: { from: string }) => ContextViewer | undefined;
  now?: () => number;
}

/**
 * Nook's "what's due?" / "send me the slides" answers, produced from the asker's own synced Canvas data before any
 * model runs (works without an LLM key). Scores 0.95 only when the bot is addressed and the text is a deadline or
 * file question, so it never speaks unprompted. The asker's sources only: a group message never reveals another
 * student's Canvas.
 */
export function createCanvasAnswerSkill(store: ContextStore, opts: CanvasAnswerOptions): Skill {
  const now = opts.now ?? (() => Date.now());
  return {
    name: 'canvas',
    async match(m) {
      if (!m.mentionsBot || isGradedGrab(m.text) || isBehindIntent(m.text)) return 0;
      if (!isCanvasQuestion(m.text)) return 0;
      const viewer = opts.viewerFor(m);
      // Only claim the message when the asker has synced Canvas data; otherwise other skills answer as before.
      return viewer && ownSources(store, viewer).some((s) => s.kind.startsWith('canvas_'))
        ? 0.95
        : 0;
    },
    async handle(m) {
      const viewer = opts.viewerFor(m);
      const r = viewer ? canvasAnswerWithSources(m.text, ownSources(store, viewer), now()) : null;
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
