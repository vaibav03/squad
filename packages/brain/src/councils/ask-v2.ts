import {
  type AgentId,
  type AgentMode,
  type CouncilAction,
  type CouncilConfidence,
  type CouncilMemberResult,
  type CouncilResult,
  type CouncilVerdict,
  type Llm,
} from '@squad/core';
import { createCoursePorts, withContextPorts } from '../agents/course-port';
import type { RetrieveContext } from '../context/retrieve';
import type { CouncilAgents } from '../agents/factory';
import type { AgentRun } from '../agents/runtime';
import type { AgentTurn, CouncilDataPorts } from '../agents/types';
import { isGradedGrab, stripMention } from '../experts/intent';
import type { Brain } from '../experts/types';
import { publishActionTitles } from './action-items';
import { askRoster } from './ask-agents';
import { CHAIR_NAME, RANK_TASK, TRIAGE_SYSTEM, TriageSchema } from './ask-prompts';
import {
  COUNCIL_AGENT,
  NOT_COVERED_NOTE,
  REFUSE_GRADED,
  REFUSE_OFF_TOPIC,
  anonymise,
  outcomeOf,
  withTimeout,
} from './ask-run';
import type {
  CouncilAskInput,
  CouncilEmit,
  CouncilLimits,
  LiveCouncilFactory,
  LiveCouncilHandle,
} from './ask-types';
import { aggregateRankings, normaliseText } from './pure';

/** What the hub can say about the asker, only through the privacy gate (aggregates, words). */
export interface AskViewerData {
  calendarSummary?: CouncilDataPorts['calendarSummary'];
  masterySummary?: CouncilDataPorts['masterySummary'];
  /** The asker's imported Canvas/Google context (viewer-bound; squad-visible runs see only what the squad may read). */
  context?: RetrieveContext;
  /** Private strings (event titles, amounts) that must never reach public text. */
  needles?: string[];
}

export interface AskV2Deps {
  agents: CouncilAgents;
  emit: CouncilEmit;
  brain?: Brain;
  courseId: string;
  now: () => number;
  limits: CouncilLimits;
  /** Called with a fresh copy after every change to the result. */
  publish(r: CouncilResult): void;
  /** Viewer-scoped data ports for the asker. */
  viewer?: (askedBy: string, visibility: 'squad' | 'private') => AskViewerData | undefined;
  /** Specialist keys to seat (default all; env COUNCIL_ASK_MEMBERS=skeptic,teacher caps real-run spend). */
  members?: string[];
  /** The raw real model, only used for the one cheap live triage call. */
  triageLlm?: Llm;
  /** Per-run Gemini Live council (hub). */
  live?: LiveCouncilFactory;
  defaultTransport?: () => 'stream' | 'live';
}

