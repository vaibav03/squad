import { AGENT_ALIASES, type AgentAlias } from '@squad/core';
import { HALL_SLOT, legacyRoomTarget } from '@squad/village/rooms';

/**
 * Everyone who can be asked, in the one place they meet: the Agent Hall. Built from the shared alias table
 * (packages/core/src/mentions.ts) so a name you can @mention is a seat in the hall, and the other way round.
 */
export type HallGroup = 'cubbie' | 'expert' | 'council' | 'judge';

export interface HallAgent {
  /** Canonical @alias (`feynman`). */
  alias: string;
  /** Every alias word that reaches this agent. */
  aliases: readonly string[];
  name: string;
  blurb: string;
  group: HallGroup;
  /** Id the selected-agent panel and portraits understand (`expert:feynman`, `council:ask-skeptic`, `chill`). */
  panelId: string;
  /** The former room this agent used to live in, when it had one (drives Available / Locked until first use). */
  slot: string | null;
  /** A starter message for the composer chips. Never sent for the student. */
  prompt: string;
  /** When this agent speaks in council runs: the inspector's agent id and the speaker key its lines carry. */
  voice?: { agent: string; who: string };
}

/** Council seats whose lines the room transcript carries (the inspector shows them as a chat). */
const VOICE: Record<string, { agent: string; who: string }> = {
  chair: { agent: 'council:quizkey', who: 'chair' },
  chairman: { agent: 'council:planner', who: 'chair' },
  chill: { agent: 'council:planner', who: 'chill' },
  grind: { agent: 'council:planner', who: 'grind' },
  advisor: { agent: 'council:planner', who: 'advisor' },
};

const GROUP: Record<string, HallGroup> = {
  cubbie: 'cubbie',
  tutor: 'expert',
  skeptic: 'council',
  planner: 'expert',
  examiner: 'judge',
  chair: 'judge',
  chairman: 'judge',
  council: 'council',
  advisor: 'council',
  chill: 'council',
  grind: 'council',
  debate: 'council',
  rubric: 'judge',
  oracle: 'judge',
};

/** Former room per agent (landmarks only; the rest were never behind a door). */
const SLOT: Record<string, string> = {
  feynman: 'feynman-porch',
  debate: 'debate-stage',
  planner: 'round-table',
  advisor: 'round-table',
  chill: 'round-table',
  grind: 'round-table',
  chairman: 'round-table',
  stepdiff: 'panic-booth',
  oracle: 'exam-oracle',
  examiner: 'oral-exam-hut',
  rubric: 'rubric-courthouse',
  devilta: 'devils-ta',
};

const PANEL_ID: Record<string, string> = {
  cubbie: 'dean',
  tutor: 'council:ask-teacher',
  skeptic: 'council:ask-skeptic',
  examiner: 'council:ask-examiner',
  chair: 'council:ask-chair',
  chairman: 'chairman',
  council: 'council:ask',
  planner: 'council:planner',
  advisor: 'advisor',
  chill: 'chill',
  grind: 'grind',
  quiz: 'council:quizkey',
  debate: 'council:debate',
  feynman: 'expert:feynman',
  stepdiff: 'expert:stepdiff',
  oracle: 'expert:oracle',
  rubric: 'expert:rubric',
  devilta: 'expert:devil',
};

const PROMPT: Record<string, string> = {
  cubbie: '@cubbie quiz me on ch2',
  tutor: '@tutor explain standard deviation simply',
  skeptic: '@skeptic what is the evidence that the mean is enough?',
  planner: '@planner plan my week before the midterm',
  examiner: '@examiner what would a test ask about z-scores?',
  chair: '@chair wrap up what we decided',
  council: '@council what is the most important idea in this chapter?',
  advisor: '@advisor balance my deadlines this week',
  chill: '@chill is a lighter week realistic?',
  grind: '@grind how many hours should I put in?',
  chairman: '@chairman state the plan',
  quiz: '@quiz quiz me on ch2',
  feynman: '@feynman explain z-scores',
  stepdiff: '@stepdiff compare my steps with the reference',
  podcast: '@podcast make a short recap of ch2',
  explainer: '@explainer explain the central limit theorem',
  debate: '@debate should exams be open book?',
  oracle: '@oracle what will likely be asked?',
  rubric: '@rubric check my answer against the rubric',
  devilta: '@devilta find the mistake in my work',
  studyplan: '@studyplan update my study plan',
  discuss: '@discuss spaced repetition',
};

