import type { AdminStatus } from './model';

const NOW = Date.UTC(2026, 9, 24, 9, 30, 0);
const wave = (base: number, amp: number, phase = 0) =>
  Array.from({ length: 60 }, (_, i) =>
    Math.max(0, Math.round(base + amp * Math.sin((i + phase) / 5) + ((i * 7) % 5))),
  );

/** Realistic sample used in mock mode and screenshots (no hub). Clearly labelled "Sample data" by the page. */
export const sampleStatus: AdminStatus = {
  now: NOW,
  version: '0.1.0',
  gitSha: '39aa87e95725',
  builtAt: '2026-10-24T07:12:00.000Z',
  uptimeS: 26_340,
  llm: {
    mode: 'demo',
    reason: 'credits_depleted',
    since: NOW - 11 * 60_000,
    lastProbeAt: NOW - 18_000,
    nextProbeAt: NOW + 42_000,
    fix: 'Top up Gemini credits in Google AI Studio (Billing). The hub rechecks every 60 seconds and switches back to the real model by itself, no restart needed.',
    demoSeconds: 1980,
    calls: { ok: 412, fallback: 57, failed: 3 },
    tokens: 238_400,
    costUsd: 0.31,
  },
  credits: {
    state: 'depleted',
    fix: 'Top up Gemini credits in Google AI Studio (Billing). The hub rechecks every 60 seconds and switches back to the real model by itself, no restart needed.',
  },
  tts: { state: 'on', characters: 18_240 },
  ports: 'real',
  agents: [
    { id: 's_ana', up: true, checkedAt: NOW - 6000, latencyMs: 14 },
    { id: 's_ben', up: true, checkedAt: NOW - 6000, latencyMs: 22 },
    { id: 's_chi', up: false, checkedAt: NOW - 6000 },
  ],
  sse: { subscribers: 7, drops: 1, lastSeq: 18_422 },
  events: { accepted: 18_422, invalid: 4, dropped: 2 },
  http: { requests: 52_310, errors5xx: 3 },
  errors: {
    total: 2,
    recent: [
      {
        id: 2,
        ts: NOW - 4 * 60_000,
        kind: 'http',
        name: 'TypeError',
        message: "Cannot read properties of undefined (reading 'squadId')",
        corr: 'c_91ab03ce7f2d4410',
        count: 3,
      },
      {
        id: 1,
        ts: NOW - 52 * 60_000,
        kind: 'unhandledRejection',
        name: 'LlmError',
        message: 'Gemini request timed out after 20000 ms',
        corr: 'c_5e27d0a8b9c1f336',
        count: 1,
      },
    ],
    sentry: false,
  },
  series: {
    http_requests: wave(70, 30),
    http_errors: Array.from({ length: 60 }, (_, i) => (i === 55 || i === 56 ? 1 : 0)),
    sse_subscribers: Array.from({ length: 60 }, (_, i) => Math.min(7, 2 + Math.floor(i / 9))),
    events: wave(18, 12, 9),
    sse_drops: Array.from({ length: 60 }, (_, i) => (i === 31 ? 1 : 0)),
    errors: Array.from({ length: 60 }, (_, i) => (i === 8 || i === 55 ? 1 : 0)),
    skills: wave(4, 3, 3),
    demo_mode: Array.from({ length: 60 }, (_, i) => (i >= 49 ? 1 : 0)),
  },
  skills: {
    recent: [
      { name: 'study_session', ok: true, at: NOW - 40_000 },
      { name: 'council_ask', ok: true, at: NOW - 3 * 60_000 },
      { name: 'trip_planner', ok: false, at: NOW - 9 * 60_000 },
      { name: 'quiz_me', ok: true, at: NOW - 12 * 60_000 },
    ],
    counts: { study_session: 41, quiz_me: 28, council_ask: 12, trip_planner: 7 },
  },
  activity: {
    quizAnswers: 84,
    councilRuns: 12,
    tripActions: 2 as unknown as number,
    replayPlays: 31,
  },
};
sampleStatus.activity.tripActions = null; // hidden: fewer than 3

export const sampleReal: AdminStatus = {
  ...sampleStatus,
  llm: {
    ...sampleStatus.llm,
    mode: 'real',
    reason: undefined,
    since: undefined,
    lastProbeAt: undefined,
    nextProbeAt: undefined,
    fix: undefined,
  },
  credits: { state: 'ok' },
  agents: sampleStatus.agents.map((a) => ({ ...a, up: true })),
  errors: { total: 0, recent: [], sentry: true },
  series: { ...sampleStatus.series, demo_mode: Array.from({ length: 60 }, () => 0) },
};

export const sampleEmpty: AdminStatus = {
  ...sampleStatus,
  agents: [],
  errors: { total: 0, recent: [], sentry: false },
  skills: { recent: [], counts: {} },
  activity: { quizAnswers: null, councilRuns: null, tripActions: null, replayPlays: null },
  series: Object.fromEntries(
    Object.keys(sampleStatus.series).map((k) => [k, Array.from({ length: 60 }, () => 0)]),
  ),
};
