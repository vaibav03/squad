import { z } from 'zod';
import type { ToolDecl, ToolName } from './types';

const submitTurn = z.object({
  summary: z
    .string()
    .describe(
      'Public explanation for the student: your conclusion and why, 1 to 2 sentences, max 280 chars. Not scratch work.',
    ),
  stance: z.string().describe('Short status line, max 80 chars, e.g. "leaning B, unsure about step 3".'),
  answer: z.string().optional().describe('Your committed short answer ("B", "yes, with a caveat").'),
  order: z
    .array(z.string())
    .optional()
    .describe('Only when ranking: the response labels, best first.'),
  confidence: z
    .enum(['confident', 'fairly_sure', 'uncertain'])
    .optional()
    .describe('Only for the final verdict.'),
  citations: z
    .array(
      z.object({
        file: z.string(),
        page: z.number(),
        quote: z.string().describe('Verbatim quote (3+ words) copied from that page.'),
      }),
    )
    .optional()
    .describe('Only quotes you copied word for word from retrieve_course results.'),
  dissent: z
    .object({ member: z.string(), why: z.string() })
    .optional()
    .describe('Only for the verdict: who disagreed with it and why you did not follow them.'),
});

export const TOOL_DECLS: Record<ToolName, ToolDecl> = {
  submit_turn: {
    name: 'submit_turn',
    description:
      'Submit your visible turn. This is the ONLY way to produce output the student sees; call it exactly once, last.',
    parameters: submitTurn as ToolDecl['parameters'],
  },
  retrieve_course: {
    name: 'retrieve_course',
    description:
      'Look up the course materials. Returns verbatim page excerpts tagged [file p.N] that are safe to quote. Use before making claims about what the course says.',
    parameters: z.object({
      query: z.string().describe('What to look up, as a short question.'),
    }) as ToolDecl['parameters'],
  },
  delegate: {
    name: 'delegate',
    description:
      'Chair only. Send one sub-question to a named specialist and get their public answer back. Call once per specialist you want to hear from, all in the same step so they work in parallel.',
    parameters: z.object({
      to: z.string().describe('Specialist key from your roster.'),
      question: z.string().describe('The sub-question for them, self-contained.'),
      why: z.string().describe('One short line: why you are asking them (shown to the student).'),
    }) as ToolDecl['parameters'],
  },
  ask_peer: {
    name: 'ask_peer',
    description:
      'Ask ONE colleague specialist a short question (once per run). They see only your question, not your reasoning.',
    parameters: z.object({
      to: z.string().describe('Colleague key from your roster.'),
      question: z.string().describe('A short, self-contained question.'),
    }) as ToolDecl['parameters'],
  },
  calendar_summary: {
    name: 'calendar_summary',
    description:
      "The asking student's free-time summary for a range (aggregates only: free hours, busiest days). Never event titles.",
    parameters: z.object({
      range: z.string().describe('e.g. "this week", "next 7 days", "this term".'),
    }) as ToolDecl['parameters'],
  },
  mastery_summary: {
    name: 'mastery_summary',
    description:
      "The asking student's mastery summary (which topics are strong or weak, in words). No scores or ranks.",
    parameters: z.object({}) as ToolDecl['parameters'],
  },
};

export function toolsFor(names: readonly ToolName[]): ToolDecl[] {
  const set = new Set<ToolName>([...names, 'submit_turn']);
  return [...set].map((n) => TOOL_DECLS[n]);
}
