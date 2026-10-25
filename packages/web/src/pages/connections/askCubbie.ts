import { defaultPrefill, queueAskCubbie } from '../chat/ask-cubbie';
import type { SourceRow } from './api';

export { PENDING_CONTEXT_KEY } from '../chat/ask-cubbie';

/** Opens the squad group chat with up to 3 imported items attached as context chips (prefilled, never sent). */
export function askCubbie(
  squadId: string,
  items: SourceRow | SourceRow[],
  go: (url: string) => void = (u) => window.location.assign(u),
): void {
  const list = (Array.isArray(items) ? items : [items]).slice(0, 3);
  if (list.length === 0) return;
  const chatId = `group:${squadId}`;
  queueAskCubbie({
    chatId,
    sourceIds: list.map((r) => ({ sourceId: r.id })),
    prefill: defaultPrefill(list[0]!.title),
  });
  go(`/squad/chat?c=${encodeURIComponent(chatId)}`);
}

/** Soonest upcoming due/start first, then the rest in list order. */
export function pickAskItems(rows: SourceRow[], now: number): SourceRow[] {
  const t = (r: SourceRow) => r.dueAt ?? r.startsAt;
  const upcoming = rows.filter((r) => (t(r) ?? 0) >= now).sort((a, b) => t(a)! - t(b)!);
  const rest = rows.filter((r) => !upcoming.includes(r));
  return [...upcoming, ...rest].slice(0, 3);
}
