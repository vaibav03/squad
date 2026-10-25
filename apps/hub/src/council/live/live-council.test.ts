import {
  createCouncilAgents,
  createCouncilService,
  type AgentTransport,
  type CouncilService,
} from '@squad/brain';
import {
  FakeLlm,
  type A2aMessage,
  type CouncilLiveEvent,
  type LivePersonaId,
  type VillageEvent,
} from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { describe, expect, it } from 'vitest';
import { LiveClientError, type LiveAgentClient, type LiveConnectOptions } from '../../live/types';
import { createLiveCouncilFactory } from './factory';
import { createCouncilLiveHub } from './hub';
import type { LiveCouncilTransport } from './transport';

const PCM = Buffer.alloc(4800).toString('base64'); // 100 ms of 24 kHz 16-bit mono

const SAYS: Record<string, string> = {
  chair: 'We will ask the Skeptic and the Teacher to weigh in.',
  skeptic: 'It holds only for fixed coupons. Callable bonds break the rule.',
  tutor: 'Yes, a higher yield means a lower price. Price and yield move in opposite directions.',
  planner: 'Yes for fixed coupons. Check the callable case.',
};
const VERDICT =
  'Yes, for fixed-coupon bonds. The Teacher and the Skeptic both support that. Confidence: fairly sure. Dissent: Skeptic, because callable bonds break it. Next step: work one callable-bond example.';

interface Behaviour {
  /** connect() rejects with this. */
  connectFail?: LiveClientError;
  /** connect never resolves. */
  connectHang?: boolean;
  /** error emitted after connect resolves (setup grace). */
  setupError?: { kind: 'credits' | 'auth' | 'rate_limited' | 'unavailable'; after: number };
  /** error emitted while speaking. */
  turnError?: { kind: 'credits' | 'auth' | 'rate_limited' | 'unavailable' };
  /** the turn never completes. */
  stall?: boolean;
  /** socket closes mid turn (1011). */
  closeMidTurn?: boolean;
}

class ScriptedLive implements LiveAgentClient {
  handlers: LiveConnectOptions['handlers'] = {};
  sent: string[] = [];
  interrupted = 0;
  private gen = 0;
  constructor(
    readonly persona: LivePersonaId,
    private readonly b: Behaviour = {},
    private readonly verdict = VERDICT,
  ) {}
  async connect(o: LiveConnectOptions): Promise<void> {
    this.handlers = o.handlers;
    if (this.b.connectFail) throw this.b.connectFail;
    if (this.b.connectHang) return new Promise<void>(() => undefined);
    const e = this.b.setupError;
    if (e) setTimeout(() => this.handlers.error?.(e.kind, 'setup closed'), e.after);
  }
  sendText(text: string): void {
    this.sent.push(text);
    const gen = ++this.gen;
    void (async () => {
      const t = (n = 1) => new Promise<void>((r) => setTimeout(r, n));
      if (this.b.turnError) {
        await t();
        return this.handlers.error?.(this.b.turnError.kind, 'boom');
      }
      if (this.b.closeMidTurn) {
        await t();
        return this.handlers.close?.();
      }
      if (this.b.stall) return;
      const verdict = this.persona === 'chair' && /committed short answer/.test(text);
      const line = verdict ? this.verdict : (SAYS[this.persona] ?? 'Fine.');
      for (const w of line.match(/\S+\s*/g) ?? []) {
        await t();
        if (gen !== this.gen) return;
        this.handlers.audio?.(PCM);
        this.handlers.outputTranscript?.(w);
      }
      if (gen === this.gen) this.handlers.turnComplete?.();
    })();
  }
  interrupt(): void {
    this.interrupted += 1;
    this.gen += 1;
  }
  close(): void {
    this.gen += 1;
  }
}

/** The streaming transport stand-in for the fallback path: scripted tool calls, kind `stream-text`. */
function streamStandIn(): AgentTransport {
  return {
    kind: 'stream-text',
    open: (o) => ({
      send: async (input) => {
        const text = typeof input === 'string' ? input : '';
        const sub = (args: Record<string, unknown>) => ({
          text: '',
          toolCalls: [{ id: `s${Math.random()}`, name: 'submit_turn', args }],
        });
        if (o.spec.role === 'chair') {
          if (text.includes('Delegate to your specialists'))
            return {
              text: '',
              toolCalls: o.children.map((k, i) => ({
                id: `d${i}`,
                name: 'delegate',
                args: { to: k, question: 'q?', why: 'w' },
              })),
            };
          return sub({
            summary: 'Go with yes.',
            answer: 'yes',
            confidence: 'fairly_sure',
            stance: 'Try it.',
          });
        }
        return sub({ summary: `${o.spec.key} says yes.`, answer: 'yes', stance: 'committed' });
      },
      close() {},
    }),
  };
}

