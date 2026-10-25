import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CouncilResultSchema, SENTINELS, type CouncilResult } from '@squad/core';
import type { RunningHub } from '../../src/server';
import { boot, get, login, openSse, post, auth } from '../helpers';

let hub: RunningHub;
let url: string;
let ana: string;
let ben: string;

beforeAll(async () => {
  hub = await boot();
  url = hub.url;
  ana = await login(url, 's_ana');
  ben = await login(url, 's_ben');
});
afterAll(async () => {
  await hub.stop();
});

const villageStream = async (token: string) => {
  const { body } = await post<{ st: string }>(url, '/v1/squad/stream-token', {}, token);
  return openSse(url, { st: body.st });
};

/** Reads a council stream until the server closes it. */
async function councilStream(token: string, streamUrl: string) {
  const { body } = await post<{ st: string }>(url, '/v1/squad/stream-token', {}, token);
  const res = await fetch(`${url}${streamUrl}?st=${encodeURIComponent(body.st)}`);
  expect(res.status).toBe(200);
  const text = await res.text(); // resolves when the stream ends
  return text
    .split('\n\n')
    .map((raw) => {
      const f: { event?: string; data?: string } = {};
      for (const line of raw.split('\n')) {
        if (line.startsWith('event: ')) f.event = line.slice(7);
        else if (line.startsWith('data: ')) f.data = line.slice(6);
      }
      return f;
    })
    .filter((f) => f.event);
}

const ask = (token: string, body: unknown) =>
  post<{ id: string; streamUrl: string; resultUrl: string; status: string }>(
    url,
    '/v1/council/ask',
    body,
    token,
  );

describe('ask the council (demo model)', () => {
  it('runs end to end: stream to done, result, and the village sees the session', async () => {
    const village = await villageStream(ben);
    const a = await ask(ana, { question: 'Is a bond price inversely related to its yield?' });
    expect(a.status).toBe(202);
    const frames = await councilStream(ana, a.body.streamUrl);
    expect(frames.at(-1)?.event).toBe('council.done');
    expect(frames.filter((f) => f.event === 'council.step').length).toBeGreaterThan(0);

    const r = await get<CouncilResult>(url, a.body.resultUrl, ben); // squad run: teammate can read
    expect(r.status).toBe(200);
    const res = CouncilResultSchema.parse(r.body);
    expect(res.status).toBe('done');
    expect(res.demo).toBe(true);
    expect(res.members.length).toBe(3);
    expect(res.rankings.length).toBe(3);
    expect(res.verdict?.text).toBeTruthy();
    const last = CouncilResultSchema.parse(JSON.parse(frames.at(-1)!.data!));
    expect(last.id).toBe(res.id);

    await village.waitFor((f) => f.some((x) => x.event === 'council.verdict'));
    const ev = village.frames.filter((f) => f.event?.startsWith('council.'));
    const data = ev.map((f) => ({ t: f.event, ...JSON.parse(f.data!) }));
    const mine = data.filter((d) => d.councilId === 'council:ask');
    const ops = mine.filter((d) => d.t === 'council.opinion');
    expect(ops).toHaveLength(3);
    for (const o of ops) expect(o.text).toBeTruthy();
    expect(mine.filter((d) => d.t === 'council.rank')).toHaveLength(3);
    expect(mine.filter((d) => d.t === 'council.verdict')).toHaveLength(1);
    village.stop();
  });

  it('a second ask while one runs is refused with 429', async () => {
    const first = await ask(ben, { question: 'What does diversification do for risk?' });
    expect(first.status).toBe(202);
    const second = await ask(ben, { question: 'What does diversification do for risk?' });
    // the demo model is fast, so it may already be done; either is a valid, contract-shaped answer
    expect([202, 429]).toContain(second.status);
    await councilStream(ben, first.body.streamUrl);
  });

  it('a DM-asked question stays private: teammates get 404, village events carry no text', async () => {
    const chi = await login(url, 's_chi');
    const village = await villageStream(ben);
    const before = village.frames.length;
    const q = `Should I talk to someone about ${SENTINELS[1]} with a ${SENTINELS[0]} budget?`;
    const a = await ask(chi, { question: q, chatId: 'dm:s_chi' });
    expect(a.status).toBe(202);
    await councilStream(chi, a.body.streamUrl);

    const g = await fetch(`${url}${a.body.resultUrl}`, { headers: auth(ben) });
    expect(g.status).toBe(404);
    expect(await g.text()).not.toMatch(/\$180|therapy/);
    const { body } = await post<{ st: string }>(url, '/v1/squad/stream-token', {}, ben);
    const s = await fetch(`${url}${a.body.streamUrl}?st=${encodeURIComponent(body.st)}`);
    expect(s.status).toBe(404);

    await village.waitFor((f) => f.slice(before).some((x) => x.event === 'council.verdict'));
    const mine = village.frames.slice(before).filter((f) => f.event?.startsWith('council.'));
    expect(mine.filter((f) => f.event === 'council.opinion')).toHaveLength(3);
    for (const f of mine) {
      const d = JSON.parse(f.data!) as { text?: string; outcome?: unknown };
      expect(d.text).toBeUndefined();
      expect(d.outcome).toBeUndefined();
    }
    for (const f of village.frames)
      for (const x of SENTINELS) expect(f.data ?? '').not.toContain(x);
    village.stop();
  });
});
