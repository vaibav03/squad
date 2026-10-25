import { describe, expect, it } from 'vitest';
import { createSchedulerHarness, T0 } from './testing';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NY = 'America/New_York';

/** a handler that sends one DM and records invocations */
function say(h: ReturnType<typeof createSchedulerHarness>, kind = 'test.say', text = 'hello') {
  const runs: number[] = [];
  h.scheduler.register(kind, async (c) => {
    runs.push(c.now);
    await c.deliver({ scope: 'dm', text, ...(c.job.payload ? {} : {}) });
  });
  return runs;
}

describe('jobs: one-shot, idempotency, cancel', () => {
  it('runs a one-shot once at its time', async () => {
    const h = createSchedulerHarness();
    const runs = say(h);
    h.scheduler.setPrefs('s_ana', { optIn: true });
    h.scheduler.schedule({ key: 'a', kind: 'test.say', student: 's_ana', runAt: T0 + 5 * MIN });
    await h.advance(4 * MIN);
    expect(runs).toHaveLength(0);
    await h.advance(3 * MIN);
    await h.advance(HOUR);
    expect(runs).toHaveLength(1);
    expect(h.sink.dms).toHaveLength(1);
    expect(h.scheduler.get('a')?.status).toBe('done');
  });

  it('scheduling the same key twice yields one job and one message', async () => {
    const h = createSchedulerHarness();
    say(h);
    const a = h.scheduler.schedule({ key: 'k', kind: 'test.say', student: 's_ana', runAt: T0 });
    const b = h.scheduler.schedule({
      key: 'k',
      kind: 'test.say',
      student: 's_ana',
      runAt: T0 + HOUR,
    });
    expect(b.id).toBe(a.id);
    expect(b.runAt).toBe(a.runAt);
    await h.advance(MIN);
    await h.advance(DAY);
    expect(h.sink.dms).toHaveLength(1);
    // a finished one-shot is not revived by scheduling it again
    h.scheduler.schedule({ key: 'k', kind: 'test.say', student: 's_ana', runAt: T0 + 2 * DAY });
    await h.advance(3 * DAY, HOUR);
    expect(h.sink.dms).toHaveLength(1);
  });

  it('the dedupe key makes a send happen once even if the job runs twice', async () => {
    const h = createSchedulerHarness();
    h.scheduler.register('t.dd', async (c) => {
      await c.deliver({ scope: 'dm', text: 'x', dedupe: 'once' });
    });
    h.scheduler.schedule({ key: 'j1', kind: 't.dd', student: 's_ana', runAt: T0 });
    h.scheduler.schedule({ key: 'j2', kind: 't.dd', student: 's_ana', runAt: T0 });
    await h.advance(MIN);
    expect(h.sink.dms).toHaveLength(1);
  });

  it('cancel stops a job and the same key can be scheduled again afterwards', async () => {
    const h = createSchedulerHarness();
    say(h);
    h.scheduler.schedule({ key: 'c', kind: 'test.say', student: 's_ana', runAt: T0 + HOUR });
    expect(h.scheduler.cancel('c')).toBe(true);
    await h.advance(2 * HOUR);
    expect(h.sink.dms).toHaveLength(0);
    h.scheduler.schedule({ key: 'c', kind: 'test.say', student: 's_ana', runAt: T0 + 3 * HOUR });
    await h.advance(2 * HOUR);
    expect(h.sink.dms).toHaveLength(1);
  });

  it('cancelWhere filters by student and kind prefix', () => {
    const h = createSchedulerHarness();
    h.scheduler.schedule({ key: '1', kind: 'nudge.a', student: 's_ana', runAt: T0 + HOUR });
    h.scheduler.schedule({ key: '2', kind: 'nudge.b', student: 's_ben', runAt: T0 + HOUR });
    h.scheduler.schedule({ key: '3', kind: 'pact.x', student: 's_ana', runAt: T0 + HOUR });
    expect(h.scheduler.cancelWhere({ student: 's_ana', kindPrefix: 'nudge.' })).toBe(1);
    expect(h.scheduler.list({ status: 'pending' }).map((j) => j.key)).toEqual(['2', '3']);
  });

  it('survives a restart: a new scheduler on the same db sees pending jobs', async () => {
    const a = createSchedulerHarness();
    a.scheduler.schedule({ key: 'p', kind: 'test.say', student: 's_ana', runAt: T0 + HOUR });
    const b = createSchedulerHarness({ db: a.db, startMs: T0 });
    say(b);
    await b.advance(2 * HOUR);
    expect(b.sink.dms).toHaveLength(1);
  });
});

