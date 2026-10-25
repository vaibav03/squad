// Admin/debug CLI: `pnpm bot:scheduler <list|run|cancel|prefs|sends|tick> ...`
// Works on the bot's sqlite file (the running bot picks changes up on its next tick).
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeLlm } from '@squad/core';
import { loadConfig, openDb } from '@squad/core/node';
import { createProactive } from './wire';
import { createScheduler, type Scheduler } from './scheduler';
import type { JobRecord } from '@squad/brain';

const here = dirname(fileURLToPath(import.meta.url));

const HELP = `usage: pnpm bot:scheduler <command> [--db <file>]
  list [--student <id>] [--status pending|done|...]   show jobs
  run <id|key>            make a job due now (the live bot runs it on its next tick)
  run <id|key> --here     execute it locally with a printing ctx (nothing is sent; confirms answer 'timeout')
  cancel <id|key>         cancel a job
  tick                    run due jobs locally (printing ctx)
  prefs <student|chat>    show opt-in, snooze, time zone, quiet hours
  sends [n]               recent proactive sends (rate-limit ledger)`;

const fmt = (j: JobRecord) => {
  const when = new Date(j.runAt).toISOString().slice(0, 16).replace('T', ' ');
  return `#${String(j.id).padEnd(4)} ${j.status.padEnd(9)} ${when}Z ${j.kind.padEnd(14)} ${(j.student ?? j.chatId ?? '').padEnd(10)} att=${j.attempts}/${j.maxAttempts}${j.cron ? ` cron="${j.cron}"` : ''}${j.tz ? ` tz=${j.tz}` : ''}  [${j.key}]${j.lastError ? `  err: ${j.lastError}` : ''}`;
};

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function run(argv: string[], out: (l: string) => void = console.log): Promise<number> {
  const [cmd, ...args] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help') return (out(HELP), cmd ? 0 : 1);
  const cfg = loadConfig({ env: process.env });
  const dbFile = flag(args, 'db') ?? resolve(here, '../..', cfg.dbPath);
  const db = openDb(dbFile);
  const scheduler: Scheduler = createScheduler({ db });
  // handlers must exist for local execution
  createProactive({ db, scheduler });
  const printCtx = {
    db,
    llm: new FakeLlm({ fallback: 'fake' }),
    send: async (m: { chatId: string; text?: string }) =>
      out(`  (would send to ${m.chatId}) ${m.text ?? ''}`),
    dm: async (to: string, text: string) => out(`  (would DM ${to}) ${text}`),
    askConfirm: async (s: string, q: string, o: string[]) => {
      out(`  (would ask ${s}) ${q} [${o.join(' | ')}]`);
      return 'timeout';
    },
  };
  const find = (k: string) => scheduler.list().find((j) => String(j.id) === k || j.key === k);

  switch (cmd) {
    case 'list': {
      const jobs = scheduler.list({
        ...(flag(args, 'student') ? { student: flag(args, 'student')! } : {}),
        ...(flag(args, 'status') ? { status: flag(args, 'status') as JobRecord['status'] } : {}),
      });
      jobs.forEach((j) => out(fmt(j)));
      out(`${jobs.length} job(s) in ${dbFile}`);
      return 0;
    }
    case 'run': {
      const j = args[0] ? find(args[0]) : undefined;
      if (!j) return (out('no such job'), 1);
      scheduler.runNow(j.id);
      if (args.includes('--here')) {
        scheduler.bind(printCtx);
        const r = await scheduler.tick();
        r.forEach((x) => out(`  ${x.kind} -> ${x.outcome}${x.detail ? ` (${x.detail})` : ''}`));
      } else out(`job #${j.id} is due now; the running bot will pick it up within one tick`);
      return 0;
    }
    case 'cancel': {
      const j = args[0] ? find(args[0]) : undefined;
      if (!j) return (out('no such job'), 1);
      out(scheduler.cancelById(j.id) ? `cancelled #${j.id}` : `#${j.id} was not pending`);
      return 0;
    }
    case 'tick': {
      scheduler.bind(printCtx);
      const r = await scheduler.tick();
      out(`ran ${r.length} job(s)`);
      r.forEach((x) => out(`  ${x.kind} -> ${x.outcome}`));
      return 0;
    }
    case 'prefs': {
      if (!args[0]) return (out('usage: prefs <student|chat>'), 1);
      out(JSON.stringify(scheduler.prefs(args[0]), null, 2));
      return 0;
    }
    case 'sends': {
      for (const s of scheduler.recentSends(Number(args[0] ?? 20))) {
        out(`${new Date(s.ts).toISOString()} ${s.kind ?? ''} ${s.student ?? s.chatId ?? ''}`);
      }
      return 0;
    }
    default:
      out(HELP);
      return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e: Error) => {
      console.error(`[scheduler] ${e.message}`);
      process.exit(1);
    },
  );
}
