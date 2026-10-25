import { describe, expect, it } from 'vitest';
import type { Skill } from '@squad/core';
import { createTestBot } from './testing';

const stub = (name: string, score: number, text = `from ${name}`): Skill => ({
  name,
  match: async () => score,
  handle: async (m) => [{ chatId: m.chatId, text }],
});

describe('router', () => {
  it('banter without a mention stays quiet and the decision is logged', async () => {
    const t = createTestBot();
    const r = await t.say('s_ana', 'group:test', 'anyone want pizza lol');
    expect(r.sent).toEqual([]);
    expect(t.sent).toEqual([]);
    const d = t.decisions().at(-1)!.decision;
    expect(d).toMatchObject({ action: 'quiet', reason: 'below_threshold', mentioned: false });
    expect(d.scores).toHaveLength(1);
  });

  it('@cubbie hi gets exactly one persona-prefixed reply', async () => {
    const t = createTestBot();
    await t.say('s_ana', 'group:test', '@cubbie hi');
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]!.text).toMatch(/^\u{1F43B} Squad: /u);
    expect(t.sent[0]!.chatId).toBe('group:test');
  });

  it('a 0.85 skill speaks unprompted, then is quiet for 2 minutes, then speaks again', async () => {
    const t = createTestBot({ skills: [stub('quiz', 0.85)] });
    await t.say('s_ana', 'group:test', 'ugh chapter 3 is hard');
    expect(t.sent).toHaveLength(1);
    t.advance(30_000);
    const r = await t.say('s_ben', 'group:test', 'same');
    expect(r.decision.reason).toBe('cooldown');
    expect(t.sent).toHaveLength(1);
    t.advance(90_000);
    await t.say('s_cam', 'group:test', 'honestly yes');
    expect(t.sent).toHaveLength(2);
  });

  it('a mention during cooldown is answered and does not reset the cooldown', async () => {
    const t = createTestBot({ skills: [stub('quiz', 0.85)] });
    await t.say('s_ana', 'group:test', 'a');
    t.advance(100_000);
    await t.say('s_ben', 'group:test', '@cubbie help');
    expect(t.sent).toHaveLength(2);
    t.advance(20_000); // 120s since the unprompted message
    await t.say('s_cam', 'group:test', 'b');
    expect(t.sent).toHaveLength(3);
  });

  it('cooldown is per chat', async () => {
    const t = createTestBot({ skills: [stub('quiz', 0.9)] });
    await t.say('s_ana', 'group:test', 'a');
    await t.say('s_ana', 'group:other', 'a');
    expect(t.sent.map((s) => s.chatId)).toEqual(['group:test', 'group:other']);
  });

  it('a DM always gets a reply from the top skill', async () => {
    const t = createTestBot();
    await t.say('s_ana', 'dm', 'hello there');
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]!.chatId).toBe('dm:s_ana');
  });

  it('duplicate delivery never double-posts; own messages are ignored', async () => {
    const t = createTestBot();
    await t.say('s_ana', 'group:test', '@cubbie hi');
    await t.say('s_ana', 'group:test', '@cubbie hi');
    expect(t.sent).toHaveLength(1);
    const r = await t.say('bot', 'group:test', '@cubbie hi', { ts: 5 });
    expect(r.decision.reason).toBe('own_message');
    expect(t.sent).toHaveLength(1);
  });

  it('a throwing handler gets an apology and the agent returns to idle', async () => {
    const bad: Skill = {
      name: 'bad',
      match: async () => 0.9,
      handle: async () => {
        throw new Error('boom');
      },
    };
    const t = createTestBot({ skills: [bad] });
    await t.say('s_ana', 'group:test', '@cubbie x');
    expect(t.sent[0]!.text).toMatch(/something went wrong/);
    expect(t.events.map((e) => (e.t === 'agent.state' ? e.state : e.t))).toEqual([
      'studying',
      'idle',
    ]);
    expect(t.decisions().at(-1)!.decision).toMatchObject({ spoke: true, error: 'boom' });
  });

  it('an unprompted failure stays silent and releases the cooldown slot', async () => {
    let fail = true;
    const flaky: Skill = {
      name: 'flaky',
      match: async () => 0.9,
      handle: async (m) => {
        if (fail) throw new Error('x');
        return [{ chatId: m.chatId, text: 'ok' }];
      },
    };
    const t = createTestBot({ skills: [flaky] });
    await t.say('s_ana', 'group:test', 'a');
    expect(t.sent).toEqual([]);
    fail = false;
    await t.say('s_ben', 'group:test', 'b');
    expect(t.sent).toHaveLength(1);
  });

  it('a hanging or throwing match() cannot block or win', async () => {
    const hang: Skill = {
      name: 'hang',
      match: () => new Promise(() => {}),
      handle: async () => [],
    };
    const boom: Skill = {
      name: 'boom',
      match: async () => {
        throw new Error('no');
      },
      handle: async () => [],
    };
    const t = createTestBot({ skills: [hang, boom, stub('ok', 0.6)], scoreTimeoutMs: 30 });
    await t.say('s_ana', 'group:test', '@cubbie yo');
    const d = t.decisions().at(-1)!.decision;
    expect(d.skill).toBe('ok');
    expect(d.scores.find((s) => s.skill === 'hang')).toMatchObject({ score: 0, timedOut: true });
    expect(d.scores.find((s) => s.skill === 'boom')).toMatchObject({ score: 0, error: 'no' });
  });

  it('a long-running skill in one chat does not delay another chat or the same chat', async () => {
    let release!: () => void;
    const slow: Skill = {
      name: 'slow',
      match: async (m) => (m.text.includes('slow') ? 1 : 0),
      handle: (m) =>
        new Promise((r) => {
          release = () => r([{ chatId: m.chatId, text: 'done' }]);
        }),
    };
    const t = createTestBot({ skills: [slow] });
    const p = t.say('s_ana', 'group:a', '@cubbie slow');
    await new Promise((r) => setTimeout(r, 5));
    await t.say('s_ben', 'group:b', '@cubbie fast');
    await t.say('s_cam', 'group:a', '@cubbie also fast');
    expect(t.sent.map((s) => s.chatId)).toEqual(['group:b', 'group:a']);
    release();
    await p;
    expect(t.sent).toHaveLength(3);
  });

  it('a burst of identical high-score messages yields one unprompted message', async () => {
    const t = createTestBot({ skills: [stub('quiz', 0.95)] });
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => t.say('s_ana', 'group:test', 'hot take', { ts: i })),
    );
    expect(t.sent).toHaveLength(1);
  });

  it('persists inbound, outbound and decision_json; unknown senders are auto-created', async () => {
    const t = createTestBot();
    await t.say('s_9999', 'group:test', '@cubbie hello');
    expect(t.db.prepare("SELECT COUNT(*) c FROM students WHERE id='s_9999'").get()).toEqual({
      c: 1,
    });
    const rows = t.db.prepare('SELECT from_id, decision_json FROM messages ORDER BY id').all() as {
      from_id: string;
      decision_json: string | null;
    }[];
    expect(rows.map((r) => r.from_id)).toEqual(['s_9999', 'bot']);
    expect(JSON.parse(rows[0]!.decision_json!)).toMatchObject({
      action: 'run',
      spoke: true,
      skill: 'chat',
    });
  });

  it('send failures do not crash the router', async () => {
    const t = createTestBot();
    t.transport.failNext = 5;
    const r = await t.say('s_ana', 'group:test', '@cubbie hi');
    expect(r.sent).toEqual([]);
  });
});
