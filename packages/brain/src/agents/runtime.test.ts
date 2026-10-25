import { LlmError, validateA2aTrace, type A2aMessage } from '@squad/core';
import { describe, expect, it } from 'vitest';
import { HourlyCap } from './budget';
import {
  FakeTransport,
  call,
  idOf,
  makeHarness,
  stagesOf,
  step,
  submit,
  type Harness,
} from './test-kit';
import type { AgentTurn, CallOptions, SendOptions, StepResult } from './types';

const ans = (a: string, extra: Record<string, unknown> = {}) =>
  submit({ summary: `I pick ${a}.`, stance: `leaning ${a}`, answer: a, ...extra });
const opinion = (prompt = 'q'): CallOptions => ({
  kind: 'answer',
  stage: 'opinions',
  to: idOf('chair'),
  depth: 1,
  prompt,
});
const delegateAll = (keys = ['alpha', 'beta', 'gamma']) =>
  step(...keys.map((k) => call('delegate', { to: k, question: 'why?', why: `ask ${k}` })));

async function runChair(h: Harness, depth = 0) {
  return h.run.callAgent(h.specs.chair!, {
    kind: 'status',
    stage: 'delegation',
    to: 'room',
    depth,
    prompt: 'plan',
  });
}

describe('stages and trace', () => {
  it('emits every stage in order with a valid trace', async () => {
    const real = new FakeTransport();
    real.script(idOf('chair'), delegateAll(), submit({ summary: 'Plan done.', stance: 'waiting' }));
    for (const k of ['alpha', 'beta', 'gamma']) real.script(idOf(k), ans('B'));
    const h = makeHarness({ real });
    await h.run.stage('delegation');
    const chair = await runChair(h);
    expect(chair.status).toBe('done');
    await h.run.stage('critiques');
    await h.run.stage('dissent');
    await h.run.stage('verdict');
    real.script(
      idOf('chair'),
      submit({ summary: 'Go with B.', stance: 'try it', answer: 'B', confidence: 'confident' }),
    );
    await h.run.callAgent(h.specs.chair!, {
      kind: 'verdict',
      stage: 'verdict',
      to: 'room',
      depth: 0,
      prompt: 'verdict',
    });
    await h.run.stage('actions');
    await h.run.stage('done');
    await h.run.stage('opinions'); // never backwards
    expect(stagesOf(h.events)).toEqual([
      'question',
      'delegation',
      'opinions',
      'critiques',
      'dissent',
      'verdict',
      'actions',
      'done',
    ]);
    const msgs = h.msgs();
    expect(validateA2aTrace(msgs)).toEqual([]);
    expect(msgs.every((m) => m.mode === 'live' && m.source !== 'script')).toBe(true);
    const kinds = msgs.map((m) => m.kind);
    expect(kinds.filter((k) => k === 'delegate')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'answer')).toHaveLength(3);
    expect(kinds).toContain('verdict');
    expect(h.run.mode()).toBe('live');
  });

  it('delegate fans out in parallel and returns each answer to the chair', async () => {
    let inflight = 0;
    let peak = 0;
    const real = new FakeTransport();
    real.script(idOf('chair'), delegateAll(), submit({ summary: 'ok', stance: 'ok' }));
    for (const k of ['alpha', 'beta', 'gamma'])
      real.script(idOf(k), async () => {
        inflight++;
        peak = Math.max(peak, inflight);
        await new Promise((r) => setTimeout(r, 5));
        inflight--;
        return ans('A');
      });
    const h = makeHarness({ real });
    await runChair(h);
    expect(peak).toBe(3);
    const results = real.inputsOf(idOf('chair'))[1] as {
      name: string;
      result: { summary: string };
    }[];
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.name === 'delegate' && r.result.summary.length > 0)).toBe(true);
    expect(h.run.answerOf(idOf('alpha') as never)?.turn?.answer).toBe('A');
    // delegation tree: answers hang off their delegate message
    const byId = new Map(h.msgs().map((m) => [m.id, m]));
    for (const m of h.msgs().filter((x) => x.kind === 'answer'))
      expect(byId.get(m.parentMessageId!)?.kind).toBe('delegate');
  });
});

