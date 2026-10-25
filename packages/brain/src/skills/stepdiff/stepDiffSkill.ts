import type { Ctx, InboundMessage, OutboundMessage, Skill } from '@squad/core';
import { stepsFromText } from '../../stepdiff/vision';
import type { StepDiffEngine } from '../../stepdiff/session';

export interface StepDiffSkillDeps {
  engine: StepDiffEngine;
  courseIdFor?: (m: InboundMessage, ctx: Ctx) => string;
  chapterFor?: (m: InboundMessage, ctx: Ctx) => string | undefined;
}

const isImage = (a: { mime: string }) => a.mime.startsWith('image/');

export function createStepDiffSkill(deps: StepDiffSkillDeps): Skill {
  const { engine } = deps;
  return {
    name: 'stepDiff',
    async match(m) {
      if (m.isGroup) return m.mentionsBot && /\bdiff\b/i.test(m.text) ? 0.9 : 0;
      const open = engine.openFor(m.from);
      if (!open) return 0;
      if (m.attachments.some(isImage)) return 0.9;
      return !engine.hasSubmitted(open.id, m.from) && m.text.includes('\n') ? 0.8 : 0;
    },
    async handle(m, ctx) {
      const to = (chatId: string, text: string): OutboundMessage[] => [{ chatId, text }];
      if (m.isGroup) {
        const mode = /\bprivate\b/i.test(m.text) ? 'private' : 'full';
        engine.open(
          m.chatId,
          deps.courseIdFor?.(m, ctx) ?? 'default',
          mode,
          deps.chapterFor?.(m, ctx),
        );
        return to(
          m.chatId,
          'Diff is open. Two of you: DM me a photo of your handwritten work. Photos stay private; the group only sees where your steps first split.',
        );
      }
      const open = engine.openFor(m.from);
      if (!open)
        return to(m.chatId, 'There is no open diff for you. Ask in your group: "@squad diff".');
      const photo = m.attachments.find(isImage);
      const res = photo
        ? await engine.submitPhoto(open.id, m.from, photo)
        : await engine.submitSteps(open.id, m.from, stepsFromText(m.text));
      switch (res.status) {
        case 'waiting':
          return to(m.chatId, 'Got it. Waiting for the other person.');
        case 'illegible':
          return to(m.chatId, res.message);
        case 'full':
          return to(m.chatId, res.reason);
        case 'done':
          await ctx.send({ chatId: open.chatId, text: res.message });
          return to(m.chatId, 'Both are in. I posted where your steps split.');
      }
    },
  };
}
