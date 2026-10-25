import { timedFetch } from '../../lib/http';
import type { Citation } from '@squad/core';
import { z } from 'zod';
import type { QuizPayload, QuizResult } from '../../overlays/types';

/** Hub access for the village overlays. Pure fetch helpers: no React, no Phaser, no secrets in errors. */
export interface HubCtx {
  hubUrl: string;
  token: string | null;
}
const base = (c: HubCtx) => c.hubUrl.replace(/\/+$/, '');
const auth = (c: HubCtx): Record<string, string> =>
  c.token ? { Authorization: `Bearer ${c.token}` } : {};
const json = { 'content-type': 'application/json' };

export class HubError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Optional copy that is safe to show as is. */
    readonly userText?: string,
  ) {
    super(message);
  }
}
/** Schema failures are the hub's fault, not something to show: they become a 502 with a fixed message. */
function parseOrThrow<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new HubError(502, 'unexpected hub response');
  return r.data;
}
/** Fixed, user-safe copy for a failed hub call. Never echoes a status line, body or schema error. */
export function userMessage(e: unknown, fallback: string): string {
  if (e instanceof HubError) {
    if (e.status === 401 || e.status === 403) return 'Your session ended. Sign in again.';
    if (e.status === 409 || e.status === 429) return e.userText ?? fallback;
  }
  return fallback;
}
async function ok(res: Response, what: string): Promise<Response> {
  if (!res.ok) throw new HubError(res.status, `${what} ${res.status}`);
  return res;
}

// ---------------------------------------------------------------- quiz

const HubQuiz = z.object({
  quizId: z.string(),
  chapter: z.string(),
  question: z.string(),
  choices: z.array(z.object({ id: z.string(), text: z.string() })).optional(),
});
export const chapterLabel = (c: string) => (/^ch\d+$/i.test(c) ? `Ch${c.slice(2)}` : c);

export async function fetchQuiz(c: HubCtx, quizId: string): Promise<QuizPayload> {
  const res = await ok(
    await timedFetch(`${base(c)}/v1/quiz/${encodeURIComponent(quizId)}`, { headers: auth(c) }),
    'quiz',
  );
  const q = parseOrThrow(HubQuiz, await res.json());
  return {
    quizId: q.quizId,
    chapter: chapterLabel(q.chapter),
    question: q.question,
    ...(q.choices ? { choices: q.choices.map((x) => ({ id: x.id, label: x.text })) } : {}),
  };
}

const HubResult = z.object({
  recorded: z.literal(true),
  correct: z.boolean().optional(),
  explanation: z.string().optional(),
});
export async function answerQuiz(
  c: HubCtx,
  quizId: string,
  answer: { choice?: string; text?: string },
): Promise<QuizResult> {
  const res = await timedFetch(`${base(c)}/v1/quiz/${encodeURIComponent(quizId)}/answer`, {
    method: 'POST',
    headers: { ...json, ...auth(c) },
    body: JSON.stringify(answer),
  });
  // 409 already_answered still means the answer is on record.
  if (res.status === 409) return { recorded: true };
  await ok(res, 'answer');
  return parseOrThrow(HubResult, await res.json());
}

// ---------------------------------------------------------------- confirm

const Trip = z.object({
  tripId: z.string(),
  options: z.array(
    z.object({ id: z.string(), label: z.string().optional(), estCost: z.string().optional() }),
  ),
  vetoed: z.array(z.object({ optionId: z.string() })).optional(),
  tallies: z.record(z.string(), z.number()).nullable().optional(),
});
export interface ConfirmTarget {
  /** The confirm.pending task id; the answer goes to POST /v1/confirms/:taskId. */
  taskId: string;
  /** Present only when the task belongs to a trip (enrichment, never required). */
  tripId?: string;
  /** Option sent with the answer; for a trip it is the leading option, otherwise the chosen one. */
  optionId?: string;
  label?: string;
  cost?: string;
  /** Real choices the bot offered (a debate verdict has two sides), shown as the sheet buttons. */
  options?: string[];
  question?: string;
  /** Set when the hub says the question can no longer be answered: buttons go away, the sheet says why. */
  closed?: 'expired' | 'answered';
  /** The option that was chosen, when `closed` is 'answered' and the hub says which. */
  answer?: string;
  /** The question's own expiry (epoch ms), when the hub provides it. */
  expiresAt?: number;
  /** Original ask, re-sent by "Ask again" to create a NEW confirm. */
  reask?: { chatId: string; text: string };
}

const Preview = z.object({
  taskId: z.string(),
  question: z.string(),
  options: z.array(z.string()),
  kind: z.string(),
  mode: z.enum(['pick', 'yesno']),
  expiresAt: z.number().optional(),
  reask: z.object({ chatId: z.string(), text: z.string() }).optional(),
});

async function tripTarget(c: HubCtx, taskId: string): Promise<Partial<ConfirmTarget>> {
  const tripId = taskId.replace(/^task_/, '');
  const res = await ok(
    await timedFetch(`${base(c)}/v1/trips/${encodeURIComponent(tripId)}`, { headers: auth(c) }),
    'trip',
  );
  const trip = parseOrThrow(Trip, await res.json());
  const vetoed = new Set((trip.vetoed ?? []).map((v) => v.optionId));
  const open = trip.options.filter((o) => !vetoed.has(o.id));
  const leading =
    [...open].sort((a, b) => (trip.tallies?.[b.id] ?? 0) - (trip.tallies?.[a.id] ?? 0))[0] ??
    trip.options[0];
  if (!leading) throw new HubError(409, 'trip has no options');
  return {
    tripId: trip.tripId,
    optionId: leading.id,
    label: leading.label ?? leading.id,
    ...(leading.estCost ? { cost: leading.estCost } : {}),
  };
}

