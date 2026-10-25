import {
  CouncilRunsResponseSchema,
  CouncilStatusSchema,
  type CouncilRunRecord,
  type CouncilStatus,
} from '@squad/core';
import { timedFetch } from '../../lib/http';
import type { HubCtx } from '../../pages/village/hub';

/** Pure fetch helpers for `GET /v1/council/status` and `GET /v1/council/runs`. A miss is `null`, never a throw. */
const base = (c: HubCtx) => c.hubUrl.replace(/\/+$/, '');
const auth = (c: HubCtx): Record<string, string> =>
  c.token ? { Authorization: `Bearer ${c.token}` } : {};

export async function getCouncilStatus(hub: HubCtx): Promise<CouncilStatus | null> {
  try {
    const res = await timedFetch(`${base(hub)}/v1/council/status`, { headers: auth(hub) });
    if (!res.ok) return null;
    const p = CouncilStatusSchema.safeParse(await res.json());
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

export async function getCouncilRuns(hub: HubCtx): Promise<CouncilRunRecord[] | null> {
  try {
    const res = await timedFetch(`${base(hub)}/v1/council/runs`, { headers: auth(hub) });
    if (!res.ok) return null;
    const p = CouncilRunsResponseSchema.safeParse(await res.json());
    return p.success ? p.data.runs : null;
  } catch {
    return null;
  }
}
