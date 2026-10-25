import type { LandmarkId, SceneId } from './contract';

/**
 * Which building owns which agent id / council id. A convention for the buildings half (events
 * carry only ids); documented in docs/village-scenes.md for the world and adapter leads.
 */
const LANDMARK_AGENTS: Record<string, LandmarkId> = {
  'expert:feynman': 'feynman-porch',
  'expert:stepdiff': 'panic-booth',
  'expert:panic': 'panic-booth',
  'expert:oral': 'oral-hut',
  'expert:examiner': 'oral-hut',
  'expert:rubric': 'rubric-courthouse',
  'expert:oracle': 'exam-oracle',
  'expert:devil': 'devils-ta',
  'expert:devils-ta': 'devils-ta',
  'council:debate': 'debate-stage',
  'council:planner': 'round-table',
};

/** Council ids that sit in the Council Hall (quiz-key verify, plus any unknown council). */
export function routeCouncil(councilId: string): SceneId {
  const id = councilId.startsWith('council:') ? councilId : `council:${councilId}`;
  return LANDMARK_AGENTS[id] ?? 'council-hall';
}

/** Scene for an agent id, or null when it is a student / dean / mediator (not a building). */
export function routeAgent(agent: string): SceneId | null {
  const hit = LANDMARK_AGENTS[agent];
  if (hit) return hit;
  if (agent.startsWith('expert:')) return 'chapter-house';
  if (agent.startsWith('council:')) return routeCouncil(agent);
  return null;
}

export function chapterOf(agent: string): string | null {
  return agent.startsWith('expert:') && !LANDMARK_AGENTS[agent]
    ? agent.slice('expert:'.length)
    : null;
}

export function landmarkOf(agent: string): LandmarkId | null {
  return LANDMARK_AGENTS[agent] ?? null;
}
