import type { LiveConfig } from '../../overlays/kit/live-config';
import { mockExcerpt } from './fixtures';
import type { SourceCitation, SourceExcerpt } from './types';

export class OfflineError extends Error {}

const cache = new Map<string, SourceExcerpt>();
interface Flight {
  promise: Promise<SourceExcerpt>;
  ctrl: AbortController;
  refs: number;
}
const flights = new Map<string, Flight>();

export const citationKey = (
  c: Pick<SourceCitation, 'file' | 'page' | 'quote' | 'courseId'>,
  cfg: Pick<LiveConfig, 'mode' | 'hubUrl'>,
): string =>
  JSON.stringify([cfg.mode, cfg.hubUrl ?? '', c.courseId ?? '', c.file, c.page, c.quote ?? '']);

export const getCached = (key: string) => cache.get(key);
export const clearSourceCache = () => {
  cache.clear();
  flights.clear();
};

function sourceUrl(c: SourceCitation, hubUrl: string): string {
  const p = new URLSearchParams({ file: c.file, page: String(c.page) });
  if (c.quote) p.set('quote', c.quote);
  if (c.courseId) p.set('courseId', c.courseId);
  return `${hubUrl.replace(/\/$/, '')}/v1/library/source?${p.toString()}`;
}

async function run(
  c: SourceCitation,
  cfg: LiveConfig,
  signal: AbortSignal,
): Promise<SourceExcerpt> {
  if (cfg.mode !== 'live') {
    await new Promise((r) => setTimeout(r, 0));
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    return mockExcerpt(c);
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new OfflineError();
  let res: Response;
  try {
    res = await fetch(sourceUrl(c, cfg.hubUrl ?? ''), {
      signal,
      headers: cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {},
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new OfflineError();
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* handled below */
  }
  const b = body as { ok?: unknown; reason?: unknown } | null;
  if (b && typeof b === 'object' && typeof b.ok === 'boolean') {
    if (b.ok === false && !['removed', 'page_missing', 'not_found'].includes(String(b.reason))) {
      throw new Error('Unexpected response');
    }
    return b as unknown as SourceExcerpt;
  }
  throw new Error(`Hub answered ${res.status}`);
}

/**
 * Cached + in-flight-deduped fetch. Returns a promise and a `release` that aborts the underlying
 * request when no consumer is left. Errors are never cached.
 */
export function loadSource(
  c: SourceCitation,
  cfg: LiveConfig,
): { promise: Promise<SourceExcerpt>; release: () => void } {
  const key = citationKey(c, cfg);
  const hit = cache.get(key);
  if (hit) return { promise: Promise.resolve(hit), release: () => {} };
  let flight = flights.get(key);
  if (!flight) {
    const ctrl = new AbortController();
    const f: Flight = { ctrl, refs: 0, promise: undefined as unknown as Promise<SourceExcerpt> };
    f.promise = run(c, cfg, ctrl.signal)
      .then((ex) => {
        cache.set(key, ex);
        return ex;
      })
      .finally(() => {
        if (flights.get(key) === f) flights.delete(key);
      });
    f.promise.catch(() => {});
    flights.set(key, f);
    flight = f;
  }
  const f = flight;
  f.refs += 1;
  let released = false;
  return {
    promise: f.promise,
    release: () => {
      if (released) return;
      released = true;
      f.refs -= 1;
      if (f.refs <= 0) {
        f.ctrl.abort();
        if (flights.get(key) === f) flights.delete(key);
      }
    },
  };
}

/** Raw file needs auth: fetch as a blob and return an object URL. */
export async function fetchRawObjectUrl(openUrl: string, cfg: LiveConfig): Promise<string> {
  const abs = /^https?:/i.test(openUrl)
    ? openUrl
    : `${(cfg.hubUrl ?? '').replace(/\/$/, '')}${openUrl}`;
  const res = await fetch(abs, {
    headers: cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {},
  });
  if (!res.ok) throw new Error(`Hub answered ${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: 'application/pdf' }));
}
