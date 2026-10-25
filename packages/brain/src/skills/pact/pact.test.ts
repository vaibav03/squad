import { describe, expect, it } from 'vitest';
import type { Ctx, InboundMessage } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import type { HandlerCtx, JobRecord } from '../nudges/api';
import { createFakeProactive } from '../nudges/fakeProactive';
import { formatLocal, zonedParts, zonedToUtc } from '../nudges/time';
import { createPactSkill, parseDeadline, registerPactHandlers } from './index';
import { ownPacts } from './store';

const NY = 'America/New_York';
const at = (y: number, mo: number, d: number, h = 0, mi = 0, tz = NY) =>
  zonedToUtc(y, mo, d, h, mi, tz);
const local = (ms: number, tz = NY) => {
  const p = zonedParts(ms, tz);
  return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')} ${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
};

describe('parseDeadline', () => {
  const now = at(2026, 10, 28, 12); // Wednesday noon New York
  const cases: [string, string | undefined][] = [
    ['finish ch6 by Friday', '2026-10-30 20:00'],
    ['finish ch6 by Wednesday', '2026-10-28 20:00'], // same day, 20:00 still ahead
    ['by next Friday', '2026-11-06 20:00'],
    ['do it tomorrow', '2026-10-29 20:00'],
    ['do it tonight', '2026-10-28 20:00'],
    ['by 5pm', '2026-10-28 17:00'],
    ['by 9am', '2026-10-29 09:00'],
    ['Friday at 5:30pm', '2026-10-30 17:30'],
    ['in 3 days', '2026-10-31 20:00'],
    ['by Nov 5', '2026-11-05 20:00'],
    ['by 2026-11-12', '2026-11-12 20:00'],
    ['by eod', '2026-10-28 17:00'],
    ['whenever', undefined],
    ['by yesterday 3pm and 2026-10-01', undefined], // past
    ['by 2027-03-01', undefined], // > 60 days
  ];
  for (const [text, want] of cases)
    it(`"${text}"`, () => {
      const d = parseDeadline(text, now, NY);
      expect(d ? local(d.at) : undefined).toBe(want);
    });

  it('after 20:00 the same weekday rolls a week', () => {
    const late = at(2026, 10, 28, 21);
    expect(local(parseDeadline('by Wednesday', late, NY)!.at)).toBe('2026-11-04 20:00');
  });
  it('in 2 hours is relative', () => {
    expect(parseDeadline('in 2 hours', now, NY)!.at).toBe(now + 2 * 3_600_000);
  });
  it('is time zone aware', () => {
    const t = parseDeadline('tomorrow 9am', at(2026, 10, 28, 12, 0, 'Asia/Tokyo'), 'Asia/Tokyo')!;
    expect(local(t.at, 'Asia/Tokyo')).toBe('2026-10-29 09:00');
    expect(t.at).toBe(at(2026, 10, 29, 9, 0, 'Asia/Tokyo'));
  });
  it('DST fall back day (2026-11-01): 20:00 is EST', () => {
    const d = parseDeadline('by Sunday', at(2026, 10, 30, 12), NY)!;
    expect(d.at).toBe(Date.UTC(2026, 11 - 1, 2, 1, 0)); // 20:00 EST = 01:00Z
    expect(formatLocal(d.at, NY)).toContain('8:00 PM');
  });
  it('DST spring forward day (2026-03-08): 20:00 is EDT', () => {
    const d = parseDeadline('by Sunday', at(2026, 3, 5, 12), NY)!;
    expect(d.at).toBe(Date.UTC(2026, 3 - 1, 9, 0, 0)); // 20:00 EDT = 00:00Z
  });
  it('rest strips the phrase', () => {
    expect(parseDeadline('finish ch6 by Friday', now, NY)!.rest).toBe('finish ch6');
  });
});

