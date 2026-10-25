import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FakeLlm, findLeak } from '@squad/core';
import { demoProfiles, RecordingEmitter } from '@squad/mesh';
import { createAgentApp } from './server';
import { scriptedConfirm, webConfirm } from './confirm';
import { parseIcs } from './ics';
import { parseProfile } from './profile';

const profile = demoProfiles()[0]!;
const mk = () => {
  const emitter = new RecordingEmitter();
  return createAgentApp({
    profile,
    net: {
      send: async () => {
        throw new Error('offline');
      },
    },
    emitter,
    askConfirm: scriptedConfirm({ emitter }),
    llm: new FakeLlm(),
    url: 'http://localhost:4101',
    secret: 's3cret',
  });
};
const post = (
  app: ReturnType<typeof mk>['app'],
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

describe('agent server', () => {
  it('serves the Agent Card and healthz', async () => {
    const { app } = mk();
    const card: any = await (await app.request('/.well-known/agent.json')).json();
    expect(card).toMatchObject({ id: 's_ana', protocol: 'a2a-shaped/1' });
    expect(card.states).toContain('input-required');
    expect(((await (await app.request('/healthz')).json()) as any).ok).toBe(true);
  });
  it('rejects bad JSON, bad schemas and unknown keys without echoing anything private', async () => {
    const { app } = mk();
    const bad = await app.request('/a2a', { method: 'POST', body: '{nope' });
    expect(bad.status).toBe(400);
    const open = {
      flow: 'trip',
      window: { from: '2026-11-20', to: '2026-11-30' },
      members: ['s_ana', 's_ben'],
    };
    const msg = {
      from: 's_ben',
      to: 's_ana',
      taskId: 't1',
      kind: 'task.open',
      payload: { ...open, reason: 'because' },
    };
    const r = await post(app, '/a2a', msg);
    expect(r.status).toBe(422);
    const body: any = await r.json();
    expect(body.state).toBe('failed');
    expect(findLeak(body, ['therapy', '187', 'budget'])).toBeUndefined();
    const ok = await post(app, '/a2a', { ...msg, payload: open });
    expect(ok.status).toBe(200);
  });
  it('guards /internal/* with the shared secret', async () => {
    const { app } = mk();
    expect((await post(app, '/internal/start/study', {})).status).toBe(403);
    expect(
      (await post(app, '/internal/start/study', {}, { 'X-Nook-Internal': 'wrong' })).status,
    ).toBe(403);
    expect(
      (await post(app, '/internal/start/study', { nope: 1 }, { 'X-Nook-Internal': 's3cret' }))
        .status,
    ).toBe(400);
  });
});

describe('web confirm bridge', () => {
  it('waits for /internal/confirm/answer, 404s when nothing waits, and times out to timeout', async () => {
    const emitter = new RecordingEmitter();
    const web = webConfirm({ emitter, timeoutMs: 50 });
    const { app } = createAgentApp({
      profile,
      net: {
        send: async () => {
          throw new Error('offline');
        },
      },
      emitter,
      askConfirm: web.ask,
      resolveConfirm: web.resolve,
      llm: new FakeLlm(),
      url: 'http://localhost:4101',
      secret: 's3cret',
    });
    const h = { 'X-Nook-Internal': 's3cret' };
    expect(
      (await post(app, '/internal/confirm/answer', { taskId: 't1', answer: 'yes' }, h)).status,
    ).toBe(404);
    const pending = web.ask('s_ana', 'Meet Tuesday?', ['Yes', 'No'], 't1');
    await new Promise((r) => setTimeout(r, 5));
    expect(
      (await post(app, '/internal/confirm/answer', { taskId: 't1', answer: 'no' }, h)).status,
    ).toBe(200);
    expect(await pending).toBe('No');
    expect(await web.ask('s_ana', 'again?', ['Yes', 'No'], 't2')).toBe('timeout');
    expect(
      (await post(app, '/internal/confirm/answer', { taskId: 't1', answer: 'maybe' }, h)).status,
    ).toBe(400);
    expect(
      (await post(app, '/internal/confirm/answer', { taskId: 't1', answer: 'yes' })).status,
    ).toBe(403);
  });
});

describe('POST /internal/calendar', () => {
  it('is guarded, validates, and replaces the live profile calendar', async () => {
    const { app } = mk();
    const ev = { start: '2026-11-10T16:00:00Z', end: '2026-11-10T17:00:00Z', title: 'Lecture' };
    expect((await post(app, '/internal/calendar', { events: [ev] })).status).toBe(403);
    const h = { 'X-Nook-Internal': 's3cret' };
    expect(
      (await post(app, '/internal/calendar', { events: [{ ...ev, start: 'x' }] }, h)).status,
    ).toBe(400);
    const keep = [...profile.calendar];
    const res = await post(app, '/internal/calendar', { events: [ev, ev] }, h);
    expect(await res.json()).toEqual({ ok: true, blocks: 2 });
    // titles never persist: only start/end survive, title is the constant 'busy'
    expect(profile.calendar).toEqual([{ ...ev, title: 'busy' }, { ...ev, title: 'busy' }]);
    profile.calendar.splice(0, profile.calendar.length, ...keep);
  });
});

describe('fixtures and calendar import', () => {
  it('fixtures validate and match the demo profiles', () => {
    for (const p of demoProfiles()) {
      const f = parseProfile(
        JSON.parse(readFileSync(new URL(`../fixtures/${p.id}.json`, import.meta.url), 'utf8')),
      );
      expect(f).toEqual(p);
    }
  });
  it('imports .ics into calendar events', () => {
    const ics = readFileSync(new URL('../fixtures/ics/s_ana.ics', import.meta.url), 'utf8');
    const evs = parseIcs(ics);
    expect(evs).toEqual([...profile.calendar].sort((a, b) => a.start.localeCompare(b.start)));
  });
  it('parses folded lines and all-day events', () => {
    const evs = parseIcs(
      'BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261120\r\nDTEND;VALUE=DATE:20261121\r\nSUMMARY:Long\r\n  title\r\nEND:VEVENT',
    );
    expect(evs[0]).toEqual({
      start: '2026-11-20T00:00:00Z',
      end: '2026-11-21T00:00:00Z',
      title: 'Long title',
    });
  });
});
