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
  tripId: string;
  optionId: string;
  label: string;
  cost?: string;
}
/**
 * Answers go to the generic `POST /v1/confirms/:taskId {optionId, yes}` (fails closed for unknown tasks). The preview below still reads the trip to name the option. A `confirm.pending` task id
 * maps to its trip by the hub's naming (`task_trip_x` -> `trip_x`); the leading unvetoed option is the one being
 * confirmed. The sheet shows it BEFORE the student answers, and the answer reuses exactly that option. Other task kinds
 * have no endpoint yet, so they reject and the sheet shows its error state (contract request: a generic
 * `POST /v1/confirms/:taskId`).
 */
export async function previewConfirm(c: HubCtx, taskId: string): Promise<ConfirmTarget> {
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
    taskId,
    tripId: trip.tripId,
    optionId: leading.id,
    label: leading.label ?? leading.id,
    ...(leading.estCost ? { cost: leading.estCost } : {}),
  };
}
export async function resolveConfirm(
  c: HubCtx,
  target: ConfirmTarget,
  yes: boolean,
): Promise<void> {
  await ok(
    await timedFetch(`${base(c)}/v1/confirms/${encodeURIComponent(target.taskId)}`, {
      method: 'POST',
      headers: { ...json, ...auth(c) },
      body: JSON.stringify({ optionId: target.optionId, yes }),
    }),
    'confirm',
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
