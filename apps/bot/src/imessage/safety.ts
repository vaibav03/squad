import { normalizeHandle } from '../transports/common';
import type { IMessageMessageLike } from '../transports/imessage';
import type { Logger } from '../types';
import type { IMessageConfig } from './config';

export type DropReason =
  | 'disabled'
  | 'own_message'
  | 'reaction'
  | 'not_text'
  | 'no_chat'
  | 'duplicate'
  | 'ignored_handle'
  | 'bot_prefix'
  | 'echo'
  | 'flood'
  | 'chat_not_allowed'
  | 'handle_not_allowed';

export type OutboundVerdict =
  | { ok: true; kind: 'group' | 'dm' }
  | { ok: false; reason: 'disabled' | 'chat_not_allowed' | 'handle_not_allowed' | 'rate_limited' };

export const isGroupGuid = (chatId: string): boolean => /;\+;/.test(chatId);
const HANDLE = /^(\+?\d[\d\s().-]{5,}|[^@\s]+@[^@\s]+)$/;
export const looksLikeHandle = (s: string): boolean => HANDLE.test(s.trim());

/** The 1:1 handle of a chat guid such as `iMessage;-;+15551234567`, or undefined. */
export function handleOfDmGuid(chatId: string): string | undefined {
  const last = chatId.split(';').pop();
  return last && looksLikeHandle(last) ? last : undefined;
}

/** The sender of a raw message: the participant, or for a 1:1 the other side of the chat guid. */
export function senderOf(m: Pick<IMessageMessageLike, 'participant' | 'chatId'>): string {
  return m.participant ?? (m.chatId ? (handleOfDmGuid(m.chatId) ?? m.chatId) : '');
}

const ECHO_MS = 60_000;
const FLOOD_N = 8;
const FLOOD_WINDOW_MS = 10_000;
const FLOOD_MUTE_MS = 5 * 60_000;
const SEEN_MAX = 4000;
/** Our own persona prefixes ("🐻 Squad: ", "🎙 Host: "): another bot echoing us, or our own text coming back. */
const BOT_PREFIX = /^\s*\p{Extended_Pictographic}️?\s*[\p{L}][\p{L} ]{0,20}:\s/u;

export interface Safety {
  readonly config: IMessageConfig;
  admitInbound(
    m: IMessageMessageLike,
    o?: { backfill?: boolean },
  ): { ok: true } | { ok: false; reason: DropReason };
  admitOutbound(to: string): OutboundVerdict;
  /** Record a send so that its echo (chat.db lag, any sender) is dropped. */
  noteSent(to: string, text: string): void;
  /** Count a rate-limited unit of outbound for `to`. */
  consume(to: string): boolean;
}

export interface SafetyOptions {
  config: IMessageConfig;
  log?: Logger;
  now?: () => number;
  /** Persistent "have we seen this message guid" (hub: sqlite). Default: in-memory LRU. */
  seen?: (guid: string) => boolean;
}

export function createSafety(o: SafetyOptions): Safety {
  const c = o.config;
  const now = o.now ?? Date.now;
  const allowH = new Set(c.allowedHandles.map(normalizeHandle));
  const ignoreH = new Set(c.ignoreHandles.map(normalizeHandle));
  const allowC = new Set(c.allowedChats);
  const memSeen = new Set<string>();
  const seenFn =
    o.seen ??
    ((g: string) => {
      if (memSeen.has(g)) return true;
      memSeen.add(g);
      if (memSeen.size > SEEN_MAX) memSeen.delete(memSeen.values().next().value as string);
      return false;
    });
  const sent = new Map<string, number>(); // `${to}\n${text}` -> ts
  const burst = new Map<string, number[]>();
  const muted = new Map<string, number>();
  const outTimes = new Map<string, number[]>();

  const key = (to: string) => (looksLikeHandle(to) ? normalizeHandle(to) : to);
  const handleAllowed = (h: string) => c.allowAll || allowH.has(normalizeHandle(h));
  const chatAllowed = (g: string) => c.allowAll || allowC.has(g);

  return {
    config: c,
    admitInbound(m, opts) {
      if (!c.enabled) return { ok: false, reason: 'disabled' };
      if (m.isFromMe) return { ok: false, reason: 'own_message' };
      if (m.reaction) return { ok: false, reason: 'reaction' };
      if (m.kind && m.kind !== 'text' && !m.attachments?.length)
        return { ok: false, reason: 'not_text' };
      if (!m.chatId) return { ok: false, reason: 'no_chat' };
      const group = m.chatKind ? m.chatKind === 'group' : isGroupGuid(m.chatId);
      const sender = senderOf(m);
      // allowlists first: a chat that is not ours is never even deduped, logged or inspected further
      if (group ? !chatAllowed(m.chatId) : !handleAllowed(sender))
        return { ok: false, reason: group ? 'chat_not_allowed' : 'handle_not_allowed' };
      if (seenFn(m.id)) return { ok: false, reason: 'duplicate' };
      const n = normalizeHandle(sender);
      if (ignoreH.has(n)) return { ok: false, reason: 'ignored_handle' };
      const text = m.text ?? '';
      if (BOT_PREFIX.test(text)) return { ok: false, reason: 'bot_prefix' };
      const t = now();
      for (const [k, at] of sent) if (t - at > ECHO_MS) sent.delete(k);
      if (sent.has(`${key(group ? m.chatId : sender)}\n${text}`))
        return { ok: false, reason: 'echo' };
      // backfill replays history at machine speed: the flood guard is for live traffic
      if (opts?.backfill) return { ok: true };
      // another bot (or a runaway client) talking fast: mute that sender for a while
      if ((muted.get(n) ?? 0) > t) return { ok: false, reason: 'flood' };
      const times = (burst.get(n) ?? []).filter((x) => t - x < FLOOD_WINDOW_MS);
      times.push(t);
      burst.set(n, times);
      if (times.length > FLOOD_N) {
        muted.set(n, t + FLOOD_MUTE_MS);
        o.log?.warn({ sender: '[muted]' }, 'imessage: sender muted for flooding');
        return { ok: false, reason: 'flood' };
      }
      return { ok: true };
    },
    admitOutbound(to) {
      if (!c.enabled) return { ok: false, reason: 'disabled' };
      const dm = looksLikeHandle(to);
      if (dm ? !handleAllowed(to) : !chatAllowed(to))
        return { ok: false, reason: dm ? 'handle_not_allowed' : 'chat_not_allowed' };
      return { ok: true, kind: dm ? 'dm' : 'group' };
    },
    consume(to) {
      const t = now();
      const k = key(to);
      const times = (outTimes.get(k) ?? []).filter((x) => t - x < 60_000);
      if (times.length >= c.ratePerMin) {
        outTimes.set(k, times);
        return false;
      }
      times.push(t);
      outTimes.set(k, times);
      return true;
    },
    noteSent(to, text) {
      sent.set(`${key(to)}\n${text}`, now());
    },
  };
}

/**
 * Pure allowlist test for an inbound message (no dedupe, no flood state). A transport that must fetch something for a
 * message (Sendblue media) asks this first, so nothing is fetched for a chat or number that is not allowlisted.
 */
export function inboundAllowed(
  c: IMessageConfig,
  m: { chatId: string; sender: string; group: boolean },
): boolean {
  if (!c.enabled) return false;
  if (c.allowAll) return true;
  return m.group
    ? c.allowedChats.includes(m.chatId)
    : c.allowedHandles.map(normalizeHandle).includes(normalizeHandle(m.sender));
}
