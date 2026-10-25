import { VillageEventSchema, type VillageEvent } from './events';

export const INTERNAL_EVENTS_PATH = '/internal/events';
export const INTERNAL_HEADER = 'X-Nook-Internal';
export const DEFAULT_HUB_BASE_URL = 'http://localhost:8788';

export interface PostEventOptions {
  baseUrl?: string; // default env HUB_BASE_URL or http://localhost:8788
  secret?: string; // default env INTERNAL_EVENTS_SECRET (fallback NOOK_INTERNAL_SECRET)
  fetch?: typeof fetch;
  retries?: number; // extra attempts after the first; default 2
  retryDelayMs?: number; // base delay, doubles each retry; default 150
  timeoutMs?: number; // per attempt; default 3000
}

export interface PostEventResult {
  ok: boolean;
  status?: number;
  attempts: number;
  error?: string;
}

const env = (k: string): string | undefined =>
  typeof process !== 'undefined' ? process.env?.[k] : undefined;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The one helper every emitter uses to send a VillageEvent to the hub.
 * Validates the event first (throws on an invalid event: that is a programming error), then POSTs
 * with `X-Nook-Internal`. Retries on network errors and 5xx/429 only; 4xx (e.g. 401) fails fast.
 * Network failure never throws: it resolves `{ ok: false }` so a missing hub cannot crash a bot.
 */
export async function postEvent(
  event: VillageEvent,
  opts: PostEventOptions = {},
): Promise<PostEventResult> {
  return sendToHub(VillageEventSchema.parse(event), opts);
}

/**
 * Hub-only domain envelopes (`x.*`), never part of the VillageEvent union and never streamed raw
 * (for example `x.trip.upsert` with private limits, `x.ledger.private` with the raw withheld value).
 * Same endpoint, secret, retries and fail-soft behavior as postEvent. The hub validates `data`.
 */
export async function postHubEnvelope(
  type: `x.${string}`,
  data: unknown,
  opts: PostEventOptions = {},
): Promise<PostEventResult> {
  if (!/^x\.[a-z][a-z0-9_.]*$/.test(type)) throw new Error(`invalid hub envelope type: ${type}`);
  return sendToHub({ type, data }, opts);
}

async function sendToHub(valid: unknown, opts: PostEventOptions): Promise<PostEventResult> {
  const baseUrl = (opts.baseUrl ?? env('HUB_BASE_URL') ?? DEFAULT_HUB_BASE_URL).replace(/\/+$/, '');
  const secret = opts.secret ?? env('INTERNAL_EVENTS_SECRET') ?? env('NOOK_INTERNAL_SECRET') ?? '';
  const doFetch = opts.fetch ?? globalThis.fetch;
  const retries = opts.retries ?? 2;
  const delay = opts.retryDelayMs ?? 150;
  const timeoutMs = opts.timeoutMs ?? 3000;

  let last: PostEventResult = { ok: false, attempts: 0 };
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const res = await doFetch(`${baseUrl}${INTERNAL_EVENTS_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [INTERNAL_HEADER]: secret },
        body: JSON.stringify(valid),
        signal: AbortSignal.timeout(timeoutMs),
      });
      last = { ok: res.ok, status: res.status, attempts: attempt };
      if (res.ok) return last;
      if (res.status < 500 && res.status !== 429) return last; // not retryable
      last.error = `HTTP ${res.status}`;
    } catch (e) {
      last = { ok: false, attempts: attempt, error: (e as Error).message };
    }
    if (attempt <= retries) await sleep(delay * 2 ** (attempt - 1));
  }
  return last;
}

/** Alias used by spec 06/WORKFLOW wording. */
export const emitEvent = postEvent;
