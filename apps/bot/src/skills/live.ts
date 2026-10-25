// `@nook discuss: <topic>` / "start a discussion on <topic>": starts a live agent discussion through the hub
// (the hub injects the starter), replies with a short line and the `(live discussion ld_xxxxxxxxxxxx)` footer that the
// web transport turns into the `live` card.
import type { InboundMessage, OutboundMessage, Skill } from '@squad/core';
import { stripMention } from '@squad/brain';

export interface LiveStarter {
  /** Throws an error named `LiveBusyError` (with `code`) when the asker already has a run or hit the hourly cap. */
  start(i: { topic: string; askedBy: string; chatId: string }): Promise<{ id: string }>;
}

export const LIVE_USAGE =
  'Start a live study discussion: "@nook discuss: how do z-scores work?" or "@nook start a discussion on regression". Five agents talk it through, you can interrupt, and you leave with takeaways.';
export const LIVE_BUSY =
  'You already have a live discussion running. Finish or stop that one first.';
export const LIVE_RATE =
  'You have started a lot of live discussions this hour. Try again a little later.';
export const LIVE_FOOTER = (id: string): string => `(live discussion ${id})`;

const EXPLICIT = /^\s*discuss\b[\s:,\-–—]*/i;
const NATURAL =
  /^\s*(?:please\s+|pls\s+|can you\s+|could you\s+|let'?s\s+)?(?:start|begin|open|host|run|have)\s+(?:a\s+|the\s+)?(?:live\s+)?(?:study\s+)?(?:discussion|debate\s+room|group discussion)\s*(?:on|about|of|for|:)?\s*/i;

/** The topic after the trigger, or null when the message is not a live-discussion request. */
export function liveTopic(text: string): string | null {
  const t = stripMention(text);
  const e = EXPLICIT.exec(t);
  if (e) return t.slice(e[0].length).trim();
  const n = NATURAL.exec(t);
  if (n) return t.slice(n[0].length).trim();
  return null;
}

export function createLiveSkill(starter: LiveStarter): Skill {
  return {
    name: 'live',
    async match(m) {
      return liveTopic(m.text) === null ? 0 : m.mentionsBot ? 0.97 : 0.3;
    },
    async handle(m: InboundMessage): Promise<OutboundMessage[]> {
      const topic = liveTopic(m.text);
      if (!topic || topic.length < 3) return [{ chatId: m.chatId, text: LIVE_USAGE }];
      try {
        const run = await starter.start({
          topic: topic.slice(0, 400),
          askedBy: m.from,
          chatId: m.chatId,
        });
        return [
          {
            chatId: m.chatId,
            text: `Starting a live discussion on "${topic.slice(0, 120)}". Open the card to listen and jump in.\n${LIVE_FOOTER(run.id)}`,
          },
        ];
      } catch (e) {
        if (e instanceof Error && e.name === 'LiveBusyError')
          return [
            {
              chatId: m.chatId,
              text: (e as Error & { code?: string }).code === 'busy' ? LIVE_BUSY : LIVE_RATE,
            },
          ];
        return [
          {
            chatId: m.chatId,
            text: "I couldn't start the discussion just now. Try again in a minute.",
          },
        ];
      }
    },
  };
}