const cut = (s: string, n: number): string =>
  s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}.`;
const firstSentence = (s: string): string => /^.*?[.!?](?:\s|$)/s.exec(s.trim())?.[0].trim() ?? s;
const list = (xs: string[]): string =>
  xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
const nameKey = (s: string): string => s.trim().toLowerCase();

const HALT_TEXT: Record<string, string> = {
  credits_depleted: 'The council paused because the model credits are depleted.',
  invalid_key: 'The council could not reach its model (the key was rejected).',
  budget: 'The council stopped at its run budget.',
};

/**
 * The Ask council on real agents (COUNCIL_AGENTS=v2): the orchestration loop is code, every participant is a
 * distinct agent with its own system instruction and tools (agents/runtime.ts). Stages: question, delegation,
 * opinions, critiques, dissent, verdict, actions, done. The run mode is decided ONCE here and only worsens.
 * Never throws.
 */
export async function runAskV2(
  d: AskV2Deps,
  r: CouncilResult,
  input: CouncilAskInput,
): Promise<void> {
  const q = stripMention(input.question).trim() || input.question.trim();
  const priv = r.visibility === 'private';
  const safeEmit = async (e: Parameters<CouncilEmit>[0]): Promise<void> => {
    try {
      await d.emit(e);
    } catch (err) {
      console.warn(`[${COUNCIL_AGENT}] emit failed`, (err as Error).message);
    }
  };
  const change = (fn: (r: CouncilResult) => void): void => {
    fn(r);
    d.publish(r);
  };
  const finish = (status: CouncilResult['status'], message?: string): void =>
    change((x) => {
      x.status = status;
      x.phase = 'done';
      x.finishedAt = d.now();
      if (message) x.message = message;
    });

  let run: AgentRun | undefined;
  let liveHandle: LiveCouncilHandle | undefined;
  let studying = false;
  const idle = async (): Promise<void> => {
    if (studying) await safeEmit({ t: 'agent.state', agent: COUNCIL_AGENT, state: 'idle' });
    studying = false;
  };

  try {
    if (isGradedGrab(q)) return finish('refused', REFUSE_GRADED);

    // THE decision point: once, here. Everything after carries this mode and can only worsen it.
    const mode: AgentMode = d.agents.decideMode();
    const demo = mode.startsWith('demo');
    change((x) => {
      x.mode = mode;
      x.demo = demo;
      x.stage = 'question';
    });
    if (!d.agents.tryStart()) {
      return finish('failed', 'The council is at its hourly limit. Try again a bit later.');
    }
    if (!demo && d.triageLlm) {
      try {
        const t = await withTimeout(
          (signal) =>
            d.triageLlm!.json({
              model: 'fast',
              system: TRIAGE_SYSTEM,
              messages: `Question: ${q}`,
              schema: TriageSchema,
              temperature: 0,
              signal,
            }),
          d.limits.callTimeoutMs,
        );
        if (!t.study) return finish('refused', REFUSE_OFF_TOPIC);
      } catch {
        // triage unavailable: let the council decide
      }
    }

    // data ports: verified course retrieval + the asker's own data through the gate
    let grounded = false;
    const viewer = d.viewer?.(input.askedBy, r.visibility);
    const course = withContextPorts(
      d.brain ? createCoursePorts(d.brain, input.courseId ?? d.courseId) : undefined,
      viewer?.context,
    );
    const ports: CouncilDataPorts = {
      ...(course
        ? {
            async retrieve(query: string) {
              const res = await course.retrieve(query);
              if (res.grounded) grounded = true;
              return res;
            },
            verify: course.verify,
          }
        : {}),
      ...(viewer?.calendarSummary ? { calendarSummary: viewer.calendarSummary } : {}),
      ...(viewer?.masterySummary ? { masterySummary: viewer.masterySummary } : {}),
    };
    const roster = askRoster({
      calendar: !!ports.calendarSummary,
      mastery: !!ports.masterySummary,
      ...(d.members?.length ? { members: d.members } : {}),
    });
    const chair = roster.find((s) => s.role === 'chair')!;
    const members = roster.filter((s) => s.role === 'specialist');
    const sync = (): void =>
      change((x) => {
        if (!run) return;
        x.mode = run.mode();
        x.stage = run.currentStage();
        x.agents = run.agents();
        x.messages = run.messages();
        x.transport = resultTransport;
      });
    // ---- transport: Gemini Live when asked for AND every participant's session opens; otherwise the streaming
    // transport with a label that says why (never a silent swap, never scripted under a live label)
    let agents = d.agents;
    const requested = input.transport ?? d.defaultTransport?.() ?? 'stream';
    let tlabel: { label: string; requested?: 'stream' | 'live'; why?: string } | undefined;
    let models: { who: string; model: string }[] | undefined;
    if (!demo && requested === 'live') {
      let why = 'live_not_configured';
      const h = d.live?.({ id: r.id, askedBy: input.askedBy, visibility: r.visibility });
      if (h && !('unavailable' in h)) {
        const pre = await h.prepare(roster);
        if (pre.ok) {
          liveHandle = h;
          agents = h.agents;
          models = pre.models;
          tlabel = { label: 'Gemini Live (audio + transcript)', requested: 'live' };
        } else {
          why = pre.why;
          h.close();
        }
      } else if (h) why = h.unavailable;
      if (!liveHandle)
        tlabel = {
          label: `Gemini streaming (Live unavailable: ${why.replace(/_/g, ' ')})`,
          requested: 'live',
          why,
        };
    } else if (demo) {
      tlabel = {
        label: 'Demo (scripted, not Gemini)',
        ...(requested === 'live' ? { requested } : {}),
      };
    }
    const liveSpeech = agents.kind === 'live-audio';
    const resultTransport: CouncilResult['transport'] = {
      kind: demo ? 'demo' : liveSpeech ? 'live-audio' : 'stream-text',
      label: tlabel?.label ?? 'Gemini streaming text',
      ...(tlabel?.requested ? { requested: tlabel.requested } : {}),
      ...(tlabel?.why ? { why: tlabel.why.slice(0, 80) } : {}),
      ...(models?.length ? { models } : {}),
    };
    change((x) => void (x.transport = resultTransport));
    run = agents.runtime.startRun({
      correlationId: r.id,
      councilKey: 'ask',
      mode,
      visibility: r.visibility,
      owner: { askedBy: input.askedBy },
      question: q,
      ...(tlabel ? { transportLabel: tlabel } : {}),
      ...(course ? { prefetchQuery: q } : {}),
      roster,
      ports,
      ...(viewer?.needles?.length ? { privateNeedles: viewer.needles } : {}),
      onChange: sync,
    });
    const R = run;

    await safeEmit({ t: 'agent.state', agent: COUNCIL_AGENT, state: 'studying' });
    studying = true;

    // ---- delegation: the Chair (a real agent) delegates; code fills in anyone the model skipped
    await R.stage('delegation');
    const planCtx = { stage: 'plan', question: q };
    const plan = await R.callAgent(chair, {
      kind: 'status',
      stage: 'delegation',
      to: 'room',
      depth: 0,
      temperature: 0.2,
      endAfterTools: {
        summary: `Delegated to ${list(members.map((m) => `the ${m.displayName}`))}.`,
      },
      context: planCtx,
      prompt: `Question from a student:\n${q}\n\nDelegate to your specialists now (one delegate call each for ${members
        .map((m) => m.key)
        .join(', ')}), then submit your plan.`,
    });
    if (plan.status !== 'done') R.degrade(chair.id, plan.reason ?? 'chair_failed');
    for (const m of members) {
      if (R.answerOf(m.id) || R.failureOf(m.id) || R.haltReason()) continue;
      await R.delegateByCode(
        m,
        q,
        `The chair could not delegate to the ${m.displayName}, so this is asked directly.`,
      );
    }
    await R.stage('opinions');

    const answeredTurns = members
      .map((m) => R.answerOf(m.id))
      .filter((t): t is AgentTurn => !!t && t.status === 'done' && !!t.turn);
    const failedMembers = members.filter((m) => !R.answerOf(m.id));
    change((x) => {
      x.grounding = grounded ? 'course' : 'none';
      x.phase = 'opinions';
      if (!grounded)
        x.notes.push(
          d.brain
            ? NOT_COVERED_NOTE
            : 'No course materials are loaded, so this is general reasoning.',
        );
    });

    const toMember = (t: AgentTurn): CouncilMemberResult => ({
      id: t.agent.key,
      name: t.agent.displayName,
      stance: t.turn!.stance || t.agent.stance,
      status: 'answered',
      text: t.turn!.summary,
      answer: t.turn!.answer || cut(firstSentence(t.turn!.summary), 240),
      citations: t.citations.slice(0, 8),
      struck: t.struck,
    });
    const answered = answeredTurns.map(toMember);
    for (const m of failedMembers) {
      change((x) =>
        x.members.push({
          id: m.key,
          name: m.displayName,
          stance: m.stance,
          status: 'failed',
          text: '',
          answer: '',
          citations: [],
          struck: 0,
        }),
      );
    }
    for (const t of answeredTurns) {
      const res = toMember(t);
      change((x) => void x.members.push(res));
      await safeEmit({
        t: 'council.opinion',
        councilId: COUNCIL_AGENT,
        member: res.name,
        ...(t.message ? { a2aId: t.message.id } : {}),
        mode: t.mode,
        ...(priv ? {} : { text: res.text }),
      });
    }
    if (failedMembers.length > 0)
      change((x) =>
        x.notes.push(
          `${list(failedMembers.map((m) => m.displayName))} did not answer, so ${answered.length} member${answered.length === 1 ? '' : 's'} voted${
            R.mode().startsWith('degraded')
              ? ` (${R.mode().replace(/_/g, ' ').replace(':', ': ')})`
              : ''
          }.`,
        ),
      );
    if (grounded) {
      const bare = answered.filter((a) => a.citations.length === 0).map((a) => a.name);
      if (bare.length > 0)
        change((x) => void x.notes.push(`${list(bare)} gave no verified citation.`));
    }
    if (answered.length < 2) {
      await idle();
      return finish(
        'failed',
        (R.haltReason() && HALT_TEXT[R.haltReason()!]) ||
          'The council could not meet quorum just now. Try again in a minute, or ask your TA.',
      );
    }

    // ---- critiques: each answered specialist ranks the others anonymously (a real turn, only with 3+ answers)
    // (a spoken Live council has no anonymous rankings: ranks need structured output, so the stage is skipped)
    if (!liveSpeech) await R.stage('critiques');
    change((x) => void (x.phase = 'rankings'));
    const names = answered.map((a) => a.name);
    const byName = new Map(answeredTurns.map((t) => [t.agent.displayName, t]));
    const ranked: { member: string; order: string[] }[] = [];
    if (answered.length >= 3 && !liveSpeech) {
      const rankTurns = await Promise.all(
        answered.map(async (a) => {
          const me = byName.get(a.name)!;
          const others = answered
            .filter((o) => o.name !== a.name)
            .map((o) => ({ member: o.name, o }));
          const labelled = anonymise(r.id, a.name, others);
          const labels = Object.fromEntries(labelled.map((l) => [l.label, l.item.member]));
          const t = await R.callAgent(me.agent, {
            kind: 'rank',
            stage: 'critiques',
            to: 'room',
            depth: 1,
            temperature: 0,
            labels,
            rankNames: others.map((o) => o.member),
            context: { stage: 'rank', question: q },
            extraTools: [],
            prompt: `Now judge your colleagues' anonymous answers to the question. Judge the reasoning only.\n\nQuestion: ${q}\n\n${labelled
              .map((l) => `Response ${l.label}: ${l.item.o.text}\n(answer: ${l.item.o.answer})`)
              .join(
                '\n\n',
              )}\n\n${RANK_TASK}\nCall submit_turn with \`order\` (labels, best first) and a one-sentence \`summary\` of why.`,
          });
          return { a, t };
        }),
      );
      for (const { a, t } of rankTurns) {
        const order = t.status === 'done' ? t.turn?.order : undefined;
        if (!order) continue;
        ranked.push({ member: a.name, order });
        change((x) => void x.rankings.push({ member: a.name, order }));
        await safeEmit({
          t: 'council.rank',
          councilId: COUNCIL_AGENT,
          member: a.name,
          order,
          ...(t.message ? { a2aId: t.message.id } : {}),
          mode: t.mode,
        });
      }
      if (ranked.length < answered.length)
        change((x) => void x.notes.push('Some peer rankings were unavailable.'));
    }
    const consensus = ranked.length > 0 ? aggregateRankings(ranked, names) : names;

    // ---- dissent + verdict
    change((x) => void (x.phase = 'verdict'));
    const top = answered.find((a) => a.name === consensus[0]) ?? answered[0]!;
    const topTurn = byName.get(top.name)!;
    // (a spoken verdict names its dissenter itself: free speech never matches word for word, so no text comparison)
    const against = liveSpeech
      ? []
      : answered.filter((a) => normaliseText(a.answer) !== normaliseText(top.answer));
    if (against.length > 0) await R.stage('dissent');
    const verdictCtx = {
      stage: 'verdict',
      question: q,
      opinions: answeredTurns.map((t) => ({
        name: t.agent.displayName,
        answer: t.turn!.answer ?? '',
        summary: t.turn!.summary,
      })),
      consensus,
    };
    const vt = await R.callAgent(chair, {
      kind: 'verdict',
      stage: 'verdict',
      to: 'room',
      depth: 0,
      temperature: 0,
      publish: false,
      context: verdictCtx,
      prompt: `The specialists have answered. Question: ${q}\n\nGrounding: ${grounded ? 'specialists could cite verified course pages' : 'general reasoning, the course materials do not cover this'}\nPeer ranking, best first: ${consensus.join(', ')}\n\n${answered
        .map((a) => `${a.name} (${a.stance}): ${a.text}\n(answer: ${a.answer})`)
        .join(
          '\n\n',
        )}\n\nGive the verdict now with submit_turn: \`summary\` = the verdict for the student, \`answer\` = the committed short answer, \`confidence\`, \`stance\` = what the student should do next, and \`dissent\` {member, why} if a specialist disagrees.`,
    });
    const out = vt.status === 'done' ? vt.turn : undefined;
    if (!out) R.degrade(chair.id, vt.reason ?? 'chair_failed');
    const chairNote = out
      ? undefined
      : `The chair did not respond, so this is the top-ranked answer (${top.name}).`;

    const nameOf = new Map(answered.map((a) => [nameKey(a.name), a.name]));
    const verdictAnswer = out?.answer?.trim() || top.answer;
    const spokenDissent = liveSpeech ? nameOf.get(nameKey(out?.dissent?.member ?? '')) : undefined;
    let agreeing = answered
      .filter((a) =>
        liveSpeech
          ? a.name !== spokenDissent
          : normaliseText(a.answer) === normaliseText(verdictAnswer),
      )
      .map((a) => a.name);
    if (!out) agreeing = [top.name];
    const dissenters = answered.filter((a) => !agreeing.includes(a.name));
    const dis = dissenters[0];
    const rank: CouncilConfidence[] = ['uncertain', 'fairly_sure', 'confident'];
    let cap: CouncilConfidence = 'confident';
    let note: string;
    if (!out) {
      cap = 'uncertain';
      note = 'The chair was unavailable.';
    } else if (dissenters.length >= 2) {
      cap = 'uncertain';
      note = 'The council split three ways.';
    } else if (dis && !liveSpeech && consensus[0] === dis.name) {
      cap = 'uncertain';
      note = `${dis.name}, the top-ranked member, disagreed with the verdict.`;
    } else if (dis) {
      cap = 'fairly_sure';
      note = `${agreeing.length} of ${answered.length} agreed; ${dis.name} saw it differently.`;
    } else if (answered.length < members.length) {
      cap = 'fairly_sure';
      note = `Both members who answered agreed (${list(failedMembers.map((m) => m.displayName))} did not answer).`;
    } else {
      note =
        members.length === 3
          ? 'All three members agreed.'
          : `All ${members.length} members agreed.`;
    }
    const chairWord = out?.confidence ?? 'uncertain';
    const confidence = rank[Math.min(rank.indexOf(cap), rank.indexOf(chairWord))]!;
    const uncertain = confidence === 'uncertain';
    let next = (out?.stance ?? '').trim();
    if (!next)
      next = grounded
        ? 'Check the cited pages yourself, then try the problem on your own.'
        : 'Try it on a small example yourself to check.';
    if (uncertain && !/\bTA\b/.test(next))
      next = `${next} Check this with your TA before relying on it.`;
    const verdictText = (out?.summary ?? '').trim() || top.text;
    const dissentName = dis
      ? (nameOf.get(nameKey(out?.dissent?.member ?? '')) ?? dis.name)
      : undefined;
    const dissenterTurn = dissentName ? byName.get(dissentName) : undefined;
    const verdict: CouncilVerdict = {
      chair: CHAIR_NAME,
      text: cut(verdictText, 1400),
      answer: cut(verdictAnswer, 240),
      confidence,
      confidenceNote: [note, chairNote].filter(Boolean).join(' '),
      uncertain,
      ...(dis
        ? {
            dissent: {
              member: dis.name,
              view: cut(`${dis.answer}. ${firstSentence(dis.text)}`.replace(/\.\.$/, '.'), 600),
              why: cut(
                (out?.dissent?.why ?? '').trim() ||
                  'The chair weighed the other answers more heavily.',
                400,
              ),
            },
          }
        : {}),
      next: cut(next, 400),
    };

    if (liveSpeech && spokenDissent) await R.stage('dissent');
    await R.stage('verdict');
    const dissentRefs = dissenterTurn?.message ? [dissenterTurn.message.id] : [];
    let verdictMsgId: string | undefined;
    if (out) {
      const m = await R.publishFinal(vt, {
        to: 'room',
        kind: 'verdict',
        stage: 'verdict',
        summary: verdict.text,
        answer: verdict.answer,
        confidence,
        dissentRefs,
      });
      verdictMsgId = m.id;
    } else {
      const m = await R.publishCode({
        from: chair.id,
        to: 'room',
        kind: 'verdict',
        stage: 'verdict',
        summary: verdict.text,
        stance: 'top-ranked answer, chair unavailable',
        answer: verdict.answer,
        confidence,
        dissentRefs,
        citations: topTurn.citations,
        status: 'partial',
      });
      verdictMsgId = m.id;
    }

    await R.stage('actions');
    const actions = await publishActionItems(R, chair.id, verdict, verdictMsgId, topTurn.citations);
    change((x) => {
      if (actions.length) x.actions = actions;
      x.verdict = verdict;
    });
    await safeEmit({
      t: 'council.verdict',
      councilId: COUNCIL_AGENT,
      member: CHAIR_NAME,
      ...(verdictMsgId ? { a2aId: verdictMsgId } : {}),
      mode: R.mode(),
      ...(priv ? {} : { text: verdict.text, outcome: outcomeOf(r, verdict) }),
      dissent: verdict.dissent !== undefined,
      ...(verdict.dissent ? { dissenter: verdict.dissent.member } : {}),
    });
    await R.stage('done');
    // status flips LAST: a stream that closes on the first non-running snapshot must already see stage `done`
    change((x) => {
      x.stage = R.currentStage();
      x.status = 'done';
      x.phase = 'done';
      x.finishedAt = d.now();
    });
    await idle();
  } catch (e) {
    console.warn(`[${COUNCIL_AGENT}] run failed`, (e as Error).message);
    await idle();
    if (r.status === 'running')
      finish('failed', 'The council hit a problem and stopped. Try again in a minute.');
  } finally {
    if (run) {
      const final = run;
      change((x) => {
        x.mode = final.mode();
        x.stage = final.currentStage();
        x.agents = final.agents();
        x.messages = final.messages();
        x.demo = x.mode.startsWith('demo');
        if (x.mode.startsWith('degraded') && !x.notes.some((n) => n.startsWith('Degraded:')))
          x.notes.push(`Degraded: ${x.mode.slice(9).replace(/_/g, ' ')}.`);
      });
      final.close();
    }
    liveHandle?.close();
  }
}

/**
 * Action items for the `actions` stage: derived by CODE from the verdict (next step sentences, the dissent, the
 * strongest cited page), so `source` is `code` and no extra model call is made. One `status` envelope per item.
 */
async function publishActionItems(
  R: AgentRun,
  chairId: AgentId,
  v: CouncilVerdict,
  verdictMsgId: string | undefined,
  cites: { label: string }[],
): Promise<CouncilAction[]> {
  const sentenceList = (v.next.match(/[^.!?]+[.!?]?/g) ?? [])
    .map((x) => x.trim())
    .filter((x) => x.length > 3 && !/^check this with your ta/i.test(x));
  const items: string[] = [...sentenceList.slice(0, 2)];
  if (v.dissent) items.push(`Ask your TA about ${v.dissent.member}'s different view.`);
  const page = cites[0]?.label;
  if (page) items.push(`Re-read ${page} and check it against the answer.`);
  return publishActionTitles(R, chairId, items, verdictMsgId);
}
