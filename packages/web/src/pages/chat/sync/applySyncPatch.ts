import type { ChatSyncFields } from '@squad/core';

/** Immutable merge of sync fields into one message; returns the same array for an unknown id. */
export function applySyncPatch<T extends { id: string }>(
  messages: T[],
  messageId: string,
  patch: Partial<ChatSyncFields>,
): T[] {
  if (!messages.some((m) => m.id === messageId)) return messages;
  return messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m));
}

/** Asks the hub to retry a failed iMessage send. Never throws. */
export async function retryImessage(
  base: string,
  token: string,
  messageId: string,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<{ ok: boolean; retried: number }> {
  try {
    const res = await fetchImpl(
      `${base.replace(/\/+$/, '')}/v1/imessage/messages/${encodeURIComponent(messageId)}/retry`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return { ok: false, retried: 0 };
    const body = (await res.json().catch(() => null)) as { retried?: unknown } | null;
    return { ok: true, retried: typeof body?.retried === 'number' ? body.retried : 0 };
  } catch {
    return { ok: false, retried: 0 };
  }
}
