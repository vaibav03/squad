import type { InboundMessage, Llm, OutboundMessage, Skill, VillageEvent } from '@squad/core';
import { FakeLlm } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { createBot } from './bot';
import { recordingPublisher } from './events';
import { decisions as readDecisions } from './store';
import { detectMention } from './mention';
import { chatSkill } from './skills/chat';
import type { Bot, BotOptions, Roster, Transport } from './types';
import type { Logger } from './types';

export const TEST_ROSTER: Roster = {
  students: ['ana', 'ben', 'cam', 'dee'].map((n, i) => ({
    id: `s_${n}`,
    name: n[0]!.toUpperCase() + n.slice(1),
    handle: `+1555000010${i}`,
  })),
  chats: [{ id: 'group:test', name: 'Test', members: ['s_ana', 's_ben', 's_cam', 's_dee'] }],
};

/** Recording transport for headless tests. */
export class FakeTransport implements Transport {
  readonly name = 'cli';
  sent: OutboundMessage[] = [];
  failNext = 0;
  private onMsg?: (m: InboundMessage) => void | Promise<void>;
  async start(onMsg: (m: InboundMessage) => void | Promise<void>) {
    this.onMsg = onMsg;
  }
  async stop() {}
  async send(o: OutboundMessage) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('send failed');
    }
    this.sent.push(o);
  }
  dmChatId(s: string) {
    return `dm:${s}`;
  }
  async deliver(m: InboundMessage) {
    await this.onMsg?.(m);
  }
}

export interface TestBotOptions {
  skills?: Skill[];
  llm?: Llm;
  roster?: Roster;
  log?: Logger;
  confirmTimeoutMs?: number;
  scoreTimeoutMs?: number;
  policy?: BotOptions['policy'];
  startMs?: number;
  /** include the built-in chat skill (default true) */
  chat?: boolean;
}

export function createTestBot(o: TestBotOptions = {}) {
  let clock = o.startMs ?? 1_700_000_000_000;
  const transport = new FakeTransport();
  const events = recordingPublisher();
  const db = openMemoryDb();
  const roster = o.roster ?? TEST_ROSTER;
  const bot: Bot = createBot({
    skills: [...(o.chat === false ? [] : [chatSkill]), ...(o.skills ?? [])],
    llm: o.llm ?? new FakeLlm({ fallback: 'fake reply' }),
    transport,
    db,
    roster,
    events,
    log: o.log,
    now: () => clock,
    confirmTimeoutMs: o.confirmTimeoutMs,
    scoreTimeoutMs: o.scoreTimeoutMs,
    policy: o.policy,
  });

  const api = {
    bot,
    db,
    transport,
    events: events.events as VillageEvent[],
    get sent() {
      return transport.sent;
    },
    now: () => clock,
    advance(ms: number) {
      clock += ms;
    },
    /** Send a message as a student. chatId 'dm' means the DM with the bot. */
    async say(from: string, chat: string, text: string, ex: Partial<InboundMessage> = {}) {
      const isGroup = chat !== 'dm' && !chat.startsWith('dm:');
      const m: InboundMessage = {
        chatId: chat === 'dm' ? `dm:${from}` : chat,
        isGroup,
        from,
        text,
        attachments: [],
        mentionsBot: detectMention(text, isGroup),
        ts: clock,
        ...ex,
      };
      return bot.handle(m);
    },
    answerConfirm(student: string, text: string) {
      return api.say(student, 'dm', text);
    },
    decisions: () => readDecisions(db),
  };
  return api;
}
export type TestBot = ReturnType<typeof createTestBot>;
