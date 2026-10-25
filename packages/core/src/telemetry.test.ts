import { describe, expect, it } from 'vitest';
import {
  CORR_HEADER,
  corrFromHeaders,
  corrHeaders,
  createErrorBuffer,
  createLogger,
  createMetrics,
  createSeriesStore,
  estimateCostUsd,
  hashId,
  hideSmall,
  logLevelFromEnv,
  newCorrId,
  normalizeCorrId,
  redact,
  redactString,
} from './telemetry';

describe('redaction', () => {
  it('removes keys, tokens, secrets and withheld values by key and by shape', () => {
    const out = JSON.stringify(
      redact({
        apiKey: 'AIzaSyA1234567890123456789012345',
        authorization: 'Bearer abcdefghijklmnop',
        nested: { internalSecret: 'x', withheld: '$40', ok: 'fine' },
        url: 'http://h/v1/stream?st=abc.def&x=1',
        note: 'Bearer zzzzzzzzzzzzzz inside text',
      }),
    );
    for (const bad of ['AIza', 'abcdefghijklmnop', '$40', 'st=abc', 'zzzzzzzz'])
      expect(out).not.toContain(bad);
    expect(out).toContain('fine');
  });
  it('keeps numeric token counts', () => {
    expect(redact({ tokens: 12, inputTokens: 5 })).toEqual({ tokens: 12, inputTokens: 5 });
  });
  it('reduces free text to its length and hashes student ids', () => {
    const o = redact({ text: 'my private message', student: 's_ana' }, { salt: 'a' }) as Record<
      string,
      string
    >;
    expect(o.text).toBe('[text:18]');
    expect(o.student).toMatch(/^h_[0-9a-f]{14}$/);
    expect(o.student).toBe(hashId('s_ana', 'a'));
    expect(o.student).not.toBe(hashId('s_ana', 'b'));
  });
  it('survives cycles, depth and errors', () => {
    const a: Record<string, unknown> = { e: new Error('boom Bearer abcdefghijkl') };
    a.self = a;
    const s = JSON.stringify(redact(a));
    expect(s).toContain('[circular]');
    expect(s).not.toContain('abcdefghijkl');
    expect(redactString('x'.repeat(900), 10).length).toBe(13);
  });
});

describe('logger', () => {
  const mk = (level: 'debug' | 'info' | 'warn' | 'error' | 'silent' = 'info') => {
    const lines: string[] = [];
    return {
      lines,
      log: createLogger({
        svc: 't',
        level,
        sink: (l) => lines.push(l),
        now: () => 0,
        context: () => ({ corr: 'c_ambient01' }),
      }),
    };
  };
  it('emits JSON with svc, level, ambient corr and redacted fields', () => {
    const { lines, log } = mk();
    log.info('hello', { token: 'x', student: 's_ben' });
    const r = JSON.parse(lines[0]!);
    expect(r).toMatchObject({
      svc: 't',
      level: 'info',
      msg: 'hello',
      corr: 'c_ambient01',
      token: '[redacted]',
    });
    expect(r.student).toMatch(/^h_/);
  });
  it('filters by level and binds child fields', () => {
    const { lines, log } = mk('warn');
    log.info('no');
    log.child({ part: 'x' }).warn('yes');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).part).toBe('x');
    const q = mk('silent');
    q.log.error('x');
    expect(q.lines).toHaveLength(0);
  });
  it('picks levels by env', () => {
    expect(logLevelFromEnv({ LOG_LEVEL: 'warn' })).toBe('warn');
    expect(logLevelFromEnv({ NODE_ENV: 'production' })).toBe('info');
    expect(logLevelFromEnv({ VITEST: 'true' })).toBe('silent');
    expect(logLevelFromEnv({})).toBe('debug');
  });
});

describe('correlation', () => {
  it('generates, validates and propagates ids', () => {
    const id = newCorrId();
    expect(normalizeCorrId(id)).toBe(id);
    expect(normalizeCorrId('bad id\n')).toBeUndefined();
    expect(normalizeCorrId('short')).toBeUndefined();
    expect(corrFromHeaders(new Headers({ [CORR_HEADER]: id }))).toBe(id);
    expect(corrFromHeaders({ 'x-request-id': 'req_12345678' })).toBe('req_12345678');
    expect(corrFromHeaders(new Headers({ [CORR_HEADER]: 'nope nope' }))).toMatch(/^c_/);
    expect(corrHeaders(id)).toEqual({ [CORR_HEADER]: id });
    expect(corrHeaders(undefined)).toEqual({});
  });
});

