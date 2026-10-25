import { describe, expect, it } from 'vitest';
import { dueReply, dueWindow } from './answers-rich';
import { createContextStore } from './store';
import { hashExternalAccount } from './ids';
import { normalizeItem } from './normalize';
import { openMemoryDb } from '@squad/core/node';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 25, 15, 0); // Sun Oct 25 2026 15:00 UTC

function fixture() {
  const store = createContextStore(openMemoryDb());
  store.upsertConnection({
    id: 'c1', ownerId: 's_ana', provider: 'canvas', mode: 'fixture', variant: 'feed',
    accountHash: hashExternalAccount('p', 'canvas', 'a'), scopes: [], status: 'live', degraded: false,
    statusNote: null, createdAt: NOW, lastSyncAt: null, expiresAt: null,
  });
  const add = (id: string, title: string, dueAt: number, course = 'HIST 140: World History') => {
    const { source, pieces } = normalizeItem(
      { ownerId: 's_ana', connectionId: 'c1', provider: 'canvas', mode: 'fixture', now: NOW },
      { externalId: id, kind: 'canvas_assignment', title, courseId: 'k1', url: null, modifiedAt: null, dueAt },
      { text: `Course: ${course}\n${title} details.` },
    );
    store.upsertSource(source, pieces);
    return store.source(source.id)!;
  };
  return { store, add };
}

describe('due windows', () => {
  it('parses the window words', () => {
    expect(dueWindow('what is due this week?', NOW).kind).toBe('week');
    expect(dueWindow('anything due today', NOW).to).toBe(Date.UTC(2026, 9, 26));
    expect(dueWindow('due tomorrow?', NOW)).toMatchObject({ kind: 'tomorrow', from: Date.UTC(2026, 9, 26) });
    expect(dueWindow('due next week', NOW).from).toBe(NOW + 7 * DAY);
    expect(dueWindow('what is due after this week?', NOW).kind).toBe('after');
    expect(dueWindow('what is due', NOW).kind).toBe('all');
  });
  it('end of day follows the viewer zone', () => {
    // 15:00 UTC is 08:00 in Los Angeles (UTC-7): the local day ends at 07:00 UTC next day
    expect(dueWindow('today', NOW, 'America/Los_Angeles').to).toBe(Date.UTC(2026, 9, 26, 7));
  });
  it('this week lists only items in the next 7 days, with course and exact date; later items are neither listed nor cited', () => {
    const { store, add } = fixture();
    const soon = add('a1', 'Reading response 2', NOW + 3 * DAY + 8 * 3_600_000);
    const later = add('a2', 'Midterm essay', NOW + 10 * DAY);
    const r = dueReply(store, [soon, later], NOW, new Map(), 'what is due from Canvas this week? Include course names and exact due dates.')!;
    expect(r.text).toContain('Reading response 2 (HIST 140: World History)');
    expect(r.text).toMatch(/due Wednesday, Oct 28, 11:00 PM UTC/);
    expect(r.text).not.toContain('Midterm');
    expect(r.citations).toHaveLength(1);
    expect(r.citations[0]!.source).toMatchObject({ courseName: 'HIST 140: World History', provenance: 'fixture' });
    expect(r.citations[0]!.label).toMatch(/Oct 28, 11:00 PM/);
  });
  it('an empty window says so plainly and offers the next step with the next item', () => {
    const { store, add } = fixture();
    const later = add('a2', 'Midterm essay', NOW + 10 * DAY);
    const r = dueReply(store, [later], NOW, new Map(), 'what is due this week?')!;
    expect(r.text).toMatch(/^Nothing due this week/);
    expect(r.text).toContain('Midterm essay (HIST 140: World History)');
    expect(r.text).toContain('what is due after this week');
    // the follow-up lists the later item
    const after = dueReply(store, [later], NOW, new Map(), 'what is due after this week?')!;
    expect(after.text).toContain('Midterm essay');
  });
  it('without a window word the behaviour is unchanged: next items soonest first', () => {
    const { store, add } = fixture();
    const a = add('a1', 'Soon', NOW + DAY);
    const b = add('a2', 'Far', NOW + 20 * DAY);
    const r = dueReply(store, [b, a], NOW, new Map(), 'what is due')!;
    expect(r.text.indexOf('Soon')).toBeLessThan(r.text.indexOf('Far'));
  });
});