describe('delegation caps', () => {
  const chairErrors = (real: FakeTransport): string[] =>
    (real.inputsOf(idOf('chair'))[1] as { result: { error?: string } }[]).map(
      (r) => r.result.error ?? '',
    );

  it('refuses unknown keys, duplicates and the fan-out cap, and the model recovers', async () => {
    const real = new FakeTransport();
    real.script(
      idOf('chair'),
      step(
        call('delegate', { to: 'nobody', question: 'q', why: 'w' }),
        call('delegate', { to: 'alpha', question: 'q', why: 'w' }),
        call('delegate', { to: 'alpha', question: 'q', why: 'w' }),
        call('delegate', { to: 'beta', question: 'q', why: 'w' }),
        call('delegate', { to: 'gamma', question: 'q', why: 'w' }),
      ),
      submit({ summary: 'done', stance: 's' }),
    );
    real.script(idOf('alpha'), ans('A')).script(idOf('beta'), ans('A'));
    const h = makeHarness({ real, deps: { budget: { maxFanOut: 2 } } });
    const t = await runChair(h);
    expect(t.status).toBe('done');
    const errs = chairErrors(real);
    expect(errs[0]).toMatch(/unknown specialist/);
    expect(errs[1]).toBe('');
    expect(errs[2]).toMatch(/already delegated/);
    expect(errs[3]).toBe('');
    expect(errs[4]).toMatch(/fan-out cap/);
    expect(h.msgs().filter((m) => m.kind === 'delegate')).toHaveLength(2);
    expect(real.sendCount).toBe(2 + 2 + 0); // chair x2, alpha, beta; gamma never ran
  });

  it('depth cap: the chair at max depth cannot delegate', async () => {
    const real = new FakeTransport();
    real.script(idOf('chair'), delegateAll(['alpha']), submit({ summary: 'done', stance: 's' }));
    const h = makeHarness({ real });
    await runChair(h, 2);
    expect(chairErrors(real)[0]).toMatch(/not available/);
    expect(h.msgs().some((m) => m.kind === 'delegate')).toBe(false);
  });

  it('only the chair may delegate', async () => {
    const real = new FakeTransport();
    real.script(
      idOf('alpha'),
      step(call('delegate', { to: 'beta', question: 'q', why: 'w' })),
      ans('A'),
    );
    const h = makeHarness({ real });
    await h.run.callAgent(h.specs.alpha!, { ...opinion(), extraTools: ['delegate'] });
    const r = real.inputsOf(idOf('alpha'))[1] as { result: { error: string } }[];
    expect(r[0]!.result.error).toMatch(/only the chair/);
  });
});

describe('ask_peer', () => {
  it('lets a specialist consult a colleague once; the reply is not a committed answer', async () => {
    const real = new FakeTransport();
    real.script(
      idOf('alpha'),
      step(call('ask_peer', { to: 'beta', question: 'fixed value?' })),
      step(call('ask_peer', { to: 'beta', question: 'again?' })),
      ans('A'),
    );
    real.script(idOf('beta'), submit({ summary: 'Yes.', stance: 'answered', answer: 'ignored' }));
    const h = makeHarness({ real });
    const t = await h.run.callAgent(h.specs.alpha!, opinion());
    expect(t.status).toBe('done');
    const second = real.inputsOf(idOf('alpha'))[2] as { result: { error: string } }[];
    expect(second[0]!.result.error).toMatch(/already used/);
    expect(h.run.answerOf(idOf('beta') as never)).toBeUndefined();
    const reply = h.msgs().find((m) => m.from === idOf('beta'));
    expect(reply?.answer).toBeUndefined(); // omitAnswer
    expect(h.msgs().filter((m) => m.kind === 'ask')).toHaveLength(1);
    expect(validateA2aTrace(h.msgs())).toEqual([]);
  });

  it('refuses a cycle and, at max depth, any onward ask', async () => {
    const real = new FakeTransport();
    real.script(idOf('alpha'), step(call('ask_peer', { to: 'beta', question: 'q' })), ans('A'));
    // beta (inside alpha's consult) tries to ask alpha back
    real.script(
      idOf('beta'),
      step(call('ask_peer', { to: 'alpha', question: 'loop?' })),
      submit({ summary: 'ok', stance: 's' }),
    );
    const h = makeHarness({ real, deps: { budget: { maxDepth: 3 } } });
    await h.run.callAgent(h.specs.alpha!, opinion());
    const back = real.inputsOf(idOf('beta'))[1] as { result: { error: string } }[];
    expect(back[0]!.result.error).toMatch(/cycle/);

    const real2 = new FakeTransport();
    real2.script(idOf('alpha'), step(call('ask_peer', { to: 'beta', question: 'q' })), ans('A'));
    real2.script(
      idOf('beta'),
      step(call('ask_peer', { to: 'gamma', question: 'deeper?' })),
      submit({ summary: 'ok', stance: 's' }),
    );
    const h2 = makeHarness({ real: real2 }); // maxDepth 2: beta sits at depth 2
    await h2.run.callAgent(h2.specs.alpha!, opinion());
    const deep = real2.inputsOf(idOf('beta'))[1] as { result: { error: string } }[];
    expect(deep[0]!.result.error).toMatch(/not available/);
  });
});

