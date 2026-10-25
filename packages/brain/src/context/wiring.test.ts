import { describe, expect, it } from 'vitest';
import { FakeLlm, sourceUri, type SourceKind } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { assembleBrain } from '../experts/brain';
import { makeKit } from '../experts/testkit';
import { NOT_IN_MATERIALS } from '../experts/types';
import { canvasAnswer, NOT_SYNCED } from './answers';
import { deriveTripConstraints } from './constraints';
import { hashExternalAccount } from './ids';
import { normalizeItem } from './normalize';
import { createRetrieveContext } from './retrieve';
import { deriveStudySeeds } from './study-seeds';
import { createContextStore } from './store';
import type { ContextConnection } from './types';

const T0 = Date.UTC(2026, 10, 2, 12);
const DAY = 86_400_000;

function setup(db = openMemoryDb()) {
  const store = createContextStore(db);
  const conn = (owner: string): ContextConnection => ({
    id: `conn_${owner}`,
    ownerId: owner,
    provider: 'canvas',
    mode: 'fixture',
    variant: 'session',
    accountHash: hashExternalAccount('pepper', 'canvas', owner),
    scopes: [],
    status: 'live',
    degraded: false,
    statusNote: null,
    createdAt: T0,
    lastSyncAt: null,
    expiresAt: null,
  });
  const add = (
    owner: string,
    kind: SourceKind,
    externalId: string,
    title: string,
    extra: { dueAt?: number; startsAt?: number; endsAt?: number; text?: string; url?: string; courseId?: string; modifiedAt?: number } = {},
  ) => {
    if (!store.connection(`conn_${owner}`)) store.upsertConnection(conn(owner));
    const { source, pieces } = normalizeItem(
      { ownerId: owner, connectionId: `conn_${owner}`, provider: 'canvas', mode: 'fixture', now: T0 },
      {
        externalId,
        kind,
        title,
        courseId: extra.courseId ?? 'c1',
        url: extra.url ?? null,
        modifiedAt: extra.modifiedAt ?? null,
        dueAt: extra.dueAt ?? null,
        startsAt: extra.startsAt ?? null,
        endsAt: extra.endsAt ?? null,
      },
      { text: extra.text ?? 'Body text for the item with enough words.' },
    );
    store.upsertSource(source, pieces);
    return source;
  };
  return { store, add };
}

const ana = { studentId: 's_ana', squadIds: ['sq1'] };
const ben = { studentId: 's_ben', squadIds: ['sq1'] };

describe('canvasAnswer (Nook canvas-answers port)', () => {
  it('lists due items with the (past) marker and honest empties', () => {
    const { store, add } = setup();
    expect(canvasAnswer('what is due?', [], T0)).toBe(NOT_SYNCED);
    expect(canvasAnswer('hello there', [], T0)).toBeNull();
    add('s_ana', 'canvas_file', 'f1', 'Old notes.docx');
    expect(canvasAnswer('what is due?', ownList(store), T0)).toBe("Nothing due. You're all caught up.");
    add('s_ana', 'canvas_assignment', 'a1', 'HW 1', { dueAt: T0 - 3 * 3_600_000 });
    add('s_ana', 'canvas_assignment', 'a2', 'HW 2', { dueAt: T0 + DAY });
    add('s_ana', 'canvas_assignment', 'a0', 'Ancient', { dueAt: T0 - 5 * DAY });
    const out = canvasAnswer('what are my deadlines', ownList(store), T0, new Map([['c1', 'STAT 101']]))!;
    expect(out).toContain('Next 2 due:');
    expect(out).toContain('HW 1 (STAT 101): Mon, Nov 2 9:00 AM UTC (past)');
    expect(out).toContain('HW 2 (STAT 101)');
    expect(out).not.toContain('Ancient');
    expect(out.indexOf('HW 1')).toBeLessThan(out.indexOf('HW 2'));
  });
  it('lists slides and pdfs, latest first, with links, and honest empties', () => {
    const { store, add } = setup();
    add('s_ana', 'canvas_assignment', 'a1', 'HW 1', { dueAt: T0 + DAY });
    expect(canvasAnswer('send me the slides', ownList(store), T0)).toBe('No slides found in your synced Canvas files.');
    expect(canvasAnswer('any files?', ownList(store), T0)).toBe('No files found in your synced Canvas.');
    add('s_ana', 'canvas_file', 'f1', 'Week1.pptx', { modifiedAt: 1, url: 'https://c.example/f1', text: 'week one intro slides' });
    add('s_ana', 'canvas_file', 'f2', 'Week2.pptx', { modifiedAt: 2, text: 'week two inference slides' });
    add('s_ana', 'canvas_file', 'f3', 'Syllabus.pdf', { modifiedAt: 3, text: 'syllabus grading policy text' });
    const slides = canvasAnswer('send me the slides', ownList(store), T0)!;
    expect(slides.startsWith('2 files:')).toBe(true);
    expect(slides.indexOf('Week2')).toBeLessThan(slides.indexOf('Week1'));
    expect(slides).toContain('https://c.example/f1');
    expect(canvasAnswer('the pdf please', ownList(store), T0)).toContain('Syllabus.pdf');
    expect(canvasAnswer('No PDFs here', [], T0)).toBe(NOT_SYNCED);
  });
  it('never sees another student private sources', () => {
    const { store, add } = setup();
    add('s_ben', 'canvas_assignment', 'b1', 'Ben secret essay', { dueAt: T0 + DAY });
    expect(canvasAnswer('what is due', ownList(store, 's_ana'), T0)).toBe(NOT_SYNCED);
  });
});

