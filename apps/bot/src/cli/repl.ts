import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { Db } from '@squad/core';
import { formatPersonaText } from '../persona';
import { decisions } from '../store';
import type { Scheduler } from '../scheduler/scheduler';
import type { CliTransport } from '../transports/cli';
import type { Bot, EventPublisher } from '../types';
import { createRecorder, type Recorder } from './recorder';
import { buildSessionSkills } from './demo-session';
import { loadScript, runScript } from './script';

export interface ReplDeps {
  bot: Bot;
  transport: CliTransport;
  db: Db;
  out: (line: string) => void;
  /** installed once; the REPL forwards every published event to the active recorder */
  tap: { current?: EventPublisher };
  students: string[];
  now?: () => number;
  scheduler?: Scheduler;
}

const HELP = [
  'Plain text      send as the current student in the current chat',
  '/as <student>   switch student (e.g. /as s_ana)',
  '/group <name> [ids...]   create/switch to group chat group:<name>',
  '/dm             switch to the DM with the bot',
  '/script <file>  run a scripted multi-student session (virtual clock, fresh bot)',
  '/record <file>  start recording VillageEvents; /record stop writes + validates the replay',
  '/checkpoint <name>   add a replay checkpoint while recording',
  '/decisions [n]  show the last n speaking-policy decisions (scores, chosen skill, reason)',
  '/jobs [student]   list scheduled proactive jobs; /tick runs the ones that are due',
  '/help  /quit',
];

export class ChatRepl {
  student: string;
  chat = 'group:test';
  private recorder?: Recorder;
  private recordFile?: string;
  private quit = false;
  constructor(private readonly d: ReplDeps) {
    this.student = d.students[0] ?? 's_ana';
    d.transport.onSend((o) => {
      const where = o.chatId.startsWith('dm:') ? `dm -> ${o.chatId.slice(3)}` : o.chatId;
      const body = o.text ?? '';
      const att = o.attachments?.length ? ` [+${o.attachments.length} attachment]` : '';
      for (const [i, line] of `${body}${att}`.split('\n').entries()) {
        d.out(i === 0 ? `  [${where}] ${line}` : `  ${' '.repeat(where.length + 3)}${line}`);
      }
    });
  }

  get done() {
    return this.quit;
  }
  prompt(): string {
    return `${this.student}@${this.chat === 'dm' ? 'dm' : this.chat}> `;
  }

  async execute(line: string): Promise<void> {
    const { out } = this.d;
    const text = line.trim();
    if (!text) return;
    if (!text.startsWith('/')) {
      const chatId = this.chat === 'dm' ? `dm:${this.student}` : this.chat;
      const p = this.d.transport.inject(this.student, chatId, text);
      // a skill may block on a confirm that this very REPL must answer: do not wait for it
      await Promise.race([p, new Promise((r) => setTimeout(r, 40))]);
      p.catch((e: Error) => out(`  ! ${e.message}`));
      return;
    }
    const [cmd, ...args] = text.split(/\s+/);
    switch (cmd) {
      case '/help':
        HELP.forEach((l) => out(l));
        break;
      case '/quit':
      case '/exit':
        this.quit = true;
        break;
      case '/as':
        if (!args[0]) return out('usage: /as <student id>');
        this.student = args[0];
        out(`now speaking as ${this.student}`);
        break;
      case '/group':
        if (!args[0]) return out('usage: /group <name> [student ids...]');
        this.chat = `group:${args[0]}`;
        out(`now in ${this.chat}${args.length > 1 ? ` with ${args.slice(1).join(', ')}` : ''}`);
        break;
      case '/dm':
        this.chat = 'dm';
        out(`now in a DM with ${formatPersonaText(undefined, '').trim().replace(/:$/, '')}`);
        break;
      case '/jobs': {
        const sch = this.d.scheduler;
        if (!sch) return out('  (no scheduler in this session)');
        const jobs = sch.list(args[0] ? { student: args[0] } : {});
        if (!jobs.length) out('  no jobs');
        for (const j of jobs) {
          const when = new Date(j.runAt).toISOString().slice(0, 16).replace('T', ' ');
          out(
            `  #${j.id} ${j.status.padEnd(9)} ${when}Z ${j.kind} ${j.student ?? j.chatId ?? ''} ${j.cron ? `cron "${j.cron}" ` : ''}[${j.key}]`,
          );
        }
        break;
      }
      case '/tick': {
        const sch = this.d.scheduler;
        if (!sch) return out('  (no scheduler in this session)');
        const r = await sch.tick();
        out(
          `  ran ${r.length} job(s)${r.length ? `: ${r.map((x) => `${x.kind}=${x.outcome}`).join(', ')}` : ''}`,
        );
        break;
      }
      case '/decisions': {
        const n = Number(args[0] ?? 5) || 5;
        for (const r of decisions(this.d.db, n)) {
          const x = r.decision;
          const sc = x.scores.map((s) => `${s.skill}=${s.score.toFixed(2)}`).join(' ');
          out(`  ${r.from_id} in ${r.chat_id}: "${r.text.slice(0, 40)}"`);
          out(
            `    ${x.action.toUpperCase()} (${x.reason})${x.skill ? ` -> ${x.skill}` : ''}  scores: ${sc || 'none'}`,
          );
        }
        break;
      }
      case '/script': {
        if (!args[0]) return out('usage: /script <file>');
        try {
          const { skills, db } = await buildSessionSkills();
          const r = await runScript(loadScript(args[0]), { skills, db, drainMs: 15_000 });
          for (const s of r.sent) out(`  [${s.chatId}] ${s.text ?? ''}`);
          out(
            `script done: ${r.sent.length} messages, ${r.events.length} events, ${r.unresolved} unresolved`,
          );
        } catch (e) {
          out(`  ! ${(e as Error).message}`);
        }
        break;
      }
      case '/record':
        if (args[0] === 'stop') {
          if (!this.recorder || !this.recordFile) return out('not recording');
          try {
            const s = this.recorder.write(this.recordFile);
            out(
              `wrote ${this.recordFile} (${s.events.length} events, checkpoints: ${Object.keys(s.checkpoints).join(', ')})`,
            );
          } catch (e) {
            out(`  ! ${(e as Error).message}`);
          }
          this.recorder = undefined;
          this.d.tap.current = undefined;
        } else if (args[0]) {
          this.recordFile = args[0];
          this.recorder = createRecorder({
            name: args[0]
              .split('/')
              .pop()!
              .replace(/\.json$/, ''),
            cast: { me: this.student },
            now: this.d.now,
          });
          this.d.tap.current = this.recorder.publisher;
          out(`recording to ${args[0]} (use /record stop)`);
        } else out('usage: /record <file> | /record stop');
        break;
      case '/checkpoint':
        if (!this.recorder) return out('not recording');
        if (!args[0]) return out('usage: /checkpoint <name>');
        this.recorder.checkpoint(args[0]);
        out(`checkpoint "${args[0]}" added`);
        break;
      default:
        out(`unknown command ${cmd}. Try /help`);
    }
  }

  async run(input: Readable, output: Writable): Promise<void> {
    const rl = createInterface({ input, output, prompt: this.prompt() });
    this.d.out('Fake chat. /help for commands.');
    rl.prompt();
    for await (const line of rl) {
      await this.execute(line);
      if (this.quit) break;
      rl.setPrompt(this.prompt());
      rl.prompt();
    }
    rl.close();
    (input as { pause?: () => void }).pause?.();
  }
}