describe('submit_turn is the only output path', () => {
  it('discards text, nudges once, then accepts the tool call', async () => {
    const real = new FakeTransport();
    real.script(idOf('alpha'), { text: 'LEAKED PROSE', toolCalls: [] }, ans('A'));
    const h = makeHarness({ real });
    const t = await h.run.callAgent(h.specs.alpha!, opinion());
    expect(t.status).toBe('done');
    expect(JSON.stringify(h.events)).not.toContain('LEAKED');
    expect(real.inputsOf(idOf('alpha'))[1]).toMatch(/submit_turn/);
  });

  it('fails with no_turn when the model keeps writing text', async () => {
    const real = new FakeTransport();
    real.script(
      idOf('alpha'),
      { text: 'prose 1', toolCalls: [] },
      { text: 'prose 2', toolCalls: [] },
      { text: 'prose 3', toolCalls: [] },
    );
    const h = makeHarness({ real });
    const t = await h.run.callAgent(h.specs.alpha!, opinion());
    expect(t.status).toBe('failed');
    expect(t.reason).toBe('no_turn');
    expect(t.mode).toBe('degraded:no_turn');
    expect(JSON.stringify(h.events)).not.toContain('prose');
    const m = h.msgs().at(-1)!;
    expect(m.kind).toBe('status');
    expect(m.status).toBe('failed');
    expect(m.source).toBe('code');
  });

  it('re-asks once on bad submit_turn args, then fails', async () => {
    const real = new FakeTransport();
    real.script(idOf('alpha'), submit({ summary: '   ' }), ans('A'));
    real.script(idOf('beta'), submit({ summary: '' }), submit({ stance: 'x' }));
    const h = makeHarness({ real });
    expect((await h.run.callAgent(h.specs.alpha!, opinion())).status).toBe('done');
    const bad = await h.run.callAgent(h.specs.beta!, opinion());
    expect(bad.status).toBe('failed');
    expect(bad.reason).toBe('no_turn');
  });

  it('caps summary, stance and answer lengths in code', async () => {
    const real = new FakeTransport();
    real.script(
      idOf('alpha'),
      submit({ summary: 'word '.repeat(200), stance: 's '.repeat(100), answer: 'a '.repeat(300) }),
    );
    const h = makeHarness({ real });
    await h.run.callAgent(h.specs.alpha!, opinion());
    const m = h.msgs().find((x) => x.kind === 'answer')!;
    expect(m.summary!.length).toBeLessThanOrEqual(280);
    expect(m.stance!.length).toBeLessThanOrEqual(80);
    expect(m.answer!.length).toBeLessThanOrEqual(240);
  });

  it('rejects tools the agent was not given', async () => {
    const real = new FakeTransport();
    real.script(idOf('alpha'), step(call('calendar_summary', { range: 'week' })), ans('A'));
    const h = makeHarness({ real });
    await h.run.callAgent(h.specs.alpha!, opinion());
    const r = real.inputsOf(idOf('alpha'))[1] as { result: { error: string } }[];
    expect(r[0]!.result.error).toMatch(/not available/);
  });
});

