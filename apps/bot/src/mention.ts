/**
 * Mention detection. `@squad` is an alias for `@cubbie` (the web chat offers both). iMessage has no real @-mention for a bot, so a mention is: `@cubbie` anywhere
 * (case-insensitive, word-bounded), or a leading `cubbie,` / `cubbie:` / `hey|hi|yo|ok cubbie`.
 * Every DM counts as a mention. "cubbies", "scrubbie" and plain mid-sentence "cubbie" do not.
 */
const AT = /(^|[^a-z0-9_])@(?:cubbie|squad)(?![a-z0-9_])/i;
const LEAD = /^\s*(?:(?:hey|hi|hello|yo|ok|okay)[\s,]+)?cubbie(?:[\s]*[,:!?]|\s|$)/i;

export function detectMention(text: string, isGroup: boolean): boolean {
  if (!isGroup) return true;
  if (typeof text !== 'string' || text.length === 0) return false;
  return AT.test(text) || LEAD.test(text);
}
