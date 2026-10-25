import type { SourceRow } from './api';

/**
 * Hands one imported item to the group chat composer as an attached context chip (prefilled, never auto-sent).
 * Thin adapter: the chat page reads `squad.pendingContext` once on open. Switch this body to `queueAskCubbie`
 * from ../chat/ask-cubbie when that module is the single entry point.
 */
export const PENDING_CONTEXT_KEY = 'squad.pendingContext';

export function askCubbiePrefill(item: Pick<SourceRow, 'title' | 'kind'>): string {
  return `@cubbie what should I know about "${item.title}"?`;
}

export function askCubbie(
  squadId: string,
  item: SourceRow,
  go: (url: string) => void = (u) => window.location.assign(u),
): void {
  const chatId = `group:${squadId}`;
  try {
    sessionStorage.setItem(
      PENDING_CONTEXT_KEY,
      JSON.stringify({
        chatId,
        sourceIds: [{ sourceId: item.id }],
        prefill: askCubbiePrefill(item),
      }),
    );
  } catch {
    // storage blocked: the chat still opens, without a chip (the user can attach nothing; no silent fake)
  }
  go(`/squad/chat?c=${encodeURIComponent(chatId)}`);
}
