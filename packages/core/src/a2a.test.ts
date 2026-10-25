import { describe, expect, it } from 'vitest';
import {
  A2A_BANNED_KEY,
  A2A_KINDS,
  A2A_MESSAGE_KEYS,
  A2A_STAGES,
  A2A_SUMMARY_MAX,
  A2aMessageSchema,
  AgentModeSchema,
  PUBLIC_TURN_KEYS,
  PublicTurnSchema,
  VILLAGE_EVENT_TYPES,
  VillageEventSchema,
  a2aSkeleton,
  findUnwrappedScripted,
  hasBannedKey,
  isScripted,
  modeKind,
  modeReason,
  scripted,
  truncatePublic,
  validateA2aTrace,
  worstMode,
  type A2aMessage,
} from './index';

const RUN = 'cn_k3j9x0a1b2c3';
const base = (over: Partial<A2aMessage> = {}): A2aMessage => ({
  id: 'am_a1b2c3d4e5f6',
  correlationId: RUN,
  seq: 2,
  from: 'council:ask-chair',
  to: 'council:ask-skeptic',
  kind: 'delegate',
  parentMessageId: 'am_000000000001',
  stage: 'delegation',
  summary: 'Check whether a higher yield really implies a lower price in every case.',
  status: 'done',
  mode: 'live',
  source: 'model',
  redaction: 'public',
  ts: 1760000000500,
  ...over,
});
const msg = (id: number, seq: number, over: Partial<A2aMessage> = {}): A2aMessage =>
  base({ id: `am_${String(id).padStart(12, '0')}`, seq, ...over });

describe('A2A envelope', () => {
  it('round-trips every kind, stage and the plan examples', () => {
    for (const kind of A2A_KINDS)
      for (const stage of A2A_STAGES) {
        const m = base({ kind: kind === 'verdict' ? 'verdict' : kind, stage });
        expect(A2aMessageSchema.parse(m)).toEqual(m);
      }
    const verdict = base({
      to: 'room',
      kind: 'verdict',
      stage: 'verdict',
      answer: 'yes, for fixed-coupon bonds',
      confidence: 'fairly_sure',
      dissentRefs: ['am_9f8e7d6c5b4a'],
      citations: [{ file: 'ch6.pdf', page: 3, label: 'ch6.pdf p.3' }],
    });
    expect(A2aMessageSchema.parse(verdict)).toEqual(verdict);
    const tool = base({ to: 'tool:calendar', kind: 'ask', status: 'failed' });
    expect(A2aMessageSchema.safeParse(tool).success).toBe(true);
  });

  it('is strict: unknown keys, bad ids, long text and bad enums fail', () => {
    expect(A2aMessageSchema.safeParse({ ...base(), extra: 1 }).success).toBe(false);
    expect(A2aMessageSchema.safeParse(base({ id: 'am_SHORT' })).success).toBe(false);
    expect(A2aMessageSchema.safeParse(base({ correlationId: 'nope' as never })).success).toBe(
      false,
    );
    expect(A2aMessageSchema.safeParse(base({ kind: 'chat' as never })).success).toBe(false);
    expect(A2aMessageSchema.safeParse(base({ to: 'somebody' })).success).toBe(false);
    expect(
      A2aMessageSchema.safeParse(base({ summary: 'x'.repeat(A2A_SUMMARY_MAX + 1) })).success,
    ).toBe(false);
    expect(A2aMessageSchema.safeParse(base({ summary: 'x'.repeat(A2A_SUMMARY_MAX) })).success).toBe(
      true,
    );
    // confidence is a word, and only on a verdict
    expect(A2aMessageSchema.safeParse(base({ confidence: 'uncertain' })).success).toBe(false);
    expect(
      A2aMessageSchema.safeParse({ ...base({ kind: 'verdict' }), confidence: 0.9 }).success,
    ).toBe(false);
  });

  it('accepts live discussion run ids (ld_) as correlationId', () => {
    expect(A2aMessageSchema.safeParse(base({ correlationId: 'ld_abcdefabcdef' })).success).toBe(
      true,
    );
  });

  it('mode vocabulary: live | degraded:<why> | demo[:<why>]', () => {
    for (const ok of [
      'live',
      'degraded:rate_limited',
      'degraded:credits_depleted',
      'demo',
      'demo:no_key',
    ])
      expect(AgentModeSchema.safeParse(ok).success).toBe(true);
    for (const bad of ['', 'Live', 'degraded', 'degraded:', 'degraded:Rate', 'scripted', 'demo:'])
      expect(AgentModeSchema.safeParse(bad).success).toBe(false);
    expect(modeKind('degraded:timeout')).toBe('degraded');
    expect(modeReason('demo:no_key')).toBe('no_key');
    expect(modeReason('live')).toBeUndefined();
    expect(worstMode(['live', 'degraded:timeout', 'live'])).toBe('degraded:timeout');
    expect(worstMode(['live', 'demo', 'degraded:timeout'])).toBe('demo');
    expect(worstMode([])).toBe('live');
  });

  it('honest status: script text can never be mode live', () => {
    expect(A2aMessageSchema.safeParse(base({ source: 'script', mode: 'live' })).success).toBe(
      false,
    );
    expect(A2aMessageSchema.safeParse(base({ source: 'script', mode: 'demo' })).success).toBe(true);
    expect(
      A2aMessageSchema.safeParse(base({ source: 'script', mode: 'degraded:timeout' })).success,
    ).toBe(true);
    expect(A2aMessageSchema.safeParse(base({ source: 'code', mode: 'live' })).success).toBe(true);
  });
});

