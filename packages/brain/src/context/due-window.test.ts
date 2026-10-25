import { describe, expect, it } from 'vitest';
import { dueReply, dueWindow } from './answers-rich';
import type { ContextStore } from './store';
import type { ContextSource } from './types';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-25T15:00:00Z');
const store = { chunks: () => [] } as unknown as ContextStore;
const asg = (id: string, title: string, inDays: number, code: string, name: string): ContextSource =>
  ({
    id,
    kind: 'canvas_assignment',
    title,
    courseId: `c_${code}`,
    courseCode: code,
    courseName: name,
    dueAt: NOW + inDays * DAY,
    provenance: 'canvas:fixture',
  }) as unknown as ContextSource;

const SOURCES = [
  asg('a', 'Essay 2', 2, 'HIST 140', 'Modern World History'),
  asg('b', 'Problem set 4', 5, 'STAT 101', 'Intro Statistics'),
  asg('c', 'Midterm project', 10, 'CS 201', 'Data Structures'),
  asg('d', 'Reading response', 12, 'HIST 140', 'Modern World History'),
];
const Q = '@cubbie what is due from Canvas this week? Include course names and exact due dates.';

describe('due-this-week answer', () => {
  it('parses the window words', () => {
    expect(dueWindow(Q, NOW)?.to).toBe(NOW + 7 * DAY);
    expect(dueWindow('what is due tomorrow', NOW)?.to).toBe(NOW + 2 * DAY);
    expect(dueWindow('what is due', NOW)).toBeNull();
  });

  it('lists only this week, with course code, name, title and exact date', () => {
    const r = dueReply(store, SOURCES, NOW, new Map(), Q)!;
    const [head, later] = r.text.split('\n\nNext after this week:\n');
    expect(head).toContain('Due this week (2):');
    expect(head).toContain('- HIST 140: Modern World History: Essay 2: Tue, Oct 27');
    expect(head).toContain('- STAT 101: Intro Statistics: Problem set 4:');
    expect(head).not.toContain('Midterm project');
    expect(later).toContain('CS 201: Data Structures: Midterm project');
    expect(later).toContain('Reading response');
    expect(r.citations).toHaveLength(4);
  });

  it('says so plainly when nothing is due in the window', () => {
    const r = dueReply(store, SOURCES.slice(2), NOW, new Map(), Q)!;
    expect(r.text).toContain('Nothing is due this week.');
    expect(r.text).toContain('Next after this week:');
  });

  it('without window words keeps the legacy next-5 list', () => {
    expect(dueReply(store, SOURCES, NOW)!.text).toContain('Next 4 due:');
  });
});
