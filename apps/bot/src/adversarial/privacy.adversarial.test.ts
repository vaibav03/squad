// Privacy attack classes: sentinel withheld values and secrets must not appear in events, logs,
// decision_json or persisted outbound text across a long seeded random 4-person session; ledger
// events with a real withheld value are blocked by the publisher guard; events never carry counts.
import { describe, expect, it } from 'vitest';
import { assertNoLeak, type Skill } from '@squad/core';
import { guardEvent, createEventPublisher } from '../events';
import { spyLogger } from '../log';
import { createTestBot } from '../testing';

const SECRETS = ['$180', 'therapy', 'sk-test-SECRET-123'];

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

describe('privacy', () => {
  it('long randomized session: no sentinel in events, logs or stored decisions', async () => {
    process.env.GEMINI_API_KEY = 'sk-test-SECRET-123';
    const log = spyLogger();
    const private1: Skill = {
      name: 'private',
      match: async (m) => (m.text.includes('trip') ? 0.9 : 0),
      handle: async (m, ctx) => {
        const memory = (ctx as unknown as { memory: { set(...a: unknown[]): void } }).memory;
        memory.set('student', m.from, 'budget', '$180');
        memory.set('student', m.from, 'note', 'therapy');
        const a = await ctx.askConfirm(m.from, 'Share a budget range?', ['Yes', 'No'], `t-${m.ts}`);
        return [{ chatId: m.chatId, text: `Done (${a}). Details stay private.` }];
      },
    };
    const t = createTestBot({ skills: [private1], log });
    const r = rng(1234);
    const people = ['s_ana', 's_ben', 's_cam', 's_dee'];
    const lines = ['lol', 'plan the trip', '@cubbie hi', 'hey cubbie trip', 'banter', 'trip time'];
    const inflight: Promise<unknown>[] = [];
    for (let i = 0; i < 80; i++) {
      const who = people[Math.floor(r() * 4)]!;
      t.advance(Math.floor(r() * 60_000));
      if (r() < 0.25) await t.answerConfirm(who, r() < 0.5 ? '1' : 'yes');
      else
        inflight.push(t.say(who, 'group:test', lines[Math.floor(r() * lines.length)]!, { ts: i }));
      await new Promise((x) => setTimeout(x, 1));
    }
    for (const p of people) await t.answerConfirm(p, '2');
    await Promise.race([Promise.allSettled(inflight), new Promise((x) => setTimeout(x, 100))]);
    assertNoLeak(t.events, SECRETS, 'events');
    assertNoLeak(
      t.decisions().map((d) => d.decision),
      SECRETS,
      'decisions',
    );
    assertNoLeak(t.sent, SECRETS, 'sent');
    expect(log.lines.join('\n')).not.toMatch(/\$180|therapy|sk-test-SECRET/);
  });

  it('the publisher guard blocks real withheld values and configured sentinels', () => {
    expect(
      guardEvent({
        t: 'ledger.entry',
        taskId: 't',
        student: 's',
        field: 'f',
        withheld: 'therapy',
      } as never),
    ).toMatch(/withheld/);
    expect(
      guardEvent({ t: 'ledger.entry', taskId: 't', student: 's', field: 'f', withheld: 'hidden' }),
    ).toBeUndefined();
    expect(
      guardEvent({ t: 'confirm.pending', student: 's', taskId: 't', question: 'costs $180?' }, [
        '$180',
      ]),
    ).toMatch(/sentinel/);
  });

  it('a blocked event is never posted and an invalid event never throws', async () => {
    const posted: unknown[] = [];
    const pub = createEventPublisher({
      post: async (e) => (posted.push(e), { ok: true, attempts: 1 }),
      sentinels: ['$180'],
    });
    await pub.publish({ t: 'confirm.pending', student: 's', taskId: 't', question: 'pay $180?' });
    await pub.publish({ t: 'nope' } as never);
    await pub.publish({ t: 'confirm.pending', student: 's', taskId: 't', question: 'ok?' });
    expect(posted).toHaveLength(1);
  });

  it('a hub that is down does not delay or fail the reply', async () => {
    const pub = createEventPublisher({ post: () => new Promise(() => {}) });
    const t = createTestBot();
    // swap in a never-resolving hub publisher through a fresh bot
    const slow = createTestBot({ tap: pub });
    const t0 = Date.now();
    await slow.say('s_ana', 'group:test', '@cubbie hi');
    expect(Date.now() - t0).toBeLessThan(500);
    expect(slow.sent).toHaveLength(1);
    void t;
  });
});