describe('citations', () => {
  it('keeps only citations the code-side verifier accepts', async () => {
    const real = new FakeTransport();
    real.script(
      idOf('alpha'),
      ans('A', {
        citations: [
          { file: 'ch1.pdf', page: 2, quote: 'verbatim quote here' },
          { file: 'ch1.pdf', page: 9, quote: 'invented quote nobody wrote' },
        ],
      }),
    );
    const h = makeHarness({
      real,
      ports: {
        verify: (cs) =>
          cs
            .filter((c) => c.quote === 'verbatim quote here')
            .map((c) => ({ file: c.file, page: c.page, label: `${c.file} p.${c.page}` })),
      },
    });
    const t = await h.run.callAgent(h.specs.alpha!, opinion());
    expect(t.citations).toEqual([{ file: 'ch1.pdf', page: 2, label: 'ch1.pdf p.2' }]);
    expect(t.struck).toBe(1);
    const m = h.msgs().find((x) => x.kind === 'answer')!;
    expect(m.citations).toHaveLength(1);
    expect(JSON.stringify(m)).not.toContain('invented');
  });

  it('strips every citation when no verifier exists', async () => {
    const real = new FakeTransport();
    real.script(
      idOf('alpha'),
      ans('A', { citations: [{ file: 'f', page: 1, quote: 'some quote words' }] }),
    );
    const h = makeHarness({ real });
    const t = await h.run.callAgent(h.specs.alpha!, opinion());
    expect(t.citations).toEqual([]);
  });
});

describe('rank turns', () => {
  const rank = (h: Harness) =>
    h.run.callAgent(h.specs.alpha!, {
      kind: 'rank',
      stage: 'critiques',
      to: 'room',
      depth: 1,
      prompt: 'rank',
      labels: { A: 'Beta', B: 'Gamma' },
      rankNames: ['Beta', 'Gamma'],
    });
  it('maps anonymous labels back to names and hides the labels in text', async () => {
    const real = new FakeTransport();
    real.script(
      idOf('alpha'),
      submit({
        summary: 'Response B reasons better than Response A.',
        stance: 'ranked',
        order: ['Response B', 'a'],
      }),
    );
    const h = makeHarness({ real });
    const t = await rank(h);
    expect(t.turn?.order).toEqual(['Gamma', 'Beta']);
    expect(t.turn?.summary).toBe('one response reasons better than one response.');
    expect(h.msgs().find((m) => m.kind === 'rank')?.order).toEqual(['Gamma', 'Beta']);
  });
  it('repairs a partial or junk order', async () => {
    const real = new FakeTransport();
    real.script(idOf('alpha'), submit({ summary: 'x', stance: 's', order: ['B', 'B', 'Z'] }));
    const h = makeHarness({ real });
    expect((await rank(h)).turn?.order).toEqual(['Gamma', 'Beta']);
  });
});

