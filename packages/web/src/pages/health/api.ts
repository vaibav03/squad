import { HealthReportSchema, type HealthReport } from '@squad/core';
import { timedFetch } from '../../lib/http';

export interface HubCtx {
  hubUrl: string;
  token: string | null;
}

/** GET /v1/connections/health (viewer-scoped, no secrets). Throws 'offline' | 'bad_response' | `http_<n>`. */
export async function fetchHealth(ctx: HubCtx): Promise<HealthReport> {
  let res: Response;
  try {
    res = await timedFetch(`${ctx.hubUrl.replace(/\/+$/, '')}/v1/connections/health`, {
      headers: ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {},
    });
  } catch {
    throw new Error('offline');
  }
  if (!res.ok) throw new Error(`http_${res.status}`);
  const p = HealthReportSchema.safeParse(await res.json().catch(() => null));
  if (!p.success) throw new Error('bad_response');
  return p.data;
}

/** A fix.api is `POST /v1/...` or just a path (GET). Returns true when the hub accepted it. */
export async function runFixApi(ctx: HubCtx, api: string): Promise<boolean> {
  const m = /^(GET|POST|DELETE)\s+(\/\S+)$/.exec(api.trim());
  const method = m ? m[1]! : 'GET';
  const path = m ? m[2]! : api.trim();
  if (!path.startsWith('/v1/')) return false;
  try {
    const res = await timedFetch(`${ctx.hubUrl.replace(/\/+$/, '')}${path}`, {
      method,
      headers: {
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
        ...(ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {}),
      },
      ...(method === 'POST' ? { body: '{}' } : {}),
    });
    return res.ok;
  } catch {
    return false;
  }
}
