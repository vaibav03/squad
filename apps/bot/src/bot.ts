import type { Ctx, InboundMessage } from '@squad/core';
import { createConfirmManager } from './confirm';
import { createEventPublisher } from './events';
import { nullLogger } from './log';
import { createMemory } from './memory';
import { formatPersonaText, getPersona } from './persona';
import { createRouter } from './router';
import { seedRoster } from './store';
import type { Bot, BotCtx, BotOptions, Roster } from './types';

const EMPTY: Roster = { students: [], chats: [] };

export function createBot(opts: BotOptions): Bot {
  const log = opts.log ?? nullLogger;
  const now = opts.now ?? Date.now;
  const events = opts.events ?? createEventPublisher({ log });
  const { transport, db } = opts;
  const roster = opts.roster ?? EMPTY;

  const dm: Ctx['dm'] = (student, text, attachments) =>
    transport.send({
      chatId: transport.dmChatId(student),
      text: formatPersonaText(undefined, text),
      attachments,
    });

  const confirms = createConfirmManager({
    db,
    dm: (student, text) => dm(student, text),
    ...(transport.confirmPrompt
      ? { prompt: (student, p) => transport.confirmPrompt!(student, p) }
      : {}),
    ...(transport.confirmResolved
      ? { resolved: (student, taskId, a) => transport.confirmResolved!(student, taskId, a) }
      : {}),
    events,
    now,
    timeoutMs: opts.confirmTimeoutMs,
    log,
  });

  const ctx: BotCtx = {
    db,
    llm: opts.llm,
    send: async (o) => {
      await transport.send(o.text ? { ...o, text: formatPersonaText(o.personaId, o.text) } : o);
    },
    dm,
    askConfirm: (student, question, options, taskId) =>
      confirms.ask(student, question, options, taskId),
    memory: createMemory(db, now),
    events,
    log,
    persona: getPersona,
    now,
  };

  const router = createRouter({
    db,
    skills: opts.skills,
    transport,
    ctx,
    confirms,
    events,
    log,
    now,
    policy: opts.policy,
    scoreTimeoutMs: opts.scoreTimeoutMs,
  });

  return {
    ctx,
    confirms,
    handle: (m: InboundMessage) => router.handle(m),
    async start() {
      seedRoster(db, roster, transport.name, now());
      await transport.start(async (m) => {
        await router.handle(m);
      });
      log.info(
        { transport: transport.name, skills: opts.skills.map((s) => s.name) },
        'bot started',
      );
    },
    async stop() {
      await transport.stop();
    },
  };
}