// ---- harness ----------------------------------------------------------------------------------
function setup(startMs = at(2026, 10, 28, 12)) {
  const db = openMemoryDb();
  for (const [id, n] of [
    ['s_ana', 'Ana'],
    ['s_ben', 'Ben'],
  ])
    db.prepare('INSERT INTO students(id,name,handle) VALUES(?,?,?)').run(id, n, id);
  const api = createFakeProactive(startMs);
  for (const s of ['s_ana', 's_ben']) api.setPrefs(s, { tz: NY });
  registerPactHandlers(api);
  const skill = createPactSkill({ api });
  const sends: string[] = [];
  const dms: { to: string; text: string }[] = [];
  const answers: string[] = [];
  const asks: { to: string; q: string; opts: string[] }[] = [];
  const ctx = {
    db,
    llm: {},
    send: async (o: { text?: string }) => void sends.push(o.text ?? ''),
    dm: async (to: string, text: string) => void dms.push({ to, text }),
    askConfirm: async (to: string, q: string, opts: string[]) => {
      asks.push({ to, q, opts });
      return answers.shift() ?? 'timeout';
    },
  } as unknown as Ctx;
  const delivered: { student?: string; text: string; dedupe?: string }[] = [];
  const run = async (job: JobRecord) => {
    const h: HandlerCtx = {
      job,
      now: api.now(),
      ctx,
      api,
      deliver: async (r) => (delivered.push(r), { status: 'sent' }),
      noteIgnored() {},
      noteEngaged() {},
    };
    return api.handlers.get(job.kind)!(h);
  };
  const msg = (text: string, o: Partial<InboundMessage> = {}): InboundMessage => ({
    chatId: 'group:t',
    isGroup: true,
    from: 's_ana',
    text,
    attachments: [],
    mentionsBot: true,
    ts: api.now(),
    ...o,
  });
  const say = async (text: string, o: Partial<InboundMessage> = {}) => {
    const m = msg(text, o);
    const score = await skill.match(m, ctx);
    return { score, out: score > 0 ? await skill.handle(m, ctx) : [] };
  };
  return { db, api, skill, ctx, sends, dms, answers, asks, delivered, run, say, msg };
}
const HOUR = 3_600_000;