describe('no private chain of thought', () => {
  it('no schema key matches the banned pattern', () => {
    expect(A2A_MESSAGE_KEYS.filter((k) => A2A_BANNED_KEY.test(k))).toEqual([]);
    expect(PUBLIC_TURN_KEYS.filter((k) => A2A_BANNED_KEY.test(k))).toEqual([]);
    expect(A2A_MESSAGE_KEYS).toContain('summary');
  });

  it('thinking text and thought signatures are rejected by the schemas', () => {
    const THOUGHT = 'THOUGHT-SENTINEL-7f3a';
    const SIG = 'SIG-SENTINEL-91c2';
    for (const k of [
      'thought',
      'thoughts',
      'thoughtSignature',
      'reasoning',
      'raw',
      'scratch',
      'cot',
    ]) {
      expect(A2aMessageSchema.safeParse({ ...base(), [k]: THOUGHT }).success).toBe(false);
      expect(
        PublicTurnSchema.safeParse({ kind: 'answer', summary: 's', stance: 't', [k]: SIG }).success,
      ).toBe(false);
      const ev = { t: 'a2a.message', msg: { ...base(), [k]: SIG } };
      expect(VillageEventSchema.safeParse(ev).success).toBe(false);
    }
    // nested too, even inside an otherwise valid shape
    expect(hasBannedKey({ a: [{ b: { thoughtSignature: SIG } }] })).toBe(true);
    expect(hasBannedKey(base())).toBe(false);
    // an event whose msg is clean does not carry either sentinel after a parse
    const out = JSON.stringify(VillageEventSchema.parse({ t: 'a2a.message', msg: base() }));
    expect(out).not.toContain(THOUGHT);
    expect(out).not.toContain(SIG);
  });

  it('PublicTurn: summary is capped and required', () => {
    const ok = { kind: 'answer', summary: 'Short.', stance: 'sure' };
    expect(PublicTurnSchema.safeParse(ok).success).toBe(true);
    expect(PublicTurnSchema.safeParse({ ...ok, summary: 'x'.repeat(281) }).success).toBe(false);
    expect(PublicTurnSchema.safeParse({ kind: 'answer', stance: 'sure' }).success).toBe(false);
    expect(
      PublicTurnSchema.safeParse({ ...ok, citations: [{ file: 'f', page: 0, quote: 'q' }] })
        .success,
    ).toBe(false);
  });

  it('truncatePublic cuts at a sentence, else a word, within the cap', () => {
    const t =
      'First sentence here. Second sentence is much longer and will not fit in the cap at all.';
    expect(truncatePublic(t, 40)).toBe('First sentence here.');
    expect(truncatePublic('alpha beta gamma delta', 12)).toBe('alpha beta');
    expect(truncatePublic('short', 40)).toBe('short');
    expect(truncatePublic('x'.repeat(500), 100).length).toBeLessThanOrEqual(100);
  });
});

describe('skeleton (private run) keeps arrows, drops text', () => {
  it('drops summary, stance, answer, order, citations and dissentRefs', () => {
    const full = base({
      kind: 'verdict',
      summary: 'secret $180 therapy',
      stance: 'x',
      answer: 'y',
      order: ['a'],
      confidence: 'confident',
      dissentRefs: ['am_9f8e7d6c5b4a'],
      citations: [{ file: 'f', page: 1, label: 'l' }],
    });
    const s = a2aSkeleton(full);
    expect(Object.keys(s).sort()).toEqual(
      [
        'id',
        'correlationId',
        'seq',
        'from',
        'to',
        'kind',
        'parentMessageId',
        'stage',
        'status',
        'mode',
        'source',
        'redaction',
        'ts',
      ].sort(),
    );
    expect(A2aMessageSchema.safeParse(s).success).toBe(true);
    expect(JSON.stringify(s)).not.toMatch(/therapy|\$180/);
  });
});

