import {
  BARE_MENTION_REPLY,
  MAX_MENTION_FANOUT,
  MENTION_DM_NOTICE,
  mentionHelpText,
  shouldHelpUnknown,
  parseMentions,
  plannerIntent,
  type AgentAlias,
  type ChatId,
  type InboundMessage,
  type OutboundMessage,
  type ParsedMentions,
  type Skill,
} from '@squad/core';
import { decide, clampScore } from './policy';
import { formatPersonaText, getPersona } from './persona';
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
  /** Display names of the people in a chat (a human-name tag like `@jamie` must never get a help DM). */
  memberNames?: (chatId: ChatId, from: string) => string[];
}

const DEDUPE_WINDOW_MS = 60_000;
const HELP_COOLDOWN_MS = 60_000;
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
  const helped = new Map<string, number>();

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

  /** One addressed agent: always replies, whatever the speaking-policy score says. */
  async function runTarget(
    m: InboundMessage,
    t: { agent: AgentAlias; alias: string },
    rest: string,
    messageId: number,
  ): Promise<OutboundMessage[]> {
    const { agent } = t;
    const who = `student:${m.from}`;
    emit({
      t: 'agent.state',
      agent: who,
      state: 'studying',
      thought: `Addressed @${t.alias} (${agent.name})`,
      work: { skill: agent.id },
    });
    try {
      const personaId = agent.kind === 'persona' ? agent.personaId : 'cubbie';
      if (rest.length === 0) {
        return await sendAll([{ chatId: m.chatId, text: BARE_MENTION_REPLY, personaId }]);
      }
      if (agent.kind === 'router') {
        const m2 = { ...m, text: m.text, mentionsBot: true };
        const scores = await scoreSkills(d.skills, m2, d.ctx, scoreTimeout);
        const decision = decide(m2, scores, { now: d.now() }, d.policy);
        if (decision.action !== 'run') return [];
        return await runSkill(
          m2,
          { ...decision, reason: 'mentioned', unprompted: false },
          messageId,
        );
      }
      if (agent.id === 'planner' && plannerIntent(rest) === 'studyplan') {
        // The planner persona routes a study-plan request to the shared study-plan flow (trips are started by the hub).
        const plan = bySkill.get('sharedPlan');
        if (plan) {
          const m2 = { ...m, text: `@cubbie ${rest}`, mentionsBot: true };
          const decision: Decision = {
            action: 'run',
            reason: 'mentioned',
            skill: plan.name,
            scores: [],
            mentioned: true,
            unprompted: false,
          };
          return await runSkill(m2, decision, messageId);
        }
      }
      if (agent.kind === 'persona') {
        const p = getPersona(agent.personaId);
        try {
          const r = await d.ctx.llm.complete({
            model: 'fast',
            system: p.systemPrompt,
            messages: rest,
            maxTokens: 300,
          });
          const text = r.text.trim() || `${agent.name} here. Ask me again in a moment.`;
          return await sendAll([{ chatId: m.chatId, text, personaId: agent.personaId }]);
        } catch (err) {
          d.log.error({ agent: agent.id, err: (err as Error).message }, 'persona reply failed');
          return await sendAll([{ chatId: m.chatId, text: APOLOGY, personaId: agent.personaId }]);
        }
      }
      const skill = agent.skill ? bySkill.get(agent.skill) : undefined;
      if (!skill)
        return await sendAll([
          { chatId: m.chatId, text: `@${t.alias} is not available right now. Try @cubbie.` },
        ]);
      const m2 = {
        ...m,
        text: `@cubbie ${agent.keyword ?? ''} ${rest}`.replace(/\s+/g, ' ').trim(),
        mentionsBot: true,
      };
      const decision: Decision = {
        action: 'run',
        reason: 'mentioned',
        skill: skill.name,
        scores: [],
        mentioned: true,
        unprompted: false,
      };
      return await runSkill(m2, decision, messageId);
    } finally {
      emit({ t: 'agent.state', agent: who, state: 'idle' });
    }
  }

  /** Unknown `@word`: a short help to the sender only (a DM in groups), rate limited per sender. */
  async function unknownHelp(m: InboundMessage, word: string): Promise<OutboundMessage[]> {
    const t = d.now();
    for (const [k, at] of helped) if (t - at > HELP_COOLDOWN_MS) helped.delete(k);
    if (helped.has(m.from)) return [];
    helped.set(m.from, t);
    const clean = word.replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 24);
    const dm = m.isGroup ? d.transport.dmChatId(m.from) : m.chatId;
    const out = await sendAll([{ chatId: dm, text: mentionHelpText(clean), personaId: 'cubbie' }]);
    if (m.isGroup && out.length)
      out.push(
        ...(await sendAll([{ chatId: m.chatId, text: MENTION_DM_NOTICE, personaId: 'cubbie' }])),
      );
    return out;
  }

  async function mentionFlow(m: InboundMessage, pm: ParsedMentions): Promise<RouteResult> {
    const prevChain = chains.get(m.chatId) ?? Promise.resolve();
    const step = prevChain.then(async () => {
      const messageId = saveInbound(d.db, m, d.transport.name);
      const targets = pm.mentions.slice(0, MAX_MENTION_FANOUT);
      const sent: OutboundMessage[] = [];
      for (const t of targets) sent.push(...(await runTarget(m, t, pm.rest, messageId)));
      const names = d.memberNames?.(m.chatId, m.from) ?? [];
      const unk = pm.unknownMention.find((u) => shouldHelpUnknown(m.text, u.word, names));
      if (unk) sent.push(...(await unknownHelp(m, unk.word)));
      const decision: Decision = targets.length
        ? {
            action: 'run',
            reason: 'mentioned',
            skill: targets[0]!.agent.skill ?? targets[0]!.agent.id,
            scores: [],
            mentioned: true,
            unprompted: false,
          }
        : {
            action: 'quiet',
            reason: 'unknown_mention',
            scores: [],
            mentioned: true,
            unprompted: false,
          };
      setDecision(d.db, messageId, { ...decision, spoke: sent.length > 0 } as Decision);
      return { decision, sent };
    });
    chains.set(
      m.chatId,
      step.catch(() => undefined),
    );
    return step;
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

      const pm = parseMentions(m.text);
      // `@cubbie <text>` alone is the classic path (scored, decided, recorded); anything else typed goes to the mention flow.
      const plain =
        pm.unknownMention.length === 0 &&
        pm.mentions.length === 1 &&
        pm.mentions[0]!.agent.kind === 'router' &&
        pm.rest.length > 0;
      if (!plain && (pm.mentions.length || pm.unknownMention.length))
        return await mentionFlow(m, pm);
      if (plain && !m.mentionsBot) m = { ...m, mentionsBot: true };

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
