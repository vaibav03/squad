import { z } from 'zod';

const Num = z.number().finite();
const Series = z.array(Num).max(120);

export const AdminStatusSchema = z.object({
  now: Num,
  version: z.string(),
  gitSha: z.string(),
  builtAt: z.string(),
  uptimeS: Num,
  llm: z.object({
    mode: z.enum(['real', 'demo']),
    reason: z.string().optional(),
    since: Num.optional(),
    lastProbeAt: Num.optional(),
    nextProbeAt: Num.optional(),
    fix: z.string().optional(),
    demoSeconds: Num,
    calls: z.object({ ok: Num, fallback: Num, failed: Num }),
    tokens: Num,
    costUsd: Num,
  }),
  credits: z.object({ state: z.enum(['ok', 'depleted', 'unknown']), fix: z.string().optional() }),
  tts: z.object({ state: z.enum(['on', 'off']), characters: Num }),
  ports: z.enum(['real', 'stub']),
  agents: z.array(
    z.object({ id: z.string(), up: z.boolean(), checkedAt: Num, latencyMs: Num.optional() }),
  ),
  sse: z.object({ subscribers: Num, drops: Num, lastSeq: Num }),
  events: z.object({ accepted: Num, invalid: Num, dropped: Num }),
  http: z.object({ requests: Num, errors5xx: Num }),
  errors: z.object({
    total: Num,
    recent: z.array(
      z.object({
        id: Num,
        ts: Num,
        kind: z.string(),
        name: z.string(),
        message: z.string(),
        corr: z.string().optional(),
        count: Num,
      }),
    ),
    sentry: z.boolean(),
  }),
  series: z.record(z.string(), Series),
  skills: z.object({
    recent: z.array(z.object({ name: z.string(), ok: z.boolean(), at: Num })),
    counts: z.record(z.string(), Num),
  }),
  activity: z.object({
    quizAnswers: Num.nullable(),
    councilRuns: Num.nullable(),
    tripActions: Num.nullable(),
    replayPlays: Num.nullable(),
  }),
});
export type AdminStatus = z.infer<typeof AdminStatusSchema>;

export function parseAdminStatus(raw: unknown): AdminStatus | null {
  const r = AdminStatusSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export type StatusView = 'loading' | 'ready' | 'error' | 'offline' | 'denied';

export function formatDuration(totalS: number): string {
  const s = Math.max(0, Math.round(totalS));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/** "in 42 s" / "12 s ago" / "now" relative to `now` (epoch ms). */
export function relTime(at: number | undefined, now: number): string {
  if (at === undefined) return 'not scheduled';
  const d = Math.round((at - now) / 1000);
  if (Math.abs(d) < 2) return 'now';
  return d > 0 ? `in ${formatDuration(d)}` : `${formatDuration(-d)} ago`;
}

/** Counts about people are hidden below the group minimum (the server sends null). */
export const countLabel = (n: number | null): string =>
  n === null ? 'Hidden' : n.toLocaleString('en-US');

export const money = (usd: number): string =>
  usd < 0.01 && usd > 0 ? '< $0.01' : `$${usd.toFixed(2)}`;

/** SVG polyline points for a series in a w x h box (flat series draws a centered line). */
export function sparkPoints(values: number[], w: number, h: number, pad = 2): string {
  if (values.length === 0) return '';
  const max = Math.max(...values);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  return values
    .map((v, i) => {
      const x = values.length === 1 ? w / 2 : pad + (i * (w - pad * 2)) / (values.length - 1);
      const y = max === min ? h / 2 : h - pad - ((v - min) / span) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export const seriesTotal = (v: number[] | undefined): number =>
  (v ?? []).reduce((a, b) => a + b, 0);
export const seriesLast = (v: number[] | undefined): number =>
  v && v.length ? v[v.length - 1]! : 0;

export const REASON_TITLE: Record<string, string> = {
  credits_depleted: 'Gemini credits are depleted (HTTP 402)',
  rate_limited: 'Gemini is rate limiting (HTTP 429)',
  invalid_key: 'Gemini rejected the API key (HTTP 401)',
  no_key: 'No GEMINI_API_KEY is set',
  forced_fake: 'FORCE_FAKE_LLM is on',
};

export interface DemoExplainer {
  heading: string;
  what: string;
  why: string;
  how: string;
}

/** The "demo mode" panel copy: what students see, why it happened, and how it comes back. */
export function explainDemo(s: AdminStatus): DemoExplainer {
  if (s.llm.mode === 'real')
    return {
      heading: 'Running on the real model',
      what: 'Answers come from Gemini.',
      why: 'If credits run out, the key is rejected or Gemini rate limits, Squad switches to the scripted demo model on its own so nothing breaks.',
      how: 'While in demo mode the hub probes the real model with one tiny request (every 60 s, every 10 min for a bad key) and switches back as soon as it answers.',
    };
  const r = s.llm.reason ?? 'no_key';
  return {
    heading: 'Demo mode is on',
    what: 'Answers come from the scripted demo model. The village, the privacy rules and every screen still work; the words are scripted, not generated.',
    why: REASON_TITLE[r] ?? 'The real model is unavailable.',
    how:
      r === 'no_key' || r === 'forced_fake'
        ? 'This does not recover by itself. Follow the fix below, then restart the hub.'
        : 'The hub keeps probing the real model and switches back by itself, no restart needed.',
  };
}
