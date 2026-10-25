import { timedFetch } from '../../lib/http';
import {
  agoWords,
  type PlanItem,
  type PlanItemPatch,
  type PlanMode,
  type PlanView,
} from '@squad/core';

export type PlanStatus = 'loading' | 'ready' | 'error' | 'offline';

export const MODE_LABEL: Record<PlanMode, string> = {
  live: 'Live',
  degraded: 'Degraded',
  demo: 'Demo',
};
export const MODE_TEXT: Record<PlanMode, string> = {
  live: 'Built by the live model and your squad agents.',
  degraded: 'The live model or an agent was unavailable, so this plan used a simpler fallback.',
  demo: 'Built by the scripted demo model, not a live agent.',
};

export const STATUS_WORD: Record<string, string> = {
  proposed: 'Proposed, waiting for answers',
  active: 'Active',
  cancelled: 'Cancelled',
  failed: 'Could not be built',
};

/** Items grouped by day, in date order; within a day by title. */
export function groupByDate(items: readonly PlanItem[]): { date: string; items: PlanItem[] }[] {
  const by = new Map<string, PlanItem[]>();
  for (const i of items) by.set(i.date, [...(by.get(i.date) ?? []), i]);
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({ date, items: list.sort((a, b) => a.title.localeCompare(b.title)) }));
}

/** `2026-11-03` -> `Tue 3 Nov` in UTC so every viewer reads the same day. */
export function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export const minutesWords = (m: number) =>
  m % 60 === 0 ? `${m / 60} h` : m > 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;

export function isPlanView(v: unknown): v is PlanView {
  const p = v as Partial<PlanView> | null;
  return !!p && typeof p.id === 'string' && Array.isArray(p.items) && Array.isArray(p.members);
}

const base = (hub: { hubUrl: string }) => hub.hubUrl.replace(/\/+$/, '');

export interface PlanHub {
  hubUrl: string;
  token: string | null;
}

export type PlanCall =
  | { ok: true; plan: PlanView | null }
  | { ok: false; code: string; message?: string; plan?: PlanView };

async function call(hub: PlanHub, method: string, path: string, body?: unknown): Promise<PlanCall> {
  try {
    const res = await timedFetch(`${base(hub)}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${hub.token ?? ''}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => null)) as {
      plan?: unknown;
      error?: { code?: string; message?: string };
    } | null;
    if (res.ok) {
      const plan = json && 'plan' in json ? json.plan : json;
      return { ok: true, plan: plan && isPlanView(plan) ? plan : null };
    }
    return {
      ok: false,
      code: json?.error?.code ?? String(res.status),
      ...(json?.error?.message ? { message: json.error.message } : {}),
      ...(json?.plan && isPlanView(json.plan) ? { plan: json.plan } : {}),
    };
  } catch {
    return { ok: false, code: 'network' };
  }
}

/** `Saved, version 3, last edited by Ana 4 min ago` (the plan lives in the hub, so a reload shows the same words). */
export function savedWords(plan: PlanView, now: number, nameOf: (id: string) => string): string {
  const s = plan.saved;
  if (!s) return `Saved, version ${plan.rev}`;
  return `Saved, version ${s.rev}, last edited by ${nameOf(s.lastEditedBy)} ${agoWords(s.lastEditedAt, now)}`;
}

export const SYNC_WORDS: Record<PlanView['sync']['imessage'], string> = {
  off: 'iMessage off',
  web_only: 'Web only',
  queued: 'Queued to iMessage',
  sent: 'Sent to iMessage',
  delivered: 'Delivered to iMessage',
  dry_run: 'iMessage dry run, not sent',
  failed: 'iMessage failed',
};

export function syncWords(plan: PlanView, now: number): string {
  const s = plan.sync;
  if (!s) return 'Not posted to chat yet';
  const chat = s.posted ? `Posted to chat ${agoWords(s.posted.at, now)}` : 'Not posted to chat yet';
  return `${chat} / ${SYNC_WORDS[s.imessage]}`;
}

export const planApi = {
  current: (h: PlanHub) => call(h, 'GET', '/v1/plans/current'),
  get: (h: PlanHub, id: string) => call(h, 'GET', `/v1/plans/${encodeURIComponent(id)}`),
  propose: (h: PlanHub, examDate: string) => call(h, 'POST', '/v1/plans', { examDate }),
  respond: (h: PlanHub, id: string, response: 'accept' | 'decline') =>
    call(h, 'POST', `/v1/plans/${encodeURIComponent(id)}/respond`, { response }),
  confirm: (h: PlanHub, id: string) =>
    call(h, 'POST', `/v1/plans/${encodeURIComponent(id)}/confirm`, {}),
  cancel: (h: PlanHub, id: string) =>
    call(h, 'POST', `/v1/plans/${encodeURIComponent(id)}/cancel`, {}),
  edit: (h: PlanHub, id: string, itemId: string, baseRev: number, patch: PlanItemPatch) =>
    call(h, 'PATCH', `/v1/plans/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`, {
      baseRev,
      patch,
    }),
  resolve: (h: PlanHub, id: string, cid: string, pick: 'theirs' | 'mine') =>
    call(
      h,
      'POST',
      `/v1/plans/${encodeURIComponent(id)}/conflicts/${encodeURIComponent(cid)}/resolve`,
      { pick },
    ),
  done: (h: PlanHub, id: string, itemId: string, done: boolean) =>
    call(
      h,
      'POST',
      `/v1/plans/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}/done`,
      {
        done,
      },
    ),
};

export const ASK_PHRASE = '@cubbie study plan';
