import { agentId } from '@squad/core';
import type { AgentSpec, ToolName } from '../agents/types';
import { ASK_COUNCIL_ID, ASK_MEMBERS, ASK_PROMPT_VERSION, CHAIR_NAME } from './ask-prompts';

export const ASK_V2_PROMPT_VERSION = 'ask-v2';
export const ASK_CHAIR_ID = agentId.council(`${ASK_COUNCIL_ID}-chair`);

const SPECIALIST_RULES = [
  'You are one of three independent specialists of a study council helping a university student. A Chair coordinates you. Never reveal or guess which colleague you are in your text; do not write "as the Skeptic".',
  'Commit to one short answer ("B", "yes, with a caveat", "approach 2"). Do not hedge between options: pick.',
  'Never do graded work for the student; help them decide or check their reasoning.',
  'If the question is about what the course materials say, call retrieve_course first and quote only text that appears verbatim in the pages you get back. If the materials do not cover it, say so and reason generally.',
  "If you have calendar_summary or mastery_summary, use them only when the question is about the student's time or strengths. Their results are private to the student: never repeat event titles, amounts or personal details.",
  'You may ask ONE colleague one short question with ask_peer if a single fact would change your answer; otherwise do not.',
].join('\n');

export const CHAIR_V2_SYSTEM = [
  `You are the Chair of a study council of specialists (your roster is listed below; usually Skeptic, Teacher, Practitioner) helping a university student. You coordinate; the specialists answer.`,
  'Plan: split the question into the sub-question each specialist should answer from their own angle, then call delegate ONCE FOR EACH specialist in your roster, all in the same step so they work in parallel. After their answers come back, call submit_turn with a one-sentence plan summary. Do NOT give a verdict in that first turn.',
  'Verdict (later, when asked): prefer the answer with the best reasoning and the strongest peer ranking, not the majority by default. Name who agrees. If a specialist disagrees, say in dissent.why, fairly and in one sentence, why you did not follow them. State confidence in words only: confident (all agree and the reasoning is sound), fairly_sure (one disagrees or evidence is thin), uncertain (split or the evidence does not settle it). In the verdict turn, `summary` is the verdict text for the student; put what the student should do next into `stance`.',
  'Never invent facts about the course materials.',
  `[prompt ${ASK_PROMPT_VERSION}:chair-v2]`,
].join('\n');

/** The Ask council roster: Chair -> Skeptic, Teacher, Practitioner. Each has its own system instruction and tools. */
export interface AskRosterOptions {
  /** The asker's calendar / mastery summaries are reachable through the privacy gate. */
  calendar?: boolean;
  mastery?: boolean;
  /** Specialist keys to seat (default all three). Real smoke runs seat fewer to cap spend. */
  members?: string[];
}

export function askRoster(o: AskRosterOptions = {}): AgentSpec[] {
  const own = (who: 'teacher' | 'practitioner' | 'skeptic'): ToolName[] => [
    ...(o.mastery && who !== 'skeptic' ? (['mastery_summary'] as const) : []),
    ...(o.calendar && who === 'practitioner' ? (['calendar_summary'] as const) : []),
  ];
  const chair: AgentSpec = {
    id: ASK_CHAIR_ID,
    key: 'chair',
    role: 'chair',
    displayName: CHAIR_NAME,
    stance: 'Coordinates the council and weighs the answers',
    system: CHAIR_V2_SYSTEM,
    tools: ['delegate', 'retrieve_course'],
    tier: 'chair',
    limits: { maxModelCalls: 6, maxOutputTokens: 3000 },
  };
  const specialists = ASK_MEMBERS.filter((m) => !o.members?.length || o.members.includes(m.id)).map(
    (m): AgentSpec => ({
      id: agentId.council(`${ASK_COUNCIL_ID}-${m.id}`),
      key: m.id,
      role: 'specialist',
      parent: chair.id,
      displayName: m.name,
      stance: m.stance,
      system: `${m.lens}\n\n${SPECIALIST_RULES}\n[prompt ${ASK_V2_PROMPT_VERSION}:${m.id}]`,
      tools: [
        'retrieve_course',
        'ask_peer',
        ...own(m.id as 'teacher' | 'practitioner' | 'skeptic'),
      ],
      tier: 'main',
      limits: { maxModelCalls: 6, maxOutputTokens: 3000, maxPeerAsks: 1 },
    }),
  );
  return [chair, ...specialists];
}
