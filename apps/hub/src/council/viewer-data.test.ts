import { describe, expect, it } from 'vitest';
import {
  askRoster,
  createMasteryStore,
  hashExternalAccount,
  normalizeItem,
  type MasteryStore,
} from '@squad/brain';
import type { SourceKind } from '@squad/core';
import { createHub } from '../app';
import { contextServiceFor } from '../context/service';
import { createCouncilViewerData, parseRange, wordOf } from './viewer-data';

const T0 = Date.UTC(2026, 10, 2, 8); // Monday 08:00 UTC
const H = 3_600_000;
const SENTINELS = ['$180', 'therapy', 'Therapy'];

function setup() {
  const h = createHub({ config: { seed: true, sim: false, authSecret: 'x', logLevel: 'silent' } });
  h.deps.now = () => T0;
  const store = contextServiceFor(h.deps).store;
  const event = (owner: string, id: string, title: string, startH: number, lenH: number) => {
    if (!store.connection(`c_${owner}`))
      store.upsertConnection({
        id: `c_${owner}`,
        ownerId: owner,
        provider: 'google',
        mode: 'fixture',
        variant: 'session',
        accountHash: hashExternalAccount('p', 'google', owner),
        scopes: [],
        status: 'live',
        degraded: false,
        statusNote: null,
        createdAt: T0,
        lastSyncAt: null,
        expiresAt: null,
      });
    const kind: SourceKind = 'gcal_event';
    const { source, pieces } = normalizeItem(
      { ownerId: owner, connectionId: `c_${owner}`, provider: 'google', mode: 'fixture', now: T0 },
      {
        externalId: id,
        kind,
        title,
        courseId: null,
        url: null,
        modifiedAt: null,
        startsAt: T0 + startH * H,
        endsAt: T0 + (startH + lenH) * H,
      },
      { text: `${title} body` },
    );
    store.upsertSource(source, pieces);
  };
  const mastery = createMasteryStore({ db: h.deps.db, emit: () => {} });
  const viewer = (m?: MasteryStore) =>
    createCouncilViewerData(h.deps, {
      courseId: () => 'demo',
      ...(m ? { mastery: m } : {}),
      chapters: () => [
        { id: 'ch1', title: 'Chapter 1' },
        { id: 'ch2', title: 'Chapter 2' },
      ],
    });
  return { h, event, mastery, viewer };
}

describe('council viewer data: calendar_summary', () => {
  it('returns derived busy/free numbers, never titles, and hands titles back as needles', async () => {
    const { event, viewer } = setup();
    event('s_ana', 'e1', 'Therapy session', 2, 2);
    event('s_ana', 'e2', 'Deposit $180 for flat', 26, 1);
    const data = viewer()('s_ana', 'squad')!;
    const { text } = (await data.calendarSummary!('this week')) as { text: string };
    expect(text).toMatch(/Next 7 days: about 3 busy hours and 95 free hours/);
    expect(text).toMatch(/Busiest days: (Mon|Tue)/);
    for (const s of SENTINELS) expect(text).not.toContain(s);
    expect(data.needles).toEqual(
      expect.arrayContaining(['Therapy session', 'Deposit $180 for flat']),
    );
  });

  it('says so when no calendar is connected, and never reads another student', async () => {
    const { event, viewer } = setup();
    event('s_ben', 'b1', 'SECRET-BEN-EVENT', 1, 5);
    const ana = viewer()('s_ana', 'squad')!;
    const { text } = (await ana.calendarSummary!('this week')) as { text: string };
    expect(text).toMatch(/No calendar is connected/);
    expect(text).not.toContain('SECRET');
    expect(ana.needles).toBeUndefined();
  });

  it('squad aggregate only when 3+ squadmates have calendars; no names, titles or per-person numbers', async () => {
    const { event, viewer } = setup();
    event('s_ana', 'a1', 'ana thing', 1, 1);
    event('s_ben', 'b1', 'SECRET-BEN', 1, 3);
    event('s_chi', 'c1', 'SECRET-CHI', 1, 3);
    const two = viewer()('s_ana', 'squad')!;
    const t2 = ((await two.calendarSummary!('this week')) as { text: string }).text;
    expect(t2).not.toContain('Squad average');
    event('s_dev', 'd1', 'SECRET-DEV', 1, 3);
    const three = viewer()('s_ana', 'squad')!;
    const t3 = ((await three.calendarSummary!('this week')) as { text: string }).text;
    expect(t3).toMatch(/Squad average: about 0\.4 busy hours a day/);
    expect(t3).not.toMatch(/SECRET|ben|chi|dev/i);
    // a private (DM) run never carries the squad aggregate
    const dm = viewer()('s_ana', 'private')!;
    expect(((await dm.calendarSummary!('this week')) as { text: string }).text).not.toContain(
      'Squad average',
    );
  });

  it('parses ranges', () => {
    expect(parseRange('today', T0).days).toBe(1);
    expect(parseRange('next 3 days', T0).days).toBe(3);
    expect(parseRange('whatever', T0).days).toBe(7);
  });
});

describe('council viewer data: mastery_summary', () => {
  it('own words and pips per chapter; squad average only with 3+ members', async () => {
    const { mastery, viewer } = setup();
    for (let i = 0; i < 2; i++) await mastery.record('s_ana', 'demo', 'ch1', true);
    await mastery.record('s_ben', 'demo', 'ch2', true);
    const data = viewer(mastery)('s_ana', 'squad')!;
    const { text } = (await data.masterySummary!()) as { text: string };
    expect(text).toContain('Chapter 1: Getting there (3 of 5 pips)');
    expect(text).toContain('squad average'); // 4 seeded members
    // other student's private rows never appear by name or as their own line
    expect(text).not.toContain('Chapter 2');
    expect(text).not.toMatch(/s_ben|Ben/);
    const dm = viewer(mastery)('s_ana', 'private')!;
    expect(((await dm.masterySummary!()) as { text: string }).text).not.toContain('squad average');
  });

  it('is absent without a mastery store (so the tool is not offered)', () => {
    const { viewer } = setup();
    expect(viewer()('s_ana', 'squad')!.masterySummary).toBeUndefined();
  });

  it('words match the village words', () => {
    expect(wordOf(0)).toBe('Not started');
    expect(wordOf(2)).toBe('Learning');
    expect(wordOf(3)).toBe('Getting there');
    expect(wordOf(5)).toBe('Solid');
  });
});

describe('tools are offered only when a port exists', () => {
  it('Ask roster exposes the tools exactly for the ports the hub supplies', () => {
    const { viewer, mastery } = setup();
    const toolsOf = (v: ReturnType<ReturnType<typeof viewer>> | undefined) =>
      new Set(
        askRoster({ calendar: !!v?.calendarSummary, mastery: !!v?.masterySummary }).flatMap(
          (s) => s.tools,
        ),
      );
    const none = toolsOf(undefined);
    expect(none.has('calendar_summary')).toBe(false);
    expect(none.has('mastery_summary')).toBe(false);
    const calOnly = toolsOf(viewer()('s_ana', 'squad'));
    expect(calOnly.has('calendar_summary')).toBe(true);
    expect(calOnly.has('mastery_summary')).toBe(false);
    const both = toolsOf(viewer(mastery)('s_ana', 'squad'));
    expect(both.has('calendar_summary') && both.has('mastery_summary')).toBe(true);
  });
});