describe('failures are labelled degraded, never demo', () => {
  const failWith = async (err: Error, mode: string) => {
    const real = new FakeTransport();
    real.script(idOf('alpha'), err);
    const h = makeHarness({ real });
    const t = await h.run.callAgent(h.specs.alpha!, opinion());
    expect(t.status).toBe('failed');
    expect(t.mode).toBe(mode);
    expect(t.source).toBe('code');
    expect(h.run.mode()).toBe(mode);
    expect(h.msgs().every((m) => !m.mode.startsWith('demo') && m.source !== 'script')).toBe(true);
    return h;
  };

  it('402 mid-run: agent failed, later agents skipped with the same reason, no demo text', async () => {
    const real = new FakeTransport();
    real.script(idOf('alpha'), new LlmError('credits_depleted', 'prepay', 402));
    real.script(idOf('beta'), ans('B')); // must never be consumed
    const h = makeHarness({ real });
    const a = await h.run.callAgent(h.specs.alpha!, opinion());
    const b = await h.run.callAgent(h.specs.beta!, opinion());
    expect(a.status).toBe('failed');
    expect(a.mode).toBe('degraded:credits_depleted');
    expect(b.status).toBe('skipped');
    expect(b.reason).toBe('credits_depleted');
    expect(real.inputsOf(idOf('beta'))).toHaveLength(0);
    expect(h.run.haltReason()).toBe('credits_depleted');
    expect(h.run.mode()).toBe('degraded:credits_depleted');
    const infos = h.run.agents();
    expect(infos.find((i) => i.id === idOf('alpha'))?.status).toBe('failed');
    expect(infos.find((i) => i.id === idOf('beta'))?.status).toBe('skipped');
    expect(h.msgs().every((m) => !m.mode.startsWith('demo') && m.source !== 'script')).toBe(true);
    expect(h.msgs().at(-1)?.summary).toMatch(/credits depleted/);
  });

  it('429 degrades one agent but does not halt the run', async () => {
    const real = new FakeTransport();
    real.script(idOf('alpha'), new LlmError('rate_limited', 'slow down', 429));
    real.script(idOf('beta'), ans('B'));
    const h = makeHarness({ real });
    const a = await h.run.callAgent(h.specs.alpha!, opinion());
    const b = await h.run.callAgent(h.specs.beta!, opinion());
    expect(a.mode).toBe('degraded:rate_limited');
    expect(b.status).toBe('done');
    expect(h.run.haltReason()).toBeUndefined();
    expect(h.run.mode()).toBe('degraded:rate_limited');
  });

  it('a rejected key halts the run', async () => {
    const h = await failWith(new LlmError('auth', 'bad key', 401), 'degraded:invalid_key');
    expect(h.run.haltReason()).toBe('invalid_key');
  });

  it('timeout', async () => {
    const real = new FakeTransport();
    real.script(
      idOf('alpha'),
      () => new Promise(() => {}),
      () => new Promise(() => {}),
    );
    const h = makeHarness({ real, deps: { budget: { callTimeoutMs: 10 } } });
    const t = await h.run.callAgent(h.specs.alpha!, opinion());
    expect(t.reason).toBe('timeout');
    expect(t.mode).toBe('degraded:timeout');
  });

  it('live session closed (1011)', async () => {
    await failWith(new Error('reason:session_closed'), 'degraded:session_closed');
  });

  it('chair failure: code takes over delegation, the run stays live for the others', async () => {
    const real = new FakeTransport();
    real.script(idOf('chair'), new Error('boom'));
    real.script(idOf('alpha'), ans('A'));
    const h = makeHarness({ real });
    const c = await runChair(h);
    expect(c.status).toBe('failed');
    const t = await h.run.delegateByCode(h.specs.alpha!, 'q', 'chair unavailable');
    expect(t.status).toBe('done');
    const d = h.msgs().find((m) => m.kind === 'delegate')!;
    expect(d.source).toBe('code');
    expect(d.mode).not.toMatch(/^demo/);
    expect(h.run.mode()).toBe('degraded:model_error');
    expect(validateA2aTrace(h.msgs())).toEqual([]);
  });

  it('degrade() marks an agent without touching a demo run', async () => {
    const h = makeHarness({ mode: 'demo:forced', real: null });
    h.run.degrade(idOf('chair') as never, 'x_y_z');
    expect(h.run.mode()).toBe('demo:forced');
    const live = makeHarness();
    live.run.degrade(idOf('chair') as never, 'chair_down');
    expect(live.run.mode()).toBe('degraded:chair_down');
  });
});

describe('budget guard in a run', () => {
  it('stops at maxTurns and halts the run', async () => {
    const real = new FakeTransport();
    real.script(idOf('alpha'), step(call('retrieve_course', { query: 'x' })), ans('A'));
    real.script(idOf('beta'), ans('B'));
    const h = makeHarness({
      real,
      deps: { budget: { maxTurns: 1 } },
      ports: { retrieve: async () => ({ grounded: false, quotes: [], pages: [] }) },
    });
    const a = await h.run.callAgent(h.specs.alpha!, opinion());
    expect(a.reason).toBe('budget');
    expect(h.run.haltReason()).toBe('budget');
    const b = await h.run.callAgent(h.specs.beta!, opinion());
    expect(b.status).toBe('skipped');
    expect(real.inputsOf(idOf('beta'))).toHaveLength(0);
  });

  it('stops on tokens and on wall time (injected clock)', async () => {
    const real = new FakeTransport();
    real.script(idOf('alpha'), {
      text: '',
      toolCalls: [call('retrieve_course', { query: 'x' })],
      usage: { inputTokens: 90, outputTokens: 20 },
    });
    const h = makeHarness({
      real,
      deps: { budget: { maxTokens: 100 } },
      ports: { retrieve: async () => ({ grounded: false, quotes: [], pages: [] }) },
    });
    expect((await h.run.callAgent(h.specs.alpha!, opinion())).reason).toBe('budget');

    let t = 0;
    const real2 = new FakeTransport();
    real2.script(idOf('alpha'), () => {
      t += 500;
      return step(call('retrieve_course', { query: 'x' }));
    });
    const h2 = makeHarness({
      real: real2,
      deps: { now: () => t, budget: { maxWallMs: 400 } },
      ports: { retrieve: async () => ({ grounded: false, quotes: [], pages: [] }) },
    });
    expect((await h2.run.callAgent(h2.specs.alpha!, opinion())).reason).toBe('budget');
  });

  it('the hourly cap object is shared and refuses past its limit', () => {
    let t = 0;
    const cap = new HourlyCap(2, () => t);
    expect([cap.tryAcquire(), cap.tryAcquire(), cap.tryAcquire()]).toEqual([true, true, false]);
    t = 3_600_001;
    expect(cap.tryAcquire()).toBe(true);
  });
});

