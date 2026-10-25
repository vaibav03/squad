// End to end on the real router, speaking policy and confirm flow, with the virtual clock.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeLlm } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { ensureMasterySchema, importSyllabusText } from '@squad/brain';
import { createTestBot } from '../testing';
import { createProactive } from './wire';
import { T0 } from './testing';
import { createScheduler } from './scheduler';

const here = dirname(fileURLToPath(import.meta.url));
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const settle = () => new Promise((r) => setTimeout(r, 4));

function setup(llm = new FakeLlm({ fallback: 'fake reply' })) {
  const db = openMemoryDb();
  let clockRef = () => T0;
  const scheduler = createScheduler({ db, now: () => clockRef(), config: { minGapMs: MIN } });
  const p = createProactive({ db, scheduler });
  const t = createTestBot({ db, skills: p.skills, llm, startMs: T0 });
  clockRef = t.now;
  scheduler.bind(t.bot.ctx);
  const dmsTo = (s: string) =>
    t.sent.filter((m) => m.chatId === `dm:${s}`).map((m) => m.text ?? '');
  const advance = async (ms: number, step = 15 * MIN) => {
    const end = t.now() + ms;
    while (t.now() < end) {
      t.advance(Math.min(step, end - t.now()));
      // a handler may sit on an unanswered askConfirm: never wait for it
      scheduler.tick().catch(() => undefined);
      await settle();
    }
  };
  return { db, scheduler, t, dmsTo, advance };
}

describe('registry', () => {
  it('registers catchUp, nudges and pact', async () => {
    const { t } = setup();
    expect(t.bot).toBeTruthy();
    const p = createProactive({ db: openMemoryDb() });
    expect(p.skills.map((s) => s.name).sort()).toEqual(['catchUp', 'nudges', 'pact']);
  });
});

describe('opt-in and chat controls', () => {
  it('a student who never opted in gets no nudges, even with something due tomorrow', async () => {
    const { db, t, dmsTo, advance } = setup();
    importSyllabusText(db, 'demo', 'Homework 3 due Oct 27 11:59pm', { now: T0, tz: 'UTC' });
    await advance(3 * DAY, HOUR);
    expect(dmsTo('s_ana')).toHaveLength(0);
    expect(t.sent.filter((m) => /Due tomorrow/.test(m.text ?? ''))).toHaveLength(0);
  });

  it('"start nudges" opts in; at 9 pm local the due-tomorrow check-in arrives by DM only', async () => {
    const { db, t, dmsTo, advance } = setup();
    await t.say('s_ana', 'group:test', '@cubbie my timezone is ET');
    await t.say('s_ana', 'group:test', '@cubbie start nudges');
    // the group only ever sees "Sent you a DM."
    expect(
      t.sent
        .filter((m) => m.chatId === 'group:test')
        .every((m) => /Sent you a DM/.test(m.text ?? '')),
    ).toBe(true);
    // Homework due Tue Oct 27 11:59 pm New York
    importSyllabusText(db, 'demo', 'Homework 3 due Oct 27 11:59pm', {
      now: T0,
      tz: 'America/New_York',
    });
    await advance(DAY, 15 * MIN); // through Mon 21:00 EDT (Tue 01:00Z)
    const nudge = dmsTo('s_ana').filter((x) => /Due tomorrow/.test(x));
    expect(nudge).toHaveLength(1);
    expect(nudge[0]).toMatch(/^\u{1F43B} Squad: /u);
    expect(nudge[0]).toMatch(/Homework 3/);
    expect(dmsTo('s_ben')).toHaveLength(0); // never opted in
    expect(
      t.sent.filter((m) => m.chatId === 'group:test' && /Due tomorrow/.test(m.text ?? '')),
    ).toHaveLength(0);
  });

  it('"snooze 2h" and "stop nudges" are honoured', async () => {
    const { scheduler, t } = setup();
    await t.say('s_ana', 'dm', 'start nudges');
    await t.say('s_ana', 'dm', 'snooze 2h');
    expect(scheduler.prefs('s_ana').snoozeUntil).toBe(T0 + 2 * HOUR);
    await t.say('s_ana', 'dm', 'stop nudges');
    expect(scheduler.prefs('s_ana')).toMatchObject({ optedOut: true, optIn: false });
    expect(
      scheduler.list({ student: 's_ana', kindPrefix: 'nudge.', status: 'pending' }),
    ).toHaveLength(0);
  });
});

