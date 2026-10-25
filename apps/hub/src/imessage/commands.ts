import { parseInviteInput } from '@squad/core';

export type ImessageCommand =
  { kind: 'join'; code: string | null } | { kind: 'leave' } | { kind: 'who' };

const MENTION = /^\s*(?:hey\s+|hi\s+)?(?:@(?:cubbie|squad)\b[:,]?|cubbie\b[:,])\s*/i;

/** Removes a leading @cubbie / `cubbie,` / `hey cubbie` and says whether there was one. */
export function stripMention(text: string): { text: string; mentioned: boolean } {
  const m = MENTION.exec(text);
  return m ? { text: text.slice(m[0].length), mentioned: true } : { text, mentioned: false };
}

/**
 * Chat commands handled by the bridge itself (never sent to the brain).
 * `join <code>` works with or without a mention but only when the code parses as an invite code (so "join us at 7"
 * stays ordinary banter). `leave squad` and `who is linked` need the mention. With a mention and a bad code, `join`
 * is still a command so the bot can say the code is wrong.
 */
export function parseCommand(raw: string): ImessageCommand | undefined {
  const { text, mentioned } = stripMention(raw.trim());
  const t = text.trim();
  const join = /^join\s+(.+)$/i.exec(t);
  if (join) {
    const code = parseInviteInput(join[1]!);
    if (code) return { kind: 'join', code };
    return mentioned ? { kind: 'join', code: null } : undefined;
  }
  if (!mentioned) return undefined;
  if (/^leave\s+(the\s+)?squad[.!]?$/i.test(t)) return { kind: 'leave' };
  if (/^(who(?:'s| is| are)? (?:linked|here|in|signed up)|members|who)\??[.!]?$/i.test(t))
    return { kind: 'who' };
  return undefined;
}
