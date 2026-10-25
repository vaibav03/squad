import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { FakeLlm } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { createCourseStore, createOralExaminer, ingestText } from '@squad/brain';
import { createCallPort, FakeTts } from '@squad/media';
import { createRealPorts } from './adapters/real';
import { FIXTURE, login, openSse, post } from '../test/helpers';
import { startHub, type RunningHub } from './server';

const ANSWER = 'I think it works by splitting the problem into smaller independent parts';

async function examinerPort(files: string[]) {
  const store = createCourseStore(openMemoryDb());
  for (const f of files)
    await ingestText({ store }, 'demo', `${f}.pdf`, [`Text about ${f} that is long enough here.`], {
      chapter: f,
      title: `Topic ${f}`,
    });
  const llm = new FakeLlm({
    fallback: (req) => {
      const j = JSON.stringify(req);
      if (j.includes('closing a spoken'))
        return {
          items: [0, 1, 2].map((index) => ({
            index,
            solid: 'You explained it clearly.',
            revisit: 'Review the edge cases.',
          })),
        };
      if (j.includes('Judge the')) return { complete: true, followUp: '', solid: 'Good.', revisit: '' };
      return { question: 'Why does this idea matter?' };
    },
  });
  const oral = createOralExaminer({ store, llm, courseId: 'demo' });
  return createCallPort({
    // no TTS at all: the call runs on captions only
    tts: {
      speak: async () => {
        throw new Error('no tts');
      },
    },
    answer: async () => [{ text: 'static.' }],
    knownAgent: (a) => a.startsWith('expert:'),
    agentFor: ({ agent, student }) => {
      if (agent !== 'expert:oral' && agent !== 'expert:examiner') return undefined;
      const ex = oral.begin({ student });
      return { greeting: () => ex.greeting(), reply: (t) => ex.reply(t), done: () => ex.done() };
    },
  });
}

let hub: RunningHub;
let ana: string;

async function boot(files: string[]) {
  const replayDir = mkdtempSync(join(tmpdir(), 'hub-replays-'));
  cpSync(FIXTURE, join(replayDir, 'sample.json'));
  return startHub({
    config: {
      port: 0,
      baseUrl: 'http://localhost:0',
      internalSecret: 'test-secret',
      authSecret: 'auth-test',
      seed: true,
      sim: false,
      production: false,
      logLevel: 'silent',
      replayDir,
    },
    ports: { call: await examinerPort(files) },
  });
}

async function runCall(h: RunningHub, token: string, agentId: string, turns: string[]) {
  const sse = await (async () => {
    const { body } = await post<{ st: string }>(h.url, '/v1/squad/stream-token', {}, token);
    return openSse(h.url, { st: body.st });
  })();
  const start = await post<{ callId: string; ticket: string }>(h.url, '/v1/call/start', { agentId }, token);
  expect(start.status).toBe(200);
  const ws = new WebSocket(
    `${h.url.replace('http', 'ws')}/v1/call/ws/${start.body.callId}?st=${start.body.ticket}`,
  );
  const msgs: { type: string; text?: string; speaker?: string; reason?: string }[] = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  await new Promise<void>((r) => ws.on('open', () => r()));
  const agentCaptions = () => msgs.filter((m) => m.type === 'caption' && m.speaker === 'agent').length;
  const settle = async (n: number) => {
    for (let i = 0; i < 100 && agentCaptions() < n; i++) await new Promise((r) => setTimeout(r, 20));
  };
  await settle(2); // intro + first question
  for (const t of turns) {
    const before = agentCaptions();
    ws.send(JSON.stringify({ type: 'user.text', text: t }));
    await settle(before + 1);
  }
  return { sse, msgs, ws };
}