/**
 * Builds what the sheet shows for a `confirm.pending` task. It NEVER requires a trip: the base target is the event's own
 * data (`fallback`), enriched by the hub's viewer-scoped `GET /v1/confirms/:taskId` when it exists, and by the trip
 * lookup only for trip tasks. Every lookup failure falls back silently, so a failed preview can never block answering.
 */
export async function previewConfirm(
  c: HubCtx,
  taskId: string,
  fallback: { question?: string; options?: string[] } = {},
): Promise<ConfirmTarget> {
  let target: ConfirmTarget = {
    taskId,
    ...(fallback.question ? { question: fallback.question } : {}),
    ...(fallback.options?.length ? { options: fallback.options } : {}),
  };
  let kind: string | undefined;
  try {
    const raw = await timedFetch(`${base(c)}/v1/confirms/${encodeURIComponent(taskId)}`, {
      headers: auth(c),
    });
    // The hub says why a visible task is closed: 404 expired, 409 already answered. Neither can be answered again.
    if (raw.status === 404) {
      const b = (await raw.json().catch(() => ({}))) as {
        error?: { code?: unknown };
        reask?: unknown;
      };
      // only the hub's explicit `expired` closes the sheet; an unknown task still falls back to the event's data
      if (b.error?.code === 'expired') {
        const r = z.object({ chatId: z.string(), text: z.string() }).safeParse(b.reask);
        return { ...target, closed: 'expired', ...(r.success ? { reask: r.data } : {}) };
      }
    } else if (raw.status === 409) {
      const b = (await raw.json().catch(() => ({}))) as { answer?: unknown };
      return {
        ...target,
        closed: 'answered',
        ...(typeof b.answer === 'string' ? { answer: b.answer } : {}),
      };
    }
    const res = await ok(raw, 'confirm preview');
    const p = parseOrThrow(Preview, await res.json());
    kind = p.kind;
    target = {
      ...target,
      question: p.question,
      ...(p.mode === 'pick' && p.options.length ? { options: p.options } : {}),
      ...(p.expiresAt ? { expiresAt: p.expiresAt } : {}),
      ...(p.reask ? { reask: p.reask } : {}),
    };
  } catch {
    /* no preview endpoint / unknown to the preview: use the event's data */
  }
  if (kind === 'trip' || (kind === undefined && /^task_trip_/.test(taskId))) {
    try {
      target = { ...target, ...(await tripTarget(c, taskId)) };
    } catch {
      /* not a trip after all: still answerable */
    }
  }
  return target;
}

/** Distinct, honest copy per failure. 'Nothing was shared' appears only when the answer demonstrably did not go out. */
export function confirmErrorMessage(e: unknown): string {
  if (e instanceof HubError) {
    if (e.status === 401 || e.status === 403) return 'Your session ended. Sign in again.';
    if (e.status === 404) return 'This question expired: ask again.';
    if (e.status === 409) return 'Already answered.';
    if (e.status === 422)
      return 'This one can only be answered in the chat. Nothing was shared from here.';
    if (e.status === 429) return 'Too many tries. Wait a moment and try again.';
    if (e.status >= 500)
      return 'The village could not pass your answer on. Try again. Nothing was shared yet.';
  }
  return 'Could not reach the village. Check your connection and try again. Nothing was shared.';
}

/** Posts the answer. 409 (already answered) is surfaced as a HubError so the sheet can say so. */
export async function resolveConfirm(
  c: HubCtx,
  target: ConfirmTarget,
  yes: boolean,
  optionId?: string,
): Promise<void> {
  const opt = optionId ?? target.optionId;
  await ok(
    await timedFetch(`${base(c)}/v1/confirms/${encodeURIComponent(target.taskId)}`, {
      method: 'POST',
      headers: { ...json, ...auth(c) },
      body: JSON.stringify({ yes, ...(opt ? { optionId: opt } : {}) }),
    }),
    'confirm',
  );
}

/**
 * "Ask again": posts the original question as a NEW chat message (fresh clientId, so the hub's clientId dedupe never
 * swallows it) and the bot creates a new confirm. The old one stays closed.
 */
export async function askAgain(c: HubCtx, reask: { chatId: string; text: string }): Promise<void> {
  const clientId = `reask_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await ok(
    await timedFetch(`${base(c)}/v1/chat/send`, {
      method: 'POST',
      headers: { ...json, ...auth(c) },
      body: JSON.stringify({ chatId: reask.chatId, text: reask.text, clientId }),
    }),
    'ask again',
  );
}

// ---------------------------------------------------------------- call

const CallStart = z.object({ callId: z.string(), wsUrl: z.string(), ticket: z.string() });
export async function startCall(c: HubCtx, agentId: string) {
  const res = await timedFetch(`${base(c)}/v1/call/start`, {
    method: 'POST',
    headers: { ...json, ...auth(c) },
    body: JSON.stringify({ agentId }),
  });
  if (res.status === 409) throw new HubError(409, 'busy', 'You are already on a call.');
  if (res.status === 429)
    throw new HubError(429, 'busy', 'The village is busy. Try again in a moment.');
  await ok(res, 'call');
  return parseOrThrow(CallStart, await res.json());
}

export type { Citation };
