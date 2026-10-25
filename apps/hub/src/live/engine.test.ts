import { describe, expect, it } from 'vitest';
import { LiveStreamEventSchema, VillageEventSchema, type LiveStreamEvent } from '@squad/core';
import { LiveRun } from './engine';
import { makeKit, collect } from './testkit';

const init = (over = {}) => ({
  id: 'ld_aaaaaaaaaaaa',
  topic: 'what is the normal distribution',
  askedBy: 's_ana',
  squadId: 'sq1',
  visibility: 'squad' as const,
  mode: 'audio' as const,
  ...over,
});

async function runToEnd(over = {}, kit = makeKit()) {
  const run = new LiveRun(kit.deps, init(over));
  const events = collect(run);
  await run.settled();
  return { run, events, kit };
}

describe('turn-taking', () => {
  it('chair opens, round robin, chair steers every 4, one speaker at a time', async () => {
    const { run, events } = await runToEnd();
    const snap = run.snapshot();
    const order = snap.turns.map((t) => t.speaker);
    expect(order[0]).toBe('chair');
    expect(order.slice(1, 5)).toEqual(['tutor', 'skeptic', 'planner', 'examiner']);
    expect(order[5]).toBe('chair');
    expect(order[6]).toBe('tutor');
    // exactly one floor holder: audio/caption speaker always equals the open floor
    let floor: string | null = null;
    for (const e of events) {
      if (e.k === 'floor') floor = e.speaker;
      if (e.k === 'caption' || e.k === 'audio') expect(e.speaker).toBe(floor);
    }
    for (const e of events) expect(LiveStreamEventSchema.safeParse(e).success).toBe(true);
    expect(snap.turns.map((t) => t.n)).toEqual(snap.turns.map((_, i) => i + 1));
  });

  it('wraps up at maxTurns with a chair summary then ended', async () => {
    const { run, events } = await runToEnd({}, makeKit({ limits: { maxTurns: 4 } }));
    const s = run.snapshot();
    expect(s.status).toBe('ended');
    expect(s.endReason).toBe('max_turns');
    expect(s.turns.at(-1)?.speaker).toBe('chair');
    expect(s.turns.at(-1)?.text).toMatch(/wrap up/i);
    expect(events.at(-1)?.k).toBe('ended');
    expect(s.turns.filter((t) => t.speaker !== 'user').length).toBe(5);
  });

  it('wraps up at maxSeconds with a fake clock', async () => {
    const kit = makeKit({ limits: { maxSeconds: 100, maxTurns: 50 } });
    const base = kit.deps.clients;
    kit.deps.clients = (k, p) => {
      const c = base(k, p);
      const send = c.sendText.bind(c);
      c.sendText = (t) => {
        kit.clock.t += 40_000;
        send(t);
      };
      return c;
    };
    const { run } = await runToEnd({}, kit);
    expect(run.snapshot().endReason).toBe('max_time');
  });

  it('supports 3 personas (chair always included)', async () => {
    const { run } = await runToEnd(
      { personas: ['tutor', 'skeptic'] },
      makeKit({ limits: { maxTurns: 6 } }),
    );
    expect(run.snapshot().personas.map((p) => p.id)).toEqual(['tutor', 'skeptic', 'chair']);
  });
});

describe('interruption', () => {
  it('cuts the speaker, relays the user text to the chair, resumes', async () => {
    const kit = makeKit({ limits: { maxTurns: 6 } });
    const run = new LiveRun(kit.deps, init());
    const events: LiveStreamEvent[] = [];
    let done = false;
    let said: Promise<void> | undefined;
    run.subscribe((e) => {
      events.push(e);
      if (!done && e.k === 'caption' && e.speaker === 'tutor') {
        done = true;
        said = run.say({ text: 'I am lost with standard deviations', kind: 'lost' });
      }
    });
    await run.settled();
    await said;
    const s = run.snapshot();
    const cut = s.turns.find((t) => t.interrupted);
    expect(cut?.speaker).toBe('tutor');
    expect(events.some((e) => e.k === 'interrupted' && e.turnId === cut?.id)).toBe(true);
    const iu = s.turns.findIndex((t) => t.speaker === 'user');
    expect(s.turns[iu]!.text).toContain('standard deviations');
    expect(s.turns[iu + 1]!.speaker).toBe('chair');
    expect(s.turns[iu + 1]!.text).toContain('I am lost');
    expect(s.turns.length).toBeGreaterThan(iu + 2);
    expect(s.turns.map((t) => t.n)).toEqual(s.turns.map((_, i) => i + 1));
  });

  it('addressed agent answers the user', async () => {
    const kit = makeKit({ limits: { maxTurns: 5 } });
    const run = new LiveRun(kit.deps, init());
    let fired = false;
    run.subscribe((e) => {
      if (!fired && e.k === 'turn' && e.turn.speaker === 'chair') {
        fired = true;
        void run.say({ text: 'skeptic what do you think', to: 'skeptic', kind: 'disagree' });
      }
    });
    await run.settled();
    const s = run.snapshot();
    const iu = s.turns.findIndex((t) => t.speaker === 'user');
    expect(s.turns[iu + 1]!.speaker).toBe('skeptic');
  });

  it('stop ends with a chair closing summary and user_left', async () => {
    const kit = makeKit();
    const run = new LiveRun(kit.deps, init());
    let n = 0;
    run.subscribe((e) => {
      if (e.k === 'turn' && ++n === 2) run.stop();
    });
    await run.settled();
    const s = run.snapshot();
    expect(s.endReason).toBe('user_left');
    expect(s.turns.at(-1)?.text).toMatch(/wrap up/i);
  });
});