describe('metrics registry', () => {
  it('renders counters, gauges, histograms and collectors as Prometheus text', () => {
    const m = createMetrics();
    const c = m.counter('squad_x_total', 'x');
    c.inc({ a: 'b"c' });
    c.inc({ a: 'b"c' }, 2);
    c.inc({ a: 'z' }, -1); // ignored
    m.gauge('squad_g', 'g').set(4);
    const h = m.histogram('squad_h_seconds', 'h', [0.1, 1]);
    h.observe(0.05, { r: '/a' });
    h.observe(0.5, { r: '/a' });
    m.collect((set) => set('squad_dyn', 'd', 7, { k: 'v' }));
    const t = m.render();
    expect(t).toContain('# TYPE squad_x_total counter');
    expect(t).toContain('squad_x_total{a="b\\"c"} 3');
    expect(t).toContain('squad_g 4');
    expect(t).toContain('squad_h_seconds_bucket{r="/a",le="0.1"} 1');
    expect(t).toContain('squad_h_seconds_bucket{r="/a",le="+Inf"} 2');
    expect(t).toContain('squad_h_seconds_count{r="/a"} 2');
    expect(t).toContain('squad_dyn{k="v"} 7');
    expect(c.get({ a: 'b"c' })).toBe(3);
    expect(m.total('squad_x_total')).toBe(3);
    expect(h.quantile(0.5)).toBe(0.1);
    expect(h.quantile(1)).toBe(1);
  });
  it('rejects bad names, type clashes and caps label cardinality', () => {
    const m = createMetrics();
    expect(() => m.counter('1bad', 'x')).toThrow();
    m.counter('squad_a', 'a');
    expect(() => m.gauge('squad_a', 'a')).toThrow();
    const c = m.counter('squad_card', 'c');
    for (let i = 0; i < 2000; i++) c.inc({ id: i });
    expect(m.snapshot().squad_card!.length).toBeLessThanOrEqual(501);
  });
  it('a throwing collector does not break the scrape', () => {
    const m = createMetrics();
    m.collect(() => {
      throw new Error('x');
    });
    expect(m.render()).toBe('\n');
  });
});

describe('series store', () => {
  it('buckets per minute, oldest first, and forgets old minutes', () => {
    let t = 60_000 * 1000;
    const s = createSeriesStore(() => t, 5);
    s.add('a');
    s.add('a', 2);
    t += 60_000;
    s.add('a');
    s.set('g', 9);
    expect(s.read('a')).toEqual([0, 0, 0, 3, 1]);
    expect(s.read('g', 2)).toEqual([0, 9]);
    t += 60_000 * 10;
    expect(s.read('a')).toEqual([0, 0, 0, 0, 0]);
    expect(s.names()).toEqual(['a', 'g']);
  });
});

describe('error buffer', () => {
  it('is bounded, newest first, dedupes repeats and scrubs secrets', () => {
    let t = 1;
    const seen: number[] = [];
    const b = createErrorBuffer(
      3,
      () => t,
      (e) => seen.push(e.id),
    );
    b.capture(new Error('same'));
    b.capture(new Error('same'));
    expect(b.size()).toBe(1);
    expect(b.list()[0]!.count).toBe(2);
    for (const m of ['a', 'b', 'c']) {
      t += 100_000;
      b.capture(new Error(m));
    }
    expect(b.size()).toBe(3);
    expect(b.list().map((e) => e.message)).toEqual(['c', 'b', 'a']);
    const e = b.capture(new Error('k Bearer abcdefghijklmnop'), {
      context: { apiKey: 'zzz', student: 's_ana' },
    });
    expect(JSON.stringify(e)).not.toMatch(/abcdefghijklmnop|zzz|s_ana/);
    expect(seen.length).toBeGreaterThan(0);
  });
});

describe('cost and visibility', () => {
  it('estimates cost per tier and hides small counts', () => {
    expect(
      estimateCostUsd('main', { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toBeCloseTo(2.8);
    expect(estimateCostUsd('main', undefined)).toBe(0);
    expect(hideSmall(2)).toBeNull();
    expect(hideSmall(3)).toBe(3);
  });
});
