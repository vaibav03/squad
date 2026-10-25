// One scripted session through the FULL registry (brain, quiz, media) on FakeLlm and FakeTts:
// a doubt with a verified citation, a quiz round, a private "am I behind?", a podcast request.
// Asserts the emitted events and that nothing withheld (quiz keys, explanations, other students'
// mastery) reaches a group message, a village event, or someone else's DM.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VillageEventSchema, type OutboundMessage } from '@squad/core';
import { FIXTURE_DIR } from '@squad/brain';
import { QUIZ_SECRET as SECRET, buildSessionSkills } from '../../src/cli/demo-session';
import { loadScript, runScript } from '../../src/cli/script';

const fx = (f: string) => resolve(__dirname, '../../fixtures/scripts', f);
const g = (
  JSON.parse(readFileSync(resolve(FIXTURE_DIR, 'golden.json'), 'utf8')) as {
    answerable: { question: string; file: string; page: number }[];
  }
).answerable.find((a) => a.question.includes('empirical rule'))!;

describe('multi-skill session (FakeLlm, FakeTts)', () => {
  it('runs doubt, quiz, behind and podcast; events valid; nothing withheld leaks', async () => {
    const events: unknown[] = [];
    const { skills, db } = await buildSessionSkills((e) => void events.push(e));
    const r = await runScript(loadScript(fx('multi-skill.json')), {
      skills,
      db,
      chat: false,
      drainMs: 5000,
    });
    const inGroup = r.sent.filter((o: OutboundMessage) => o.chatId === 'group:stats');
    const dmTo = (s: string) => r.sent.filter((o) => o.chatId === `dm:${s}`);

    // banter line 1 got no reply; the first reply is the doubt answer with a verified citation
    expect(inGroup[0]!.text).toContain(`(${g.file} p.${g.page})`);

    // quiz: first question posted to the group, answers collected, feedback private
    expect(inGroup.some((o) => /Q1\./.test(o.text ?? ''))).toBe(true);
    const kinds = events.map((e) => (e as { t: string }).t);
    expect(kinds).toEqual(
      expect.arrayContaining(['quiz.question', 'mastery.changed', 'quiz.answer']),
    );
    expect(kinds.filter((k) => k === 'quiz.answer').length).toBeGreaterThanOrEqual(3);

    // private "am I behind?": group sees only the pointer, ana gets the detail by DM
    expect(inGroup.some((o) => o.text?.includes('Sent you a DM.'))).toBe(true);
    expect(dmTo('s_ana').length).toBeGreaterThan(0);
    for (const s of ['s_ben', 's_cam']) {
      const mine = dmTo(s)
        .map((o) => o.text ?? '')
        .join('\n');
      expect(mine).not.toMatch(/behind|Overdue|box \d/i);
    }

    // podcast: personal cut goes to ana by DM with an audio attachment
    const podcastDm = dmTo('s_ana').find((o) => (o.attachments?.length ?? 0) > 0);
    expect(podcastDm, 'podcast DM with attachment').toBeDefined();
    expect(existsSync(podcastDm!.attachments![0]!.path)).toBe(true);
    expect(inGroup.every((o) => !o.attachments?.length)).toBe(true);

    // events: every one valid, none carries the key or explanation
    for (const e of [...events, ...r.events]) VillageEventSchema.parse(e);
    expect(JSON.stringify([...events, ...r.events])).not.toContain(SECRET);
    // nothing withheld in any message to the group or to another student's DM
    expect(JSON.stringify(inGroup)).not.toContain(SECRET);
    expect(JSON.stringify(dmTo('s_ben'))).not.toContain('Ana');
  });
});
