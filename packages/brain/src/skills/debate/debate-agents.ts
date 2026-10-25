import {
  agentId,
  type A2aMessage,
  type AgentMode,
  type RoomOutcome,
  type StudentId,
} from '@squad/core';
import type { CouncilAgents } from '../../agents/factory';
import { demoCall, demoText, registerDemoScript } from '../../agents/demo-transport';
import type { AgentRun } from '../../agents/runtime';
import type { AgentSpec, AgentTurn, CouncilDataPorts, StepResult } from '../../agents/types';
import { publishActionTitles } from '../../councils/action-items';
import { normaliseText } from '../../councils/pure';
import { splitPages, verifyQuoteOnPage } from '../../feynman/quote';
import type { EmitEvent } from '../../mastery/types';
import {
  DEBATE_COUNCIL,
  DEBATE_NOT_GROUNDED,
  roomPick,
  tallyVotes,
  trimMaterial,
  type DebateInput,
  type DebateResult,
  type DebateVote,
  type Positions,
} from './debate';

export const DEBATE_V2_PROMPT_VERSION = 'debate-v2';
const COUNCIL_ID = `council:${DEBATE_COUNCIL}`;
const JUDGE_ID = agentId.council(`${DEBATE_COUNCIL}-judge`);

export interface DebateAgentsDeps {
  agents: CouncilAgents;
  emit: EmitEvent;
  /** Who started the debate (registers the run for the hub's per-viewer A2A filter). */
  askedBy?: string;
}

const JUDGE_SYSTEM = [
  'You are the Judge of a classroom debate between two debate experts, Pro and Con. You are fair and you decide on the merits (evidence, logic, answering the other side), never by popularity or by who spoke first.',
  'Framing turn: turn the student question into two clearly different, opposite positions. Put the position FOR in `answer` and the position AGAINST in `stance` (each a short phrase, at most 12 words). `summary` is one sentence saying how you framed it.',
  'Verdict turn: put the stronger side in `answer` as exactly "pro", "con" or "draw" (draw only if truly equal), and in `summary` explain why in one or two plain sentences. Do not insult anyone.',
  `[prompt ${DEBATE_V2_PROMPT_VERSION}:judge]`,
].join('\n');

const debaterSystem = (side: 'pro' | 'con', grounded: boolean): string =>
  [
    `You are ${side === 'pro' ? 'Pro' : 'Con'}, a debate expert. You argue ${side === 'pro' ? 'FOR' : 'AGAINST'} the question. You have not seen your opponent's argument. Be fair and never insult anyone.`,
    'Make your single strongest argument in 2 or 3 plain sentences (`summary`), then answer the other side best point. Put your position in a few words in `answer`.',
    grounded
      ? 'Ground your argument in the course material: call retrieve_course, then add ONE citation {file, page, quote} where quote is copied word for word from that page. Do not invent facts or pages; if the material does not support your side, argue what it does support and say so.'
      : 'No course material applies. Argue from general reasoning and give no citations.',
    `[prompt ${DEBATE_V2_PROMPT_VERSION}:${side}]`,
  ].join('\n');

/** Judge (parent) -> Pro, Con. Each has its own system instruction; debaters get `retrieve_course` only when grounded. */
export function debateRoster(grounded: boolean): AgentSpec[] {
  const judge: AgentSpec = {
    id: JUDGE_ID,
    key: 'judge',
    role: 'judge',
    displayName: 'Judge',
    stance: 'Decides which argument was stronger',
    system: JUDGE_SYSTEM,
    tools: [],
    tier: 'chair',
    limits: { maxModelCalls: 3, maxOutputTokens: 700 },
  };
  const side = (s: 'pro' | 'con'): AgentSpec => ({
    id: agentId.council(`${DEBATE_COUNCIL}-${s}`),
    key: s,
    role: 'debater',
    parent: JUDGE_ID,
    displayName: s === 'pro' ? 'Pro' : 'Con',
    stance: s === 'pro' ? 'Argues for' : 'Argues against',
    system: debaterSystem(s, grounded),
    tools: grounded ? ['retrieve_course'] : [],
    tier: 'main',
    limits: { maxModelCalls: 4, maxOutputTokens: 700 },
  });
  return [judge, side('pro'), side('con')];
}

