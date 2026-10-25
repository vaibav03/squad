// The bot's fake-chat transport as the live demo's DM channel: a confirm sent by an agent becomes a DM through the bot's
// confirm manager, and a simulated student replies "yes" in the same chat.
import type { AskConfirm, VillageEvent } from '@squad/core';
import { createTestBot, type TestBot } from '@squad/bot/testing';

export interface StudentsConfirm {
  bot: TestBot;
  askConfirm(student: string): AskConfirm;
  /** Every DM text the bot sent. */
  dms(): string[];
}

export function createStudentsConfirm(
  students: string[],
  publish: (e: VillageEvent) => void,
  answer = 'yes',
): StudentsConfirm {
  const bot = createTestBot({
    roster: {
      students: students.map((id, i) => ({
        id,
        name: id.slice(2),
        handle: `+1555000020${i}`,
      })),
      chats: [{ id: 'group:demo', name: 'Demo', members: students }],
    },
    tap: { publish: async (e) => publish(e) },
    confirmTimeoutMs: 30_000,
  });
  let seen = 0;
  // The simulated students answer each DM that asks for a reply.
  const timer = setInterval(() => {
    while (seen < bot.sent.length) {
      const m = bot.sent[seen++]!;
      if (process.env.DEMO_DEBUG)
        console.log('dm', m.chatId, JSON.stringify(m.text ?? '').slice(0, 90));
      const who = students.find((s) => m.chatId === `dm:${s}`);
      if (who && /^Reply /m.test(m.text ?? '')) {
        bot.advance(1_000); // the bot drops identical (chat, sender, ts, text) as duplicates
        void bot.answerConfirm(who, answer);
      }
    }
  }, 20);
  timer.unref();
  return {
    bot,
    askConfirm: () => (student, question, options, taskId) =>
      bot.bot.confirms.ask(student, question, options, taskId),
    dms: () => bot.sent.map((m) => m.text ?? ''),
  };
}