interface Setup {
  svc: CouncilService;
  events: VillageEvent[];
  clients: Map<string, ScriptedLive>;
  transports: Map<string, LiveCouncilTransport>;
  hub: ReturnType<typeof createCouncilLiveHub>;
  ask(o?: {
    transport?: 'stream' | 'live';
    members?: string[];
    q?: string;
  }): Promise<ReturnType<CouncilService['get']>>;
  runId(): string;
  factoryCalls: number;
}

function setup(
  o: {
    behave?: Partial<Record<LivePersonaId, Behaviour>>;
    limits?: Parameters<typeof createLiveCouncilFactory>[0]['limits'];
    liveOff?: boolean;
    demo?: boolean;
    members?: string[];
    defaultTransport?: 'stream' | 'live';
  } = {},
): Setup {
  const events: VillageEvent[] = [];
  const emit = (e: VillageEvent): void => void events.push(e);
  const hub = createCouncilLiveHub(o.liveOff ? { COUNCIL_TRANSPORT_LIVE: '0' } : {});
  const clients = new Map<string, ScriptedLive>();
  const transports = new Map<string, LiveCouncilTransport>();
  let lastId = '';
  const s = { factoryCalls: 0 } as Setup;
  const live = createLiveCouncilFactory({
    hub,
    env: {},
    emit,
    limits: { graceMs: 20, turnTimeoutMs: 400, connectTimeoutMs: 300, ...o.limits },
    makeClient: (persona) => {
      const c = new ScriptedLive(persona, o.behave?.[persona]);
      clients.set(persona, c);
      return c;
    },
    onTransport: (id, t) => {
      s.factoryCalls += 1;
      lastId = id;
      transports.set(id, t);
    },
  });
  const agents = createCouncilAgents({
    env: o.demo ? {} : { GEMINI_API_KEY: 'x' },
    emit,
    ...(o.demo ? {} : { transport: streamStandIn() }),
  });
  const svc = createCouncilService({
    llm: new FakeLlm(),
    db: openMemoryDb(),
    emit,
    agents,
    live,
    ...(o.defaultTransport ? { defaultTransport: () => o.defaultTransport! } : {}),
    members: o.members ?? ['skeptic', 'teacher'],
  });
  Object.assign(s, {
    svc,
    events,
    clients,
    transports,
    hub,
    runId: () => lastId,
    ask: async (a: { transport?: 'stream' | 'live'; q?: string } = {}) => {
      const h = svc.ask({
        question: a.q ?? 'Does a higher yield always mean a lower bond price?',
        askedBy: 's_ana',
        chatId: 'group:sq',
        ...(a.transport === 'none' ? {} : { transport: a.transport ?? 'live' }),
      });
      return h.done;
    },
  });
  return s;
}

const msgs = (events: VillageEvent[]): A2aMessage[] =>
  events.flatMap((e) => (e.t === 'a2a.message' ? [e.msg] : []));
const dedupe = (xs: string[]): string[] => xs.filter((x, i) => x !== xs[i - 1]);

