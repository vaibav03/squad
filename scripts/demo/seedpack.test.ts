import { describe, expect, it } from 'vitest';
import { assertNoLeak, SENTINELS } from '@squad/core';
import { commonFreeWindows, parseIcs } from './lib/calendar';
import { loadSeedPack, plantedSentinels, privateSeedView, publicSeedView } from './lib/seedpack';
import { StudentsFileSchema } from './lib/schema';
import { checkNoLeak } from './lib/checks';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SEED_DIR } from './lib/paths';

const pack = loadSeedPack();

describe('seed pack', () => {
  it('validates with zod and the spec cast', () => {
    expect(pack.students.students.map((s) => s.id)).toEqual(['s_ana', 's_ben', 's_chi', 's_dev']);
    expect(pack.students.squadId).toBe('sq_demo');
    expect(pack.course.groupName).toBe('Stats Midterm Grind');
    expect(pack.course.chapters.map((c) => c.id)).toEqual(['ch2', 'ch3', 'ch6', 'ch12']);
    expect(pack.course.attribution).toMatch(/CC BY 4\.0/);
  });

  it('budgets are distinct and match the spec scenario', () => {
    const b = Object.fromEntries(pack.students.students.map((s) => [s.id, s.private.budget]));
    expect(b['s_ben']?.hardCapUsd).toBe(80);
    expect(b['s_ana']?.comfortableUsd).toBe(200);
    expect(new Set(Object.values(b).map((x) => x.hardCapUsd)).size).toBe(4);
  });

  it('lodging: Flagstaff cabin at $64 survives, Cabo exceeds every cap', () => {
    const o = Object.fromEntries(pack.lodging.options.map((x) => [x.id, x]));
    expect(o['opt_flagstaff_cabin']?.perPersonUsd).toBe(64);
    const caps = pack.students.students.map((s) => s.private.budget.hardCapUsd);
    expect(caps.every((c) => (o['opt_flagstaff_cabin']?.perPersonUsd ?? 999) <= c)).toBe(true);
    expect(caps.some((c) => (o['opt_cabo']?.perPersonUsd ?? 0) > c)).toBe(true);
    expect(o['opt_cabo']?.demoOutcome).toBe('dropped_budget');
  });

  it('plants every sentinel in private fields only', () => {
    expect(plantedSentinels(pack).sort()).toEqual([...SENTINELS].sort());
    expect(() => assertNoLeak(publicSeedView(pack))).not.toThrow();
    expect(checkNoLeak('x', privateSeedView(pack)).status).toBe('FAIL'); // the check really can catch them
  });

  it('rejects a bad handle and duplicate budgets', () => {
    const base = JSON.parse(fs.readFileSync(path.join(SEED_DIR, 'students.json'), 'utf8'));
    const badHandle = structuredClone(base);
    badHandle.students[0].handle = '+14805551234';
    expect(StudentsFileSchema.safeParse(badHandle).success).toBe(false);
    const dup = structuredClone(base);
    dup.students[1].private.budget.hardCapUsd = 150;
    dup.students[1].private.budget.comfortableUsd = 150;
    expect(StudentsFileSchema.safeParse(dup).success).toBe(false);
  });

  it('loader reports a missing calendar clearly', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-'));
    fs.cpSync(SEED_DIR, tmp, { recursive: true });
    fs.rmSync(path.join(tmp, 'calendars/s_dev.ics'));
    expect(() => loadSeedPack(tmp)).toThrow(/s_dev\.ics/);
  });
});

describe('calendars', () => {
  const spec = pack.course.studyWindow;
  const cals = pack.events;

  it('are valid iCalendar files', () => {
    for (const text of Object.values(pack.calendars)) {
      expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
      expect(text.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
      expect(parseIcs(text).length).toBeGreaterThan(3);
    }
    expect(() => parseIcs('nope')).toThrow();
  });

  it('there is NO common two-hour window before Thursday midterm', () => {
    expect(commonFreeWindows(cals, spec)).toEqual([]);
  });

  it('Wednesday 7 PM works once Ben moves his gym (and only then)', () => {
    const benGym = pack.events['s_ben']!.find((e) => /gym - lift/i.test(e.summary));
    expect(benGym).toBeDefined();
    const w = commonFreeWindows(cals, spec, [benGym!.uid]);
    expect(w[0]).toBe('2026-11-04T19:00');
    expect(w.every((x) => x.startsWith('2026-11-04'))).toBe(true);
  });

  it('Ben has lab and Ana a private shift in the conflict', () => {
    expect(pack.events['s_ben']!.some((e) => /lab/i.test(e.summary))).toBe(true);
    expect(pack.events['s_ana']!.some((e) => /shift/i.test(e.summary))).toBe(true);
  });
});