const FIRST: readonly string[] = ['cubbie'];

function toAgent(a: AgentAlias): HallAgent {
  const alias = a.aliases[0]!;
  const group =
    GROUP[a.id] ?? (a.kind === 'skill' ? 'expert' : a.kind === 'router' ? 'cubbie' : 'council');
  return {
    alias,
    aliases: a.aliases,
    name: a.name,
    blurb: a.description,
    group,
    panelId: PANEL_ID[a.id] ?? `expert:${a.id}`,
    slot: SLOT[a.id] ?? null,
    prompt: PROMPT[a.id] ?? `@${alias} `,
    ...(VOICE[a.id] ? { voice: VOICE[a.id]! } : {}),
  };
}

/** Seat order: Cubbie in the middle of the arc, experts and council members either side of it. */
export const HALL_AGENTS: readonly HallAgent[] = (() => {
  const all = AGENT_ALIASES.map(toAgent);
  const first = all.filter((a) => FIRST.includes(a.alias));
  const rest = all.filter((a) => !FIRST.includes(a.alias));
  return [...first, ...rest];
})();

export function hallAgent(aliasOrRoom: string | null | undefined): HallAgent | undefined {
  if (!aliasOrRoom) return undefined;
  const k = aliasOrRoom.trim().toLowerCase().replace(/^@/, '');
  return (
    HALL_AGENTS.find((a) => a.aliases.includes(k)) ??
    // a former room id (`feynman-porch`, `chapter-2`) or a panel id (`expert:feynman`)
    HALL_AGENTS.find((a) => a.panelId === aliasOrRoom) ??
    (() => {
      const t = legacyRoomTarget(k);
      return t?.focus ? HALL_AGENTS.find((a) => a.aliases.includes(t.focus!)) : undefined;
    })()
  );
}

/**
 * Per-agent availability, replacing the old locked-room doors. An agent that lived in a room starts "locked until first
 * use" (the room's skill has not run yet this session); everyone else is available at once. Saying its name IS the first
 * use, so a locked agent can still be addressed.
 */
export type Availability = 'available' | 'locked';
export function availabilityOf(
  agent: HallAgent,
  used: readonly string[] | undefined,
): Availability {
  if (!agent.slot) return 'available';
  if (agent.slot === HALL_SLOT) return 'available';
  return used?.includes(agent.slot) ? 'available' : 'locked';
}
export const AVAILABILITY_LABEL: Record<Availability, string> = {
  available: 'Available',
  locked: 'Locked until first use',
};
export const AVAILABILITY_NOTE: Record<Availability, string> = {
  available: 'Ask away.',
  locked: 'Wakes up the first time you message it.',
};

/** Alias words that the hall draws as seats, for deep-link and mention checks. */
export const HALL_ALIASES: readonly string[] = HALL_AGENTS.flatMap((a) => a.aliases);

/** Resolve `?room=<id>` (a former room id, a short name, or any @alias) to a seat and a draft, or null. */
export function resolveRoomParam(id: string): { agent: HallAgent | null; seed?: string } | null {
  const k = id.trim().toLowerCase();
  const t = legacyRoomTarget(k);
  if (t) {
    const agent = t.focus ? (hallAgent(t.focus) ?? null) : null;
    return { agent, ...(t.seed ? { seed: t.seed } : {}) };
  }
  const agent = hallAgent(k);
  return agent ? { agent } : null;
}
