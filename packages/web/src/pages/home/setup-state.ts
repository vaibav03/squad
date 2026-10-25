import { timedFetch } from '../../lib/http';

export type ItemState = 'loading' | 'done' | 'todo' | 'error';

export interface HubCtx {
  hubUrl: string | null;
  token: string | null;
}

export async function getJson(ctx: HubCtx, path: string): Promise<unknown> {
  if (!ctx.hubUrl) throw new Error('no_hub');
  const res = await timedFetch(`${ctx.hubUrl.replace(/\/+$/, '')}${path}`, {
    headers: ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {},
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return res.json();
}

export const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
