// Mounts the bot in-process: the SAME router, speaking policy, confirm flow and skills as iMessage, over the web
// Transport. One process serves chat: shared db, one emit (the hub's own ingest), one brain and mastery store.
import { type Llm, type Student, type VillageEvent } from '@squad/core';
import { GeminiLlm, loadConfig } from '@squad/core/node';
import { createCourseStore, type Brain, type MasteryStore } from '@squad/brain';
import {
  WebTransport,
  buildMedia,
  createBot,
  createDemoLlm,
  createSkills,
  detectMention,
  registerMediaPersonas,
  type Bot,
  type EventPublisher,
  type Logger,
} from '@squad/bot';
import { COURSE_ID } from '../cast';
import type { HubDeps } from '../types';
import { wireRealPorts } from '../wire';
import { createFallbackLlm, statusOf, type FallbackLlm } from './llm';

export interface ChatEngineOptions {
  env?: Record<string, string | undefined>;
  /** The real model. Omit to build Gemini from GEMINI_API_KEY; pass `null` to force demo mode. Tests inject a failing client here. */
  real?: Llm | null;
  /** Override the deterministic demo model (default `createDemoLlm()`). */
  demo?: Llm;
  courseId?: string;
  /** Share the real ports' brain and mastery store when the hub runs with them. */
  shared?: { brain?: Brain; mastery?: MasteryStore };
  /** Also wire the real brain/quiz/media ports (the hub's own routes) onto the same model, brain and mastery store. Needs a real key. */
  realPorts?: boolean;
  /** Path of a .env to read, or false to read none (tests). Default: the repo's .env. */
  envFile?: string | false;
  /** Re-probe interval for the real model after a quota failure. Default 60 s. */
  reprobeMs?: number;
  now?: () => number;
  /** Skip the startup probe (tests that count calls). */
  noProbe?: boolean;
}

export interface ChatEngineHandle {
  bot: Bot;
  llm: FallbackLlm;
  stop(): Promise<void>;
}

// The hub logs only fixed messages: never user text, never keys.
const quietLog = (deps: Pick<HubDeps, 'log'>): Logger => ({
  info() {},
  debug() {},
  warn: (a, m) => deps.log.warn(typeof a === 'string' ? a : (m ?? 'bot warn')),
  error: (a, m) => deps.log.error(typeof a === 'string' ? a : (m ?? 'bot error')),
});

export async function attachChatEngine(
  hub: { deps: HubDeps },
  o: ChatEngineOptions = {},
): Promise<ChatEngineHandle> {
  const { deps } = hub;
  const env = o.env ?? process.env;
  const cfg = loadConfig({ env, ...(o.envFile !== undefined ? { envFile: o.envFile } : {}) });
  const courseId = o.courseId ?? COURSE_ID;

  const forceDemo = o.real === null || env.CHAT_FORCE_DEMO === '1';
  const real: Llm | undefined = forceDemo
    ? undefined
    : (o.real ??
      (cfg.geminiApiKey
        ? new GeminiLlm({ apiKey: cfg.geminiApiKey, models: cfg.geminiModels })
        : undefined));
  const demo = o.demo ?? createDemoLlm();
  const useEleven = !!cfg.elevenLabsApiKey && !forceDemo;
  const tts = useEleven ? ('elevenlabs' as const) : ('none' as const);
  const llm = createFallbackLlm({
    ...(real ? { real } : {}),
    demo,
    ...(o.now ? { now: o.now } : {}),
    ...(o.reprobeMs !== undefined ? { reprobeMs: o.reprobeMs } : {}),
  });
  deps.chat.setStatus(() => {
    // topped-up credits are noticed without a restart: a stale quota failure re-probes in the background
    if (real && llm.mode().mode === 'fake') void llm.probe();
    return statusOf(llm.mode(), tts);
  });
  if (real && !o.noProbe) void llm.probe();

  registerMediaPersonas();
  const { media } = buildMedia({ cfg, llm, fake: !useEleven });

  const events: EventPublisher = {
    async publish(e: VillageEvent) {
      deps.ingest.village(e);
    },
  };
  let shared = o.shared;
  if (o.realPorts && real) {
    const rp = await wireRealPorts(hub as Parameters<typeof wireRealPorts>[0], { llm, courseId });
    shared = { brain: rp.brain, mastery: rp.mastery };
  }
  const skills = await createSkills({
    llm,
    db: deps.db,
    emit: (e) => events.publish(e),
    ...(media ? { media } : {}),
    courseId: () => courseId,
    ...(shared ? { shared } : {}),
  });

  const roster: { students: Student[]; chats: { id: string; name: string; members: string[] }[] } =
    {
      students: deps.directory.students(),
      chats: [],
    };
  const squadIds = new Set(roster.students.flatMap((s) => deps.directory.squadOf(s.id) ?? []));
  for (const id of squadIds) {
    const sq = deps.directory.squad(id);
    if (sq) roster.chats.push({ id: `group:${id}`, name: sq.name, members: [...sq.members] });
  }

  const transport = new WebTransport({
    onMessage: (m) => {
      deps.chat.postBot(m);
    },
    onConfirmResolved: (student, taskId, answer) =>
      deps.chat.resolveConfirm(student, taskId, answer),
  });
  const bot = createBot({
    skills,
    llm,
    transport,
    db: deps.db,
    roster,
    events,
    log: quietLog(deps),
  });
  await bot.start();

  const store = createCourseStore(deps.db);
  deps.chat.setEngine({
    inject: (m) => transport.inject(m),
    mentions: (text, chatId) => detectMention(text, !chatId.startsWith('dm:')),
    excerpt(file, page) {
      const p = store.getPage(courseId, file, page);
      if (!p) return undefined;
      const title = store.getChapter(courseId, p.chapter)?.title;
      return { chapter: p.chapter, ...(title ? { title } : {}), text: p.text };
    },
    stop: () => bot.stop(),
  });
  return { bot, llm, stop: () => bot.stop() };
}