describe('oral exam over the call websocket (typed text, no mic, no TTS)', () => {
  beforeAll(async () => {
    hub = await boot(['ch1', 'ch2', 'ch3']);
    ana = await login(hub.url, 's_ana');
  });
  afterAll(async () => {
    await hub.stop();
  });

  it('call.start, per-line call.caption from expert:oral, summary, then call.end and the ended frame', async () => {
    const { sse, msgs } = await runCall(hub, ana, 'expert:oral', [ANSWER, ANSWER, ANSWER]);
    await sse.waitFor((f) => f.some((x) => x.event === 'call.end'));
    expect(sse.frames.filter((f) => f.event === 'call.start')).toHaveLength(1);
    expect(sse.frames.filter((f) => f.event === 'call.end')).toHaveLength(1);
    const caps = sse.frames
      .filter((f) => f.event === 'call.caption')
      .map((f) => JSON.parse(f.data!) as { agent?: string; text?: string });
    expect(caps.length).toBeGreaterThanOrEqual(8);
    expect(caps.every((c) => c.agent === 'expert:oral')).toBe(true);
    expect(JSON.stringify(caps)).toContain('Oral Exam practice, feedback only');
    expect(JSON.stringify(caps)).not.toMatch(/\d\s*%/);
    // hangUp also returns the agent to idle
    expect(
      sse.frames.some((f) => f.event === 'agent.state' && f.data?.includes('"idle"')),
    ).toBe(true);
    for (let i = 0; i < 50 && !msgs.some((m) => m.type === 'ended'); i++)
      await new Promise((r) => setTimeout(r, 20));
    expect(msgs.find((m) => m.type === 'ended')?.reason).toBe('server');
    expect(msgs.some((m) => m.type === 'audio')).toBe(false);
    expect(hub.deps.calls.active()).toHaveLength(0);
    sse.stop();
  });

  it('expert:examiner is accepted too; skipping everything still reaches the summary', async () => {
    const { sse, msgs } = await runCall(hub, ana, 'expert:examiner', ['skip', 'skip', 'skip']);
    await sse.waitFor((f) => f.some((x) => x.event === 'call.end'));
    for (let i = 0; i < 50 && !msgs.some((m) => m.type === 'ended'); i++)
      await new Promise((r) => setTimeout(r, 20));
    expect(msgs.find((m) => m.type === 'ended')?.reason).toBe('server');
    sse.stop();
  });

  it('a normal chapter expert call is untouched (no server-side hang up after the greeting)', async () => {
    const start = await post<{ callId: string; ticket: string }>(hub.url, '/v1/call/start', { agentId: 'expert:ch1' }, ana);
    expect(start.status).toBe(200);
    const ws = new WebSocket(
      `${hub.url.replace('http', 'ws')}/v1/call/ws/${start.body.callId}?st=${start.body.ticket}`,
    );
    const msgs: { type: string }[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    await new Promise<void>((r) => ws.on('open', () => r()));
    await new Promise((r) => setTimeout(r, 200));
    expect(msgs.some((m) => m.type === 'ended')).toBe(false);
    ws.send(JSON.stringify({ type: 'end' }));
    await new Promise((r) => setTimeout(r, 100));
    expect(hub.deps.calls.active()).toHaveLength(0);
  });
});

describe('oral exam with no chapters', () => {
  it('says so and hangs up', async () => {
    const h = await boot([]);
    try {
      const token = await login(h.url, 's_ana');
      const { sse, msgs } = await runCall(h, token, 'expert:oral', []);
      await sse.waitFor((f) => f.some((x) => x.event === 'call.end'));
      const texts = msgs.filter((m) => m.type === 'caption').map((m) => m.text).join(' ');
      expect(texts).toMatch(/cannot find any course chapters/);
      sse.stop();
    } finally {
      await h.stop();
    }
  });
});

describe('oral exam through createRealPorts (FakeLlm, FakeTts, fixture course)', () => {
  it('routes expert:oral to the examiner with the examiner voice and audio', async () => {
    const h = await boot([]);
    try {
      const llm = new FakeLlm({
        fallback: (req) => {
          const j = JSON.stringify(req);
          if (j.includes('closing a spoken')) return { items: [] };
          if (j.includes('Judge the')) return { complete: true, followUp: '', solid: '', revisit: '' };
          return { question: 'Why does this idea matter?' };
        },
      });
      const engine = new FakeTts();
      const rp = await createRealPorts(h.deps, { llm, tts: engine });
      h.deps.ports = rp.ports;
      const token = await login(h.url, 's_ana');
      const { sse, msgs } = await runCall(h, token, 'expert:oral', [ANSWER, ANSWER, ANSWER]);
      await sse.waitFor((f) => f.some((x) => x.event === 'call.end'));
      expect(msgs.some((m) => m.type === 'audio')).toBe(true);
      expect(msgs.filter((m) => m.type === 'caption' && m.speaker === 'agent').length).toBeGreaterThanOrEqual(6);
      sse.stop();
    } finally {
      await h.stop();
    }
  });
});
