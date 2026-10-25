import { z } from 'zod';

export const ASK_PROMPT_VERSION = 'ask-v1';
export const ASK_COUNCIL_ID = 'ask';
export const CHAIR_NAME = 'Chair';

export interface AskMember {
  id: string;
  name: string;
  /** Shown on the member card. */
  stance: string;
  /** The member's own lens; the shared rules are added around it. */
  lens: string;
}

/** Three distinct stances so disagreement is real, not three copies of one answer. */
export const ASK_MEMBERS: readonly AskMember[] = [
  {
    id: 'skeptic',
    name: 'Skeptic',
    stance: 'Looks for what could be wrong',
    lens: 'You are the Skeptic. Assume the obvious answer might be wrong. Hunt for the hidden assumption, the edge case, the step that does not follow. Commit to the answer that survives your doubt, even if that means disagreeing with the popular choice.',
  },
  {
    id: 'teacher',
    name: 'Teacher',
    stance: 'Explains it from first principles',
    lens: 'You are the Teacher. Reason from the definitions and the underlying idea. Prefer the answer that is correct for the right reason and that a student could re-derive without memorising a trick.',
  },
  {
    id: 'practitioner',
    name: 'Practitioner',
    stance: 'Asks what works in practice',
    lens: 'You are the Practitioner. Care about what actually works on a real problem or exam: the simplest correct approach, the common trap, the time it costs. Commit to the approach you would use yourself.',
  },
];

const SHARED_RULES = [
  'You are one of three independent members of a study council helping a university student. You have NOT seen the other members. Never reveal or guess which member you are in your text; do not write "as the Skeptic".',
  'Commit to one short answer ("B", "yes, with a caveat", "approach 2"). Do not hedge between options: pick.',
  'Never do graded work for the student; help them decide or check their reasoning.',
  'Be concise: at most 4 sentences in `position`.',
].join('\n');

export const courseRules = (evidence: string): string =>
  [
    'COURSE MATERIALS (verbatim pages, each tagged [file p.N]):',
    evidence,
    '',
    'Grounding rules:',
    '- Every statement about what the course materials say MUST be a `claims` entry {text, file, page, quote}. `quote` must be copied word for word from that page (at least 3 words). A claim whose quote is not on the cited page is deleted by code.',
    '- `position` holds only your judgement and recommendation, not facts from the materials.',
    '- If the materials do not settle the question, say so in `position` and reason generally.',
  ].join('\n');

export const GENERAL_RULES =
  'No course materials cover this question, so reason from general knowledge. Do not cite files or pages. Say plainly when you are unsure.';

export const memberSystem = (m: AskMember, extra: string): string =>
  `${m.lens}\n\n${SHARED_RULES}\n\n${extra}\n[prompt ${ASK_PROMPT_VERSION}]`;

export const OpinionSchema = z.object({
  answer: z.string().default(''),
  position: z.string().default(''),
  claims: z
    .array(
      z.object({
        text: z.string(),
        file: z.string(),
        page: z.number(),
        quote: z.string(),
      }),
    )
    .max(8)
    .default([]),
});

export const RankSchema = z.object({ order: z.array(z.string()) });

export const VerdictOutSchema = z.object({
  verdict: z.string(),
  answer: z.string().default(''),
  agreeing: z.array(z.string()).default([]),
  dissentWhy: z.string().default(''),
  confidence: z.enum(['confident', 'fairly_sure', 'uncertain']).default('fairly_sure'),
  next: z.string().default(''),
});

export const TriageSchema = z.object({
  study: z.boolean(),
  reason: z.string().default(''),
});

export const TRIAGE_SYSTEM = `You screen questions for a university study council. Reply study=true when the question is about coursework, a problem, a proof, an approach, a concept or how to study. Reply study=false for anything else (personal advice, trivia, chit-chat, requests to write graded work wholesale). [prompt ${ASK_PROMPT_VERSION}:triage]`;

export const RANK_TASK =
  'Rank the responses below by how correct and useful they are, best first. The responses are anonymous. Reply JSON {"order": ["B","A"]} using only the labels shown.';

export const CHAIR_SYSTEM = `You are the Chair of a three-member study council. You read the members' answers and the peer ranking and give one verdict to a student. Prefer the answer with the best reasoning and the strongest peer ranking, not the majority by default. Always name who agrees. If a member disagrees, say in \`dissentWhy\` why you did not follow them, fairly, in one sentence. State your confidence in words only: confident (all agree and the reasoning is sound), fairly_sure (one member disagrees or evidence is thin), uncertain (the council is split or the evidence does not settle it). \`next\` is what the student should do next, one or two sentences. Never invent facts about the course materials. [prompt ${ASK_PROMPT_VERSION}:chair]`;
