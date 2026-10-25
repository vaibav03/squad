import { randomUUID } from 'node:crypto';
import type { Ctx, InboundMessage, OutboundMessage, Skill } from '@squad/core';
import type { ProactiveApi } from '../nudges/api';
import { cancelPactJobs } from './handlers';
import {
  COMMIT_RE,
  MAX_AHEAD_MS,
  cleanTask,
  parseCommitment,
  scanDeadline,
  stripAddress,
} from './parse';
import {
  awaitingOf,
  ensurePactSchema,
  getPact,
  ownPacts,
  setAwaiting,
  setDeadline,
  setStatus,
} from './store';

export interface PactSkillDeps {
  api: ProactiveApi;
  defaultTz?: string;
}

const LIST_RE = /\b(?:my\s+(?:pinky\s+)?promises|list\s+(?:my\s+)?promises)\b/i;
const CANCEL_RE = /\bcancel\s+(?:my\s+)?(?:pinky\s+)?promise(?:\s+#?(\d+))?/i;
const PINKY_RE = /\bpinky\s+promise\b/i;
export const GROUP_DM_TEXT = 'Sent you a DM.';

export function createPactSkill(deps: PactSkillDeps): Skill {
  const { api } = deps;
  const tzOf = (s: string) => api.prefs(s).tz || deps.defaultTz || 'UTC';
  const awaiting = (ctx: Ctx, m: InboundMessage) =>
    !m.isGroup ? awaitingOf(ctx.db, m.from) : undefined;

  return {
    name: 'pact',
    async match(m, ctx) {
      if (!m.mentionsBot) return 0;
      const t = stripAddress(m.text);
      if (LIST_RE.test(m.text) || CANCEL_RE.test(m.text)) return 0.9;
      if (PINKY_RE.test(m.text)) return 0.9;
      const hasDeadline = !!scanDeadline(t, m.ts, tzOf(m.from));
      if (COMMIT_RE.test(t) && hasDeadline) return 0.9;
      if (!m.isGroup && hasDeadline) {
        try {
          ensurePactSchema(ctx.db);
          if (awaiting(ctx, m)) return 0.95;
        } catch {
          return 0;
        }
      }
      return 0;
    },

    async handle(m, ctx): Promise<OutboundMessage[]> {
      ensurePactSchema(ctx.db);
      const reply = (text: string): OutboundMessage[] => [{ chatId: m.chatId, text }];
      const tz = tzOf(m.from);
      const now = m.ts;

      // answer to "Change deadline"
      const aw = awaiting(ctx, m);
      if (aw && !LIST_RE.test(m.text) && !CANCEL_RE.test(m.text) && !PINKY_RE.test(m.text)) {
        const d = scanDeadline(stripAddress(m.text), now, tz);
        const p = getPact(ctx.db, aw);
        if (p && p.student === m.from && d) {
          if (d.at <= now || d.at - now > MAX_AHEAD_MS)
            return reply('I need a deadline between now and 60 days from now. Try "Friday 5pm".');
          setAwaiting(ctx.db, m.from, null, now);
          setDeadline(ctx.db, p.id, d.at, now);
          api.schedule({
            key: `pact:${p.id}:confirm:${d.at}`,
            kind: 'pact.confirm',
            student: m.from,
            scope: 'dm',
            runAt: now,
            payload: { pactId: p.id },
          });
          api.kick();
          return reply('Got it. One more confirm coming.');
        }
      }

      if (LIST_RE.test(m.text)) {
        const rows = ownPacts(ctx.db, m.from, ['active', 'pending_confirm']);
        const text = rows.length
          ? 'Your promises:\n' +
            rows
              .map(
                (p, i) =>
                  `${i + 1}. ${p.text} (by ${new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(p.deadline))})${p.status === 'pending_confirm' ? ' [unconfirmed]' : ''}`,
              )
              .join('\n')
          : 'You have no open promises.';
        if (!m.isGroup) return reply(text);
        await ctx.dm(m.from, text);
        return reply(GROUP_DM_TEXT);
      }

      const cm = CANCEL_RE.exec(m.text);
      if (cm) {
        const rows = ownPacts(ctx.db, m.from, ['active', 'pending_confirm']);
        const p = cm[1] ? rows[Number(cm[1]) - 1] : rows[rows.length - 1];
        if (!p) return reply(m.isGroup ? GROUP_DM_TEXT : 'You have no open promises to cancel.');
        setStatus(ctx.db, p.id, 'cancelled', now);
        setAwaiting(ctx.db, m.from, null, now);
        cancelPactJobs(api, p);
        if (!m.isGroup) return reply(`Cancelled: "${p.text}".`);
        await ctx.dm(m.from, `Cancelled: "${p.text}".`);
        return reply(GROUP_DM_TEXT);
      }

      const c = parseCommitment(m.text);
      if (!c) return reply('What are you promising? Try: @squad I will finish ch6 by Friday.');
      const d = scanDeadline(c.withDeadline, now, tz);
      if (!d)
        return reply(
          'When by? Add a deadline, like "by Friday" or "tomorrow 5pm", and I will hold you to it.',
        );
      if (d.at <= now || d.at - now > MAX_AHEAD_MS)
        return reply(
          'I need a deadline between now and 60 days from now. Could you say it more clearly, like "by Friday 5pm"?',
        );
      const task = cleanTask(d.rest);
      if (!task) return reply('What are you promising? Try: @squad I will finish ch6 by Friday.');

      const name =
        (
          ctx.db.prepare('SELECT name FROM students WHERE id=?').get(m.from) as
            { name: string } | undefined
        )?.name ?? m.from;
      const ack = m.isGroup
        ? `Got it, ${name}. I will DM you to lock it in.`
        : 'Got it. Confirming in a sec.';
      const dup = ownPacts(ctx.db, m.from, ['pending_confirm', 'active']).find(
        (p) => p.text.toLowerCase() === task.toLowerCase() && p.deadline === d.at,
      );
      if (dup) return reply(ack);
      const id = randomUUID().slice(0, 8);
      ctx.db
        .prepare(
          `INSERT INTO pacts(id, student, chat_id, text, deadline, status, created_at, updated_at, extended)
           VALUES(?,?,?,?,?,'pending_confirm',?,?,0)`,
        )
        .run(id, m.from, m.chatId, task, d.at, now, now);
      api.schedule({
        key: `pact:${id}:confirm`,
        kind: 'pact.confirm',
        student: m.from,
        scope: 'dm',
        runAt: now,
        payload: { pactId: id },
      });
      api.kick();
      return reply(ack);
    },
  };
}