describe('Gemini Live council transport', () => {
  it('runs a tiny live council: own session per participant, same A2A envelopes, honest label', async () => {
    const t = setup();
    const res = (await t.ask())!;
    expect(res.status).toBe('done');
    expect(res.mode).toBe('live');
    expect(res.transport).toMatchObject({
      kind: 'live-audio',
      label: 'Gemini Live (audio + transcript)',
      requested: 'live',
    });
    expect(res.transport?.models?.map((m) => m.who)).toEqual(['Chair', 'Skeptic', 'Teacher']);
    // one Live session per participant (chair, skeptic, tutor)
    expect([...t.clients.keys()].sort()).toEqual(['chair', 'skeptic', 'tutor']);
    // same stages and envelope kinds as the streaming runtime
    const stages = dedupe(t.events.flatMap((e) => (e.t === 'council.stage' ? [e.stage] : [])));
    expect(stages).toEqual([
      'question',
      'delegation',
      'opinions',
      'dissent',
      'verdict',
      'actions',
      'done',
    ]);
    const all = msgs(t.events);
    expect(all.filter((m) => m.kind === 'delegate')).toHaveLength(2);
    expect(all.filter((m) => m.kind === 'answer')).toHaveLength(2);
    expect(all.filter((m) => m.kind === 'verdict')).toHaveLength(1);
    expect(all.every((m) => m.mode === 'live' && m.source !== 'script')).toBe(true);
    // events carry the transport
    const stageEvents = t.events.filter((e) => e.t === 'council.stage');
    expect(stageEvents.every((e) => e.t === 'council.stage' && e.transport === 'live-audio')).toBe(
      true,
    );
    // what was said is what is public: the transcript text
    const skeptic = all.find((m) => m.kind === 'answer' && m.from.endsWith('skeptic'))!;
    expect(skeptic.summary).toBe(SAYS.skeptic);
    expect(skeptic.answer).toBe('It holds only for fixed coupons.');
    const verdict = all.find((m) => m.kind === 'verdict')!;
    expect(verdict.summary).toBe(
      'Yes, for fixed-coupon bonds. The Teacher and the Skeptic both support that.',
    );
    expect(res.verdict?.next).toMatch(/callable-bond example/);
    expect(res.verdict).toMatchObject({
      confidence: 'fairly_sure',
      dissent: { member: 'Skeptic' },
    });
    expect(verdict.dissentRefs).toHaveLength(1);
    // turn order on the floor: chair, skeptic, teacher, chair (one speaker at a time)
    const stats = t.transports.get(t.runId())!.stats();
    expect(stats.turns.map((x) => x.who)).toEqual(['Chair', 'Skeptic', 'Teacher', 'Chair']);
    expect(stats.turns.every((x) => x.audioChunks > 0 && x.audioMs > 0)).toBe(true);
    // the channel replays speaker + caption events (the browser's captions)
    const seen: CouncilLiveEvent[] = [];
    t.hub.channel(t.runId()).subscribe((e) => void seen.push(e));
    expect(seen.filter((e) => e.t === 'speaker').map((e) => (e as { name: string }).name)).toEqual([
      'Chair',
      'Skeptic',
      'Teacher',
      'Chair',
    ]);
    expect(seen.some((e) => e.t === 'caption')).toBe(true);
    expect(seen.at(-1)).toEqual({ t: 'transcript', state: 'complete' });
    expect(t.hub.channel(t.runId()).ended).toBe(true);
    expect(t.hub.availability().state).toBe('ok');
    // no thinking text anywhere
    const blob = JSON.stringify([t.events, res]);
    expect(blob).not.toMatch(/"(thought|thoughts|thoughtSignature|reasoning|scratch)"\s*:/i);
  });

  it('never gives the model tools or thinking instructions: text turns only', async () => {
    const t = setup();
    await t.ask();
    for (const c of t.clients.values()) {
      expect(c.sent.length).toBeGreaterThan(0);
      for (const s of c.sent) expect(s).not.toMatch(/submit_turn|retrieve_course/);
    }
  });

  it('interruption: the student cuts off the speaker, the next speaker hears it', async () => {
    const t = setup({ behave: { skeptic: { stall: true } }, limits: { turnTimeoutMs: 5000 } });
    const p = t.ask();
    // wait until the skeptic holds the floor
    for (let i = 0; i < 200 && !(t.clients.get('skeptic')?.sent.length ?? 0); i++)
      await new Promise((r) => setTimeout(r, 5));
    t.hub.channel(t.runId()).interject('wait, what about callable bonds?');
    const res = (await p)!;
    expect(t.clients.get('skeptic')!.interrupted).toBe(1);
    const seen: CouncilLiveEvent[] = [];
    t.hub.channel(t.runId()).subscribe((e) => void seen.push(e));
    expect(seen.some((e) => e.t === 'interrupted')).toBe(true);
    // the cut-off turn produced no text, so it is a labelled failure, not invented speech
    expect(res.mode).not.toBe('live');
    // the next speaker heard the student
    expect(t.clients.get('tutor')!.sent.join('\n')).toContain('wait, what about callable bonds?');
  });

  describe('setup failures fall back to streaming, labelled (never silently scripted)', () => {
    const cases: [string, Behaviour, string, string][] = [
      [
        '402 credits',
        { connectFail: new LiveClientError('credits', 'credits depleted') },
        'credits_depleted',
        'credits depleted',
      ],
      [
        'key rejected',
        { connectFail: new LiveClientError('auth', 'bad key') },
        'invalid_key',
        'invalid key',
      ],
      [
        '429',
        { connectFail: new LiveClientError('rate_limited', 'quota') },
        'rate_limited',
        'rate limited',
      ],
      [
        '1011 at connect',
        { connectFail: new LiveClientError('unavailable', 'Internal error') },
        'live_unavailable',
        'live unavailable',
      ],
      [
        '1011 right after open',
        { setupError: { kind: 'unavailable', after: 3 } },
        'live_unavailable',
        'live unavailable',
      ],
      [
        '402 right after open',
        { setupError: { kind: 'credits', after: 3 } },
        'credits_depleted',
        'credits depleted',
      ],
      ['connect timeout', { connectHang: true }, 'timeout', 'timeout'],
    ];
    for (const [name, b, why, words] of cases) {
      it(name, async () => {
        const t = setup({ behave: { skeptic: b } });
        const res = (await t.ask())!;
        expect(res.status).toBe('done');
        expect(res.transport).toMatchObject({
          kind: 'stream-text',
          label: `Gemini streaming (Live unavailable: ${words})`,
          requested: 'live',
          why,
        });
        expect(res.mode).toBe('live'); // the streaming path is real Gemini
        expect(msgs(t.events).every((m) => m.source !== 'script')).toBe(true);
        expect(t.hub.availability()).toMatchObject({ state: 'unavailable', why });
        expect(t.clients.get('skeptic')).toBeDefined();
      });
    }

    it('live switched off on the hub', async () => {
      const t = setup({ liveOff: true });
      const res = (await t.ask())!;
      expect(res.transport).toMatchObject({
        kind: 'stream-text',
        label: 'Gemini streaming (Live unavailable: live disabled)',
        why: 'live_disabled',
      });
      expect(t.factoryCalls).toBe(0);
    });
  });

  describe('failures during the run degrade that participant with its reason', () => {
    it('429 on one of three specialists: degraded:rate_limited, the others still answer', async () => {
      const t = setup({
        members: ['skeptic', 'teacher', 'practitioner'],
        behave: { skeptic: { turnError: { kind: 'rate_limited' } } },
      });
      const res = (await t.ask())!;
      expect(res.mode).toBe('degraded:rate_limited');
      expect(res.transport?.kind).toBe('live-audio');
      const bad = res.agents!.find((a) => a.displayName === 'Skeptic')!;
      expect(bad.mode).toBe('degraded:rate_limited');
      expect(bad.status).toBe('failed');
      expect(res.agents!.find((a) => a.displayName === 'Teacher')!.mode).toBe('live');
      expect(msgs(t.events).every((m) => m.source !== 'script')).toBe(true);
      expect(res.notes.join(' ')).toContain('Degraded');
    });

    it('credits depleted mid-run halts the council honestly', async () => {
      const t = setup({ behave: { skeptic: { turnError: { kind: 'credits' } } } });
      const res = (await t.ask())!;
      expect(res.mode).toBe('degraded:credits_depleted');
      expect(res.status).toBe('failed');
      expect(res.message).toMatch(/credits are depleted/);
    });

    it('socket closes (1011) mid turn: degraded:session_closed', async () => {
      const t = setup({
        members: ['skeptic', 'teacher', 'practitioner'],
        behave: { tutor: { closeMidTurn: true } },
      });
      const res = (await t.ask())!;
      expect(res.agents!.find((a) => a.displayName === 'Teacher')!.mode).toBe(
        'degraded:session_closed',
      );
    });

    it('a stalled turn times out: degraded:timeout', async () => {
      const t = setup({
        members: ['skeptic', 'teacher', 'practitioner'],
        behave: { planner: { stall: true } },
        limits: { turnTimeoutMs: 60 },
      });
      const res = (await t.ask())!;
      expect(res.agents!.find((a) => a.displayName === 'Practitioner')!.mode).toBe(
        'degraded:timeout',
      );
    });

    it('turn budget: past the cap a participant is degraded:budget', async () => {
      const t = setup({ limits: { maxTurns: 2 } });
      const res = (await t.ask())!;
      expect(res.mode).toBe('degraded:budget');
      expect(t.transports.get(t.runId())!.stats().turns.length).toBeLessThanOrEqual(2);
    });
  });

  it('a demo hub never opens Live and says so', async () => {
    const t = setup({ demo: true });
    const res = (await t.ask())!;
    expect(res.demo).toBe(true);
    expect(res.transport).toMatchObject({
      kind: 'demo',
      label: 'Demo (scripted, not Gemini)',
      requested: 'live',
    });
    expect(t.factoryCalls).toBe(0);
    expect(
      msgs(t.events).every(
        (m) => (m.mode.startsWith('demo') && m.source === 'script') || m.source === 'code',
      ),
    ).toBe(true);
  });

  it('a run that names no transport follows the hub default (COUNCIL_TRANSPORT)', async () => {
    const t = setup({ defaultTransport: 'live' });
    const res = (await t.ask({ transport: 'none' }))!;
    expect(res.transport?.kind).toBe('live-audio');
    const s = setup();
    expect((await s.ask({ transport: 'none' }))!.transport?.kind).toBe('stream-text');
  });

  it('streaming stays the default', async () => {
    const t = setup();
    const res = (await t.ask({ transport: 'stream' }))!;
    expect(res.transport).toMatchObject({ kind: 'stream-text', label: 'Gemini streaming text' });
    expect(t.factoryCalls).toBe(0);
  });
});