describe('retries', () => {
  it('retries a throwing handler with backoff, then marks it failed', async () => {
    const h = createSchedulerHarness();
    let n = 0;
    h.scheduler.register('t.boom', async () => {
      n++;
      throw new Error('nope');
    });
    h.scheduler.schedule({ key: 'b', kind: 't.boom', student: 's_ana', runAt: T0, maxAttempts: 3 });
    const r1 = await h.advance(MIN);
    expect(r1.map((r) => r.outcome)).toContain('retry');
    await h.advance(10 * MIN, 10_000);
    expect(n).toBe(3);
    expect(h.scheduler.list({ kind: 't.boom' })[0]).toMatchObject({
      status: 'failed',
      attempts: 3,
      lastError: 'nope',
    });
    await h.advance(DAY, HOUR);
    expect(n).toBe(3);
  });

  it('a failed send releases the reserved slot so the retry can send', async () => {
    const h = createSchedulerHarness();
    let fail = true;
    const dm = h.ctx.dm;
    h.ctx.dm = async (...a) => {
      if (fail) throw new Error('transport down');
      return dm(...a);
    };
    h.scheduler.register('t.dm', async (c) => {
      await c.deliver({ scope: 'dm', text: 'hi', dedupe: 'd' });
    });
    h.scheduler.schedule({ key: 'r', kind: 't.dm', student: 's_ana', runAt: T0 });
    await h.advance(MIN);
    fail = false;
    await h.advance(5 * MIN, 30_000);
    expect(h.sink.dms).toHaveLength(1);
  });

  it('recovers a job left running by a crashed process', async () => {
    const h = createSchedulerHarness();
    const runs = say(h);
    h.scheduler.schedule({ key: 'x', kind: 'test.say', student: 's_ana', runAt: T0 });
    h.db
      .prepare("UPDATE sched_jobs SET status='running', lease_until=? WHERE key='x'")
      .run(T0 + MIN);
    await h.advance(30 * MIN);
    expect(runs).toHaveLength(1);
  });
});

describe('cron jobs and missed runs', () => {
  it('a daily cron fires at the local time in the student zone, once per day', async () => {
    const h = createSchedulerHarness({ config: { quiet: { start: '00:00', end: '00:00' } } });
    h.scheduler.setPrefs('s_ana', { tz: NY, optIn: true });
    const runs = say(h);
    h.scheduler.schedule({ key: 'n', kind: 'test.say', student: 's_ana', cron: '0 21 * * *' });
    await h.advance(3 * DAY, 15 * MIN);
    // 21:00 EDT Oct 26 = Oct 27 01:00Z; Oct 27 21:00 EDT; Oct 28 21:00 EDT
    expect(runs.map((t) => new Date(t).toISOString().slice(0, 13))).toEqual([
      '2026-10-27T01',
      '2026-10-28T01',
      '2026-10-29T01',
    ]);
  });

  it('run_once policy: three missed days collapse to ONE run on restart, then the next occurrence', async () => {
    const h = createSchedulerHarness({ config: { quiet: { start: '00:00', end: '00:00' } } });
    const runs = say(h);
    h.scheduler.schedule({
      key: 'm',
      kind: 'test.say',
      student: 's_ana',
      cron: '0 9 * * *',
      missed: 'run_once',
      graceMs: 99 * DAY,
    });
    h.set(T0 + 3 * DAY); // bot was down for three days
    await h.scheduler.tick();
    expect(runs).toHaveLength(1);
    const job = h.scheduler.get('m')!;
    expect(job.runAt).toBeGreaterThan(h.now());
    await h.scheduler.tick();
    expect(runs).toHaveLength(1);
  });

  it('skip policy: a run missed beyond the grace window is skipped, not sent late', async () => {
    const h = createSchedulerHarness({ config: { quiet: { start: '00:00', end: '00:00' } } });
    const runs = say(h);
    h.scheduler.schedule({
      key: 's',
      kind: 'test.say',
      student: 's_ana',
      runAt: T0 + HOUR,
      missed: 'skip',
      graceMs: 30 * MIN,
    });
    h.set(T0 + 5 * HOUR);
    const r = await h.scheduler.tick();
    expect(r[0]?.outcome).toBe('missed_skipped');
    expect(runs).toHaveLength(0);
    expect(h.scheduler.list({ kind: 'test.say' })[0]?.status).toBe('skipped');
  });

  it('skip policy still runs when within the grace window', async () => {
    const h = createSchedulerHarness({ config: { quiet: { start: '00:00', end: '00:00' } } });
    const runs = say(h);
    h.scheduler.schedule({
      key: 's',
      kind: 'test.say',
      student: 's_ana',
      runAt: T0 + HOUR,
      missed: 'skip',
      graceMs: 30 * MIN,
    });
    h.set(T0 + HOUR + 10 * MIN);
    await h.scheduler.tick();
    expect(runs).toHaveLength(1);
  });

  it('a deferred skip-policy job is skipped if the deferral outlasts its grace', async () => {
    const h = createSchedulerHarness();
    h.scheduler.setPrefs('s_ana', { snoozeUntil: T0 + 6 * HOUR });
    const runs = say(h);
    h.scheduler.schedule({
      key: 'd',
      kind: 'test.say',
      student: 's_ana',
      runAt: T0 + MIN,
      missed: 'skip',
      graceMs: HOUR,
    });
    await h.advance(8 * HOUR, 10 * MIN);
    expect(runs.length).toBeLessThanOrEqual(1);
    expect(h.sink.dms).toHaveLength(0);
    expect(h.scheduler.list({ kind: 'test.say' })[0]?.status).toBe('skipped');
  });
});