interface DebateDemoContext {
  stage: 'frame' | 'argue' | 'verdict';
  question: string;
  side?: 'pro' | 'con';
}

const submit = (args: Record<string, unknown>): StepResult => ({
  text: '',
  toolCalls: [demoCall('submit_turn', args)],
});

/** Scripted debate (demo runs only): same runtime, tools and envelopes; only the model is replaced. */
export function registerDebateDemo(): void {
  registerDemoScript('debate', (o) => (_input, so) => {
    const ctx = (so.context ?? { stage: 'argue', question: '' }) as DebateDemoContext;
    if (o.spec.key === 'judge') {
      if (ctx.stage === 'frame')
        return submit({
          summary: demoText('Framed two opposite positions.'),
          stance: demoText('No, it does not hold'),
          answer: demoText('Yes, it holds'),
        });
      return submit({
        summary: demoText('The case for the pro side was a little stronger.'),
        stance: 'judged',
        answer: 'pro',
      });
    }
    const pro = o.spec.key === 'pro';
    return submit({
      summary: demoText(
        pro
          ? 'The main reasons point that way once the facts are laid out.'
          : 'The other side overlooks the costs and exceptions.',
      ),
      stance: pro ? 'for' : 'against',
      answer: demoText(pro ? 'Yes, it holds' : 'No, it does not hold'),
    });
  });
}

const clip = (s: string, n: number): string =>
  s.length <= n ? s : `${s.slice(0, Math.max(1, n - 1)).trimEnd()}…`;
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();
const cnId = (): string => {
  const b = new Uint8Array(12);
  globalThis.crypto.getRandomValues(b);
  return `cn_${Array.from(b, (x) => (x % 36).toString(36)).join('')}`;
};
const REASON: Record<string, string> = {
  credits_depleted: 'the model credits ran out',
  rate_limited: 'the model was rate limited',
  invalid_key: 'the model key was rejected',
  timeout: 'the model timed out',
  budget: 'the run budget was reached',
};
const voteWords = (t: { pro: number; con: number; none: number }): string =>
  t.pro + t.con === 0
    ? 'No votes were cast'
    : `${t.pro} for, ${t.con} against${t.none ? `, ${t.none} did not vote` : ''}`;

/** Honest label for the run's final mode (shown in text and the outcome). */
export function modeNote(mode: AgentMode): string | undefined {
  if (mode === 'live') return undefined;
  if (mode.startsWith('demo')) return 'Demo: scripted text, not Gemini.';
  const r = mode.slice('degraded:'.length);
  return `Degraded (${(REASON[r] ?? r.replace(/_/g, ' ')).trim()}): part of this debate is missing.`;
}

/**
 * Debate Stage on real agents (COUNCIL_AGENTS=v2): a Judge frames the positions, Pro and Con argue in parallel
 * (each a distinct agent), the room votes through the confirm card, the Judge decides on the merits. Citations are
 * verified in code against the supplied material. The mode is decided once at the start and only worsens;
 * a failed debater leaves a labelled partial result, never scripted text under a live run.
 */