describe('honesty gate', () => {
  it('a live run without a real transport throws; a scripted transport under live throws', () => {
    expect(() => makeHarness({ real: null })).toThrow(/without a real transport/);
    expect(() => makeHarness({ real: new FakeTransport('demo') })).toThrow(
      /scripted transport under a live mode/,
    );
  });

  it('a demo run only uses the scripted transport and labels everything', async () => {
    const real = new FakeTransport();
    const demo = new FakeTransport('demo');
    demo.script(idOf('alpha'), ans('A'));
    const h = makeHarness({ mode: 'demo:forced', real, demo });
    const t = await h.run.callAgent(h.specs.alpha!, opinion());
    expect(t.source).toBe('script');
    expect(t.mode).toBe('demo:forced');
    expect(real.sendCount).toBe(0);
    for (const m of h.msgs()) {
      expect(m.mode).toBe('demo:forced');
      expect(m.source).toBe('script');
    }
    expect(h.run.agents().every((a) => a.transport === 'demo')).toBe(true);
  });

  it('a run that starts live never turns scripted, even after every failure kind', async () => {
    const real = new FakeTransport();
    real.script(idOf('alpha'), new LlmError('credits_depleted', 'x', 402));
    const demo = new FakeTransport('demo');
    demo.script(idOf('beta'), ans('B'));
    const h = makeHarness({ real, demo });
    await h.run.callAgent(h.specs.alpha!, opinion());
    await h.run.callAgent(h.specs.beta!, opinion());
    expect(demo.sendCount).toBe(0);
    expect(h.msgs().some((m) => m.source === 'script' || m.mode.startsWith('demo'))).toBe(false);
    expect(h.run.startMode).toBe('live');
  });
});

describe('privacy', () => {
  const needles = ['$180', 'therapy'];
  it('scrubs private strings from every public field', async () => {
    const real = new FakeTransport();
    real.script(
      idOf('chair'),
      step(
        call('delegate', {
          to: 'alpha',
          question: 'Is $180 therapy fine?',
          why: 'because therapy costs $180',
        }),
      ),
      submit({ summary: 'Plan: therapy at $180.', stance: 'therapy $180' }),
    );
    real.script(
      idOf('alpha'),
      ans('therapy $180', { summary: 'Spend $180 on therapy.', stance: 'therapy!' }),
    );
    const h = makeHarness({ real, start: { privateNeedles: needles } });
    await runChair(h);
    const all = JSON.stringify(h.events) + JSON.stringify(h.run.messages());
    expect(all).not.toContain('$180');
    expect(all).not.toContain('therapy');
    expect(all).toContain('[private]');
  });

  it('keeps calendar and mastery results asker_only and scrubs what the model sees', async () => {
    const real = new FakeTransport();
    real.script(
      idOf('alpha'),
      step(call('calendar_summary', { range: 'week' }), call('mastery_summary', {})),
      ans('A'),
    );
    const h = makeHarness({
      real,
      start: { privateNeedles: needles },
      ports: {
        calendarSummary: async () => ({ text: 'free 6h; therapy $180 Tuesday' }),
        masterySummary: async () => ({ denied: true }),
      },
    });
    await h.run.callAgent(h.specs.alpha!, {
      ...opinion(),
      extraTools: ['calendar_summary', 'mastery_summary'],
    });
    const tools = h.msgs().filter((m) => m.to.startsWith('tool:'));
    expect(tools).toHaveLength(2);
    expect(tools.every((m) => m.redaction === 'asker_only')).toBe(true);
    const cal = tools.find((m) => m.to === 'tool:calendar')!;
    const mas = tools.find((m) => m.to === 'tool:mastery')!;
    expect(cal.status).toBe('done');
    expect(mas.status).toBe('failed'); // denied by the privacy gate
    const seen = JSON.stringify(real.inputsOf(idOf('alpha'))[1]);
    expect(seen).not.toContain('$180');
    expect(seen).not.toContain('therapy');
    expect(JSON.stringify(h.events)).not.toContain('$180');
    // the committed answer stays public
    expect(h.msgs().find((m) => m.kind === 'answer')?.redaction).toBe('public');
  });

  it('a throwing privacy port is treated as denied', async () => {
    const real = new FakeTransport();
    real.script(idOf('alpha'), step(call('calendar_summary', {})), ans('A'));
    const h = makeHarness({
      real,
      ports: {
        calendarSummary: async () => {
          throw new Error('gate down');
        },
      },
    });
    await h.run.callAgent(h.specs.alpha!, { ...opinion(), extraTools: ['calendar_summary'] });
    expect(h.msgs().find((m) => m.to === 'tool:calendar')?.status).toBe('failed');
  });
});

