import type { ChatId, InboundMessage, OutboundMessage, Skill } from '@squad/core';
import { decide, clampScore } from './policy';
import { formatPersonaText } from './persona';
import { clip } from './log';
import { lastUnpromptedAt, saveInbound, saveOutbound, setDecision } from './store';
import type {
  BotCtx,
  ConfirmApi,
  Decision,
  EventPublisher,
  Logger,
  PolicyConfig,
  RouteResult,
  SkillScore,
  Transport,
} from './types';
import type { Db } from '@squad/core';

export interface RouterDeps {
  db: Db;
  skills: Skill[];
  transport: Transport;
  ctx: BotCtx;
  confirms: ConfirmApi;
  events: EventPublisher;
  log: Logger;
  now: () => number;
  policy?: Partial<PolicyConfig>;
  scoreTimeoutMs?: number;
}

const DEDUPE_WINDOW_MS = 60_000;
const APOLOGY = 'Sorry, something went wrong on my side. Try again in a moment.';

export async function scoreSkills(
  skills: Skill[],
  m: InboundMessage,
  ctx: BotCtx,
  timeoutMs: number,
): Promise<SkillScore[]> {
  return Promise.all(
    skills.map(async (s): Promise<SkillScore> => {
      const t0 = performance.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<'timeout'>((r) => {
          timer = setTimeout(() => r('timeout'), timeoutMs);
        });
        const r = await Promise.race([Promise.resolve().then(() => s.match(m, ctx)), timeout]);
        const ms = Math.round(performance.now() - t0);
        if (r === 'timeout') return { skill: s.name, score: 0, ms, timedOut: true };
        return { skill: s.name, score: clampScore(r), ms };
      } catch (e) {
        return {
          skill: s.name,
          score: 0,
          ms: Math.round(performance.now() - t0),
          error: (e as Error).message,
        };
      } finally {
        if (timer) clearTimeout(timer);
      }
    }),
  );
}

export function createRouter(d: RouterDeps) {
  const scoreTimeout = d.scoreTimeoutMs ?? 1500;
  const seen = new Map<string, number>();
  const lastUnprompted = new Map<ChatId, number>();
  const chains = new Map<ChatId, Promise<unknown>>();
  const bySkill = new Map(d.skills.map((s) => [s.name, s]));

  const quiet = (reason: Decision['reason'], mentioned: boolean): RouteResult => ({
    decision: { action: 'quiet', reason, scores: [], mentioned, unprompted: false },
    sent: [],
  });

  /** Fire-and-forget: a slow or absent hub must never delay a chat reply. */
  function emit(e: Parameters<EventPublisher['publish']>[0]): void {
    d.events
      .publish(e)
      .catch((err: Error) => d.log.error({ err: err.message }, 'event publish failed'));
  }

  async function sendAll(out: OutboundMessage[]): Promise<OutboundMessage[]> {
    const sent: OutboundMessage[] = [];
    for (const o of out) {
      if (!o.text && !(o.attachments && o.attachments.length)) continue;
      const msg = o.text ? { ...o, text: formatPersonaText(o.personaId, o.text) } : o;
      try {
        await d.transport.send(msg);
        saveOutbound(d.db, msg, d.now());
        sent.push(msg);
      } catch (err) {
        d.log.error({ chatId: o.chatId, err: (err as Error).message }, 'send failed');
      }
    }
    return sent;
  }

  /** Serial per chat: persist, score, decide, claim the unprompted slot. Skill execution is NOT serialized. */
  async function decideStep(m: InboundMessage) {
    const messageId = saveInbound(d.db, m, d.transport.name);
    const scores = await scoreSkills(d.skills, m, d.ctx, scoreTimeout);
    const now = d.now();
    const prev = lastUnprompted.get(m.chatId) ?? lastUnpromptedAt(d.db, m.chatId);
    const decision = decide(m, scores, { lastUnpromptedAt: prev, now }, d.policy);
    if (decision.action === 'run' && decision.unprompted) lastUnprompted.set(m.chatId, now);
    setDecision(d.db, messageId, { ...decision, spoke: false } as Decision);
    d.log.info(
      {
        chatId: m.chatId,
        from: m.from,
        text: clip(m.text),
        mentioned: decision.mentioned,
        best: decision.best,
        reason: decision.reason,
        action: decision.action,
        scores: scores.map((s) => [s.skill, s.score]),
      },
      decision.action === 'run'
        ? `routing to ${decision.skill}`
        : `stayed quiet (best=${decision.best?.skill}, ${decision.best?.score.toFixed(2)})`,
    );
    return { messageId, decision, prev };
  }

  async function runSkill(m: InboundMessage, decision: Decision, messageId: number, prev?: number) {
    const skill = bySkill.get(decision.skill!)!;
    const agent = `student:${m.from}`;
    emit({ t: 'agent.state', agent, state: 'studying' });
    let sent: OutboundMessage[] = [];
    let error: string | undefined;
    try {
      const out = await skill.handle(m, d.ctx);
      sent = await sendAll(out ?? []);
    } catch (err) {
      error = (err as Error).message;
      d.log.error({ skill: skill.name, chatId: m.chatId, err: error }, 'skill handler failed');
      if (!decision.unprompted) sent = await sendAll([{ chatId: m.chatId, text: APOLOGY }]);
    } finally {
      emit({ t: 'agent.state', agent, state: 'idle' });
    }
    const spoke = sent.length > 0;
    if (decision.unprompted && !spoke) {
      // nothing went out: release the claimed slot
      if (prev === undefined) lastUnprompted.delete(m.chatId);
      else lastUnprompted.set(m.chatId, prev);
    }
    setDecision(d.db, messageId, { ...decision, spoke, error } as Decision);
    return sent;
  }

  async function handle(m: InboundMessage): Promise<RouteResult> {
    try {
      if (m.from === 'bot') return quiet('own_message', false);
      const key = `${m.chatId}|${m.from}|${m.ts}|${m.text}`;
      const t = d.now();
      for (const [k, at] of seen) if (t - at > DEDUPE_WINDOW_MS) seen.delete(k);
      if (seen.has(key)) return quiet('duplicate', m.mentionsBot);
      seen.set(key, t);

      if (!m.isGroup && d.confirms.tryConsume(m)) {
        const id = saveInbound(d.db, m, d.transport.name);
        const decision = { ...quiet('confirm_reply', true).decision };
        setDecision(d.db, id, decision);
        d.log.info({ from: m.from }, 'DM consumed by pending confirm');
        return { decision, sent: [] };
      }

      const prevChain = chains.get(m.chatId) ?? Promise.resolve();
      const step = prevChain.then(() => decideStep(m));
      chains.set(
        m.chatId,
        step.catch(() => undefined),
      );
      const { messageId, decision, prev } = await step;
      if (decision.action !== 'run') return { decision, sent: [] };
      const sent = await runSkill(m, decision, messageId, prev);
      return { decision, sent };
    } catch (err) {
      d.log.error({ err: (err as Error).message }, 'router failure');
      return quiet('no_skills', m.mentionsBot);
    }
  }

  return { handle };
}