describe('pact lifecycle', () => {
  it('records, confirms by DM, reminds, checks in', async () => {
    const t = setup();
    const r = await t.say('@cubbie pinky promise: I will finish ch6 by Friday');
    expect(r.score).toBe(0.9);
    expect(r.out).toEqual([
      { chatId: 'group:t', text: 'Got it, Ana. I will DM you to lock it in.' },
    ]);
    const [p] = ownPacts(t.db, 's_ana', ['pending_confirm']);
    expect(p!.text).toBe('finish ch6');
    const confirm = t.api.list({ kind: 'pact.confirm' })[0]!;
    expect(confirm.scope).toBe('dm');

    t.answers.push('Yes, lock it in');
    await t.run(confirm);
    expect(t.asks[0]!.q).toContain('"finish ch6" by Fri, Oct 30, 8:00 PM');
    expect(ownPacts(t.db, 's_ana', ['active'])).toHaveLength(1);
    const kinds = t.api.list({ student: 's_ana' }).map((j) => j.key.split(':')[2]);
    expect(kinds).toEqual(expect.arrayContaining(['confirm', 'remind1', 'remind2', 'checkin']));

    const remind2 = t.api.jobs.find((j) => j.key.includes('remind2'))!;
    expect(remind2.runAt).toBe(p!.deadline - 2 * HOUR);
    t.api.setNow(remind2.runAt);
    await t.run(remind2);
    expect(t.delivered[0]!.text).toBe(
      'Reminder: "finish ch6" is due Fri, Oct 30, 8:00 PM. You can do it.',
    );
    expect(t.delivered[0]!.dedupe).toBe(remind2.key);

    const checkin = t.api.jobs.find((j) => j.kind === 'pact.checkin')!;
    expect(checkin.runAt).toBe(p!.deadline + HOUR);
    t.api.setNow(checkin.runAt);
    t.answers.push('Done');
    await t.run(checkin);
    expect(ownPacts(t.db, 's_ana', ['kept'])).toHaveLength(1);
    expect(t.sends).toEqual([]);
  });

  it('extension works once, then lets go; misses are DM-only and silent', async () => {
    const t = setup();
    await t.say('@cubbie I will finish ch6 by Friday');
    t.answers.push('Yes, lock it in');
    await t.run(t.api.list({ kind: 'pact.confirm' })[0]!);
    const p = ownPacts(t.db, 's_ana', ['active'])[0]!;
    t.api.setNow(p.deadline + HOUR);
    t.answers.push('Need 24 more hours');
    await t.run(t.api.jobs.find((j) => j.kind === 'pact.checkin')!);
    const ext = ownPacts(t.db, 's_ana', ['active'])[0]!;
    expect(ext.deadline).toBe(p.deadline + 24 * HOUR);
    expect(ext.extended).toBe(1);
    const next = t.api.jobs.filter((j) => j.kind === 'pact.checkin').at(-1)!;
    t.api.setNow(next.runAt);
    t.answers.push('Need 24 more hours');
    await t.run(next);
    expect(ownPacts(t.db, 's_ana', ['dropped'])).toHaveLength(1);
    expect(t.sends).toEqual([]);
  });

  it('timeout at check-in marks missed with no message at all', async () => {
    const t = setup();
    await t.say('@cubbie I will finish ch6 by Friday');
    t.answers.push('Yes, lock it in');
    await t.run(t.api.list({ kind: 'pact.confirm' })[0]!);
    const p = ownPacts(t.db, 's_ana', ['active'])[0]!;
    t.api.setNow(p.deadline + HOUR);
    const dmsBefore = t.dms.length;
    await t.run(t.api.jobs.find((j) => j.kind === 'pact.checkin')!);
    expect(ownPacts(t.db, 's_ana', ['missed'])).toHaveLength(1);
    expect(t.dms.length).toBe(dmsBefore);
    expect(t.sends).toEqual([]);
  });

  it('timeout at confirm never activates; No cancels', async () => {
    const t = setup();
    await t.say('@cubbie I will finish ch6 by Friday');
    await t.run(t.api.list({ kind: 'pact.confirm' })[0]!);
    expect(ownPacts(t.db, 's_ana', ['pending_confirm'])).toHaveLength(1);
    expect(t.api.jobs.filter((j) => j.kind === 'pact.remind')).toHaveLength(0);
    t.answers.push('No, cancel');
    await t.run(t.api.list({ kind: 'pact.confirm' })[0]!);
    expect(ownPacts(t.db, 's_ana', ['cancelled'])).toHaveLength(1);
  });

  it('Change deadline: DM reply updates it and re-confirms', async () => {
    const t = setup();
    await t.say('@cubbie I will finish ch6 by Friday');
    t.answers.push('Change deadline');
    await t.run(t.api.list({ kind: 'pact.confirm' })[0]!);
    expect(t.dms.at(-1)!.text).toContain('new deadline');
    const r = await t.say('tomorrow 5pm', { isGroup: false, chatId: 'dm:s_ana' });
    expect(r.score).toBe(0.95);
    const p = ownPacts(t.db, 's_ana', ['pending_confirm'])[0]!;
    expect(local(p.deadline)).toBe('2026-10-29 17:00');
    expect(t.api.list({ kind: 'pact.confirm' })).toHaveLength(2);
    // not awaiting anymore
    expect((await t.say('tomorrow 5pm', { isGroup: false })).score).toBe(0);
  });

  it('opt-out drops silently; snooze defers', async () => {
    const t = setup();
    await t.say('@cubbie I will finish ch6 by Friday');
    const job = t.api.list({ kind: 'pact.confirm' })[0]!;
    t.api.setPrefs('s_ana', { snoozeUntil: t.api.now() + 2 * HOUR });
    expect(await t.run(job)).toEqual({ defer: t.api.now() + 2 * HOUR, reason: 'snoozed' });
    expect(t.asks).toHaveLength(0);
    t.api.setPrefs('s_ana', { snoozeUntil: null, optedOut: true });
    await t.run(job);
    expect(ownPacts(t.db, 's_ana', ['cancelled'])).toHaveLength(1);
    expect(t.asks).toHaveLength(0);
  });

  it('idempotent: the same promise twice creates one pact and one job', async () => {
    const t = setup();
    await t.say('@cubbie I will finish ch6 by Friday');
    t.api.setNow(t.api.now() + 30_000);
    await t.say('@cubbie I will finish ch6 by Friday');
    expect(ownPacts(t.db, 's_ana', ['pending_confirm'])).toHaveLength(1);
    expect(t.api.list({ kind: 'pact.confirm' })).toHaveLength(1);
  });

  it('asks for a clearer deadline when missing, past or too far', async () => {
    const t = setup();
    const a = await t.say('@cubbie pinky promise I will read ch7');
    expect(a.out[0]!.text).toContain('When by');
    const b = await t.say('@cubbie I will read ch7 by 2027-06-01');
    expect(b.out[0]!.text).toContain('60 days');
    expect(ownPacts(t.db, 's_ana', ['pending_confirm', 'active'])).toHaveLength(0);
  });

  it('list and cancel: own only, DM from a group', async () => {
    const t = setup();
    await t.say('@cubbie I will SECRETBEN-task by Friday', { from: 's_ben' });
    await t.say('@cubbie I will finish ch6 by Friday');
    const l = await t.say('@cubbie my promises');
    expect(l.out[0]!.text).toBe('Sent you a DM.');
    expect(t.dms.at(-1)!.to).toBe('s_ana');
    expect(t.dms.at(-1)!.text).toContain('finish ch6');
    expect(JSON.stringify(t.dms)).not.toContain('SECRETBEN');
    const c = await t.say('@cubbie cancel my promise 1');
    expect(c.out[0]!.text).toBe('Sent you a DM.');
    expect(ownPacts(t.db, 's_ana', ['cancelled'])).toHaveLength(1);
    expect(ownPacts(t.db, 's_ben', ['pending_confirm'])).toHaveLength(1);
    expect(t.api.list({ student: 's_ana', status: 'pending' })).toHaveLength(0);
    // DM listing replies in place
    const d = await t.say('my promises', { from: 's_ben', isGroup: false, chatId: 'dm:s_ben' });
    expect(d.out[0]!.text).toContain('SECRETBEN-task');
  });
});

