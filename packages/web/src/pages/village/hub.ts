import type { Citation } from '@squad/core';
import { z } from 'zod';
import type { QuizPayload, QuizResult } from '../../overlays/types';

/** Hub access for the village overlays. Pure fetch helpers: no React, no Phaser, no secrets in errors. */
export interface HubCtx {
  hubUrl: string;
  token: string | null;
}
const base = (c: HubCtx) => c.hubUrl.replace(/\/+$/, '');
const auth = (c: HubCtx): Record<string, string> => (c.token ? { Authorization: `Bearer ${c.token}` } : {});
const json = { 'content-type': 'application/json' };

export class HubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
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
  const res = await ok(await fetch(`${base(c)}/v1/quiz/${encodeURIComponent(quizId)}`, { headers: auth(c) }), 'quiz');
  const q = HubQuiz.parse(await res.json());
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
  const res = await fetch(`${base(c)}/v1/quiz/${encodeURIComponent(quizId)}/answer`, {
    method: 'POST',
    headers: { ...json, ...auth(c) },
    body: JSON.stringify(answer),
  });
  // 409 already_answered still means the answer is on record.
  if (res.status === 409) return { recorded: true };
  await ok(res, 'answer');
  return HubResult.parse(await res.json());
}

// ---------------------------------------------------------------- confirm

const Trip = z.object({
  tripId: z.string(),
  options: z.array(z.object({ id: z.string() })),
  vetoed: z.array(z.object({ optionId: z.string() })).optional(),
  tallies: z.record(z.string(), z.number()).nullable().optional(),
});
/**
 * The hub has one confirm endpoint today: `POST /v1/trips/:tripId/confirm {optionId, yes}`. A `confirm.pending` task id
 * maps to its trip by the hub's naming (`task_trip_x` -> `trip_x`); the leading unvetoed option is the one confirmed.
 * Other task kinds have no endpoint yet, so they reject and the sheet shows its error state (contract request in the
 * handoff: a generic `POST /v1/confirms/:taskId`).
 */
export async function resolveConfirm(c: HubCtx, taskId: string, yes: boolean): Promise<void> {
  const tripId = taskId.replace(/^task_/, '');
  const view = await ok(await fetch(`${base(c)}/v1/trips/${encodeURIComponent(tripId)}`, { headers: auth(c) }), 'trip');
  const trip = Trip.parse(await view.json());
  const vetoed = new Set((trip.vetoed ?? []).map((v) => v.optionId));
  const open = trip.options.filter((o) => !vetoed.has(o.id));
  const leading = [...open].sort((a, b) => (trip.tallies?.[b.id] ?? 0) - (trip.tallies?.[a.id] ?? 0))[0] ?? trip.options[0];
  if (!leading) throw new HubError(409, 'trip has no options');
  await ok(
    await fetch(`${base(c)}/v1/trips/${encodeURIComponent(trip.tripId)}/confirm`, {
      method: 'POST',
      headers: { ...json, ...auth(c) },
      body: JSON.stringify({ optionId: leading.id, yes }),
    }),
    'confirm',
  );
}

// ---------------------------------------------------------------- call

const CallStart = z.object({ callId: z.string(), wsUrl: z.string(), ticket: z.string() });
export async function startCall(c: HubCtx, agentId: string) {
  const res = await fetch(`${base(c)}/v1/call/start`, {
    method: 'POST',
    headers: { ...json, ...auth(c) },
    body: JSON.stringify({ agentId }),
  });
  if (res.status === 409) throw new HubError(409, 'You are already on a call.');
  if (res.status === 429) throw new HubError(429, 'The village is busy. Try again in a moment.');
  await ok(res, 'call');
  return CallStart.parse(await res.json());
}

export type { Citation };