describe('publishFinal and dissent', () => {
  it('a verdict that differs from a specialist carries dissentRefs and the trace is valid', async () => {
    const real = new FakeTransport();
    real.script(idOf('alpha'), ans('B'));
    real.script(idOf('beta'), ans('C'));
    real.script(
      idOf('chair'),
      submit({ summary: 'Go with B.', stance: 'try it', answer: 'B', confidence: 'fairly_sure' }),
    );
    const h = makeHarness({ real });
    await h.run.callAgent(h.specs.alpha!, opinion());
    await h.run.callAgent(h.specs.beta!, opinion());
    const dissenter = h.msgs().find((m) => m.from === idOf('beta') && m.kind === 'answer')!;
    const turn: AgentTurn = await h.run.callAgent(h.specs.chair!, {
      kind: 'verdict',
      stage: 'verdict',
      to: 'room',
      depth: 0,
      prompt: 'v',
      publish: false,
    });
    expect(turn.message).toBeUndefined();
    const v: A2aMessage = await h.run.publishFinal(turn, {
      to: 'room',
      kind: 'verdict',
      stage: 'verdict',
      confidence: 'fairly_sure',
      dissentRefs: [dissenter.id],
    });
    expect(v.dissentRefs).toEqual([dissenter.id]);
    expect(validateA2aTrace(h.msgs())).toEqual([]);
    expect(
      validateA2aTrace(
        h.msgs().map((m) => (m.kind === 'verdict' ? { ...m, dissentRefs: [] } : m)),
      ).map((i) => i.code),
    ).toContain('verdict_missing_dissent');
  });
});