describe('opt-in, opt-out, snooze', () => {
  it('requiresOptIn jobs never message a student who did not opt in', async () => {
    const h = createSchedulerHarness();
    say(h);
    h.scheduler.schedule({
      key: 'o',
      kind: 'test.say',
      student: 's_ana',
      runAt: T0,
      requiresOptIn: true,
    });
    const r = await h.advance(HOUR);
    expect(r[0]?.outcome).toBe('skipped');
    expect(h.sink.dms).toHaveLength(0);
  });

  it('the setup flow can record consent in memory (setup.nudges)', async () => {
    const h = createSchedulerHarness();
    h.db
      .prepare(
        "INSERT INTO memory(scope, scope_id, key, value_json, ts) VALUES('student','s_ana','setup.nudges','true',1)",
      )
      .run();
    expect(h.scheduler.prefs('s_ana').optIn).toBe(true);
    expect(h.scheduler.prefs('s_ben').optIn).toBe(false);
  });

  it('opt-out drops everything, including consented pact-style reminders', async () => {
    const h = createSchedulerHarness();
    h.scheduler.register('t.c', async (c) => {
      await c.deliver({ scope: 'dm', text: 'x', consented: true });
    });
    h.scheduler.setPrefs('s_ana', { optIn: true });
    h.scheduler.setPrefs('s_ana', { optedOut: true });
    h.scheduler.schedule({ key: 'z', kind: 't.c', student: 's_ana', runAt: T0 });
    await h.advance(HOUR);
    expect(h.sink.dms).toHaveLength(0);
    expect(h.scheduler.prefs('s_ana')).toMatchObject({ optIn: false, optedOut: true });
  });

  it('opting in again clears the opt-out; listeners are told', () => {
    const h = createSchedulerHarness();
    const seen: string[] = [];
    h.scheduler.onPrefsChange((s, p) => seen.push(`${s}:${p.optIn}`));
    h.scheduler.setPrefs('s_ana', { optedOut: true });
    h.scheduler.setPrefs('s_ana', { optIn: true });
    expect(h.scheduler.prefs('s_ana')).toMatchObject({ optIn: true, optedOut: false });
    expect(seen).toEqual(['s_ana:false', 's_ana:true']);
  });

  it('snooze defers delivery to the snooze end, then sends', async () => {
    const h = createSchedulerHarness();
    h.scheduler.setPrefs('s_ana', { optIn: true, snoozeUntil: T0 + 2 * HOUR });
    say(h);
    h.scheduler.schedule({
      key: 'sn',
      kind: 'test.say',
      student: 's_ana',
      runAt: T0,
      requiresOptIn: true,
    });
    await h.advance(HOUR, 10 * MIN);
    expect(h.sink.dms).toHaveLength(0);
    await h.advance(HOUR + 10 * MIN, 5 * MIN);
    expect(h.sink.dms).toHaveLength(1);
    expect(h.sink.dms[0]!.at).toBeGreaterThanOrEqual(T0 + 2 * HOUR);
  });

  it('three ignored nudges in a row auto-snooze the student for 3 days; engagement resets the count', async () => {
    const h = createSchedulerHarness();
    h.scheduler.setPrefs('s_ana', { optIn: true });
    h.scheduler.register('t.ig', async (hc) => {
      hc.noteIgnored('s_ana');
    });
    for (const k of ['a', 'b'])
      h.scheduler.schedule({ key: k, kind: 't.ig', student: 's_ana', runAt: T0 });
    await h.advance(MIN);
    expect(h.scheduler.prefs('s_ana').snoozeUntil).toBeUndefined();
    h.scheduler.schedule({ key: 'c', kind: 't.ig', student: 's_ana', runAt: T0 + 2 * MIN });
    await h.advance(3 * MIN);
    expect(h.scheduler.prefs('s_ana').snoozeUntil).toBeGreaterThan(h.now() + 2 * DAY);
  });
});

