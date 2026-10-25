// Browser-safe telemetry kit shared by hub, bot, agents and the web app: redaction, structured logger,
// correlation ids, a tiny metrics registry (Prometheus text), a minute time-series store and a bounded
// error ring. No Node imports: the Node-only parts (AsyncLocalStorage context, HTTP routes) live in the hub.

// ---------------------------------------------------------------------------------------------
// Redaction

const SECRET_KEY =
  /(^|[_\-.])(api[_-]?key|key|token|secret|password|passwd|authorization|auth|cookie|bearer|credential|signature|dsn|withheld|private)s?($|[_\-.])|apikey|accesstoken|refreshtoken|secret|password|authorization|withheld/i;
/** Free text written by people or the model: never logged, only its length. */
const TEXT_KEY =
  /^(text|content|body|prompt|transcript|answer|question|message|messages|reply|utterance|note|notes|summary|caption)$/i;
/** Student identifiers: logged only as a salted hash. */
const ID_KEY = /^(student|studentid|student_id|sid|me|owner|target|user|userid|user_id)$/i;

const VALUE_PATTERNS: [RegExp, string][] = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g, 'Bearer [redacted]'],
  [/AIza[0-9A-Za-z_-]{20,}/g, '[redacted]'],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, '[redacted]'],
  [/\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}(\.[A-Za-z0-9_-]{8,})?\b/g, '[redacted]'], // signed tokens / JWT
  [/([?&](?:st|token|key|api_key|apikey|secret|access_token)=)[^&\s]+/gi, '$1[redacted]'],
  [/\b[a-f0-9]{40,}\b/gi, '[redacted]'],
];

export const REDACTED = '[redacted]';

/** FNV-1a style 53-bit hash (cyrb53). Pseudonymises ids in logs; not a cryptographic guarantee. */
export function hashId(id: string, salt = ''): string {
  const s = salt + '\u0000' + id;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 'h_' + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

export interface RedactOptions {
  /** Salt for hashing ids (use a per-deployment secret). */
  salt?: string;
  maxDepth?: number;
  maxString?: number;
  /** Extra exact key names to treat as secret. */
  secretKeys?: string[];
}

export function redactString(s: string, max = 500): string {
  let out = s;
  for (const [re, rep] of VALUE_PATTERNS) out = out.replace(re, rep);
  return out.length > max ? out.slice(0, max) + '...' : out;
}

/** Deep copy with secrets removed, free text reduced to its length and student ids hashed. Cycle and depth safe. */
export function redact(value: unknown, o: RedactOptions = {}): unknown {
  const maxDepth = o.maxDepth ?? 6;
  const maxString = o.maxString ?? 500;
  const extra = new Set((o.secretKeys ?? []).map((k) => k.toLowerCase()));
  const seen = new WeakSet<object>();
  const walk = (v: unknown, depth: number, key?: string): unknown => {
    if (key !== undefined) {
      if (
        typeof v !== 'number' &&
        typeof v !== 'boolean' &&
        (SECRET_KEY.test(key) || extra.has(key.toLowerCase()))
      )
        return REDACTED;
      if (typeof v === 'string' && TEXT_KEY.test(key)) return `[text:${v.length}]`;
      if (typeof v === 'string' && ID_KEY.test(key)) return hashId(v, o.salt);
    }
    if (v === null || v === undefined) return v;
    if (typeof v === 'string') return redactString(v, maxString);
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'function' || typeof v === 'symbol') return undefined;
    if (v instanceof Error) {
      return { name: v.name, message: redactString(v.message, maxString) };
    }
    if (typeof v === 'object') {
      if (seen.has(v)) return '[circular]';
      if (depth >= maxDepth) return '[deep]';
      seen.add(v);
      if (Array.isArray(v)) return v.slice(0, 50).map((x) => walk(x, depth + 1));
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 60))
        out[k] = walk(x, depth + 1, k);
      return out;
    }
    return undefined;
  };
  return walk(value, 0);
}

// ---------------------------------------------------------------------------------------------
// Correlation ids (tracing-lite)

