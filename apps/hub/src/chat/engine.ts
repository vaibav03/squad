// Mounts the bot in-process: the SAME router, speaking policy, confirm flow and skills as iMessage, over the web
// Transport. One process serves chat: shared db, one emit (the hub's own ingest), one brain and mastery store.
import {
  createResilientLlm,
  type Llm,
  type ResilientLlm,
  type Student,
  type VillageEvent,
} from '@squad/core';
import { GeminiLlm, loadConfig } from '@squad/core/node';
import { ttsHealthFromConfig, type TtsHealth } from '@squad/media';
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
import { dmChatId } from './access';

export interface ChatEngineOptions {
  env?: Record<string, string | undefined>;
  /** An already-built resilient model (main.ts shares one with the real ports). Overrides `real`/`demo`. */
  llm?: ResilientLlm;
  /** Wrap the model once it is built (the hub uses this for llm metrics). Must keep `status()`. */
  instrument?: (llm: ResilientLlm) => ResilientLlm;
  /** Where each student's mesh agent listens (passed to the real ports). */
  agentUrls?: Record<string, string>;
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
  now?: () => number;
  /** Skip the startup probe (tests that count calls). */
  noProbe?: boolean;
}

export interface ChatEngineHandle {
  bot: Bot;
  llm: ResilientLlm;
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

  const forced = env.CHAT_FORCE_DEMO === '1' || env.FORCE_FAKE_LLM === '1';
  const forceDemo = forced || o.real === null;
  const real: Llm | undefined = forceDemo
    ? undefined
    : (o.real ??
      (cfg.geminiApiKey
        ? new GeminiLlm({ apiKey: cfg.geminiApiKey, models: cfg.geminiModels })
        : undefined));
  const useEleven = !!cfg.elevenLabsApiKey && !forceDemo;
  // A quota failure serves the demo model and re-probes the real one at most once a minute.
  const built =
    o.llm ??
    createResilientLlm({
      ...(real ? { real } : {}),
      fake: o.demo ?? createDemoLlm(),
      forceFake: forced,
      ...(o.now ? { now: o.now } : {}),
      // prove the key works before any status claims it does (background; never delays serving)
      probeOnStart: !!real && !forced && !o.noProbe,
    });
  const llm = o.instrument ? o.instrument(built) : built;
  const wantRealPorts = !!o.realPorts && (!!real || env.FORCE_FAKE_LLM === '1' || !!o.llm);
  // One shared speech probe per key (also used by the audio services the ports and skills build).
  const ttsHealth: TtsHealth | undefined =
    useEleven && !o.noProbe ? ttsHealthFromConfig(cfg.elevenLabsApiKey!) : undefined;
  ttsHealth?.status(); // start the first probe now, in the background
  deps.runtime ??= {
    // topped-up credits are noticed without a restart: a stale failure re-probes in the background
    llm: () => llm.status(),
    tts: () => (ttsHealth ? ttsHealth.status().tts === 'elevenlabs' : useEleven && !!o.noProbe),
    ttsStatus: () =>
      ttsHealth
        ? ttsHealth.status()
        : useEleven
          ? { tts: 'elevenlabs', reason: 'ok' } // probes skipped (tests that count calls)
          : { tts: 'none', reason: 'no_key' },
    ports: () => (wantRealPorts ? 'real' : 'stub'),
  };
  if (real && !o.noProbe) llm.status(); // starts a probe when a stale failure is on record

  registerMediaPersonas();
  const { media } = buildMedia({ cfg, llm, fake: !useEleven });

  const events: EventPublisher = {
    async publish(e: VillageEvent) {
      deps.ingest.village(e);
    },
  };
  let shared = o.shared;
  if (wantRealPorts) {
    const rp = await wireRealPorts(hub as Parameters<typeof wireRealPorts>[0], {
      llm,
      courseId,
      ...(o.agentUrls ? { agentUrls: o.agentUrls } : {}),
    });
    shared = { brain: rp.brain, mastery: rp.mastery };
  }
  const skills = await createSkills({
    llm,
    db: deps.db,
    emit: (e) => events.publish(e),
    ...(media ? { media } : {}),
    courseId: () => courseId,
    demo: () => (deps.runtime ? deps.runtime.llm().llm !== 'real' : true),
    onCouncil: (c) => void (deps.council ??= c),
    ...(shared
      ? { shared: { ...shared, ...(deps.council ? { council: deps.council } : {}) } }
      : deps.council
        ? { shared: { council: deps.council } }
        : {}),
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

  // The village ConfirmSheet and POST /v1/confirms/:taskId can answer a chat confirm card too: a yes/no is typed into
  // the student's DM, exactly as if they had answered in the chat (the bot's own confirm manager resolves it).
  const pending = (student: string, taskId: string) => {
    const m = deps.chat.store.findConfirm(dmChatId(student), taskId);
    return m?.card?.type === 'confirm' ? m.card : undefined;
  };
  deps.confirms.register({
    kind: 'bot',
    owns: (taskId, v) => pending(v.studentId, taskId)?.status === 'pending',
    async answer(v, taskId, a) {
      await transport.inject({
        chatId: dmChatId(v.studentId),
        from: v.studentId,
        text: a.yes ? 'yes' : 'no',
      });
      return pending(v.studentId, taskId)?.status === 'answered'
        ? { ok: true }
        : { ok: false, code: 'invalid_request', message: 'answer this one by number in the chat' };
    },
  });

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