describe('quiet hours and rate limits', () => {
  it('defers to 08:00 in the student zone when due at 23:00 local', async () => {
    const h = createSchedulerHarness({ startMs: Date.UTC(2026, 9, 27, 2, 0) }); // 22:00 EDT
    h.scheduler.setPrefs('s_ana', { tz: NY, optIn: true });
    say(h);
    h.scheduler.schedule({
      key: 'q',
      kind: 'test.say',
      student: 's_ana',
      runAt: Date.UTC(2026, 9, 27, 3, 0),
    });
    await h.advance(12 * HOUR, 5 * MIN);
    expect(h.sink.dms).toHaveLength(1);
    expect(new Date(h.sink.dms[0]!.at).toISOString()).toBe('2026-10-27T12:00:00.000Z'); // 08:00 EDT
  });

  it('a student in another zone is not quiet at the same instant', async () => {
    const h = createSchedulerHarness({ startMs: Date.UTC(2026, 9, 27, 3, 0) }); // 23:00 NY, 08:30 Kolkata
    h.scheduler.setPrefs('s_raj', { tz: 'Asia/Kolkata', optIn: true });
    say(h);
    h.scheduler.schedule({ key: 'k', kind: 'test.say', student: 's_raj', runAt: h.now() });
    await h.advance(MIN);
    expect(h.sink.dms).toHaveLength(1);
  });

  it('enforces a minimum gap between proactive messages to one student', async () => {
    const h = createSchedulerHarness({
      config: { quiet: { start: '00:00', end: '00:00' }, minGapMs: 30 * MIN },
    });
    say(h);
    h.scheduler.schedule({ key: '1', kind: 'test.say', student: 's_ana', runAt: T0 });
    h.scheduler.schedule({ key: '2', kind: 'test.say', student: 's_ana', runAt: T0 });
    await h.advance(10 * MIN);
    expect(h.sink.dms).toHaveLength(1);
    await h.advance(30 * MIN, 5 * MIN);
    expect(h.sink.dms).toHaveLength(2);
    expect(h.sink.dms[1]!.at - h.sink.dms[0]!.at).toBeGreaterThanOrEqual(30 * MIN);
  });

  it('caps proactive messages per student per rolling day', async () => {
    const h = createSchedulerHarness({
      config: {
        quiet: { start: '00:00', end: '00:00' },
        minGapMs: MIN,
        dailyCap: 3,
        globalPerMinute: 99,
      },
    });
    say(h);
    for (let i = 0; i < 6; i++)
      h.scheduler.schedule({
        key: `c${i}`,
        kind: 'test.say',
        student: 's_ana',
        runAt: T0 + i * 2 * MIN,
      });
    await h.advance(20 * HOUR, 10 * MIN);
    expect(h.sink.dms).toHaveLength(3);
    await h.advance(6 * HOUR, 10 * MIN); // the first send ages out of the 24 h window
    expect(h.sink.dms.length).toBeGreaterThan(3);
  });

  it('a global per-minute limit stops a burst across many students', async () => {
    const h = createSchedulerHarness({
      config: { quiet: { start: '00:00', end: '00:00' }, globalPerMinute: 3 },
    });
    say(h);
    for (let i = 0; i < 10; i++)
      h.scheduler.schedule({ key: `g${i}`, kind: 'test.say', student: `s_${i}`, runAt: T0 });
    await h.scheduler.tick();
    expect(h.sink.dms).toHaveLength(3);
    // never more than 3 in any rolling minute
    await h.advance(30 * MIN, 10_000);
    expect(h.sink.dms).toHaveLength(10);
    const times = h.sink.dms.map((d) => d.at);
    for (const t of times)
      expect(times.filter((x) => x > t - MIN && x <= t).length).toBeLessThanOrEqual(3);
  });

  it('group messages need an opted-in member and respect the 120 s unprompted cooldown', async () => {
    const h = createSchedulerHarness({ config: { quiet: { start: '00:00', end: '00:00' } } });
    h.db
      .prepare(
        "INSERT INTO chat_members(chat_id, student_id) VALUES('group:t','s_ana'),('group:t','s_ben')",
      )
      .run();
    h.scheduler.register('t.g', async (c) => {
      await c.deliver({ scope: 'group', text: 'squad thing' });
    });
    h.scheduler.schedule({ key: 'g1', kind: 't.g', chatId: 'group:t', scope: 'group', runAt: T0 });
    await h.advance(MIN);
    expect(h.sink.groups).toHaveLength(0); // nobody opted in: dropped
    h.scheduler.setPrefs('s_ana', { optIn: true });
    h.scheduler.schedule({
      key: 'g2',
      kind: 't.g',
      chatId: 'group:t',
      scope: 'group',
      runAt: h.now(),
    });
    h.scheduler.schedule({
      key: 'g3',
      kind: 't.g',
      chatId: 'group:t',
      scope: 'group',
      runAt: h.now(),
    });
    await h.advance(MIN, 30_000);
    expect(h.sink.groups).toHaveLength(1);
    await h.advance(3 * MIN, 30_000);
    expect(h.sink.groups).toHaveLength(2);
    expect(h.sink.groups[1]!.at - h.sink.groups[0]!.at).toBeGreaterThanOrEqual(120_000);
  });

  it('askConfirm goes through the same gate and counts as a send', async () => {
    const h = createSchedulerHarness({
      answers: ['Yes'],
      config: { quiet: { start: '00:00', end: '00:00' } },
    });
    h.scheduler.setPrefs('s_ana', { optIn: true });
    let answer: unknown;
    h.scheduler.register('t.ask', async (c) => {
      const r = await c.ask!({
        student: 's_ana',
        question: 'ok?',
        options: ['Yes', 'No'],
        taskId: 't1',
      });
      answer = r;
    });
    h.scheduler.schedule({
      key: 'a1',
      kind: 't.ask',
      student: 's_ana',
      runAt: T0,
      requiresOptIn: true,
    });
    await h.advance(MIN);
    expect(answer).toEqual({ status: 'answered', answer: 'Yes' });
    expect(h.scheduler.recentSends()).toHaveLength(1);
  });
});

describe('validation', () => {
  it('rejects bad cron, bad zone, and DM jobs without a student', () => {
    const h = createSchedulerHarness();
    expect(() =>
      h.scheduler.schedule({ key: 'x', kind: 'k', student: 's', cron: 'nope' }),
    ).toThrow();
    expect(() =>
      h.scheduler.schedule({ key: 'y', kind: 'k', student: 's', runAt: 1, tz: 'Mars/X' }),
    ).toThrow();
    expect(() => h.scheduler.schedule({ key: 'z', kind: 'k', runAt: 1 })).toThrow();
    expect(() => h.scheduler.setPrefs('s', { tz: 'Mars/X' })).toThrow();
  });
  it('an unknown handler fails the job loudly', async () => {
    const h = createSchedulerHarness();
    h.scheduler.schedule({ key: 'u', kind: 'ghost', student: 's_ana', runAt: T0 });
    const r = await h.advance(MIN);
    expect(r[0]?.outcome).toBe('no_handler');
  });
});
