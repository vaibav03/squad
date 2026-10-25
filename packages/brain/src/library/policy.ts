import { extractPolicy } from '../ingest/chapters';
import type { PolicyLine, PolicyTopic } from './types';

const TOPICS: [PolicyTopic, RegExp][] = [
  ['ai', /\b(AI\b|artificial intelligence|chatgpt|generative|language model|copilot)/i],
  ['integrity', /\b(academic integrity|plagiari|cheat|misconduct|violation)/i],
  ['collaboration', /\b(collaborat|classmates|group work|discuss|together|peers?)\b/i],
  ['homework', /\b(homework|assignment|problem sets?|graded|late work)/i],
];

export function classifyTopic(line: string): PolicyTopic {
  for (const [topic, re] of TOPICS) if (re.test(line)) return topic;
  return 'other';
}

/**
 * Policy lines of a syllabus: the same selection as `extractPolicy` (so hwpolicy keeps quoting the
 * same text), numbered, each an exact trimmed line of the input, in the original order. Nothing is
 * rewritten or invented; topics are labels only.
 */
export function extractPolicyLines(text: string): PolicyLine[] {
  const kept = extractPolicy(text)
    .split('\n')
    .filter((l) => l.length > 0);
  return kept.map((t, i) => ({ n: i + 1, text: t, verbatim: true, topic: classifyTopic(t) }));
}

/** The text stored in `courses.policy`: the policy lines, or the whole syllabus when none matched. */
export function policyColumn(text: string, lines: PolicyLine[]): string {
  return lines.length > 0 ? lines.map((l) => l.text).join('\n') : text.trim();
}
