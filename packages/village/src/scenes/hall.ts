/**
 * The Agent Hall: ONE meeting place for every agent (experts, council members, judges, Cubbie). The old per-agent
 * rooms (Feynman Porch, Debate Stage, Exam Oracle, ...) stay on the map as scenery but are not doors any more; every
 * former room id, HUD chip and deep link resolves here, with the relevant agent pre-selected. Pure data, Phaser-free.
 */

/** The only walk-in room. It is the former Council Hall interior. */
export const HALL_SLOT = 'council-hall' as const;

/** What to do on arrival: which agent (by its @alias) is pre-selected, and an optional message to put in the composer. */
export interface HallTarget {
  /** Canonical @alias (`feynman`, `debate`, ...) or null for the whole hall. */
  focus: string | null;
  /** Draft for the hall chat composer (never sent for the student). */
  seed?: string;
}

/** Former room ids (layout slots) and their short names, mapped to the agent that used to live there. */
const LEGACY: Readonly<Record<string, HallTarget>> = {
  'council-hall': { focus: null },
  hall: { focus: null },
  'agent-hall': { focus: null },
  'feynman-porch': { focus: 'feynman' },
  feynman: { focus: 'feynman' },
  'debate-stage': { focus: 'debate', seed: '@debate ' },
  debate: { focus: 'debate', seed: '@debate ' },
  'round-table': { focus: 'planner' },
  roundtable: { focus: 'planner' },
  'panic-booth': { focus: 'stepdiff' },
  panic: { focus: 'stepdiff' },
  'exam-oracle': { focus: 'oracle' },
  oracle: { focus: 'oracle' },
  'oral-exam-hut': { focus: 'examiner' },
  'oral-hut': { focus: 'examiner' },
  oral: { focus: 'examiner' },
  'rubric-courthouse': { focus: 'rubric' },
  rubric: { focus: 'rubric' },
  'devils-ta': { focus: 'devilta' },
  devilta: { focus: 'devilta' },
  devil: { focus: 'devilta' },
};

/** Former room slots that are scenery now (never a door). */
export const SCENERY_SLOTS: readonly string[] = [
  'chapter-1',
  'chapter-2',
  'chapter-3',
  'chapter-4',
  'debate-stage',
  'round-table',
  'feynman-porch',
  'panic-booth',
  'exam-oracle',
  'oral-exam-hut',
  'rubric-courthouse',
  'devils-ta',
];

/** Every id that opens the hall, for deep links (`?room=...`) and the world's openRoom. Null when unknown. */
export function legacyRoomTarget(id: string): HallTarget | null {
  const k = id.trim().toLowerCase();
  const hit = LEGACY[k];
  if (hit) return hit;
  const ch = /^chapter-?(\d+)$/.exec(k) ?? /^ch(\d+)$/.exec(k);
  if (ch) return { focus: 'quiz', seed: `@quiz quiz me on ch${ch[1]}` };
  return null;
}

/** Inspector / registry agent ids to the alias that should be pre-selected in the hall. */
const AGENT_FOCUS: Readonly<Record<string, string | null>> = {
  'expert:feynman': 'feynman',
  'expert:stepdiff': 'stepdiff',
  'expert:panic': 'stepdiff',
  'expert:oral': 'examiner',
  'expert:examiner': 'examiner',
  'expert:rubric': 'rubric',
  'expert:oracle': 'oracle',
  'expert:devil': 'devilta',
  'expert:devils-ta': 'devilta',
  'council:debate': 'debate',
  'council:planner': 'planner',
  'council:roundtable': 'planner',
  'council:oracle': 'oracle',
  'council:rubric': 'rubric',
  'council:quizkey': 'quiz',
  'council:ask': 'council',
};

/** Target for a HUD chip / selector on `agentId`: an agent id, or a hall alias. */
export function hallTargetForAgent(agentId: string): HallTarget {
  if (agentId in AGENT_FOCUS) return { focus: AGENT_FOCUS[agentId] ?? null };
  const ch = /^expert:(?:ch|chapter-?)?(\d+)$/.exec(agentId);
  if (ch) return { focus: 'quiz', seed: `@quiz quiz me on ch${ch[1]}` };
  if (agentId.startsWith('expert:') || agentId.startsWith('council:'))
    return { focus: agentId.replace(/^(expert|council):/, '') };
  return { focus: agentId };
}
