// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { fetchOnboarding, recordSkip, skipKey, type OnboardingState } from './api';
import { gateView } from './gate';
import {
  sharePlan,
  groupRows,
  categoryCounts,
  CATEGORIES,
  CATEGORY_LABEL,
  stepLabel,
  type ShareCategory,
} from './model';
import { ContextBanner, ContextGate } from '../chat/ContextGate';

const ctx = { hubUrl: 'http://hub', token: 't', userId: 'u1' };
const conn = (mode: 'fixture' | 'live') => ({
  id: 'c1',
  provider: 'canvas',
  mode,
  status: 'live',
  scopes: [],
  lastSyncAt: 1,
  sources: { total: 1, byKind: {} },
  sharedWithSquads: [],
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function route(map: Record<string, () => Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const k = `${init?.method ?? 'GET'} ${new URL(url).pathname}`;
      const h = map[k];
      if (!h) return json({}, 404);
      return h();
    }),
  );
}
const mem = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  } as unknown as Storage;
};
beforeEach(() => vi.stubGlobal('localStorage', mem()));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('onboarding adapter', () => {
  it('uses the server state when GET /v1/onboarding exists', async () => {
    route({ 'GET /v1/onboarding': () => json({ connected: false, skipped: true, skippedAt: 5 }) });
    expect(await fetchOnboarding(ctx)).toEqual({
      connected: false,
      skipped: true,
      skippedAt: 5,
      source: 'server',
    });
  });
  it('falls back on 404: connected from /v1/connections, skip from localStorage', async () => {
    route({ 'GET /v1/connections': () => json({ connections: [conn('fixture')] }) });
    localStorage.setItem(skipKey('u1'), '123');
    const s = await fetchOnboarding(ctx);
    expect(s).toMatchObject({ connected: true, skipped: true, skippedAt: 123, source: 'fallback' });
    expect((await fetchOnboarding({ ...ctx, userId: 'other' })).skipped).toBe(false);
  });
  it('falls back on network error and reports unknown when nothing is reachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('down'))),
    );
    const s = await fetchOnboarding(ctx);
    expect(s.connected).toBeNull();
    expect(s.source).toBe('fallback');
  });
  it('records the skip on the server, else locally', async () => {
    route({
      'POST /v1/onboarding/skip': () => json({ skippedAt: 9 }),
      'GET /v1/connections': () => json({ connections: [] }),
    });
    expect(await recordSkip(ctx)).toMatchObject({ skipped: true, skippedAt: 9, source: 'server' });
    expect(localStorage.getItem(skipKey('u1'))).toBeNull();
    route({ 'GET /v1/connections': () => json({ connections: [] }) });
    expect(await recordSkip(ctx)).toMatchObject({ skipped: true, source: 'fallback' });
    expect(localStorage.getItem(skipKey('u1'))).not.toBeNull();
  });
});

describe('gate decision', () => {
  const st = (o: Partial<OnboardingState>): OnboardingState => ({
    connected: false,
    skipped: false,
    skippedAt: null,
    source: 'server',
    ...o,
  });
  it('covers every state', () => {
    expect(gateView(null)).toBe('loading');
    expect(gateView(st({}))).toBe('gate');
    expect(gateView(st({ skipped: true }))).toBe('banner');
    expect(gateView(st({ connected: true }))).toBe('open');
    expect(gateView(st({ connected: true, skipped: true }))).toBe('open');
    expect(gateView(st({ connected: null }))).toBe('open');
  });
});

describe('tour model', () => {
  it('labels steps and builds a share plan that defaults to nothing', () => {
    expect(stepLabel('connect')).toBe('Step 2 of 4');
    expect(stepLabel('share')).toBe('Step 4 of 4');
    const row = (id: string, kind: string) => ({
      id,
      kind,
      title: id,
      sharedWith: [],
      courseId: null,
      dueAt: null,
      startsAt: null,
      fetchedAt: null,
      provenance: 'fixture' as const,
    });
    const g = groupRows([
      { connectionId: 'c1', rows: [row('a', 'canvas_assignment'), row('e', 'gcal_event')] },
    ]);
    const none = Object.fromEntries(CATEGORIES.map((k) => [k, false])) as Record<
      ShareCategory,
      boolean
    >;
    expect(sharePlan(g, none)).toEqual({});
    expect(sharePlan(g, { ...none, calendar: true })).toEqual({ c1: ['e'] });
  });
});

