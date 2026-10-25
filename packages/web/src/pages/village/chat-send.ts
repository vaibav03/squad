import type { HubCtx } from './hub';

/**
 * Sends a room's "say this in chat" phrase into the squad group chat through the hub's chat routes
 * (`GET /v1/chat/chats`, `POST /v1/chat/send`). Kept independent of the chat page so the village works without it.
 * Resolves true when the hub accepted the message.
 */
export async function sendPhraseToChat(
  hub: HubCtx,
  phrase: string,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<boolean> {
  if (!hub.token) return false;
  const base = hub.hubUrl.replace(/\/+$/, '');
  const auth = { Authorization: `Bearer ${hub.token}` };
  try {
    const list = await fetchImpl(`${base}/v1/chat/chats`, { headers: auth });
    if (!list.ok) return false;
    const body = (await list.json().catch(() => null)) as {
      chats?: Array<{ id: string; kind: string }>;
    } | null;
    const group = body?.chats?.find((c) => c.kind === 'group');
    if (!group) return false;
    const sent = await fetchImpl(`${base}/v1/chat/send`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: group.id, text: phrase }),
    });
    return sent.ok;
  } catch {
    return false;
  }
}
