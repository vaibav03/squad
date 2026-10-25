import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeLlm, createResilientLlm, type Llm, type Skill } from '@squad/core';
import { GeminiLlm, describeConfig, loadConfig, openDb, openMemoryDb } from '@squad/core/node';
import { createBot } from './bot';
import { ChatRepl } from './cli/repl';
import { STUB_SKILLS } from './cli/stub-skills';
import { teePublisher, createEventPublisher } from './events';
import { createInternalServer, DEFAULT_BOT_PORT } from './internal-server';
import { createLogger } from './log';
import { createSkills } from './skills';
import { createScheduler } from './scheduler';
import { buildMedia, buildScheduler, registerMediaPersonas } from './wiring';
import { CliTransport } from './transports/cli';
import type { EventPublisher, Roster, Transport } from './types';

const here = dirname(fileURLToPath(import.meta.url));

export function loadRoster(dir = resolve(here, '../fixtures')): Roster {
  const read = <T>(f: string, d: T): T =>
    existsSync(resolve(dir, f)) ? (JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as T) : d;
  return {
    students: read('students.json', []),
    chats: read<{ chats: Roster['chats'] }>('chats.json', { chats: [] }).chats,
  };
}

export async function main(argv = process.argv.slice(2), env = process.env): Promise<void> {
  const cfg = loadConfig({ env });
  const dryRun = argv.includes('--dry-run');
  const kind = (env.TRANSPORT ?? 'cli') as 'imessage' | 'discord' | 'cli';
  const fake = env.FAKE_LLM === '1' || (!cfg.geminiApiKey && kind === 'cli');
  if (!['imessage', 'discord', 'cli'].includes(kind))
    throw new Error(`unknown TRANSPORT "${kind}" (imessage|discord|cli)`);
  if (!fake && !cfg.geminiApiKey)
    throw new Error('GEMINI_API_KEY is not set (put it in .env, or run with FAKE_LLM=1)');
  const roster = loadRoster();

  console.log(
    `[bot] transport=${kind} llm=${fake ? 'FakeLlm (FAKE_LLM=1 or no GEMINI_API_KEY)' : 'Gemini'} students=${roster.students.length} hub=${cfg.hubBaseUrl}`,
  );
  if (dryRun) {
    console.log('[bot] dry run: config below, nothing connected');
    console.log(JSON.stringify(describeConfig(cfg), null, 2));
    const probe = new FakeLlm({ fallback: 'dry run' });
    const m = buildMedia({ cfg, llm: probe, fake: true });
    const names = (
      await createSkills({ llm: probe, db: openMemoryDb(), emit: () => {}, media: m.media })
    ).map((s) => s.name);
    console.log(`[bot] skills: ${names.join(', ')}`);
    console.log(`[bot] personas registered: ${registerMediaPersonas()}`);
    return;
  }

  const dbFile = resolve(here, '..', cfg.dbPath); // relative paths live under apps/bot (gitignored)
  mkdirSync(dirname(dbFile), { recursive: true });
  const db = openDb(dbFile);
  const log = createLogger({
    file: kind === 'cli' ? false : resolve(here, '../logs/bot.log'),
    level: kind === 'cli' ? (env.LOG_LEVEL ?? 'error') : undefined,
  });
  const llm: Llm = fake
    ? new FakeLlm({ fallback: 'Hi! (fake LLM reply)' })
    : createResilientLlm({
        real: new GeminiLlm({ apiKey: cfg.geminiApiKey!, models: cfg.geminiModels }),
        fake: new FakeLlm({ fallback: 'Hi! (demo reply: Gemini is unavailable)' }),
        onSwitch: (st) => {
          log.warn(`llm serving the fake demo model (${st.reason}); real model is re-probed`);
          console.log(
            `[bot] llm on FakeLlm (${st.reason}), will switch back when Gemini works; run pnpm run doctor`,
          );
        },
        onRecover: () => {
          log.info('llm: real Gemini is back');
        },
      });
  registerMediaPersonas();
  const tap: { current?: EventPublisher } = {};
  const hub = createEventPublisher({
    log,
    baseUrl: cfg.hubBaseUrl,
    secret: cfg.internalEventsSecret,
  });
  const events = teePublisher(hub, {
    publish: (e) => tap.current?.publish(e) ?? Promise.resolve(),
  });
  const { media, reason } = buildMedia({ cfg, llm, fake });
  if (reason) console.log(`[bot] ${reason}`);
  const scheduler = createScheduler({ db, log });
  const skills: Skill[] = [
    ...(await createSkills({
      proactive: scheduler,
      llm,
      db,
      emit: (e) => events.publish(e),
      media,
      scheduler: buildScheduler(env, cfg.internalEventsSecret),
    })),
    ...(env.STUB_SKILLS === '1' ? Object.values(STUB_SKILLS) : []),
  ];

  let transport: Transport;
  if (kind === 'imessage') {
    const { createIMessageTransport } = await import('./transports/imessage');
    const { configProblem, createIMessageGateway, imessageConfigFromEnv } =
      await import('./imessage');
    // Kill switch, allowlists, dry run and rate limits apply to the standalone transport too.
    const imCfg = imessageConfigFromEnv(env);
    const problem = configProblem(imCfg);
    if (problem) throw new Error(`iMessage transport refused to start: ${problem}`);
    const gateway = createIMessageGateway({ config: imCfg, log });
    console.log(`[bot] iMessage guarded (dryRun=${imCfg.dryRun}); see docs/imessage.md`);
    transport = createIMessageTransport({ roster, log, sdk: gateway.guardedSdk() });
  } else if (kind === 'discord') {
    const { createDiscordTransport } = await import('./transports/discord');
    transport = createDiscordTransport({ roster, log });
  } else {
    transport = new CliTransport(roster);
  }

  const bot = createBot({ skills, llm, transport, db, roster, events, log });
  await bot.start();
  scheduler.bind(bot.ctx);
  scheduler.start();
  const port = Number(env.BOT_PORT ?? DEFAULT_BOT_PORT);
  const internal = createInternalServer({
    confirms: bot.confirms,
    secret: cfg.internalEventsSecret,
    log,
  });
  internal.on('error', (e) =>
    console.error(`[bot] internal server on :${port} failed: ${e.message}`),
  );
  internal.listen(port, '127.0.0.1');
  const stop = async () => {
    scheduler.stop();
    internal.close();
    await bot.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());

  if (kind === 'cli') {
    const repl = new ChatRepl({
      bot,
      transport: transport as CliTransport,
      db,
      out: (l) => console.log(l),
      tap,
      students: roster.students.map((s) => s.id),
      scheduler,
    });
    await repl.run(process.stdin, process.stdout);
    // the scheduler timer and stdin keep the event loop alive: stop everything and exit after /quit
    await stop();
  } else {
    console.log(`[bot] ${kind} running. Ctrl+C to stop.`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e: Error) => {
    console.error(`[bot] fatal: ${e.message}`);
    process.exit(1);
  });
}