describe('gate and banner UI', () => {
  it('gate: primary connect, skip asks first, then skips', async () => {
    const onSkip = vi.fn(async () => {});
    render(
      <MemoryRouter>
        <ContextGate onSkip={onSkip} />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', {
        name: 'Connect your learning context so Nook can answer from your real courses',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /Connect Canvas \+ Google/ }).getAttribute('href'),
    ).toBe('/squad/welcome-tour/connect');
    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(screen.getByTestId('gate-skip-explain').textContent).toContain('limited context');
    await userEvent.click(screen.getByRole('button', { name: 'Go back' }));
    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    await userEvent.click(screen.getByRole('button', { name: 'Skip anyway' }));
    await waitFor(() => expect(onSkip).toHaveBeenCalledTimes(1));
  });
  it('banner: quiet text with a Connect action to the tour', () => {
    render(
      <MemoryRouter>
        <ContextBanner />
      </MemoryRouter>,
    );
    expect(screen.getByText('Limited context: connect Canvas or Google')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Connect' }).getAttribute('href')).toBe(
      '/squad/welcome-tour/connect',
    );
  });
});

import { parseOnboarding } from './api';
describe('GET /v1/onboarding shape', () => {
  it('maps identityDone, integrations, sharingChosen, skipped object, nextStep', () => {
    const r = parseOnboarding({
      identityDone: true,
      sharingChosen: false,
      nextStep: 'connect',
      skipped: { at: 5 },
      integrations: {
        canvas: { state: 'demo', sub: null, counts: {}, lastSyncAt: 1, demo: true },
        google: {
          state: 'not_connected',
          sub: 'disconnected',
          counts: {},
          lastSyncAt: null,
          demo: false,
        },
      },
    });
    expect(r).toMatchObject({
      connected: true,
      skipped: true,
      skippedAt: 5,
      identityDone: true,
      sharingChosen: false,
      nextStep: 'connect',
    });
    expect(
      parseOnboarding({ integrations: { canvas: { state: 'not_connected' } }, skipped: null }),
    ).toMatchObject({ connected: false, skipped: false });
  });
});

describe('category counts: Canvas demo + Google demo (regression: Courses 3, Drive 2)', () => {
  const mk = (id: string, provider: 'canvas' | 'google', counts: Record<string, number>) =>
    ({
      id,
      provider,
      mode: 'fixture',
      state: 'fixture',
      counts,
      sources: { total: 0, byKind: {} },
    }) as never;
  const canvas = mk('c1', 'canvas', {
    courses: 3,
    modules: 6,
    assignments: 6,
    pages: 6,
    files: 3,
    announcements: 3,
    calendarEvents: 3,
    driveDocs: 0,
    classroomItems: 0,
  });
  const google = mk('g1', 'google', {
    courses: 1,
    modules: 0,
    assignments: 0,
    pages: 0,
    files: 0,
    announcements: 0,
    calendarEvents: 2,
    driveDocs: 2,
    classroomItems: 2,
  });
  it('counts Canvas courses under Courses and Drive only from Google Drive', () => {
    expect(categoryCounts([canvas, google])).toEqual({
      courses: 3,
      assignments: 8,
      calendar: 5,
      drive: 2,
    });
  });
  it('maps Canvas files, modules, pages and announcements to Courses, never Drive (rows without hub category)', () => {
    const row = (id: string, kind: string, category?: string) => ({
      id,
      kind,
      category: category ?? null,
      title: id,
      sharedWith: [],
      courseId: 'c',
      dueAt: null,
      startsAt: null,
      fetchedAt: null,
      provenance: 'fixture' as const,
    });
    const rows = [
      row('m', 'canvas_file'),
      row('p', 'canvas_file', 'courses'),
      row('a', 'canvas_assignment'),
      row('e', 'canvas_event', 'calendar'),
      row('d', 'gdoc'),
    ];
    const g = groupRows([{ connectionId: 'c1', rows }]);
    expect(g.courses.map((x) => x.row.id)).toEqual(['m', 'p']);
    expect(g.drive.map((x) => x.row.id)).toEqual(['d']);
    // fallback to rows when a connection has no counts
    const bare = {
      id: 'c1',
      provider: 'canvas',
      state: 'fixture',
      sources: { total: 5, byKind: {} },
    } as never;
    expect(categoryCounts([bare], [{ connectionId: 'c1', rows }])).toEqual({
      courses: 2,
      assignments: 1,
      calendar: 1,
      drive: 1,
    });
  });
  it('review summary and Share step print the same numbers from the same function', () => {
    const counts = categoryCounts([canvas, google]);
    const line = CATEGORIES.map((k) => `${CATEGORY_LABEL[k]}: ${counts[k]}`).join(' · ');
    expect(line).toBe('Courses: 3 · Assignments: 8 · Calendar free/busy: 5 · Drive documents: 2');
  });
});