describe('reliable turns: forced tool use, nudges and one retry', () => {
  it('forces a function call every step and only submit_turn on the final one', async () => {
    const real = new FakeTransport();
    const seen: { force?: string[]; thinking?: string }[] = [];
    const rec = (r: StepResult) => (_i: unknown, so: SendOptions) => {
      seen.push({ force: so.forceTool, thinking: so.thinking });
      return r;
    };
    real.script(
      idOf('alpha'),
      rec(step(call('retrieve_course', { query: 'x' }))),
      rec(submit({ summary: 'A', stance: 's', answer: 'a' })),
    );
    const h = makeHarness({ real });
    const t = await h.run.callAgent(h.specs.alpha!, opinion());
    expect(t.status).toBe('done');
    expect(seen[0]!.force).toContain('retrieve_course');
    expect(seen[0]!.force).toContain('submit_turn');
    expect(seen[0]!.thinking).toBe('low');
  });

  it('after the tool rounds only submit_turn is offered', async () => {
    const real = new FakeTransport();
    const forced: (string[] | undefined)[] = [];
    const loop = (_i: unknown, so: SendOptions) => {
      forced.push(so.forceTool);
      return step(call('retrieve_course', { query: 'again' }));
    };
    real.script(idOf('alpha'), loop, loop, (_i, so) => {
      forced.push(so.forceTool);
      return submit({ summary: 'A', stance: 's', answer: 'a' });
    });
    const h = makeHarness({ real });
    const t = await h.run.callAgent(h.specs.alpha!, opinion());
    expect(t.status).toBe('done');
    expect(forced[2]).toEqual(['submit_turn']);
  });

  it('an empty reply is nudged and the second try succeeds (still live)', async () => {
    const real = new FakeTransport();
    real.script(idOf('alpha'), { text: '', toolCalls: [] }, ans('A'));
    const h = makeHarness({ real });
    const t = await h.run.callAgent(h.specs.alpha!, opinion());
    expect(t.status).toBe('done');
    expect(h.run.mode()).toBe('live');
    expect(h.real.inputsOf(idOf('alpha'))[1]).toMatch(/submit_turn/);
  });

  it('a timeout is retried once with minimal thinking and the run stays live', async () => {
    const real = new FakeTransport();
    const thinking: (string | undefined)[] = [];
    real.script(
      idOf('alpha'),
      () => new Promise(() => {}),
      (_i, so) => {
        thinking.push(so.thinking);
        return submit({ summary: 'A', stance: 's', answer: 'a' });
      },
    );
    const h = makeHarness({ real, deps: { budget: { callTimeoutMs: 10 } } });
    const t = await h.run.callAgent(h.specs.alpha!, opinion());
    expect(t.status).toBe('done');
    expect(thinking).toEqual(['minimal']);
    expect(h.run.mode()).toBe('live');
  });

  it('a second consecutive failure is still honest: degraded, never scripted', async () => {
    const real = new FakeTransport();
    real.script(idOf('alpha'), new Error('boom'), new Error('boom'));
    const h = makeHarness({ real });
    const t = await h.run.callAgent(h.specs.alpha!, opinion());
    expect(t.status).toBe('failed');
    expect(t.mode).toBe('degraded:model_error');
  });

  it('endAfterTools closes the chair plan in code after the delegations, no extra model call', async () => {
    const real = new FakeTransport();
    real.script(idOf('chair'), step(call('delegate', { to: 'alpha', question: 'q', why: 'w' })));
    real.script(idOf('alpha'), ans('A'));
    const h = makeHarness({ real });
    const t = await h.run.callAgent(h.specs.chair!, {
      ...opinion(),
      kind: 'status',
      stage: 'delegation',
      endAfterTools: { summary: 'Delegated to the Alpha.' },
    });
    expect(t.status).toBe('done');
    expect(t.source).toBe('code');
    expect(real.sendCount).toBe(2); // chair delegate step + alpha answer; no chair summary call
    expect(h.msgs().at(-1)!.summary).toBe('Delegated to the Alpha.');
  });

  it('prefetches the course once and hands the pages to specialists in their prompt', async () => {
    const real = new FakeTransport();
    real.script(idOf('alpha'), ans('A'));
    let lookups = 0;
    const h = makeHarness({
      real,
      start: { prefetchQuery: 'what is a median' },
      ports: {
        async retrieve() {
          lookups++;
          return {
            grounded: true,
            quotes: [],
            pages: [{ file: 'book.pdf', page: 3, text: 'The median resists outliers.' }],
          };
        },
      },
    });
    const t = await h.run.callAgent(h.specs.alpha!, opinion());
    expect(t.status).toBe('done');
    expect(lookups).toBe(1);
    expect(String(h.real.inputsOf(idOf('alpha'))[0])).toContain('The median resists outliers.');
    expect(h.msgs().some((m) => m.to === 'tool:retrieve' && m.source === 'code')).toBe(true);
  });
});

describe('live status for the board', () => {
  it('onChange fires when an agent starts working, so snapshots show who is on it', async () => {
    const real = new FakeTransport();
    real.script(idOf('alpha'), ans('A'));
    const states: string[] = [];
    const ref: { run?: { agents(): { id: string; status: string }[] } } = {};
    const h = makeHarness({
      real,
      start: {
        onChange: () => {
          const a = ref.run?.agents().find((x) => x.id === idOf('alpha'));
          if (a) states.push(a.status);
        },
      },
    });
    ref.run = h.run;
    await h.run.callAgent(h.specs.alpha!, opinion());
    expect(states).toContain('working');
    expect(states.at(-1)).toBe('done');
  });
});