export async function runDebateV2(
  deps: DebateAgentsDeps,
  input: DebateInput,
): Promise<DebateResult> {
  const question = squash(input.question);
  const material = input.material?.context.trim()
    ? trimMaterial(input.material.context)
    : undefined;
  const grounded = material !== undefined;
  const mode: AgentMode = deps.agents.decideMode(); // THE decision point
  if (!deps.agents.tryStart()) throw new Error('the council is at its hourly limit');

  const pages = material ? splitPages(material) : [];
  const verifiedCites: { side: 'pro' | 'con'; file: string; page: number }[] = [];
  const ports: CouncilDataPorts = material
    ? {
        async retrieve() {
          return {
            grounded: true,
            quotes: [],
            pages: pages.map((p) => ({ file: p.file, page: p.page, text: p.text })),
          };
        },
        verify(cs) {
          const seen = new Set<string>();
          return cs
            .filter((c) => verifyQuoteOnPage(material, c.file, c.page, c.quote))
            .filter((c) => !seen.has(`${c.file}#${c.page}`) && seen.add(`${c.file}#${c.page}`))
            .map((c) => ({ file: c.file, page: c.page, label: `${c.file} p.${c.page}` }));
        },
      }
    : {};
  const roster = debateRoster(grounded);
  const [judge, proSpec, conSpec] = roster as [AgentSpec, AgentSpec, AgentSpec];
  const run: AgentRun = deps.agents.runtime.startRun({
    correlationId: cnId(),
    councilKey: DEBATE_COUNCIL,
    question: question.slice(0, 600),
    mode,
    visibility: 'squad',
    ...(deps.askedBy ? { owner: { askedBy: deps.askedBy } } : {}),
    roster,
    ports,
    chairKey: 'judge',
  });
  const safeEmit = async (e: Parameters<EmitEvent>[0]): Promise<void> => {
    try {
      await deps.emit(e);
    } catch (err) {
      console.warn(`[${COUNCIL_ID}] emit failed`, (err as Error).message);
    }
  };
  try {
    await safeEmit({ t: 'agent.state', agent: COUNCIL_ID, state: 'studying' });

    // ---- delegation: the Judge frames two opposite positions
    await run.stage('delegation');
    const frame = await run.callAgent(judge, {
      kind: 'status',
      stage: 'delegation',
      to: 'room',
      depth: 0,
      temperature: 0,
      context: { stage: 'frame', question } satisfies DebateDemoContext,
      prompt: `Debate question: ${question}${grounded ? '\n(The course material covers this; stay within it.)' : ''}\nFrame the two positions now (answer = FOR, stance = AGAINST).`,
    });
    let positions: Positions;
    if (frame.status === 'done' && frame.turn?.answer && frame.turn.stance) {
      positions = {
        pro: clip(squash(frame.turn.answer), 80),
        con: clip(squash(frame.turn.stance), 80),
      };
      if (normaliseText(positions.pro) === normaliseText(positions.con))
        positions = { pro: 'In favour', con: 'Against' };
    } else {
      if (frame.status !== 'done') run.degrade(judge.id, frame.reason ?? 'judge_failed');
      positions = { pro: 'In favour', con: 'Against' }; // neutral labels written by code, not a claim
    }

    // ---- opinions: Pro and Con argue in parallel, each its own agent
    await run.stage('opinions');
    const argue = (spec: AgentSpec, side: 'pro' | 'con'): Promise<AgentTurn> =>
      run.callAgent(spec, {
        kind: 'answer',
        stage: 'opinions',
        to: judge.id,
        depth: 1,
        temperature: 0.4,
        context: { stage: 'argue', question, side } satisfies DebateDemoContext,
        prompt: `Debate question: ${question}\nYour position (${side === 'pro' ? 'FOR' : 'AGAINST'}): "${positions[side]}"\nThe other side holds: "${positions[side === 'pro' ? 'con' : 'pro']}"\nMake your argument now.`,
      });
    const [proT, conT] = await Promise.all([argue(proSpec, 'pro'), argue(conSpec, 'con')]);
    const turnOf: Record<'pro' | 'con', AgentTurn> = { pro: proT, con: conT };
    const textOf = (side: 'pro' | 'con'): string => {
      const t = turnOf[side];
      if (t.status !== 'done' || !t.turn) return '';
      const c = t.citations[0];
      if (c) verifiedCites.push({ side, file: c.file, page: c.page });
      return (
        clip(squash(t.turn.summary), 250 - (c ? c.label.length + 3 : 0)) +
        (c ? ` [${c.label}]` : '')
      );
    };
    const texts = { pro: textOf('pro'), con: textOf('con') };
    const side2name = (s: 'pro' | 'con'): string => (s === 'pro' ? 'Pro' : 'Con');
    for (const s of ['pro', 'con'] as const) {
      const t = turnOf[s];
      await safeEmit({
        t: 'council.opinion',
        councilId: COUNCIL_ID,
        member: s,
        ...(t.message ? { a2aId: t.message.id } : {}),
        mode: t.mode,
        ...(texts[s] ? { text: texts[s] } : {}),
      });
    }
    const bothArgued = !!texts.pro && !!texts.con;
    const shown = {
      pro:
        texts.pro ||
        `${side2name('pro')} could not argue (${REASON[proT.reason ?? ''] ?? 'unavailable'}).`,
      con:
        texts.con ||
        `${side2name('con')} could not argue (${REASON[conT.reason ?? ''] ?? 'unavailable'}).`,
    };
    try {
      await input.onArguments?.({ pro: shown.pro, con: shown.con, positions });
    } catch {
      /* chat display is best effort */
    }

    // ---- the room votes (confirm card)
    let votes: DebateVote[] = [];
    if (bothArgued && input.askVote && input.students.length) {
      const options: [string, string] = [
        clip(`For: ${positions.pro}`, 90),
        clip(`Against: ${positions.con}`, 90),
      ];
      const prompt = `Debate: ${clip(question, 160)}\nWhich side argued better?`;
      votes = await Promise.all(
        input.students.map(async (student: StudentId) => ({
          student,
          side: await input.askVote!(student, prompt, options).catch(() => 'none' as const),
        })),
      );
    }
    const tally = tallyVotes(votes);
    const room = roomPick(tally);

    // ---- verdict: the Judge decides on the merits; without both arguments there is nothing to judge
    let winner: 'pro' | 'con' | 'draw' = 'draw';
    let explanation = '';
    let judged: AgentTurn | undefined;
    if (bothArgued) {
      if (room !== null) await run.stage('dissent');
      judged = await run.callAgent(judge, {
        kind: 'verdict',
        stage: 'verdict',
        to: 'room',
        depth: 0,
        temperature: 0,
        publish: false,
        context: { stage: 'verdict', question } satisfies DebateDemoContext,
        prompt: `Debate question: ${question}\nPro (${positions.pro}): ${texts.pro}\nCon (${positions.con}): ${texts.con}\nDecide which argument was stronger on its merits. answer = "pro", "con" or "draw"; summary = why.`,
      });
      if (judged.status === 'done' && judged.turn) {
        const a = normaliseText(judged.turn.answer ?? '');
        winner = a.startsWith('pro') ? 'pro' : a.startsWith('con') ? 'con' : 'draw';
        explanation = squash(judged.turn.summary);
      } else {
        run.degrade(judge.id, judged.reason ?? 'judge_failed');
        winner = room ?? 'draw';
      }
    } else {
      explanation = 'Both arguments are needed to judge this debate.';
    }
    const judgeFailed = bothArgued && !(judged?.status === 'done');
    if (!explanation)
      explanation = judgeFailed
        ? 'The judge was unavailable, so this follows the room vote.'
        : winner === 'draw'
          ? 'Both sides made fair points.'
          : `The case for "${positions[winner]}" was a little stronger.`;
    const label = winner === 'draw' ? '' : positions[winner];
    const head = winner === 'draw' ? 'Too close to call.' : `Stronger argument: ${label}.`;
    const verdictText = clip(`${head} ${explanation}`, 320);
    const dissenter = room !== null && winner !== 'draw' && room !== winner ? room : undefined;
    const dissentLine = dissenter
      ? clip(
          `The room voted for "${positions[dissenter]}" (${voteWords(tally)}); the judge weighed the arguments instead.`,
          240,
        )
      : winner === 'draw' && room
        ? clip(`The room leaned to "${positions[room]}" (${voteWords(tally)}).`, 240)
        : undefined;

    await run.stage('verdict');
    const verdictAnswer =
      winner === 'draw' ? 'draw' : (turnOf[winner].turn?.answer ?? positions[winner]);
    const dissentRefs = (['pro', 'con'] as const)
      .map((s) => turnOf[s])
      .filter(
        (t) => t.message && normaliseText(t.turn?.answer ?? '') !== normaliseText(verdictAnswer),
      )
      .map((t) => t.message!.id);
    let vmsg: A2aMessage;
    if (judged?.status === 'done') {
      vmsg = await run.publishFinal(judged, {
        to: 'room',
        kind: 'verdict',
        stage: 'verdict',
        summary: verdictText,
        answer: verdictAnswer,
        dissentRefs,
      });
    } else {
      vmsg = await run.publishCode({
        from: judge.id,
        to: 'room',
        kind: 'verdict',
        stage: 'verdict',
        summary: verdictText,
        answer: verdictAnswer,
        dissentRefs,
        status: 'partial',
      });
    }
    await run.stage('actions');
    await publishActionTitles(
      run,
      judge.id,
      debateActions(winner, positions, verifiedCites, grounded, dissenter),
      vmsg.id,
    );

    const finalMode = run.mode();
    const mnote = modeNote(finalMode);
    const cites = [
      ...new Map(
        verifiedCites.map((c) => [`${c.file}|${c.page}`, { file: c.file, page: c.page }]),
      ).values(),
    ];
    const outcome: RoomOutcome = {
      title: clip(winner === 'draw' ? 'Verdict: too close to call' : `Verdict: ${label}`, 120),
      summary: clip(explanation, 400),
      items: (['pro', 'con'] as const).map((s) => ({
        label: clip(`${s === 'pro' ? 'For' : 'Against'}: ${positions[s]}`, 120),
        detail: clip(shown[s], 160),
      })),
      facts: [
        { label: 'Room vote', value: clip(voteWords(tally), 80) },
        { label: 'Judge picked', value: clip(winner === 'draw' ? 'Neither (draw)' : label, 80) },
        { label: 'Grounding', value: grounded ? 'Your course materials' : 'General reasoning' },
        { label: 'Mode', value: finalMode === 'live' ? 'Live' : clip(finalMode, 40) },
      ],
      ...(dissentLine ? { dissent: dissentLine } : {}),
      why: (['pro', 'con'] as const).map((s) => ({ who: s, text: clip(shown[s], 280) })),
      notes: [
        ...(cites.length
          ? [
              clip(
                `Cited and checked: ${cites.map((c) => `${c.file} p.${c.page}`).join(', ')}.`,
                200,
              ),
            ]
          : []),
        ...(grounded ? [] : [DEBATE_NOT_GROUNDED]),
        ...(mnote ? [mnote] : []),
      ],
    };
    await safeEmit({
      t: 'council.verdict',
      councilId: COUNCIL_ID,
      member: 'judge',
      a2aId: vmsg.id,
      mode: finalMode,
      text: verdictText,
      outcome,
      dissent: dissenter !== undefined,
      ...(dissenter ? { dissenter } : {}),
    });
    await run.stage('done');
    await safeEmit({ t: 'agent.state', agent: COUNCIL_ID, state: 'idle' });

    const closing = [
      `${voteWords(tally)}.`,
      `Judge: ${verdictText}`,
      ...(outcome.dissent ? [`Dissent: ${outcome.dissent}`] : []),
      ...(grounded ? [] : [DEBATE_NOT_GROUNDED]),
      ...(mnote ? [`(${mnote})`] : []),
    ];
    const prefix = finalMode.startsWith('demo') ? '(Demo, scripted, not Gemini) ' : '';
    const replyText = [
      `${prefix}Debate: ${clip(question, 140)}`,
      `For (${positions.pro}): ${shown.pro}`,
      `Against (${positions.con}): ${shown.con}`,
      ...closing,
    ].join('\n');
    const opinions = (['pro', 'con'] as const).map((s) => ({
      member: s,
      text: shown[s],
      answer: turnOf[s].turn?.answer ?? positions[s],
    }));
    return {
      positions,
      opinions,
      rankings: [],
      verdict: {
        text: verdictText,
        answer: winner,
        dissent: dissenter !== undefined,
        ...(dissenter !== undefined ? { dissenter } : {}),
      },
      winner,
      votes,
      tally,
      citations: cites,
      grounded,
      usedFallback: finalMode !== 'live',
      outcome,
      replyText,
      closingText: closing.join('\n'),
    };
  } finally {
    run.close();
  }
}

/**
 * Debate action items, derived in code from the verdict and the pages the arguments cited (verified): review the cited
 * pages ("Review ch6 p.3 before the exam"), look at the losing side once, or check an ungrounded debate against notes.
 */
export function debateActions(
  winner: 'pro' | 'con' | 'draw',
  positions: { pro: string; con: string },
  cites: readonly { file: string; page: number }[],
  grounded: boolean,
  dissenter?: 'pro' | 'con',
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of cites) {
    const name = c.file.replace(/\.[a-z0-9]{2,4}$/i, '');
    const key = `${name}|${c.page}`;
    if (seen.has(key) || out.length >= 2) continue;
    seen.add(key);
    out.push(`Review ${name} p.${c.page} before the exam`);
  }
  if (winner !== 'draw') {
    const other = winner === 'pro' ? 'con' : 'pro';
    out.push(`Write one line on why "${positions[other]}" lost, in your own words`);
  } else {
    out.push('Pick a side and write one line defending it');
  }
  if (dissenter) out.push(`Ask your TA why the room leaned to "${positions[dissenter]}"`);
  if (!grounded) out.push('Check this debate against your course notes');
  return out;
}
