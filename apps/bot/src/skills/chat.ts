import type { Skill } from '@squad/core';

/** Built-in fallback: scores 0.5 when mentioned (or DM), answers with the fast tier. */
export const chatSkill: Skill = {
  name: 'chat',
  async match(m) {
    return m.mentionsBot ? 0.5 : 0;
  },
  async handle(m, ctx) {
    const r = await ctx.llm.complete({
      model: 'fast',
      system:
        'You are Nook, a friendly study buddy in a student group chat. Reply in one or two short sentences.',
      messages: m.text,
      maxTokens: 200,
    });
    return [{ chatId: m.chatId, text: r.text.trim() || 'Hey! Ask me anything about your course.' }];
  },
};
