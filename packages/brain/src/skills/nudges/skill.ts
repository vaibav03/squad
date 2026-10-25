import type { Ctx, InboundMessage, OutboundMessage, Skill } from '@squad/core';
import type { ProactiveApi } from './api';
import { ensureStudentJobs, type NudgeDeps } from './handlers';
import { isValidTz, localDayRange, formatLocal } from './time';

export const NUDGE_GROUP_TEXT = 'Sent you a DM.';

const STOP =
  /\b(stop|no more|disable|turn off|cancel)\s+(the\s+)?(nudg(?:es|ing)(?:\s+me)?|reminders?)\b/i;
const START =
  /\b(start|resume|enable|turn on)\s+(the\s+)?(nudg(?:es|ing)|reminders?)\b|\bnudge me\b|\bopt in\b/i;
const SNOOZE = /\bsnooze\b/i;
const UNSNOOZE = /\b(unsnooze|wake me|end snooze)\b/i;
const STATUS = /\bnudge(?:s)?\s+status\b|\bam i (?:opted|signed) (?:in|up)\b/i;
const TZ =
  /\b(?:my\s+(?:time\s*zone|tz)\s+is|set\s+(?:my\s+)?(?:time\s*zone|tz)(?:\s+to)?|i(?:'|’)?m in)\s+([A-Za-z_]+(?:\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)?|[A-Za-z]{2,4})\b/i;

const TZ_ALIASES: Record<string, string> = {
  et: 'America/New_York',
  est: 'America/New_York',
  edt: 'America/New_York',
  ct: 'America/Chicago',
  cst: 'America/Chicago',
  mt: 'America/Denver',
  mst: 'America/Denver',
  pt: 'America/Los_Angeles',
  pst: 'America/Los_Angeles',
  pdt: 'America/Los_Angeles',
  ist: 'Asia/Kolkata',
  gmt: 'Europe/London',
  uk: 'Europe/London',
  bst: 'Europe/London',
  cet: 'Europe/Paris',
  utc: 'UTC',
  jst: 'Asia/Tokyo',
  aest: 'Australia/Sydney',
};

/** "2h", "30 min", "1 day", "until tomorrow", "a week" to milliseconds from now; undefined if unclear. */
export function parseSnooze(text: string, now: number, tz: string): number | undefined {
  const t = text.toLowerCase();
  const m = /(\d+(?:\.\d+)?|an?|one)\s*(m|mins?|minutes?|h|hrs?|hours?|d|days?|w|weeks?)\b/.exec(t);
  if (m) {
    const n = /^an?$|^one$/.test(m[1]!) ? 1 : Number(m[1]);
    const u = m[2]![0]!;
    const ms = u === 'm' ? 60_000 : u === 'h' ? 3_600_000 : u === 'd' ? 86_400_000 : 7 * 86_400_000;
    const d = n * ms;
    return d > 0 && d <= 30 * 86_400_000 ? now + d : undefined;
  }
  if (/\b(until|till|til)\s+tomorrow\b|\bfor the night\b|\btonight\b/.test(t)) {
    return localDayRange(now, tz, 1)[0] + 8 * 3_600_000; // tomorrow 08:00 local (DST drift under 1 h is fine)
  }
  if (/\bweekend\b/.test(t)) return now + 2 * 86_400_000;
  return undefined;
}

export function parseTz(text: string): string | undefined {
  const m = TZ.exec(text);
  if (!m) return undefined;
  const raw = m[1]!;
  const alias = TZ_ALIASES[raw.toLowerCase()];
  if (alias) return alias;
  return isValidTz(raw) ? raw : undefined;
}

export interface NudgeControlDeps {
  api: ProactiveApi;
  /** When given, opting in or changing time zone (re)creates the student's study jobs right away. */
  nudges?: NudgeDeps;
}

type Cmd = 'stop' | 'start' | 'snooze' | 'unsnooze' | 'status' | 'tz';

export function classify(text: string): Cmd | undefined {
  if (STOP.test(text)) return 'stop';
  if (UNSNOOZE.test(text)) return 'unsnooze';
  if (SNOOZE.test(text)) return 'snooze';
  if (STATUS.test(text)) return 'status';
  if (TZ.test(text)) return 'tz';
  if (START.test(text)) return 'start';
  return undefined;
}

/** Chat controls for proactive behavior: snooze 2h, stop nudges, start nudges, nudge status, my timezone is X. */
export function createNudgeControlSkill(deps: NudgeControlDeps): Skill {
  const { api } = deps;
  const jobsFor = (s: string) =>
    api.list({ student: s, kindPrefix: 'nudge.', status: 'pending' }).length;
  return {
    name: 'nudges',
    async match(m: InboundMessage) {
      return m.mentionsBot && classify(m.text) ? 0.9 : 0;
    },
    async handle(m: InboundMessage, ctx: Ctx): Promise<OutboundMessage[]> {
      const cmd = classify(m.text)!;
      const s = m.from;
      const p = api.prefs(s);
      let reply: string;
      switch (cmd) {
        case 'stop':
          api.setPrefs(s, { optedOut: true, snoozeUntil: null });
          reply =
            'Done. No more nudges, reminders or check-ins from me. Say "start nudges" if you change your mind.';
          break;
        case 'start': {
          api.setPrefs(s, { optIn: true, snoozeUntil: null });
          if (deps.nudges) ensureStudentJobs(deps.nudges, s);
          reply = `Nudges are on. I will check in around 9 pm (${api.prefs(s).tz}) when something is due tomorrow, and remind you when chapters are due for review. Say "snooze 2h" or "stop nudges" any time.`;
          break;
        }
        case 'snooze': {
          const until = parseSnooze(m.text, api.now(), p.tz);
          if (!until) {
            reply =
              'How long? Try "snooze 2h", "snooze 30 min", "snooze 1 day" or "snooze until tomorrow".';
            break;
          }
          api.setPrefs(s, { snoozeUntil: until });
          reply = `Snoozed until ${formatLocal(until, p.tz)}. I will stay quiet until then.`;
          break;
        }
        case 'unsnooze':
          api.setPrefs(s, { snoozeUntil: null });
          reply = 'Snooze cleared.';
          break;
        case 'tz': {
          const tz = parseTz(m.text);
          if (!tz) {
            reply =
              'I did not recognise that time zone. Try a name like "America/Chicago" or "my timezone is PT".';
            break;
          }
          api.setPrefs(s, { tz });
          if (deps.nudges) ensureStudentJobs(deps.nudges, s);
          reply = `Time zone set to ${tz}. Check-ins follow your local time.`;
          break;
        }
        case 'status': {
          const state = p.optedOut
            ? 'off (you said stop)'
            : p.optIn
              ? 'on'
              : 'off (say "start nudges" to opt in)';
          const snooze = p.snoozeUntil ? `, snoozed until ${formatLocal(p.snoozeUntil, p.tz)}` : '';
          reply = `Nudges: ${state}${snooze}. Time zone ${p.tz}. Quiet hours ${p.quiet.start}-${p.quiet.end}. ${jobsFor(s)} scheduled.`;
          break;
        }
      }
      if (m.isGroup) {
        await ctx.dm(s, reply);
        return [{ chatId: m.chatId, text: NUDGE_GROUP_TEXT }];
      }
      return [{ chatId: m.chatId, text: reply }];
    },
  };
}
