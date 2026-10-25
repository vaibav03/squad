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
  /** Stable id of this one send: the hub stores a message with this id once, however often it is re-posted. */
  clientId: string = newClientId(),
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
    const post = () =>
      fetchImpl(`${base}/v1/chat/send`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ chatId: group.id, text: phrase, clientId }),
      });
    let sent: Response;
    try {
      sent = await post();
    } catch {
      sent = await post(); // one retry after a network error: same clientId, so it can never post twice
    }
    return sent.ok;
  } catch {
    return false;
  }
}

export const newClientId = (): string =>
  `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/** How long a finished send keeps answering "sent" for the same phrase (a double-click or a second panel's button). */
export const SENT_HOLD_MS = 3_000;

export type PhraseRun = (hub: HubCtx, phrase: string) => Promise<boolean>;

/**
 * One send per phrase at a time: while a send is pending, and for SENT_HOLD_MS after it landed, running the same
 * phrase again returns that send instead of posting another message ("Run it" pressed twice, or from two panels).
 */
export function createPhraseRunner(
  send: typeof sendPhraseToChat = sendPhraseToChat,
  now: () => number = Date.now,
): PhraseRun {
  const inflight = new Map<string, Promise<boolean>>();
  const done = new Map<string, { at: number; ok: boolean; p: Promise<boolean> }>();
  return (hub, phrase) => {
    const key = phrase.trim().replace(/\s+/g, ' ');
    const pending = inflight.get(key);
    if (pending) return pending;
    const recent = done.get(key);
    if (recent?.ok && now() - recent.at < SENT_HOLD_MS) return recent.p; // the same promise: callers can tell it is not a new send
    const p: Promise<boolean> = send(hub, phrase, undefined, newClientId())
      .catch(() => false)
      .then((ok) => {
        inflight.delete(key);
        done.set(key, { at: now(), ok, p });
        return ok;
      });
    inflight.set(key, p);
    return p;
  };
}
