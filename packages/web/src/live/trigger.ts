import { LIVE_TOPIC_MAX, LIVE_TOPIC_MIN } from '@squad/core';

/** `@cubbie discuss: <topic>` or `discuss: <topic>` at the start of a chat message. Returns the topic or null. */
export function parseDiscussTrigger(text: string): string | null {
  const m = /^\s*(?:@cubbie\s+)?discuss\s*:\s*([\s\S]+)$/i.exec(text);
  const topic = m?.[1]?.trim();
  if (!topic || topic.length < LIVE_TOPIC_MIN || topic.length > LIVE_TOPIC_MAX) return null;
  return topic;
}