describe('takeaways', () => {
  it('builds decisions, disagreement, next steps, sources, quiz all linked to turns', async () => {
    const { run } = await runToEnd({}, makeKit({ limits: { maxTurns: 6 } }));
    const t = run.snapshot().takeaways;
    const ids = new Set(run.snapshot().turns.map((x) => x.id));
    expect(t.decisions.length).toBeGreaterThan(0);
    expect(t.disagreements[0]?.stances.map((s) => s.who)).toContain('Skeptic');
    expect(t.nextSteps.length).toBeGreaterThan(0);
    expect(t.quiz.length).toBeGreaterThan(0);
    expect(t.sources.length).toBeGreaterThan(0);
    expect(t.grounding).toBe('course');
    for (const it of [...t.decisions, ...t.disagreements, ...t.nextSteps, ...t.quiz, ...t.sources])
      expect(ids.has(it.turnId ?? '')).toBe(true);
  });
});

describe('citations', () => {
  it('turns verified markers into chips and strips unverified ones', async () => {
    const kit = makeKit({ limits: { maxTurns: 3 } });
    const base = kit.deps.clients;
    kit.deps.clients = (k, p) => {
      const c = base(k, p);
      if (p !== 'skeptic') return c;
      let h: import('./types').LiveAgentHandlers;
      const conn = c.connect.bind(c);
      c.connect = (o) => {
        h = o.handlers;
        return conn(o);
      };
      c.sendText = () => {
        h.outputTranscript?.(
          'The text says it is a bell curve and normally distributed [nope.pdf p.9] fine [ch6-the-normal-distribution.pdf p.1].',
        );
        h.turnComplete?.();
      };
      return c;
    };
    const { run, events } = await runToEnd({}, kit);
    const turn = run.snapshot().turns.find((t) => t.speaker === 'skeptic')!;
    expect(turn.text).not.toContain('[');
    expect(turn.citations.map((c) => c.file)).toEqual(['ch6-the-normal-distribution.pdf']);
    expect(turn.citations.some((c) => c.file === 'nope.pdf')).toBe(false);
    const cap = events
      .filter((e) => e.k === 'caption')
      .map((e) => (e as { delta: string }).delta)
      .join('');
    expect(cap).not.toContain('nope.pdf');
  });
});

describe('village events', () => {
  it('parse as VillageEvent; private runs carry no text', async () => {
    const pub = await runToEnd({}, makeKit({ limits: { maxTurns: 3 } }));
    for (const e of pub.kit.village) expect(VillageEventSchema.safeParse(e).success).toBe(true);
    expect(
      pub.kit.village.some(
        (e) => (e.t === 'discussion.turn' && e.text && e.cites !== undefined) || e.text,
      ),
    ).toBe(true);
    const priv = await runToEnd(
      { visibility: 'private', topic: 'budget $180 therapy' },
      makeKit({ limits: { maxTurns: 3 } }),
    );
    for (const e of priv.kit.village) {
      expect(VillageEventSchema.safeParse(e).success).toBe(true);
      expect(e.text).toBeUndefined();
      expect(JSON.stringify(e)).not.toMatch(/180|therapy/);
    }
    expect(priv.kit.village.find((e) => e.t === 'discussion.turn')?.agent).toMatch(
      /^council:live-/,
    );
  });
});
