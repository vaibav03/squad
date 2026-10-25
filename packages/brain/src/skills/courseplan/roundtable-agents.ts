import { agentId, type AgentMode, type RoomOutcome, type VillageEvent } from '@squad/core';
import type { CouncilAgents } from '../../agents/factory';
import type { AgentRun } from '../../agents/runtime';
import type { AgentSpec, AgentTurn, CouncilDataPorts } from '../../agents/types';
import type { AskViewerData } from '../../councils/ask-v2';
import { anonymise } from '../../councils/ask-run';
import type { Opinion, Ranking } from '../../councils/council';
import { aggregateRankings } from '../../councils/pure';
import type { EmitEvent } from '../../mastery/types';
import { publishActionTitles } from '../../councils/action-items';
import {
  PERSONAS,
  SAMPLE_DISCLOSURE,
  baseTarget,
  cap1,
  clip,
  fitText,
  list,
  squash,
  summaryFor,
  type CoursePlanGoals,
  type CoursePlanInput,
  type CoursePlanResult,
} from './roundtable';
import {
  creditsOf,
  eligibleCourses,
  hoursOf,
  limitsFor,
  remainingRequirements,
  repairPlan,
  validatePlan,
  workloadWords,
  type PlanContext,
} from './rules';
import { extractCourseIds, loadCatalog, type CatalogBundle } from './schema';

export const ROUNDTABLE_KEY = 'roundtable';
export const ROUNDTABLE_V2_PROMPT_VERSION = 'courseplan-v2';
const COUNCIL = `council:${ROUNDTABLE_KEY}`;

export interface CoursePlanAgentsDeps {
  emit: EmitEvent;
  bundle?: CatalogBundle;
  agents: CouncilAgents;
  /** Correlation id of the run (`cn_...`); default random. */
  newRunId?: () => string;
  /** Asker's calendar / mastery summaries through the privacy gate. */
  viewer?: AskViewerData;
  /** Who asked (registers the run for the hub's per-viewer A2A filter). */
  askedBy?: string;
}

const RULES = [
  'You are one of three independent course planners (Chill, Grind, Advisor) at a round table. A Chairman coordinates you and announces the final plan; code checks every plan against prerequisites, offerings and credit limits.',
  'Choose ONLY course ids from the ELIGIBLE list below. Put them, comma-separated, in `answer` (for example "CSL 240, CSL 310"). `summary` is a one or two sentence reason for the student, not your scratch work.',
  'Never mention grades, GPA or personal details. If you have calendar_summary or mastery_summary, use them only when they change your pick; their results are private to the student and must never be repeated.',
  'You may ask ONE colleague one short question with ask_peer if a single fact would change your pick; otherwise do not.',
].join('\n');

export const CHAIRMAN_V2_SYSTEM = [
  'You are the Chairman of a course-planning round table (Chill, Grind, Advisor) helping a student pick one term of courses. You coordinate; the planners propose.',
  'Plan: call delegate ONCE FOR EACH of chill, grind and advisor, all in the same step, with a short sub-question that frames their angle. After they answer, call submit_turn with a one-sentence plan summary. Do NOT announce the plan in that first turn.',
  'Verdict (later, when asked): the plan itself is chosen by checked rules in code. You announce it in one or two sentences in `summary`, say who disagreed in `dissent` (member, why), and put the next step in `stance`. Never invent courses.',
  `[prompt ${ROUNDTABLE_V2_PROMPT_VERSION}:chairman]`,
].join('\n');

export interface RoundtableRosterOptions {
  /** The eligible-course brief every planner sees (summaryFor). */
  brief: string;
  calendar?: boolean;
  mastery?: boolean;
}

