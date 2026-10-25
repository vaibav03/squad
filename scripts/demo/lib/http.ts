export interface HealthResult {
  ok: boolean;
  status?: number;
  error?: string;
}

type FetchFn = typeof fetch;

/** GET <base>/health. Never throws. */
export async function fetchHealth(
  baseUrl: string,
  opts: { timeoutMs?: number; fetch?: FetchFn } = {},
): Promise<HealthResult> {
  const f = opts.fetch ?? globalThis.fetch;
  try {
    const res = await f(`${baseUrl.replace(/\/+$/, '')}/health`, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? 1500),
    });
    return { ok: res.ok, status: res.status, ...(res.ok ? {} : { error: `HTTP ${res.status}` }) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Poll health until ok or the deadline passes. */
export async function waitForHealth(
  baseUrl: string,
  opts: {
    totalMs?: number;
    intervalMs?: number;
    fetch?: FetchFn;
    onTick?: (elapsedMs: number) => void;
    aborted?: () => boolean;
  } = {},
): Promise<HealthResult> {
  const total = opts.totalMs ?? 30_000;
  const interval = opts.intervalMs ?? 500;
  const started = Date.now();
  let last: HealthResult = { ok: false, error: 'not tried' };
  while (Date.now() - started < total) {
    if (opts.aborted?.()) return { ok: false, error: 'aborted' };
    last = await fetchHealth(baseUrl, { fetch: opts.fetch });
    if (last.ok) return last;
    opts.onTick?.(Date.now() - started);
    await new Promise((r) => setTimeout(r, interval));
  }
  return last;
}

/** Fetch JSON; returns undefined data with an error string on any failure. */
export async function fetchJson(
  url: string,
  opts: { timeoutMs?: number; fetch?: FetchFn } = {},
): Promise<{ data?: unknown; status?: number; error?: string }> {
  const f = opts.fetch ?? globalThis.fetch;
  try {
    const res = await f(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 3000) });
    if (!res.ok) return { status: res.status, error: `HTTP ${res.status}` };
    return { status: res.status, data: await res.json() };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
