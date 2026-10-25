import type { AccountErrorCode } from '@squad/core';

/** Codes the hub can send, plus the three the browser invents. */
export type ClientErrorCode = AccountErrorCode | 'network' | 'bad_response' | 'unknown';

const MESSAGES: Record<ClientErrorCode, string> = {
  unauthorized: 'Please sign in again to keep going.',
  forbidden: 'Only the squad owner can do that.',
  not_found: 'We could not find that. It may have been removed.',
  invalid_request: 'Something there does not look right. Check it and try again.',
  rate_limited: 'Too many tries. Wait a moment, then try again.',
  code_invalid: 'That code is not right. Check the message and try again.',
  code_expired: 'That code has expired. Send yourself a new one.',
  too_many_attempts: 'Too many wrong codes. Ask for a new code to keep going.',
  invite_invalid: 'That invite does not match any squad. Check the code and try again.',
  invite_expired: 'This invite has expired. Ask the person who sent it for a new one.',
  invite_revoked: 'This invite was cancelled. Ask the person who sent it for a new one.',
  invite_used_up: 'This invite has already been used up. Ask for a fresh one.',
  squad_full: 'This squad is full right now.',
  already_member: 'You are already in this squad.',
  last_owner: 'A squad needs at least one owner. Make someone else an owner first.',
  dev_login_disabled: 'Developer sign-in is turned off here.',
  network: 'Squad cannot be reached. Check your connection and try again.',
  bad_response: 'Squad sent something we did not understand. Try again in a moment.',
  unknown: 'Something went wrong on our side. Try again in a moment.',
};

const KNOWN = new Set<string>(Object.keys(MESSAGES));

export class AccountApiError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number;
  readonly triesLeft?: number;
  readonly retryAfterS?: number;
  /** Set on `already_member` when the hub names the squad the person is already in. */
  readonly squadId?: string;

  constructor(
    code: ClientErrorCode,
    status = 0,
    extra: { triesLeft?: number; retryAfterS?: number; squadId?: string } = {},
  ) {
    super(messageForError(code, extra));
    this.name = 'AccountApiError';
    this.code = code;
    this.status = status;
    if (extra.triesLeft !== undefined) this.triesLeft = extra.triesLeft;
    if (extra.retryAfterS !== undefined) this.retryAfterS = extra.retryAfterS;
    if (extra.squadId !== undefined) this.squadId = extra.squadId;
  }
}

/** Short, user-safe copy for a code. Never includes server text, tokens or ids. */
export function messageForError(
  code: ClientErrorCode,
  extra: { triesLeft?: number; retryAfterS?: number } = {},
): string {
  const base = MESSAGES[code] ?? MESSAGES.unknown;
  if (code === 'code_invalid' && typeof extra.triesLeft === 'number') {
    const n = Math.max(0, Math.floor(extra.triesLeft));
    return `${MESSAGES.code_invalid} ${n === 1 ? '1 try' : `${n} tries`} left.`;
  }
  if (code === 'rate_limited' && typeof extra.retryAfterS === 'number' && extra.retryAfterS > 0) {
    const s = Math.ceil(extra.retryAfterS);
    const wait = s >= 90 ? `${Math.ceil(s / 60)} minutes` : s === 1 ? '1 second' : `${s} seconds`;
    return `Too many tries. Please wait ${wait}, then try again.`;
  }
  return base;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function rec(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
}

/** Maps a failed HTTP response (status and parsed JSON body, either may be junk) to a typed error. */
export function errorFromResponse(status: number, body: unknown): AccountApiError {
  const root = rec(body);
  const err = rec(root?.error);
  const rawCode = str(err?.code);
  let code: ClientErrorCode;
  if (rawCode && KNOWN.has(rawCode)) code = rawCode as ClientErrorCode;
  else if (status === 401) code = 'unauthorized';
  else if (status === 403) code = 'forbidden';
  else if (status === 404) code = 'not_found';
  else if (status === 429) code = 'rate_limited';
  else if (status >= 400 && status < 500) code = 'invalid_request';
  else code = 'unknown';
  const squad = rec(err?.squad) ?? rec(root?.squad);
  const squadId = str(err?.squadId) ?? str(root?.squadId) ?? str(squad?.id);
  const triesLeft = num(err?.triesLeft) ?? num(root?.triesLeft);
  const retryAfterS = num(err?.retryAfterS) ?? num(root?.retryAfterS);
  return new AccountApiError(code, status, {
    ...(triesLeft !== undefined ? { triesLeft } : {}),
    ...(retryAfterS !== undefined ? { retryAfterS } : {}),
    ...(squadId !== undefined ? { squadId } : {}),
  });
}

export function isApiError(e: unknown, ...codes: ClientErrorCode[]): e is AccountApiError {
  return e instanceof AccountApiError && (codes.length === 0 || codes.includes(e.code));
}

/** Turns anything thrown into a short message for the UI. */
export function userMessage(e: unknown): string {
  if (e instanceof AccountApiError) return e.message;
  return MESSAGES.unknown;
}

/** `resendAfter` / `expiresAt` may arrive as epoch ms, epoch seconds, or seconds from now. Returns epoch ms. */
export function resolveDeadline(value: number, now = Date.now()): number {
  if (value > 1e12) return value;
  if (value > 1e9) return value * 1000;
  return now + Math.max(0, value) * 1000;
}
