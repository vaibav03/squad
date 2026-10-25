import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  VillageEventSchema,
  modeKind,
  validateA2aTrace,
  validateReplay,
  type A2aMessage,
  type ReplayScript,
} from './index';

const dir = resolve(__dirname, '../../../apps/hub/sim/replays');
const load = (name: string): ReplayScript => {
  const v = validateReplay(readFileSync(resolve(dir, `${name}.json`), 'utf8'));
  if (!v.ok) throw new Error(`${name}: ${v.errors.join('; ')}`);
  return v.script;
};
const a2a = (s: ReplayScript): A2aMessage[] =>
  s.events.flatMap((e) => (e.event.t === 'a2a.message' ? [e.event.msg] : []));

describe('council A2A replay fixtures (UI can be built on these)', () => {
  it('track2 and track3 still validate and their council events are labelled demo', () => {
    for (const n of ['track2', 'track3']) {
      const s = load(n);
      const council = s.events.filter((e) => e.event.t.startsWith('council.'));
      expect(council.length).toBeGreaterThan(0);
      for (const e of council) expect(e.event.mode).toBe('demo');
    }
  });

  it('healthy run: chair delegates to specialists, critiques, ranks, verdict with dissent', () => {
    const s = load('track4-council-a2a');
    const m = a2a(s);
    const kinds = new Set(m.map((x) => x.kind));
    for (const k of ['delegate', 'ask', 'answer', 'critique', 'rank', 'verdict', 'status'])
      expect(kinds.has(k as never)).toBe(true);
    expect(m.filter((x) => x.kind === 'delegate').map((x) => x.to)).toEqual([
      'council:ask-skeptic',
      'council:ask-teacher',
      'council:ask-practitioner',
    ]);
    expect(validateA2aTrace(m)).toEqual([]);
    const verdict = m.find((x) => x.kind === 'verdict');
    expect(verdict?.dissentRefs?.length).toBe(1);
    const dissent = m.find((x) => x.id === verdict?.dissentRefs?.[0]);
    expect(dissent?.from).toBe('council:ask-practitioner');
    const stages = s.events.flatMap((e) => (e.event.t === 'council.stage' ? [e.event.stage] : []));
    expect(stages).toEqual([
      'question',
      'delegation',
      'opinions',
      'critiques',
      'dissent',
      'verdict',
      'actions',
      'done',
    ]);
    // scripted fixtures are honest about it
    for (const x of m) {
      expect(x.source).toBe('script');
      expect(modeKind(x.mode)).toBe('demo');
    }
    // legacy events still flow and point at their envelope
    const legacy = s.events.flatMap((e) => (e.event.t === 'council.verdict' ? [e.event] : []));
    expect(legacy[0]?.dissent).toBe(true);
    expect(m.some((x) => x.id === legacy[0]?.a2aId)).toBe(true);
  });

  it('degraded run labels the failed member and the partial verdict', () => {
    const m = a2a(load('track4b-council-degraded'));
    expect(validateA2aTrace(m)).toEqual([]);
    expect(m.some((x) => x.mode === 'degraded:rate_limited' && x.status === 'failed')).toBe(true);
    const v = m.find((x) => x.kind === 'verdict');
    expect(v).toMatchObject({ status: 'partial', partial: true, mode: 'degraded:rate_limited' });
  });

  it('private run fixture is skeleton only: arrows and kinds, no text', () => {
    const s = load('track4c-council-private');
    const m = a2a(s);
    expect(m.length).toBeGreaterThan(10);
    for (const x of m) {
      for (const k of ['summary', 'stance', 'answer', 'order', 'citations', 'dissentRefs'])
        expect(x).not.toHaveProperty(k);
    }
    expect(s.events.some((e) => e.event.t === 'council.opinion')).toBe(false);
    expect(validateA2aTrace(m)).toEqual([]);
  });
});

describe('old-schema consumers tolerate the new kinds (rollout step 1)', () => {
  // What a consumer built before W0 sees: the union without the two additive kinds.
  const NEW = new Set(['a2a.message', 'council.stage']);
  const options = VillageEventSchema.options.filter(
    (o) => ![...NEW].some((k) => o.shape.t.safeParse(k).success),
  );
  const Legacy = z.discriminatedUnion('t', options as never);

  it('the legacy schema rejects the new kinds without throwing', () => {
    const s = load('track4-council-a2a');
    let skipped = 0;
    let kept = 0;
    expect(() => {
      for (const e of s.events) {
        const r = Legacy.safeParse(e.event);
        if (r.success) kept++;
        else skipped++;
      }
    }).not.toThrow();
    expect(skipped).toBeGreaterThan(0);
    expect(kept).toBeGreaterThan(0);
  });

  it('a defensive reducer (parse, ignore failures) ends in the same state with or without the new kinds', () => {
    const reduce = (
      events: unknown[],
      schema: { safeParse(x: unknown): { success: boolean; data?: unknown } },
    ) => {
      const seen: string[] = [];
      for (const ev of events) {
        const r = schema.safeParse(ev);
        if (!r.success) continue;
        seen.push((r.data as { t: string }).t);
      }
      return seen;
    };
    const s = load('track4-council-a2a');
    const events = s.events.map((e) => e.event);
    const old = reduce(events, Legacy);
    const now = reduce(events, VillageEventSchema).filter((t) => !NEW.has(t));
    expect(now).toEqual(old);
  });

  it('legacy council events with mode/a2aId extras are additive for the current schema', () => {
    const s = load('track4-council-a2a');
    for (const e of s.events) expect(VillageEventSchema.safeParse(e.event).success).toBe(true);
  });
});
