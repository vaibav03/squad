import { z } from 'zod';
import type { InboundMessage, Llm, OutboundMessage, Skill } from '@squad/core';
import { isGradedGrab, stripMention } from '../../experts/intent';
import { loadPrompt } from '../../experts/prompts';
import { normalizeText } from '../../citations';
import { splitSentences } from '../../captions/sentences';
import type { Brain } from '../../experts/types';
import { UNAVAILABLE_TEXT } from '../doubt';

export const NO_POLICY_TEXT =
  "I couldn't find a homework policy in your syllabus, so I'm sticking to hints.";
export const ASK_CONCEPT_TEXT =
  "I can't see that problem. Tell me which concept it is about and I'll point you to the right slide.";

const PolicySchema = z.object({
  graded: z.union([z.boolean(), z.literal('unknown')]),
  policyLine: z.string(),
});
const LeakSchema = z.object({ revealsAnswer: z.boolean() });

const LEAK =
  /\b(?:the |final |correct )?(?:answer|solution|result)\s*(?:is|are|=|:)|\btherefore\b[^.]*=|\bso (?:x|y|n|the answer)\b[^.]*=|[=≈]\s*[-−]?\d/i;

/** Code-side guard: drops any sentence that looks like a final answer. Never returns a leak. */
export function scrubAnswerLeaks(text: string): string {
  return splitSentences(text)
    .filter((s) => !LEAK.test(s))
    .join(' ')
    .trim();
}

const GRADED_WORDS =
  /\b(hw|homework|problem set|pset|assignment|quiz|exam|midterm|final)\b|\bq\s*\d+\b/i;

/** Is `line` a verbatim line (modulo whitespace) of the policy text? */
export function isVerbatimLine(line: string, policy: string): boolean {
  const l = normalizeText(line);
  if (!l) return false;
  return policy
    .split(/\r?\n/)
    .some((p) => normalizeText(p).includes(l) && l.length >= Math.min(12, normalizeText(p).length));
}

function heuristicLine(policy: string): string {
  const lines = policy
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return (
    lines.find((l) => /not allowed|prohibited|may not|must write|violation/i.test(l)) ??
    lines.find((l) => /homework|graded/i.test(l)) ??
    ''
  );
}

async function classify(
  llm: Llm,
  policy: string,
  request: string,
): Promise<{ graded: boolean | 'unknown'; line: string }> {
  try {
    const r = await llm.json({
      model: 'fast',
      system: loadPrompt(import.meta.url, 'policy.system.md'),
      messages: `Syllabus policy:\n${policy}\n\nStudent request: ${request}`,
      schema: PolicySchema,
      temperature: 0,
    });
    const line = isVerbatimLine(r.policyLine, policy) ? r.policyLine.trim() : heuristicLine(policy);
    return { graded: r.graded, line };
  } catch {
    return { graded: GRADED_WORDS.test(request) ? true : 'unknown', line: heuristicLine(policy) };
  }
}

async function revealsAnswer(llm: Llm, request: string, hint: string): Promise<boolean> {
  try {
    const r = await llm.json({
      model: 'fast',
      system: loadPrompt(import.meta.url, 'leak.system.md'),
      messages: `Student request: ${request}\n\nHint:\n${hint}`,
      schema: LeakSchema,
      temperature: 0,
    });
    return r.revealsAnswer;
  } catch {
    return false; // the code-side scrub still ran
  }
}

export interface HwPolicyOptions {
  courseId?: (m: InboundMessage) => string;
}

/**
 * Homework help: a hint grounded in the slides (with citation) plus the syllabus policy line, never
 * the answer to graded work. No policy in the syllabus => say so and stay hint-only.
 */
export function createHwPolicySkill(brain: Brain, opts: HwPolicyOptions = {}): Skill {
  const course = opts.courseId ?? (() => 'demo');
  return {
    name: 'hwpolicy',
    async match(m) {
      if (!isGradedGrab(m.text)) return 0;
      return m.mentionsBot ? 0.95 : 0.5;
    },
    async handle(m, ctx): Promise<OutboundMessage[]> {
      const courseId = course(m);
      const request = stripMention(m.text);
      const policy = brain.store.getCourse(courseId)?.policy?.trim() ?? '';
      const reply = (text: string): OutboundMessage[] => [{ chatId: m.chatId, text }];

      const cls = policy
        ? await classify(ctx.llm, policy, request)
        : { graded: 'unknown' as const, line: '' };
      // Unknown or no policy => hint-only, the safe default.
      const hintOnly = cls.graded !== false;

      const concept = request
        .replace(/\b(?:just|please|can you|could you)\b/gi, ' ')
        .replace(/\b(?:do|solve|answer|finish|complete|write)\b/gi, ' ')
        .replace(/\b(?:hw|homework|problem set|pset|assignment)\s*#?\d*\b/gi, ' ')
        .replace(/\b(?:q|question|problem)\s*#?\d+\b/gi, ' ')
        .replace(/\b(?:my|the|this|for me|give me the answer)\b/gi, ' ')
        .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      let hint = '';
      if (concept.split(' ').filter((w) => w.length > 2).length >= 2) {
        try {
          const a = await brain.ask(
            courseId,
            hintOnly
              ? `Which idea or formula from the course materials helps with: ${concept}? Point to the concept only, do not solve anything.`
              : `Explain the idea behind: ${concept}`,
          );
          if (a.grounded) hint = a.text;
        } catch {
          return reply(UNAVAILABLE_TEXT);
        }
      }
      if (hintOnly && hint) {
        hint = scrubAnswerLeaks(hint);
        if (hint && (await revealsAnswer(ctx.llm, request, hint))) hint = '';
      }

      const parts: string[] = [];
      parts.push(
        hint ? `Hint: ${hint}` : hintOnly ? ASK_CONCEPT_TEXT : 'Not in the materials. Ask the TA.',
      );
      if (!policy) parts.push(NO_POLICY_TEXT);
      else if (cls.line) parts.push(`Course policy: "${cls.line}"`);
      if (cls.graded === true)
        parts.push("I can't do graded work for you, but I'm happy to go through the concept.");
      else if (hintOnly && policy)
        parts.push("I can't tell if this is graded, so I'm sticking to hints.");
      return reply(parts.join('\n'));
    },
  };
}