import { ownSources } from './readable';
function ownList(store: ReturnType<typeof createContextStore>, who = 's_ana') {
  return ownSources(store, { studentId: who, squadIds: ['sq1'] });
}

describe('trip constraints', () => {
  it('returns busy intervals without titles and withholds unshared due titles', () => {
    const { store, add } = setup();
    add('s_ana', 'gcal_event', 'e1', 'Therapy session', { startsAt: T0 + DAY, endsAt: T0 + DAY + 3_600_000 });
    add('s_ana', 'gcal_event', 'e2', 'Outside window', { startsAt: T0 + 90 * DAY });
    const hw = add('s_ana', 'canvas_assignment', 'a1', 'Secret HW', { dueAt: T0 + 2 * DAY });
    add('s_ben', 'canvas_event', 'e3', 'Ben shift', { startsAt: T0 + 3 * DAY });
    const win = { from: T0, to: T0 + 30 * DAY };
    const r1 = deriveTripConstraints(store, ['s_ana', 's_ben'], win, { squadId: 'sq1' });
    expect(r1[0]!.busy).toEqual([{ start: '2026-11-03T12:00:00Z', end: '2026-11-03T13:00:00Z' }]);
    expect(r1[0]!.due).toEqual([{ courseId: 'c1', dueAt: '2026-11-04T12:00:00Z', title: null }]);
    expect(r1[1]!.busy).toHaveLength(1);
    expect(JSON.stringify(r1)).not.toMatch(/Therapy|Secret HW|Ben shift/);
    store.share(hw.id, 'sq1');
    const r2 = deriveTripConstraints(store, ['s_ana'], win, { squadId: 'sq1' });
    expect(r2[0]!.due[0]!.title).toBe('Secret HW');
    expect(JSON.stringify(r2)).not.toContain('Therapy');
  });
});

describe('study seeds', () => {
  it('seeds due items and lecture topics from own sources only', () => {
    const { store, add } = setup();
    add('s_ana', 'canvas_assignment', 'a1', 'Problem Set 4', { dueAt: T0 + 5 * DAY });
    add('s_ana', 'canvas_assignment', 'a-old', 'Past PS', { dueAt: T0 - DAY });
    add('s_ana', 'canvas_file', 'f1', 'Lecture 7 Sampling.pdf', { text: '# Sampling\n\nThe mean of samples varies.' });
    add('s_ben', 'canvas_assignment', 'b1', 'Ben private', { dueAt: T0 + DAY });
    const seeds = deriveStudySeeds(store, ana, T0);
    expect(seeds.map((s) => [s.kind, s.title])).toEqual(
      expect.arrayContaining([
        ['due', 'Problem Set 4'],
        ['lecture', 'Sampling'],
      ]),
    );
    expect(seeds.find((s) => s.title === 'Past PS')).toBeUndefined();
    expect(JSON.stringify(seeds)).not.toContain('Ben private');
    expect(seeds[0]!.kind).toBe('due');
    expect(seeds.find((s) => s.kind === 'due')!.sourceUri).toMatch(/^source:\/\/canvas_assignment\//);
  });
});

describe('Brain.ask and retrieve across courses', () => {
  it('contextCourseId: null cites a Canvas source from another course id, and never a classmate private one', async () => {
    const k = await makeKit(new FakeLlm());
    const { store, add } = setup(k.db);
    const s = add('s_ana', 'canvas_assignment', 'a1', 'Assignment 3', {
      courseId: 'canvas-77',
      text: 'Late work loses 10 percent per day.',
    });
    const anchor = store.chunks(s.id)[0]!.anchor;
    const llm = new FakeLlm({
      fallback: {
        claims: [
          {
            text: 'Late work loses ten percent per day.',
            source: sourceUri({ kind: 'canvas_assignment', id: s.id, anchor }),
            quote: 'Late work loses 10 percent per day',
          },
        ],
      },
    });
    const brain = assembleBrain({ llm, db: k.db, store: k.store, emit: k.emit, context: store });
    const q = 'what is the late penalty for assignment 3';
    const own = await brain.ask('stat-101', q, { viewer: ana, contextCourseId: null });
    expect(own.grounded).toBe(true);
    expect(own.citations[0]!.source).toMatchObject({ kind: 'canvas_assignment', id: s.id });
    const other = await brain.ask('stat-101', q, { viewer: ben, contextCourseId: null });
    expect(other.text).toBe(NOT_IN_MATERIALS);
    // retrieve tool is viewer-bound
    expect(await createRetrieveContext(store, ben)('late penalty assignment')).toEqual([]);
    expect((await createRetrieveContext(store, ana)('late penalty assignment')).length).toBe(1);
  });
});
