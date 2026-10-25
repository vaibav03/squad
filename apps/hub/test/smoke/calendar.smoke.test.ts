import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeLlm } from '@squad/core';
import { busyBlocksOf, createRealPorts } from '../../src/adapters/real';
import type { RunningHub } from '../../src/server';
import { boot, login } from '../helpers';

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'DTSTART:20261110T160000Z',
  'DTEND:20261110T170000Z',
  'SUMMARY:Stats lecture',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20261111T180000Z',
  'SUMMARY:Office hours',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

let hub: RunningHub;
const pushes: { url: string; secret: string | null; body: { events: unknown[] } }[] = [];

beforeAll(async () => {
  hub = await boot();
  const fakeFetch = (async (url: string, init: RequestInit) => {
    pushes.push({
      url,
      secret: new Headers(init.headers).get('X-Nook-Internal'),
      body: JSON.parse(String(init.body)) as { events: unknown[] },
    });
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  const real = await createRealPorts(hub.deps, {
    llm: new FakeLlm(),
    agentUrls: { s_ana: 'http://agent-ana.test' },
    fetch: fakeFetch,
  });
  hub.deps.ports = real.ports;
});
afterAll(async () => {
  await hub.stop();
});

describe('calendar import in the real brain port', () => {
  it('stores parsed busy blocks, replaces them on re-import, and pushes them to the owner agent', async () => {
    const token = await login(hub.url, 's_ana');
    const form = new FormData();
    form.set('file', new File([ICS], 'cal.ics', { type: 'text/calendar' }));
    const res = await fetch(`${hub.url}/v1/squad/calendar`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ busyBlocks: 2 });
    const rows = busyBlocksOf(hub.deps, 's_ana');
    // privacy: event titles are never stored
    expect(rows.map((r) => r.title)).toEqual(['busy', 'busy']);
    expect(JSON.stringify(rows) + JSON.stringify(pushes)).not.toMatch(/Stats lecture|Office hours/);
    expect(rows[1]).toMatchObject({ start: '2026-11-11T18:00:00Z', end: '2026-11-11T19:00:00Z' });
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ url: 'http://agent-ana.test/internal/calendar' });
    expect(pushes[0]!.secret).toBe(hub.deps.config.internalSecret);
    expect(pushes[0]!.body.events).toHaveLength(2);
    // data export carries no titles either
    const exp = await fetch(`${hub.url}/v1/me/export`, { headers: { authorization: `Bearer ${token}` } });
    if (exp.status === 200) expect(await exp.text()).not.toMatch(/Stats lecture|Office hours/);
    // other students are untouched
    expect(busyBlocksOf(hub.deps, 's_ben')).toEqual([]);
    // demo calendar replaces, never appends
    const demo = await hub.deps.ports.brain.loadCalendar('s_ana', { demo: true });
    expect(demo.busyBlocks).toBe(12);
    expect(busyBlocksOf(hub.deps, 's_ana')).toHaveLength(12);
  });
});

describe('busy-title migration', () => {
  it('blanks titles stored by older versions and is idempotent', async () => {
    hub.deps.db
      .prepare('INSERT OR REPLACE INTO hub_busy_blocks(student,start,end,title) VALUES(?,?,?,?)')
      .run('s_old', '2026-11-01T10:00:00Z', '2026-11-01T11:00:00Z', 'Therapy');
    const { ensureHubSchema } = await import('../../src/store/schema');
    ensureHubSchema(hub.deps.db);
    ensureHubSchema(hub.deps.db);
    expect(busyBlocksOf(hub.deps, 's_old').map((r) => r.title)).toEqual(['busy']);
  });
});
