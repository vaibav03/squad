import { parseMentions } from '@squad/core';

/**
 * Mention detection, built on the shared parser (`parseMentions` in @squad/core, docs/agent-aliases.md).
 * A mention is any known alias (`@cubbie`, `@cubbi`, `@squad`, `@tutor`, `@quiz`, ...) anywhere in the text
 * (case-insensitive, word-bounded, not in code/quotes/links/emails), or a leading `cubbie,` / `cubbie:` / `hey|hi|yo|ok cubbie`.
 * Every DM counts as a mention. "cubbies", "scrubbie", "@cub" and plain mid-sentence "cubbie" do not.
 */
// "hey cubbie ...", "cubbie, ...", "cubbie:" or a lone "cubbie". A bare leading "cubbie is slow" is chatter about the bot, not a mention.
const LEAD =
  /^\s*(?:(?:hey|hi|hello|yo|ok|okay)[\s,]+cubbie?(?![\p{L}\p{N}_])|cubbie?\s*[,:!?]|cubbie?\s*$)/iu;

export function detectMention(text: string, isGroup: boolean): boolean {
  if (!isGroup) return true;
  if (typeof text !== 'string' || text.length === 0) return false;
  return parseMentions(text).mentions.length > 0 || LEAD.test(text);
}
