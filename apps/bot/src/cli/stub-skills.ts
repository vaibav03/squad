import type { Skill } from '@squad/core';

/** Test/demo-only skills used by scripted sessions and `STUB_SKILLS=1`. Real skills live in other packages. */
export const unpromptedQuiz: Skill = {
  name: 'unprompted-quiz',
  async match(m) {
    return /\b(chapter|quiz|exam)\b/i.test(m.text) ? 0.85 : 0;
  },
  async handle(m) {
    return [
      { chatId: m.chatId, text: 'Want a 3-question quiz on that chapter? Say @cubbie quiz me.' },
    ];
  },
};

export const confirmDemo: Skill = {
  name: 'confirm-demo',
  async match(m) {
    return /\bbook\b/i.test(m.text) && m.mentionsBot ? 0.9 : 0;
  },
  async handle(m, ctx) {
    const a = await ctx.askConfirm(
      m.from,
      'Book the study room for Friday 3pm?',
      ['Yes, book it', 'No thanks'],
      `book-${m.ts}`,
    );
    return [
      {
        chatId: m.chatId,
        text: a === 'Yes, book it' ? 'Booked for Friday 3pm.' : 'Okay, not booking.',
      },
    ];
  },
};

export const crasher: Skill = {
  name: 'crasher',
  async match(m) {
    return /\bcrash\b/i.test(m.text) ? 0.9 : 0;
  },
  async handle() {
    throw new Error('stub crash');
  },
};

export const STUB_SKILLS: Record<string, Skill> = {
  'unprompted-quiz': unpromptedQuiz,
  'confirm-demo': confirmDemo,
  crasher,
};
