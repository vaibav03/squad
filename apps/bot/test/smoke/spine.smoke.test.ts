// Spine smoke tests: spec 02 smoke list 1-4 and 6, plus a simulated 4-person group session.
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertNoLeak, validateReplay, type Skill } from '@squad/core';
import { createRecorder } from '../../src/cli/recorder';
import { loadScript, runScript } from '../../src/cli/script';
import { spyLogger } from '../../src/log';
import { createTestBot } from '../../src/testing';

const fx = (f: string) => resolve(__dirname, '../../fixtures/scripts', f);
const tick = () => new Promise((r) => setTimeout(r, 5));

describe('spine smoke', () => {
  it('1. group message without a mention: chat skill stays quiet, decision logged', async () => {
    const t = createTestBot();
    await t.say('s_ana', 'group:test', 'what is everyone doing');
    expect(t.sent).toHaveLength(0);
    expect(t.decisions().at(-1)!.decision).toMatchObject({
      action: 'quiet',
      best: { skill: 'chat' },
    });
  });

  it('2. @cubbie hi replies once; stub 0.85 speaks unprompted; second within 2 min is quiet', async () => {
    const stub: Skill = {
      name: 'stub',
      match: async (m) => (m.text.includes('exam') ? 0.85 : 0),
      handle: async (m) => [{ chatId: m.chatId, text: 'study tip' }],
    };
    const t = createTestBot({ skills: [stub] });
    await t.say('s_ana', 'group:test', '@cubbie hi');
    expect(t.sent).toHaveLength(1);
    await t.say('s_ben', 'group:test', 'exam tomorrow');
    expect(t.sent).toHaveLength(2);
    t.advance(60_000);
    await t.say('s_cam', 'group:test', 'exam exam');
    expect(t.sent).toHaveLength(2);
  });

  it('3. askConfirm: "2" and the option text resolve; no answer times out', async () => {
    const t = createTestBot({ confirmTimeoutMs: 20 });
    const a = t.bot.ctx.askConfirm('s_ana', 'Pick', ['Mon', 'Tue', 'Wed'], 'a');
    await tick();
    await t.answerConfirm('s_ana', '2');
    expect(await a).toBe('Tue');
    const b = t.bot.ctx.askConfirm('s_ana', 'Pick', ['Mon', 'Tue', 'Wed'], 'b');
    await tick();
    await t.answerConfirm('s_ana', 'wednesday?? wed');
    await t.answerConfirm('s_ana', 'wed');
    expect(await b).toBe('Wed');
    expect(await t.bot.ctx.askConfirm('s_ben', 'Pick', ['x', 'y'], 'c')).toBe('timeout');
  });

  it('4. persona prefix on sends; isFromMe/bot messages are ignored', async () => {
    const t = createTestBot();
    await t.say('s_ana', 'group:test', '@cubbie hi');
    expect(t.sent[0]!.text).toMatch(/^\u{1F43B} Nook: /u);
    const r = await t.say('bot', 'group:test', '@cubbie hi', { ts: 1 });
    expect(r.decision.reason).toBe('own_message');
    expect(t.sent).toHaveLength(1);
  });

  it('6. confirm emits pending then done; a recorded session validates and replays to the same events', async () => {
    let clock = 1000;
    const rec = createRecorder({
      name: 'confirm-dm',
      cast: { me: 's_ana' },
      now: () => (clock += 250),
    });
    const r = await runScript(loadScript(fx('confirm-dm.json')), { tap: rec.publisher });
    expect(r.unresolved).toBe(0);
    const kinds = r.events.map((e) => e.t);
    expect(kinds.indexOf('confirm.pending')).toBeLessThan(kinds.indexOf('confirm.done'));
    expect(r.sent.at(-1)!.text).toContain('Booked for Friday 3pm.');
    const script = rec.build();
    const v = validateReplay(JSON.parse(JSON.stringify(script)));
    expect(v.ok).toBe(true);
    expect(script.events.map((e) => e.event)).toEqual(r.events);
    expect(script.events.map((e) => e.at)).toEqual(
      [...script.events.map((e) => e.at)].sort((a, b) => a - b),
    );
  });

  it('simulated 4-person group session (banter, mention, unprompted, crash, DM confirm, duplicate)', async () => {
    const r = await runScript(loadScript(fx('group-banter.json')));
    // banter stays quiet; @cubbie hi answered; chapter 3 triggers ONE unprompted quiz offer;
    // the second "quiz" line 10 s later is in cooldown; the crash mention gets an apology; after
    // the cooldown an exam line speaks again
    const texts = r.sent.map((s) => s.text ?? '');
    expect(texts).toHaveLength(4);
    expect(texts[0]).toMatch(/Nook: /);
    expect(texts[1]).toMatch(/3-question quiz/);
    expect(texts[2]).toMatch(/something went wrong/);
    expect(texts[3]).toMatch(/3-question quiz/);
    expect(r.decisions.map((d) => d.reason)).toEqual([
      'below_threshold',
      'below_threshold',
      'mentioned',
      'confident',
      'cooldown',
      'mentioned',
      'confident',
    ]);
  });

  it('privacy: a withheld sentinel in skill-private state never appears in events, logs or decisions', async () => {
    const log = spyLogger();
    const secretive: Skill = {
      name: 'secretive',
      match: async (m) => (m.mentionsBot ? 0.9 : 0),
      handle: async (m, ctx) => {
        (ctx as unknown as { memory: { set(...a: unknown[]): void } }).memory.set(
          'student',
          m.from,
          'budget',
          '$180',
        );
        const a = await ctx.askConfirm(
          m.from,
          'Share your budget range with the squad?',
          ['Yes', 'No'],
          't1',
        );
        return [
          {
            chatId: m.chatId,
            text: a === 'Yes' ? 'Shared a range (value hidden).' : 'Kept private.',
          },
        ];
      },
    };
    const t = createTestBot({ skills: [secretive], log });
    const p = t.say('s_ana', 'group:test', '@cubbie plan the trip');
    await tick();
    await t.answerConfirm('s_ana', 'yes');
    await p;
    assertNoLeak(t.events, ['$180', 'therapy'], 'events');
    assertNoLeak(
      t.decisions().map((d) => d.decision),
      ['$180'],
      'decisions',
    );
    expect(log.lines.join('\n')).not.toContain('$180');
  });
});