/** Chairman -> Chill, Grind, Advisor. Each planner has its own system instruction and tools. */
export function roundtableRoster(o: RoundtableRosterOptions): AgentSpec[] {
  const chair: AgentSpec = {
    id: agentId.council(`${ROUNDTABLE_KEY}-chairman`),
    key: 'chairman',
    role: 'chair',
    displayName: 'Chairman',
    stance: 'Coordinates the round table and announces the checked plan',
    system: CHAIRMAN_V2_SYSTEM,
    tools: ['delegate'],
    tier: 'chair',
    limits: { maxModelCalls: 6, maxOutputTokens: 700 },
  };
  const members = PERSONAS.map((p): AgentSpec => {
    const name = p.member.name;
    return {
      id: agentId.council(`${ROUNDTABLE_KEY}-${name}`),
      key: name,
      role: 'specialist',
      parent: chair.id,
      displayName: cap1(name),
      stance: p.stock,
      system: `${p.member.system}\n\n${RULES}\n\n${o.brief}\n[prompt ${ROUNDTABLE_V2_PROMPT_VERSION}:${name}]`,
      tools: [
        'ask_peer',
        ...(o.mastery && name !== 'grind' ? (['mastery_summary'] as const) : []),
        ...(o.calendar && name !== 'chill' ? (['calendar_summary'] as const) : []),
      ],
      tier: 'main',
      limits: { maxModelCalls: 5, maxOutputTokens: 600, maxPeerAsks: 1 },
    };
  });
  return [chair, ...members];
}

const randomRunId = (): string => {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return `cn_${Array.from(bytes, (b) => (b % 36).toString(36)).join('')}`;
};

/**
 * Round Table on the agent runtime (COUNCIL_AGENTS=v2): Chairman, Chill, Grind and Advisor are distinct agents.
 * The loop is code: delegation, opinions, anonymous critiques/ranks, a checked verdict, action items. Every
 * proposal and the final plan still go through rules.ts. A live run never uses scripted text: a planner that
 * fails stays failed, and with no usable proposal the plan comes from the deterministic rules, labelled degraded.
 */
