import type { InboundMessage } from '@squad/core';

/** Removes "@cubbie", "hey cubbie," or "cubbie," from the start of a message. */
export function stripMention(text: string): string {
  return text
    .replace(/^\s*(?:hey\s+|hi\s+)?(?:@(?:cubbie|squad)|cubbie)\b[\s,:;-]*/i, '')
    .replace(/@(?:cubbie|squad)\b/gi, '')
    .trim();
}

const BEHIND =
  /\b(am i (?:falling |running )?behind|how am i doing|where do i stand|how far behind)\b/i;
const GRAB =
  /(?:\bjust\s+(?:do|solve|answer|finish)\b|\b(?:do|solve|finish|complete|write)\s+(?:my|the|this)\s+(?:hw|homework|assignment|problem set|pset)|\bgive me the (?:final )?answer\b|\b(?:do|solve|answer)\s+(?:hw|homework|pset|problem set)\s*#?\d+|\bsolve (?:problem|question|q)\s*#?\d+\b|\bfor me\b.*\b(?:hw|homework|problem|question|q\d)\b)/i;
const QUESTION =
  /\?|\b(?:why|how|what|when|where|which|who|explain|define|difference between|meaning of|tell me about)\b/i;

export const isBehindIntent = (t: string) => BEHIND.test(stripMention(t));
export const isGradedGrab = (t: string) => GRAB.test(stripMention(t));
export const looksLikeQuestion = (t: string) => QUESTION.test(stripMention(t));

export function mentioned(m: InboundMessage): boolean {
  return m.mentionsBot;
}