describe('validateA2aTrace', () => {
  const d1 = msg(2, 1, { parentMessageId: 'am_000000000001' });
  const trace = (): A2aMessage[] => [
    msg(1, 0, { kind: 'status', to: 'room', parentMessageId: undefined }),
    d1,
    msg(3, 2, {
      kind: 'answer',
      from: 'council:ask-skeptic',
      to: 'council:ask-chair',
      stage: 'opinions',
      parentMessageId: d1.id,
      answer: 'yes',
    }),
    msg(4, 3, {
      kind: 'answer',
      from: 'council:ask-practitioner',
      to: 'council:ask-chair',
      stage: 'opinions',
      parentMessageId: d1.id,
      answer: 'only if not callable',
    }),
    msg(5, 4, {
      kind: 'verdict',
      to: 'room',
      stage: 'verdict',
      answer: 'yes',
      confidence: 'fairly_sure',
      parentMessageId: 'am_000000000001',
      dissentRefs: ['am_000000000004'],
    }),
  ];
  it('a healthy trace has no issues', () => {
    expect(validateA2aTrace(trace())).toEqual([]);
  });
  it('flags correlation change, non-increasing seq, bad parents', () => {
    const t = trace();
    t[1] = { ...t[1]!, correlationId: 'cn_zzzzzzzzzzzz' };
    expect(validateA2aTrace(t).map((i) => i.code)).toContain('correlation_changed');
    const s = trace();
    s[2] = { ...s[2]!, seq: 1 };
    expect(validateA2aTrace(s).map((i) => i.code)).toContain('seq_not_increasing');
    const p = trace();
    p[1] = { ...p[1]!, parentMessageId: 'am_00000000ffff' };
    expect(validateA2aTrace(p).map((i) => i.code)).toContain('parent_unknown');
    const f = trace();
    f[1] = { ...f[1]!, parentMessageId: 'am_000000000005' };
    expect(validateA2aTrace(f).map((i) => i.code)).toContain('parent_unknown');
  });
  it('flags script under live and a verdict that hides dissent', () => {
    const t = trace();
    t[1] = { ...t[1]!, source: 'script', mode: 'live' };
    expect(validateA2aTrace(t).map((i) => i.code)).toContain('script_in_live');
    const v = trace();
    v[4] = { ...v[4]!, dissentRefs: undefined };
    expect(validateA2aTrace(v).map((i) => i.code)).toEqual(['verdict_missing_dissent']);
    // a unanimous verdict needs none
    const u = trace();
    u[3] = { ...u[3]!, answer: 'Yes' };
    u[4] = { ...u[4]!, dissentRefs: undefined };
    expect(validateA2aTrace(u)).toEqual([]);
  });
  it('redacted skeletons skip the dissent rule', () => {
    expect(validateA2aTrace(trace().map(a2aSkeleton))).toEqual([]);
  });
});

describe('scripted() honesty branding', () => {
  it('always carries source script and a non-live mode', () => {
    const s = scripted('Here is a stock line.');
    expect(s).toMatchObject({ text: 'Here is a stock line.', source: 'script', mode: 'demo' });
    expect(isScripted(s)).toBe(true);
    expect(isScripted('plain')).toBe(false);
    expect(scripted('x', 'degraded:timeout').mode).toBe('degraded:timeout');
    expect(scripted('x', 'demo:no_key').mode).toBe('demo:no_key');
    expect(() => scripted('x', 'live' as never)).toThrow();
    // a scripted line is publishable as an envelope only with its own mode
    const m = base({ source: s.source, mode: s.mode, summary: s.text });
    expect(A2aMessageSchema.safeParse(m).success).toBe(true);
    expect(A2aMessageSchema.safeParse({ ...m, mode: 'live' }).success).toBe(false);
  });
  it('type level: a plain string is not a ScriptedText, live is not a NonLiveMode', () => {
    // @ts-expect-error scripted() refuses the live mode at compile time
    const bad = () => scripted('x', 'live');
    expect(bad).toThrow();
  });
});

describe('findUnwrappedScripted (CI lint pattern)', () => {
  const helpers = ['stock', 'fallbackQuestion', 'pickDemo'];
  it('flags bare calls and accepts wrapped ones, definitions and comments', () => {
    const src = [
      "import { stock } from './x';",
      'export function stock(a) { return a; }',
      'const fallbackQuestion = (c) => c;',
      'const ok = scripted(stock(ch));',
      'const bad = stock(ch);',
      '  // pickDemo(x) is described here',
      'return { text: fallbackQuestion(ch) };',
      'const nested = scripted(pickDemo(a, b), "demo");',
      'x.stock(1);',
    ].join('\n');
    expect(findUnwrappedScripted(src, helpers)).toEqual([
      { helper: 'stock', line: 5 },
      { helper: 'fallbackQuestion', line: 7 },
    ]);
  });
});

describe('registry', () => {
  it('lists the new kinds', () => {
    expect(VILLAGE_EVENT_TYPES).toContain('a2a.message');
    expect(VILLAGE_EVENT_TYPES).toContain('council.stage');
  });
});