describe('privacy and silence', () => {
  it('only the creation ack is ever sent to the group; no group text names the task or deadline', async () => {
    const t = setup();
    const r = await t.say('@cubbie I will finish SECRETTASK by Friday');
    const acks = r.out.map((o) => o.text);
    expect(acks).toEqual(['Got it, Ana. I will DM you to lock it in.']);
    t.answers.push('Yes, lock it in', 'timeout');
    await t.run(t.api.list({ kind: 'pact.confirm' })[0]!);
    for (const j of t.api.jobs.filter((x) => x.kind !== 'pact.confirm')) {
      t.api.setNow(j.runAt);
      await t.run(j);
    }
    expect(t.sends).toEqual([]); // ctx.send never called by any handler
    expect(JSON.stringify(acks)).not.toContain('SECRETTASK');
    expect(JSON.stringify(t.dms.filter((d) => d.to !== 's_ana'))).toBe('[]');
  });

  it('banter (unaddressed) scores 0, even commitment-shaped lines', async () => {
    const t = setup();
    const lines = [
      'lol',
      'anyone free tonight',
      'I will be late by 5pm',
      "I'll finish by Friday lol",
      'pinky promise I will come',
      'my promises are broken',
      'cancel my promise to buy snacks',
      'did you see the game',
      'omg that exam was brutal',
      'I am going to the library by 3pm',
      'see you tomorrow',
      'ok',
      'cubbies are the best team',
      'email me@cubbie.com',
      'I told cubbie yesterday',
    ];
    for (const l of lines) expect((await t.say(l, { mentionsBot: false })).score).toBe(0);
  });

  it('a mention without a commitment is not claimed', async () => {
    const t = setup();
    for (const l of [
      '@cubbie hi',
      '@cubbie quiz me on ch3',
      '@cubbie I will win',
      '@cubbie what is a z-score',
    ])
      expect((await t.say(l)).score).toBe(0);
  });
});