describe('spaced review via askConfirm', () => {
  it('asks "N chapters are due for review" with numbered options and starts the quiz on 1', async () => {
    const { db, scheduler, t, dmsTo, advance } = setup();
    ensureMasterySchema(db);
    scheduler.setPrefs('s_ana', { optIn: true, tz: 'UTC' });
    for (const ch of ['ch1', 'ch2', 'ch3'])
      db.prepare(
        'INSERT OR REPLACE INTO mastery(student,courseId,chapter,box,nextDue,updatedAt) VALUES(?,?,?,?,?,?)',
      ).run('s_ana', 'demo', ch, 1, T0 - DAY, T0 - DAY);
    // another student's rows must never leak
    db.prepare(
      'INSERT OR REPLACE INTO mastery(student,courseId,chapter,box,nextDue,updatedAt) VALUES(?,?,?,?,?,?)',
    ).run('s_ben', 'demo', 'ch9-ZEBRA', 1, T0 - DAY, T0 - DAY);
    await advance(6 * HOUR + 15 * MIN, 15 * MIN); // reaches 18:00 UTC
    const ask = dmsTo('s_ana').find((x) => /due for review/.test(x));
    expect(ask).toMatch(/3 chapters are due for review/);
    expect(ask).toMatch(/1\. Yes, quiz me/);
    expect(ask).not.toMatch(/ZEBRA/);
    await t.answerConfirm('s_ana', '1');
    await settle();
    expect(dmsTo('s_ana').some((x) => /quiz me on ch/.test(x))).toBe(true);
    expect(dmsTo('s_ben')).toHaveLength(0);
  });
});

describe('Pinky Promise end to end', () => {
  it('records in chat, confirms by DM, reminds, checks in; a miss is never public', async () => {
    const { t, dmsTo, advance, scheduler } = setup();
    scheduler.setPrefs('s_ana', { tz: 'UTC' });
    await t.say('s_ana', 'group:test', '@cubbie pinky promise: I will finish ch6 by Wednesday');
    const groupAfterAck = t.sent.filter((m) => m.chatId === 'group:test');
    expect(groupAfterAck).toHaveLength(1);
    expect(groupAfterAck[0]!.text).not.toMatch(/ch6/);
    await settle();
    expect(dmsTo('s_ana').join('\n')).toMatch(/Lock in/);
    await t.answerConfirm('s_ana', '1');
    await settle();
    const before = t.sent.filter((m) => m.chatId === 'group:test').length;
    await advance(2 * DAY, 30 * MIN); // Wed 20:00 deadline is 56 h away; reminder 24 h before
    expect(dmsTo('s_ana').filter((x) => /Reminder/.test(x)).length).toBeGreaterThanOrEqual(1);
    await advance(8 * HOUR + 90 * MIN, 30 * MIN); // to Wed 21:30: check-in 1 h after the deadline
    await settle();
    expect(dmsTo('s_ana').join('\n')).toMatch(/Did you finish/);
    // never answered -> counted as missed, still nothing public
    await advance(11 * MIN, MIN);
    await advance(DAY, HOUR);
    expect(t.sent.filter((m) => m.chatId === 'group:test')).toHaveLength(before);
    for (const m of t.sent.filter((x) => x.chatId.startsWith('group:')))
      expect(m.text).not.toMatch(/ch6|miss|fail/i);
  });
});

describe('Catch Me Up on the bot', () => {
  it('summarises the group chat only, never DMs', async () => {
    const { t } = setup();
    await t.say('s_ben', 'dm', 'ZEBRA-SECRET-DM please keep private');
    await t.say('s_ana', 'group:test', 'lets meet at 5 in the library');
    t.advance(MIN);
    await t.say('s_ben', 'group:test', 'ok sounds good, I will bring the notes');
    t.advance(MIN);
    await t.say('s_cam', 'group:test', 'who has the practice exam?');
    t.advance(MIN);
    const r = await t.say('s_dee', 'group:test', '@cubbie catch me up');
    const text = r.sent.map((m) => m.text).join('\n');
    expect(text).toMatch(/library|notes|practice exam/i);
    expect(JSON.stringify(t.sent)).not.toMatch(/ZEBRA/);
  });
});

describe('scripted multi-day session (fixtures/nudges/multiday.json)', () => {
  interface Fx {
    syllabus: string;
    steps: { afterMin: number; as: string; chat: string; say: string }[];
    afterAll: { advanceDays: number; stepMin: number };
    expect: {
      to?: string;
      group?: boolean;
      match?: string;
      times?: number;
      min?: number;
      none?: boolean;
      noneMatch?: string;
    }[];
  }
  it('plays out on the virtual clock with every expectation met', async () => {
    const fx = JSON.parse(
      readFileSync(
        resolve(here, '../../../../packages/brain/fixtures/nudges/multiday.json'),
        'utf8',
      ),
    ) as Fx;
    const { db, t, dmsTo, advance } = setup();
    importSyllabusText(db, 'demo', fx.syllabus, { now: T0, tz: 'America/New_York' });
    let at = 0;
    for (const s of fx.steps) {
      await advance((s.afterMin - at) * MIN, MIN);
      at = s.afterMin;
      await t.say(s.as, s.chat, s.say);
      await settle();
    }
    await advance(fx.afterAll.advanceDays * DAY, fx.afterAll.stepMin * MIN);
    for (const e of fx.expect) {
      if (e.group) {
        const g = t.sent.filter((m) => m.chatId.startsWith('group:')).map((m) => m.text ?? '');
        expect(g.filter((x) => new RegExp(e.noneMatch!, 'i').test(x))).toEqual([]);
      } else if (e.none) expect(dmsTo(e.to!)).toEqual([]);
      else {
        const n = dmsTo(e.to!).filter((x) => x.includes(e.match!)).length;
        if (e.times !== undefined) expect(n, e.match).toBe(e.times);
        if (e.min !== undefined) expect(n, e.match).toBeGreaterThanOrEqual(e.min);
      }
    }
  }, 60_000);
});
