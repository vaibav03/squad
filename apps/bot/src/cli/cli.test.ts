import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateReplay } from '@squad/core';
import { createBot } from '../bot';
import { recordingPublisher, teePublisher } from '../events';
import { CliTransport } from '../transports/cli';
import { createTestBot, TEST_ROSTER } from '../testing';
import { FakeLlm } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { chatSkill } from '../skills/chat';
import { ChatRepl } from './repl';
import { createRecorder } from './recorder';
import { loadScript, runScript, SessionScriptSchema } from './script';
import type { EventPublisher } from '../types';

const fx = (f: string) => resolve(__dirname, '../../fixtures/scripts', f);

async function replHarness() {
  const transport = new CliTransport(TEST_ROSTER);
  const db = openMemoryDb();
  const tap: { current?: EventPublisher } = {};
  const events = teePublisher(recordingPublisher(), {
    publish: (e) => tap.current?.publish(e) ?? Promise.resolve(),
  });
  const bot = createBot({
    skills: [chatSkill],
    llm: new FakeLlm({ fallback: 'hey there' }),
    transport,
    db,
    roster: TEST_ROSTER,
    events,
  });
  await bot.start();
  const out: string[] = [];
  const repl = new ChatRepl({
    bot,
    transport,
    db,
    out: (l) => out.push(l),
    tap,
    students: ['s_ana', 's_ben'],
  });
  return { repl, out, transport };
}

describe('script runner', () => {
  it('rejects unknown keys and unknown stub skills', async () => {
    expect(() =>
      SessionScriptSchema.parse({
        name: 'x',
        steps: [{ as: 'a', chat: 'dm', say: 'hi', extra: 1 }],
      }),
    ).toThrow();
    await expect(
      runScript({ name: 'x', stubSkills: ['nope'], steps: [{ wait: 1 }] }),
    ).rejects.toThrow(/unknown stub skill/);
  });
  it('is deterministic: two runs of the same script give identical output', async () => {
    const a = await runScript(loadScript(fx('group-banter.json')));
    const b = await runScript(loadScript(fx('group-banter.json')));
    expect(a.sent.map((s) => s.text)).toEqual(b.sent.map((s) => s.text));
    expect(a.decisions.map((d) => d.reason)).toEqual(b.decisions.map((d) => d.reason));
  });
});

describe('recorder', () => {
  it('writes a valid replay with checkpoints and refuses to write an invalid one', async () => {
    let t = 0;
    const rec = createRecorder({ name: 'demo', cast: { me: 's_ana' }, now: () => (t += 100) });
    const t1 = createTestBot({ tap: rec.publisher });
    const p = t1.bot.ctx.askConfirm('s_ana', 'Q?', ['a', 'b'], 'T');
    await new Promise((r) => setTimeout(r, 5));
    rec.checkpoint('asked');
    await t1.answerConfirm('s_ana', '1');
    await p;
    const file = join(mkdtempSync(join(tmpdir(), 'rec-')), 'sub', 'demo.json');
    const script = rec.write(file);
    expect(validateReplay(JSON.parse(readFileSync(file, 'utf8'))).ok).toBe(true);
    expect(script.events.map((e) => e.event.t)).toEqual([
      'agent.state',
      'confirm.pending',
      'confirm.done',
      'agent.state',
    ]);
    expect(Object.keys(script.checkpoints)).toEqual(['start', 'asked', 'end']);
    const bad = createRecorder({ name: '', cast: { me: 's_ana' } });
    expect(() => bad.write(join(tmpdir(), 'never.json'))).toThrow(/not a valid replay/);
  });
});

describe('repl', () => {
  it('plain text goes through the router; /decisions shows scores; /help and unknown commands', async () => {
    const { repl, out } = await replHarness();
    await repl.execute('@cubbie hello');
    await repl.execute('/decisions 1');
    await repl.execute('/nope');
    await repl.execute('/help');
    const text = out.join('\n');
    expect(text).toMatch(/\[group:test\] .*Nook: hey there/);
    expect(text).toMatch(/RUN \(mentioned\) -> chat/);
    expect(text).toMatch(/unknown command \/nope/);
    expect(text).toMatch(/\/record <file>/);
  });
  it('/as, /group, /dm switch context; banter is quiet', async () => {
    const { repl, out } = await replHarness();
    await repl.execute('/as s_ben');
    await repl.execute('/group study');
    expect(repl.prompt()).toBe('s_ben@group:study> ');
    await repl.execute('just banter');
    expect(out.filter((l) => l.includes('Nook'))).toHaveLength(0);
    await repl.execute('/dm');
    await repl.execute('hi');
    expect(out.join('\n')).toMatch(/\[dm -> s_ben\]/);
  });
  it('/record start, /checkpoint and /record stop write a valid replay', async () => {
    const { repl, out } = await replHarness();
    const file = join(mkdtempSync(join(tmpdir(), 'repl-')), 'r.json');
    await repl.execute(`/record ${file}`);
    await repl.execute('@cubbie one');
    await repl.execute('/checkpoint mid');
    await repl.execute('/record stop');
    expect(out.join('\n')).toMatch(/wrote .*r\.json/);
    const v = validateReplay(JSON.parse(readFileSync(file, 'utf8')));
    expect(v.ok).toBe(true);
  });
  it('/quit ends the session', async () => {
    const { repl } = await replHarness();
    await repl.execute('/quit');
    expect(repl.done).toBe(true);
  });
});
