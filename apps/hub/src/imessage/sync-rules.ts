// Pure rules of the iMessage <-> web sync (docs/imessage.md section 8): mirroring, attachments, backoff, delivery
// aggregation. No I/O, so every rule is unit-tested on its own.
import type { DeliveryState } from '@squad/core';
import type { MirrorMode, OutRow } from './store';

// ---------- mirroring (web squad chat -> bound iMessage groups) ----------
export interface MirrorInput {
  mode: MirrorMode;
  chatId: string;
  /** the channel the message came from; an iMessage-origin message is never sent back */
  via: string;
  /** the message @mentions an agent (`detectMention`) */
  mentionsAgent: boolean;
}
/**
 * Decides whether a STUDENT message typed on the web is copied to the squad's bound iMessage groups.
 * Bot replies are always mirrored (separate path). A DM never crosses threads.
 */
export function shouldMirrorStudent(i: MirrorInput): boolean {
  if (!i.chatId.startsWith('group:')) return false; // DMs never cross
  if (i.via === 'imessage') return false; // loop protection: it already is in iMessage
  if (i.mode === 'bot_only') return false;
  if (i.mode === 'full') return true;
  return i.mentionsAgent;
}

/** The marker that makes a mirrored web message recognisable (and droppable) if it ever comes back. */
export const VIA_MARKER = ' (via Squad): ';
export const mirrorText = (name: string, text: string): string =>
  `${name.replace(/[:\n]/g, ' ').slice(0, 40)}${VIA_MARKER}${text}`;
/** true for text that is our own mirror echoing back (any sender). */
export const isMirrorEcho = (text: string): boolean => /^.{1,40} \(via Squad\): /s.test(text);

// ---------- attachments ----------
export const ATTACH_MAX_BYTES = 8 * 1024 * 1024;
export const ATTACH_MAX_PER_MESSAGE = 4;

export type AttachVerdict =
  | { ok: true; mime: string }
  | { ok: false; reason: 'unsupported_type' | 'too_large' | 'unavailable' };

const at = (b: Uint8Array, i: number, ...x: number[]) => x.every((v, k) => b[i + k] === v);
/** The real type from magic bytes, among the types the web can render. */
export function sniffAttachment(b: Uint8Array): string | undefined {
  if (at(b, 0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (at(b, 0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(b, 0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (at(b, 0, 0x52, 0x49, 0x46, 0x46) && at(b, 8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  if (at(b, 0, 0x25, 0x50, 0x44, 0x46)) return 'application/pdf';
  if (at(b, 0, 0x52, 0x49, 0x46, 0x46) && at(b, 8, 0x57, 0x41, 0x56, 0x45)) return 'audio/wav';
  if (at(b, 4, 0x66, 0x74, 0x79, 0x70)) return 'audio/mp4'; // ftyp: m4a (a video ftyp is excluded by the mime check)
  if (at(b, 0, 0x49, 0x44, 0x33) || at(b, 0, 0xff, 0xfb)) return 'audio/mpeg';
  return undefined;
}
const DECLARED_OK =
  /^(image\/(png|jpeg|webp|gif)|application\/pdf|audio\/(mp4|x-m4a|mpeg|wav|x-wav))$/;

/** Type and size caps. `declared` is what Apple says; the bytes decide. */
export function classifyAttachment(
  declared: string,
  size: number,
  head: Uint8Array,
): AttachVerdict {
  if (size > ATTACH_MAX_BYTES) return { ok: false, reason: 'too_large' };
  if (!DECLARED_OK.test(declared.toLowerCase())) return { ok: false, reason: 'unsupported_type' };
  const real = sniffAttachment(head);
  if (!real) return { ok: false, reason: 'unsupported_type' };
  // a declared image must be an image, etc.: no smuggling by relabelling
  const fam = (m: string) => m.split('/')[0];
  if (
    fam(real) !== fam(declared.toLowerCase()) &&
    !(real === 'audio/mp4' && declared.startsWith('audio/'))
  )
    return { ok: false, reason: 'unsupported_type' };
  return { ok: true, mime: real };
}

// ---------- retry ----------
export const BACKOFF_MS = [2_000, 8_000, 30_000, 120_000, 300_000] as const;
export const MAX_ATTEMPTS = BACKOFF_MS.length;
/** A queued message older than this is not sent any more (a late answer to a stale question is worse than none). */
export const OUT_EXPIRE_MS = 60 * 60_000;
export const RATE_RETRY_MS = 10_000;
/** After this many failures in a row the transport is labelled degraded. */
export const backoffFor = (attempts: number): number =>
  BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1]!;

// ---------- delivery aggregation ----------
const REASON_TEXT: Record<string, string> = {
  transport_error: 'iMessage did not accept it',
  chat_not_allowed: 'this chat is not on the allowlist',
  handle_not_allowed: 'this number is not on the allowlist',
  kill_switch: 'iMessage is switched off',
  expired: 'it waited too long to send',
  no_handle: 'no iMessage number is known for this chat yet',
  receipt_failed: 'iMessage reported it undelivered',
};
export const reasonText = (r: string | null | undefined): string =>
  r ? (REASON_TEXT[r] ?? 'unknown error') : 'unknown error';

/** One delivery state for a hub message from all its (target, part) rows. */
export function aggregateDelivery(
  rows: readonly OutRow[],
  o: { degraded: boolean; now: number },
): DeliveryState | undefined {
  if (!rows.length) return undefined;
  const attempts = Math.max(...rows.map((r) => r.attempts));
  const base = { attempts, updatedAt: o.now, ...(o.degraded ? { degraded: true } : {}) };
  const queued = rows.filter((r) => r.state === 'queued');
  if (queued.length) {
    const retrying = queued.some((r) => r.attempts > 0);
    return {
      ...base,
      state: 'queued',
      label: o.degraded
        ? 'Waiting to send: iMessage connection is unstable'
        : retrying
          ? 'Retrying iMessage send'
          : 'Sending to iMessage',
    };
  }
  const failed = rows.filter((r) => r.state === 'failed');
  if (failed.length) {
    const reason = failed[0]!.reason ?? 'transport_error';
    const targets = new Set(rows.map((r) => r.target));
    const failedTargets = new Set(failed.map((r) => r.target));
    const partial = targets.size > 1 && failedTargets.size < targets.size;
    return {
      ...base,
      state: 'failed',
      reason,
      label: partial
        ? `Failed in ${failedTargets.size} of ${targets.size} chats: ${reasonText(reason)}`
        : `Failed: ${reasonText(reason)}`,
    };
  }
  if (rows.every((r) => r.state === 'dry_run'))
    return { ...base, state: 'dry_run', label: 'Dry run, not sent' };
  if (rows.every((r) => r.state === 'delivered'))
    return { ...base, state: 'delivered', label: 'Delivered' };
  return { ...base, state: 'sent', label: 'Sent to iMessage' };
}
