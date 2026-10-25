import type { Ctx, InboundMessage, OutboundMessage, Skill } from '@squad/core';
import type { FeynmanEngine } from '../../feynman/engine';

export interface FeynmanSkillDeps {
  engine: FeynmanEngine;
  courseIdFor?: (m: InboundMessage, ctx: Ctx) => string;
}

/** "feynman ch3 gradient descent" -> { chapter: 'ch3', concept: 'gradient descent' }. */
export function parseFeynman(text: string): { chapter: string; concept: string } | undefined {
  const m = /\bfeynman\s+(?:(ch(?:apter)?\.?\s*\d+)\s+)?(.+?)\s*$/i.exec(text);
  if (!m?.[2]) return undefined;
  const ch = m[1] ? `ch${/\d+/.exec(m[1])![0]}` : 'default';
  return { chapter: ch, concept: m[2] };
}

export function createFeynmanSkill(deps: FeynmanSkillDeps): Skill {
  const { engine } = deps;
  return {
    name: 'feynman',
    async match(m) {
      if (parseFeynman(m.text) && (m.mentionsBot || !m.isGroup)) return 0.9;
      if (engine.active(m.chatId, m.from) && (m.mentionsBot || !m.isGroup)) return 0.85;
      return 0;
    },
    async handle(m, ctx) {
      const out = (text: string): OutboundMessage[] => [{ chatId: m.chatId, text }];
      const parsed = parseFeynman(m.text);
      const open = engine.active(m.chatId, m.from);
      if (open && !parsed) {
        const step = await engine.submit(open, m.text.replace(/^@\w+\s*/, '').trim());
        return out(step.kind === 'followup' ? step.question : step.text);
      }
      if (!parsed) return out('What should I quiz you on? Try "feynman ch3 gradient descent".');
      const courseId = deps.courseIdFor?.(m, ctx) ?? 'default';
      const id = engine.start(m.chatId, m.from, courseId, parsed.chapter, parsed.concept);
      return out(engine.prompt(id));
    },
  };
}
