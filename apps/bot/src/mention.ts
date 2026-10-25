import { parseMentions } from '@squad/core';

/**
 * Mention detection, built on the shared parser (`parseMentions` in @squad/core, docs/agent-aliases.md).
 * A mention is any known alias (`@cubbie`, `@cubbi`, `@squad`, `@tutor`, `@quiz`, ...) anywhere in the text
 * (case-insensitive, word-bounded, not in code/quotes/links/emails), or a leading `cubbie,` / `cubbie:` / `hey|hi|yo|ok cubbie`.
 * Every DM counts as a mention. "cubbies", "scrubbie", "@cub" and plain mid-sentence "cubbie" do not.
 */
const LEAD = /^\s*(?:(?:hey|hi|hello|yo|ok|okay)[\s,]+)?cubbie?(?:[\s]*[,:!?]|\s|$)/i;

export function detectMention(text: string, isGroup: boolean): boolean {
  if (!isGroup) return true;
  if (typeof text !== 'string' || text.length === 0) return false;
  return parseMentions(text).mentions.length > 0 || LEAD.test(text);
}
