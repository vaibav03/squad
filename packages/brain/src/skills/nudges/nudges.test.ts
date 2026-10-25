import { describe, expect, it } from 'vitest';
import { openMemoryDb } from '@squad/core/node';
import {
  classify,
  composeNightly,
  composeReview,
  createDueSource,
  createNudgeControlSkill,
  createFakeProactive,
  importIcsDue,
  importSyllabusText,
  parseSnooze,
  parseTz,
} from './index';

const NOW = Date.UTC(2026, 9, 26, 12, 0);
const NY = 'America/New_York';

describe('syllabus and ics import', () => {
  it('parses syllabus lines into course-wide due items in the zone', () => {
    const db = openMemoryDb();
    const items = importSyllabusText(
      db,
      'demo',
      'Week 1 reading\nHomework 3 due Oct 27 11:59pm\nMidterm exam: Nov 2\nQuiz 2 - 2026-11-05 10am',
      { now: NOW, tz: NY },
    );
    expect(items.map((i) => [i.kind, new Date(i.dueAt).toISOString()])).toEqual([
      ['assignment', '2026-10-28T03:59:00.000Z'],
      ['exam', '2026-11-02T14:00:00.000Z'],
      ['quiz', '2026-11-05T15:00:00.000Z'],
    ]);
  });

  it('keeps one student calendar items private to that student', () => {
    const db = openMemoryDb();
    importIcsDue(
      db,
      's_ana',
      'demo',
      'BEGIN:VEVENT\nDTSTART:20261027T150000Z\nSUMMARY:Ana private therapy exam retake\nEND:VEVENT\nBEGIN:VEVENT\nDTSTART:20261027T160000Z\nSUMMARY:lunch\nEND:VEVENT',
    );
    const src = createDueSource(db);
    const day = [NOW, NOW + 3 * 86_400_000] as const;
    expect(src.dueBetween('s_ana', ...day)).toHaveLength(1);
    expect(src.dueBetween('s_ben', ...day)).toHaveLength(0);
  });
});

describe('compose', () => {
  it('review text matches the spec wording', () => {
    expect(composeReview(['a', 'b', 'c'])).toBe(
      '3 chapters are due for review (a, b, c): want a 5-minute quiz?',
    );
    expect(composeReview(['a'])).toMatch(/^1 chapter is due/);
  });
  it('nightly lists items with local times', () => {
    const t = composeNightly(
      [
        {
          id: '1',
          courseId: 'c',
          student: null,
          title: 'HW 3',
          dueAt: Date.UTC(2026, 9, 28, 3, 59),
          kind: 'assignment',
          source: 'syllabus',
        },
      ],
      NY,
    );
    expect(t).toMatch(/HW 3 \(11:59 PM\)/);
  });
});

describe('controls', () => {
  it('parses snooze durations and time zones', () => {
    expect(parseSnooze('snooze 2h', NOW, 'UTC')).toBe(NOW + 2 * 3_600_000);
    expect(parseSnooze('snooze 30 min', NOW, 'UTC')).toBe(NOW + 30 * 60_000);
    expect(parseSnooze('snooze until tomorrow', NOW, 'UTC')).toBe(Date.UTC(2026, 9, 27, 8));
    expect(parseSnooze('snooze', NOW, 'UTC')).toBeUndefined();
    expect(parseTz('my timezone is PT')).toBe('America/Los_Angeles');
    expect(parseTz('my timezone is Mars/Base')).toBeUndefined();
  });
  it('is anchored: only addressed commands match, banter scores 0', async () => {
    const api = createFakeProactive(NOW);
    const s = createNudgeControlSkill({ api });
    const m = (text: string, mentionsBot: boolean) => ({
      chatId: 'group:t',
      isGroup: true,
      from: 's_ana',
      text,
      attachments: [],
      mentionsBot,
      ts: 1,
    });
    expect(await s.match(m('snooze 2h', false), {} as never)).toBe(0);
    expect(await s.match(m('lol stop nudging me haha', false), {} as never)).toBe(0);
    expect(await s.match(m('snooze 2h', true), {} as never)).toBeGreaterThan(0.8);
    expect(classify('stop nudges')).toBe('stop');
    expect(classify('hello')).toBeUndefined();
  });
});
