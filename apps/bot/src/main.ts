import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeLlm, type Llm, type Skill } from '@squad/core';
import { GeminiLlm, describeConfig, loadConfig, openDb } from '@squad/core/node';
import { createBot } from './bot';
import { ChatRepl } from './cli/repl';
import { STUB_SKILLS } from './cli/stub-skills';
import { teePublisher, createEventPublisher } from './events';
import { createLogger } from './log';
import { skills as registry } from './skills';
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
    : new GeminiLlm({ apiKey: cfg.geminiApiKey!, models: cfg.geminiModels });
  const skills: Skill[] = [
    ...registry,
    ...(env.STUB_SKILLS === '1' ? Object.values(STUB_SKILLS) : []),
  ];
  const tap: { current?: EventPublisher } = {};
  const hub = createEventPublisher({
    log,
    baseUrl: cfg.hubBaseUrl,
    secret: cfg.internalEventsSecret,
  });
  const events = teePublisher(hub, {
    publish: (e) => tap.current?.publish(e) ?? Promise.resolve(),
  });

  let transport: Transport;
  if (kind === 'imessage') {
    const { createIMessageTransport } = await import('./transports/imessage');
    transport = createIMessageTransport({ roster, log });
  } else if (kind === 'discord') {
    const { createDiscordTransport } = await import('./transports/discord');
    transport = createDiscordTransport({ roster, log });
  } else {
    transport = new CliTransport(roster);
  }

  const bot = createBot({ skills, llm, transport, db, roster, events, log });
  await bot.start();
  const stop = async () => {
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
    });
    await repl.run(process.stdin, process.stdout);
    await bot.stop();
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