/** Header carried hub -> bot -> brain -> back to the hub's /internal/events. */
export const CORR_HEADER = 'x-squad-corr';
export const REQUEST_ID_HEADER = 'x-request-id';
const CORR_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function newCorrId(): string {
  const bytes = new Uint8Array(8);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return 'c_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A caller-supplied id is accepted only if it is a short, safe token (it ends up in logs and headers). */
export function normalizeCorrId(input: unknown): string | undefined {
  return typeof input === 'string' && CORR_RE.test(input) ? input : undefined;
}

type HeaderBag = { get(name: string): string | null | undefined } | Record<string, unknown>;
/** Existing correlation id from headers (x-squad-corr, then x-request-id) or a fresh one. */
export function corrFromHeaders(h: HeaderBag | undefined): string {
  const get = (n: string): unknown =>
    h && typeof (h as { get?: unknown }).get === 'function'
      ? (h as { get(n: string): string | null | undefined }).get(n)
      : (h as Record<string, unknown> | undefined)?.[n];
  return (
    normalizeCorrId(get(CORR_HEADER)) ?? normalizeCorrId(get(REQUEST_ID_HEADER)) ?? newCorrId()
  );
}

/** Headers to add to an outgoing internal call so the next hop logs the same id. */
export const corrHeaders = (corr: string | undefined): Record<string, string> =>
  corr ? { [CORR_HEADER]: corr } : {};

// ---------------------------------------------------------------------------------------------
// Logger

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

/** LOG_LEVEL wins; otherwise silent under tests, info in production, debug in dev. */
export function logLevelFromEnv(env: Record<string, string | undefined>): LogLevel {
  const v = env.LOG_LEVEL?.toLowerCase();
  if (v && v in ORDER) return v as LogLevel;
  if (env.VITEST || env.NODE_ENV === 'test') return 'silent';
  return env.NODE_ENV === 'production' ? 'info' : 'debug';
}

export interface Logger {
  debug(msg: string, f?: Record<string, unknown>): void;
  info(msg: string, f?: Record<string, unknown>): void;
  warn(msg: string, f?: Record<string, unknown>): void;
  error(msg: string, f?: Record<string, unknown>): void;
  /** Same logger with extra bound fields (service component, corr id). */
  child(f: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  svc: string;
  level?: LogLevel;
  sink?: (line: string) => void;
  /** Ambient fields per call (the hub supplies the active correlation id from AsyncLocalStorage). */
  context?: () => Record<string, unknown> | undefined;
  /** Hashing salt for student ids. */
  salt?: string;
  now?: () => number;
  /** Every emitted record (already redacted), e.g. the error ring or tests. */
  tap?: (rec: Record<string, unknown>) => void;
}

/** One JSON line per record: ts, level, svc, msg, corr?, then redacted fields. Never throws. */
export function createLogger(o: LoggerOptions, bound: Record<string, unknown> = {}): Logger {
  const level = o.level ?? 'info';
  const sink =
    o.sink ??
    ((l: string) => {
      const p = (globalThis as { process?: { stderr?: { write(s: string): void } } }).process;
      if (p?.stderr) p.stderr.write(l + '\n');
      else console.error(l);
    });
  const emit = (lv: Exclude<LogLevel, 'silent'>) => (msg: string, f?: Record<string, unknown>) => {
    if (ORDER[lv] < ORDER[level]) return;
    try {
      const fields = redact({ ...bound, ...o.context?.(), ...f }, { salt: o.salt }) as Record<
        string,
        unknown
      >;
      const rec = {
        ts: new Date((o.now ?? Date.now)()).toISOString(),
        level: lv,
        svc: o.svc,
        msg: redactString(msg, 300),
        ...fields,
      };
      o.tap?.(rec);
      sink(JSON.stringify(rec));
    } catch {
      /* logging must never break the caller */
    }
  };
  return {
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    child: (f) => createLogger(o, { ...bound, ...f }),
  };
}

// ---------------------------------------------------------------------------------------------
// Metrics registry (counters, gauges, histograms) with Prometheus text exposition

export type Labels = Record<string, string | number | boolean>;
const NAME_RE = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
export const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
/** A label set per metric is capped so a bad caller cannot blow up memory. */
const MAX_SERIES = 500;

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
function keyOf(labels: Labels | undefined): string {
  if (!labels) return '';
  const ks = Object.keys(labels).sort();
  return ks.map((k) => `${k}="${esc(String(labels[k]))}"`).join(',');
}

interface Family {
  name: string;
  help: string;
  type: 'counter' | 'gauge' | 'histogram';
}
export interface Counter {
  inc(labels?: Labels, by?: number): void;
  get(labels?: Labels): number;
}
export interface Gauge {
  set(value: number, labels?: Labels): void;
  inc(labels?: Labels, by?: number): void;
  get(labels?: Labels): number;
}
export interface Histogram {
  observe(value: number, labels?: Labels): void;
  count(labels?: Labels): number;
  sum(labels?: Labels): number;
  /** Approximate quantile (bucket upper bound) across all label sets; undefined with no data. */
  quantile(q: number): number | undefined;
}

export interface MetricsRegistry {
  counter(name: string, help: string): Counter;
  gauge(name: string, help: string): Gauge;
  histogram(name: string, help: string, buckets?: number[]): Histogram;
  /** Gauges computed at scrape time (subscribers, uptime, llm state). */
  collect(
    fn: (set: (name: string, help: string, v: number, labels?: Labels) => void) => void,
  ): void;
  /** Prometheus text format 0.0.4. */
  render(): string;
  /** Plain object view: name -> [{labels, value}] (histograms expose _count and _sum). */
  snapshot(): Record<string, { labels: string; value: number }[]>;
  /** Total of a counter/gauge across label sets. */
  total(name: string): number;
}

export function createMetrics(): MetricsRegistry {
  const families = new Map<string, Family>();
  const values = new Map<string, Map<string, number>>();
  const hist = new Map<
    string,
    { buckets: number[]; series: Map<string, { counts: number[]; sum: number; n: number }> }
  >();
  const collectors: Parameters<MetricsRegistry['collect']>[0][] = [];

  const family = (name: string, help: string, type: Family['type']) => {
    if (!NAME_RE.test(name)) throw new Error(`bad metric name ${name}`);
    const f = families.get(name);
    if (f && f.type !== type) throw new Error(`metric ${name} already registered as ${f.type}`);
    if (!f) families.set(name, { name, help, type });
    return families.get(name)!;
  };
  const slot = (name: string): Map<string, number> => {
    let m = values.get(name);
    if (!m) values.set(name, (m = new Map()));
    return m;
  };
  const bump = (name: string, labels: Labels | undefined, by: number, replace = false) => {
    const m = slot(name);
    const k = keyOf(labels);
    if (!m.has(k) && m.size >= MAX_SERIES) return;
    m.set(k, replace ? by : (m.get(k) ?? 0) + by);
  };

  return {
    counter(name, help) {
      family(name, help, 'counter');
      return {
        inc: (labels, by = 1) => {
          if (by > 0 && Number.isFinite(by)) bump(name, labels, by);
        },
        get: (labels) => slot(name).get(keyOf(labels)) ?? 0,
      };
    },
    gauge(name, help) {
      family(name, help, 'gauge');
      return {
        set: (v, labels) => Number.isFinite(v) && bump(name, labels, v, true),
        inc: (labels, by = 1) => bump(name, labels, by),
        get: (labels) => slot(name).get(keyOf(labels)) ?? 0,
      };
    },
    histogram(name, help, buckets = DEFAULT_BUCKETS) {
      family(name, help, 'histogram');
      let h = hist.get(name);
      if (!h)
        hist.set(name, (h = { buckets: [...buckets].sort((a, b) => a - b), series: new Map() }));
      const hh = h;
      return {
        observe(v, labels) {
          if (!Number.isFinite(v)) return;
          const k = keyOf(labels);
          let s = hh.series.get(k);
          if (!s) {
            if (hh.series.size >= MAX_SERIES) return;
            hh.series.set(k, (s = { counts: hh.buckets.map(() => 0), sum: 0, n: 0 }));
          }
          hh.buckets.forEach((b, i) => {
            if (v <= b) s!.counts[i]!++;
          });
          s.sum += v;
          s.n++;
        },
        count: (labels) => hh.series.get(keyOf(labels))?.n ?? 0,
        sum: (labels) => hh.series.get(keyOf(labels))?.sum ?? 0,
        quantile(q) {
          let n = 0;
          for (const s of hh.series.values()) n += s.n;
          if (!n) return undefined;
          const want = q * n;
          for (let i = 0; i < hh.buckets.length; i++) {
            let c = 0;
            for (const s of hh.series.values()) c += s.counts[i]!;
            if (c >= want) return hh.buckets[i];
          }
          return Infinity;
        },
      };
    },
    collect(fn) {
      collectors.push(fn);
    },
    render() {
      const dyn = new Map<string, { help: string; rows: [string, number][] }>();
      for (const c of collectors) {
        try {
          c((name, help, v, labels) => {
            if (!NAME_RE.test(name) || !Number.isFinite(v)) return;
            let d = dyn.get(name);
            if (!d) dyn.set(name, (d = { help, rows: [] }));
            d.rows.push([keyOf(labels), v]);
          });
        } catch {
          /* a broken collector must not break the scrape */
        }
      }
      const lines: string[] = [];
      const wrap = (k: string) => (k ? `{${k}}` : '');
      for (const f of [...families.values()].sort((a, b) => a.name.localeCompare(b.name))) {
        lines.push(`# HELP ${f.name} ${f.help}`, `# TYPE ${f.name} ${f.type}`);
        if (f.type === 'histogram') {
          const h = hist.get(f.name)!;
          for (const [k, s] of h.series) {
            const base = k ? k + ',' : '';
            h.buckets.forEach((b, i) =>
              lines.push(`${f.name}_bucket{${base}le="${b}"} ${s.counts[i]}`),
            );
            lines.push(`${f.name}_bucket{${base}le="+Inf"} ${s.n}`);
            lines.push(`${f.name}_sum${wrap(k)} ${s.sum}`, `${f.name}_count${wrap(k)} ${s.n}`);
          }
        } else {
          const m = slot(f.name);
          for (const [k, v] of m) lines.push(`${f.name}${wrap(k)} ${v}`);
        }
      }
      for (const [name, d] of [...dyn].sort((a, b) => a[0].localeCompare(b[0]))) {
        lines.push(`# HELP ${name} ${d.help}`, `# TYPE ${name} gauge`);
        for (const [k, v] of d.rows) lines.push(`${name}${wrap(k)} ${v}`);
      }
      return lines.join('\n') + '\n';
    },
    snapshot() {
      const out: Record<string, { labels: string; value: number }[]> = {};
      for (const [name, m] of values)
        out[name] = [...m].map(([labels, value]) => ({ labels, value }));
      for (const [name, h] of hist) {
        out[`${name}_count`] = [...h.series].map(([labels, s]) => ({ labels, value: s.n }));
        out[`${name}_sum`] = [...h.series].map(([labels, s]) => ({ labels, value: s.sum }));
      }
      return out;
    },
    total(name) {
      let t = 0;
      for (const v of values.get(name)?.values() ?? []) t += v;
      return t;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Minute time series (sparklines: last 60 minutes, in memory)

export interface SeriesStore {
  /** Add to the current minute bucket. */
  add(name: string, by?: number): void;
  /** Overwrite the current minute bucket (gauges: last value wins). */
  set(name: string, v: number): void;
  /** Oldest to newest, always `minutes` points (missing minutes are 0). */
  read(name: string, minutes?: number): number[];
  names(): string[];
}

export function createSeriesStore(now: () => number = Date.now, minutes = 60): SeriesStore {
  const data = new Map<string, Map<number, number>>();
  const minute = () => Math.floor(now() / 60_000);
  const prune = (m: Map<number, number>, cur: number) => {
    for (const k of m.keys()) if (k <= cur - minutes) m.delete(k);
  };
  const bucket = (name: string) => {
    let m = data.get(name);
    if (!m) data.set(name, (m = new Map()));
    return m;
  };
  return {
    add(name, by = 1) {
      const m = bucket(name);
      const cur = minute();
      m.set(cur, (m.get(cur) ?? 0) + by);
      prune(m, cur);
    },
    set(name, v) {
      const m = bucket(name);
      const cur = minute();
      m.set(cur, v);
      prune(m, cur);
    },
    read(name, n = minutes) {
      const m = data.get(name);
      const cur = minute();
      return Array.from({ length: n }, (_, i) => m?.get(cur - (n - 1 - i)) ?? 0);
    },
    names: () => [...data.keys()].sort(),
  };
}

// ---------------------------------------------------------------------------------------------
// Error ring

export interface CapturedError {
  id: number;
  ts: number;
  kind: 'error' | 'unhandledRejection' | 'uncaughtException' | 'http' | 'log';
  name: string;
  message: string;
  /** First frames only, with secrets scrubbed. */
  stack?: string;
  corr?: string;
  context?: Record<string, unknown>;
  count: number;
}

export interface ErrorBuffer {
  capture(
    err: unknown,
    ctx?: { kind?: CapturedError['kind']; corr?: string; context?: Record<string, unknown> },
  ): CapturedError;
  list(): CapturedError[]; // newest first
  size(): number;
  clear(): void;
}

export function createErrorBuffer(
  max = 100,
  now: () => number = Date.now,
  onCapture?: (e: CapturedError) => void,
  salt?: string,
): ErrorBuffer {
  let seq = 0;
  let items: CapturedError[] = [];
  return {
    capture(err, ctx = {}) {
      const e =
        err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'non-error thrown');
      const name = e.name || 'Error';
      const message = redactString(e.message ?? '', 300);
      const last = items[0];
      if (last && last.name === name && last.message === message && now() - last.ts < 60_000) {
        last.count++;
        last.ts = now();
        return last;
      }
      const stack = e.stack
        ? redactString(e.stack.split('\n').slice(0, 6).join('\n'), 1200)
        : undefined;
      const rec: CapturedError = {
        id: ++seq,
        ts: now(),
        kind: ctx.kind ?? 'error',
        name,
        message,
        ...(stack ? { stack } : {}),
        ...(ctx.corr ? { corr: ctx.corr } : {}),
        ...(ctx.context
          ? { context: redact(ctx.context, { salt }) as Record<string, unknown> }
          : {}),
        count: 1,
      };
      items.unshift(rec);
      if (items.length > max) items = items.slice(0, max);
      try {
        onCapture?.(rec);
      } catch {
        /* hook failures are ignored */
      }
      return rec;
    },
    list: () => items.map((i) => ({ ...i })),
    size: () => items.length,
    clear() {
      items = [];
    },
  };
}

// ---------------------------------------------------------------------------------------------
// LLM usage and cost estimate

/** USD per 1M tokens [input, output]. Estimates for the dashboard, not billing. Override with LLM_PRICES. */
export const DEFAULT_LLM_PRICES: Record<string, [number, number]> = {
  fast: [0.1, 0.4],
  main: [0.3, 2.5],
  chair: [1.25, 10],
};

export function estimateCostUsd(
  tier: string,
  usage: { inputTokens?: number; outputTokens?: number; cachedTokens?: number } | undefined,
  prices: Record<string, [number, number]> = DEFAULT_LLM_PRICES,
): number {
  if (!usage) return 0;
  const [pin, pout] = prices[tier] ?? prices.main ?? [0, 0];
  const cached = usage.cachedTokens ?? 0;
  const input = Math.max(0, (usage.inputTokens ?? 0) - cached);
  return (input * pin + cached * pin * 0.25 + (usage.outputTokens ?? 0) * pout) / 1_000_000;
}

/** Minimum group size under which counts about squads are hidden (matches the product rule). */
export const MIN_VISIBLE_COUNT = 3;
export const hideSmall = (n: number): number | null => (n < MIN_VISIBLE_COUNT ? null : n);