export async function runCoursePlanAgents(
  deps: CoursePlanAgentsDeps,
  input: CoursePlanInput,
): Promise<CoursePlanResult> {
  const bundle = deps.bundle ?? loadCatalog();
  const goals: CoursePlanGoals = input.goals ?? {};
  const baseLimits = limitsFor({ degree: bundle.degree });
  const maxCredits = Math.max(
    1,
    Math.min(goals.maxCredits ?? baseLimits.maxCredits, baseLimits.maxCredits),
  );
  const minCredits = Math.min(baseLimits.minCredits, maxCredits);
  const ctx: PlanContext = {
    catalog: bundle.catalog,
    degree: bundle.degree,
    completed: [...input.completed],
    term: input.term,
    limits: { maxCredits, minCredits },
  };
  const target = baseTarget(goals, minCredits, maxCredits);
  const eligible = eligibleCourses(ctx.catalog, ctx.degree, ctx.completed, ctx.term);
  const byId = new Map(ctx.catalog.courses.map((c) => [c.id, c]));
  const brief = summaryFor(ctx, eligible, goals, target);
  const names = PERSONAS.map((p) => p.member.name);
  const personaOf = (n: string) => PERSONAS.find((p) => p.member.name === n)!;

  const emit = async (e: VillageEvent): Promise<void> => {
    try {
      await deps.emit(e as never);
    } catch {
      // events are best effort
    }
  };

  const mode: AgentMode = deps.agents.decideMode();
  const ports: CouncilDataPorts = {
    ...(deps.viewer?.calendarSummary ? { calendarSummary: deps.viewer.calendarSummary } : {}),
    ...(deps.viewer?.masterySummary ? { masterySummary: deps.viewer.masterySummary } : {}),
  };
  const roster = roundtableRoster({
    brief,
    calendar: !!ports.calendarSummary,
    mastery: !!ports.masterySummary,
  });
  const chair = roster[0]!;
  const members = roster.slice(1);
  const repairedAll: string[] = [];
  const proposals = new Map<string, { courses: string[]; reason: string }>();

  let run: AgentRun | undefined;
  let finalMode: AgentMode = mode;
  let messages: CoursePlanResult['messages'];
  const finishRun = (): void => {
    if (!run) return;
    finalMode = run.mode();
    messages = run.messages();
    run.close();
  };

  // ---- hourly cap: a refused run produces a plan from rules, labelled, no model
  const refused = !deps.agents.tryStart();
  const runMode: AgentMode = refused ? 'degraded:hourly_cap' : mode;
  finalMode = runMode;

  const opinions: Opinion[] = [];
  const rankings: Ranking[] = [];
  let verdictMessageId: string | undefined;
  let chairNote: string | undefined;
  let answeredNames: string[] = [];

  if (!refused) {
    run = deps.agents.runtime.startRun({
      correlationId: (deps.newRunId ?? randomRunId)(),
      councilKey: ROUNDTABLE_KEY,
      mode,
      visibility: 'squad',
      ...(deps.askedBy ? { owner: { askedBy: deps.askedBy } } : {}),
      roster,
      ports,
      ...(deps.viewer?.needles?.length ? { privateNeedles: deps.viewer.needles } : {}),
    });
  }
  const R = run;
  try {
    if (R) {
      // ---- delegation
      await R.stage('delegation');
      const planCtx = {
        stage: 'plan',
        question: brief,
        eligible: eligible.map((c) => ({ id: c.id, credits: c.credits })),
        targets: Object.fromEntries(
          PERSONAS.map((p) => {
            const g = p.goals(target, minCredits, maxCredits);
            return [p.member.name, g.targetCredits ?? target];
          }),
        ),
      };
      const plan = await R.callAgent(chair, {
        kind: 'status',
        stage: 'delegation',
        to: 'room',
        depth: 0,
        temperature: 0.2,
        endAfterTools: { summary: `Delegated to ${list(members.map((m) => m.displayName))}.` },
        context: planCtx,
        prompt: `A student wants a ${input.term} plan. ${brief.split('\n')[1] ?? ''}\n\nDelegate now to chill, grind and advisor (one delegate call each), then submit your plan summary.`,
      });
      if (plan.status !== 'done') R.degrade(chair.id, plan.reason ?? 'chair_failed');
      for (const m of members) {
        if (R.answerOf(m.id) || R.failureOf(m.id) || R.haltReason()) continue;
        await R.delegateByCode(
          m,
          `Propose your ${input.term} plan.`,
          `The chairman could not delegate to ${m.displayName}, so this is asked directly.`,
        );
      }
      await R.stage('opinions');

      // ---- opinions: every proposal is sanitised, validated and repaired in code
      for (const m of members) {
        const t = R.answerOf(m.id);
        if (!t || t.status !== 'done' || !t.turn) continue;
        const persona = personaOf(m.key);
        const proposed = extractCourseIds(String(t.turn.answer ?? ''));
        const g = persona.goals(target, minCredits, maxCredits);
        const problems = validatePlan(proposed, ctx);
        const fixed =
          problems.length === 0
            ? { courses: proposed, repairs: [] as string[] }
            : repairPlan(proposed, ctx, g);
        const credits = creditsOf(ctx.catalog, fixed.courses);
        const tail = `Picks: ${fixed.courses.join(', ') || 'nothing eligible'} (${credits} cr).`;
        const note = fixed.repairs.length
          ? `Fixed: ${fixed.repairs.slice(0, 2).join('; ')}${fixed.repairs.length > 2 ? '; more' : ''}.`
          : '';
        proposals.set(m.key, { courses: fixed.courses, reason: squash(t.turn.summary) });
        for (const r of fixed.repairs) repairedAll.push(`${m.key}: ${r}`);
        if (fixed.repairs.length)
          await R.publishCode({
            from: chair.id,
            to: 'room',
            kind: 'status',
            stage: 'opinions',
            summary: `Fixed in code: ${m.displayName}'s picks were adjusted (${fixed.repairs.slice(0, 2).join('; ')}).`,
            parentMessageId: t.message?.id ?? R.rootMessageId(),
          });
        const text = fitText(t.turn.summary || persona.stock, tail, note);
        opinions.push({ member: m.key, text, answer: fixed.courses.join(', ') });
        await emit({
          t: 'council.opinion',
          councilId: COUNCIL,
          member: m.key,
          text,
          ...(t.message ? { a2aId: t.message.id } : {}),
          mode: t.mode,
        } as VillageEvent);
      }
      answeredNames = opinions.map((o) => o.member);

      // ---- critiques: anonymous ranking, a real turn per planner, only with 3 answers
      await R.stage('critiques');
      if (answeredNames.length >= 3) {
        const turns = await Promise.all(
          members.map(async (m) => {
            const others = opinions
              .filter((o) => o.member !== m.key)
              .map((o) => ({ member: o.member, o }));
            const labelled = anonymise(R.correlationId, m.key, others);
            const t = await R.callAgent(m, {
              kind: 'rank',
              stage: 'critiques',
              to: 'room',
              depth: 1,
              temperature: 0,
              labels: Object.fromEntries(labelled.map((l) => [l.label, l.item.member])),
              rankNames: others.map((o) => o.member),
              context: { stage: 'rank' },
              prompt: `Now judge your colleagues' anonymous plans. Judge the reasoning and fit to the limits only.\n\n${labelled
                .map((l) => `Plan ${l.label}: ${l.item.o.text}`)
                .join(
                  '\n\n',
                )}\n\nCall submit_turn with \`order\` (labels, best first) and a one-sentence \`summary\`.`,
            });
            return { m, t };
          }),
        );
        for (const { m, t } of turns) {
          const order = t.status === 'done' ? t.turn?.order : undefined;
          if (!order) continue;
          rankings.push({ member: m.key, order });
          await emit({
            t: 'council.rank',
            councilId: COUNCIL,
            member: m.key,
            order,
            ...(t.message ? { a2aId: t.message.id } : {}),
            mode: t.mode,
          } as VillageEvent);
        }
      }
    }

    // ---- verdict: chosen by checked rules in code (same scoring as the legacy round table)
    const have = names.filter((n) => proposals.has(n));
    const consensusOrder = rankings.length ? aggregateRankings(rankings, have) : have;
    const planOf = (n: string): string[] => proposals.get(n)?.courses ?? [];
    let winner: string | undefined;
    let courses: string[];
    if (have.length > 0) {
      const scored = have
        .map((n) => ({
          n,
          s:
            Math.abs(creditsOf(ctx.catalog, planOf(n)) - target) / 3 +
            0.75 * Math.max(0, consensusOrder.indexOf(n)),
        }))
        .sort((a, b) => a.s - b.s || names.indexOf(a.n) - names.indexOf(b.n));
      winner = scored[0]!.n;
      courses = planOf(winner);
    } else {
      // no planner produced a usable proposal: the deterministic rules write the plan (code, never scripted text)
      courses = repairPlan([], ctx, { targetCredits: target }).courses;
    }
    if (validatePlan(courses, ctx).length) {
      const fixed = repairPlan(courses, ctx, { targetCredits: target });
      for (const r of fixed.repairs) repairedAll.push(`chair: ${r}`);
      courses = fixed.courses;
    }
    const credits = creditsOf(ctx.catalog, courses);
    const hours = hoursOf(ctx.catalog, courses);
    const word = workloadWords(hours);

    const diff = (n: string) => {
      const p = planOf(n);
      const extra = p.filter((id) => !courses.includes(id));
      const missing = courses.filter((id) => !p.includes(id));
      return {
        extra,
        missing,
        size: (extra.length + missing.length) * 3 + Math.abs(creditsOf(ctx.catalog, p) - credits),
      };
    };
    const others = have
      .filter((n) => n !== winner)
      .map((n) => ({ n, d: diff(n) }))
      .sort((a, b) => b.d.size - a.d.size || names.indexOf(a.n) - names.indexOf(b.n));
    const top = others[0];
    const dissenter = top && top.d.size > 0 ? top.n : undefined;
    let dissent: string | undefined;
    if (dissenter && top) {
      const p = planOf(dissenter);
      const bits = [
        top.d.extra.length ? `adding ${list(top.d.extra)}` : '',
        top.d.missing.length ? `skipping ${list(top.d.missing)}` : '',
      ].filter(Boolean);
      dissent = clip(
        `${dissenter} wanted ${creditsOf(ctx.catalog, p)} credits (${workloadWords(hoursOf(ctx.catalog, p))} workload)${bits.length ? `, ${bits.join(' and ')}` : ''}.`,
        240,
      );
    }

    const termName = cap1(ctx.term);
    const tail = `${termName} plan: ${courses.join(', ') || 'no eligible courses'}. ${credits} credits, ${word} workload.`;
    let verdictText = fitText('', tail, '');

    if (R) {
      if (dissenter) await R.stage('dissent');
      const vt = await R.callAgent(chair, {
        kind: 'verdict',
        stage: 'verdict',
        to: 'room',
        depth: 0,
        temperature: 0,
        publish: false,
        context: { stage: 'verdict', courses, answer: courses.join(', '), dissenter },
        prompt: `The plan chosen by the checked rules is: ${tail}\n${dissent ? `Dissent: ${dissent}\n` : ''}Announce it with submit_turn: \`summary\` = one or two sentences for the student, \`answer\` = "${courses.join(', ')}", \`confidence\` = confident, \`stance\` = the next step${dissenter ? `, \`dissent\` {member: "${dissenter}", why}` : ''}.`,
      });
      await R.stage('verdict');
      const dissenterTurn: AgentTurn | undefined = dissenter
        ? R.answerOf(agentId.council(`${ROUNDTABLE_KEY}-${dissenter}`))
        : undefined;
      const dissentRefs = dissenterTurn?.message ? [dissenterTurn.message.id] : [];
      if (vt.status === 'done' && vt.turn) {
        // the chair's words are announced, the plan itself stays the checked one
        verdictText = fitText(vt.turn.summary, tail, '', 280);
        const m = await R.publishFinal(vt, {
          to: 'room',
          kind: 'verdict',
          stage: 'verdict',
          summary: verdictText,
          answer: clip(courses.join(', '), 240),
          confidence: dissenter ? 'fairly_sure' : 'confident',
          dissentRefs,
        });
        verdictMessageId = m.id;
      } else {
        R.degrade(chair.id, vt.reason ?? 'chair_failed');
        chairNote =
          'The chairman did not respond, so the checked plan is shown without his summary.';
        const m = await R.publishCode({
          from: chair.id,
          to: 'room',
          kind: 'verdict',
          stage: 'verdict',
          summary: verdictText,
          stance: 'checked plan, chairman unavailable',
          answer: clip(courses.join(', '), 240),
          confidence: 'uncertain',
          dissentRefs,
          status: 'partial',
        });
        verdictMessageId = m.id;
      }
      // ---- actions: the course-plan action items (code)
      await R.stage('actions');
      await publishActionTitles(
        R,
        chair.id,
        roundTableActions(courses, termName, dissenter),
        verdictMessageId ?? R.rootMessageId(),
      );
    }

    const rem = remainingRequirements(ctx.catalog, ctx.degree, ctx.completed);
    const degradedNow = R ? R.mode() : runMode;
    const outcome: RoomOutcome = {
      title: clip(`${termName} plan: ${credits} credits`, 120),
      summary: clip(
        `${courses.length} course${courses.length === 1 ? '' : 's'}, ${word} workload. Every course is checked against prerequisites, offerings and credit limits.`,
        400,
      ),
      items: courses.map((id) => {
        const c = byId.get(id)!;
        return {
          label: clip(`${c.id} ${c.title}`, 120),
          detail: `${c.credits} cr, ${workloadWords(c.workload, 'course')} workload`,
        };
      }),
      facts: [
        { label: 'Credits', value: `${credits} (limit ${minCredits} to ${maxCredits})` },
        { label: 'Workload', value: word },
        { label: 'Term', value: termName },
        {
          label: 'Degree progress',
          value: `${rem.completedCredits + credits} of ${ctx.degree.totalCredits} credits`,
        },
        ...(degradedNow !== 'live'
          ? [
              {
                label: 'Status',
                value: degradedNow.startsWith('demo')
                  ? 'Demo, scripted, not Gemini'
                  : `Degraded: ${degradedNow.slice(9).replace(/_/g, ' ')}`,
              },
            ]
          : []),
      ],
      ...(dissent ? { dissent } : {}),
      why: opinions.map((o) => ({ who: o.member, text: clip(o.text, 280) })),
      notes: [
        ...(repairedAll.length
          ? [clip(`Repaired in code: ${repairedAll.slice(0, 3).join('; ')}.`, 200)]
          : []),
        ...(have.length < names.length
          ? [
              `${list(names.filter((n) => !have.includes(n)))} did not answer${degradedNow.startsWith('degraded') ? ` (${degradedNow.slice(9).replace(/_/g, ' ')})` : ''}.`,
            ]
          : []),
        ...(chairNote ? [chairNote] : []),
        ...(have.length === 0
          ? ['No planner answered, so the plan comes from built-in rules.']
          : []),
        'Sample catalogue data, not a real university.',
      ].map((n) => clip(n, 200)),
    };
    await emit({
      t: 'council.verdict',
      councilId: COUNCIL,
      member: 'chairman',
      text: verdictText,
      outcome,
      dissent: dissenter !== undefined,
      ...(dissenter ? { dissenter } : {}),
      ...(verdictMessageId ? { a2aId: verdictMessageId } : {}),
      mode: degradedNow,
    } as VillageEvent);

    finishRun();
    const usedFallback = have.length < names.length;
    const label = finalMode.startsWith('demo')
      ? ['(Demo, scripted, not Gemini.)']
      : finalMode.startsWith('degraded')
        ? [
            `(Degraded: ${finalMode.slice(9).replace(/_/g, ' ')}. Parts of the round table were unavailable${have.length === 0 ? ', so the plan comes from built-in rules' : ''}.)`,
          ]
        : [];
    const replyText = [
      `Round table plan for ${termName} (chill, grind and advisor argued, then the chairman checked it):`,
      ...(courses.length
        ? outcome.items.map((i) => `- ${i.label} (${i.detail})`)
        : ['- Nothing eligible this term from the remaining requirements.']),
      `Total: ${credits} credits, ${word} workload.`,
      ...(dissent ? [`Dissent: ${dissent}`] : []),
      ...(repairedAll.length
        ? [`Fixed along the way: ${repairedAll.slice(0, 3).join('; ')}.`]
        : []),
      ...label,
      SAMPLE_DISCLOSURE,
    ].join('\n');
    return {
      plan: { term: ctx.term, courses, credits, hours, workload: word },
      outcome,
      opinions,
      rankings,
      verdict: {
        text: verdictText,
        answer: courses.join(', '),
        dissent: dissenter !== undefined,
        ...(dissenter ? { dissenter } : {}),
      },
      violationsRepaired: repairedAll,
      usedFallback,
      replyText,
      mode: finalMode,
      ...(messages ? { messages } : {}),
    };
  } finally {
    finishRun();
  }
}

/**
 * Round Table action items, derived in code from the checked plan (no model call): the courses in pairs ("Take MAT 111
 * and CSL 110 first semester"), the advisor check on a dissent, and the human advisor sign-off. At most 4.
 */
const andList = (xs: readonly string[]): string =>
  xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;

export function roundTableActions(
  courses: readonly string[],
  term: string,
  dissenter?: string,
): string[] {
  const out: string[] = [];
  const size = courses.length > 4 ? 3 : 2;
  for (let i = 0; i < courses.length && out.length < 2; i += size)
    out.push(`Take ${andList(courses.slice(i, i + size))} in ${term || 'the next term'}`);
  if (!courses.length) out.push('Ask your advisor which courses are open to you');
  if (dissenter)
    out.push(
      `Ask your advisor about ${dissenter.charAt(0).toUpperCase()}${dissenter.slice(1)}'s different pick`,
    );
  out.push('Confirm the plan with your real advisor before registering');
  return out;
}
