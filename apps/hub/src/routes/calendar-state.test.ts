import { describe, expect, it } from 'vitest';
import { createHub } from '../app';
import { signToken } from '../auth';

const SECRET = 'auth-test';

function setup() {
  const hub = createHub({
    config: { seed: true, sim: false, authSecret: SECRET, logLevel: 'silent' },
  });
  const sub = 's_ana';
  const headers = () => ({
    authorization: `Bearer ${signToken(SECRET, { kind: 'bearer', sub, ttlMs: 60_000 }).token}`,
  });
  const state = async () => {
    const res = await hub.app.request('/v1/squad/calendar', { headers: headers() });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  const post = (init: RequestInit) =>
    hub.app.request('/v1/squad/calendar', {
      method: 'POST',
      ...init,
      headers: { ...headers(), ...(init.headers as Record<string, string> | undefined) },
    });
  return { state, post };
}

const ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'DTSTART:20270301T150000Z',
  'DTEND:20270301T160000Z',
  'SUMMARY:Secret dentist',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('GET /v1/squad/calendar (setup state)', () => {
  it('is false by default, stays false after the demo calendar, true after a real .ics, booleans only', async () => {
    const { state, post } = setup();
    expect(await state()).toEqual({ status: 200, json: { ics: false } });
    await post({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ demo: true }),
    });
    expect((await state()).json).toEqual({ ics: false });
    const form = new FormData();
    form.append('file', new File([ICS], 'cal.ics', { type: 'text/calendar' }));
    const up = await post({ body: form });
    expect(up.status).toBe(200);
    const after = await state();
    expect(after.json).toEqual({ ics: true });
    expect(JSON.stringify(after.json)).not.toContain('dentist');
  });

  it('requires a signed-in viewer', async () => {
    const hub = createHub({
      config: { seed: true, sim: false, authSecret: SECRET, logLevel: 'silent' },
    });
    const res = await hub.app.request('/v1/squad/calendar');
    expect(res.status).toBe(401);
  });
});
